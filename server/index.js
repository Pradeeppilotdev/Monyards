// server/index.js — bake + pin API for the Lanyard mint frontend.
//
// Endpoints:
//   GET  /api/config   Chain + contract config for the frontend (env-driven).
//   POST /api/bake     { username?, name?, pfp?, front?, back?, shareImage? }
//                      → bakes the per-mint HTML, pins it + the card image +
//                      metadata to IPFS, stores a local copy (db.js), returns
//                      tokenURI/animationUrl/image + share URLs.
//   GET  /i/:id.ext    Stored share image (served from this server).
//   GET  /s/:id        Stored interactive share page (served locally).
//   GET  /api/wall     Recent shares — ready for a gallery wall.
//
// The mint transaction itself is sent by the user's wallet (frontend) — this
// server never holds keys and only does off-chain baking + pinning.

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { renderCardSvg, toDataUrl, mimeFromName, normalizePalette } from '../shared/card-svg.js'
import { bakeHtml } from '../animation/bake.mjs'
import { pinFile, pinJson, pinningEnabled, unpin } from './ipfs.js'
import { saveShare, getShare, markMinted, recentShares, pruneShares, IMAGE_DIR, PAGE_DIR, META_DIR, SHELL_DIR } from './db.js'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

function esc(s) {
  return String(s || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// Lightweight meta shell — og:meta tags crawlers (X/Telegram) need for
// unfurling, plus an iframe to the full 6.6MB baked page for real users.
// Saved to disk as a static file during bake so Cloudflare caches it as a
// static resource across all edge nodes.
function buildShell(meta, id) {
  const pageUrl = `${PUBLIC_URL || ''}/full/${id}`
  const imageUrl = meta?.image || ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(meta?.name || 'Monad Lanyard')}</title>
  <meta property="og:title" content="${esc(meta?.name || '')}"/>
  <meta property="og:description" content="${esc(meta?.description || '')}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${PUBLIC_URL || ''}/s/${id}"/>
  <meta property="og:image" content="${esc(imageUrl)}"/>
  <meta property="og:image:width" content="1080"/>
  <meta property="og:image:height" content="1350"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(meta?.name || '')}"/>
  <meta name="twitter:description" content="${esc(meta?.description || '')}"/>
  <meta name="twitter:image" content="${esc(imageUrl)}"/>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🟣</text></svg>"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0612;color:#f2eefe;font-family:system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
    .frame{width:100%;height:100%;border:none}
    .loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0612;z-index:1;transition:opacity .4s}
    .loader.done{opacity:0;pointer-events:none}
    .spinner{width:32px;height:32px;border:3px solid rgba(255,255,255,.12);border-top-color:#7c5cff;border-radius:50%;animation:spin .7s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    p{margin-top:14px;color:#a89fc9;font-size:14px}
  </style>
</head>
<body>
  <div class="loader" id="ldr">
    <div class="spinner"></div>
    <p>Loading your lanyard…</p>
  </div>
  <iframe class="frame" src="${esc(pageUrl)}" onload="document.getElementById('ldr').classList.add('done')" allow="autoplay"></iframe>
  <script>
    setTimeout(function(){ if(document.getElementById('ldr')&&!document.getElementById('ldr').classList.contains('done'))window.location.href="${esc(pageUrl)}"},5000);
  </script>
</body>
</html>`
}

const PORT = Number(process.env.PORT || 8787)
// Public base URL of THIS server (e.g. https://lanyard.foo.dev). When set,
// og:image + the share link point here instead of IPFS gateways — X unfurls
// first-party URLs far more reliably.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '')

const CONFIG = {
  contractAddress: process.env.CONTRACT_ADDRESS || null,
  chainId: Number(process.env.CHAIN_ID || 10143),
  rpcUrl: process.env.RPC_URL || 'https://testnet-rpc.monad.xyz',
  explorer: process.env.EXPLORER_URL || 'https://testnet.monadscan.com',
  name: 'Monad Lanyard',
  symbol: 'MLYD',
}

// Two gateways, because no free one does everything:
//  - HTML: only ipfs.io serves it — Pinata's shared gateway blocks HTML on
//    free plans (ERR_ID:00023). Big pages warm slowly there; the production
//    fix is PUBLIC_URL first-party hosting (/s/:id).
//  - images/metadata JSON: gateway.pinata.cloud — CORS-enabled, serves
//    reliably, and explorers fetch these client-side.
function gatewayUrl(cid) {
  const base = (process.env.PINATA_GATEWAY || 'https://ipfs.io').replace(/\/$/, '')
  return `${base}/ipfs/${cid}`
}

const METADATA_IMAGE_GATEWAY = (process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/$/, '')

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

// /api/bake renders + pins ~6.6MB to IPFS and writes to disk per call — it is
// the one endpoint that costs real money/bytes, so it gets the tightest limit.
const bakeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many bakes from this address — try again in a few minutes.' },
})
const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many uploads from this address — try again in a few minutes.' },
})
// Cheap per-handle cooldown so a rotating-IP script can't hammer one identity.
const handleCooldown = new Map()
const HANDLE_COOLDOWN_MS = 20_000

app.get('/api/config', (_req, res) => {
  res.json({ ...CONFIG, pinningEnabled })
})

// Decode a data URL into { buffer, mime }. Tolerates media-type parameters
// like `data:video/webm;codecs=vp9;base64,...` (MediaRecorder output).
function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;,]+)(?:;[^;,]+)*;base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('expected a base64 data URL')
  return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] }
}

function extFor(mime) {
  return {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/webm': '.webm',
    'video/mp4': '.mp4',
  }[mime] || ''
}

// POST /api/share — pins a recorded share-clip (webm data URL) to IPFS and
// returns a public gateway URL that gets embedded in the X intent draft.
app.post('/api/share', shareLimiter, async (req, res) => {
  const { dataUrl, handle } = req.body || {}
  if (!dataUrl) return res.status(400).json({ error: 'provide a clip dataUrl' })
  try {
    const { buffer, mime } = dataUrlToBuffer(dataUrl)
    if (buffer.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'clip too large' })
    const cid = await pinFile({
      content: buffer,
      contentType: mime || 'video/webm',
      filename: `lanyard-${(handle || 'clip').replace(/[^a-z0-9_]/gi, '')}.webm`,
    })
    const gateway = process.env.PINATA_GATEWAY || 'https://ipfs.io'
    res.json({ cid, url: `${gateway}/ipfs/${cid}`, bytes: buffer.length })
  } catch (err) {
    console.error('share pin failed:', err)
    res.status(500).json({ error: err.message || 'pin failed' })
  }
})

// Warm public-gateway caches right after pinning. Explorers like MonadVision
// fetch token data client-side via ipfs.io specifically — a cold CID there
// means 504s, which surface in browsers as CORS failures. Small files warm in
// a few tries; fire-and-forget so the bake response isn't delayed.
function warmGateway(cid) {
  if (process.env.PINATA_GATEWAY) return // dedicated gateway — warming ipfs.io is moot
  ;(async () => {
    for (let i = 0; i < 8; i++) {
      try {
        const r = await fetch(`https://ipfs.io/ipfs/${cid}`, { signal: AbortSignal.timeout(60_000) })
        if (r.ok) {
          console.log(`[warm] ${cid.slice(0, 10)}… cached on ipfs.io after ${i + 1} try(ies)`)
          return
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 3000 + i * 4000)) // widening backoff
    }
    console.log(`[warm] ${cid.slice(0, 10)}… did NOT converge — first viewer may hit a cold 504`)
  })()
}

app.post('/api/bake', bakeLimiter, async (req, res) => {
  const { username, name, pfp, front, back, shareImage } = req.body || {}

  const handle = typeof username === 'string' ? username.replace(/^@/, '').trim() : ''
  const displayName = name || (handle ? `@${handle}` : 'Monad Holder')

  // Per-handle cooldown — same identity hammering bake from rotating IPs.
  const now = Date.now()
  const last = handleCooldown.get(handle.toLowerCase()) || 0
  if (now - last < HANDLE_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Same handle was baked seconds ago — give it a moment.' })
  }
  handleCooldown.set(handle.toLowerCase(), now)

  try {
    // Normalize the two card faces to data URLs (front auto-generated from
    // username/name/pfp when not supplied; palette is client-extracted and
    // sanitized against a strict #rrggbb whitelist before use).
    const palette = normalizePalette(req.body?.palette)
    const frontUrl = front ? await toDataUrl(front) : await renderCardSvg({ pfp, username: handle, name: displayName, palette })
    const backUrl = back ? await toDataUrl(back) : null
    // The static image pinned for og:image + metadata.image should be a PNG —
    // X and most wallets can't render SVG. Clients pass a rasterized card;
    // fall back to the front face when they don't.
    const imageUrl = shareImage ? await toDataUrl(shareImage) : frontUrl
    const { buffer: imageBuffer, mime: imageMime } = dataUrlToBuffer(imageUrl)

    // Local share id — image + page are stored on this server under this id.
    const shareId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const selfImage = PUBLIC_URL ? `${PUBLIC_URL}/i/${shareId}.png` : null
    const selfPage = PUBLIC_URL ? `${PUBLIC_URL}/s/${shareId}` : null
    const selfMeta = PUBLIC_URL ? `${PUBLIC_URL}/meta/${shareId}` : null

    const title = `Monad Lanyard — ${displayName}`
    const description = handle
      ? `Interactive Monad lanyard card for @${handle}. Drag the card on-chain.`
      : 'Interactive Monad lanyard card. Drag the card on-chain.'

    // Bake the HTML (no pin yet — pin in parallel with image below).
    const baked = await bakeHtml({
      front: frontUrl,
      back: backUrl,
      meta: { title, description, image: selfImage || undefined, url: selfPage || undefined },
    })
    const ogImage = selfImage || undefined // prefer first-party for og:image

    // Pin image + HTML in parallel — sequential pins blew past Cloudflare's
    // tunnel timeout (~100s) when Pinata was slow.
    const [imageCid, htmlCid] = await Promise.all([
      pinFile({ content: imageBuffer, contentType: imageMime, filename: 'card' + extFor(imageMime) }),
      pinFile({ content: baked, contentType: 'text/html', filename: 'index.html' }),
    ])
    const imageGateway = gatewayUrl(imageCid)

    const metaJson = {
      name: title,
      description,
      image: selfImage || `${METADATA_IMAGE_GATEWAY}/ipfs/${imageCid}`,
      // First-party /s/:id when PUBLIC_URL is set — the only fully reliable
      // https host for the 6.6MB page. Otherwise ipfs:// (the ecosystem
      // standard; gateway.pinata.cloud is NOT an option here — it blocks
      // HTML on free plans).
      animation_url: selfPage || `ipfs://${htmlCid}`,
      // Computed fresh from the final htmlCid (gatewayUrl = ipfs.io — the only
      // free gateway that serves HTML).
      external_url: selfPage || gatewayUrl(htmlCid),
      background_color: '0A0612',
      attributes: [
        { trait_type: 'handle', value: handle || 'unknown' },
        { trait_type: 'display_name', value: displayName },
        { trait_type: 'chain', value: `#${CONFIG.chainId}` },
      ],
    }
    const metaCid = await pinJson(metaJson)

    // Local copy — image always; the 6.6MB page only when /s/:id is actually
    // linked (PUBLIC_URL set). Without this gate, every dev bake writes
    // 6.6MB to disk and a scripted abuser fills the volume.
    saveShare({
      id: shareId,
      handle,
      displayName,
      imageCid,
      htmlCid,
      metaCid,
      imageBuffer,
      imageExt: extFor(imageMime),
      htmlBuffer: selfPage ? Buffer.from(baked) : null,
      metaJson,
      shellBuffer: selfPage ? Buffer.from(buildShell(metaJson, shareId)) : null,
    })
    pruneShares(300)
      .forEach((cid) => unpin(cid).catch(() => {})) // free Pinata slots (fire-and-forget)
    warmGateway(metaCid)
    warmGateway(imageCid)
    warmGateway(htmlCid) // best effort — 6.6MB may not warm, hence PUBLIC_URL

    // Warm first-party URLs BEFORE returning response — X's crawler starts
    // the moment the user pastes the URL. If we return first and warm
    // async, X may hit origin cold. Awaiting guarantees Cloudflare has it.
    if (PUBLIC_URL) {
      const warmUrls = [
        `${PUBLIC_URL}/s/${shareId}`,
        selfImage, // /i/:id.png — og:image
      ].filter(Boolean)
      await Promise.allSettled(
        warmUrls.map((url) =>
          fetch(url, { signal: AbortSignal.timeout(10_000) })
            .then((r) => console.log(`[warm-edge] ${url.slice(-30)}… ${r.status}`))
        )
      )
    }

    // tokenURI as an always-fetchable HTTPS URL: explorers like MonadVision
    // fetch metadata client-side from the browser, where ipfs.io 504s arrive
    // as CORS failures and Brave shields block the domain entirely. Pinata's
    // gateway serves CORS + the content from origin. First-party /meta/:id
    // wins when PUBLIC_URL is set.
    const tokenURIValue = selfMeta
      ? `${PUBLIC_URL}/meta/${shareId}`
      : pinningEnabled
        ? `${METADATA_IMAGE_GATEWAY}/ipfs/${metaCid}`
        : `ipfs://${metaCid}`

    res.json({
      tokenURI: tokenURIValue,
      animationUrl: `ipfs://${htmlCid}`,
      animationGateway: gatewayUrl(htmlCid),
      image: `ipfs://${imageCid}`,
      imageGateway,
      shareId,
      // First-party URLs when PUBLIC_URL is set — best unfurl + zero IPFS
      // dependency for the share flow.
      shareUrl: selfPage || gatewayUrl(htmlCid),
      imageUrl: selfImage || imageGateway,
      htmlBytes: Buffer.byteLength(baked),
      handle,
      displayName,
    })
  } catch (err) {
    console.error('bake failed:', err)
    res.status(500).json({ error: err.message || 'bake failed' })
  }
})

// Mark a share as minted — prune never touches a live token's pins/files.
app.post('/api/minted', bakeLimiter, (req, res) => {
  const { shareId } = req.body || {}
  if (!shareId || !getShare(shareId)) return res.status(404).json({ error: 'share not found' })
  markMinted(shareId)
  res.json({ ok: true })
})

// Stored token metadata — first-party, CORS-open, so explorers that fetch
// tokenURI client-side (MonadVision) always succeed.
app.get('/meta/:id', (req, res) => {
  const row = getShare(req.params.id)
  if (!row?.meta_file) return res.status(404).json({ error: 'share not found' })
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Cache-Control', 'public, max-age=3600')
  res.sendFile(path.join(META_DIR, row.meta_file))
})

// Stored share image — served first-party so og:image unfurls reliably.
app.get('/i/:id.:ext(png|jpg|jpeg|webp|svg)', (req, res) => {
  const row = getShare(req.params.id)
  if (!row?.image_file) return res.status(404).json({ error: 'share not found' })
  const ext = req.params.ext.toLowerCase()
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }
  res.set('Content-Type', types[ext] || 'application/octet-stream')
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(path.join(IMAGE_DIR, row.image_file))
})

// Stored interactive page — serve a lightweight meta shell (<5KB) that has
// all the og:meta tags X/Telegram need for unfurling, plus an iframe that
// loads the full 6.6MB baked page. Crawlers see the meta tags instantly;
// real users get the full interactive experience.
app.get('/s/:id', (req, res) => {
  const row = getShare(req.params.id)
  if (!row) return res.status(404).json({ error: 'share not found' })

  // If no meta JSON, serve the raw page (legacy shares).
  if (!row.meta_file) {
    if (!row.page_file) return res.status(404).json({ error: 'share not found' })
    res.set('Cache-Control', 'public, max-age=3600')
    return res.sendFile(path.join(PAGE_DIR, row.page_file))
  }

  // Static pre-generated shell — served as a file so Cloudflare caches it
  // as a static resource on every edge (reliable, first-hit unfurl).
  const shellFile = path.join(SHELL_DIR, `${req.params.id}.html`)
  if (existsSync(shellFile)) {
    res.set('Content-Type', 'text/html; charset=utf-8')
    // Cache aggressively — the shell is immutable per share ID.
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable')
    return res.sendFile(shellFile)
  }

  // Fallback: dynamically regenerate the shell for legacy shares that were
  // baked before shells were saved to disk.
  const meta = JSON.parse(readFileSync(path.join(META_DIR, row.meta_file), 'utf8'))
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable')
  res.send(buildShell(meta, req.params.id))
})

// Full baked page — served under /full/:id so crawlers at /s/:id get the
// lightweight meta shell instead of the 6.6MB payload.
app.get('/full/:id', (req, res) => {
  const row = getShare(req.params.id)
  if (!row?.page_file) return res.status(404).json({ error: 'share not found' })
  res.set('Cache-Control', 'no-store, must-revalidate')
  res.sendFile(path.join(PAGE_DIR, row.page_file))
})

// Recent shares — ready for a gallery wall on the frontend.
app.get('/api/wall', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50)
  res.json({ shares: recentShares(limit).map((s) => ({ ...s, imageUrl: `/i/${s.id}.png`, pageUrl: `/s/${s.id}` })) })
})

// Serve the built mint DApp so one domain hosts everything — the frontend,
// /api, /i, /s, /meta. Requires `npm run build` in mint/. API/storage routes
// above are matched first; anything else falls through to the DApp shell.
const MINT_DIST = path.join(ROOT, '..', 'mint', 'dist')
if (existsSync(MINT_DIST)) {
  // Assets are content-hashed (immutable), but index.html must always be
  // fresh — otherwise returning visitors see a stale shell after deploys.
  app.use(
    express.static(MINT_DIST, {
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(MINT_DIST, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => res.json({ service: 'lanyard bake server', api: '/api/config' }))
}

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'internal error' })
})

app.listen(PORT, () => {
  console.log(`lanyard bake server on :${PORT}`)
  console.log(`pinning: ${pinningEnabled ? 'Pinata (PINATA_JWT set)' : 'DRY RUN (fake CIDs)'}`)
  if (!CONFIG.contractAddress) console.log('CONTRACT_ADDRESS not set — config will return null contract')
})
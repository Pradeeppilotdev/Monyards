// server/index.js — bake + pin API for the Lanyard mint frontend.
//
// Endpoints:
//   GET  /api/config   Chain + contract config for the frontend (env-driven).
//   POST /api/bake     { username?, name?, pfp?, front?, back? } → bakes the
//                      per-mint HTML, pins it + the card image + metadata to
//                      IPFS, returns tokenURI/animationUrl/image.
//
// The mint transaction itself is sent by the user's wallet (frontend) — this
// server never holds keys and only does off-chain baking + pinning.

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { renderCardSvg, toDataUrl, mimeFromName, normalizePalette } from '../shared/card-svg.js'
import { bakeHtml } from '../animation/bake.mjs'
import { pinFile, pinJson, pinningEnabled } from './ipfs.js'

const PORT = Number(process.env.PORT || 8787)

const CONFIG = {
  contractAddress: process.env.CONTRACT_ADDRESS || null,
  chainId: Number(process.env.CHAIN_ID || 10143),
  rpcUrl: process.env.RPC_URL || 'https://testnet-rpc.monad.xyz',
  explorer: process.env.EXPLORER_URL || 'https://testnet.monadscan.com',
  name: 'Monad Lanyard',
  symbol: 'MLYD',
}

function gatewayUrl(cid) {
  const base = (process.env.PINATA_GATEWAY || 'https://ipfs.io').replace(/\/$/, '')
  return `${base}/ipfs/${cid}`
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

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
app.post('/api/share', async (req, res) => {
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

app.post('/api/bake', async (req, res) => {
  const { username, name, pfp, front, back, shareImage } = req.body || {}

  const handle = typeof username === 'string' ? username.replace(/^@/, '').trim() : ''
  const displayName = name || (handle ? `@${handle}` : 'Monad Holder')

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

    // Pin image first so its gateway URL can be embedded as og:image in the HTML.
    const { buffer: imageBuffer, mime: imageMime } = dataUrlToBuffer(imageUrl)
    const imageCid = await pinFile({ content: imageBuffer, contentType: imageMime, filename: 'card' + extFor(imageMime) })
    const imageGateway = gatewayUrl(imageCid)

    const title = `Monad Lanyard — ${displayName}`
    const description = handle
      ? `Interactive Monad lanyard card for @${handle}. Drag the card on-chain.`
      : 'Interactive Monad lanyard card. Drag the card on-chain.'

    // Bake HTML with OG/Twitter meta so the IPFS gateway link unfurls with the card image on X.
    let baked = await bakeHtml({
      front: frontUrl,
      back: backUrl,
      meta: { title, description, image: imageGateway },
    })
    // Patch og:url once we know the HTML CID — two-phase: placeholder then replace.
    // First pin to get CID, then re-bake with final URL if we want self-referential og:url.
    let htmlCid = await pinFile({ content: baked, contentType: 'text/html', filename: 'index.html' })
    const htmlGateway = gatewayUrl(htmlCid)
    // Re-bake with final og:url for perfect unfurl (re-pin if changed)
    const bakedWithUrl = await bakeHtml({
      front: frontUrl,
      back: backUrl,
      meta: { title, description, image: imageGateway, url: htmlGateway },
    })
    if (bakedWithUrl !== baked) {
      htmlCid = await pinFile({ content: bakedWithUrl, contentType: 'text/html', filename: 'index.html' })
      baked = bakedWithUrl
    }

    const metaCid = await pinJson({
      name: title,
      description,
      image: `ipfs://${imageCid}`,
      animation_url: `ipfs://${htmlCid}`,
      attributes: [{ trait_type: 'handle', value: handle || 'unknown' }],
    })

    res.json({
      tokenURI: `ipfs://${metaCid}`,
      animationUrl: `ipfs://${htmlCid}`,
      animationGateway: gatewayUrl(htmlCid),
      image: `ipfs://${imageCid}`,
      imageGateway,
      htmlBytes: Buffer.byteLength(baked),
      handle,
      displayName,
    })
  } catch (err) {
    console.error('bake failed:', err)
    res.status(500).json({ error: err.message || 'bake failed' })
  }
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'internal error' })
})

app.listen(PORT, () => {
  console.log(`lanyard bake server on :${PORT}`)
  console.log(`pinning: ${pinningEnabled ? 'Pinata (PINATA_JWT set)' : 'DRY RUN (fake CIDs)'}`)
  if (!CONFIG.contractAddress) console.log('CONTRACT_ADDRESS not set — config will return null contract')
})
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
import { renderCardSvg, toDataUrl, mimeFromName } from '../shared/card-svg.js'
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

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/config', (_req, res) => {
  res.json({ ...CONFIG, pinningEnabled })
})

// Decode a data URL into { buffer, mime }.
function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('expected a base64 data URL')
  return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] }
}

function extFor(mime) {
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' }[mime] || ''
}

app.post('/api/bake', async (req, res) => {
  const { username, name, pfp, front, back } = req.body || {}

  if (!username && !name && !front) {
    return res.status(400).json({ error: 'provide username, name or a front image' })
  }

  const handle = typeof username === 'string' ? username.replace(/^@/, '').trim() : ''
  const displayName = name || (handle ? `@${handle}` : 'Monad Holder')

  try {
    // Normalize the two card faces to data URLs (front auto-generated from
    // username/name/pfp when not supplied).
    const frontUrl = front ? await toDataUrl(front) : await renderCardSvg({ pfp, username: handle, name: displayName })
    const backUrl = back ? await toDataUrl(back) : null

    const baked = await bakeHtml({ front: frontUrl, back: backUrl })

    // Pin the two files first, then the metadata (it references their CIDs).
    const { buffer: imageBuffer, mime: imageMime } = dataUrlToBuffer(frontUrl)
    const [htmlCid, imageCid] = await Promise.all([
      pinFile({ content: baked, contentType: 'text/html', filename: 'index.html' }),
      pinFile({ content: imageBuffer, contentType: imageMime, filename: 'card' + extFor(imageMime) }),
    ])
    const metaCid = await pinJson({
      name: `Monad Lanyard — ${displayName}`,
      description:
        handle
          ? `Interactive Monad lanyard card for @${handle}. Drag the card on-chain.`
          : 'Interactive Monad lanyard card. Drag the card on-chain.',
      image: `ipfs://${imageCid}`,
      animation_url: `ipfs://${htmlCid}`,
      attributes: [{ trait_type: 'handle', value: handle || 'unknown' }],
    })

    res.json({
      tokenURI: `ipfs://${metaCid}`,
      animationUrl: `ipfs://${htmlCid}`,
      image: `ipfs://${imageCid}`,
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
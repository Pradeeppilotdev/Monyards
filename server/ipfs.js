// server/ipfs.js — minimal IPFS pinning.
//
// With PINATA_JWT set, files are pinned through Pinata's public API. Without
// it (local dev), pinFiles falls back to deterministic fake CIDs so the whole
// bake flow can be exercised without external credentials — the returned URIs
// just aren't resolvable. Enable real pinning by setting PINATA_JWT.

import { createHash } from 'node:crypto'

const PINATA_API = 'https://api.pinata.cloud'
const JWT = process.env.PINATA_JWT

export const pinningEnabled = Boolean(JWT)

// Pins a single file (Buffer or string) and returns its CID.
// contentType is used for the multipart filename; Pinata keys off the file.
export async function pinFile({ content, contentType = 'application/octet-stream', filename }) {
  if (!JWT) return dryRunCid(content)
  const body = new FormData()
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: contentType })
      : new Blob([new Uint8Array(content)], { type: contentType })
  body.append('file', blob, filename)
  const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JWT}` },
    body,
  })
  if (!res.ok) throw new Error(`pinFileToIPFS failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.IpfsHash
}

// Pins a JSON object (metadata.json) and returns its CID.
export async function pinJson(json) {
  if (!JWT) return dryRunCid(JSON.stringify(json))
  const res = await fetch(`${PINATA_API}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  })
  if (!res.ok) throw new Error(`pinJSONToIPFS failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.IpfsHash
}

// Removes a pin — frees a slot from the free-tier cap. Only call for content
// no live token points at.
export async function unpin(cid) {
  if (!JWT) return
  const res = await fetch(`${PINATA_API}/pinning/unpin/${cid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${JWT}` },
  })
  // 404 = already gone, fine. Anything else non-ok: log and move on.
  if (!res.ok && res.status !== 404) {
    console.error(`unpin ${cid.slice(0, 10)}… failed: ${res.status}`)
  }
}

// Content-addressed fake CID: same input always maps to the same CID, which is
// good enough to exercise the full mint flow before real pinning is configured.
function dryRunCid(content) {
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 56)
  return `bafy${digest}`
}
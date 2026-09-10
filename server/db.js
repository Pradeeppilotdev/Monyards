// server/db.js — local share store. Every bake gets a row plus its image and
// baked page on disk, so shares work with zero IPFS config and the og:image
// can be served from this server's own domain (X unfurls that reliably).
// Zero-dep: uses the node:sqlite built into Node 22+.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(ROOT, 'data')
export const IMAGE_DIR = path.join(DATA_DIR, 'images')
export const PAGE_DIR = path.join(DATA_DIR, 'pages')
export const META_DIR = path.join(DATA_DIR, 'meta')
export const SHELL_DIR = path.join(DATA_DIR, 'shells')
mkdirSync(IMAGE_DIR, { recursive: true })
mkdirSync(PAGE_DIR, { recursive: true })
mkdirSync(META_DIR, { recursive: true })
mkdirSync(SHELL_DIR, { recursive: true })

const db = new DatabaseSync(path.join(DATA_DIR, 'lanyard.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id           TEXT PRIMARY KEY,
    handle       TEXT,
    display_name TEXT,
    image_file   TEXT,
    page_file    TEXT,
    meta_file    TEXT,
    gif_file     TEXT,
    image_cid    TEXT,
    html_cid     TEXT,
    meta_cid     TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  )
`)
// Older installs predate meta_file — add it in place.
try {
  db.exec('ALTER TABLE shares ADD COLUMN meta_file TEXT')
} catch {}
try {
  db.exec('ALTER TABLE shares ADD COLUMN minted INTEGER DEFAULT 0')
} catch {}
try {
  db.exec('ALTER TABLE shares ADD COLUMN gif_file TEXT')
} catch {}
// Referral attribution — which local share minted into which token, and which
// token referred this bake in. Additive ALTERs, matching the pattern above.
try {
  db.exec('ALTER TABLE shares ADD COLUMN token_id INTEGER')
} catch {}
try {
  db.exec('ALTER TABLE shares ADD COLUMN ref_token_id INTEGER')
} catch {}

const insert = db.prepare(`
  INSERT INTO shares (id, handle, display_name, image_file, page_file, meta_file, gif_file, image_cid, html_cid, meta_cid, ref_token_id)
  VALUES (@id, @handle, @displayName, @imageFile, @pageFile, @metaFile, @gifFile, @imageCid, @htmlCid, @metaCid, @refTokenId)
`)

export function saveShare({ id, handle, displayName, imageCid, htmlCid, metaCid, imageBuffer, imageExt, gifBuffer, htmlBuffer, metaJson, shellBuffer, refTokenId }) {
  const imageFile = imageBuffer ? `${id}${imageExt}` : null
  const gifFile = gifBuffer ? `${id}.gif` : null
  const pageFile = htmlBuffer ? `${id}.html` : null
  const metaFile = metaJson ? `${id}.json` : null
  const shellFile = shellBuffer ? `${id}.html` : null
  if (imageBuffer) writeFileSync(path.join(IMAGE_DIR, imageFile), imageBuffer)
  if (gifBuffer) writeFileSync(path.join(IMAGE_DIR, gifFile), gifBuffer)
  if (htmlBuffer) writeFileSync(path.join(PAGE_DIR, pageFile), htmlBuffer)
  if (metaJson) writeFileSync(path.join(DATA_DIR, 'meta', metaFile), JSON.stringify(metaJson))
  if (shellBuffer) writeFileSync(path.join(SHELL_DIR, shellFile), shellBuffer)
  insert.run({
    id,
    handle: handle || null,
    displayName: displayName || null,
    imageFile,
    gifFile,
    pageFile,
    metaFile,
    imageCid: imageCid || null,
    htmlCid: htmlCid || null,
    metaCid: metaCid || null,
    refTokenId: refTokenId != null ? Number(refTokenId) : null,
  })
  return id
}

export function getShare(id) {
  return db.prepare('SELECT * FROM shares WHERE id = ?').get(String(id)) || null
}

export function markMinted(id, tokenId) {
  db.prepare(tokenId != null ? 'UPDATE shares SET minted = 1, token_id = ? WHERE id = ?' : 'UPDATE shares SET minted = 1 WHERE id = ?').run(tokenId, String(id))
}

// A token's local share — the referrer mapping frontend needs: tokenId -> handle.
export function shareByToken(tokenId) {
  return db.prepare('SELECT * FROM shares WHERE token_id = ? AND minted = 1 LIMIT 1').get(Number(tokenId)) || null
}

// Handle dedup — one card per handle. A handle with a live minted token
// prefers that share (the on-chain card) so re-stages keep pointing at the
// minted card; otherwise the first-ever bake of the handle owns the name.
// Case-insensitive match; @ stripped upstream.
export function shareByHandle(handle) {
  if (!handle) return null
  // Handles exempt from dedup — always bake a fresh card/link instead of
  // reusing the existing one for this handle.
  const NO_DEDUP_HANDLES = ['pradeeppilot2k5']
  if (NO_DEDUP_HANDLES.includes(String(handle).toLowerCase())) return null
  const rows = db
    .prepare('SELECT * FROM shares WHERE lower(handle) = lower(?) ORDER BY created_at DESC, id DESC')
    .all(String(handle))
  // A handle with a minted token resolves to its most recent mint (the live
  // on-chain card); otherwise the first-ever bake owns the name.
  return rows.find((r) => r.minted === 1) || rows[rows.length - 1] || null
}

export function recentShares(limit = 12) {
  return db
    .prepare("SELECT id, handle, display_name AS displayName, image_file AS imageFile, minted, created_at AS createdAt FROM shares ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(Math.min(Math.max(Number(limit) || 12, 1), 50))
}

// Bound disk + Pinata growth: evicted UNMINTED shares get their files and
// rows removed, and their CIDs returned so the caller can unpin them.
// Minted shares are live tokens — pins and files stay no matter what.
// Age gate: a mint happens seconds after its bake, so anything unminted for
// a full day is genuinely abandoned. Protects against a failed /api/minted
// call getting a live token's pins unpinned.
export function pruneShares(keep = 300) {
  const evicted = db
    .prepare(`
      SELECT id, image_cid AS imageCid, html_cid AS htmlCid, meta_cid AS metaCid,
             image_file AS imageFile, page_file AS pageFile, meta_file AS metaFile, gif_file AS gifFile
      FROM shares
      WHERE minted = 0 AND created_at < datetime('now', '-1 day')
      ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`)
    .all(keep)
  const removeFile = (dir, file) => {
    if (!file) return
    try {
      unlinkSync(path.join(dir, file))
    } catch {}
  }
  for (const row of evicted) {
    removeFile(IMAGE_DIR, row.imageFile)
    removeFile(IMAGE_DIR, row.gifFile)
    removeFile(PAGE_DIR, row.pageFile)
    removeFile(META_DIR, row.metaFile)
    removeFile(SHELL_DIR, typeof row.pageFile === 'string' ? row.pageFile.replace(/\.html$/, '') + '.html' : null)
    db.prepare('DELETE FROM shares WHERE id = ?').run(row.id)
  }
  // Dedup — identical bakes reuse CIDs (content addressing).
  return [...new Set(evicted.flatMap((r) => [r.imageCid, r.htmlCid, r.metaCid]).filter(Boolean))]
}

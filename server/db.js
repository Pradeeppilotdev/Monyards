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
mkdirSync(IMAGE_DIR, { recursive: true })
mkdirSync(PAGE_DIR, { recursive: true })
mkdirSync(META_DIR, { recursive: true })

const db = new DatabaseSync(path.join(DATA_DIR, 'lanyard.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id           TEXT PRIMARY KEY,
    handle       TEXT,
    display_name TEXT,
    image_file   TEXT,
    page_file    TEXT,
    meta_file    TEXT,
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

const insert = db.prepare(`
  INSERT INTO shares (id, handle, display_name, image_file, page_file, meta_file, image_cid, html_cid, meta_cid)
  VALUES (@id, @handle, @displayName, @imageFile, @pageFile, @metaFile, @imageCid, @htmlCid, @metaCid)
`)

export function saveShare({ id, handle, displayName, imageCid, htmlCid, metaCid, imageBuffer, imageExt, htmlBuffer, metaJson }) {
  const imageFile = imageBuffer ? `${id}${imageExt}` : null
  const pageFile = htmlBuffer ? `${id}.html` : null
  const metaFile = metaJson ? `${id}.json` : null
  if (imageBuffer) writeFileSync(path.join(IMAGE_DIR, imageFile), imageBuffer)
  if (htmlBuffer) writeFileSync(path.join(PAGE_DIR, pageFile), htmlBuffer)
  if (metaJson) writeFileSync(path.join(DATA_DIR, 'meta', metaFile), JSON.stringify(metaJson))
  insert.run({
    id,
    handle: handle || null,
    displayName: displayName || null,
    imageFile,
    pageFile,
    metaFile,
    imageCid: imageCid || null,
    htmlCid: htmlCid || null,
    metaCid: metaCid || null,
  })
  return id
}

export function getShare(id) {
  return db.prepare('SELECT * FROM shares WHERE id = ?').get(String(id)) || null
}

export function recentShares(limit = 12) {
  return db
    .prepare('SELECT id, handle, display_name AS displayName, image_file AS imageFile, created_at AS createdAt FROM shares ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 12, 1), 50))
}

// Bound disk growth: keep only the newest `keep` shares and delete the
// orphaned image/page files of everything older. Cheap enough to run per bake.
export function pruneShares(keep = 300) {
  const stale = db
    .prepare('SELECT id, image_file AS imageFile, page_file AS pageFile FROM shares ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?')
    .all(keep)
  if (!stale.length) return
  const removeFile = (dir, file) => {
    if (!file) return
    try {
      unlinkSync(path.join(dir, file))
    } catch {}
  }
  for (const row of stale) {
    removeFile(IMAGE_DIR, row.imageFile)
    removeFile(PAGE_DIR, row.pageFile)
    removeFile(META_DIR, row.metaFile ? `${row.id}.json` : null)
    db.prepare('DELETE FROM shares WHERE id = ?').run(row.id)
  }
}

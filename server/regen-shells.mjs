// server/regen-shells.mjs — rebuild stored meta + shell files after template
// or naming changes (e.g. the "·" separator + shared favicon rollout).
// Reads every share row, re-derives meta.name from its display_name/handle,
// rewrites meta JSON + shell file. Reversible via the .bak meta files.
// Run: `node regen-shells.mjs` from server/ with PUBLIC_URL in env.
import 'dotenv/config'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShell } from './shell.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(ROOT, 'data')
const META_DIR = join(DATA_DIR, 'meta')
const SHELL_DIR = join(DATA_DIR, 'shells')
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '')

function shareName(row) {
  const display = row.display_name || (row.handle ? `@${row.handle}` : 'Monad Holder')
  return `Monad Lanyard · ${display}`
}

const db = new DatabaseSync(join(DATA_DIR, 'lanyard.db'))
const rows = db.prepare('SELECT id, handle, display_name, meta_file FROM shares').all()

let updated = 0
let shelled = 0
for (const row of rows) {
  if (!row.meta_file) continue
  const metaPath = join(META_DIR, row.meta_file)
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const newName = shareName({ handle: row.handle, display_name: row.display_name })
  if (meta.name !== newName) {
    writeFileSync(metaPath + '.bak', JSON.stringify(meta, null, 2))
    meta.name = newName
    writeFileSync(metaPath, JSON.stringify(meta))
    updated++
  }
  const shellPath = join(SHELL_DIR, `${row.id}.html`)
  writeFileSync(shellPath, buildShell(PUBLIC_URL, meta, row.id))
  shelled++
}

console.log(`shares: ${rows.length}, meta updated: ${updated}, shells rebuilt: ${shelled}`)
#!/usr/bin/env node
// bake.mjs — turns the built, self-contained dist/index.html into a per-mint
// HTML file by swapping the `__LANYARD_FRONT_IMG__` / `__LANYARD_BACK_IMG__`
// placeholder tokens for real card images (data URLs).
//
// Usage:
//   node bake.mjs --front ./card-front.png --back ./card-back.png --out out/0.html
//   node bake.mjs --username vitalik --name "Vitalik" --pfp https://unavatar.io/x/vitalik --out out/0.html
//   node bake.mjs --card-json ./card.json --out out/0.html
//
// The mint frontend is expected to call this (or replicate it) with a card
// JSON of the shape { front: "<data URL>", back: "<data URL>" } so the exact
// same card the user previewed gets baked into the minted HTML.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { renderCardSvg, toDataUrl } from '../shared/card-svg.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(ROOT, 'dist', 'index.html')
export const FRONT_TOKEN = '__LANYARD_FRONT_IMG__'
export const BACK_TOKEN = '__LANYARD_BACK_IMG__'

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  await main()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`bake.mjs — bake card images into the built Lanyard HTML

Options:
  --front <path|url|dataURL>   Front card image
  --back   <path|url|dataURL>  Back card image
  --pfp    <path|url|dataURL>  Profile picture (used with --username/--name)
  --username <string>          X handle, e.g. "vitalik"
  --name   <string>            Display name
  --card-json <path>           JSON file { front, back } of card data URLs
  --out    <path>              Output file (default: out/token.html)
  --help                       Show this help

Any image may be a local path, an http(s) URL, or a data URL.`)
  process.exit(0)
}

if (!args['out']) args['out'] = path.join(ROOT, 'out', 'token.html')

let front = args['front'] ?? null
let back = args['back'] ?? null

if (args['card-json']) {
  const card = JSON.parse(await readFile(args['card-json'], 'utf8'))
  front = card.front ?? front
  back = card.back ?? back
}

if ((args['username'] || args['name']) && !front) {
  front = await renderCardSvg({ pfp: args['pfp'], username: args['username'], name: args['name'] })
}

front = front ? await toDataUrl(front) : null
back = back ? await toDataUrl(back) : null

const baked = await bakeHtml({ front, back })

await writeFile(args['out'], baked)
console.log(`baked -> ${args['out']} (${(Buffer.byteLength(baked) / 1024).toFixed(0)} kB)`)
if (baked.includes(FRONT_TOKEN)) console.log('  note: front token left unreplaced')
if (baked.includes(BACK_TOKEN)) console.log('  note: back token left unreplaced')
}

// Shared bake core — also used by the server. Returns the baked HTML string.
// An unreplaced token is left in place: the page renders its built-in card
// texture when a token is present, so an un-baked file is still viewable.
export async function bakeHtml({ front, back, meta }) {
  const html = await readFile(TEMPLATE, 'utf8')
  let baked = html
  if (front) baked = baked.replaceAll(FRONT_TOKEN, () => front)
  if (back) baked = baked.replaceAll(BACK_TOKEN, () => back)
  if (meta) {
    const escAttr = (s) =>
      String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const tags = [
      meta.title ? `<meta property="og:title" content="${escAttr(meta.title)}" />` : '',
      meta.description ? `<meta property="og:description" content="${escAttr(meta.description)}" />` : '',
      meta.url ? `<meta property="og:url" content="${escAttr(meta.url)}" />` : '',
      meta.url ? `<meta property="og:type" content="website" />` : '',
      meta.image ? `<meta property="og:image" content="${escAttr(meta.image)}" />` : '',
      meta.image ? `<meta property="og:image:width" content="1080" />` : '',
      meta.image ? `<meta property="og:image:height" content="1350" />` : '',
      meta.image ? `<meta name="twitter:card" content="summary_large_image" />` : '',
      meta.image ? `<meta name="twitter:title" content="${escAttr(meta.title || '')}" />` : '',
      meta.image ? `<meta name="twitter:description" content="${escAttr(meta.description || '')}" />` : '',
      meta.image ? `<meta name="twitter:image" content="${escAttr(meta.image)}" />` : '',
    ]
      .filter(Boolean)
      .join('\n    ')
    if (tags) baked = baked.replace('</title>', `</title>\n    ${tags}`)
  }
  return baked
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (key === 'help') out.help = true
      else out[key] = argv[++i]
    }
  }
  return out
}
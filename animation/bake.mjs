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
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(ROOT, 'dist', 'index.html')
const FRONT_TOKEN = '__LANYARD_FRONT_IMG__'
const BACK_TOKEN = '__LANYARD_BACK_IMG__'
const CARD_W = 600
const CARD_H = 906

// Official Monad logomark path (circle + stylized M), 32x32 viewBox.
const MONAD_MARK =
  'M15.9999 0C11.3795 0 0 11.3792 0 15.9999C0 20.6206 11.3795 32 15.9999 32C20.6203 32 32 20.6204 32 15.9999C32 11.3794 20.6205 0 15.9999 0ZM13.5066 25.1492C11.5582 24.6183 6.31981 15.455 6.85083 13.5066C7.38185 11.5581 16.545 6.31979 18.4933 6.8508C20.4418 7.38173 25.6802 16.5449 25.1492 18.4934C24.6182 20.4418 15.455 25.6802 13.5066 25.1492Z'

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

const html = await readFile(TEMPLATE, 'utf8')

let baked = html
if (front) baked = baked.replaceAll(FRONT_TOKEN, () => front)
if (back) baked = baked.replaceAll(BACK_TOKEN, () => back)

// Leave any unreplaced tokens in place — the page renders its built-in card
// texture when a token is present, so an un-baked file is still viewable.

await writeFile(args['out'], baked)
console.log(`baked -> ${args['out']} (${(Buffer.byteLength(baked) / 1024).toFixed(0)} kB)`)
if (baked.includes(FRONT_TOKEN)) console.log('  note: front token left unreplaced')
if (baked.includes(BACK_TOKEN)) console.log('  note: back token left unreplaced')

async function toDataUrl(input) {
  if (input.startsWith('data:')) return input
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input)
    if (!res.ok) throw new Error(`failed to fetch ${input}: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type')?.split(';')[0] || mimeFromName(input)
    return `data:${mime};base64,${buf.toString('base64')}`
  }
  const buf = await readFile(input)
  return `data:${mimeFromName(input)};base64,${buf.toString('base64')}`
}

function mimeFromName(name) {
  const ext = path.extname(name).toLowerCase()
  return (
    { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[
      ext
    ] || 'application/octet-stream'
  )
}

// Renders the front card as a self-contained SVG data URL (PFP embedded as
// base64). No canvas / native deps needed — the browser rasterizes the SVG when
// it loads it as a WebGL texture. Aspect ratio matches the card face (~2:3).
// Layout is tuned for legibility at card render size: high-contrast text with a
// drop shadow, large PFP, and a Monad mark at the top.
async function renderCardSvg({ pfp, username, name }) {
  const displayName = name || (username ? `@${username}` : 'Monad Holder')
  const handle = username ? `@${username}` : ''
  let pfpData = ''
  if (pfp) {
    try {
      pfpData = await toDataUrl(pfp)
    } catch {
      pfpData = ''
    }
  }
  const pfpBlock = pfpData
    ? `<circle cx="300" cy="320" r="164" fill="#0a0a14" stroke="#ffffff" stroke-opacity="0.4" stroke-width="6"/>
       <image href="${pfpData}" x="150" y="170" width="300" height="300" clip-path="url(#pfpClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="300" cy="320" r="164" fill="#0a0a14" stroke="#ffffff" stroke-opacity="0.4" stroke-width="6"/>
       <circle cx="300" cy="320" r="150" fill="#6e54ff"/>
       <text x="300" y="356" text-anchor="middle" font-size="104" font-family="sans-serif" font-weight="800" fill="#ffffff">M</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0e091c"/>
      <stop offset="0.5" stop-color="#3b2280"/>
      <stop offset="1" stop-color="#6e54ff"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#c4b5fd" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#c4b5fd" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="pfpClip"><circle cx="300" cy="320" r="150"/></clipPath>
    <filter id="textShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#000000" flood-opacity="0.65"/>
    </filter>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" rx="44" fill="url(#bg)"/>
  <rect width="${CARD_W}" height="${CARD_H}" rx="44" fill="url(#halo)"/>
  <circle cx="300" cy="180" r="230" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>
  <circle cx="300" cy="650" r="330" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.5"/>
  <g transform="translate(300 120) scale(1.9) translate(-16 -16)" fill="#ffffff" fill-opacity="0.55">
    <path d="${MONAD_MARK}"/>
  </g>
  <g filter="url(#textShadow)">
    ${pfpBlock}
  </g>
  <text x="300" y="590" text-anchor="middle" font-size="58" font-family="sans-serif" font-weight="800" fill="#ffffff" filter="url(#textShadow)">${esc(displayName)}</text>
  ${handle ? `<text x="300" y="652" text-anchor="middle" font-size="36" font-family="sans-serif" font-weight="600" fill="#ddd7fe" filter="url(#textShadow)">${esc(handle)}</text>` : ''}
  <rect x="176" y="706" width="248" height="58" rx="29" fill="#ffffff" fill-opacity="0.16"/>
  <text x="300" y="744" text-anchor="middle" font-size="26" font-family="sans-serif" font-weight="800" fill="#ffffff" letter-spacing="4">MONAD LYRD</text>
  <rect width="${CARD_W}" height="24" rx="12" fill="url(#sheen)"/>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function esc(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
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
// shared/card-svg.js — framework-free ESM used by the bake CLI, the bake
// server and the mint frontend (Node >= 18 and modern browsers). Everything
// here is pure string manipulation; the browser rasterizes the SVG when it
// loads it as a WebGL texture, so no canvas/native deps are needed anywhere.

import { NAME_FONT_B64 } from './name-font.js'

export const CARD_W = 600;
export const CARD_H = 906;

// Official Monad logomark path (circle + stylized M), 32x32 viewBox.
export const MONAD_MARK =
  'M15.9999 0C11.3795 0 0 11.3792 0 15.9999C0 20.6206 11.3795 32 15.9999 32C20.6203 32 32 20.6204 32 15.9999C32 11.3794 20.6205 0 15.9999 0ZM13.5066 25.1492C11.5582 24.6183 6.31981 15.455 6.85083 13.5066C7.38185 11.5581 16.545 6.31979 18.4933 6.8508C20.4418 7.38173 25.6802 16.5449 25.1492 18.4934C24.6182 20.4418 15.455 25.6802 13.5066 25.1492Z';

// Deterministic 4-digit serial from the handle/name so every card feels
// individually numbered (pure string hash, stable across server+browser).
function serialFor(str) {
  let h = 5381
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return String(h % 10000).padStart(4, '0')
}

// Default palette (near-black print violet). Overridden per-mint when a
// palette is extracted from the PFP, so each card carries its color DNA.
const DEFAULT_PALETTE = {
  bgTop: '#08060F',
  bgMid: '#14102F',
  bgBottom: '#2C1A62',
  accent: '#836EF9',
}

function clampHex(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null
}

export function normalizePalette(p) {
  const out = { ...DEFAULT_PALETTE }
  if (p && typeof p === 'object') {
    for (const k of Object.keys(DEFAULT_PALETTE)) {
      const v = clampHex(p[k])
      if (v) out[k] = v
    }
  }
  return out
}

// --- color helpers ---------------------------------------------------------

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

function mixHex(a, b, t) {
  const ca = hexToRgb01(a), cb = hexToRgb01(b)
  return '#' + ca.map((v, i) => Math.round((v + (cb[i] - v) * t) * 255).toString(16).padStart(2, '0')).join('')
}

// --- renders ---------------------------------------------------------------

// Renders the front card as a self-contained SVG data URL (PFP embedded as
// base64 when provided). Aspect ratio matches the card face (~2:3).
//
// Design language: Monad Blitz event-badge energy — near-black print stock,
// one giant stencil-cut wordmark, the PFP re-printed in duotone with a
// misregistered ink ring, and the holder's name marker-written on a white
// paper strip like a real conference lanyard. Per-mint palette is derived
// from the portrait so no two cards share the same ink.
export async function renderCardSvg({ pfp, username, name, palette }) {
  const displayName = name || (username ? `@${username}` : 'Monad Holder')
  const handle = username && name ? `@${username}` : ''
  const pal = normalizePalette(palette)
  const serial = serialFor(username || name || 'monad')
  let pfpData = ''
  if (pfp) {
    try {
      pfpData = await toDataUrl(pfp);
    } catch {
      pfpData = '';
    }
  }

  // Unicode-safe base64 (names/handles may contain emoji or CJK).
  const b64 = (str) => bytesToBase64(new TextEncoder().encode(str))

  // Portrait photos stay in their ORIGINAL colors — no duotone layer. The
  // purple-blended card around them provides the brand; the face provides
  // the life. These inks are only used for the no-PFP fallback tile.
  const inkDark = mixHex(pal.bgMid, '#000000', 0.3)
  const inkLight = mixHex(pal.accent, '#FFFFFF', 0.35)

  // Portrait tile geometry (duotone print block).
  const TILE = { x: 155, y: 342, w: 290, h: 308, r: 26 }

    // Marker-handwritten name sizing (embedded Caveat; fallbacks run wide).
  const len = displayName.length
  const nameSize = len <= 10 ? 54 : len <= 15 ? 46 : len <= 21 ? 37 : 29
  const nameFont =
    "'Caveat','Segoe Script','Bradley Hand','Comic Sans MS',cursive"

  // Decorative barcode, deterministic from the serial.
  let bx = 268
  let bars = ''
  for (let i = 0; i < 22; i++) {
    const code = serial.charCodeAt(i % 4) + i * 7
    const w = 1 + (code % 3)
    bars += `<rect x="${bx}" y="820" width="${w}" height="26" fill="#ffffff" fill-opacity="0.4"/>`
    bx += w + 2.2
  }

  // Fallback art when no PFP resolved: monad mark on a dark tile.
  const pfpBlock = pfpData
    ? `<image href="${pfpData}" x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" clip-path="url(#pfpClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" clip-path="url(#pfpClip)" fill="${inkDark}"/>
       <g transform="translate(${TILE.x + TILE.w / 2} ${TILE.y + TILE.h / 2}) scale(7) translate(-16 -16)" fill="${inkLight}">
         <path d="${MONAD_MARK}"/>
       </g>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <defs>
    <style>
      @font-face {
        font-family: 'Caveat';
        font-weight: 600;
        src: url(data:font/woff2;base64,${NAME_FONT_B64}) format('woff2');
      }
    </style>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pal.bgTop}"/>
      <stop offset="0.5" stop-color="${pal.bgMid}"/>
      <stop offset="1" stop-color="${pal.bgBottom}"/>
    </linearGradient>
    <radialGradient id="portraitGlow" cx="0.5" cy="0.53" r="0.46">
      <stop offset="0" stop-color="${pal.accent}" stop-opacity="0.5"/>
      <stop offset="0.65" stop-color="${pal.accent}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${pal.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cornerGlow" cx="0.88" cy="0.06" r="0.5">
      <stop offset="0" stop-color="${pal.accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${pal.accent}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="1.1" cy="1.1" r="1.1" fill="#ffffff" fill-opacity="0.045"/>
    </pattern>
    <clipPath id="pfpClip"><rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}"/></clipPath>
    <clipPath id="cardClip"><rect width="${CARD_W}" height="${CARD_H}" rx="44"/></clipPath>
    <!-- stencil cuts through the giant wordmark -->
    <mask id="cuts" maskUnits="userSpaceOnUse" x="0" y="110" width="${CARD_W}" height="230">
      <rect x="0" y="110" width="${CARD_W}" height="230" fill="#ffffff"/>
      <g transform="rotate(-12 300 225)">
        <rect x="-60" y="168" width="720" height="5"/>
        <rect x="-60" y="200" width="720" height="11"/>
        <rect x="-60" y="248" width="720" height="11"/>
        <rect x="118" y="110" width="7" height="230"/>
        <rect x="338" y="110" width="7" height="230"/>
      </g>
    </mask>
    <!-- print-stock grain -->
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/>
    </filter>
    <filter id="stripShadow" x="-30%" y="-60%" width="160%" height="240%">
      <feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
    <filter id="textShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <g clip-path="url(#cardClip)">
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#dots)"/>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#cornerGlow)"/>
    <rect width="${CARD_W}" height="${CARD_H}" filter="url(#grain)" opacity="0.6"/>

    <!-- header row -->
    <g transform="translate(52 56)" fill="#ffffff" fill-opacity="0.9">
      <path d="${MONAD_MARK}"/>
    </g>
    <text x="96" y="79" font-family="'Segoe UI', system-ui, sans-serif" font-size="21" font-weight="800" letter-spacing="5" fill="#ffffff" fill-opacity="0.88">MONAD</text>
    <text x="${CARD_W - 52}" y="77" text-anchor="end" font-family="'Segoe UI', system-ui, sans-serif" font-size="14" font-weight="700" letter-spacing="4" fill="#ffffff" fill-opacity="0.5">LANYARD PASS</text>
    <line x1="52" y1="104" x2="${CARD_W - 52}" y2="104" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5"/>

    <!-- stencil wordmark -->
    <g mask="url(#cuts)">
      <text x="300" y="300" text-anchor="middle" font-family="'Archivo Black','Arial Black','Segoe UI',sans-serif" font-weight="900" font-size="174" letter-spacing="-4" fill="#ffffff" fill-opacity="0.97">LYRD</text>
    </g>

    <!-- portrait block -->
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#portraitGlow)"/>
    <rect x="${TILE.x + 9}" y="${TILE.y + 11}" width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}" fill="none" stroke="${pal.accent}" stroke-opacity="0.8" stroke-width="2.5"/>
    <g filter="url(#textShadow)">${pfpBlock}</g>
    <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.6"/>
    <!-- registration marks -->
    <path d="M92 372h18M101 363v18" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.6"/>
    <path d="M490 682h18M499 673v18" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.6"/>

    <!-- name strip — marker on paper -->
    <g transform="translate(300 706) rotate(-1.8)" filter="url(#stripShadow)">
      <rect x="-192" y="-40" width="384" height="80" rx="40" fill="#F6F1E6"/>
      <text x="0" y="14" text-anchor="middle" font-family="${nameFont}" font-size="${nameSize}" font-weight="600" fill="#171029">${esc(displayName)}</text>
    </g>
    ${handle ? `<text x="300" y="772" text-anchor="middle" font-family="'Segoe UI', system-ui, sans-serif" font-size="29" font-weight="700" letter-spacing="1" fill="${mixHex(pal.accent, '#FFFFFF', 0.35)}">${esc(handle)}</text>` : ''}

    <!-- footer rail -->
    <line x1="52" y1="802" x2="${CARD_W - 52}" y2="802" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5"/>
    <text x="52" y="848" font-family="'Segoe UI', system-ui, sans-serif" font-size="22" font-weight="800" letter-spacing="4" fill="#ffffff" fill-opacity="0.72">NO. ${serial}</text>
    ${bars}
    <rect x="446" y="818" width="102" height="34" rx="17" fill="#ffffff" fill-opacity="0.07"/>
    <rect x="446" y="818" width="102" height="34" rx="17" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.4"/>
    <text x="497" y="841" text-anchor="middle" font-family="'Segoe UI', system-ui, sans-serif" font-size="18" font-weight="800" letter-spacing="2" fill="#ffffff" fill-opacity="0.75">#10143</text>
  </g>
</svg>`;
  return `data:image/svg+xml;base64,${b64(svg)}`;
}

// Normalizes any image input (data URL, http(s) URL, or local file path) to a
// data URL. Local file paths only work in Node; browsers pass URLs/data URLs.
export async function toDataUrl(input) {
  if (input.startsWith('data:')) return input;
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`failed to fetch ${input}: ${res.status}`);
    const buf = await res.arrayBuffer();
    const mime = res.headers.get('content-type')?.split(';')[0] || mimeFromName(input);
    return `data:${mime};base64,${bytesToBase64(new Uint8Array(buf))}`;
  }
  if (typeof process === 'undefined') throw new Error(`cannot read local file in browser: ${input}`);
  const fs = await import('node:fs/promises');
  const buf = await fs.readFile(input);
  return `data:${mimeFromName(input)};base64,${bytesToBase64(new Uint8Array(buf))}`;
}

export function mimeFromName(name) {
  const clean = String(name).split('?')[0];
  const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }[ext] || 'application/octet-stream'
  );
}

export function esc(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  // Browser: chunk to avoid call-stack limits on large images.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

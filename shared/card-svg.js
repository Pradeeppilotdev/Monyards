// shared/card-svg.js — framework-free ESM used by the bake CLI, the bake
// server and the mint frontend (Node >= 18 and modern browsers). Everything
// here is pure string manipulation; the browser rasterizes the SVG when it
// loads it as a WebGL texture, so no canvas/native deps are needed anywhere.

export const CARD_W = 600;
export const CARD_H = 906;

// Official Monad logomark path (circle + stylized M), 32x32 viewBox.
export const MONAD_MARK =
  'M15.9999 0C11.3795 0 0 11.3792 0 15.9999C0 20.6206 11.3795 32 15.9999 32C20.6203 32 32 20.6204 32 15.9999C32 11.3794 20.6205 0 15.9999 0ZM13.5066 25.1492C11.5582 24.6183 6.31981 15.455 6.85083 13.5066C7.38185 11.5581 16.545 6.31979 18.4933 6.8508C20.4418 7.38173 25.6802 16.5449 25.1492 18.4934C24.6182 20.4418 15.455 25.6802 13.5066 25.1492Z';

// Renders the front card as a self-contained SVG data URL (PFP embedded as
// base64 when provided). Aspect ratio matches the card face (~2:3). Layout is
// tuned for legibility at card render size: high-contrast text with a drop
// shadow, large PFP, and a Monad mark at the top.
export async function renderCardSvg({ pfp, username, name }) {
  const displayName = name || (username ? `@${username}` : 'Monad Holder');
  const handle = username ? `@${username}` : '';
  let pfpData = '';
  if (pfp) {
    try {
      pfpData = await toDataUrl(pfp);
    } catch {
      pfpData = '';
    }
  }
  const pfpBlock = pfpData
    ? `<circle cx="300" cy="320" r="164" fill="#0a0a14" stroke="#ffffff" stroke-opacity="0.4" stroke-width="6"/>
       <image href="${pfpData}" x="150" y="170" width="300" height="300" clip-path="url(#pfpClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="300" cy="320" r="164" fill="#0a0a14" stroke="#ffffff" stroke-opacity="0.4" stroke-width="6"/>
       <circle cx="300" cy="320" r="150" fill="#6e54ff"/>
       <text x="300" y="356" text-anchor="middle" font-size="104" font-family="sans-serif" font-weight="800" fill="#ffffff">M</text>`;
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
</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
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
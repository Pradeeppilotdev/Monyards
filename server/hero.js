// server/hero.js — branded 1200x630 og:image for the bare site link.
// Rendered once with @resvg/resvg-js (same rasterizer the GIFs use) using the
// embedded Caveat brand font, so Telegram/X/WhatsApp all see one consistent
// social card instead of a personal card photo. 1200x630 is the X
// summary_large_image ratio — unfurls full-bleed with no cropping.
import { Resvg } from "@resvg/resvg-js"
import wawoff2 from "wawoff2"
import { NAME_FONT_B64 } from "../shared/name-font.js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const W = 1200
const H = 630

let caveatPath = null
let fontLoading = null
function caveatFontFile() {
  if (caveatPath) return caveatPath
  if (!fontLoading) {
    fontLoading = wawoff2.decompress(Buffer.from(NAME_FONT_B64, "base64")).then((ttf) => {
      caveatPath = join(tmpdir(), "lanyard-hero-caveat.ttf")
      writeFileSync(caveatPath, ttf)
      return caveatPath
    })
  }
  return fontLoading
}

function esc(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function cardArt(x, y, rot, avatarHue) {
  // A stylized mini "lanyard card" — neon-purple tilted card suggesting the
  // product without embedding a raster photo (avoids JPEG-in-SVG decoders).
  return `<g transform="rotate(${rot} ${x + 115} ${y + 170})">
  <rect x="${x}" y="${y}" width="230" height="340" rx="20" fill="#161030" stroke="#7c5cff" stroke-width="2.5"/>
  <rect x="${x}" y="${y}" width="230" height="340" rx="20" fill="url(#cardGrad)" opacity="0.55"/>
  <circle cx="${x + 115}" cy="${y + 86}" r="34" fill="none" stroke="#9f8bff" stroke-width="3"/>
  <text x="${x + 115}" y="${y + 214}" text-anchor="middle" font-family="Caveat, DejaVu Sans, sans-serif" font-size="52" fill="#efeaff">LYRD</text>
  <rect x="${x + 46}" y="${y + 262}" width="138" height="12" rx="6" fill="#4b3f8f" opacity="0.85"/>
</g>`
}

export function buildHeroSvg() {
  const glows = `
  <radialGradient id="g1" cx="18%" cy="20%" r="55%">
    <stop offset="0" stop-color="#3b2a8a" stop-opacity="0.55"/>
    <stop offset="1" stop-color="#3b2a8a" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="g2" cx="88%" cy="82%" r="60%">
    <stop offset="0" stop-color="#7c2a9e" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#7c2a9e" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="pill" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#7c5cff"/>
    <stop offset="1" stop-color="#c445ff"/>
  </linearGradient>
  <linearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3a2a86" stop-opacity="0.9"/>
    <stop offset="1" stop-color="#1a1140" stop-opacity="0.9"/>
  </linearGradient>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${glows}</defs>
  <rect width="${W}" height="${H}" fill="#0a0612"/>
  <rect width="${W}" height="${H}" fill="url(#g1)"/>
  <rect width="${W}" height="${H}" fill="url(#g2)"/>
  ${cardArt(830, 120, 7, 1)}
  ${cardArt(995, 205, -9, 2)}
  <text x="80" y="130" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="800" letter-spacing="6" fill="#7c5cff">MINT ON MONAD</text>
  <text x="80" y="232" font-family="Caveat, DejaVu Sans, sans-serif" font-size="88" fill="#ffffff">Your lanyard,</text>
  <text x="80" y="330" font-family="Caveat, DejaVu Sans, sans-serif" font-size="88" fill="#efeaff">minted forever.</text>
  <text x="82" y="392" font-family="DejaVu Sans, sans-serif" font-size="20" fill="#b7aef0">Free to share. One card, one wallet, one identity.</text>
  <rect x="80" y="424" width="252" height="58" rx="29" fill="url(#pill)"/>
  <text x="206" y="463" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="700" fill="#ffffff">Mint now →</text>
  <text x="80" y="560" font-family="DejaVu Sans, sans-serif" font-size="15" letter-spacing="2" fill="#6f6699">CARDS.PRADEEPPILOT.XYZ</text>
</svg>`
}

export async function renderHeroPng() {
  const fontFiles = [await caveatFontFile()]
  const svg = buildHeroSvg()
  const res = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { fontFiles } })
  return res.render().asPng()
}

export { W, H }
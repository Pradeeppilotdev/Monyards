// server/hero.js — clean 1200x630 og:image for the bare site link.
// The product, literally: the real minted card hanging from a lanyard strap,
// on a flat dark background with minimal copy. Rendered once with
// @resvg/resvg-js (same rasterizer as the GIFs). 1200x630 is the X
// summary_large_image ratio so it unfurls full-bleed, uncropped.
import { Resvg } from "@resvg/resvg-js"

const W = 1200
const H = 630

// Card + lanyard, drawn hanging from the top of the canvas. Kept geometric
// and flat: a top ring, a ribbon strap, a metal cap, then the card image.
function lanyardCard(cardDataUrl) {
  const cx = 860
  const cw = 250
  const ch = Math.round((cw * 906) / 600) // card is 600x906
  const topY = 236
  return `
  <circle cx="${cx}" cy="64" r="10" fill="#0b0812" stroke="#8b84b8" stroke-width="4.5"/>
  <rect x="${cx - 5}" y="70" width="10" height="158" rx="5" fill="#4a4274"/>
  <line x1="${cx - 3.5}" y1="86" x2="${cx - 3.5}" y2="212" stroke="#5b5488" stroke-width="2.6"/>
  <rect x="${cx - 11}" y="224" width="22" height="17" rx="5" fill="#8b84b8"/>
  <circle cx="${cx}" cy="232.5" r="2.6" fill="#0b0812"/>
  <ellipse cx="${cx}" cy="624" rx="140" ry="9" fill="#000000" opacity="0.35"/>
  <image href="${cardDataUrl}" x="${cx - cw / 2}" y="${topY}" width="${cw}" height="${ch}" preserveAspectRatio="xMidYMid slice"/>`
}

export function buildHeroSvg(cardDataUrl) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0e0b18"/>
      <stop offset="1" stop-color="#0a0710"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${lanyardCard(cardDataUrl)}
  <text x="90" y="152" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="800" letter-spacing="6" fill="#8f83c9">MONAD LANYARD</text>
  <text x="90" y="258" font-family="DejaVu Sans, sans-serif" font-size="74" font-weight="800" fill="#ffffff">Your card,</text>
  <text x="90" y="340" font-family="DejaVu Sans, sans-serif" font-size="74" font-weight="800" fill="#efeaff">yours forever.</text>
  <text x="91" y="402" font-family="DejaVu Sans, sans-serif" font-size="19" fill="#b7aef0">Free to share. Mint to make it forever.</text>
  <text x="91" y="468" font-family="DejaVu Sans, sans-serif" font-size="14" font-weight="700" letter-spacing="3" fill="#6f6699">CARDS.PRADEEPPILOT.XYZ</text>
</svg>`
}

export async function renderHeroPng(cardDataUrl) {
  const svg = buildHeroSvg(cardDataUrl)
  const res = new Resvg(svg, { fitTo: { mode: "width", value: W } })
  return res.render().asPng()
}

export { W, H }
// gif.js — renders the personalized card SVG as a small animated GIF loop that
// auto-plays in scanners/marketplaces (the "constantly running" preview like
// CHOG). Pure server-side: SVG per frame -> resvg raster -> gifenc palette.
//
// Motion is subtle by design: the card content drifts (bob/sway/rotate) while
// a soft sheen sweeps across and the depth breathes. Kept size-bounded.
import { Resvg } from "@resvg/resvg-js"
import gifenc from "gifenc"
const { GIFEncoder, quantize, applyPalette } = gifenc
import wawoff2 from "wawoff2"
import { NAME_FONT_B64 } from "../shared/name-font.js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const CW = 600 // card SVG width
const CH = 906 // card SVG height
const CX = CW / 2
const CY = CH / 2

let caveatPath = null
let fontLoading = null
function caveatFontFile() {
  if (caveatPath) return caveatPath
  if (!fontLoading) {
    fontLoading = wawoff2.decompress(Buffer.from(NAME_FONT_B64, "base64")).then((ttf) => {
      caveatPath = join(tmpdir(), "lanyard-caveat.ttf")
      writeFileSync(caveatPath, ttf)
      return caveatPath
    })
  }
  return fontLoading
}

// Build one frame SVG: the card rotated in place + drifting, then two overlay
// layers (moving sheen + breathing depth) applied in static frame coords.
function frameSvg(rawSvg, { k, n, rot, tx, ty, sheenX, breath }) {
  const base = rawSvg.replace("</defs>", `<linearGradient id="sheenGrad" x1="${sheenX - 120}" y1="0" x2="${sheenX + 120}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.13"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient></defs>`)
  const beforeSvg = base.slice(0, base.lastIndexOf("</svg>"))
  const motion = `
  <g clip-path="url(#cardClip)" transform="rotate(${rot.toFixed(3)} ${CX} ${CY}) translate(${tx.toFixed(2)} ${ty.toFixed(2)})"></g>
  <g clip-path="url(#cardClip)">
    <rect x="0" y="0" width="${CW}" height="${CH}" fill="url(#sheenGrad)" opacity="0.9"/>
    <rect x="0" y="0" width="${CW}" height="${CH}" fill="#000000" opacity="${(breath * 0.10).toFixed(3)}"/>
  </g>`
  return beforeSvg + motion + "</svg>"
}

// Renders the animated loop. rawSvg is the decoded card SVG (600x906).
// Returns a Buffer of GIF bytes. Throws on failure so callers can fall back.
export async function cardGif(rawSvg, { width = 440, frames = 30, delay = 70, sway = 1.4, drift = 7 } = {}) {
  const fontFiles = [await caveatFontFile()]
  const twoPi = Math.PI * 2
  const enc = GIFEncoder()
  let rendered = 0

  for (let k = 0; k < frames; k++) {
    const t = k / frames
    const rot = Math.sin(twoPi * t) * sway
    const tx = Math.sin(twoPi * t) * drift                            // horizontal drift
    const ty = Math.cos(twoPi * t) * drift * 0.55                     // smaller vertical
    const sheenX = CW * ((t * 2 - 0.5 + 1) % 1)                       // sweep left -> right
    const breath = Math.sin(twoPi * t * 2) * 0.5 + 0.5
    const svg = frameSvg(rawSvg, { k, n: frames, rot, tx, ty, sheenX, breath })
    const res = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles } })
    const img = res.render()
    const rgba = img.pixels
    const w = img.width
    const h = img.height
    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette, "bayer")
    enc.writeFrame(index, w, h, { palette, delay })
    rendered++
  }

  enc.finish()
  const buf = Buffer.from(enc.bytes())
  return { buffer: buf, frames: rendered, width, height: Math.round((CH / CW) * width) }
}

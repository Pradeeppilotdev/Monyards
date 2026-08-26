// mint/src/record.js — browser-only: records the Lanyard WebGL canvas to a
// webm clip while driving a scripted pull, so a minted user gets a shareable
// video of their card swinging on the rope.

export function pickMime() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || ''
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })

// --- poster framing ---------------------------------------------------------
// Every recording/still uses the same fixed 1080x1350 (4:5) output regardless
// of screen size: silk backdrop edge-to-edge, lanyard centered at 72% width.
// Fixed output = consistent quality on every device; the centered framing
// keeps the card from looming over an empty frame.

const POSTER_W = 1080
const POSTER_H = 1350

function paintBackdrop(ctx, W, H, silk) {
  if (silk && silk.width && silk.height) {
    // Zoom into the silk so the waves read at share size.
    const zoom = 1.35
    const sw = W / zoom
    const sh = H / zoom
    const sx = Math.max(0, (silk.width - sw) / 2)
    const sy = Math.max(0, (silk.height - sh) / 2)
    ctx.drawImage(silk, sx, sy, sw, sh, 0, 0, W, H)
  } else {
    const g = ctx.createRadialGradient(W / 2, H * 0.36, 0, W / 2, H * 0.36, Math.max(W, H) * 0.75)
    g.addColorStop(0, '#251457')
    g.addColorStop(0.55, '#150c30')
    g.addColorStop(1, '#0a0616')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  // Vignette pulls the eye to the card.
  const v = ctx.createRadialGradient(
    W / 2,
    H * 0.45,
    Math.min(W, H) * 0.3,
    W / 2,
    H * 0.45,
    Math.max(W, H) * 0.72,
  )
  v.addColorStop(0, 'rgba(10, 6, 22, 0)')
  v.addColorStop(1, 'rgba(10, 6, 22, 0.55)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

function drawLanyard(ctx, canvas, W, H) {
  const scale = (W * 0.72) / canvas.width
  const dw = canvas.width * scale
  const dh = canvas.height * scale
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, (W - dw) / 2, (H - dh) / 2, dw, dh)
}

function posterCtx() {
  const out = document.createElement('canvas')
  out.width = POSTER_W
  out.height = POSTER_H
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { out, ctx }
}

const getSilk = () => document.querySelector('.silk-bg canvas')

// --- public API -------------------------------------------------------------

// Grab the whole lanyard scene — card, rope and the live silk backdrop — as
// an opaque JPEG in the 4:5 poster framing. Far better share material than
// the flat card SVG, and small enough for public gateways to serve.
export async function captureLanyardImage({ canvas }) {
  if (!canvas) throw new Error('preview canvas not found')
  const { out, ctx } = posterCtx()
  paintBackdrop(ctx, out.width, out.height, getSilk())
  drawLanyard(ctx, canvas, out.width, out.height)
  return await new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), 'image/jpeg', 0.85),
  )
}

export async function recordShareClip({ canvas, driveRef, durationMs = 4600, pullDelayMs = 500, signal }) {
  // The WebGL canvas is transparent, so recording it directly collapses every
  // background pixel to black — and at screen resolution the card looms over
  // an empty frame. Instead each frame is composited into the fixed 4:5
  // poster: silk backdrop, card centered, consistent quality everywhere.
  if (!canvas) throw new Error('preview canvas not found')
  const { out, ctx } = posterCtx()
  const silk = getSilk()

  let raf = 0
  const frame = () => {
    paintBackdrop(ctx, out.width, out.height, silk)
    drawLanyard(ctx, canvas, out.width, out.height)
    raf = requestAnimationFrame(frame)
  }
  frame()

  const stream = out.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 16_000_000 })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))
  })
  rec.start(100)

  try {
    await sleep(pullDelayMs, signal)
    driveRef?.current?.pull()
    await sleep(durationMs, signal)
  } catch (e) {
    if (rec.state !== 'inactive') rec.stop()
    cancelAnimationFrame(raf)
    stream.getTracks().forEach((t) => t.stop())
    throw e
  }
  if (rec.state !== 'inactive') rec.stop()
  cancelAnimationFrame(raf)
  stream.getTracks().forEach((t) => t.stop())
  return done
}

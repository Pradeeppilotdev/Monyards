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

// Grab the whole lanyard scene — card, rope and the live silk backdrop — as
// an opaque PNG. Far better share material than the flat card SVG.
export async function captureLanyardImage({ canvas }) {
  if (!canvas) throw new Error('preview canvas not found')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const out = document.createElement('canvas')
  out.width = Math.max(2, Math.round(canvas.clientWidth * dpr))
  out.height = Math.max(2, Math.round(canvas.clientHeight * dpr))
  const ctx = out.getContext('2d')

  // The WebGL canvas is transparent — composite it over the live silk canvas
  // so the share looks exactly like the page (gradient fallback otherwise).
  const silk = document.querySelector('.silk-bg canvas')
  if (silk && silk.width && silk.height) {
    // Zoom into the silk so the waves read at share size instead of washing out.
    const zoom = 1.35
    const sw = out.width / zoom
    const sh = out.height / zoom
    const sx = Math.max(0, (silk.width - sw) / 2)
    const sy = Math.max(0, (silk.height - sh) / 2)
    ctx.drawImage(silk, sx, sy, sw, sh, 0, 0, out.width, out.height)
  } else {
    const g = ctx.createRadialGradient(
      out.width / 2,
      out.height * 0.36,
      0,
      out.width / 2,
      out.height * 0.36,
      Math.max(out.width, out.height) * 0.75,
    )
    g.addColorStop(0, '#251457')
    g.addColorStop(0.55, '#150c30')
    g.addColorStop(1, '#0a0616')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, out.width, out.height)
  }
  // Vignette pulls the eye to the card.
  const v = ctx.createRadialGradient(
    out.width / 2,
    out.height * 0.42,
    Math.min(out.width, out.height) * 0.28,
    out.width / 2,
    out.height * 0.42,
    Math.max(out.width, out.height) * 0.72,
  )
  v.addColorStop(0, 'rgba(10, 6, 22, 0)')
  v.addColorStop(1, 'rgba(10, 6, 22, 0.6)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0, out.width, out.height)

  // JPEG (not PNG): a 3.3MB image 504s on public ipfs gateways, which breaks
  // explorers that fetch client-side. ~400KB JPEG warms/caches reliably.
  return await new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), 'image/jpeg', 0.85),
  )
}

export async function recordShareClip({ canvas, driveRef, durationMs = 4600, pullDelayMs = 500, signal }) {
  // The WebGL canvas is transparent, so recording it directly collapses every
  // background pixel to black. Instead we composite each frame onto a painted
  // backdrop matching the site vibe, and record that canvas.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const out = document.createElement('canvas')
  out.width = Math.max(2, Math.round(canvas.clientWidth * dpr))
  out.height = Math.max(2, Math.round(canvas.clientHeight * dpr))
  const ctx = out.getContext('2d')

  const paintBackdrop = () => {
    const g = ctx.createRadialGradient(
      out.width / 2,
      out.height * 0.36,
      0,
      out.width / 2,
      out.height * 0.36,
      Math.max(out.width, out.height) * 0.75,
    )
    g.addColorStop(0, '#251457')
    g.addColorStop(0.55, '#150c30')
    g.addColorStop(1, '#0a0616')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, out.width, out.height)
  }
  paintBackdrop()

  let raf = 0
  const frame = () => {
    paintBackdrop()
    ctx.drawImage(canvas, 0, 0, out.width, out.height)
    raf = requestAnimationFrame(frame)
  }
  frame()

  const stream = out.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 12_000_000 })
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

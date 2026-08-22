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

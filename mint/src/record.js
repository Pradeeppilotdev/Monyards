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

export async function recordShareClip({ canvas, driveRef, durationMs = 4600, pullDelayMs = 500 }) {
  const stream = canvas.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 8_000_000 })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))
  })
  rec.start(100)
  await new Promise((r) => setTimeout(r, pullDelayMs))
  driveRef?.current?.pull()
  await new Promise((r) => setTimeout(r, durationMs))
  if (rec.state !== 'inactive') rec.stop()
  return done
}
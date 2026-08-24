// animation/src/camera.js — shared framing for the lanyard stage.
//
// Scene facts this is tuned against: the card's visual center rests at world
// y ≈ -1.52, the card is ~2.25 world-units tall (600:906 face), and the rope
// anchor sits at y = 4. The camera uses a fixed 26° vertical FOV, so a
// constant distance gives a constant card fill on any display.

// The mint frontend: the original framing, bumped a touch closer.
// Card fills ~53% of the frame height.
export function previewCamera() {
  return [0, -1.43, 9.2]
}

// The baked IPFS stage: card fills ~65% of the frame height on desktop.
export function stageCamera(
  w = typeof window !== 'undefined' ? window.innerWidth : 1280,
  h = typeof window !== 'undefined' ? window.innerHeight : 800,
) {
  // Phone: pull back so the card is ~2/3 of the screen WIDTH — at the old
  // distance it overflowed the edges and left no room to grab or swing it.
  if (w < 768) return [0, -1.4, 10.5]
  return [0, -1.24, 7.5]
}

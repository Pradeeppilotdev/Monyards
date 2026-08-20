// The card images start life as these unique tokens. After `vite build`, the
// tokens survive inside the inlined JS bundle of dist/index.html. `bake.mjs`
// then does a plain string replace, swapping each token for the real per-mint
// card image (a data URL) — producing the final self-contained HTML to pin.
//
// If a token is NOT replaced, `isPlaceholder` returns true and the Lanyard
// renders its built-in card texture, so the un-baked page still works.
export const FRONT_IMAGE = '__LANYARD_FRONT_IMG__'
export const BACK_IMAGE = '__LANYARD_BACK_IMG__'

export const isPlaceholder = (value) =>
  typeof value === 'string' && value.startsWith('__LANYARD_')
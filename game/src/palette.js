// EMBERLINE palette — dusk industrial yard. Single source of truth for
// colours; map.js and render.js (and the HUD) all read from here.
// Readability baseline (both GPT reviews, near-identical values): the
// playable surfaces and the bots are bright enough to separate from the
// dusk sky, while the sky itself stays dusk-blue and the team colours
// (rust foes, teal allies) stay.
export const PALETTE = {
  canvas: '#303e50', // dusk sky / fog
  surface: '#7a8589', // major walls
  hairline: '#68727a', // structural steel
  ink: '#f2ead8',
  muted: '#9a8f7a',
  accent: '#ff9a2e',
  foe: '#e57550',
  ally: '#55bcb2',
  floor: '#62696b', // concrete floor
  container: '#435f70', // muted blue containers
  rust: '#986044', // rust containers
};

export function shade(name) { return PALETTE[name]; }

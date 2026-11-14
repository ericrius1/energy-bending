// Where each part of the HUD goes, from the canvas's size in CSS pixels. Two layouts: the desktop's (a panel in each
// top corner with its live combo hanging under it, the shared energy between the panels: a ribbon from each panel to
// the set's orb in the middle, the beat at the bottom centre) and the compact one for a phone or any small window
// (the panels become slim bars along the top, everything smaller, and the beat kept clear of the touch buttons down
// the right edge: src/input/touch-pad.ts, two columns of 64 px from 12 px in). One unit `u` scales each.

export interface Box { x: number; y: number; w: number; h: number }
export interface Layout {
  W: number; H: number;
  compact: boolean;
  /** the layout's unit (CSS px) */
  u: number;
  panels: [Box, Box];
  /** each panel's live combo: the row under it (its outer edge is the panel's) */
  combo: [Box, Box];
  /** the shared energy: two strands, from each panel's inner edge (x0, x1) to the orb, at height y */
  shared: { x0: number; x1: number; y: number };
  /** the set's orb in the middle: the merge grows in it, the set's time runs round it */
  orb: { x: number; y: number; r: number };
  beat: { x: number; y: number; r: number; rMax: number };
  centre: { x: number; y: number };
  /** pops and tags stay this far inside the edges, and below this line (the panels and their combos) */
  margin: number;
  top: number;
}

/** the touch pad's button column: 2 × 64 px + 8 px gap, 12 px from the right edge (touch-pad.ts) */
const TOUCH_COLUMN = 2 * 64 + 8 + 12;

export function layout(W: number, H: number): Layout {
  const compact = W < 760 || H < 480;
  if (!compact) {
    const u = Math.max(0.8, Math.min(2.4, Math.min(W / 1280, H / 720)));
    const m = 20 * u, pw = 300 * u, ph = 84 * u, ch = 30 * u;
    const panels: [Box, Box] = [{ x: m, y: m, w: pw, h: ph }, { x: W - m - pw, y: m, w: pw, h: ph }];
    const cy = m + ph + 8 * u;
    return {
      W, H, compact, u, panels,
      combo: [{ x: m, y: cy, w: pw, h: ch }, { x: W - m - pw, y: cy, w: pw, h: ch }],
      shared: { x0: m + pw + 14 * u, x1: W - m - pw - 14 * u, y: m + ph * 0.5 },
      orb: { x: W / 2, y: m + ph * 0.5, r: 24 * u },
      beat: { x: W / 2, y: H - 70 * u, r: 22 * u, rMax: 58 * u },
      centre: { x: W / 2, y: H * 0.42 },
      margin: 24 * u,
      top: cy + ch + 6 * u,
    };
  }
  const u = Math.max(0.78, Math.min(1.3, Math.min(W, H) / 390));
  const m = 8 * u, ph = 40 * u, ch = 20 * u;
  // the panels leave the shared energy at least this much room between them
  const pw = Math.min(232 * u, (W - 2 * m - 132 * u) / 2);
  const panels: [Box, Box] = [{ x: m, y: m, w: pw, h: ph }, { x: W - m - pw, y: m, w: pw, h: ph }];
  const cy = m + ph + 5 * u;
  const rMax = 40 * u, r = 16 * u;
  // the beat at the bottom centre, nudged left if the touch buttons would touch it
  const bx = Math.min(W / 2, W - TOUCH_COLUMN - rMax - 6 * u);
  return {
    W, H, compact, u, panels,
    combo: [{ x: m, y: cy, w: pw, h: ch }, { x: W - m - pw, y: cy, w: pw, h: ch }],
    shared: { x0: m + pw + 6 * u, x1: W - m - pw - 6 * u, y: m + ph * 0.5 },
    orb: { x: W / 2, y: m + ph * 0.5, r: 15 * u },
    beat: { x: bx, y: H - 50 * u, r, rMax },
    centre: { x: W / 2, y: H * 0.4 },
    margin: 14 * u,
    top: cy + ch + 4 * u,
  };
}

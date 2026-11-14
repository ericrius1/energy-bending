// Where each part of the HUD goes, from the canvas's size in CSS pixels. Two layouts: the desktop's (a panel in each
// top corner, the score between them, the beat at the bottom centre) and the compact one for a phone or any small
// window (the panels become slim bars along the top, everything smaller, and the beat kept clear of the touch
// buttons down the right edge: src/input/touch-pad.ts, two columns of 64 px from 12 px in). One unit `u` scales each.

export interface Box { x: number; y: number; w: number; h: number }
export interface Layout {
  W: number; H: number;
  compact: boolean;
  /** the layout's unit (CSS px) */
  u: number;
  panels: [Box, Box];
  score: Box;
  beat: { x: number; y: number; r: number; rMax: number };
  centre: { x: number; y: number };
  /** pops and tags stay this far inside the edges */
  margin: number;
}

/** the touch pad's button column: 2 × 64 px + 8 px gap, 12 px from the right edge (touch-pad.ts) */
const TOUCH_COLUMN = 2 * 64 + 8 + 12;

export function layout(W: number, H: number): Layout {
  const compact = W < 760 || H < 480;
  if (!compact) {
    const u = Math.max(0.8, Math.min(2.4, Math.min(W / 1280, H / 720)));
    const m = 20 * u, pw = 304 * u, ph = 74 * u;
    const sw = 164 * u, sh = 54 * u;
    return {
      W, H, compact, u,
      panels: [{ x: m, y: m, w: pw, h: ph }, { x: W - m - pw, y: m, w: pw, h: ph }],
      score: { x: (W - sw) / 2, y: m, w: sw, h: sh },
      beat: { x: W / 2, y: H - 70 * u, r: 22 * u, rMax: 58 * u },
      centre: { x: W / 2, y: H * 0.42 },
      margin: 24 * u,
    };
  }
  const u = Math.max(0.78, Math.min(1.3, Math.min(W, H) / 390));
  const m = 8 * u, gap = 6 * u, sw = 62 * u, sh = 36 * u;
  const pw = Math.min(250 * u, (W - 2 * m - sw - 2 * gap) / 2), ph = 36 * u;
  const rMax = 40 * u, r = 16 * u;
  // the beat at the bottom centre, nudged left if the touch buttons would touch it
  const bx = Math.min(W / 2, W - TOUCH_COLUMN - rMax - 6 * u);
  return {
    W, H, compact, u,
    panels: [{ x: m, y: m, w: pw, h: ph }, { x: W - m - pw, y: m, w: pw, h: ph }],
    score: { x: (W - sw) / 2, y: m, w: sw, h: sh },
    beat: { x: bx, y: H - 50 * u, r, rMax },
    centre: { x: W / 2, y: H * 0.4 },
    margin: 14 * u,
  };
}

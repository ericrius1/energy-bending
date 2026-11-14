// What the HUD draws: one plain object, filled by whoever runs the mode (the duel's rules, the demo, the jogo's beat)
// and handed to `hud.set(state)` each frame. The contract is docs/design/duel.md's ("The HUD"); this file is its
// TypeScript, plus the empty state the HUD starts from. Screen positions are fractions of the canvas, (0, 0) the top
// left, y down, so they don't depend on the device's pixel ratio or the render scale.

export type HudMode = 'duel' | 'jogo' | 'none';
export type PopKind = 'perfect' | 'parry' | 'ko' | 'react' | 'info';

export interface HudCharge { spell: string; n: number; max: number; ready: number }

export interface HudPlayer {
  seat: 0 | 1;
  name: string;
  /** the player's colour (CSS) */
  color: string;
  /** 'fire' | 'water' | 'ice' | 'plasma' | 'gems' | 'steam' */
  matter: string;
  /** hits taken this life, of hitsMax (3) */
  hits: number;
  hitsMax: number;
  /** KOs scored this round */
  kos: number;
  /** 0 … 1 ready */
  dash: number;
  /** phase 2's spells (empty slots until then) */
  charges: HudCharge[];
  /** 0 … 1 */
  superMeter: number;
  /** 0 … 1 while the body reforms, else 0 */
  reforming: number;
  /** the player's head on screen (0 … 1), for its tag */
  screen?: [number, number];
}

export interface HudRound {
  koTarget: number;
  /** seconds, shown as m:ss (the duel decides whether it counts up or down) */
  time: number;
  phase: 'countdown' | 'play' | 'ko' | 'won';
  /** seconds left of the countdown (3 … 0) */
  countdown?: number;
  /** the winner's seat */
  winner?: number;
}

export interface HudBeat {
  /** 0 … 1 within the beat (0 on the beat) */
  phase: number;
  bpm: number;
  /** the perfect window (s): an action within ± this of the beat is perfect */
  window: number;
}

export interface HudPop {
  text: string;
  seat?: number;
  /** where it happened, on screen (0 … 1) */
  at: [number, number];
  /** seconds since it happened (the HUD lets it go at about 1.2 s) */
  age: number;
  kind: PopKind;
}

export interface HudState {
  mode: HudMode;
  players: HudPlayer[];
  round: HudRound;
  beat: HudBeat;
  pops: HudPop[];
}

export const emptyHud = (): HudState => ({
  mode: 'none',
  players: [],
  round: { koTarget: 5, time: 0, phase: 'play' },
  beat: { phase: 0, bpm: 120, window: 0.055 },
  pops: [],
});

/** a world point on screen through a view-projection (column-major, as weft's Camera.viewProj), as the HUD's
 *  fractions. For whoever fills `screen`: `screenOf(bend.kit.camera.viewProj, head)`. A point out of frame lies
 *  outside 0 … 1 (the HUD holds its tag at the edge, pointing at it); a point behind the eye (the free third-person
 *  view: a player behind the camera) is put far outside on the side to turn toward, so its tag points that way too */
export function screenOf(viewProj: ArrayLike<number>, p: ArrayLike<number>): [number, number] {
  const m = viewProj, x = p[0], y = p[1], z = p[2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw > 1e-3) return [(cx / cw) * 0.5 + 0.5, 0.5 - (cy / cw) * 0.5];
  // behind: the side it lies on (the clip x and y before the divide: right is +x, up is +y, whatever w's sign),
  // pushed past the edge; straight behind (no side) reads as below
  let dx = cx, dy = cy;
  const l = Math.hypot(dx, dy);
  if (l < 1e-5) { dx = 0; dy = -1; } else { dx /= l; dy /= l; }
  // (a body behind the camera is nearly always below the eye's line too: lean the arrow down a little)
  dy = Math.min(dy, -0.35);
  const k = 4 / Math.hypot(dx, dy);
  return [0.5 + dx * k * 0.5, 0.5 - dy * k * 0.5];
}

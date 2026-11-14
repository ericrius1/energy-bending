// What the HUD draws: one plain object, filled by whoever runs the mode (the contact dance's rules, the demo, the
// jogo's beat) and handed to `hud.set(state)` each frame. The contract is docs/design/duel.md's "The HUD's state,
// version 2" (the duel as a dance battle: style, combos, the shared energy, the link, the set on the music); this
// file is its TypeScript, plus the empty state the HUD starts from. Screen positions are fractions of the canvas,
// (0, 0) the top left, y down, so they don't depend on the device's pixel ratio or the render scale.

export type HudMode = 'duel' | 'jogo' | 'none';
export type PopKind = 'catch' | 'swing' | 'fling' | 'perfect' | 'combo' | 'merge' | 'info' | 'power' | 'react' | 'pair';
/** a combo's link: one move chained */
export type LinkKind = 'catch' | 'swing' | 'fling' | 'lift' | 'vault' | 'walljump' | 'wallrun' | 'dash' | 'flip' | 'kick' | 'aerial';
export const LINK_KINDS: readonly LinkKind[] = ['catch', 'swing', 'fling', 'lift', 'vault', 'walljump', 'wallrun', 'dash', 'flip', 'kick', 'aerial'];

export interface HudCombo {
  /** moves chained */
  n: number;
  /** the multiplier */
  mult: number;
  /** the last few links (LinkKind; an unknown name draws as a plain mark), oldest first */
  links: string[];
  /** true while the combo is going */
  live: boolean;
  /** links landed on the beat (of n) */
  perfect: number;
  /** past the multiplier's cap, the tier reached (0: none), its word and colour (CSS) from tier 1 */
  tier?: number;
  tierName?: string;
  tierColor?: string;
}

export interface HudPlayer {
  seat: 0 | 1;
  name: string;
  /** the player's colour (CSS) */
  color: string;
  /** 'fire' | 'water' | 'ice' | 'plasma' | 'gems' | 'steam' */
  matter: string;
  /** the battle's score this set */
  style: number;
  combo: HudCombo;
  /** 0 … 1 ready */
  dash: number;
  /** in a link: this one holds (the base) / is held (the flyer) */
  holding: boolean;
  held: boolean;
  /** 0 … 1 after a fall, else 0 */
  reforming: number;
  /** the player's head on screen (0 … 1), for its tag */
  screen?: [number, number];
  /** the duel's powers (phase 2): the flow 0 … 1 (the fuel; full is the power form), the power form's time left
   *  0 … 1, and the two powers: their id and name, whether each can be cast now, its cost of the flow, its key */
  flow?: number;
  form?: number;
  powers?: HudPower[];
}

export interface HudPower { id: string; name: string; ready: boolean; cost: number; key?: string }

export interface HudLink {
  /** the two are joined */
  on: boolean;
  /** 0 … 1: the link's energy (the line of light pulses with it) */
  energy: number;
  /** the contact points on screen (0 … 1): from the holder's, to the held's */
  from?: [number, number];
  to?: [number, number];
}

export interface HudShared {
  /** 0 … 1: the dance's intensity (rises only when the two play together) */
  energy: number;
  /** 0 … 1: its peak this set */
  peak: number;
  /** 0 … 1: the merge charge */
  merge: number;
  /** 0 … 1: the fusion's (1: the finale will fuse: the set merged and held its energy near the top a few seconds) */
  fusion?: number;
  /** the longest stretch near the top this set (s), of the `highFor` the fusion needs; the merges this set (the
   *  banner's "nearly" note when the finale didn't fuse) */
  high?: number;
  highFor?: number;
  /** the top (0 … 1) the fusion asks to be held */
  highAt?: number;
  merges?: number;
}

/** the pair combo: the two's chain of contact links, shared by both (docs/design/duel.md, phase 3) */
export interface HudPair {
  /** links chained, the multiplier, live while it goes */
  n: number;
  mult: number;
  live: boolean;
  /** its tier (0: none) and, from 1, the tier's word and colour */
  tier: number;
  tierName?: string;
  tierColor?: string;
  /** the last few links, and whose each was (seat) */
  links: string[];
  by: number[];
  /** the longest this set */
  best: number;
  /** the two dancers' colours (CSS) */
  colors: [string, string];
  /** on the frame it ends: banked (cashed, each seat's share) or dropped (a fall) */
  ended?: 'cashed' | 'dropped';
  cashed?: [number, number];
}

export interface HudSet {
  /** seconds into the set, of `length` */
  time: number;
  length: number;
  phase: 'intro' | 'play' | 'finale' | 'done';
  /** seconds left of the intro's countdown (3 … 0) */
  countdown?: number;
  /** the winner's seat, once done */
  winner?: number;
  /** from the finale on: whether it fused */
  fused?: boolean;
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
  /** seconds since it happened (the HUD lets it go at about 1 to 1.6 s, by kind) */
  age: number;
  kind: PopKind;
}

export interface HudState {
  mode: HudMode;
  players: HudPlayer[];
  link: HudLink;
  shared: HudShared;
  set: HudSet;
  beat: HudBeat;
  pops: HudPop[];
  /** the duel's pair combo (phase 3) */
  pair?: HudPair;
}

export const emptyCombo = (): HudCombo => ({ n: 0, mult: 1, links: [], live: false, perfect: 0 });

export const emptyHud = (): HudState => ({
  mode: 'none',
  players: [],
  link: { on: false, energy: 0 },
  shared: { energy: 0, peak: 0, merge: 0 },
  set: { time: 0, length: 60, phase: 'play' },
  beat: { phase: 0, bpm: 120, window: 0.055 },
  pops: [],
});

/** a world point on screen through a view-projection (column-major, as weft's Camera.viewProj), as the HUD's
 *  fractions. For whoever fills `screen` and the link's ends: `screenOf(bend.kit.camera.viewProj, p)`. A point out of
 *  frame lies outside 0 … 1 (the HUD holds a tag at the edge, pointing at it); a point behind the eye (the free
 *  third-person view: a player behind the camera) is put far outside on the side to turn toward, so its tag points
 *  that way too */
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

/** true if a screen point is on the screen (with a little slack) and not one of screenOf's "behind" points */
export const onScreen = (p: [number, number] | undefined, slack = 0.15): p is [number, number] =>
  !!p && p[0] > -slack && p[0] < 1 + slack && p[1] > -slack && p[1] < 1 + slack;

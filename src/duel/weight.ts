// The weight of contact (phase 3, "Juice": report 13's first issue, a catch that had no weight). The moments that
// should be felt, and the time they take:
//   hold   on a catch the two bodies' time all but stops for a few frames (3 on the ground, 4 out of the air, 6 at
//          range, through a whip or an arc, or at a geyser's top), then eases back; the same for a fling's release (3)
//          and the finale's lift at its top (6). Not a frozen page: the bodies and the sim run at HOLD_SCALE of their
//          time, while the contact's ring and the link's beads (fx.ts, on the page's own time), the HUD and the music
//          go on at full speed
//   slow   a pair tier (the two's chain, shared/duel.ts PAIR_TIERS): a beat of slow motion, eased in and out
// Each moment is a `juice` event in the duel's event stream (shared/duel.ts DuelEvent): what it was, how big (`w`),
// where (`at`), the frames held and the slow motion, so the camera (an ease toward it), the sound and the film's log
// key off the same thing. Pure: the page (index.ts) scales the frame's dance time by `TimeWarp.step`, the Node harness
// (sim.ts) its fixed step.
import type { DuelEvent, JuiceWhat } from '../../shared/duel.ts';
import type { ContactEvent } from './contact';

type V3 = [number, number, number];
export type Juice = Extract<DuelEvent, { k: 'juice' }>;

export const WEIGHT = {
  /** the bodies' time during a hold (all but still: the matter still drifts, a breath) and the ease back after it (s) */
  HOLD_SCALE: 0.06,
  EASE_S: 0.06,
  /** frames held (a 60th of a second each) */
  FRAMES: { catch: 3, aerial: 4, range: 6, geyser: 6, fling: 3, lift: 6 } as Record<string, number>,
  /** a pair tier: the bodies' time at PAIR_SLOW for PAIR_BEATS beats, eased in over SLOW_IN and out over SLOW_OUT (s) */
  PAIR_SLOW: 0.4,
  PAIR_BEATS: 1,
  SLOW_IN: 0.08,
  SLOW_OUT: 0.22,
  /** a fling's weight grows with its speed, full at this (m/s) */
  FLING_FULL: 15,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };

/** the bodies' time, slowed by the moments: `step(dt)` each frame (dt the page's own), the scale for the frame's dance
 *  time */
export class TimeWarp {
  /** off: always 1 */
  on = true;
  /** the scale the last step gave */
  scale = 1;
  /** seconds of page time the warp has taken from the bodies (what the sets grew by) */
  lost = 0;
  private hold = 0;
  private ease = 0;
  private slow = 0;
  private slowLen = 0;
  private slowTo = 1;

  /** a moment's hold and slow motion */
  add(j: Pick<Juice, 'hold' | 'slow' | 'slowS'>) {
    if (!this.on) return;
    if (j.hold > 0) { this.hold = Math.max(this.hold, j.hold / 60); this.ease = 0; }
    if (j.slow != null && j.slowS) {
      // (a slow motion already running is extended, never deepened past the stronger one)
      if (this.slow <= 0 || j.slow <= this.slowTo) this.slowTo = j.slow;
      this.slow = Math.max(this.slow, j.slowS); this.slowLen = Math.max(this.slowLen, this.slow);
    }
  }
  /** let go of everything (the duel stopped, a new set) */
  reset() { this.hold = this.ease = this.slow = this.slowLen = 0; this.slowTo = 1; this.scale = 1; }

  step(dt: number): number {
    if (!this.on) return (this.scale = 1);
    let k = 1;
    // (a frame's worth of hold left over by rounding is no frame: 1e-4 s)
    if (this.hold > 1e-4) { k = WEIGHT.HOLD_SCALE; this.hold -= dt; if (this.hold <= 1e-4) { this.hold = 0; this.ease = WEIGHT.EASE_S; } }
    else if (this.ease > 0) { this.ease = Math.max(0, this.ease - dt); k = WEIGHT.HOLD_SCALE + (1 - WEIGHT.HOLD_SCALE) * smooth(1 - this.ease / WEIGHT.EASE_S); }
    if (this.slow > 0) {
      const t = this.slowLen - this.slow, inK = smooth(t / WEIGHT.SLOW_IN), outK = smooth(this.slow / WEIGHT.SLOW_OUT);
      k = Math.min(k, 1 - (1 - this.slowTo) * Math.min(inK, outK));
      this.slow -= dt;
      if (this.slow <= 0) { this.slow = 0; this.slowLen = 0; this.slowTo = 1; }
    }
    this.lost += dt * (1 - k);
    return (this.scale = k);
  }
}

/** a power's moment as the powers report it (src/duel/powers.ts PowerFx): a catch through a power is one at range */
export interface PowerMoment { k: string; seat?: number; other?: number; at?: V3; power?: string }
/** a live power effect (src/duel/powers.ts Live), for a geyser's column */
export interface LiveLike { kind: string; at: V3; r?: number; h?: number; done?: boolean }

/** is p in the upper half of a live geyser's column */
export function atGeyserTop(live: readonly LiveLike[], p: ArrayLike<number>): boolean {
  for (const L of live) {
    if (L.kind !== 'geyser' || L.done) continue;
    const r = L.r ?? 1.2, h = L.h ?? 6;
    if (Math.hypot(p[0] - L.at[0], p[2] - L.at[2]) < r + 0.6 && p[1] > L.at[1] + h * 0.4) return true;
  }
  return false;
}

export interface JuiceCtx {
  /** the tempo (a pair tier's beat of slow motion) */
  bpm: number;
  /** where a seat's body is (its chest): a tier's, the merge's */
  at: (seat: number) => V3;
  /** is a seat's body at a geyser's top */
  geyserTop?: (seat: number) => boolean;
}

/** the moments of a frame, from the rules' events (the match's and the powers'), the contact's touches and the powers'
 *  own moments */
export function juiceOf(ev: readonly DuelEvent[], touches: readonly ContactEvent[], power: readonly PowerMoment[], o: JuiceCtx): Juice[] {
  const out: Juice[] = [];
  const F = WEIGHT.FRAMES;
  const mid = (): V3 => { const a = o.at(0), b = o.at(1); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; };
  const put = (what: JuiceWhat, w: number, hold: number, rest: Partial<Juice> = {}) => out.push({ k: 'juice', what, w: +clamp01(w).toFixed(3), hold, ...rest });
  for (const t of touches) {
    if (t.kind === 'catch' || t.kind === 'aerial') {
      const top = !!o.geyserTop && (o.geyserTop(t.seat) || o.geyserTop(t.other));
      if (top) put('aerial', 1, F.geyser, { seat: t.seat, other: t.other, at: t.at, via: 'geyser' });
      else if (t.kind === 'aerial') put('aerial', 0.65, F.aerial, { seat: t.seat, other: t.other, at: t.at });
      else put('catch', 0.4, F.catch, { seat: t.seat, other: t.other, at: t.at });
    } else if (t.kind === 'fling') {
      put('fling', 0.35 + 0.5 * clamp01((t.speed ?? 0) / WEIGHT.FLING_FULL), F.fling, { seat: t.seat, other: t.other, at: t.at });
    }
  }
  for (const p of power) {
    if (p.k !== 'catch' || p.seat == null) continue;
    const via = p.power === 'whip' || p.power === 'arc' ? p.power : undefined;
    put('range', 0.9, F.range, { seat: p.seat, other: p.other ?? 1 - p.seat, ...(p.at ? { at: p.at } : {}), ...(via ? { via } : {}) });
  }
  for (const e of ev) {
    switch (e.k) {
      case 'tier': put('tier', 0.45 + 0.1 * e.tier, 0, { seat: e.seat, at: o.at(e.seat), tier: e.tier }); break;
      case 'pairTier': put('pair', 0.6 + 0.1 * e.tier, 0, { seat: e.seat, at: mid(), tier: e.tier, slow: WEIGHT.PAIR_SLOW, slowS: (WEIGHT.PAIR_BEATS * 60) / Math.max(40, o.bpm || 112) }); break;
      case 'merge': put('merge', 0.8, 0, { at: mid() }); break;
      case 'finale': if (e.fused) put('fusion', 1, 0, { at: mid() }); break;
    }
  }
  return out;
}

/** the finale's lift at its top (finale.ts): the fused duet held a moment */
export const liftJuice = (base: number, flyer: number, at: V3): Juice => ({ k: 'juice', what: 'lift', w: 1, hold: WEIGHT.FRAMES.lift, seat: base, other: flyer, at });

/** the camera's kind for a moment (src/duel/camera.ts DuelCamera.impulse) */
export const camKind = (what: JuiceWhat): 'catch' | 'fling' | 'tier' | 'lift' | 'merge' =>
  what === 'fling' ? 'fling' : what === 'tier' || what === 'pair' ? 'tier' : what === 'lift' ? 'lift' : what === 'merge' || what === 'fusion' ? 'merge' : 'catch';

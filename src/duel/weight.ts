/// The weight of contact (phase 3, "Juice": report 13's first issue, a catch that had no weight; phase 4: report 15's
// third issue, "the weight is real but too short and too common to feel": 45 holds a minute of 3 to 6 frames read as a
// hitch). Fewer, longer holds, scaled by the moment, and a breath rather than a stop:
//   hold   only where the moment is big: none on a ground catch or a fling's release; an air catch 5 frames; a catch
//          at range (through a whip or an arc) 10, at a geyser's top 11, the finale's lift at its top 12. The bodies'
//          time settles in over the catch's first two frames (0.45, then down to 0.05: the weight arriving), breathes
//          from 0.05 up to 0.16 through the hold (they drift, gathering), then eases back to full over 0.12 s + 0.8 ×
//          the hold with no step in speed (the swing eases out of it, never snaps back). A hold within GAP_S of the
//          last one's end is let go unless it is longer (two air catches in a row are one breath, not two hitches).
//          Not a frozen page: the bodies and the sim run at the warp's scale, while the contact's ring and the link's
//          beads (fx.ts, on the page's own time), the HUD, the camera and the music go on at full speed
//   slow   a pair tier (the two's chain, shared/duel.ts PAIR_TIERS): a beat of slow motion at 0.36, eased in over its
//          first 30 % and out over its last 55 %, with no step in speed (the HUD's dappled light over the same beat:
//          src/hud/pair.ts)
// Each moment is a `juice` event in the duel's event stream (shared/duel.ts DuelEvent): what it was, how big (`w`),
// where (`at`), the frames held (as applied: 0 when the warp let it go) and the slow motion, so the camera (an ease
// toward it that arrives as the hold lets go: camera.ts `impulse`), the sound and the film's log key off the same
// thing. Pure: the page (index.ts) scales the frame's dance time by `TimeWarp.step`, the Node harness (sim.ts) its
// fixed step.
import type { DuelEvent, JuiceWhat } from '../../shared/duel.ts';
import type { ContactEvent } from './contact';

type V3 = [number, number, number];
export type Juice = Extract<DuelEvent, { k: 'juice' }>;

export const WEIGHT = {
  /** the bodies' time as a hold lands (its first frame), at its floor (from IN_FRAMES on) and at its end (a breath) */
  HOLD_LAND: 0.45,
  HOLD_SCALE: 0.05,
  HOLD_BREATH: 0.16,
  IN_FRAMES: 2,
  /** the ease back after a hold: EASE_S + EASE_PER × the hold (s) */
  EASE_S: 0.12,
  EASE_PER: 0.8,
  /** a hold this soon (s) after the last one's end is let go, unless it is longer */
  GAP_S: 1.5,
  /** frames held (a 60th of a second each); 0: none */
  FRAMES: { catch: 0, aerial: 5, range: 10, geyser: 11, fling: 0, lift: 12 } as Record<string, number>,
  /** a pair tier: the bodies' time at PAIR_SLOW for PAIR_BEATS beats, eased in over SLOW_IN of it and out over
   *  SLOW_OUT of it (shares) */
  PAIR_SLOW: 0.36,
  PAIR_BEATS: 1,
  SLOW_IN: 0.3,
  SLOW_OUT: 0.55,
  /** a fling's weight grows with its speed, full at this (m/s) */
  FLING_FULL: 15,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** smootherstep: no step in speed or acceleration at either end */
const ease = (x: number) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const mix = (a: number, b: number, u: number) => a + (b - a) * u;

/** the bodies' time, slowed by the moments: `step(dt)` each frame (dt the page's own), the scale for the frame's dance
 *  time */
export class TimeWarp {
  /** off: always 1 */
  on = true;
  /** the scale the last step gave */
  scale = 1;
  /** seconds of page time the warp has taken from the bodies (what the sets grew by) */
  lost = 0;
  /** holds applied, and let go (too soon after the last) */
  held = 0;
  skipped = 0;
  private holdLen = 0;
  private holdT = 0;
  private easeLen = 0;
  private easeLeft = 0;
  /** since the last hold ended (s), and its length */
  private since = Infinity;
  private lastLen = 0;
  private slow = 0;
  private slowLen = 0;
  private slowTo = 1;

  /** a moment's hold and slow motion; the hold as applied is written back into `j.hold` (0: let go) */
  add(j: Pick<Juice, 'hold' | 'slow' | 'slowS'>) {
    if (!this.on) return;
    if (j.hold > 0) {
      const len = j.hold / 60;
      if (this.holdLen > 0) {
        // (inside a hold: a longer moment stretches it to its own length from now)
        if (len > this.holdLen - this.holdT) { this.holdLen = this.holdT + len; this.held++; } else { j.hold = 0; this.skipped++; }
      } else if (this.since < WEIGHT.GAP_S && len <= this.lastLen) { j.hold = 0; this.skipped++; }
      else {
        // (still easing back from the last one: this hold starts at its floor, no second landing)
        const soft = this.easeLeft > 0, fin = WEIGHT.IN_FRAMES / 60;
        this.holdT = soft ? fin : 0; this.holdLen = len + this.holdT;
        this.easeLeft = 0; this.held++;
      }
    }
    if (j.slow != null && j.slowS) {
      // (a slow motion already running is extended, never deepened past the stronger one)
      if (this.slow <= 0 || j.slow <= this.slowTo) this.slowTo = j.slow;
      this.slow = Math.max(this.slow, j.slowS); this.slowLen = Math.max(this.slowLen, this.slow);
    }
  }
  /** let go of everything (the duel stopped, a new set) */
  reset() { this.holdLen = this.holdT = this.easeLen = this.easeLeft = this.slow = this.slowLen = this.lastLen = 0; this.since = Infinity; this.slowTo = 1; this.scale = 1; }

  /** the scale a hold gives `t` s into it (of `len` s) */
  static holdK(t: number, len: number) {
    const fin = WEIGHT.IN_FRAMES / 60;
    if (t < fin) return mix(WEIGHT.HOLD_LAND, WEIGHT.HOLD_SCALE, ease(t / fin));
    return mix(WEIGHT.HOLD_SCALE, WEIGHT.HOLD_BREATH, ease((t - fin) / Math.max(1e-3, len - fin)));
  }

  step(dt: number): number {
    if (!this.on) return (this.scale = 1);
    let k = 1;
    if (this.holdLen > 0) {
      k = TimeWarp.holdK(this.holdT, this.holdLen);
      this.holdT += dt;
      // (a frame's worth of hold left over by rounding is no frame: 1e-4 s)
      if (this.holdT >= this.holdLen - 1e-4) {
        this.lastLen = this.holdLen; this.easeLen = this.easeLeft = WEIGHT.EASE_S + WEIGHT.EASE_PER * this.holdLen;
        this.holdLen = this.holdT = 0; this.since = 0;
      }
    } else {
      this.since += dt;
      if (this.easeLeft > 0) {
        this.easeLeft = Math.max(0, this.easeLeft - dt);
        k = mix(WEIGHT.HOLD_BREATH, 1, ease(1 - this.easeLeft / this.easeLen));
      }
    }
    if (this.slow > 0) {
      const t = this.slowLen - this.slow, inK = ease(t / (WEIGHT.SLOW_IN * this.slowLen)), outK = ease(this.slow / (WEIGHT.SLOW_OUT * this.slowLen));
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

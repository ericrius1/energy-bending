// The arenas' gentle hazards (docs/design/duel.md, "Juice (phase 3)"): nature's own, never a punishment. Each one makes
// movement more interesting for a while, on the music's phrase (four bars), and shows itself before it acts:
//
//   tide   the temple: the sea comes in over the court for a while and goes out again (a slow swell of the tide over
//          sixteen bars, highest on a phrase's line). Water is a floor a body floats on: in it a body wades or swims
//          (slower), and floating it drifts with the tide's current, in while it rises, out while it falls; over the drops
//          and the drowned court it floats where it would have fallen. The court changes under the dancers: the low
//          stones go under, the drops become pools to swim across
//   wind   the redwoods: a gust through the clearing on most phrases, led in by leaves and needles on the air two beats
//          before it; it leans a body off its line (more in the air than on its feet), and a jump with it carries further
//   swell  the Pool: its water is a floor to swim in (no more falls: a body that misses a stone lands in the water with a
//          ripple, swims, and kicks up onto a stone), and on each phrase a swell rolls across it: the ice floes ride up
//          on it and the low stepping stones rock, a swimmer is lifted and carried along its crest, and a jump off the
//          crest (from the water or a floe on it) goes higher
//   hum    the geode: on each phrase a crystal hums (its glints rising for two bars first), then for a bar and a half
//          lifts whoever stands round it on a column of soft light, holding them floating at its top
//
// Through `Character.env` (updraft) and the bodies' velocity as the powers do (src/duel/powers.ts), the worlds' floors
// (the water a world's groundAt returns, `waterFloor`), and the Pool's moving stones (its solids, moved in place). Pure:
// the page (index.ts) and the Node harness (sim.ts) step it after the powers each frame. Each has a switch: the arena's
// `hazard.on` (and `&hazards=0` on the page, `hazards: false` in the harness).
import type { Character } from '../dancer/character';
import { planeNormal } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import type { Arena } from './arena';
import type { DuelMatch } from './match';

type V3 = [number, number, number];
type V2 = [number, number];

export type HazardKind = 'tide' | 'wind' | 'swell' | 'hum';

/** a Pool stone that moves with the swell: its solid (moved in place), where it rests, how much it rides (1 a floe, a
 *  stepping stone less), and its index in the world's draw list */
export interface Mover { solid: Extract<Solid, { kind: 'box' }>; rest: V3; k: number; index: number }

export interface Hazard {
  kind: HazardKind;
  /** the switch */
  on: boolean;
  /** the music's beat as last stepped (the worlds read their water from it) */
  beat: number;
  /** the tide: lowest and highest (m over the court), the cycle in bars */
  tide?: { low: number; high: number; bars: number };
  /** the swell: its height (m), half its width (m), its directions (rad from +x, one a phrase in turn), the movers and
   *  how far each has risen now (m) */
  swell?: { amp: number; width: number; reach: number; dirs: number[]; movers: Mover[]; bob: Float32Array; center: V2 };
  /** the wind: the gusts' directions (rad from +x, one a phrase in turn, by the phrase's hash), and how many phrases of
   *  ten have one */
  wind?: { dirs: number[]; often: number };
  /** the crystals' hum: the spots that lift (their foot), the column's radius and height */
  hum?: { spots: V3[]; r: number; h: number };
}

export const HAZARD = {
  /** a phrase: four bars of four */
  PHRASE: 16,
  /** a floating body's feet under the surface (m): water at its chest, its head and shoulders out */
  FLOAT: 1.15,
  /** a body counts as in the water with its feet this far under the surface */
  WADE: 0.3,
  /** in the water: the top speed across it (m/s), how fast faster is eased down to it (per s) */
  SWIM: 3.4, SWIM_EASE: 5,
  /** the tide's current on a floating body (m/s at its fastest change) */
  CURRENT: 0.9,
  /** the swell: its speed across the pool is its reach over SWELL_BEATS beats; the push along its crest (m/s at its top),
   *  a jump from its crest (m/s up, along) */
  SWELL_BEATS: 12, SWELL_DRIFT: 1.6, SWELL_JUMP: 3.2, SWELL_ALONG: 2.2,
  /** the wind: how hard it leans a body in the air (m/s²) and on its feet (m/s of drift), the speed along it past which
   *  it adds nothing (m/s); its warning (beats before), rise, hold and fall (beats) */
  GUST_AIR: 6.5, GUST_GROUND: 0.7, GUST_MAX: 4.5, GUST_WARN: 3, GUST_RISE: 1.5, GUST_HOLD: 6, GUST_FALL: 3,
  /** the hum: its warning (beats before the phrase), its lift (beats), the column's rise (m/s) */
  HUM_WARN: 8, HUM_BEATS: 6, HUM_UP: 6.5,
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
/** a phrase's dice (0 … 1) */
export const phraseHash = (p: number) => { const x = Math.sin(p * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- the hazards' own shapes, from the beat

/** the tide's height over the court at a beat: a cosine over `bars`, highest on the line between two of its phrases */
export function tideAt(H: Hazard, beat: number) {
  const T = H.tide!;
  return T.low + (T.high - T.low) * (0.5 - 0.5 * Math.cos((beat / (T.bars * 4)) * Math.PI * 2));
}
/** where the tide's cycle is (0 low … 0.5 high … 1), and whether it is coming in */
export function tidePhase(H: Hazard, beat: number) { const u = beat / (H.tide!.bars * 4); return u - Math.floor(u); }

/** the swell now: its way (unit), the crest's place along it (m from the pool's middle), and how far through it is (0 …
 *  1 while it crosses; past 1 between swells) */
export function swellNow(H: Hazard, beat: number) {
  const S = H.swell!, p = Math.floor(beat / HAZARD.PHRASE), b = beat - p * HAZARD.PHRASE;
  const a = S.dirs[((p % S.dirs.length) + S.dirs.length) % S.dirs.length], dir: V2 = [Math.cos(a), Math.sin(a)];
  const u = b / HAZARD.SWELL_BEATS;
  return { dir, crest: -S.reach + 2 * S.reach * u, u, phrase: p };
}
/** the swell's height at (x, z) now (m over the still water) */
export function swellAt(H: Hazard, x: number, z: number, beat: number) {
  const S = H.swell!, w = swellNow(H, beat);
  if (w.u >= 1.05) return 0;
  const along = (x - S.center[0]) * w.dir[0] + (z - S.center[1]) * w.dir[1], d = (along - w.crest) / S.width;
  // (it gathers as it comes in and dies as it leaves)
  const env = smooth(w.u / 0.12) * smooth((1.05 - w.u) / 0.15);
  return S.amp * env * Math.exp(-d * d);
}

/** the wind now: its way (unit) and strength (0 … 1), and what is coming (the leaves fly before the gust) */
export function gustNow(H: Hazard, beat: number) {
  const W = H.wind!, P = HAZARD, p = Math.floor((beat + P.GUST_WARN) / P.PHRASE), b = beat - p * P.PHRASE;
  const has = phraseHash(p) * 10 < W.often;
  const a = W.dirs[((p % W.dirs.length) + W.dirs.length) % W.dirs.length] + (phraseHash(p + 0.5) - 0.5) * 0.6;
  const dir: V2 = [Math.cos(a), Math.sin(a)];
  // b runs from -GUST_WARN (the leaves) through the rise, the hold and the fall
  const s = !has ? 0 : b < 0 ? 0 : b < P.GUST_RISE ? smooth(b / P.GUST_RISE) : b < P.GUST_RISE + P.GUST_HOLD ? 1 : smooth(1 - (b - P.GUST_RISE - P.GUST_HOLD) / P.GUST_FALL);
  const warn = has && b < 0 ? smooth((b + P.GUST_WARN) / P.GUST_WARN) : 0;
  return { dir, strength: s, warn, phrase: p, has };
}

/** the hum now: the spot that lifts this phrase (and the next), its lift (0 … 1) and its warning (0 … 1) */
export function humNow(H: Hazard, beat: number) {
  const M = H.hum!, P = HAZARD, p = Math.floor(beat / P.PHRASE), b = beat - p * P.PHRASE;
  const at = (q: number) => M.spots[((q % M.spots.length) + M.spots.length) % M.spots.length];
  const lift = b < P.HUM_BEATS ? smooth(b / 0.5) * smooth((P.HUM_BEATS - b) / 0.75) : 0;
  const warn = b > P.PHRASE - P.HUM_WARN ? smooth((b - (P.PHRASE - P.HUM_WARN)) / P.HUM_WARN) : 0;
  return { spot: at(p), next: at(p + 1), lift, warn, phrase: p };
}

/** the water's surface at (x, z) now, or null where there is none (the temple's tide, the Pool's water and its swell) */
export function waterAt(H: Hazard | undefined, x: number, z: number, beat = H?.beat ?? 0): number | null {
  if (!H) return null;
  if (H.kind === 'tide') return H.on ? tideAt(H, beat) : null;
  if (H.kind === 'swell') return H.on ? swellAt(H, x, z, beat) : 0;
  return null;
}
/** the floor the water makes at (x, z): where a floating body's feet are (none: -Infinity) */
export function waterFloor(H: Hazard | undefined, x: number, z: number, beat = H?.beat ?? 0) {
  const w = waterAt(H, x, z, beat);
  return w == null ? -Infinity : w - HAZARD.FLOAT;
}
/** a world's floor with its water on it */
export const withWater = (H: Hazard | undefined, ground: (x: number, z: number) => number) => (x: number, z: number) => Math.max(ground(x, z), waterFloor(H, x, z));

// ---------------------------------------------------------------- the arenas' hazards

export const tideHazard = (o: { low: number; high: number; bars: number }): Hazard => ({ kind: 'tide', on: true, beat: 0, tide: o });
export const windHazard = (o: { dirs: number[]; often: number }): Hazard => ({ kind: 'wind', on: true, beat: 0, wind: o });
export const humHazard = (o: { spots: V3[]; r: number; h: number }): Hazard => ({ kind: 'hum', on: true, beat: 0, hum: o });
export const swellHazard = (o: { amp: number; width: number; reach: number; dirs: number[]; movers: Mover[]; center?: V2 }): Hazard =>
  ({ kind: 'swell', on: true, beat: 0, swell: { ...o, center: o.center ?? [0, 0], bob: new Float32Array(o.movers.length) } });

/** the arena's hazard on or off (the movers back at rest when off) */
export function setHazards(a: Arena, on: boolean) {
  const H = a.hazard;
  if (!H) return;
  H.on = on;
  if (!on && H.swell) { for (const m of H.swell.movers) m.solid.c[1] = m.rest[1]; H.swell.bob.fill(0); }
}

// ---------------------------------------------------------------- what the bodies feel

/** what a virtual player sees of the hazard (DuelSight.hazard) */
export interface HazardSight {
  kind: HazardKind;
  /** the water's surface at a point now (null: none there) */
  water(x: number, z: number): number | null;
  /** the wind now and the one coming (way × strength) */
  wind: V2; windSoon: V2;
  /** the hum's columns: live now, or coming */
  lifts: { at: V3; r: number; h: number; live: boolean; soon: boolean }[];
  /** the swell's crest: its way, and the height under a point */
  swell: ((x: number, z: number) => number) | null;
}

/** a moment the hazards show (hazards-fx.ts draws them) */
export type HazardFx =
  | { k: 'splash'; seat: number; at: V3; strength: number }
  | { k: 'crest'; seat: number; at: V3 }
  | { k: 'lift'; seat: number; at: V3 };

export interface HazardsOptions {
  /** the hazard on (default the arena's own switch) */
  on?: boolean;
}

export class DuelHazards {
  readonly hazard: Hazard | null;
  /** this frame's moments, each ride and how long, seconds in the water */
  fx: HazardFx[] = [];
  readonly rides: Record<string, { n: number; s: number }> = {};
  waterS = 0;
  private wasIn = [false, false];
  /** what each seat rides now ('tide', 'swell', 'gust', 'hum'), or null */
  readonly ride: (string | null)[] = [null, null];
  private rideT = [0, 0];
  private crestUsed = [-1, -1];

  constructor(readonly chars: readonly [Character, Character], readonly match: DuelMatch, readonly arena: Arena, readonly o: HazardsOptions = {}) {
    this.hazard = arena.hazard ?? null;
    if (this.hazard && o.on !== undefined) setHazards(arena, o.on);
  }
  get on() { return !!this.hazard?.on; }

  /** what a virtual player sees of it now */
  sight(): HazardSight | null {
    const H = this.hazard;
    if (!H || !H.on) return null;
    const b = H.beat;
    const out: HazardSight = { kind: H.kind, water: (x, z) => waterAt(H, x, z, b), wind: [0, 0], windSoon: [0, 0], lifts: [], swell: null };
    if (H.kind === 'wind') {
      const g = gustNow(H, b);
      out.wind = [g.dir[0] * g.strength, g.dir[1] * g.strength];
      out.windSoon = [g.dir[0] * Math.max(g.warn, g.strength), g.dir[1] * Math.max(g.warn, g.strength)];
    } else if (H.kind === 'hum') {
      const m = humNow(H, b);
      out.lifts.push({ at: m.spot, r: H.hum!.r, h: H.hum!.h, live: m.lift > 0.2, soon: false });
      if (m.warn > 0.1) out.lifts.push({ at: m.next, r: H.hum!.r, h: H.hum!.h, live: false, soon: true });
    } else if (H.kind === 'swell') out.swell = (x, z) => swellAt(H, x, z, b);
    return out;
  }

  /** a ride of a hazard: begun (counted once it has lasted `min` s), going on */
  private riding(k: number, kind: string | null, dt: number, min = 0.25) {
    if (kind !== this.ride[k]) { this.ride[k] = kind; this.rideT[k] = 0; }
    if (!kind) return;
    const R = (this.rides[kind] ??= { n: 0, s: 0 });
    const was = this.rideT[k];
    this.rideT[k] += dt;
    if (was < min && this.rideT[k] >= min) { R.n++; R.s += this.rideT[k]; }
    else if (this.rideT[k] >= min) R.s += dt;
  }

  /** each frame, after the powers (their env first, the hazard's on top) */
  step(beat: number, dtMs: number) {
    const H = this.hazard, dt = dtMs / 1000;
    this.fx = [];
    if (!H) return;
    H.beat = beat;
    if (!H.on) return;
    const P = HAZARD, phase = this.match.state.phase;
    // the Pool's stones on the swell (moved in place: the bodies standing on them ride up with them)
    if (H.swell) {
      const S = H.swell;
      S.movers.forEach((m, i) => {
        const h = swellAt(H, m.rest[0], m.rest[2], beat) * m.k;
        S.bob[i] = h;
        m.solid.c[1] = m.rest[1] + h;
      });
    }
    const gust = H.kind === 'wind' ? gustNow(H, beat) : null;
    const hum = H.kind === 'hum' ? humNow(H, beat) : null;
    for (let k = 0; k < 2; k++) {
      const c = this.chars[k];
      const out = c.reforming || this.match.frozen(k) || phase !== 'play';
      const carried = !!c.env.held || this.match.contact.held(k);
      let ride: string | null = null;
      const r = c.root;
      // ---- water: wading and swimming, floating, the current, the swell
      const w = waterAt(H, r[0], r[2], beat);
      if (w != null && !out) {
        const under = w - r[1], inWater = under > P.WADE;
        if (inWater && !this.wasIn[k] && !c.grounded) this.fx.push({ k: 'splash', seat: k, at: [r[0], w, r[2]], strength: clamp(-c.v[1] / 8, 0.25, 1) });
        else if (inWater && !this.wasIn[k]) this.fx.push({ k: 'splash', seat: k, at: [r[0], w, r[2]], strength: 0.2 });
        this.wasIn[k] = inWater;
        if (inWater) {
          this.waterS += dt;
          // (afloat: on the water's own floor, not a stone under it)
          const floating = c.grounded && Math.abs(r[1] - (w - P.FLOAT)) < 0.06;
          if (c.grounded && !carried) {
            // (slower across the water: wading, swimming)
            const sp = Math.hypot(c.v[0], c.v[2]);
            if (sp > P.SWIM) { const s = (P.SWIM + (sp - P.SWIM) * Math.exp(-P.SWIM_EASE * dt)) / sp; c.v = [c.v[0] * s, c.v[1], c.v[2] * s]; }
          }
          if (floating && !carried) {
            let drift: V2 = [0, 0];
            if (H.kind === 'tide') {
              // the current: in from the sea (behind the court, -z) toward the great gate while the tide rises, out
              // while it falls, fastest at mid tide
              const u = tidePhase(H, beat), s = Math.sin(u * Math.PI * 2) * P.CURRENT;
              drift = [0, s];
              ride = 'tide';
            } else if (H.kind === 'swell') {
              const sw = swellNow(H, beat), h = swellAt(H, r[0], r[2], beat) / H.swell!.amp;
              drift = [sw.dir[0] * P.SWELL_DRIFT * h, sw.dir[1] * P.SWELL_DRIFT * h];
              if (h > 0.25) ride = 'swell';
            }
            this.push(c, drift, dt);
          }
        }
        // a jump off the swell's crest (from the water, or a floe or a stone riding it) goes higher, on with it
        if (H.kind === 'swell' && !carried) {
          const jumped = (this.match.bodyEvents[k] ?? []).some((e) => e.type === 'jump' && !e.air);
          const sw = swellNow(H, beat), h = this.crestUnder(H, c, beat);
          if (jumped && h > 0.35 && this.crestUsed[k] !== sw.phrase) {
            this.crestUsed[k] = sw.phrase;
            const f = this.flat(c, [sw.dir[0] * P.SWELL_ALONG * h, 0, sw.dir[1] * P.SWELL_ALONG * h]);
            c.v = [c.v[0] + f[0], c.v[1] + P.SWELL_JUMP * h, c.v[2] + f[2]];
            this.fx.push({ k: 'crest', seat: k, at: [r[0], r[1], r[2]] });
            const R = (this.rides.crest ??= { n: 0, s: 0 }); R.n++;
          }
        }
      } else this.wasIn[k] = false;
      // ---- the wind: a lean off the line, more in the air
      if (gust && gust.strength > 0.02 && !out && !carried) {
        const d = gust.dir, along = c.v[0] * d[0] + c.v[2] * d[1];
        if (!c.grounded) {
          if (along < P.GUST_MAX) {
            const f = this.flat(c, [d[0] * P.GUST_AIR * gust.strength * dt, 0, d[1] * P.GUST_AIR * gust.strength * dt]);
            c.v = [c.v[0] + f[0], c.v[1], c.v[2] + f[2]];
          }
          if (gust.strength > 0.3 && along > 1.2) ride = 'gust';
        } else this.push(c, [d[0] * P.GUST_GROUND * gust.strength, d[1] * P.GUST_GROUND * gust.strength], dt);
      }
      // ---- the hum: a column of soft light lifts whoever stands round the crystal, holding them at its top
      if (hum && hum.lift > 0 && !out && !carried) {
        const s = hum.spot, M = H.hum!, rel = r[1] - s[1];
        if (Math.hypot(r[0] - s[0], r[2] - s[2]) < M.r && rel > -0.6 && rel < M.h + 0.5) {
          const want = P.HUM_UP * hum.lift * clamp((M.h - rel) / 1.6, -0.3, 1);
          // (the column holds its riders: drawn in toward its middle, their drift across it eased)
          const e = Math.exp(-2 * dt), f = this.flat(c, [(s[0] - r[0]) * 4 * dt, 0, (s[2] - r[2]) * 4 * dt]);
          let vy = c.v[1];
          if (vy < want) vy += (want - vy) * (1 - Math.exp(-10 * dt));
          c.v = [c.v[0] * e + f[0], vy, c.v[2] * e + f[2]];
          if (c.grounded && c.v[1] > 0.5) { c.grounded = false; c.support = null; }
          c.env.updraft = Math.max(c.env.updraft, 1);
          if (!this.ride[k] || this.ride[k] !== 'hum') this.fx.push({ k: 'lift', seat: k, at: [r[0], r[1], r[2]] });
          ride = 'hum';
        }
      }
      this.riding(k, out ? null : ride, dt);
    }
  }

  /** the swell's height under a body standing in it, on a floe riding it, or just off either */
  private crestUnder(H: Hazard, c: Character, beat: number) {
    const r = c.root, h = swellAt(H, r[0], r[2], beat);
    return r[1] < h + 0.6 ? h / H.swell!.amp : 0;
  }
  /** a drift on a body: moved with it (free), or carried along the plane (locked: env.carryX on the ground) */
  private push(c: Character, d: V2, dt: number) {
    if (c.plane) { c.env.carryX += d[0] * c.plane.right[0] + d[1] * c.plane.right[2]; return; }
    c.root = [c.root[0] + d[0] * dt, c.root[1], c.root[2] + d[1] * dt];
  }
  /** a direction kept in a locked body's plane */
  private flat(c: Character, v: V3): V3 {
    if (!c.plane) return v;
    const n = planeNormal(c.plane), d = v[0] * n[0] + v[2] * n[2];
    return [v[0] - n[0] * d, v[1], v[2] - n[2] * d];
  }
}

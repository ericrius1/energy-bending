// How the arenas' hazards are seen (src/duel/hazards.ts does them; this draws them), with the matter and the field the
// game already has: the worlds' water and its ripples, glints of light on it, leaves and needles on the wind, the field's
// wind (the redwoods' grass and every flame lean into a gust), the crystals' own light. Gentle, as the hazards are:
//   water    a body landing in it: a ring opening on the surface, a few drops thrown up, the water rippled; afloat, a
//            soft ring now and then round it
//   tide     moonlit glints drifting on the water round the pair with the tide's current (in while it rises, out while
//            it falls), and the current's ripples moving with them: the sea's way can be read before a body floats on it
//   wind     leaves (warm and green) and needles (thin streaks) carried across the clearing round the pair, a few from
//            two beats before the gust and many while it blows, and the field's wind with them
//   swell    the crest pushed into the water as it rolls (ripples along its line), foam glinting along it; a jump off it
//            a spray of foam
//   hum      glints rising round the crystal that will hum, two bars before it lifts; then a column of light: rings
//            rising, points of light spiralling up it, the field drawn up with it
import type { Glows, RGB } from '../play/glow';
import { gustNow, humNow, swellAt, swellNow, tideAt, tidePhase, HAZARD, type DuelHazards } from './hazards';

type V3 = [number, number, number];

export interface HazardFxCtx {
  glows: Glows;
  field?: {
    deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void;
    vortex(id: string, v: { at: V3; axis?: V3; strength: number; radius: number; inflow?: number; lift?: number; height?: number } | null): void;
  } | null;
  /** the world's water, rippled (the temple, the pool) */
  ripple?: (x: number, z: number, strength: number, radius: number) => void;
  /** the world's floor (with its water): the swell's foam keeps to open water */
  ground?: (x: number, z: number) => number;
  /** the camera's eye: what the hazards draw fades out within a few metres of it (a crest or a leaf against the lens) */
  eye?: () => ArrayLike<number>;
}

/** the glows as the hazards draw them */
type Draw = Pick<Glows, 'dot' | 'seg' | 'flat'>;

const FOAM: RGB = [1.15, 1.4, 1.65], GLINT: RGB = [1.5, 1.55, 1.6];
const LEAVES: RGB[] = [[0.55, 0.9, 0.3], [0.95, 0.85, 0.3], [0.8, 0.55, 0.22], [0.45, 0.75, 0.32]];
const NEEDLE: RGB = [0.7, 0.85, 0.45];
// (the hum: the selenite's honey light and the fungi's teal, the geode's greenhouse colours since phase 4; it was violet)
const HONEY: RGB = [1.45, 1.1, 0.62], VIOLET: RGB = [0.6, 1.35, 1.15];
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const wrap = (x: number, h: number) => ((((x + h) % (2 * h)) + 2 * h) % (2 * h)) - h;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class HazardFxDraw {
  private t = 0;
  private moments: { t: number; life: number; draw(u: number): void }[] = [];
  private ringT = [0, 0];
  private vortex = false;

  /** the glows, faded near the eye */
  private G: Draw;

  constructor(private ctx: HazardFxCtx) {
    const g = ctx.glows;
    const fade = (p: ArrayLike<number>) => {
      const e = this.ctx.eye?.();
      if (!e) return 1;
      const d = Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]), u = Math.max(0, Math.min(1, (d - 1.5) / 3));
      return u * u * (3 - 2 * u);
    };
    this.G = {
      dot: (p, r, col, I = 1, shape = 'soft') => g.dot(p, r, col, I * fade(p), shape),
      seg: (a, b, r, col, I = 1, shape = 'soft') => g.seg(a, b, r, col, I * Math.min(fade(a), fade(b)), shape),
      flat: (p, r, col, I = 1, shape = 'ring') => g.flat(p, r, col, I * fade(p), shape),
    };
  }

  private moment(life: number, draw: (u: number) => void) { this.moments.push({ t: this.t, life, draw }); }

  /** everything gone (the duel's end) */
  clear() {
    this.moments.length = 0;
    if (this.vortex) { this.ctx.field?.vortex('duel.hum', null); this.vortex = false; }
  }

  /** each frame, after the hazards' step */
  update(dt: number, Z: DuelHazards) {
    this.t += dt;
    const H = Z.hazard, G = this.G;
    if (!H || !H.on) { this.clear(); return; }
    const b = H.beat, C = Z.chars;
    const mid: V3 = [(C[0].root[0] + C[1].root[0]) / 2, (C[0].root[1] + C[1].root[1]) / 2, (C[0].root[2] + C[1].root[2]) / 2];
    // ---- the moments: a landing in the water, a jump off the crest, a lift begun
    for (const e of Z.fx) {
      const p = e.at;
      if (e.k === 'splash') {
        const s = e.strength;
        this.ctx.ripple?.(p[0], p[2], 0.6 + 1.2 * s, 0.45 + 0.4 * s);
        this.moment(0.7 + 0.4 * s, (u) => {
          G.flat([p[0], p[1] + 0.02, p[2]], 0.25 + (0.9 + 0.8 * s) * u, FOAM, 1.1 * (1 - u) * (1 - u), 'ring');
          for (let j = 0; j < 7; j++) {
            const a = j * 2.4 + p[0], r = (0.25 + 0.5 * hash(j + p[2])) * u * (1 + s), up = (2.2 + 2 * hash(j + 5)) * s;
            const age = u * 0.7, y = p[1] + up * age - 4.5 * age * age;
            if (y > p[1] - 0.05) G.dot([p[0] + Math.cos(a) * r, y, p[2] + Math.sin(a) * r], 0.035, FOAM, 1.3 * (1 - u), 'spark');
          }
        });
      } else if (e.k === 'crest') {
        this.ctx.ripple?.(p[0], p[2], 1.2, 0.8);
        this.moment(0.6, (u) => {
          G.flat([p[0], p[1] + 0.03, p[2]], 0.4 + 1.1 * u, FOAM, (1 - u) * 1.2, 'ring');
          for (let j = 0; j < 9; j++) { const a = j * 0.7, r = 0.3 + u * 1.2; G.dot([p[0] + Math.cos(a) * r, p[1] + 0.25 + u * 0.8 - u * u * 1.2, p[2] + Math.sin(a) * r], 0.04, FOAM, 1.4 * (1 - u), 'spark'); }
        });
      } else if (e.k === 'lift') {
        this.moment(0.6, (u) => G.flat([p[0], p[1] + 0.04, p[2]], 0.3 + 0.9 * u, HONEY, 1.0 * (1 - u), 'ring'));
      }
    }
    // ---- a body afloat: a soft ring round it now and then
    for (let k = 0; k < 2; k++) {
      const c = C[k], r = c.root, w = H.kind === 'tide' ? tideAt(H, b) : H.kind === 'swell' ? swellAt(H, r[0], r[2], b) : null;
      if (w == null || !c.grounded || Math.abs(r[1] - (w - HAZARD.FLOAT)) > 0.08) continue;
      if (this.t - this.ringT[k] > 0.65) {
        this.ringT[k] = this.t;
        this.ctx.ripple?.(r[0], r[2], 0.35, 0.5);
        const at: V3 = [r[0], w + 0.02, r[2]];
        this.moment(1.1, (u) => G.flat(at, 0.45 + 0.8 * u, FOAM, 0.45 * (1 - u), 'ring'));
      }
    }
    // ---- each hazard as it stands
    if (H.kind === 'tide') this.tide(Z, mid, G);
    else if (H.kind === 'wind') this.wind(Z, mid, G);
    else if (H.kind === 'swell') this.swell(Z, mid, G);
    else if (H.kind === 'hum') this.hum(Z, G);
    this.moments = this.moments.filter((m) => { const u = (this.t - m.t) / m.life; if (u >= 1) return false; m.draw(u); return true; });
  }

  /** glints drifting on the water with the tide's current, and its ripples moving with them */
  private tide(Z: DuelHazards, mid: V3, G: Draw) {
    const H = Z.hazard!, b = H.beat, w = tideAt(H, b), u = tidePhase(H, b);
    // (only where the water stands over the court: from a little over the floor)
    const over = Math.min(1, Math.max(0, (w + 0.1) / 0.4));
    if (over <= 0) return;
    const cur = Math.sin(u * Math.PI * 2), drift = cur * HAZARD.CURRENT * 1.6;
    const N = 36, R = 6.5;
    for (let i = 0; i < N; i++) {
      const x = mid[0] + (hash(i) - 0.5) * 2 * R, z = mid[2] + wrap((hash(i + 40) - 0.5) * 2 * R + this.t * drift, R);
      const tw = 0.5 + 0.5 * Math.sin(this.t * (2 + 3 * hash(i + 80)) + i);
      G.dot([x, w + 0.02, z], 0.03 + 0.02 * hash(i + 9), GLINT, over * (0.25 + 0.75 * Math.abs(cur)) * tw * 0.9, 'spark');
    }
    // the current's lines on the water: a few pushes across it, moving with it
    if (Math.abs(cur) > 0.2 && Math.floor(this.t * 8) !== Math.floor((this.t - 1 / 60) * 8)) {
      for (let j = 0; j < 3; j++) {
        const x = mid[0] + (hash(j + Math.floor(this.t * 8)) - 0.5) * 9, z = mid[2] + wrap(j * 4 + this.t * drift * 1.5, 6);
        this.ctx.ripple?.(x, z, 0.35 * Math.abs(cur) * over, 0.9);
      }
    }
  }

  /** leaves and needles on the wind, before and through a gust; the field's wind with them */
  private wind(Z: DuelHazards, mid: V3, G: Draw) {
    const H = Z.hazard!, g = gustNow(H, H.beat), I = Math.max(g.warn * 0.55, g.strength);
    if (I <= 0.01) return;
    const d = g.dir, sp = 2.5 + 6 * g.strength, R = 9;
    const n = Math.round(14 + 70 * I);
    for (let i = 0; i < n; i++) {
      const across = (hash(i) - 0.5) * 2 * R, along = wrap((hash(i + 100) - 0.5) * 2 * R + this.t * sp * (0.7 + 0.6 * hash(i + 7)), R);
      const y = 0.3 + 4.8 * hash(i + 200) + 0.35 * Math.sin(this.t * (1.5 + hash(i + 3) * 2) + i);
      const x = mid[0] + d[0] * along - d[1] * across, z = mid[2] + d[1] * along + d[0] * across;
      const p: V3 = [x, y, z];
      // (faded in at the edges of the drifting box, so leaves don't pop)
      const edge = Math.min(1, (R - Math.abs(along)) / 2, (R - Math.abs(across)) / 2);
      if (edge <= 0) continue;
      if (i % 3 === 0) {
        // a needle: a thin streak along its flight
        const L = 0.2 + 0.25 * g.strength;
        G.seg(p, [x - d[0] * L, y - 0.03, z - d[1] * L], 0.012, NEEDLE, 0.75 * I * edge, 'spark');
      } else {
        // a leaf: tumbling (its light flickers as it turns), a short blur behind it
        const flick = 0.45 + 0.55 * Math.abs(Math.sin(this.t * (4 + 4 * hash(i + 11)) + i * 1.3)), L = 0.06 + 0.12 * g.strength;
        G.seg(p, [x - d[0] * L, y + 0.02 * Math.sin(i), z - d[1] * L], 0.05 + 0.03 * hash(i + 13), LEAVES[i % LEAVES.length], 1.1 * I * edge * flick, 'soft');
      }
    }
    // the field's wind round the pair (the grass bends, every flame leans)
    if (g.strength > 0.05 && this.ctx.field) {
      for (const k of [0, 1]) {
        const r = Z.chars[k].root;
        this.ctx.field.deposit({ p: [r[0] - d[0] * 0.8, r[1] + 1, r[2] - d[1] * 0.8], r: 2.2, wind: [d[0] * 7 * g.strength, 0, d[1] * 7 * g.strength] });
      }
      this.ctx.field.deposit({ p: [mid[0] - d[0] * 4, 0.6, mid[2] - d[1] * 4], r: 3.5, wind: [d[0] * 6 * g.strength, 0, d[1] * 6 * g.strength] });
    }
  }

  /** the swell's crest: pushed into the water as it rolls, foam glinting on it */
  private swell(Z: DuelHazards, mid: V3, G: Draw) {
    const H = Z.hazard!, b = H.beat, s = swellNow(H, b);
    if (s.u >= 1.02) return;
    const S = H.swell!, d = s.dir;
    // the crest's line through the pair's part of the pool: a line of foam on it, glints along it, and the swell's back
    // a softer sheet of light a stride behind
    const along = s.crest, rel = (mid[0] - S.center[0]) * -d[1] + (mid[2] - S.center[1]) * d[0];
    let prev: V3 | null = null;
    for (let i = 0; i < 31; i++) {
      const across = rel + (i / 30 - 0.5) * 20;
      const x = S.center[0] + d[0] * along - d[1] * across, z = S.center[1] + d[1] * along + d[0] * across, h = swellAt(H, x, z, b), k = h / S.amp;
      const p: V3 = [x + d[0] * 0.2, h + 0.03, z + d[1] * 0.2];
      // (none over a stone or a floe: the foam is on open water, the line broken where a stone stands in it)
      const open = !this.ctx.ground || this.ctx.ground(p[0], p[2]) < h - 0.6;
      if (!open) { prev = null; continue; }
      if (prev && k > 0.05) {
        G.seg(prev, p, 0.07, FOAM, 0.55 * k, 'soft');
        G.seg([prev[0] - d[0] * 1.3, prev[1] * 0.4, prev[2] - d[1] * 1.3], [p[0] - d[0] * 1.3, p[1] * 0.4, p[2] - d[1] * 1.3], 0.35, [0.35, 0.55, 0.85], 0.12 * k, 'soft');
      }
      prev = p;
      const tw = 0.5 + 0.5 * Math.sin(this.t * 7 + i * 1.9);
      if (k > 0.1) G.dot([p[0] + (hash(i) - 0.5) * 0.3, p[1] + 0.03, p[2] + (hash(i + 4) - 0.5) * 0.3], 0.06, GLINT, 1.4 * k * tw, 'spark');
    }
    // (pushed into the ripples a few points at a time, the crest itself running through the water)
    for (let j = 0; j < 5; j++) {
      const across = rel + (hash(j + Math.floor(this.t * 30)) - 0.5) * 14;
      const x = S.center[0] + d[0] * (along + 0.4) - d[1] * across, z = S.center[1] + d[1] * (along + 0.4) + d[0] * across;
      const h = swellAt(H, x, z, b) / S.amp;
      if (h > 0.1) this.ctx.ripple?.(x, z, 0.55 * h, 1.1);
    }
  }

  /** the crystals' hum: glints rising round the next spot before it lifts, then the column */
  private hum(Z: DuelHazards, G: Draw) {
    const H = Z.hazard!, m = humNow(H, H.beat), M = H.hum!;
    const draw = (at: V3, I: number, live: boolean) => {
      const n = live ? 28 : 12;
      for (let i = 0; i < n; i++) {
        const v = (this.t * (live ? 0.9 : 0.35) + hash(i)) % 1, a = i * 2.39 + this.t * (live ? 1.6 : 0.6), r = M.r * (live ? 0.35 + 0.55 * hash(i + 3) : 0.8 + 0.2 * hash(i + 3));
        const y = at[1] + 0.1 + v * (live ? M.h : 1.6);
        G.dot([at[0] + Math.cos(a) * r, y, at[2] + Math.sin(a) * r], live ? 0.05 : 0.035, i % 2 ? HONEY : VIOLET, I * (1 - v) * (live ? 1.5 : 1.1), 'gem');
      }
      // a ring on the floor, pulsing with the beat; live, the column itself: a soft pillar of the selenite's light with
      // rings rising up it
      const pulse = 0.6 + 0.4 * Math.cos((H.beat % 1) * Math.PI * 2);
      G.flat([at[0], at[1] + 0.04, at[2]], M.r * (live ? 1 : 0.85), mix(HONEY, VIOLET, 0.3), I * pulse * (live ? 1.3 : 0.9), 'ring');
      if (live) {
        G.seg([at[0], at[1] + 0.3, at[2]], [at[0], at[1] + M.h, at[2]], M.r * 0.75, HONEY, 0.16 * I, 'soft');
        for (let j = 0; j < 4; j++) { const v = (this.t * 0.6 + j / 4) % 1; G.flat([at[0], at[1] + 0.1 + v * M.h, at[2]], M.r * (0.95 - 0.35 * v), HONEY, I * (1 - v) * 0.8, 'ring'); }
      } else G.seg([at[0], at[1] + 0.2, at[2]], [at[0], at[1] + 1.4 * I, at[2]], 0.35, VIOLET, 0.2 * I, 'soft');
    };
    if (m.warn > 0.02) draw(m.next, m.warn, false);
    if (m.lift > 0.02) draw(m.spot, m.lift, true);
    // the field drawn up the column with it (the motes, any flame or steam in it)
    if (m.lift > 0.05) { this.ctx.field?.vortex('duel.hum', { at: m.spot, strength: 1.5 * m.lift, radius: M.r, inflow: 0.4, lift: 3 * m.lift, height: M.h }); this.vortex = true; }
    else if (this.vortex) { this.ctx.field?.vortex('duel.hum', null); this.vortex = false; }
  }
}

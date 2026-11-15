// The moments probe (phase 4, report 15's issue 2: "the big moments bury themselves in their own juice"). What a
// player sees at a moment of contact: how many words are on screen at once, and how much of each body is covered by a
// word, a HUD ring or the moment's own light (the contact's ring and flash, a reaction's bloom, the geyser's column).
// Read in the page after each frame is drawn (scripts/moments-cap.mjs steps seeded sets by hand and samples every
// frame): the bodies' projected bounds from their skeletons, the HUD's last drawn words and rings (bend.hud.cover),
// and the duel's moment lights (fx.ts and power-fx.ts `lit`: ranges of the glow list). Pure geometry; nothing drawn.
//   peak   a frame within PEAK_S after a reaction, a pair tier or a solo tier, a merge, a catch at range or at a
//          geyser's top (the moments that piled up in the film)
//   catch  a frame within PEAK_S after any catch (the everyday moment)
import type { DuelEvent } from '../../shared/duel.ts';
import { GLOW_FLOATS } from '../play/glow';

type V3 = [number, number, number];
type Proj = (p: V3) => [number, number];
export interface Box { x: number; y: number; w: number; h: number }
export interface HudCover { W: number; H: number; words: Box[]; rings: { x: number; y: number; r: number; w: number }[] }

/** how long after a moment its frames count (s) */
export const PEAK_S = 0.6;
/** a body counts as covered when more than this share of its core (hips to head) is under a word, a ring or the
 *  moment's light */
export const COVERED = 0.15;
/** a glow brighter than this lands on what is under it */
const LIT_MIN = 0.3;

/** a body's box on screen (px of a W × H screen) from some of its joints (the skeleton's world, JOINT_FLOATS a
 *  joint), padded by a share of its size (the matter reaches past the bones; a torso is thin on screen) */
export function bodyBox(world: ArrayLike<number>, joints: readonly number[], project: Proj, W: number, H: number, padX = 0.08, padY = 0.04): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const j of joints) {
    const o = j * 12, s = project([world[o], world[o + 1], world[o + 2]]);
    if (!(s[0] > -0.5 && s[0] < 1.5 && s[1] > -0.5 && s[1] < 1.5)) continue;
    x0 = Math.min(x0, s[0] * W); x1 = Math.max(x1, s[0] * W); y0 = Math.min(y0, s[1] * H); y1 = Math.max(y1, s[1] * H);
  }
  if (!(x1 >= x0) || !(y1 > y0)) return null;
  const h = y1 - y0, px = Math.max(3, (x1 - x0) * padX, h * (padX > 0.1 ? padX : 0)), py = Math.max(3, h * padY);
  return { x: x0 - px, y: y0 - py, w: x1 - x0 + 2 * px, h: h + 2 * py };
}
/** the whole body's joints (the CMU rig's 38), and its core: hips, back, chest, neck and head */
export const ALL_JOINTS = Array.from({ length: 38 }, (_, i) => i);
export const CORE_JOINTS = [0, 13, 14, 15, 16, 17, 18, 19];

/** a footprint on screen a point can be under */
type Foot = { k: 'disc'; x: number; y: number; r: number } | { k: 'ring'; x: number; y: number; r: number; w: number } | { k: 'box'; b: Box } | { k: 'poly'; xs: number[]; ys: number[] };

/** the moment lights' footprints on screen (px), from the glow list's ranges */
export function lightFeet(data: Float32Array, ranges: readonly [number, number][], project: Proj, W: number, H: number): Foot[] {
  const out: Foot[] = [];
  const sc = (p: V3): [number, number] => { const s = project(p); return [s[0] * W, s[1] * H]; };
  const rad = (p: V3, r: number) => { const a = sc(p), b = sc([p[0], p[1] + r, p[2]]); return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  for (const [g0, g1] of ranges) {
    for (let i = g0; i < g1; i++) {
      const o = i * GLOW_FLOATS, I = data[o + 7];
      if (!(I >= LIT_MIN)) continue;
      const a: V3 = [data[o], data[o + 1], data[o + 2]], b: V3 = [data[o + 4], data[o + 5], data[o + 6]], r = data[o + 3], kind = data[o + 11];
      const shape = kind % 4, flat = kind >= 4;
      if (flat) {
        // (a ring or a disc lying on the floor: its circle projected)
        const xs: number[] = [], ys: number[] = [];
        for (let k = 0; k < 16; k++) { const t = (k / 16) * Math.PI * 2, s = sc([a[0] + Math.cos(t) * r, a[1], a[2] + Math.sin(t) * r]); xs.push(s[0]); ys.push(s[1]); }
        if (shape === 1) for (let k = 0; k < 16; k++) { const n = (k + 1) % 16, w = Math.max(2, 0.5 * Math.hypot(xs[n] - xs[k], ys[n] - ys[k])); out.push({ k: 'disc', x: xs[k], y: ys[k], r: w }); }
        else out.push({ k: 'poly', xs, ys });
        continue;
      }
      const same = a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
      const R = rad(a, r);
      if (same) {
        const c = sc(a);
        if (shape === 1) out.push({ k: 'ring', x: c[0], y: c[1], r: R, w: Math.max(2, 0.2 * R) });
        else out.push({ k: 'disc', x: c[0], y: c[1], r: Math.max(1.5, R * (shape === 0 ? 0.6 : 0.5)) });
      } else {
        for (let k = 0; k <= 4; k++) { const u = k / 4, p: V3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], c = sc(p); out.push({ k: 'disc', x: c[0], y: c[1], r: Math.max(1.5, R * 0.8) }); }
      }
    }
  }
  return out;
}

const inPoly = (x: number, y: number, xs: number[], ys: number[]) => {
  let c = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i] || 1e-9) + xs[i]) c = !c;
  return c;
};
const under = (x: number, y: number, f: Foot) => {
  switch (f.k) {
    case 'disc': return (x - f.x) ** 2 + (y - f.y) ** 2 < f.r * f.r;
    case 'ring': return Math.abs(Math.hypot(x - f.x, y - f.y) - f.r) < f.w;
    case 'box': return x >= f.b.x && x <= f.b.x + f.b.w && y >= f.b.y && y <= f.b.y + f.b.h;
    case 'poly': return inPoly(x, y, f.xs, f.ys);
  }
};

/** the share of a body's box under the feet (sampled on a 7 × 11 grid) */
export function coverOf(b: Box, feet: readonly Foot[]): number {
  if (!feet.length) return 0;
  let n = 0, hit = 0;
  for (let j = 0; j < 11; j++) for (let i = 0; i < 7; i++) {
    const x = b.x + ((i + 0.5) / 7) * b.w, y = b.y + ((j + 0.5) / 11) * b.h;
    n++;
    for (const f of feet) if (under(x, y, f)) { hit++; break; }
  }
  return hit / n;
}

/** the HUD's words and rings as feet */
export function hudFeet(c: HudCover, W: number, H: number): Foot[] {
  const kx = c.W ? W / c.W : 1, ky = c.H ? H / c.H : 1;
  return [
    ...c.words.map((b): Foot => ({ k: 'box', b: { x: b.x * kx, y: b.y * ky, w: b.w * kx, h: b.h * ky } })),
    ...c.rings.map((r): Foot => (r.w > 0 ? { k: 'ring', x: r.x * kx, y: r.y * ky, r: r.r * kx, w: r.w * kx } : { k: 'disc', x: r.x * kx, y: r.y * ky, r: r.r * kx })),
  ];
}

/** the peak moments among a frame's events (and the powers' moments: a reaction) */
export function peaksOf(ev: readonly DuelEvent[], power: readonly { k: string }[]): { peak: string[]; catch: boolean } {
  const peak: string[] = [];
  let caught = false;
  for (const e of ev) {
    if (e.k === 'pairTier') peak.push('pair');
    else if (e.k === 'tier') peak.push('tier');
    else if (e.k === 'merge') peak.push('merge');
    else if (e.k === 'juice' && (e.what === 'range' || e.via === 'geyser')) peak.push(e.via === 'geyser' ? 'geyser' : 'range');
    if (e.k === 'juice' && (e.what === 'catch' || e.what === 'aerial' || e.what === 'range')) caught = true;
  }
  for (const p of power) if (p.k === 'react') peak.push('react');
  return { peak, catch: caught };
}

interface Tally { frames: number; words: number[]; covered: number; cover: number[]; core: number[]; byWord: number; byLight: number }
const tally = (): Tally => ({ frames: 0, words: [], covered: 0, cover: [], core: [], byWord: 0, byLight: 0 });

/** the probe: sample() once a frame after it is drawn; result() the numbers */
export class MomentsProbe {
  private peakLeft = 0;
  private catchLeft = 0;
  private T = { peak: tally(), catch: tally(), all: tally() };
  /** each peak moment's kinds, and the most words seen in its window */
  moments: { t: number; kinds: string[]; most: number; covered: number }[] = [];

  /** a frame: the bodies' boxes (whole) and their cores, the HUD's feet and the lights' feet, the words standing, the
   *  frame's peaks. A body is covered when more than COVERED of its core is under a word, a ring or the light */
  sample(t: number, dt: number, bodies: (Box | null)[], cores: (Box | null)[], words: number, wordFeet: Foot[], litFeet: Foot[], p: { peak: string[]; catch: boolean }) {
    if (p.peak.length) { this.peakLeft = PEAK_S; this.moments.push({ t: +t.toFixed(2), kinds: p.peak, most: 0, covered: 0 }); }
    if (p.catch) this.catchLeft = PEAK_S;
    const feet = [...wordFeet, ...litFeet];
    const cov = bodies.map((b) => (b ? coverOf(b, feet) : 0)), core = cores.map((b) => (b ? coverOf(b, feet) : 0));
    const byW = cores.some((b) => b && coverOf(b, wordFeet) > COVERED), byL = cores.some((b) => b && coverOf(b, litFeet) > COVERED);
    const any = core.some((c) => c > COVERED);
    const add = (T: Tally) => { T.frames++; T.words.push(words); T.cover.push(Math.max(...cov)); T.core.push(Math.max(...core)); if (any) T.covered++; if (byW) T.byWord++; if (byL) T.byLight++; };
    add(this.T.all);
    if (this.peakLeft > 0) {
      add(this.T.peak);
      const m = this.moments[this.moments.length - 1];
      if (m) { m.most = Math.max(m.most, words); if (any) m.covered++; }
    }
    if (this.catchLeft > 0) add(this.T.catch);
    this.peakLeft -= dt; this.catchLeft -= dt;
  }

  result() {
    const sum = (T: Tally) => {
      const n = Math.max(1, T.frames), w = [...T.words].sort((a, b) => a - b);
      return {
        frames: T.frames, wordsMean: +(T.words.reduce((a, b) => a + b, 0) / n).toFixed(2), wordsMax: w[w.length - 1] ?? 0, wordsP90: w[Math.floor(0.9 * (w.length - 1))] ?? 0,
        covered: +(T.covered / n).toFixed(3), byWord: +(T.byWord / n).toFixed(3), byLight: +(T.byLight / n).toFixed(3), coverMean: +(T.cover.reduce((a, b) => a + b, 0) / n).toFixed(3), coreMean: +(T.core.reduce((a, b) => a + b, 0) / n).toFixed(3),
      };
    };
    const mm = this.moments, most = mm.map((m) => m.most);
    return { peak: sum(this.T.peak), catch: sum(this.T.catch), all: sum(this.T.all), moments: mm.length, mostAtPeak: most.length ? Math.max(...most) : 0, mostMean: most.length ? +(most.reduce((a, b) => a + b, 0) / most.length).toFixed(2) : 0, list: mm };
  }
}

/** the probe joined to the page's duel (index.ts: bend.duel.moments): `sample()` once a frame after it is drawn,
 *  `result()`, `reset()` */
export function momentsHook(c: {
  dancer: (k: number) => { skeleton: { world: Float32Array } } | null; project: Proj;
  glows: { data: Float32Array }; lit: () => [number, number][]; events: () => readonly DuelEvent[]; power: () => readonly { k: string }[]; t: () => number;
}) {
  let probe = new MomentsProbe();
  const hud = () => (globalThis as unknown as { bend?: { hud?: { cover?: () => HudCover; stats?: () => { pops: { now: { total: number } } } } } }).bend?.hud;
  return {
    get probe() { return probe; },
    reset() { probe = new MomentsProbe(); },
    result: () => probe.result(),
    /** this frame (after it is drawn), dt its length (s) */
    sample(dt = 1 / 60) {
      const H = hud(), cv = H?.cover?.() ?? { W: 1280, H: 720, words: [], rings: [] }, W = cv.W || 1280, Hh = cv.H || 720;
      const bodies = [0, 1].map((k) => { const d = c.dancer(k); return d ? bodyBox(d.skeleton.world, ALL_JOINTS, c.project, W, Hh) : null; });
      const cores = [0, 1].map((k) => { const d = c.dancer(k); return d ? bodyBox(d.skeleton.world, CORE_JOINTS, c.project, W, Hh, 0.2, 0.06) : null; });
      const words = H?.stats?.().pops.now.total ?? 0;
      probe.sample(c.t(), dt, bodies, cores, words, hudFeet(cv, W, Hh), lightFeet(c.glows.data, c.lit(), c.project, W, Hh), peaksOf(c.events(), c.power()));
      return { bodies, cores, words };
    },
  };
}

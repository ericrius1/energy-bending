// How the contact dance is seen and heard (phase 2: the contact reads from the bodies, fix 5; the finale's look, fix 4).
// "Its colour" is its seat's (seat.ts: rose, fern; phase 3, who is who), never its matter's: each body wears a halo of
// it, and the contact's rings are drawn in two halves, each dancer's on its own side.
//   the grip   while joined, who holds whom is drawn on the bodies: the holder's arm, shoulder to hand, lit in its own
//              colour, its hand a small bright cuff round the caught part, and a thin rope of the same colour on from
//              the hand to the held body's chest (the holder's colour all the way: "this one has that one"). The two
//              matters laid into the field where the hands meet (fire's heat and water's wet make steam there, as the
//              jogo's clash does), lightly; the field's fusion helix round the pair (as wide as they stand apart, not
//              through them), as much as the merge has charged, thinner through a catch's frames
//   catch      a glint of sun where the hands meet and a ring of leaves and pollen in both colours opening out past the
//              two, sinking and turning (bigger out of the air), the clash's sound, a rumble
//   swing      a faint ring at the contact in the holder's colour on each swing
//   fling      the release: sparks and pollen off the hands, a whoosh; the flown body leaves a streak in the THROWER's colour, a
//              tapering ribbon along its flight until it lands (so "who threw whom" reads before any word)
//   lift/vault a burst of light under the one launched
//   merge      a bloom of petals of both colours and the sun opening round the pair
// The moments' light keeps off the bodies (phase 4, report 15's issue 2): each frame, every glow of a moment (here and
// the powers' reactions, power-fx.ts) whose middle falls on a body's core on screen is dimmed (`keepOff`: KEEP_OFF at
// rest, nearly all of it through a catch's frames, `quiet`), so a ring passing in front of a body loses that piece.
//   finale     the duet's look (finale.ts moves the bodies): fused, the field's fusion winds the two matters into one
//              column round the lifted pair, the bloom (bloom.ts: a tree of light and a flower opening over the lift,
//              phase 5) and motes rising up the column;
//              not fused, a ring of each one's colour rising up it as it bows
//   fall       the matter thrown off (the hand's one-frame blast), and the reform: a ring rising up the body
//   count      a pulse on each count, a big one on BEND; the winner ringed
import type { Dancer } from '../dancer/dancer';
import type { Character } from '../dancer/character';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { mixRGB } from '../play/feel';
import type { Element } from '../play/jogo';
import type { Glows, RGB } from '../play/glow';
import type { DuelEvent, DuelState } from '../../shared/duel.ts';
import type { Contact, ContactEvent } from './contact';
import type { FinaleLook } from './finale';
import { seatHalo, seatRGB, splitRing } from './seat';
import { screenBounds, CORE_JOINTS } from './hud-state';
import { GLOW_FLOATS } from '../play/glow';
import { BLOOM, bloomFade, drawBloom, flowerAt } from './bloom';

type V3 = [number, number, number];

export interface DuelFxCtx {
  glows: Glows;
  dancer: (seat: number) => Dancer | null;
  character: (seat: number) => Character;
  element: (seat: number) => Element;
  /** the dancer's slot in the show's cast (the field's fusion reads slots) */
  slot: (seat: number) => number;
  sfx?: (name: string, o: Record<string, unknown>) => void;
  ear?: (p: V3) => { pan: number; dist: number };
  rumble?: (seat: number, strength: number, ms: number) => void;
  field?: {
    deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void;
    fuse(f: { amount: number; kind?: 'steam' | 'prism' | 'storm' | 'aurora'; dancers?: [number, number]; strength?: number; tightness?: number; at?: V3; height?: number; radius?: number } | null): void;
  } | null;
  /** the hand's one-frame blast (xyz, strength): matter near it is thrown off its body */
  burst?: Float32Array | number[] | null;
  /** the finale's duet as it stands this frame (finale.ts), or null */
  finale?: () => FinaleLook | null;
  /** where the eye is (the contact's ring faces it), and a seat's power form (0 … 1: its halo is stronger in it) */
  eye?: () => V3 | null;
  form?: (seat: number) => number;
  /** the camera's view-projection (the moments' light is kept off the bodies on screen: `keepOff`) */
  viewProj?: () => ArrayLike<number>;
}

/** the moments' sunlit colours (phase 4's solarpunk pass: leaf, moss, pollen, the sun's glint, cream) */
export const SUNLIT_RGB = { leaf: [0.62, 1.25, 0.42] as RGB, moss: [0.4, 0.95, 0.45] as RGB, pollen: [1.75, 1.32, 0.48] as RGB, glint: [1.85, 1.62, 1.15] as RGB, cream: [1.55, 1.42, 1.15] as RGB };

/** a ring of leaves and pollen round p in the plane facing the eye (radius R): n short leaves along it, turned by
 *  `spin`, sinking `fall` m, in the colours given in turn */
export function leafRing(G: Glows, p: V3, eye: V3 | null, R: number, n: number, cols: readonly RGB[], I: number, fall = 0, spin = 0, len = 0.07) {
  if (I <= 0.003 || R <= 0) return;
  const d: V3 = eye ? [eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]] : [0, 0, 1], l = Math.hypot(...d) || 1, nz: V3 = [d[0] / l, d[1] / l, d[2] / l];
  // (the ring's plane: across the screen and up it)
  let ux = -nz[2], uz = nz[0];
  const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const a: V3 = [ux, 0, uz], b: V3 = [nz[1] * a[2] - nz[2] * a[1], nz[2] * a[0] - nz[0] * a[2], nz[0] * a[1] - nz[1] * a[0]];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 + spin, c = Math.cos(t), s = Math.sin(t);
    const q: V3 = [p[0] + R * (c * a[0] + s * b[0]), p[1] + R * (c * a[1] + s * b[1]) - fall * (0.6 + 0.4 * Math.sin(i * 2.1)), p[2] + R * (c * a[2] + s * b[2])];
    // (each leaf across the ring, tilted its own way)
    const tw = t + Math.PI / 2 + 0.7 * Math.sin(i * 1.7 + spin * 3), tc = Math.cos(tw) * len, ts = Math.sin(tw) * len;
    const e: V3 = [tc * a[0] + ts * b[0], tc * a[1] + ts * b[1], tc * a[2] + ts * b[2]];
    const col = cols[i % cols.length];
    G.seg([q[0] - e[0], q[1] - e[1], q[2] - e[2]], [q[0] + e[0], q[1] + e[1], q[2] + e[2]], 0.022, col, I, 'soft');
    if (i % 3 === 0) G.dot([q[0] + e[0] * 2.2, q[1] + e[1] * 2.2 - 0.03, q[2] + e[2] * 2.2], 0.016, SUNLIT_RGB.pollen, I * 1.2, 'spark');
  }
}

/** the moments' light kept off the bodies (phase 4, report 15's issue 2): every glow in `ranges` whose middle falls on
 *  a body's core on screen (hips to head, a torso's width either side) is dimmed by up to `k` (0 … 1), smoothly from
 *  the core's edge in; returns how many were dimmed. A ring drawn as pieces loses those in front of a body, so the
 *  body reads through it */
export function keepOff(G: Glows, ranges: readonly [number, number][], viewProj: ArrayLike<number>, worlds: readonly (ArrayLike<number> | null | undefined)[], k: number) {
  if (k <= 0.01 || !ranges.length) return 0;
  const boxes: [number, number, number, number][] = [];
  for (const w of worlds) { const b = w ? screenBounds(w, viewProj, CORE_JOINTS, 0.24, 0.08) : null; if (b) boxes.push(b); }
  if (!boxes.length) return 0;
  const m = viewProj, D = G.data;
  /** how deep a world point falls inside the cores on screen (0: outside, 1: well in) */
  const depth = (x: number, y: number, z: number) => {
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(cw > 1e-3)) return 0;
    const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw) * 0.5 + 0.5, sy = 0.5 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) * 0.5;
    let inside = 0;
    for (const b of boxes) {
      const hw = (b[2] - b[0]) / 2, hh = (b[3] - b[1]) / 2, e = Math.min(hw - Math.abs(sx - (b[0] + b[2]) / 2), hh - Math.abs(sy - (b[1] + b[3]) / 2));
      if (e > 0) inside = Math.max(inside, Math.min(1, e / (0.3 * Math.min(hw, hh))));
    }
    return inside;
  };
  let n = 0;
  for (const [g0, g1] of ranges) for (let i = g0; i < g1; i++) {
    const o = i * GLOW_FLOATS, ax = D[o], ay = D[o + 1], az = D[o + 2], bx = D[o + 4], by = D[o + 5], bz = D[o + 6], r = D[o + 3];
    // (a dot by its middle; a segment by its ends and middle; a ring or disc lying on the floor by points round it)
    let inside = depth((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    if (ax !== bx || ay !== by || az !== bz) inside = Math.max(inside, depth(ax, ay, az), depth(bx, by, bz));
    if (D[o + 11] >= 4 && D[o + 11] < 8) for (let k = 0; k < 8 && inside < 1; k++) { const t = (k / 8) * Math.PI * 2; inside = Math.max(inside, depth(ax + Math.cos(t) * r, ay, az + Math.sin(t) * r)); }
    if (inside > 0) { D[o + 7] *= 1 - k * inside * inside * (3 - 2 * inside); n++; }
  }
  return n;
}

/** a flown body's streak: its chest's path since the fling, in the thrower's colour */
interface Streak { flyer: number; col: RGB; t0: number; until: number; pts: V3[] }
const STREAK_PTS = 34;

interface Fx { t: number; life: number; draw(u: number, age: number): void }
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const WHITE: RGB = [1.6, 1.5, 1.4];
/** how far the moments' light keeps off the bodies at rest, and how long a catch's frames last for it (s) */
const KEEP_OFF = 0.45, QUIET_S = 0.6;

export class DuelFx {
  private fx: Fx[] = [];
  private t = 0;
  private streaks: Streak[] = [];
  private halo = [1, 1];
  /** this frame's moments' light, as ranges of the glow list [from, to) (the moments probe reads them: what lands on
   *  the bodies) */
  readonly lit: [number, number][] = [];
  /** 0 … 1: a catch's frames (up at a catch or a merge, gone over QUIET_S): how far the moments' light keeps off the
   *  bodies (KEEP_OFF at rest, nearly all of it in a catch's frames); the powers' reactions read it too (power-fx.ts) */
  quiet = 0;
  /** the fused finale's bloom this frame, as a range of the glow list (or null), and when its flower began to open
   *  (the page's time; -1 not yet) */
  bloom: [number, number] | null = null;
  private openAt = -1;
  private heart: V3 | null = null;
  /** the top of the fused finale's flower once it opens (the duel's camera frames it: index.ts), or null */
  get flowerTop(): V3 | null {
    const f = this.ctx.finale?.();
    return f?.fused && this.heart && this.openAt >= 0 && bloomFade(f) > 0.05 ? [this.heart[0], this.heart[1] + BLOOM.PETAL * 1.05, this.heart[2]] : null;
  }

  constructor(private ctx: DuelFxCtx) {}

  /** the moments' light (or the reactions', from power-fx.ts) kept off the bodies, as far as the catch's frames ask */
  keepOff(ranges: readonly [number, number][]) {
    const vp = this.ctx.viewProj?.();
    if (!vp) return 0;
    return keepOff(this.ctx.glows, ranges, vp, [0, 1].map((k) => this.ctx.dancer(k)?.skeleton.world), KEEP_OFF + (0.92 - KEEP_OFF) * this.quiet);
  }

  chest(k: number): V3 {
    const d = this.ctx.dancer(k);
    if (d) { const W = d.skeleton.world, o = JOINT.Spine1 * JOINT_FLOATS; return [W[o], W[o + 1], W[o + 2]]; }
    const c = this.ctx.character(k); return [c.root[0], c.root[1] + 1.1, c.root[2]];
  }
  /** a seat's colour (seat.ts: rose, fern), whatever its matter and its form: who is who */
  private col(k: number): RGB { return seatRGB(k); }
  private add(life: number, draw: (u: number, age: number) => void) { this.fx.push({ t: this.t, life, draw }); }
  private sfx(name: string, p: V3 | null, o: Record<string, unknown> = {}) {
    const e = p && this.ctx.ear ? this.ctx.ear(p) : { pan: 0, dist: 0 };
    this.ctx.sfx?.(name, { ...e, ...o });
  }
  private el(k: number) { const e = this.ctx.element(k); return e === 'gems' ? 'ice' : e; }
  /** the fusion's kind for two matters: fire and water steam, light and shine prism, plasma storm, else aurora */
  private kind(): 'steam' | 'prism' | 'storm' | 'aurora' {
    const a = this.ctx.element(0), b = this.ctx.element(1), has = (x: Element) => a === x || b === x;
    if ((has('fire') || has('plasma')) && (has('water') || has('ice'))) return 'steam';
    if (has('plasma')) return 'storm';
    if (has('gems')) return 'prism';
    return 'aurora';
  }

  /** each frame: the rules' events and the contact's, and the link while it holds */
  update(dt: number, events: readonly DuelEvent[], touches: readonly ContactEvent[], contact: Contact, d: DuelState) {
    this.t += dt;
    for (const e of touches) this.touch(e);
    for (const e of events) {
      switch (e.k) {
        case 'fall': this.fall(e.seat); break;
        case 'set': case 'ready': { const k = e.k === 'ready' ? e.seat : -1; if (k >= 0) this.reform(k); break; }
        case 'count': this.pulse(0.6 + (3 - e.n) * 0.15); this.sfx('count', null, { count: e.n, final: false }); break;
        case 'go': this.pulse(1.6); this.sfx('count', null, { count: 1, final: true }); break;
        case 'merge': this.merge(contact); break;
        case 'finale': this.sfx('finale', null, {}); break;
        case 'done': this.won(e.winner); break;
        case 'combo': if (e.n >= 6 && e.why !== 'fall') this.sfx('unison', this.chest(e.seat), {}); break;
      }
    }
    // the grip: the holder's arm lit in its colour to the hand on the contact, a cuff there, a thin rope of the same
    // colour on to the held body's chest; the matters meeting at the hands, lightly (a ball of steam on one spot hid
    // who was where)
    const L = contact.link;
    if (L) this.grip(L.holder, L.held, L.at, d.energy, dt);
    // the field's fusion: the helix round the pair while joined, as far as the merge has charged; the finale's own
    const fin = this.ctx.finale?.() ?? null;
    this.bloom = null;
    if (!fin) { this.openAt = -1; this.heart = null; }
    const s0 = this.ctx.slot(0), s1 = this.ctx.slot(1);
    if (this.ctx.field) {
      let f: Parameters<NonNullable<DuelFxCtx['field']>['fuse']>[0] = null;
      if (s0 >= 0 && s1 >= 0) {
        if (fin && fin.fused) {
          // one column round the two, as tall as they stand stacked
          const a = this.hips(fin.base), b = this.hips(fin.flyer), h = Math.max(1, Math.abs(b[1] - a[1]) / 2 + 0.9);
          if (fin.fuse > 0.02) f = { amount: fin.fuse, kind: this.kind(), dancers: [s0, s1], strength: 2.6, tightness: 1.3, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.1, (a[2] + b[2]) / 2], height: h, radius: 0.42 };
        } else if (L && d.merge > 0.02) {
          // (round the pair, not through them: as wide as the two stand apart and a body's width more, looser; and
          // thinner through a catch's frames, so the steam it breathes never buries the catch: phase 4)
          const a = this.hips(0), b = this.hips(1), half = Math.hypot(a[0] - b[0], a[2] - b[2]) / 2;
          f = { amount: d.merge * 0.8 * (1 - 0.65 * this.quiet), kind: this.kind(), dancers: [s0, s1], strength: 2.2, tightness: 0.8, radius: Math.min(1.3, Math.max(0.5, half + 0.42)) };
        }
      }
      this.ctx.field.fuse(f);
    }
    if (fin) this.finaleLook(fin);
    // a flown body's streak, in the thrower's colour
    this.streak(contact);
    // each body's halo in its seat's colour (seat.ts), stronger in the power form; gone while it reforms
    for (let k = 0; k < 2; k++) {
      const dn = this.ctx.dancer(k), c = this.ctx.character(k);
      this.halo[k] += ((c.reforming ? 0 : 1) - this.halo[k]) * (1 - Math.exp(-dt * 6));
      if (dn) seatHalo(this.ctx.glows, dn.skeleton.world, k, this.halo[k], this.ctx.form?.(k) ?? dn.form, this.ctx.element(k));
    }
    this.lit.length = 0;
    this.quiet = Math.max(0, this.quiet - dt / QUIET_S);
    const g0 = this.ctx.glows.count;
    this.fx = this.fx.filter((f) => { const age = this.t - f.t, u = age / f.life; if (u >= 1) return false; f.draw(u, age); return true; });
    if (this.ctx.glows.count > g0) this.lit.push([g0, this.ctx.glows.count]);
    this.keepOff(this.lit);
  }

  private touch(e: ContactEvent) {
    const G = this.ctx.glows, p = e.at, ca = this.col(e.seat), cb = this.col(e.other);
    switch (e.kind) {
      case 'catch': case 'aerial': {
        const big = e.kind === 'aerial' ? 1.4 : 1;
        this.sfx('clash', p, { element: this.el(e.seat), vel: 0.8 });
        for (const k of [e.seat, e.other]) this.ctx.rumble?.(k, 0.45 * big, 110);
        this.quiet = 1;
        // a glint of sun where the hands meet (small, a breath long: two crossed rays), and a ring of leaves and
        // pollen opening out past the two in both their colours and the leaves' green, sinking and turning as it goes
        const cols: RGB[] = [mixRGB(ca, SUNLIT_RGB.cream, 0.25), SUNLIT_RGB.leaf, mixRGB(cb, SUNLIT_RGB.cream, 0.25), SUNLIT_RGB.moss], spin = (p[0] * 3.7 + p[2] * 1.3) % 6.28;
        this.add(0.75, (u, age) => {
          G.dot(p, 0.06 * big * (1 - u), SUNLIT_RGB.glint, 2.2 * Math.pow(1 - u, 3), 'spark');
          const gk = 1 - Math.min(1, age / 0.2);
          if (gk > 0) {
            const r = 0.2 * big * (0.4 + 0.6 * gk);
            G.seg([p[0] - r, p[1], p[2]], [p[0] + r, p[1], p[2]], 0.01, SUNLIT_RGB.glint, 1.5 * gk, 'spark');
            G.seg([p[0], p[1] - r, p[2]], [p[0], p[1] + r, p[2]], 0.01, SUNLIT_RGB.glint, 1.5 * gk, 'spark');
          }
          const R = (0.3 + 0.75 * smooth(Math.min(1, u * 1.6))) * big;
          leafRing(G, p, this.ctx.eye?.() ?? null, R, e.kind === 'aerial' ? 12 : 9, cols, 1.05 * (1 - u) * (1 - u), 0.25 * u * u, spin + u * 0.9);
        });
        break;
      }
      // (the holder's colour, small and faint: one a hold now, but the contact was a pile of rings)
      case 'swing': this.sfx('near', p, { element: this.el(e.seat) }); this.add(0.35, (u) => G.dot(p, 0.12 + u * 0.3, ca, 0.3 * (1 - u), 'ring')); break;
      case 'fling': {
        this.sfx('dodge', p, { element: this.el(e.other), count: 1 });
        this.streaks = this.streaks.filter((q) => q.flyer !== e.other);
        this.streaks.push({ flyer: e.other, col: ca, t0: this.t, until: this.t + 1.6, pts: [] });
        this.add(0.5, (u, age) => {
          for (let j = 0; j < 12; j++) {
            const a = j * 2.39996, sp = 2.5 + (j % 3);
            G.dot([p[0] + Math.cos(a) * sp * age, p[1] + Math.sin(a * 1.3) * sp * age * 0.6 - age * age * 1.2, p[2] + Math.sin(a) * sp * age], 0.025, j % 3 === 2 ? SUNLIT_RGB.pollen : j % 2 ? ca : cb, 1.6 * (1 - u), 'spark');
          }
        });
        break;
      }
      case 'lift': case 'vault': {
        const c = this.ctx.character(e.seat), foot: V3 = [c.root[0], c.root[1] + 0.05, c.root[2]];
        this.sfx('formOn', p, { element: this.el(e.seat) });
        this.add(0.6, (u) => G.flat(foot, 0.2 + u * 0.9, ca, 1.2 * (1 - u), 'ring'));
        break;
      }
      case 'counter': this.sfx('parry', p, { element: this.el(e.seat) }); this.add(0.35, (u) => G.dot(p, 0.1 + u * 0.4, WHITE, 1.2 * (1 - u), 'ring')); break;
    }
  }

  /** a joint of seat k's skeleton in the world, or null */
  private joint(k: number, j: number): V3 | null {
    const d = this.ctx.dancer(k);
    if (!d) return null;
    const W = d.skeleton.world, o = j * JOINT_FLOATS;
    return [W[o], W[o + 1], W[o + 2]];
  }
  private hips(k: number): V3 { const c = this.ctx.character(k); return this.joint(k, JOINT.Hips) ?? [c.root[0], c.root[1] + 0.95, c.root[2]]; }

  /** the holder's grip on the held body: its arm (shoulder, elbow, hand: the hand nearer the contact) lit in its own
   *  colour, a cuff at the hand, a rope of its colour on to the held one's chest */
  private grip(holder: number, held: number, at: V3, E: number, dt: number) {
    const G = this.ctx.glows, col = this.col(holder), hot = mixRGB(col, WHITE, 0.35);
    const lh = this.joint(holder, JOINT.LeftHand), rh = this.joint(holder, JOINT.RightHand);
    const dist = (p: V3 | null) => (p ? Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) : Infinity);
    const left = dist(lh) <= dist(rh);
    const sh = this.joint(holder, left ? JOINT.LeftArm : JOINT.RightArm), el = this.joint(holder, left ? JOINT.LeftForeArm : JOINT.RightForeArm);
    const hand = (left ? lh : rh) ?? at;
    const beat = 0.85 + 0.15 * Math.sin(this.t * 9);
    if (sh && el) {
      G.seg(sh, el, 0.045, col, (0.9 + 0.6 * E) * beat, 'soft');
      G.seg(el, hand, 0.05, hot, (1.1 + 0.7 * E) * beat, 'soft');
    }
    // the cuff: a small bright ring closed round the caught part, and the hand's glow
    G.dot(hand, 0.07, hot, 1.6 + E, 'spark');
    splitRing(G, at, 0.13, 0.016, this.ctx.eye?.() ?? null, this.chest(holder), this.chest(held), holder, held, 0.6 + 0.35 * E);
    // the rope on to the held body, the holder's colour, thinning
    const to = this.chest(held), mid = lerp(at, to, 0.5);
    G.seg(at, mid, 0.022, col, 0.7 + 0.5 * E, 'soft');
    G.seg(mid, to, 0.014, col, 0.4 + 0.3 * E, 'soft');
    // one bead running along it from the holder to the held, faster with the energy
    const q = (this.t * (0.9 + 1.6 * E)) % 1;
    G.dot(lerp(hand, to, q), 0.035, hot, 1.2 * Math.sin(Math.PI * q), 'spark');
    const F = this.ctx.field;
    if (F && Math.floor(this.t * 8) !== Math.floor((this.t - dt) * 8)) {
      for (const k of [holder, held]) {
        const e = this.ctx.element(k), heat = e === 'fire' ? 0.9 : e === 'plasma' ? 1.2 : e === 'ice' ? -0.8 : 0, wet = e === 'water' ? 0.9 : 0;
        F.deposit({ p: at, r: 0.3, heat: heat * (0.25 + 0.5 * E), wet: wet * (0.25 + 0.5 * E), wind: [0, 1.5, 0] });
      }
    }
  }

  /** each flown body's streak: its chest's path sampled while it flies, a ribbon tapering to its tail in the thrower's
   *  colour, gone a moment after it lands */
  private streak(contact: Contact) {
    const G = this.ctx.glows;
    this.streaks = this.streaks.filter((s) => {
      const flying = this.t < s.until && (this.t - s.t0 < 0.15 || contact.flown?.flyer === s.flyer) && !contact.link;
      if (flying) { s.pts.push(this.chest(s.flyer)); if (s.pts.length > STREAK_PTS) s.pts.shift(); }
      else if (s.until > this.t) s.until = this.t;
      const fade = flying ? 1 : 1 - (this.t - s.until) / 0.45;
      if (fade <= 0) return false;
      // (the tail eats the ribbon once it stops: the newest end stays a moment longer)
      const n = s.pts.length, eat = flying ? 0 : Math.floor((1 - fade) * n);
      const hot = mixRGB(s.col, WHITE, 0.3);
      for (let i = Math.max(1, eat); i < n; i++) {
        const q = i / (n - 1 || 1), a = s.pts[i - 1], b = s.pts[i];
        G.seg(a, b, 0.02 + 0.09 * q, s.col, (0.25 + 1.1 * q * q) * fade, 'soft');
        if (q > 0.6) G.seg(a, b, 0.012 + 0.025 * q, hot, 1.2 * q * fade, 'soft');
      }
      return true;
    });
  }

  /** the finale's look (finale.ts moves the bodies): fused, the bloom (bloom.ts) and motes of both colours rising up
   *  the column; not fused, a ring of each one's colour rising up it */
  private finaleLook(f: FinaleLook) {
    const G = this.ctx.glows, ca = this.col(f.base), cb = this.col(f.flyer);
    if (f.fused) {
      if (f.u < 0.05 && f.t < 0.1) { this.openAt = -1; this.heart = null; }
      const top = this.chest(f.flyer), foot = this.ctx.character(f.base).root;
      // the bloom (bloom.ts): a tree of light rising round the lift and a flower opening over it on the page's own clock
      // (from OPEN_U of the duet: through the lift's held frames), kept off the bodies
      if (this.openAt < 0 && f.u >= BLOOM.OPEN_U) this.openAt = this.t;
      const g0 = G.count, eye = this.ctx.eye?.() ?? null, F: V3 = [foot[0], foot[1], foot[2]];
      // (the flower's heart over the flyer's head on screen, following it up, held still once it opens)
      if (this.openAt === this.t || !this.heart || this.openAt < 0) this.heart = flowerAt(F, this.joint(f.flyer, JOINT.Head) ?? [top[0], top[1] + 0.6, top[2]], eye, this.ctx.viewProj?.());
      drawBloom(G, { look: f, open: this.openAt < 0 ? -1 : this.t - this.openAt, foot: F, eye, ca, cb, t: this.t, heart: this.heart });
      if (G.count > g0) {
        this.bloom = [g0, G.count];
        const vp = this.ctx.viewProj?.();
        if (vp) keepOff(G, [this.bloom], vp, [0, 1].map((k) => this.ctx.dancer(k)?.skeleton.world), BLOOM.KEEP_OFF);
      }
      // motes rising round the column, the two colours wound
      const k = Math.min(1, f.u / 0.3) * Math.max(0, 1 - Math.max(0, f.t - 3.2) / 1.5);
      if (k > 0.01) {
        const H = Math.max(2.2, top[1] - foot[1] + 1.2);
        for (let i = 0; i < 28; i++) {
          const v = (f.t * 0.35 + i / 28) % 1, ang = i * 2.39996 + f.t * 1.4, r = 0.55 - 0.25 * v;
          G.dot([foot[0] + Math.cos(ang) * r, foot[1] + 0.1 + v * H, foot[2] + Math.sin(ang) * r], 0.025, i % 2 ? ca : cb, 1.3 * k * Math.sin(Math.PI * v), 'spark');
        }
      }
      // where it lands: a soft ring opening on the floor
      const l = f.t - f.len * 0.92;
      if (l > 0 && l < 0.9) { const r = this.ctx.character(f.flyer).root; G.flat([r[0], r[1] + 0.02, r[2]], 0.3 + 0.5 * Math.min(1, l / 0.3), cb, 0.9 * (1 - l / 0.9), 'ring'); }
    } else if (f.t < 2.6) {
      for (const k of [0, 1]) {
        const r = this.ctx.character(k).root, v = (f.t / 1.8) % 1;
        G.flat([r[0], r[1] + 0.02 + v * 1.8, r[2]], 0.42 - 0.15 * v, this.col(k), 0.8 * Math.sin(Math.PI * v), 'ring');
      }
    }
  }

  private merge(contact: Contact) {
    const L = contact.link, p = L?.at ?? this.chest(0);
    this.sfx('mergeReady', p, {});
    this.quiet = 1;
    // a bloom: petals of both colours and the sun opening out round the pair, a warm heart (kept off the bodies)
    const mid = mixRGB(mixRGB(this.col(0), this.col(1), 0.5), SUNLIT_RGB.pollen, 0.35);
    this.add(1.2, (u) => {
      const G = this.ctx.glows, R = 0.45 + 1.2 * smooth(Math.min(1, u * 1.4));
      leafRing(G, p, this.ctx.eye?.() ?? null, R, 14, [mixRGB(this.col(0), SUNLIT_RGB.cream, 0.3), mid, mixRGB(this.col(1), SUNLIT_RGB.cream, 0.3), SUNLIT_RGB.pollen], 1.1 * (1 - smooth(u)), 0.15 * u, u * 0.6, 0.11);
      G.dot(p, 0.22 * (1 - u), SUNLIT_RGB.glint, 1.3 * Math.pow(1 - u, 3), 'spark');
    });
  }

  /** a fall: the body's matter thrown off it; it reforms in a moment */
  private fall(k: number) {
    const c = this.chest(k), B = this.ctx.burst;
    if (B) { B[0] = c[0]; B[1] = c[1]; B[2] = c[2]; B[3] = 1.8; }
    this.sfx('hit', c, { element: this.el(k), vel: 0.6 });
  }
  private reform(k: number) {
    const ch = this.ctx.character(k), foot: V3 = [ch.root[0], ch.root[1] + 0.02, ch.root[2]], col = this.col(k);
    this.sfx('respawn', foot, { element: this.el(k) });
    this.add(0.9, (u) => this.ctx.glows.flat([foot[0], foot[1] + smooth(u) * 1.7, foot[2]], 0.45 - 0.15 * u, col, 1.2 * Math.sin(Math.PI * u), 'ring'));
  }
  private pulse(I: number) {
    const a = this.ctx.character(0).root, b = this.ctx.character(1).root;
    const c: V3 = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) + 0.02, (a[2] + b[2]) / 2];
    this.add(0.5, (u) => this.ctx.glows.flat(c, 0.3 + u * 1.4 * I, [1.5, 1.35, 1.0], 1.3 * I * (1 - u) * (1 - u), 'ring'));
  }
  private won(w: number) {
    const col = this.col(w);
    this.add(3.5, (u, age) => {
      const r = this.ctx.character(w).root;
      for (let i = 0; i < 3; i++) {
        const v = (age * 0.8 + i / 3) % 1;
        this.ctx.glows.flat([r[0], r[1] + 0.02 + v * 2, r[2]], 0.5 - 0.2 * v, col, 1.2 * (1 - v) * (1 - smooth((u - 0.8) / 0.2)), 'ring');
      }
    });
  }
}

const lerp = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

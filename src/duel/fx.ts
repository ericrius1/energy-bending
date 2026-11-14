// How the contact dance is seen and heard (phase 2: the contact reads from the bodies, fix 5; the finale's look, fix 4):
//   the grip   while joined, who holds whom is drawn on the bodies: the holder's arm, shoulder to hand, lit in its own
//              colour, its hand a small bright cuff round the caught part, and a thin rope of the same colour on from
//              the hand to the held body's chest (the holder's colour all the way: "this one has that one"). The two
//              matters laid into the field where the hands meet (fire's heat and water's wet make steam there, as the
//              jogo's clash does), lightly; the field's fusion helix round the pair, as much as the merge has charged
//   catch      a ring and a flash where the hands meet (bigger out of the air), the clash's sound, a rumble
//   swing      a faint ring at the contact in the holder's colour on each swing
//   fling      the release: sparks off the hands, a whoosh; the flown body leaves a streak in the THROWER's colour, a
//              tapering ribbon along its flight until it lands (so "who threw whom" reads before any word)
//   lift/vault a burst of light under the one launched
//   merge      a flash round the pair
//   finale     the duet's look (finale.ts moves the bodies): fused, the field's fusion winds the two matters into one
//              column round the lifted pair, a bloom of soft light at the top of the lift and motes rising up the column;
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
}

/** a flown body's streak: its chest's path since the fling, in the thrower's colour */
interface Streak { flyer: number; col: RGB; t0: number; until: number; pts: V3[] }
const STREAK_PTS = 34;

interface Fx { t: number; life: number; draw(u: number, age: number): void }
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const WHITE: RGB = [1.6, 1.5, 1.4];

export class DuelFx {
  private fx: Fx[] = [];
  private t = 0;
  private streaks: Streak[] = [];
  private halo = [1, 1];

  constructor(private ctx: DuelFxCtx) {}

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
    const s0 = this.ctx.slot(0), s1 = this.ctx.slot(1);
    if (this.ctx.field) {
      let f: Parameters<NonNullable<DuelFxCtx['field']>['fuse']>[0] = null;
      if (s0 >= 0 && s1 >= 0) {
        if (fin && fin.fused) {
          // one column round the two, as tall as they stand stacked
          const a = this.hips(fin.base), b = this.hips(fin.flyer), h = Math.max(1, Math.abs(b[1] - a[1]) / 2 + 0.9);
          if (fin.fuse > 0.02) f = { amount: fin.fuse, kind: this.kind(), dancers: [s0, s1], strength: 2.6, tightness: 1.3, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.1, (a[2] + b[2]) / 2], height: h, radius: 0.42 };
        } else if (L && d.merge > 0.02) f = { amount: d.merge * 0.8, kind: this.kind(), dancers: [s0, s1], strength: 2.2, tightness: 1 };
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
    this.fx = this.fx.filter((f) => { const age = this.t - f.t, u = age / f.life; if (u >= 1) return false; f.draw(u, age); return true; });
  }

  private touch(e: ContactEvent) {
    const G = this.ctx.glows, p = e.at, ca = this.col(e.seat), cb = this.col(e.other);
    switch (e.kind) {
      case 'catch': case 'aerial': {
        const big = e.kind === 'aerial' ? 1.4 : 1;
        this.sfx('clash', p, { element: this.el(e.seat), vel: 0.8 });
        for (const k of [e.seat, e.other]) this.ctx.rumble?.(k, 0.45 * big, 110);
        this.add(0.6, (u) => {
          G.dot(p, 0.12 * big * (1 - u), WHITE, 2.4 * Math.pow(1 - u, 3), 'spark');
          // (the ring in two halves: each dancer's in its own colour, on its own side)
          const R = (0.15 + u * 0.55) * big;
          splitRing(G, p, R, 0.012 + 0.03 * R, this.ctx.eye?.() ?? null, this.chest(e.seat), this.chest(e.other), e.seat, e.other, 0.8 * (1 - u) * (1 - u));
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
            G.dot([p[0] + Math.cos(a) * sp * age, p[1] + Math.sin(a * 1.3) * sp * age * 0.6, p[2] + Math.sin(a) * sp * age], 0.025, j % 2 ? ca : cb, 1.6 * (1 - u), 'spark');
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

  /** the finale's look (finale.ts moves the bodies): fused, a bloom of soft light at the top of the lift and motes of
   *  both colours rising up the column; not fused, a ring of each one's colour rising up it */
  private finaleLook(f: FinaleLook) {
    const G = this.ctx.glows, ca = this.col(f.base), cb = this.col(f.flyer);
    if (f.fused) {
      const top = this.chest(f.flyer), foot = this.ctx.character(f.base).root;
      const b = f.bloom;
      if (b > 0.01) {
        G.dot(top, 0.35 + 0.9 * b, mixRGB(mixRGB(ca, cb, 0.5), WHITE, 0.45), 0.55 * b, 'soft');
        G.dot(top, 0.35 + 0.45 * b, mixRGB(ca, cb, 0.5), 0.3 * b, 'ring');
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
    this.add(1.0, (u) => {
      this.ctx.glows.dot(p, 0.3 + u * 1.3, mixRGB(this.col(0), this.col(1), 0.5), 1.0 * (1 - smooth(u)), 'ring');
      this.ctx.glows.dot(p, 0.3 * (1 - u), WHITE, 1.4 * Math.pow(1 - u, 3), 'spark');
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

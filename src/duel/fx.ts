// How the contact dance is seen and heard, phase 1 (cheap; phase 3 adds the juice):
//   the link   while joined, energy flows between the two: beads of light in each body's colour streaming from each
//              chest into the joined hands and on into the other, faster as the shared energy rises; the two matters
//              laid into the field where the hands meet (fire's heat and water's wet make steam there, as the jogo's
//              clash does); the field's fusion helix round the pair, as much as the merge has charged
//   catch      a ring and a flash where the hands meet (bigger out of the air), the clash's sound, a rumble
//   swing      a soft ring at the contact on each swing
//   fling      the release: sparks off the hands, a whoosh; the flown body leaves a short trail of its colour
//   lift/vault a burst of light under the one launched
//   merge      a flash round the pair; the finale's fusion: the helix full for the finale when the set's energy peaked
//   fall       the matter thrown off (the hand's one-frame blast), and the reform: a ring rising up the body
//   count      a pulse on each count, a big one on BEND; the winner ringed
import type { Dancer } from '../dancer/dancer';
import type { Character } from '../dancer/character';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { COLOURS, mixRGB } from '../play/feel';
import type { Element } from '../play/jogo';
import type { Glows, RGB } from '../play/glow';
import type { DuelEvent, DuelState } from '../../shared/duel.ts';
import type { Contact, ContactEvent } from './contact';

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
    fuse(f: { amount: number; kind?: 'steam' | 'prism' | 'storm' | 'aurora'; dancers?: [number, number]; strength?: number; tightness?: number } | null): void;
  } | null;
  /** the hand's one-frame blast (xyz, strength): matter near it is thrown off its body */
  burst?: Float32Array | number[] | null;
}

interface Fx { t: number; life: number; draw(u: number, age: number): void }
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const WHITE: RGB = [1.6, 1.5, 1.4];

export class DuelFx {
  private fx: Fx[] = [];
  private t = 0;
  private finale = 0;
  private trail: { seat: number; until: number } | null = null;

  constructor(private ctx: DuelFxCtx) {}

  chest(k: number): V3 {
    const d = this.ctx.dancer(k);
    if (d) { const W = d.skeleton.world, o = JOINT.Spine1 * JOINT_FLOATS; return [W[o], W[o + 1], W[o + 2]]; }
    const c = this.ctx.character(k); return [c.root[0], c.root[1] + 1.1, c.root[2]];
  }
  private col(k: number): RGB { return COLOURS[this.ctx.element(k)]; }
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
    const G = this.ctx.glows;
    for (const e of touches) this.touch(e);
    for (const e of events) {
      switch (e.k) {
        case 'fall': this.fall(e.seat); break;
        case 'set': case 'ready': { const k = e.k === 'ready' ? e.seat : -1; if (k >= 0) this.reform(k); break; }
        case 'count': this.pulse(0.6 + (3 - e.n) * 0.15); this.sfx('count', null, { count: e.n, final: false }); break;
        case 'go': this.pulse(1.6); this.sfx('count', null, { count: 1, final: true }); break;
        case 'merge': this.merge(contact); break;
        case 'finale': this.sfx('finale', null, {}); if (e.fused) this.finale = 5; break;
        case 'done': this.won(e.winner); break;
        case 'combo': if (e.n >= 6 && e.why !== 'fall') this.sfx('unison', this.chest(e.seat), {}); break;
      }
    }
    // the link: energy streaming through the joined hands, the matters meeting there, the helix as the merge charges
    const L = contact.link;
    if (L) {
      const a = this.chest(L.holder), b = this.chest(L.held), m = L.at, E = d.energy;
      const speed = 1.2 + 2.5 * E;
      for (const [from, to, k] of [[a, b, L.holder], [b, a, L.held]] as [V3, V3, number][]) {
        const col = this.col(k);
        for (let j = 0; j < 6; j++) {
          const u = (this.t * speed + j / 6 + k * 0.08) % 1;
          // from the chest to the hands (first half), the hands to the other's chest (second)
          const p: V3 = u < 0.5 ? lerp(from, m, u * 2) : lerp(m, to, (u - 0.5) * 2);
          G.dot(p, 0.03 + 0.03 * E, mixRGB(col, WHITE, 0.25), 1.2 + 1.5 * E, 'spark');
        }
      }
      G.dot(m, 0.12 + 0.12 * E, mixRGB(this.col(L.holder), this.col(L.held), 0.5), 0.8 + E, 'soft');
      const F = this.ctx.field;
      if (F && Math.floor(this.t * 20) !== Math.floor((this.t - dt) * 20)) {
        for (const k of [L.holder, L.held]) {
          const el = this.ctx.element(k), heat = el === 'fire' ? 0.9 : el === 'plasma' ? 1.2 : el === 'ice' ? -0.8 : 0, wet = el === 'water' ? 0.9 : 0;
          F.deposit({ p: m, r: 0.35, heat: heat * (0.4 + E), wet: wet * (0.4 + E), wind: [0, 1.5, 0] });
        }
      }
    }
    // the field's fusion: the helix round the pair while joined, as far as the merge has charged; full in a fused finale
    this.finale = Math.max(0, this.finale - dt);
    const amount = this.finale > 0 ? Math.min(1, this.finale) : L ? d.merge * 0.8 : 0;
    const s0 = this.ctx.slot(0), s1 = this.ctx.slot(1);
    if (this.ctx.field) this.ctx.field.fuse(amount > 0.02 && s0 >= 0 && s1 >= 0 ? { amount, kind: this.kind(), dancers: [s0, s1], strength: 2.2, tightness: 1 } : null);
    // a flown body's trail
    if (this.trail && this.t < this.trail.until) G.dot(this.chest(this.trail.seat), 0.18, this.col(this.trail.seat), 0.5 * (this.trail.until - this.t), 'soft');
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
          G.dot(p, (0.15 + u * 0.7) * big, mixRGB(ca, cb, 0.5), 1.1 * (1 - u) * (1 - u), 'ring');
        });
        break;
      }
      case 'swing': this.sfx('near', p, { element: this.el(e.seat) }); this.add(0.4, (u) => G.dot(p, 0.2 + u * 0.5, mixRGB(ca, cb, 0.5), 0.6 * (1 - u), 'ring')); break;
      case 'fling': {
        this.sfx('dodge', p, { element: this.el(e.other), count: 1 });
        this.trail = { seat: e.other, until: this.t + 0.8 };
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

  private merge(contact: Contact) {
    const L = contact.link, p = L?.at ?? this.chest(0);
    this.sfx('mergeReady', p, {});
    this.add(1.0, (u) => {
      this.ctx.glows.dot(p, 0.3 + u * 1.6, mixRGB(this.col(0), this.col(1), 0.5), 1.4 * (1 - smooth(u)), 'ring');
      this.ctx.glows.dot(p, 0.4 * (1 - u), WHITE, 2 * Math.pow(1 - u, 3), 'spark');
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

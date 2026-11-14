// How the duel is seen and heard, phase 1 (cheap and simple; phase 3 adds the juice). A hit and a clash are what the
// jogo's feel already does (play/feel.ts: the knock's wind, the ring of stars round the head, the puff, the clash's
// burst and sparks, their sounds), fed the duel's events as the jogo's exchanges, with the knockback left to the duel.
// Its own:
//   KO       the body's matter thrown off it (the hand's one-frame blast at its chest, the field's wind blown outward),
//            a double ring and sparks flying out in its colour, a low sound, both pads rumbling
//   reform   motes streaming from where it fell to where it re-forms, a ring rising up the new body
//   ready    while untouchable, a shimmer round the chest
//   perfect  a hit on the beat: a bright flash and a wider ring where it landed
//   count    a pulse in the middle on each count, a big one on BEND; the winner ringed when a round is won
import type { Dancer } from '../dancer/dancer';
import type { Character } from '../dancer/character';
import { planePoint, type StagePlane } from '../engine/camera';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { Feel, COLOURS, mixRGB } from '../play/feel';
import type { Jogo, Element, JogoEvent, SeatBody } from '../play/jogo';
import type { Glows, RGB } from '../play/glow';
import type { DuelEvent } from '../../shared/duel.ts';
import { moveEventOf } from '../ai/body';
import type { MoveRelay } from '../../shared/protocol.ts';

type V3 = [number, number, number];

export interface DuelFxCtx {
  glows: Glows;
  plane: () => StagePlane;
  dancer: (seat: number) => Dancer | null;
  character: (seat: number) => Character;
  element: (seat: number) => Element;
  sfx?: (name: string, o: Record<string, unknown>) => void;
  ear?: (p: V3) => { pan: number; dist: number };
  rumble?: (seat: number, strength: number, ms: number) => void;
  field?: { deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void; updraft(id: string, p: V3): number } | null;
  arcs?: { add(a: ArrayLike<number>, b: ArrayLike<number>, I?: number, frames?: number): void } | null;
  /** the hand's one-frame blast (xyz, strength): matter near it is thrown off its body */
  burst?: Float32Array | number[] | null;
  frame(): number;
  untouchable: (seat: number) => boolean;
}

interface Fx { t: number; life: number; draw(u: number, age: number): void }
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const WHITE: RGB = [1.6, 1.5, 1.4];

export class DuelFx {
  readonly feel: Feel;
  private fx: Fx[] = [];
  private t = 0;
  private serial = 0;

  constructor(private ctx: DuelFxCtx) {
    // the jogo's feel, fed the duel's hits and clashes as exchanges: its bodies have no Character, so it leaves the
    // knockback (and the element perks) to the duel and only shows and sounds them
    const seat = (k: number): SeatBody => ({
      character: null,
      root: () => { const c = ctx.character(k); return [c.root[0], c.root[1], c.root[2]]; },
      chest: () => this.chest(k),
      intent: () => null,
      element: () => ctx.element(k),
    });
    const stub = { state: null, raw: [[], []] } as unknown as Jogo;
    this.feel = new Feel(stub, [seat(0), seat(1)], {
      glows: ctx.glows, sfx: ctx.sfx, field: ctx.field ?? null, arcs: ctx.arcs ?? null, rumble: ctx.rumble, ear: ctx.ear,
      dancer: ctx.dancer, plane: ctx.plane, frame: ctx.frame,
    });
  }

  chest(k: number): V3 {
    const d = this.ctx.dancer(k);
    if (d) { const W = d.skeleton.world, o = JOINT.Spine1 * JOINT_FLOATS; return [W[o], W[o + 1], W[o + 2]]; }
    const c = this.ctx.character(k); return [c.root[0], c.root[1] + 1.1, c.root[2]];
  }
  private at(p: [number, number], up = 0): V3 { return planePoint(this.ctx.plane(), p[0], p[1] + up); }
  private col(k: number): RGB { return COLOURS[this.ctx.element(k)]; }
  private add(life: number, draw: (u: number, age: number) => void) { this.fx.push({ t: this.t, life, draw }); }
  private sfx(name: string, p: V3 | null, o: Record<string, unknown> = {}) {
    const e = p && this.ctx.ear ? this.ctx.ear(p) : { pan: 0, dist: 0 };
    this.ctx.sfx?.(name, { ...e, ...o });
  }

  /** the duel's events this frame */
  update(dt: number, events: readonly DuelEvent[]) {
    this.t += dt;
    const xch: JogoEvent[] = [];
    for (const e of events) {
      switch (e.k) {
        case 'hit': case 'clash': {
          const by = e.k === 'hit' ? e.by : e.a, target = e.k === 'hit' ? e.target : e.b;
          const ev = moveEventOf(this.ctx.character(by));
          const move = ev ? ({ ...ev, id: `duel.${++this.serial}`, from: by, ts: 0 } as unknown as MoveRelay) : null;
          xch.push({ k: 'xch', id: `duel.${this.serial}`, by, target, res: e.k, move, mine: true, streak: 0 });
          if (e.k === 'hit' && e.perfect) this.perfect(e.at, by);
          if (e.k === 'hit') this.ctx.rumble?.(e.target, 0.7, 160);
          break;
        }
        case 'block': this.sfx('parry', this.at(e.at), { element: this.sfxEl(e.target) }); this.ring(this.at(e.at), this.col(e.target), 0.5, 0.45); break;
        case 'dodge': this.sfx('dodge', this.at(e.at), { element: this.sfxEl(e.target), count: 1 }); break;
        case 'ko': this.ko(e.target, e.how); break;
        case 'reform': this.reform(e.seat, e.at); break;
        case 'count': this.pulse(0.6 + (3 - e.n) * 0.15); this.sfx('count', null, { count: e.n, final: false }); break;
        case 'go': this.pulse(1.6); this.sfx('count', null, { count: 1, final: true }); break;
        case 'won': this.won(e.winner); break;
      }
    }
    this.feel.update(dt, xch);
    // untouchable: a shimmer round the chest
    for (let k = 0; k < 2; k++) {
      if (!this.ctx.untouchable(k) || this.ctx.character(k).reforming) continue;
      const c = this.chest(k), f = 0.5 + 0.5 * Math.sin(this.t * 30 + k);
      this.ctx.glows.dot(c, 0.42, mixRGB(this.col(k), WHITE, 0.4), 0.22 * f, 'soft');
    }
    this.fx = this.fx.filter((f) => { const age = this.t - f.t, u = age / f.life; if (u >= 1) return false; f.draw(u, age); return true; });
  }
  private sfxEl(k: number) { const e = this.ctx.element(k); return e === 'gems' ? 'ice' : e; }

  private ring(p: V3, col: RGB, r: number, life: number) {
    this.add(life, (u) => this.ctx.glows.dot(p, r * (0.3 + u), col, 0.9 * (1 - u) * (1 - u), 'ring'));
  }
  private perfect(at: [number, number], by: number) {
    const p = this.at(at), col = mixRGB(this.col(by), WHITE, 0.5);
    this.add(0.5, (u) => {
      const G = this.ctx.glows;
      G.dot(p, 0.16 + 0.1 * (1 - u), WHITE, 3 * Math.pow(1 - u, 3), 'spark');
      G.dot(p, 0.2 + u * 1.1, col, 1.1 * (1 - u) * (1 - u), 'ring');
    });
  }

  /** the KO: the body's matter thrown off it */
  private ko(k: number, how: 'hits' | 'fall') {
    const c = this.chest(k), col = this.col(k), G = this.ctx.glows;
    const B = this.ctx.burst;
    if (B) { B[0] = c[0]; B[1] = c[1]; B[2] = c[2]; B[3] = how === 'fall' ? 2.2 : 3.6; }
    const F = this.ctx.field;
    if (F) for (let j = 0; j < 10; j++) {
      const a = (j / 10) * Math.PI * 2;
      F.deposit({ p: [c[0] + Math.cos(a) * 0.35, c[1] + Math.sin(a) * 0.35, c[2]], r: 0.6, wind: [Math.cos(a) * 9, Math.sin(a) * 9 + 2, 0] });
    }
    this.sfx('clash', c, { element: this.sfxEl(k), vel: 1 });
    this.sfx('hit', c, { element: this.sfxEl(k), vel: 1 });
    for (let s = 0; s < 2; s++) this.ctx.rumble?.(s, s === k ? 1 : 0.5, 260);
    const P = this.ctx.plane(), r = P.right;
    this.add(1.0, (u, age) => {
      const k1 = 1 - smooth(u);
      G.dot(c, 0.3 + u * 1.8, col, 1.6 * k1 * k1, 'ring');
      G.dot(c, 0.2 + u * 1.1, WHITE, 1.2 * Math.pow(1 - u, 4), 'ring');
      G.dot(c, 0.25 * (1 - u), WHITE, 3 * Math.pow(1 - u, 5), 'spark');
      // sparks out along the stage and up (it is seen side on)
      for (let j = 0; j < 22; j++) {
        const a = j * 2.39996, sp = 3 + (j % 4) * 1.1, ca = Math.cos(a), sa = Math.sin(a);
        const x = c[0] + r[0] * ca * sp * age, z = c[2] + r[2] * ca * sp * age, y = c[1] + sa * sp * age - 4.9 * age * age;
        G.dot([x, y, z], 0.03, j % 3 ? col : WHITE, 1.8 * k1, 'spark');
      }
    });
  }

  /** the matter streams back: motes from where it was to where it re-forms, a ring rising up the new body */
  private reform(k: number, at: [number, number]) {
    const from = this.chest(k), to = this.at(at, 1.0), foot = this.at(at, 0.02), col = this.col(k), G = this.ctx.glows;
    this.sfx('respawn', to, { element: this.sfxEl(k) });
    this.add(0.9, (u) => {
      for (let j = 0; j < 14; j++) {
        const w = smooth(Math.min(1, Math.max(0, (u - j * 0.025) / 0.6)));
        if (w <= 0 || w >= 1) continue;
        const lift = Math.sin(Math.PI * w) * (0.8 + (j % 3) * 0.3);
        const p: V3 = [from[0] + (to[0] - from[0]) * w, from[1] + (to[1] - from[1]) * w + lift, from[2] + (to[2] - from[2]) * w];
        G.dot(p, 0.035, j % 2 ? col : mixRGB(col, WHITE, 0.5), 1.4, 'spark');
      }
      const y = foot[1] + smooth(u) * 1.7;
      G.flat([foot[0], y, foot[2]], 0.45 - 0.15 * u, col, 1.2 * Math.sin(Math.PI * u), 'ring');
    });
  }

  private pulse(I: number) {
    const P = this.ctx.plane(), mid = planePoint(P, 0, (P.ground ?? 0) + 0.02);
    const a = this.ctx.character(0).root, b = this.ctx.character(1).root;
    const c: V3 = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) + 0.02, (a[2] + b[2]) / 2];
    const at = Number.isFinite(c[0]) ? c : mid;
    this.add(0.5, (u) => this.ctx.glows.flat(at, 0.3 + u * 1.4 * I, [1.5, 1.35, 1.0], 1.3 * I * (1 - u) * (1 - u), 'ring'));
  }
  private won(w: number) {
    this.sfx('finale', null, {});
    const col = this.col(w);
    this.add(3.5, (u, age) => {
      const r = this.ctx.character(w).root;
      for (let i = 0; i < 3; i++) {
        const v = ((age * 0.8 + i / 3) % 1);
        this.ctx.glows.flat([r[0], r[1] + 0.02 + v * 2, r[2]], 0.5 - 0.2 * v, col, 1.2 * (1 - v) * (1 - smooth((u - 0.8) / 0.2)), 'ring');
      }
    });
  }
}

// The world answers the duel's big moments (phase 6, report 19's second issue: "nothing in the world answers the
// moment"). At a pair tier (DUET, CURRENT, MURMURATION, AURORA) and at a fused finale the duel's world responds,
// building with the tier, through the one shared hook every world's shaders read (worlds/answer.ts, answer.wgsl):
//   DUET         a wave of warm light runs out across the ground from the pair, the flowers open as it passes, the
//                fountains leap, the banners and chimes lift, the glass and the lanterns brighten
//   CURRENT      the same, stronger, and the sun breaks through high over the pair in shafts
//   MURMURATION  stronger again, pollen and fireflies swirl up round the pair, the first light of an aurora
//   AURORA       all of it, and an aurora opens across the sky
//   a fusion     the finale's flower is the light: it falls on the world round it (a lamp at the bloom's heart), the
//                shafts fan from it, the aurora opens, the wave runs out from the base's feet
// Each rises in a third of a second, holds a moment and settles over a few seconds back to nothing, so the calm
// stretches between moments stay calm (the hit-stop, the holds and the words are Phase 5's: weight.ts, hud-state.ts).
// The motes are the glow list's light, kept off the bodies as the moments' light is (fx.ts keepOff). Pure but for the
// hook it writes: events, the beat and positions in.
import type { Glows, RGB } from '../play/glow';
import type { DuelEvent } from '../../shared/duel.ts';
import { pairTierInfo } from '../../shared/duel.ts';
import type { AnswerNow } from '../worlds/answer';
import { NO_ANSWER } from '../worlds/answer';
import type { FinaleLook } from './finale';
import { bloomFade, BLOOM } from './bloom';

type V3 = [number, number, number];

export const ANSWER = {
  /** each pair tier's peak (DUET … AURORA) */
  PEAK: [0.45, 0.65, 0.85, 1.0],
  /** up over this (s), held this long at the peak by tier, then down over FALL_S by tier */
  RISE_S: 0.35,
  HOLD_S: [1.0, 1.6, 2.2, 3.2],
  FALL_S: [2.0, 2.4, 2.8, 3.4],
  /** the sun's shafts and the aurora by tier (0 … 1; a fusion has both whole) */
  SHAFTS: [0, 0.5, 0.8, 1.0],
  AURORA: [0, 0, 0.3, 1.0],
  /** the sun breaking through: this high over the pair and this far beyond it from the eye (m) */
  SUN_UP: 9,
  SUN_BACK: 14,
  /** pollen and fireflies swirling up round the pair: this many at the most (from MURMURATION; a few at CURRENT) */
  MOTES: 96,
  /** how much of the motes' light keeps off the bodies' cores (fx.ts keepOff) */
  KEEP_OFF: 0.9,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const GOLD: RGB = [1.75, 1.3, 0.5];
/** a CSS colour (#rrggbb) as linear rgb, warmed toward sun gold by `warm` */
export function tierRGB(css: string, warm = 0.3): V3 {
  const n = parseInt(css.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255) ** 2.2);
  const g = [1, 0.72, 0.32];
  return [c[0] + (g[0] - c[0]) * warm, c[1] + (g[1] - c[1]) * warm, c[2] + (g[2] - c[2]) * warm];
}

export interface DuelAnswerCtx {
  glows: Glows;
  /** the duel's world's light number (World.light) */
  light: () => number;
  /** the pair's middle on its floor, and the eye */
  pair: () => V3;
  eye: () => V3 | null;
  /** the finale as it stands (finale.ts), the base's feet, and the bloom's flower's heart once set (fx.ts) */
  finale: () => FinaleLook | null;
  foot: (seat: number) => V3;
  flower: () => V3 | null;
  /** the hook (worlds/answer.ts), or nothing (the Node harness) */
  write?: (a: AnswerNow) => void;
  /** the seats' colours (seat.ts), for the motes */
  seat: (k: number) => RGB;
}

export class DuelAnswer {
  /** the moment it answers: its tier (1 … 4; 0 none), where, its age (s), the level it rose from */
  private tier = 0;
  private at: V3 = [0, 0, 0];
  private age = 0;
  private from = 0;
  private t = 0;
  /** what was written this frame (bend.duel.answer.now) */
  now: AnswerNow = { ...NO_ANSWER };
  /** this frame's motes, as a range of the glow list (the moments probe may read it) */
  lit: [number, number] | null = null;
  /** the measure's switch (scripts/answer-cap.mjs): the same frame drawn without the answer */
  off = false;
  /** the measure's switch for the aurora alone (scripts/answer-cap.mjs: is it in the frame?) */
  noAurora = false;
  /** every moment answered: the set's seconds, its tier, its peak */
  readonly log: { t: number; tier: number }[] = [];

  constructor(private ctx: DuelAnswerCtx) {}

  /** how strongly the world answers now (0 … 1) */
  get level() { return this.now.level; }

  /** a pair tier's level `age` s after it (from: the level it rose from) */
  static envelope(tier: number, age: number, from = 0) {
    if (tier <= 0) return 0;
    const i = Math.min(4, tier) - 1, P = ANSWER.PEAK[i];
    const up = smooth(age / ANSWER.RISE_S), down = 1 - smooth((age - ANSWER.RISE_S - ANSWER.HOLD_S[i]) / ANSWER.FALL_S[i]);
    return Math.max(from * (1 - up), P * up) * down;
  }

  /** each frame: the rules' events, the music's beat (beats, fractional) */
  update(dt: number, events: readonly DuelEvent[], beat: number) {
    this.t += dt;
    this.age += dt;
    for (const e of events) {
      if (e.k === 'pairTier') {
        // (a tier on top of one still answering takes over from where it stands: the wave starts again from the pair)
        this.from = this.level;
        this.tier = e.tier; this.at = this.ctx.pair(); this.age = 0;
        this.log.push({ t: +this.t.toFixed(2), tier: e.tier });
      } else if (e.k === 'set') { this.tier = 0; this.from = 0; }
    }
    const pulse = Math.exp(-5 * (beat - Math.floor(beat)));
    const fin = this.ctx.finale();
    const G = this.ctx.glows;
    let a: AnswerNow;
    if (fin?.fused) {
      // the fusion: from the base's feet, as the lift rises, held through the duet and the banner's start, gone with the bloom
      const foot = this.ctx.foot(fin.base), heart = this.ctx.flower();
      const L = smooth((fin.u - 0.12) / 0.4) * bloomFade(fin);
      const open = heart ? smooth((fin.u - BLOOM.OPEN_U) / 0.2) : 0;
      a = {
        world: this.ctx.light(), at: foot, level: L, tier: 5, age: Math.max(0, fin.t - fin.len * 0.15), beat: pulse,
        sun: heart ?? [foot[0], foot[1] + 4, foot[2]], lamp: 0.9 * open, col: tierRGB('#ffc861', 0), aurora: 1, shafts: 0.4 + 0.6 * open,
      };
    } else {
      const lv = DuelAnswer.envelope(this.tier, this.age, this.from);
      if (lv <= 0.001 && this.age > 1) this.tier = 0;
      const i = Math.max(0, Math.min(4, this.tier) - 1), info = pairTierInfo(this.tier);
      const eye = this.ctx.eye() ?? [this.at[0], this.at[1] + 2, this.at[2] + 8];
      let bx = this.at[0] - eye[0], bz = this.at[2] - eye[2];
      const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      a = {
        world: lv > 0.001 ? this.ctx.light() : -1, at: this.at, level: lv, tier: this.tier, age: this.age, beat: pulse,
        sun: [this.at[0] + bx * ANSWER.SUN_BACK, this.at[1] + ANSWER.SUN_UP, this.at[2] + bz * ANSWER.SUN_BACK], lamp: 0,
        col: info ? tierRGB(info.color) : [1, 0.72, 0.32], aurora: ANSWER.AURORA[i], shafts: ANSWER.SHAFTS[i],
      };
    }
    this.now = a;
    this.ctx.write?.(this.off ? NO_ANSWER : this.noAurora ? { ...a, aurora: 0 } : a);
    // pollen and fireflies rising round the pair in a widening spiral (from MURMURATION, a few at CURRENT; a fusion's
    // through its duet), sun gold with the two seats' colours among them
    this.lit = null;
    const motes = this.off ? 0 : Math.round(ANSWER.MOTES * a.level * (a.tier >= 5 ? 1 : a.tier >= 3 ? 1 : a.tier === 2 ? 0.35 : 0));
    if (motes > 0) {
      const g0 = G.count, c = a.at, ca = this.ctx.seat(0), cb = this.ctx.seat(1), accent: RGB = [a.col[0] * 1.6, a.col[1] * 1.6, a.col[2] * 1.6];
      for (let i = 0; i < motes; i++) {
        const life = 3.2 + 1.6 * hash(i * 1.9), v = ((this.t + hash(i * 4.7) * life) / life) % 1;
        const ang = i * 2.39996 + this.t * (0.5 + 0.4 * hash(i * 3.3)) + v * 2.2, r = 0.9 + (1.2 + 4.5 * hash(i * 2.1)) * Math.sqrt(v);
        const p: V3 = [c[0] + Math.cos(ang) * r, c[1] + 0.15 + v * (3 + 3 * hash(i * 5.9)), c[2] + Math.sin(ang) * r];
        // (phase 7, report 24: one colour accent a moment: a pair tier's motes its own colour among sun gold, a fusion's
        // the two seats' as before)
        const col = a.tier >= 5 ? (i % 5 === 0 ? ca : i % 5 === 1 ? cb : GOLD) : i % 3 === 0 ? accent : GOLD, flick = 0.75 + 0.25 * Math.sin(this.t * 7 + i * 1.7);
        G.dot(p, 0.03 + 0.02 * hash(i * 6.1), col, 1.6 * Math.sin(Math.PI * v) * flick * Math.min(1, a.level * 1.4), 'spark');
      }
      this.lit = [g0, G.count];
    }
  }
}

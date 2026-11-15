// The world answering a moment (phase 6, report 20): the one shared hook every world's shaders read
// (worlds/answer.wgsl, `worldLight.answer`). Whoever has a moment to answer (src/duel/answer.ts: a pair tier, a fused
// finale) writes it here each frame: which world, where, how strongly, the wave's age, the beat, the light's source and
// strength, the colour, the aurora and the sun's shafts. Nothing here knows a world or a duel; a world reads it with
// its own light number, so a gate's view of another world never answers.
// (pure: the slot is handed in, `new WorldAnswer(lightSlot(kit, 'answer'))`, so what writes it runs in Node too)
import type { LightSlot } from './shared';
import type { WorldLight } from './light.wgsl';

type V3 = readonly [number, number, number];

export interface AnswerNow {
  /** the answering world's light number (World.light), or -1: nothing answers */
  world: number;
  /** where the moment happened (its wave starts there) */
  at: V3;
  /** how strongly (0 … 1) */
  level: number;
  /** 1 DUET … 4 AURORA, 5 a fusion */
  tier: number;
  /** seconds since the moment */
  age: number;
  /** the beat (1 on it, falling to 0) */
  beat: number;
  /** where the light comes from, and how strongly it lights the world round it (0 … 1) */
  sun: V3;
  lamp: number;
  /** the moment's colour (linear rgb) */
  col: V3;
  /** the aurora and the sun's shafts (0 … 1) */
  aurora: number;
  shafts: number;
}

export const NO_ANSWER: AnswerNow = { world: -1, at: [0, 0, 0], level: 0, tier: 0, age: 0, beat: 0, sun: [0, 0, 0], lamp: 0, col: [0, 0, 0], aurora: 0, shafts: 0 };

/** the kit's answer slot: `write(now)` once a frame (uploaded with the rest of the world light at the next run) */
export class WorldAnswer {
  constructor(private slot: LightSlot<WorldLight['answer']>) {}
  write(a: AnswerNow) {
    const on = a.world >= 0 && a.level > 0.001;
    this.slot.set({
      at: [a.at[0], a.at[1], a.at[2], on ? a.level : 0],
      k: [on ? a.world + 1 : 0, a.tier, a.age, a.beat],
      sun: [a.sun[0], a.sun[1], a.sun[2], a.lamp],
      col: [a.col[0], a.col[1], a.col[2], 0],
      more: [a.aurora, a.shafts, 0, 0],
    });
  }
}

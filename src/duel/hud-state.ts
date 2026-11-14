// What the duel tells the HUD each frame (docs/design/duel.md, "The HUD"): one plain object, built here from the
// duel's state, the two bodies and the beat, and handed to `bend.hud.set(state)` when the HUD is on the page (src/hud
// draws it; the duel draws no HUD of its own). The pops (PERFECT, KO, BEND, …) are kept here: events push them, they
// age and go.
//
// (The HUD is src/hud's: its HudState is the contract's, docs/design/duel.md.)
import { DUEL, type DuelEvent, type DuelState } from '../../shared/duel.ts';
import type { HudPlayer, HudPop, HudState } from '../hud';

export type { HudState };

/** each matter's colour on the HUD (CSS), the duel's tag colours */
export const MATTER_CSS: Record<string, string> = {
  fire: '#ff9a3c', plasma: '#c27bff', water: '#4cc3ff', ice: '#b8ecff', gems: '#e2a6ff', steam: '#e8eef2',
};

/** a seat as the HUD builder needs it */
export interface HudSeat {
  name: string;
  matter: string;
  /** the head, on screen 0 … 1 (null: off screen) */
  screen: [number, number] | null;
  /** the dash's readiness 0 … 1 (1 where the body has no dash yet) */
  dash: number;
  /** its flow 0 … 1 (what dancing well built: the super meter until phase 2's super spends it) */
  flow: number;
}

const POP_LIFE = 1.1;

export class DuelHud {
  readonly pops: HudPop[] = [];
  /** the last state built */
  state: HudState | null = null;

  /** the duel's events this frame as pops, at the bodies' screen places (or the screen's middle) */
  events(ev: readonly DuelEvent[], seats: readonly HudSeat[]) {
    const at = (s: number | undefined): [number, number] => { const p = s != null ? seats[s]?.screen : null; return p ? [p[0], Math.max(0.08, p[1] - 0.08)] : [0.5, 0.42]; };
    for (const e of ev) {
      switch (e.k) {
        case 'go': this.pops.push({ text: 'BEND', at: [0.5, 0.42], age: 0, kind: 'info' }); break;
        case 'hit': if (e.perfect) this.pops.push({ text: 'PERFECT', seat: e.by, at: at(e.target), age: 0, kind: 'perfect' }); break;
        case 'ko': this.pops.push({ text: e.how === 'fall' ? 'FELL' : 'KO', seat: 1 - e.target, at: at(e.target), age: 0, kind: 'ko' }); break;
        case 'block': this.pops.push({ text: 'BLOCK', seat: e.target, at: at(e.target), age: 0, kind: 'info' }); break;
        case 'clash': this.pops.push({ text: 'CLASH', at: at(undefined), age: 0, kind: 'react' }); break;
        case 'won': this.pops.push({ text: `P${e.winner + 1} WINS`, seat: e.winner, at: [0.5, 0.38], age: 0, kind: 'info' }); break;
      }
    }
  }

  /** this frame's HudState */
  build(d: DuelState, now: number, dt: number, seats: readonly HudSeat[], beat: number, bpm: number): HudState {
    for (const p of this.pops) p.age += dt;
    for (let i = this.pops.length - 1; i >= 0; i--) if (this.pops[i].age > POP_LIFE) this.pops.splice(i, 1);
    const players: HudPlayer[] = [0, 1].map((k) => {
      const S = d.seats[k], s = seats[k];
      const reforming = S.life === 'alive' ? 0 : Math.min(1, (now - S.since) / DUEL.REFORM_MS);
      return {
        seat: k as 0 | 1, name: s?.name ?? `P${k + 1}`, color: MATTER_CSS[s?.matter ?? 'gems'] ?? '#ffffff', matter: s?.matter ?? 'gems',
        hits: S.hits, hitsMax: DUEL.HITS_MAX, kos: S.kos, dash: s?.dash ?? 1, charges: [], superMeter: s?.flow ?? 0, reforming,
        ...(s?.screen ? { screen: s.screen } : {}),
      };
    });
    const anyOut = d.seats.some((S) => S.life !== 'alive');
    const phase = d.phase === 'play' ? (anyOut ? 'ko' : 'play') : d.phase === 'countdown' ? 'countdown' : d.round === 0 ? 'countdown' : 'won';
    const time = d.phase === 'countdown' ? 0 : ((d.phase === 'won' ? d.since : now) - d.playFrom) / 1000;
    const st: HudState = {
      mode: 'duel', players,
      round: { koTarget: DUEL.KO_TARGET, time: Math.max(0, time), phase, ...(phase === 'countdown' ? { countdown: d.count } : {}), ...(d.winner != null ? { winner: d.winner } : {}) },
      beat: { phase: beat - Math.floor(beat), bpm, window: DUEL.PERFECT_MS / 1000 },
      pops: this.pops.map((p) => ({ ...p, at: [p.at[0], p.at[1]] })),
    };
    this.state = st;
    return st;
  }
}

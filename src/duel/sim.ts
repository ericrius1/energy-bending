// A duel played without a page: two brains through their drivers, the real bodies (Character) on an arena's plane, the
// duel's rules (match.ts), at a fixed step on a virtual music clock. The tests run it; scripts/duel-sim.mjs prints what
// it measures over many seeded rounds: how long a KO takes, hits per KO, how long a round is, how often each move is
// used, wall jumps per minute, time in the air. Deterministic: the same brains, seeds and arena play the same duel.
import { Character, PHYS } from '../dancer/character';
import { makeIntent, type Intent } from '../input/intent';
import type { StagePlane } from '../engine/camera';
import type { Brain, StageView } from '../ai/brain';
import { Scene } from '../ai/scene';
import { BrainDriver } from '../ai/driver';
import { DuelBrain, type DuelSight, type DuelStyle } from '../ai/duel-brain';
import { DuelMatch, duelPlane } from './match';
import { arenaFor, type Arena } from './arena';
import { fallbackArena, wallsOf } from './fallback';
import { stageFor } from './stages';
import type { DuelEvent } from '../../shared/duel.ts';

export interface DuelSimOptions {
  arena: Arena;
  /** the two seats' brains (made with `duelSight` when they are DuelBrains: see makeBrains) */
  brains: [Brain | null, Brain | null] | ((sight: () => DuelSight) => [Brain | null, Brain | null]);
  /** stop after this many rounds (won), or this many seconds, whichever first */
  rounds?: number;
  seconds?: number;
  dt?: number;
  bpm?: number;
  each?: (f: { t: number; beat: number; match: DuelMatch; bodies: readonly Character[]; intents: Intent[]; events: DuelEvent[] }) => void;
}

export interface SeatStats {
  moves: Record<string, number>;
  jumps: number;
  airJumps: number;
  wallJumps: number;
  airTime: number;
  hits: number;
  perfect: number;
  kos: number;
  falls: number;
  brain: Record<string, number>;
}

export interface DuelSimResult {
  seconds: number;
  rounds: { winner: number; ms: number; kos: [number, number] }[];
  /** seconds from a body's re-forming (or the round's start) to its next KO */
  koTimes: number[];
  hitsPerKo: number[];
  seats: [SeatStats, SeatStats];
  stats: DuelMatch['state']['stats'];
  match: DuelMatch;
}

/** the arena a world duels in: its registered one, or the fallback from its stage plane (in Node, from the worlds' layouts: stages.ts) */
export function arenaOf(world: string, stage?: StagePlane | null): Arena {
  const a = arenaFor(world);
  if (a) return a;
  const st = stage ?? stageFor(world);
  if (!st) throw new Error(`duel: no stage for ${world} in Node (temple, forge, pool)`);
  return fallbackArena(world, st);
}

/** two DuelBrains by style and skill, with seeds */
export function makeBrains(styles: [DuelStyle, DuelStyle], skills: [number, number], seeds: [number, number]) {
  return (sight: () => DuelSight) => [0, 1].map((k) => new DuelBrain({ style: styles[k], skill: skills[k], seed: seeds[k], duel: sight })) as [DuelBrain, DuelBrain];
}

const blankStats = (): SeatStats => ({ moves: {}, jumps: 0, airJumps: 0, wallJumps: 0, airTime: 0, hits: 0, perfect: 0, kos: 0, falls: 0, brain: {} });

export function simulateDuel(o: DuelSimOptions): DuelSimResult {
  const dt = o.dt ?? 1 / 60, bpm = o.bpm ?? 112, A = o.arena;
  const plane = duelPlane(A);
  const chars = [0, 1].map((k) => new Character({ seat: k, plane })) as [Character, Character];
  const match = new DuelMatch(chars, A, plane, 0, bpm);
  const sight = (): DuelSight => ({
    untouchable: [match.untouchable(0, now), match.untouchable(1, now)], frozen: [match.frozen(0), match.frozen(1)],
    yKill: A.bounds.yKill, spawns: A.spawns,
  });
  let now = 0;
  const brains = typeof o.brains === 'function' ? o.brains(sight) : o.brains;
  const scene = new Scene();
  const bodies = chars.map((c, k) => ({ id: `seat.${k}`, seat: k, character: c }));
  scene.bodies = bodies;
  const stage: StageView = { plane, stage: plane, terrain: { groundAt: () => 0 }, gates: [], room: 7 };
  const drivers = brains.map((b, k) => (b ? new BrainDriver(b, bodies[k], scene, () => stage) : null));
  const seats: [SeatStats, SeatStats] = [blankStats(), blankStats()];
  const res: DuelSimResult = { seconds: 0, rounds: [], koTimes: [], hitsPerKo: [], seats, stats: match.state.stats, match };
  const lifeFrom = [0, 0], hitsThisLife = [0, 0];
  const lim = plane.halfWidth - PHYS.wallMargin;
  const nearWall = (c: Character) => {
    const s = c.s, y = c.root[1] - plane.origin[1];
    if (Math.abs(s) > lim - 0.4) return true;
    return wallsOf(plane).some((w) => y + 1.2 >= w.y0 && y <= w.y1 && (s - w.s) * w.side > 0 && (s - w.s) * w.side < PHYS.halfW + 0.4);
  };
  const maxT = o.seconds ?? 3600, maxRounds = o.rounds ?? 1;
  const frames = Math.round(maxT / dt);
  for (let i = 1; i <= frames; i++) {
    const t = i * dt;
    now = t * 1000;
    const beat = (now * bpm) / 60000;
    scene.update({ t, dt, beat, bpm, music: { level: 0.7, breakdown: false }, rules: null });
    chars[0].lookAt = chars[1].root; chars[1].lookAt = chars[0].root;
    const intents: Intent[] = [];
    for (let k = 0; k < 2; k++) {
      const d = drivers[k];
      let it = d ? d.think() : makeIntent();
      if (match.frozen(k)) it = makeIntent();
      intents.push(it);
      const c = chars[k];
      c.update(dt, it, { beats: beat, bpm });
      for (const e of c.events) {
        if (e.type === 'move') seats[k].moves[e.move as string] = (seats[k].moves[e.move as string] ?? 0) + 1;
        else if (e.type === 'jump' || e.type === 'walljump' || e.type === 'wallJump') {
          // (a wall jump: the body's own event when it has one, or a jump in the air against a wall)
          const wall = e.type !== 'jump' || !!e.wall || (e.air && nearWall(c));
          if (wall) seats[k].wallJumps++; else if (e.air) seats[k].airJumps++; else seats[k].jumps++;
        }
      }
      c.events.length = 0;
      if (!c.grounded && !c.reforming && !match.frozen(k)) seats[k].airTime += dt;
    }
    const ev = match.step(now, beat, bpm);
    for (const e of ev) {
      if (e.k === 'hit') { seats[e.by].hits++; if (e.perfect) seats[e.by].perfect++; hitsThisLife[e.target]++; }
      else if (e.k === 'ko') {
        seats[1 - e.target].kos++; if (e.how === 'fall') seats[e.target].falls++;
        res.koTimes.push((now - lifeFrom[e.target]) / 1000); res.hitsPerKo.push(hitsThisLife[e.target]); hitsThisLife[e.target] = 0;
      } else if (e.k === 'ready') lifeFrom[e.seat] = now;
      else if (e.k === 'go') { lifeFrom[0] = lifeFrom[1] = now; hitsThisLife[0] = hitsThisLife[1] = 0; }
      else if (e.k === 'won') res.rounds.push({ winner: e.winner, ms: e.ms, kos: e.kos });
    }
    o.each?.({ t, beat, match, bodies: chars, intents, events: ev });
    res.seconds = t;
    if (res.rounds.length >= maxRounds) break;
  }
  for (let k = 0; k < 2; k++) { const b = brains[k] as DuelBrain | null; if (b && 'counts' in b) seats[k].brain = { ...b.counts }; }
  return res;
}

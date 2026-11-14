// A duel played without a page: two brains through their drivers, the real bodies (Character), free in the world's 3D
// (its floor, its solids, its pit) or locked to the arena's stage plane, the duel's rules (match.ts), at a fixed step on
// a virtual music clock. The tests run it; scripts/duel-sim.mjs prints what it measures over many seeded rounds: how
// long a KO takes, hits per KO, how long a round is, how often each move is used, wall jumps a minute, time in the air,
// the flow built. Deterministic: the same brains, seeds, arena and view play the same duel.
//
// (Free bodies stand on the world's floor, groundAt: until the movement work gives them walls in 3D, a body can walk
// into a pillar here as in the page. The brains go round them.)
import { Character } from '../dancer/character';
import { makeIntent, type Intent } from '../input/intent';
import type { Brain, StageView } from '../ai/brain';
import { Scene } from '../ai/scene';
import { BrainDriver } from '../ai/driver';
import { DuelBrain, type DuelSight, type DuelStyle } from '../ai/duel-brain';
import { DuelMatch, duelPlane } from './match';
import { arenaFor, type Arena } from './arena';
import { fallbackArena, type WorldLike } from './fallback';
import { worldFor } from './stages';
import type { DuelEvent } from '../../shared/duel.ts';
import type { Solid } from '../worlds/solids';

export interface DuelSimOptions {
  arena: Arena;
  /** the world's floor, solids and fall-out (stages.ts worldFor) */
  world: WorldLike;
  /** locked to the stage plane (the 2D option), or free in 3D (default) */
  locked?: boolean;
  /** the two seats' brains: a function given what DuelBrains see (makeBrains), or the brains */
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
  flips: number;
  airTime: number;
  hits: number;
  perfect: number;
  kos: number;
  falls: number;
  /** the flow it ended rounds with, and its most */
  flow: number;
  flowMax: number;
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
  /** how far apart the two stood (m), sampled each second, and the share of time either stood outside the space */
  spread: number[];
  match: DuelMatch;
}

/** the arena and the world a world id duels in, in Node: its registered arena or the fallback */
export function nodeArena(id: string): { arena: Arena; world: WorldLike } {
  const w = worldFor(id);
  if (!w) throw new Error(`duel: no world ${id} in Node (temple, forge, pool)`);
  return { arena: arenaFor(id) ?? fallbackArena(w, w.stage), world: w };
}

/** two DuelBrains by style and skill, with seeds */
export function makeBrains(styles: [DuelStyle, DuelStyle], skills: [number, number], seeds: [number, number]) {
  return (sight: () => DuelSight) => [0, 1].map((k) => new DuelBrain({ style: styles[k], skill: skills[k], seed: seeds[k], duel: sight })) as [DuelBrain, DuelBrain];
}

const blankStats = (): SeatStats => ({ moves: {}, jumps: 0, airJumps: 0, wallJumps: 0, flips: 0, airTime: 0, hits: 0, perfect: 0, kos: 0, falls: 0, flow: 0, flowMax: 0, brain: {} });

export function simulateDuel(o: DuelSimOptions): DuelSimResult {
  const dt = o.dt ?? 1 / 60, bpm = o.bpm ?? 112, A = o.arena, W = o.world;
  const plane = duelPlane(A);
  const terrain = { groundAt: (x: number, z: number) => W.groundAt(x, z), fallY: W.fallY };
  const solids: Solid[] = [...(W.solids ?? []), ...(A.pieces ?? [])];
  const chars = [0, 1].map((k) => {
    const c = new Character({ seat: k, plane: o.locked ? plane : null, terrain });
    if (!o.locked) { const s = A.spawns[k]; c.reset(s[0], undefined, s[2]); }
    return c;
  }) as [Character, Character];
  const match = new DuelMatch(chars, A, plane, 0, bpm, { solids: () => solids });
  let now = 0;
  const sight = (): DuelSight => ({
    untouchable: [match.untouchable(0, now), match.untouchable(1, now)], frozen: [match.frozen(0), match.frozen(1)],
    yKill: A.space.yKill, space: A.space, spawns: A.spawns, solids, groundAt: terrain.groundAt,
  });
  const brains = typeof o.brains === 'function' ? o.brains(sight) : o.brains;
  const scene = new Scene();
  const bodies = chars.map((c, k) => ({ id: `seat.${k}`, seat: k, character: c }));
  scene.bodies = bodies;
  const stage: StageView = { plane: o.locked ? plane : null, stage: plane, terrain, gates: [], room: A.space.radius, solids };
  const drivers = brains.map((b, k) => (b ? new BrainDriver(b, bodies[k], scene, () => stage) : null));
  const seats: [SeatStats, SeatStats] = [blankStats(), blankStats()];
  const res: DuelSimResult = { seconds: 0, rounds: [], koTimes: [], hitsPerKo: [], seats, stats: match.state.stats, spread: [], match };
  const lifeFrom = [0, 0], hitsThisLife = [0, 0];
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
      chars[k].update(dt, it, { beats: beat, bpm });
      if (!chars[k].grounded && !chars[k].reforming && !match.frozen(k)) seats[k].airTime += dt;
    }
    const ev = match.step(now, beat, bpm);
    for (let k = 0; k < 2; k++) {
      const S = seats[k];
      for (const e of match.bodyEvents[k]) {
        if (e.type === 'move') S.moves[e.move as string] = (S.moves[e.move as string] ?? 0) + 1;
        else if (e.type === 'jump' && !match.travel[k].includes('wall')) { if (e.air) S.airJumps++; else S.jumps++; }
      }
      for (const x of match.travel[k]) { if (x === 'wall') S.wallJumps++; else S.flips++; }
      S.flowMax = Math.max(S.flowMax, match.state.seats[k].flow);
    }
    for (const e of ev) {
      if (e.k === 'hit') { seats[e.by].hits++; if (e.perfect) seats[e.by].perfect++; hitsThisLife[e.target]++; }
      else if (e.k === 'ko') {
        seats[1 - e.target].kos++; if (e.how === 'fall') seats[e.target].falls++;
        res.koTimes.push((now - lifeFrom[e.target]) / 1000); res.hitsPerKo.push(hitsThisLife[e.target]); hitsThisLife[e.target] = 0;
      } else if (e.k === 'ready') lifeFrom[e.seat] = now;
      else if (e.k === 'go') { lifeFrom[0] = lifeFrom[1] = now; hitsThisLife[0] = hitsThisLife[1] = 0; }
      else if (e.k === 'won') { res.rounds.push({ winner: e.winner, ms: e.ms, kos: e.kos }); for (let k = 0; k < 2; k++) seats[k].flow = match.state.seats[k].flow; }
    }
    if (i % 60 === 0) res.spread.push(Math.hypot(chars[0].root[0] - chars[1].root[0], chars[0].root[2] - chars[1].root[2]));
    o.each?.({ t, beat, match, bodies: chars, intents, events: ev });
    res.seconds = t;
    if (res.rounds.length >= maxRounds) break;
  }
  for (let k = 0; k < 2; k++) { const b = brains[k] as DuelBrain | null; if (b && 'counts' in b) seats[k].brain = { ...b.counts }; }
  return res;
}

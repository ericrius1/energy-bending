// A dance battle played without a page: two virtual players through their drivers, the real bodies (Character, on the
// duel's profile: the dash, wall slides and kicks, the world's solids to stand on and kick off), free in the world's 3D
// or locked to the arena's stage plane, the contact physics and the rules (match.ts), at a fixed step on a virtual music
// clock. The tests run it; scripts/duel-sim.mjs prints what it measures over many seeded sets: combos a minute, the
// longest combo, catches (and out of the air), swings, flings, lifts, vaults, counters, time in the air, falls, style,
// the shared energy's peak and the merges. Deterministic: the same brains, seeds, arena and view play the same set.
import { Character } from '../dancer/character';
import { makeIntent, type Intent } from '../input/intent';
import type { Brain, StageView } from '../ai/brain';
import { Scene } from '../ai/scene';
import { BrainDriver } from '../ai/driver';
import { DuelBrain, type DuelSight, type DuelStyle } from '../ai/duel-brain';
import { DuelMatch, duelPlane } from './match';
import { splitIntent, noInput, type ContactInput } from './contact';
import type { Arena } from './arena';
import type { WorldLike } from './fallback';
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
  /** stop after this many sets, or this many seconds, whichever first; a set's length (ms) */
  sets?: number;
  seconds?: number;
  setMs?: number;
  dt?: number;
  bpm?: number;
  each?: (f: { t: number; beat: number; match: DuelMatch; bodies: readonly Character[]; intents: Intent[]; events: DuelEvent[] }) => void;
}

export interface SeatStats {
  /** links by kind, combos banked, the longest, style at each set's end */
  links: Record<string, number>;
  combos: number;
  comboLinks: number;
  longest: number;
  style: number;
  airTime: number;
  falls: number;
  brain: Record<string, number>;
}

export interface DuelSimResult {
  seconds: number;
  /** seconds of play (the sets' play, not their count-ins and finales) */
  play: number;
  sets: { winner: number; style: [number, number]; peak: number; fused: boolean }[];
  seats: [SeatStats, SeatStats];
  stats: DuelMatch['state']['stats'];
  /** how long each hold lasted (s), how far apart the two stood (m, each second) */
  holds: number[];
  spread: number[];
  match: DuelMatch;
}

/** the arena and the world a world id duels in, in Node: the world's own arena (worlds/<id>/arena.ts), shown */
export function nodeArena(id: string): { arena: Arena; world: WorldLike } {
  const w = worldFor(id);
  if (!w) throw new Error(`duel: no world ${id} in Node (temple, forge, pool)`);
  return { arena: w.arena, world: w };
}

/** two DuelBrains by style and skill, with seeds */
export function makeBrains(styles: [DuelStyle, DuelStyle], skills: [number, number], seeds: [number, number]) {
  return (sight: () => DuelSight) => [0, 1].map((k) => new DuelBrain({ style: styles[k], skill: skills[k], seed: seeds[k], duel: sight })) as [DuelBrain, DuelBrain];
}

const blankStats = (): SeatStats => ({ links: {}, combos: 0, comboLinks: 0, longest: 0, style: 0, airTime: 0, falls: 0, brain: {} });

export function simulateDuel(o: DuelSimOptions): DuelSimResult {
  const dt = o.dt ?? 1 / 60, bpm = o.bpm ?? 112, A = o.arena, W = o.world;
  const plane = duelPlane(A);
  // (the world's solids, with the arena's pieces while it is shown, as the page's World.solids)
  const solids: Solid[] = [...(W.solids ?? [])];
  const terrain = { groundAt: (x: number, z: number) => W.groundAt(x, z), fallY: W.fallY, solids };
  const chars = [0, 1].map((k) => {
    const c = new Character({ seat: k, plane: o.locked ? plane : null, terrain });
    c.setProfile('duel');
    if (!o.locked) { const s = A.spawns[k]; c.reset(s[0], undefined, s[2]); }
    return c;
  }) as [Character, Character];
  const match = new DuelMatch(chars, A, plane, 0, bpm, { solids: () => solids, setMs: o.setMs });
  const sight = (): DuelSight => {
    const L = match.contact.link;
    return {
      frozen: [match.frozen(0), match.frozen(1)], link: L ? { holder: L.holder, held: L.held, age: match.contact.age } : null,
      flown: match.contact.flown?.flyer ?? null,
      yKill: A.space.yKill, space: A.space, spawns: A.spawns, solids, groundAt: terrain.groundAt,
    };
  };
  const brains = typeof o.brains === 'function' ? o.brains(sight) : o.brains;
  const scene = new Scene();
  const bodies = chars.map((c, k) => ({ id: `seat.${k}`, seat: k, character: c }));
  scene.bodies = bodies;
  const stage: StageView = { plane: o.locked ? plane : null, stage: plane, terrain, gates: [], room: A.space.radius, solids };
  const drivers = brains.map((b, k) => (b ? new BrainDriver(b, bodies[k], scene, () => stage) : null));
  const seats: [SeatStats, SeatStats] = [blankStats(), blankStats()];
  const res: DuelSimResult = { seconds: 0, play: 0, sets: [], seats, stats: match.state.stats, holds: [], spread: [], match };
  const maxT = o.seconds ?? 3600, maxSets = o.sets ?? 1;
  const frames = Math.round(maxT / dt);
  let holdFrom = -1;
  for (let i = 1; i <= frames; i++) {
    const t = i * dt, now = t * 1000, beat = (now * bpm) / 60000;
    scene.update({ t, dt, beat, bpm, music: { level: 0.7, breakdown: false }, rules: null });
    chars[0].lookAt = chars[1].root; chars[1].lookAt = chars[0].root;
    const intents: Intent[] = [], ins: ContactInput[] = [];
    for (let k = 0; k < 2; k++) {
      const d = drivers[k];
      let it = d ? d.think() : makeIntent();
      if (match.frozen(k)) it = makeIntent();
      ins.push(match.frozen(k) ? noInput() : splitIntent(chars[k], it, match.contact.holding(k), match.contact.held(k)));
      intents.push(it);
      chars[k].update(dt, it, { beats: beat, bpm });
      if (!chars[k].grounded && !chars[k].reforming && !match.frozen(k)) seats[k].airTime += dt;
    }
    const ev = match.step(now, beat, bpm, dt * 1000, [ins[0], ins[1]]);
    if (match.state.phase === 'play') res.play += dt;
    const L = match.contact.link;
    if (L && holdFrom < 0) holdFrom = t;
    else if (!L && holdFrom >= 0) { res.holds.push(t - holdFrom); holdFrom = -1; }
    for (const e of ev) {
      if (e.k === 'link') seats[e.seat].links[e.kind] = (seats[e.seat].links[e.kind] ?? 0) + 1;
      else if (e.k === 'combo') { const S = seats[e.seat]; if (e.why !== 'fall') { S.combos++; S.comboLinks += e.n; } S.longest = Math.max(S.longest, e.n); }
      else if (e.k === 'fall') seats[e.seat].falls++;
      else if (e.k === 'done') { res.sets.push({ winner: e.winner, style: e.style, peak: match.state.peak, fused: match.state.fused }); for (let k = 0; k < 2; k++) seats[k].style += e.style[k]; }
    }
    if (i % 60 === 0) res.spread.push(Math.hypot(chars[0].root[0] - chars[1].root[0], chars[0].root[2] - chars[1].root[2]));
    o.each?.({ t, beat, match, bodies: chars, intents, events: ev });
    res.seconds = t;
    if (res.sets.length >= maxSets) break;
  }
  for (let k = 0; k < 2; k++) { const b = brains[k] as DuelBrain | null; if (b && 'counts' in b) seats[k].brain = { ...b.counts }; }
  return res;
}

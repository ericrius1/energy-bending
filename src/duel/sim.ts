// A dance battle played without a page: two virtual players through their drivers, the real bodies (Character, on the
// duel's profile: the dash, wall slides and kicks, the world's solids to stand on and kick off), free in the world's 3D
// or locked to the arena's stage plane, the contact physics and the rules (match.ts), at a fixed step on a virtual music
// clock. The tests run it; scripts/duel-sim.mjs prints what it measures over many seeded sets: combos a minute, the
// longest combo, catches (and out of the air), swings, flings, lifts, vaults, counters, time in the air, falls, style,
// the shared energy's peak and the merges; and the powers (powers.ts: flow, casts, the power form, reactions) for the
// two seats' matters (`dress`). Deterministic: the same brains, seeds, arena and view play the same set.
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
import { onBeat, type DuelEvent } from '../../shared/duel.ts';
import { matterOf, type PowerEvent } from '../../shared/powers.ts';
import { DuelHud, type HudSeat } from './hud-state';
import type { Solid } from '../worlds/solids';
import { DuelPowers, noPower, type PowerInput } from './powers';
import { DuelHazards } from './hazards';
import { CrossJudge, crossPair, nodeWorld, duelDoors, type DuelCross } from './crossing';
import { Voyage, type Disc } from './voyage';

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
  /** the two seats' matters (default fire and water): their powers; `powers: false` plays without any */
  dress?: [string, string];
  powers?: boolean;
  /** the weight of contact's time warp, as the page plays it (weight.ts: holds on a catch, a beat slowed on a pair tier);
   *  off by default (the tests' sets are the bodies' plain time), on in the probe (scripts/duel-sim.mjs) */
  warp?: boolean;
  /** the arena's gentle hazards (hazards.ts: the tide, the wind, the swell, the crystals' hum); default on where the
   *  arena has them */
  hazards?: boolean;
  /** the mirrors (crossing.ts): a body whose middle passes a disc takes the duel to that world, its partner brought
   *  along, the set going on in the new world's arena with its solids and hazard (default off: the measures stay in one
   *  world; on, `crossings` counts them) */
  mirrors?: boolean;
  /** with the mirrors: the pair's voyages, as the page runs them (voyage.ts), seeded (default 5, the page's) */
  voyageSeed?: number;
  each?: (f: { t: number; beat: number; match: DuelMatch; powers: DuelPowers | null; bodies: readonly Character[]; intents: Intent[]; events: DuelEvent[] }) => void;
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
  sets: { winner: number; style: [number, number]; peak: number; fused: boolean; /** the longest stretch at the fusion's height (s), the merges */ high: number; merges: number }[];
  seats: [SeatStats, SeatStats];
  stats: DuelMatch['state']['stats'];
  /** how long each hold lasted (s), how far apart the two stood (m, each second) */
  holds: number[];
  spread: number[];
  /** how the holds ended: fling, release (stretched or too long), lift, counter */
  ends: Record<string, number>;
  /** each MERGE's time into its set's play (s), per set; every banked combo's length; the HUD's pops: the most new
   *  ones (new ids) inside any one second, and how many were updated in place rather than added */
  merges: number[][];
  combos: number[];
  pops: { max: number; total: number; updates: number };
  /** the shared energy, each second of play: [s into the set, energy] per set */
  energy: [number, number][][];
  match: DuelMatch;
  /** the powers: each seat's casts by power and forms, the reactions, what the bodies felt, every power event */
  powers: { casts: [Record<string, number>, Record<string, number>]; forms: [number, number]; reactions: Record<string, number>; felt: DuelPowers['felt']; events: { t: number; e: PowerEvent }[] } | null;
  /** the hazards: each one's rides (how many, seconds), seconds the bodies spent in water; null: none */
  hazards: { rides: Record<string, { n: number; s: number }>; waterS: number } | null;
  /** the crossings through the mirrors (`mirrors`): when (s), and the crossing (crossing.ts DuelCross) */
  crossings: ({ t: number; meant?: boolean } & DuelCross)[];
  /** the world the duel ended in */
  world: string;
}

/** the arena and the world a world id duels in, in Node: the world's own arena (worlds/<id>/arena.ts), shown */
export function nodeArena(id: string): { arena: Arena; world: WorldLike } {
  const w = worldFor(id);
  if (!w) throw new Error(`duel: no world ${id} in Node (temple, geode, pool)`);
  return { arena: w.arena, world: w };
}

/** two DuelBrains by style and skill, with seeds */
export function makeBrains(styles: [DuelStyle, DuelStyle], skills: [number, number], seeds: [number, number]) {
  return (sight: () => DuelSight) => [0, 1].map((k) => new DuelBrain({ style: styles[k], skill: skills[k], seed: seeds[k], duel: sight })) as [DuelBrain, DuelBrain];
}

const blankStats = (): SeatStats => ({ links: {}, combos: 0, comboLinks: 0, longest: 0, style: 0, airTime: 0, falls: 0, brain: {} });

export function simulateDuel(o: DuelSimOptions): DuelSimResult {
  const dt = o.dt ?? 1 / 60, bpm = o.bpm ?? 112;
  let A = o.arena, W = o.world;
  let plane = duelPlane(A);
  // (the world's solids, with the arena's pieces while it is shown, as the page's World.solids)
  const solids: Solid[] = [...(W.solids ?? [])];
  const terrain = { groundAt: (x: number, z: number) => W.groundAt(x, z), get fallY() { return W.fallY; }, solids };
  const chars = [0, 1].map((k) => {
    const c = new Character({ seat: k, plane: o.locked ? plane : null, terrain });
    c.setProfile('duel');
    if (!o.locked) { const s = A.spawns[k]; c.reset(s[0], undefined, s[2]); }
    return c;
  }) as [Character, Character];
  const match = new DuelMatch(chars, A, plane, 0, bpm, { solids: () => solids, setMs: o.setMs });
  const dress = o.dress ?? ['fire', 'water'];
  const powers = o.powers === false ? null : new DuelPowers(chars, match, { matter: [matterOf(dress[0]), matterOf(dress[1])], sink: solids, groundAt: terrain.groundAt, yKill: A.space.yKill });
  let hazards = A.hazard ? new DuelHazards(chars, match, A, { on: o.hazards ?? true }) : null;
  // the mirrors: the duel goes into another world as the pair dances through one (crossing.ts), its arena, solids and
  // hazard taken, the set going on
  const judge = o.mirrors ? new CrossJudge() : null;
  // (and the pair's voyages, as the page runs them for its virtual players: voyage.ts)
  const doors = judge ? duelDoors() : null, voyage = judge ? new Voyage(o.voyageSeed ?? 5) : null;
  const discsIn = (id: string): Disc[] => doors ? [...doors.gates.values()].filter((g) => g.world === id && g.partner)
    .map((g) => ({ id: g.id, at: [g.at[0], g.at[1], g.at[2]], n: [g.n[0], g.n[1], g.n[2]], right: [g.right[0], g.right[1], g.right[2]], up: [g.up[0], g.up[1], g.up[2]], r: g.radius, to: g.partner!.world })) : [];
  const hazardTotals = { rides: {} as Record<string, { n: number; s: number }>, waterS: 0 };
  const banked = (h: DuelHazards | null) => {
    if (!h?.on) return;
    for (const [k, v] of Object.entries(h.rides)) { const R = (hazardTotals.rides[k] ??= { n: 0, s: 0 }); R.n += v.n; R.s += v.s; }
    hazardTotals.waterS += h.waterS;
  };
  const moveTo = (id: string) => {
    const N = nodeWorld(id);
    if (!N) return;
    banked(hazards);
    hazards?.rest();
    powers?.settle();
    W = N; A = N.arena; plane = duelPlane(A);
    solids.length = 0; solids.push(...(W.solids ?? []));
    if (powers) for (const s of powers.solids) solids.push(s);
    match.moveTo(A, plane);
    if (powers) (powers as unknown as { o: { yKill?: number } }).o.yKill = A.space.yKill;
    hazards = A.hazard ? new DuelHazards(chars, match, A, { on: o.hazards ?? true }) : null;
    stage.stage = plane; if (o.locked) stage.plane = plane; stage.room = A.space.radius;
  };
  const sight = (): DuelSight => {
    const L = match.contact.link;
    return {
      frozen: [match.frozen(0), match.frozen(1)], link: L ? { holder: L.holder, held: L.held, age: match.contact.age } : null,
      flown: match.contact.flown?.flyer ?? null,
      yKill: A.space.yKill, space: A.space, spawns: A.spawns, solids, groundAt: terrain.groundAt,
      ...(powers ? { powers: powers.sight(), bends: powers.liveSight() } : {}),
      hazard: hazards?.sight() ?? null,
      ...(voyage ? { voyage: voyage.plan?.disc ?? null, cameOut: voyage.cameOut?.disc ?? null, mirrors: discsIn(W.id) } : {}),
    };
  };
  const brains = typeof o.brains === 'function' ? o.brains(sight) : o.brains;
  const scene = new Scene();
  const bodies = chars.map((c, k) => ({ id: `seat.${k}`, seat: k, character: c }));
  scene.bodies = bodies;
  const stage: StageView = { plane: o.locked ? plane : null, stage: plane, terrain, gates: [], room: A.space.radius, solids };
  const drivers = brains.map((b, k) => (b ? new BrainDriver(b, bodies[k], scene, () => stage) : null));
  const seats: [SeatStats, SeatStats] = [blankStats(), blankStats()];
  const res: DuelSimResult = { seconds: 0, play: 0, sets: [], seats, stats: match.state.stats, holds: [], spread: [], ends: {}, merges: [[]], combos: [], pops: { max: 0, total: 0, updates: 0 }, energy: [[]], match, powers: null, hazards: null, crossings: [], world: W.id };
  const powerEvents: { t: number; e: PowerEvent }[] = [];
  // (the HUD's pops as the page makes them, from the same events: how many words a second reach the screen)
  const hud = new DuelHud(), hudSeats: HudSeat[] = [0, 1].map((k) => ({ name: `P${k + 1}`, matter: 'fire', screen: [0.3 + 0.4 * k, 0.5], dash: 1, holding: false, held: false }));
  const popSeen = new Map<number, string>(), popTimes: number[] = [];
  const maxT = o.seconds ?? 3600, maxSets = o.sets ?? 1;
  const frames = Math.round(maxT / dt);
  let holdFrom = -1, lostMs = 0;
  for (let i = 1; i <= frames; i++) {
    // (the weight of contact: the bodies' time held a few frames on a catch, slowed a beat on a pair tier: weight.ts. The
    // beat is the music's, on the real clock; the duel's own clock is the bodies')
    const t = i * dt, beat = (t * 1000 * bpm) / 60000, gdt = dt * (o.warp ? match.warp.step(dt) : 1);
    lostMs += (dt - gdt) * 1000;
    const now = t * 1000 - lostMs;
    scene.update({ t: now / 1000, dt: gdt, beat, bpm, music: { level: 0.7, breakdown: false }, rules: null });
    chars[0].lookAt = chars[1].root; chars[1].lookAt = chars[0].root;
    const intents: Intent[] = [], ins: ContactInput[] = [], pins: PowerInput[] = [];
    for (let k = 0; k < 2; k++) {
      const d = drivers[k];
      let it = d ? d.think() : makeIntent();
      if (match.frozen(k)) it = makeIntent();
      ins.push(match.frozen(k) ? noInput() : splitIntent(chars[k], it, match.contact.holding(k), match.contact.held(k)));
      pins.push(match.frozen(k) ? noPower() : { p1: !!it.power1, p2: !!it.power2, form: !!it.form, stick: ins[k].stick });
      intents.push(it);
      chars[k].update(gdt, it, { beats: beat, bpm });
      if (!chars[k].grounded && !chars[k].reforming && !match.frozen(k)) seats[k].airTime += gdt;
    }
    powers?.gripInputs(ins);
    const ev = match.step(now, beat, bpm, gdt * 1000, [ins[0], ins[1]]);
    if (powers) {
      powers.step(now, gdt * 1000, pins, ev, onBeat(beat, bpm));
      ev.push(...powers.duelEvents);
      for (const e of powers.events) powerEvents.push({ t: Math.round(now), e });
    }
    // (the moments of weight, after the powers: a catch at range, a geyser's top; the finale clears the powers' effects)
    ev.push(...match.juice(now, [], powers?.fx ?? [], powers?.live ?? []));
    if (powers && ev.some((e) => e.k === 'finale')) powers.settle();
    hazards?.step(beat, gdt * 1000);
    if (judge) {
      const x = crossPair(chars, W.id, judge, gdt, match.contact.link);
      const pt = (now - match.state.playFrom) / 1000;
      if (voyage) {
        for (const e of ev) if (e.k === 'set') voyage.reset();
        const r0 = chars[0].root, r1 = chars[1].root;
        voyage.step(gdt, { playT: pt, left: ((o.setMs ?? 60000) - (now - match.state.playFrom)) / 1000, play: match.state.phase === 'play', energy: match.state.energy, joined: !!match.contact.link, mid: [(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2, (r0[2] + r1[2]) / 2], discs: discsIn(W.id) });
      }
      if (x) {
        const out = voyage ? discsIn(x.to).find((d) => d.id === x.partner) ?? null : null, meant = voyage ? voyage.crossed(pt, x.gate, out) : false;
        res.crossings.push({ t: +t.toFixed(3), ...x, meant });
        moveTo(x.to);
      }
    }
    if (match.state.phase === 'play') res.play += gdt;
    const L = match.contact.link;
    if (L && holdFrom < 0) holdFrom = t;
    else if (!L && holdFrom >= 0) { res.holds.push(t - holdFrom); holdFrom = -1; }
    for (const x of match.touches) if (x.kind === 'fling' || x.kind === 'release' || x.kind === 'lift' || x.kind === 'counter') { const k = x.kind === 'release' ? `release (${x.why})` : x.kind; res.ends[k] = (res.ends[k] ?? 0) + 1; }
    const playT = (now - match.state.playFrom) / 1000;
    for (const e of ev) {
      if (e.k === 'merge') res.merges[res.merges.length - 1].push(+playT.toFixed(2));
      if (e.k === 'combo' && e.why !== 'fall') res.combos.push(e.n);
      if (e.k === 'link') seats[e.seat].links[e.kind] = (seats[e.seat].links[e.kind] ?? 0) + 1;
      else if (e.k === 'combo') { const S = seats[e.seat]; if (e.why !== 'fall') { S.combos++; S.comboLinks += e.n; } S.longest = Math.max(S.longest, e.n); }
      else if (e.k === 'fall') seats[e.seat].falls++;
      else if (e.k === 'done') { res.merges.push([]); res.energy.push([]); res.sets.push({ winner: e.winner, style: e.style, peak: match.state.peak, fused: match.state.fused, high: +(match.state.highBest / 1000).toFixed(2), merges: match.state.merges }); for (let k = 0; k < 2; k++) seats[k].style += e.style[k]; }
    }
    if (match.state.phase === 'play' && i % Math.round(1 / dt) === 0) res.energy[res.energy.length - 1].push([+playT.toFixed(1), +match.state.energy.toFixed(3)]);
    hud.events(ev, match.touches, hudSeats, [0.5, 0.5]);
    const hs = hud.build(match.state, now, dt, hudSeats, beat, bpm, o.setMs ?? 60000, { on: !!L });
    for (const p of hs.pops) {
      const id = p.id ?? -1, was = popSeen.get(id);
      if (was == null) { popSeen.set(id, p.text); popTimes.push(t); res.pops.total++; }
      else if (was !== p.text) { popSeen.set(id, p.text); res.pops.updates++; }
    }
    while (popTimes.length && popTimes[0] <= t - 1) popTimes.shift();
    res.pops.max = Math.max(res.pops.max, popTimes.length);
    if (i % 60 === 0) res.spread.push(Math.hypot(chars[0].root[0] - chars[1].root[0], chars[0].root[2] - chars[1].root[2]));
    o.each?.({ t, beat, match, powers, bodies: chars, intents, events: ev });
    res.seconds = t;
    if (res.sets.length >= maxSets) break;
  }
  if (res.merges.length > res.sets.length) res.merges.length = Math.max(1, res.sets.length);
  if (res.energy.length > res.sets.length) res.energy.length = Math.max(1, res.sets.length);
  for (let k = 0; k < 2; k++) { const b = brains[k] as DuelBrain | null; if (b && 'counts' in b) seats[k].brain = { ...b.counts }; }
  if (powers) {
    const casts: [Record<string, number>, Record<string, number>] = [{}, {}];
    for (const { e } of powerEvents) if (e.k === 'cast') casts[e.seat][e.power] = (casts[e.seat][e.power] ?? 0) + 1;
    res.powers = { casts, forms: [powers.rules.seats[0].forms, powers.rules.seats[1].forms], reactions: { ...powers.rules.reactions }, felt: { ...powers.felt }, events: powerEvents };
  }
  banked(hazards);
  if (hazards?.on || Object.keys(hazardTotals.rides).length) res.hazards = { rides: Object.fromEntries(Object.entries(hazardTotals.rides).map(([k, v]) => [k, { ...v }])), waterS: hazardTotals.waterS };
  hazards?.rest();
  res.world = W.id;
  return res;
}

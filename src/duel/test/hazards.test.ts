// The arenas' gentle hazards (phase 3, src/duel/hazards.ts) on real bodies in the Node worlds (stages.ts), the match as
// the page runs it: the Pool's water a floor (a body that misses a stone floats and climbs back out; nobody falls out of
// the Pool), the temple's spring tide (the drops pools to float across at high water, pits at low), the redwoods' gust
// (a body in the air leans with it), the geode's hum (a column that lifts and holds), the Pool's swell (its floes ride
// up), each switch, and two virtual players riding them through whole sets. Run by scripts/test-ts.mjs.
import { test, assert, near, done } from '../../dancer/test/check';
import { Character } from '../../dancer/character';
import { makeIntent, type Intent } from '../../input/intent';
import { DuelMatch, duelPlane } from '../match';
import { noInput, splitIntent, type ContactInput } from '../contact';
import { nodeArena, simulateDuel, makeBrains } from '../sim';
import { DuelHazards, HAZARD, gustNow, humNow, setHazards, swellAt, tideAt, waterFloor } from '../hazards';
import { inDrop } from '../arena';
import type { Solid } from '../../worlds/solids';
import type { DuelEvent } from '../../../shared/duel.ts';

const DT = 1 / 60, BPM = 120;
interface Rig { chars: [Character, Character]; match: DuelMatch; hazards: DuelHazards; ev: DuelEvent[]; now: number; beat0: number; run(s: number, it?: (k: number) => Partial<Intent> | null): void; place(k: number, x: number, z: number, y?: number): void }
/** two bodies in a world's arena, its hazard on (or off), the music's clock starting at `beat0` */
function rig(world: string, on = true, beat0 = 0): Rig {
  const { arena, world: W } = nodeArena(world);
  const solids: Solid[] = [...(W.solids ?? [])];
  const terrain = { groundAt: (x: number, z: number) => W.groundAt(x, z), fallY: W.fallY, solids };
  const plane = duelPlane(arena);
  const chars = [0, 1].map((k) => { const c = new Character({ seat: k, plane: null, terrain }); c.setProfile('duel'); return c; }) as [Character, Character];
  const match = new DuelMatch(chars, arena, plane, 0, BPM, { solids: () => solids, setMs: 600000 });
  const hazards = new DuelHazards(chars, match, arena, { on });
  const R: Rig = {
    chars, match, hazards, ev: [], now: 0, beat0,
    run(s, itf) {
      for (let i = 0; i < Math.round(s / DT); i++) {
        R.now += DT * 1000;
        const beat = R.beat0 + (R.now * BPM) / 60000, ins: ContactInput[] = [];
        for (let k = 0; k < 2; k++) {
          const it = Object.assign(makeIntent(), itf?.(k) ?? {});
          ins.push(match.frozen(k) ? noInput() : splitIntent(chars[k], it, false, false));
          chars[k].update(DT, it, { beats: beat, bpm: BPM });
        }
        R.ev.push(...match.step(R.now, beat, BPM, DT * 1000, [ins[0], ins[1]]));
        hazards.step(beat, DT * 1000);
      }
    },
    place(k, x, z, y) { const c = chars[k]; c.reset(x, undefined, z); if (y !== undefined) { c.root = [x, y, z]; c.grounded = false; c.support = null; } c.v = [0, 0, 0]; },
  };
  hazards.step(beat0, 0);
  R.run(3);
  assert(match.state.phase === 'play', `play: ${match.state.phase}`);
  return R;
}

// ---------------------------------------------------------------- the Pool
test('the Pool: water is a floor; a body that misses a stone floats (no fall), swims slower, and jumps back onto a stone', () => {
  const R = rig('pool');
  const { arena, world } = nodeArena('pool');
  // open water between the middle stone (x ±2.6) and the right floe (3.7 … 5.9), on the plane
  const x = 3.15, z = 0;
  const g = world.groundAt(x, z);
  near(g, -HAZARD.FLOAT, 0.4, `the floor in open water (${g.toFixed(2)})`);
  assert(g > arena.space.yKill + 0.6, 'the water floor stands over the kill floor (a brain reads it as floor)');
  R.place(0, x, z, 2.5); R.place(1, -6, 0);
  R.run(1.2);
  const c = R.chars[0];
  assert(c.grounded && Math.abs(c.root[1] - g) < 0.3, `afloat: y ${c.root[1].toFixed(2)}, grounded ${c.grounded}`);
  assert(!R.ev.some((e) => e.k === 'fall'), 'no fall');
  // swimming: held toward +x for a second, slower than a run
  const x0 = c.root[0];
  R.place(0, -3.4, 3.2); R.run(0.5);
  const sx = c.root[0];
  R.run(1, (k) => (k === 0 ? { moveX: 1 } : null));
  const sp = c.root[0] - sx;
  assert(sp < c.phys.runSpeed * 0.75, `swam ${sp.toFixed(2)} m in a second (a run is ${c.phys.runSpeed})`);
  // and out: a jump from the water reaches a stone's top
  R.place(0, x, z); R.run(0.5);
  let top = -Infinity;
  R.run(DT, (k) => (k === 0 ? { jump: true, jumpHeld: true } : null));
  for (let i = 0; i < 60; i++) { R.run(DT, (k) => (k === 0 ? { jumpHeld: true, moveX: c.root[0] < 4.6 ? 1 : 0 } : null)); top = Math.max(top, c.root[1]); }
  R.run(0.5);
  assert(top > 0.6 && c.root[1] > 0, `out onto the floe: apex ${top.toFixed(2)}, now ${c.root[1].toFixed(2)} at x ${c.root[0].toFixed(2)}`);
  return `floats at ${g.toFixed(2)}; ${sp.toFixed(1)} m/s across the water; out to ${c.root[1].toFixed(2)} (from x ${x0.toFixed(1)})`;
});

test('the Pool\'s swell: on a phrase a crest crosses; the floes ride up on it, the low stones a little; off, at rest', () => {
  const { arena } = nodeArena('pool');
  const H = arena.hazard!, S = H.swell!;
  assert(S.movers.length >= 10, `movers: ${S.movers.length}`);
  const R = rig('pool');
  let most = 0, floeMost = 0;
  for (let i = 0; i < 60 * 8; i++) {
    R.run(DT);
    for (let j = 0; j < S.movers.length; j++) { most = Math.max(most, S.bob[j]); if (S.movers[j].k === 1) floeMost = Math.max(floeMost, S.bob[j]); }
  }
  assert(floeMost > S.amp * 0.8 && floeMost <= S.amp + 1e-6, `a floe rode up ${floeMost.toFixed(2)} m`);
  const m = S.movers[0];
  setHazards(arena, false);
  assert(m.solid.c[1] === m.rest[1] && S.bob.every((b) => b === 0), 'off: the stones at rest');
  assert(waterFloor(H, 0, 5) === -HAZARD.FLOAT, 'off: still water, still a floor');
  setHazards(arena, true);
  // the crest: highest where it is, nothing far ahead of it
  const b = 4, w = swellAt(H, 0, 0, b);
  assert(w >= 0 && w <= S.amp, `height ${w.toFixed(2)}`);
  return `floes up to ${floeMost.toFixed(2)} m, any mover ${most.toFixed(2)} m`;
});

test('two virtual players in the Pool: no falls, and close (catches about as often as in the other worlds)', () => {
  const { arena, world } = nodeArena('pool');
  let falls = 0, catches = 0, min = 0;
  for (const [seed, dress] of [[3, ['fire', 'water']], [5, ['ice', 'water']]] as [number, [string, string]][]) {
    const res = simulateDuel({ arena, world, dress, brains: makeBrains(['lead', 'flyer'], [0.85, 0.85], [seed, seed + 7]), sets: 1, setMs: 60000, seconds: 80 });
    for (const s of res.seats) { falls += s.falls; catches += (s.links.catch ?? 0) + (s.links.aerial ?? 0); }
    min += res.play / 60;
  }
  assert(falls <= 1, `falls: ${falls}`);
  assert(catches / min > 15, `${(catches / min).toFixed(1)} catches a minute`);
  return `${falls} falls, ${(catches / min).toFixed(1)} catches a minute`;
});

// ---------------------------------------------------------------- the temple's tide
test('the temple\'s tide: low, the drops are pools under the court; high, the court is under water and a body floats over a drop; off, as before', () => {
  const { arena, world } = nodeArena('temple');
  const H = arena.hazard!, T = H.tide!;
  near(tideAt(H, 0), T.low, 1e-9, 'low at the start');
  near(tideAt(H, T.bars * 2), T.high, 1e-9, 'high half way');
  // a point in a drop
  const d = arena.drops![0], p = arena.plane, s = (d.s0 + d.s1) / 2;
  const x = p.origin[0] + p.right[0] * s, z = p.origin[2] + p.right[2] * s;
  assert(inDrop(p, arena.drops!, x, z), 'in the drop');
  H.beat = 0;
  const low = world.groundAt(x, z);
  near(low, T.low - HAZARD.FLOAT, 1e-6, 'low tide: the drop a pool well under the court');
  assert(low > arena.space.yKill + 0.3 && low < -1, `(a body in it floats with its head at the court's floor: ${low.toFixed(2)})`);
  near(world.groundAt(0, -0.5), 0, 1e-9, 'and the court dry');
  H.beat = T.bars * 2;
  const g = world.groundAt(x, z);
  near(g, T.high - HAZARD.FLOAT, 1e-6, 'high tide: the water a floor over the drop');
  near(world.groundAt(0, -0.5), T.high - HAZARD.FLOAT, 1e-6, 'and over the court');
  H.on = false;
  assert(world.groundAt(x, z) < arena.space.yKill && world.groundAt(0, -0.5) === 0, 'off: the court and its drops as before');
  H.on = true; H.beat = 0;
  // a body dropped into the drop at high tide floats there, drifting with the current a little
  const R = rig('temple', true, T.bars * 2 - 3);
  R.place(0, x, z, 2); R.place(1, x + 4, z - 3);
  R.run(1.5);
  const c = R.chars[0];
  assert(!R.ev.some((e) => e.k === 'fall') && c.grounded && Math.abs(c.root[1] - g) < 0.2, `afloat over the drop: y ${c.root[1].toFixed(2)}`);
  assert((R.hazards.rides.tide?.n ?? 0) >= 1, 'a ride of the tide');
  R.hazards.rest();
  return `the drop's floor ${g.toFixed(2)} at high tide; floated at ${c.root[1].toFixed(2)}`;
});

// ---------------------------------------------------------------- the redwoods' wind
test('the redwoods\' wind: gusts on most phrases, leaves before them; a body in the air leans with one; off, none', () => {
  const { arena } = nodeArena('redwoods');
  const H = arena.hazard!;
  let gusts = 0, warned = 0;
  for (let p = 0; p < 40; p++) {
    const g = gustNow(H, p * 16 + 4);
    if (g.strength > 0.9) gusts++;
    if (gustNow(H, p * 16 - 1.5).warn > 0.2 && g.has) warned++;
  }
  assert(gusts >= 18 && gusts <= 36, `gusts in 40 phrases: ${gusts}`);
  assert(warned === gusts, `each led in by leaves (${warned} of ${gusts})`);
  // a phrase with a gust: a body thrown straight up drifts along it
  let p0 = 0; while (!gustNow(H, p0 * 16 + 4).has) p0++;
  const drift = (on: boolean) => {
    const R = rig('redwoods', on, p0 * 16 + 1.6 - 1.5);
    R.place(0, 0.4, 2.6); R.place(1, 4, -3);
    R.run(0.3);
    const a = [R.chars[0].root[0], R.chars[0].root[2]];
    R.run(DT, (k) => (k === 0 ? { jump: true, jumpHeld: true } : null));
    for (let i = 0; i < 30; i++) R.run(DT, (k) => (k === 0 ? { jumpHeld: true } : null));
    const g = gustNow(H, p0 * 16 + 4).dir;
    return (R.chars[0].root[0] - a[0]) * g[0] + (R.chars[0].root[2] - a[1]) * g[1];
  };
  const on = drift(true), off = drift(false);
  assert(on > 0.5 && Math.abs(off) < 0.1, `leaned ${on.toFixed(2)} m with the gust in half a second's flight (off: ${off.toFixed(2)})`);
  return `${gusts} gusts in 40 phrases; a jump leaned ${on.toFixed(2)} m`;
});

// ---------------------------------------------------------------- the geode's hum
test('the geode\'s hum: a crystal warns two bars ahead, then its column lifts whoever stands round it and holds them high', () => {
  const { arena } = nodeArena('geode');
  const H = arena.hazard!, M = H.hum!;
  for (const s of M.spots) near(nodeArena('geode').world.groundAt(s[0], s[2]), 0, 1e-6, `the spot ${s} on the floor`);
  assert(humNow(H, 13).warn > 0.3 && humNow(H, 13).lift === 0, 'the warning before the phrase');
  const R = rig('geode', true, 16 - 3 - 0.2);
  const s = humNow(H, 16.5).spot;
  R.place(0, s[0], s[2]); R.place(1, s[0] + 4.5, s[2] + 2);
  let top = -Infinity, high = 0;
  for (let i = 0; i < 60 * 4.5; i++) { R.run(DT); top = Math.max(top, R.chars[0].root[1]); if (R.chars[0].root[1] > M.h - 1.2) high += DT; }
  assert(top > M.h - 0.8 && top < M.h + 1.5, `lifted to ${top.toFixed(2)} m (the column ${M.h} m)`);
  assert(high > 0.6, `held high ${high.toFixed(2)} s`);
  assert(!R.ev.some((e) => e.k === 'fall') && (R.hazards.rides.hum?.n ?? 0) === 1, 'one ride, no fall');
  R.hazards.rest();
  return `lifted to ${top.toFixed(2)} m, ${high.toFixed(1)} s near the top`;
});

test('the geode\'s hum rises where the pair is: the open spot nearest them as its warning begins, and lifts both', () => {
  const { arena } = nodeArena('geode');
  const H = arena.hazard!, M = H.hum!;
  // (each spot stands on the agate with floor all round it, clear of the arena's drops: a body flung from the top lands)
  const { world } = nodeArena('geode');
  for (const s of M.spots) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    near(world.groundAt(s[0] + Math.cos(a) * (M.r + 0.6), s[2] + Math.sin(a) * (M.r + 0.6)), 0, 1e-6, `floor round the spot ${s}`);
  }
  // the warning of phrase 2 begins at beat 24 (HUM_WARN before 32): the pair stands by one spot then
  const R = rig('geode', true, 24 - 6 - 0.5);
  const far = M.spots.reduce((a, s) => (Math.hypot(s[0], s[2] - 4) > Math.hypot(a[0], a[2] - 4) ? s : a), M.spots[0]);
  R.place(0, far[0] - 0.4, far[2]); R.place(1, far[0] + 0.4, far[2] + 0.2);
  R.run(2.5);
  const m = humNow(H, 31);
  assert(m.next === far || (m.next[0] === far[0] && m.next[2] === far[2]), `the coming column at the pair's spot ${far} (got ${m.next})`);
  // through the lift (beat 32 on): both ride it up together
  let topA = 0, topB = 0;
  for (let i = 0; i < 60 * 4; i++) { R.run(DT); topA = Math.max(topA, R.chars[0].root[1]); topB = Math.max(topB, R.chars[1].root[1]); }
  assert(topA > M.h - 1 && topB > M.h - 1, `both lifted (${topA.toFixed(2)}, ${topB.toFixed(2)} m; the column ${M.h} m)`);
  R.hazards.rest();
  return `the column rose at ${far.join(', ')}, both lifted to ${Math.min(topA, topB).toFixed(2)} m`;
});

// ---------------------------------------------------------------- every arena, two players, a set
test('virtual players ride each hazard in a set, and nobody falls more than before', () => {
  const out: string[] = [];
  for (const [world, kinds] of [['temple', ['tide']], ['redwoods', ['gust']], ['geode', ['hum']], ['pool', ['swell', 'crest']]] as [string, string[]][]) {
    const { arena, world: W } = nodeArena(world);
    let falls = 0, rides = 0;
    for (const seed of [3, 7]) {
      const res = simulateDuel({ arena, world: W, dress: ['fire', 'water'], brains: makeBrains(['lead', 'flyer'], [0.85, 0.85], [seed, seed + 7]), sets: 1, setMs: 60000, seconds: 80 });
      for (const s of res.seats) falls += s.falls;
      for (const k of kinds) rides += res.hazards?.rides[k]?.n ?? 0;
    }
    assert(rides >= 2, `${world}: ridden ${rides} times in two sets`);
    assert(falls <= 3, `${world}: ${falls} falls in two sets`);
    out.push(`${world} ${rides} rides, ${falls} falls`);
  }
  return out.join('; ');
});

done();

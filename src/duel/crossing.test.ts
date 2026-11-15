// The duel's crossing without a page (crossing.ts): the gates' table pairs every gate, a body walked through a mirror
// is carried into the other world with its partner brought along (free and joined), it can't come straight back, and
// the Node harness (sim.ts) takes the duel through the mirrors and counts the crossings.
import { test, assert, near, done } from '../dancer/test/check';
import { Character } from '../dancer/character';
import { makeIntent } from '../input/intent';
import { CrossJudge, crossPair, duelDoors, middleOf, nodeWorld, CROSS } from './crossing';
import { simulateDuel, nodeArena, makeBrains } from './sim';

type V3 = [number, number, number];

test('every gate between the duel\'s worlds is paired, each pair\'s moves undo each other', () => {
  const D = duelDoors();
  let n = 0;
  for (const g of D.gates.values()) {
    assert(g.partner, `${g.id} has no partner`);
    const p: V3 = [g.at[0] + 0.3, g.at[1] - 0.2, g.at[2] + 0.1];
    const back = g.partner!.through.pt(g.through.pt(p));
    near(Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2]), 0, 1e-9, g.id);
    n++;
  }
  assert(n === 12, `${n} gates (6 to and from the geode, 6 mirrors)`);
  return `${n} gates`;
});

/** a pair in the temple, seat 0 walking east into the mirror to the Pool (8.5, -0.5), seat 1 beside it */
function pairAt(x0: number, x1: number) {
  const N = nodeWorld('temple')!;
  const terrain = { groundAt: (x: number, z: number) => N.groundAt(x, z), fallY: N.fallY, solids: N.solids };
  const chars = [0, 1].map((k) => { const c = new Character({ seat: k, terrain }); c.setProfile('duel'); c.reset(k ? x1 : x0, undefined, -0.5 + k * 0.6); return c; }) as [Character, Character];
  return chars;
}
function walk(chars: [Character, Character], world: string, judge: CrossJudge, secs: number, stick: [number, number][], held = false) {
  for (let i = 0; i < secs * 60; i++) {
    for (let k = 0; k < 2; k++) { const it = makeIntent(); it.moveX = stick[k][0]; it.moveZ = stick[k][1]; chars[k].inputYaw = 0; chars[k].update(1 / 60, it, { beats: i / 30, bpm: 112 }); }
    const x = crossPair(chars, world, judge, 1 / 60, held ? { holder: 0, held: 1, part: 'hand', rest: 1, since: 0, arc: 0, swings: 0, beatPump: false, at: [0, 1, 0], flying: false, c: [0, 1, 0], v: [0, 0, 0], sense: 1 } : null);
    if (x) {
      // (the bodies stand in the new world from now on)
      const N = nodeWorld(x.to)!, terrain = { groundAt: (a: number, b: number) => N.groundAt(a, b), fallY: N.fallY, solids: N.solids };
      for (const c of chars) c.terrain = terrain;
      return { x, i };
    }
  }
  return null;
}

test('a body walked through the temple\'s mirror comes out in the Pool, its partner brought beside it', () => {
  const chars = pairAt(6.5, 5.6), judge = new CrossJudge();
  // (the camera at +z: moveX +1 walks east)
  const r = walk(chars, 'temple', judge, 4, [[1, 0], [0, 0]]);
  assert(r, 'it crossed');
  const { x } = r!;
  assert(x.seat === 0 && x.gate === 'temple.to.pool' && x.to === 'pool' && !x.held, JSON.stringify(x));
  const b = duelDoors().get('pool.to.temple')!;
  const s = chars.map((c) => { const m = middleOf(c); return (m[0] - b.at[0]) * b.n[0] + (m[2] - b.at[2]) * b.n[2]; });
  assert(s[0] > 0 && s[0] < 0.5, `the crosser just out of the Pool's disc (${s[0].toFixed(2)} m)`);
  assert(s[1] >= CROSS.MIN - 0.05 && s[1] <= CROSS.NEAR + 0.05, `the partner in front of it (${s[1].toFixed(2)} m)`);
  return `crosser ${s[0].toFixed(2)} m out, partner ${s[1].toFixed(2)} m`;
});

test('just through, walking straight back doesn\'t cross again (the hold, then behind the disc), later it does', () => {
  // (the temple to the redwoods: dry floors on both sides, a walk at full speed)
  const chars = pairAt(-6.5, -5.6), judge = new CrossJudge();
  const r = walk(chars, 'temple', judge, 4, [[-1, 0], [0, 0]]);
  assert(r && r.x.to === 'redwoods', 'into the redwoods');
  // the redwoods' disc faces (n0, n2); into it from the front is -n, a stick (moveX, moveZ) = (dx, -dz) with the camera at +z
  const n = duelDoors().get('redwoods.to.temple')!.n, into: [number, number] = [-n[0], n[2]], out: [number, number] = [n[0], -n[2]];
  assert(!walk(chars, 'redwoods', judge, 1.5, [into, [0, 0]]), 'no crossing straight back (through the disc in its hold)');
  assert(!walk(chars, 'redwoods', judge, 3, [out, [0, 0]]), 'nor out again from behind it (behind the disc it came out of)');
  const later = walk(chars, 'redwoods', judge, 4, [into, [0, 0]]);
  assert(later && later.x.to === 'temple', `back to the temple later (${JSON.stringify(later?.x)})`);
  return `back ${(4.5 + later!.i / 60).toFixed(2)} s after`;
});

test('joined, the partner goes by the gate\'s own move (the pair keeps its shape)', () => {
  const chars = pairAt(6.5, 5.9), judge = new CrossJudge();
  const gap0 = chars[0].root.map((v, i) => v - chars[1].root[i]);
  const r = walk(chars, 'temple', judge, 4, [[1, 0], [1, 0]], true);
  assert(r && r.x.held, 'crossed joined');
  const gap = chars[0].root.map((v, i) => v - chars[1].root[i]);
  near(Math.hypot(...gap), Math.hypot(...gap0), 0.6, 'their distance');
  return `apart ${Math.hypot(...gap).toFixed(2)} m`;
});

test('the Node harness dances through the mirrors (mirrors: true) and counts the crossings; off, it stays', () => {
  let crossings = 0, sets = 0;
  const worlds = new Set<string>();
  for (const seed of [1, 2, 3]) {
    const { arena, world } = nodeArena('temple');
    const r = simulateDuel({ arena, world, mirrors: true, brains: makeBrains(['lead', 'flyer'], [0.85, 0.85], [seed, seed + 7]), sets: 1, setMs: 40000, seconds: 70 });
    crossings += r.crossings.length; sets += r.sets.length;
    for (const x of r.crossings) worlds.add(x.to);
    for (let i = 1; i < r.crossings.length; i++) assert(r.crossings[i].from === r.crossings[i - 1].to, 'each crossing from the world the last went to');
    // (no crossing back within the hold)
    for (let i = 1; i < r.crossings.length; i++) assert(r.crossings[i].t - r.crossings[i - 1].t >= CROSS.HOLD_FREE - 1e-6, `crossings ${(r.crossings[i].t - r.crossings[i - 1].t).toFixed(2)} s apart`);
  }
  assert(sets === 3, `${sets} sets played to the end`);
  const { arena, world } = nodeArena('temple');
  const off = simulateDuel({ arena, world, brains: makeBrains(['lead', 'flyer'], [0.85, 0.85], [1, 8]), sets: 1, setMs: 20000, seconds: 40 });
  assert(off.crossings.length === 0 && off.world === 'temple', 'without mirrors it stays');
  return `${crossings} crossings in 3 sets of 40 s (into ${[...worlds].join(', ') || 'none'})`;
});

done();

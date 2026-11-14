// The duel's arenas (src/duel/arena.ts and each world's arena.ts), checked without a GPU: every world has one, each passes
// checkArena (the space's size, spawns spread and standing on something, every top reachable by jumps, something to
// jump onto or kick off within a second's run of anywhere; on the lock's plane its ledges, walls and drops), the
// plane's ledges are where the pieces it crosses have their tops, and the helpers the movement reads (topAt,
// groundUnder, inDrop) answer as they should.
import { test, assert, near, done } from '../dancer/test/check';
import { arenaFor, arenas, checkArena, crossing, describeArena, groundUnder, inDrop, slicePlane, topAt, type Arena } from './arena';
import { arenaSegments } from './arena-segments';
import { box, boxOn, cylinder, type Solid } from '../worlds/solids';
import { registerTempleArena } from '../worlds/temple/arena';
import { registerGeodeArena } from '../worlds/geode/arena';
import { registerRedwoodsArena } from '../worlds/redwoods/arena';
import { registerPoolArena } from '../worlds/pool/arena';
import { layoutTemple, solidsOf } from '../worlds/temple/layout';
import { layoutShelves, solidsOfShelves } from '../worlds/geode/shelves';
import { hubGates } from '../worlds/geode/gates';
import { layoutWoods, solidsOfWoods } from '../worlds/redwoods/layout';
import { layoutStage, solidsOfStage } from '../worlds/redwoods/stage';

registerTempleArena(); registerGeodeArena(); registerRedwoodsArena(); registerPoolArena();

/** each world's own solids, as its World.solids lists them (without the duel's pieces) */
function worldSolids(id: string): Solid[] {
  if (id === 'temple') return solidsOf(layoutTemple({ coarse: false }).stones);
  if (id === 'geode') {
    const s = layoutShelves({ caveRadius: 12, gates: hubGates() });
    return solidsOfShelves(s.blades, s.points);
  }
  if (id === 'redwoods') { const w = layoutWoods(); return [...solidsOfStage(layoutStage(w.trunks).pieces), ...solidsOfWoods(w)]; }
  return [];
}
/** each world's floor while the duel is on (null: none there) */
function floorOf(a: Arena): (x: number, z: number) => number | null {
  if (a.world === 'pool') return () => null;
  return (x, z) => (inDrop(a.plane, a.drops ?? [], x, z) ? null : 0);
}

test('every world has an arena', () => {
  for (const w of ['geode', 'redwoods', 'pool', 'temple']) assert(arenaFor(w), `no arena for ${w}`);
  return arenas.ids().join(', ');
});
for (const a of arenas.all()) {
  const solids = [...worldSolids(a.world), ...(a.pieces ?? [])];
  test(`${a.world}: the arena checks out`, () => {
    const problems = checkArena(a, floorOf(a), solids);
    assert(!problems.length, problems.slice(0, 6).join('; '));
    return describeArena(a);
  });
  test(`${a.world}: the plane's ledges stand on what is there`, () => {
    // (every ledge above the floor has a solid under it whose top, where it crosses the plane, is the ledge's height)
    const bad: string[] = [];
    for (const l of a.plane.ledges) {
      if (l.y <= 0.6 && !l.bob) continue;
      const mid = (l.x0 + l.x1) / 2, p = [a.plane.origin[0] + a.plane.right[0] * mid, a.plane.origin[2] + a.plane.right[2] * mid];
      const tops = solids.map((s) => topAt(s, p[0], p[1])).filter((t) => t > -Infinity);
      if (!tops.some((t) => Math.abs(t - l.y) < 0.12 + (l.bob ?? 0))) bad.push(`${l.id} at ${l.y.toFixed(2)} (tops there: ${tops.map((t) => t.toFixed(2)).join(' ') || 'none'})`);
    }
    assert(!bad.length, bad.join('; '));
    return `${a.plane.ledges.length} ledges, ${a.plane.walls?.length ?? 0} walls`;
  });
  test(`${a.world}: its rim and debug lines fit the buffer`, () => {
    const s = arenaSegments(a, solids);
    assert(s.rim + s.debug <= 8192, `${s.rim + s.debug} segments`);
    return `${s.rim} rim, ${s.debug} debug segments`;
  });
}

test('topAt: a box\'s top over its footprint, nothing beside it; turned', () => {
  const b = boxOn([0, 0, 0], [2, 1, 1], 0.5);
  near(topAt(b, 0.3, 0.1), 1, 1e-9);
  assert(topAt(b, 3, 0) === -Infinity);
});
test('topAt: a drum\'s flat top, a log\'s round top, a leaning point has none', () => {
  near(topAt(cylinder([0, 0, 0], [0, 2, 0], 0.5), 0.2, 0.1), 2, 1e-9);
  near(topAt({ kind: 'capsule', a: [-2, 0.5, 0], b: [2, 0.5, 0], r: 0.5 }, 1, 0), 1, 1e-9);
  assert(topAt({ kind: 'capsule', a: [0, 0, 0], b: [0.5, 2, 0], r: 0.3 }, 0.2, 0) === -Infinity);
});
test('groundUnder: the highest top within a step of the feet, else the floor', () => {
  const S = [box([0, 0.5, 0], [1, 0.5, 1]), box([0, 3, 0], [1, 0.2, 1])];
  near(groundUnder(S, 0, 0, 1.0, 0), 1, 1e-9, 'on the low block');
  near(groundUnder(S, 0, 0, 0.5, 0), 0, 1e-9, 'under the high one, beside the low one\'s top');
  near(groundUnder(S, 0, 0, 3.3, 0), 3.2, 1e-9, 'on the high one');
  near(groundUnder(S, 5, 0, 1, -2), -2, 1e-9, 'nothing there');
});
test('slicePlane: a box across the plane gives a ledge on its top and a wall at each end', () => {
  const plane = arenaFor('temple')!.plane;
  const g = { id: 't', solids: [boxOn([2, 0, plane.origin[2]], [1.2, 1.5, 1])] };
  const c = crossing(plane, g.solids[0])!;
  near(c.s0, 1.4, 1e-9); near(c.s1, 2.6, 1e-9); near(c.y1, 1.5, 1e-9);
  const { ledges, walls } = slicePlane(plane, [g]);
  assert(ledges.length === 1 && walls.length === 2 && walls[0].side === -1 && walls[1].side === 1);
});

done();

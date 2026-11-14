// The forge's floor along the way in from its gate: a dancer who walks on from the geode's gate keeps floor under them
// (the cameras agent found 1.75 to 2.75 m in along the gate's normal open: between the anvil's lobe and the anvil itself,
// a player walking in fell into the pit). The lobe now reaches the anvil. And the floor under the crown is the anvil:
// a body walks under the crown and lands on its top from above (the crown is the solids' business, 11-duel.md).
import { test, assert, near, done } from '../../dancer/test/check';
import { Character, DUEL_PHYS } from '../../dancer/character';
import { makeIntent, type Intent } from '../../input/intent';
import { ledgeY } from '../../engine/camera';
import { layoutForge, groundOf, solidsOfForge, COLUMN_FLOATS, type ForgeLayout } from './layout';
import { forgeDuel } from './arena';

test('floor all the way from the gate to the stage', () => {
  const L = layoutForge({ coarse: false });
  const gate = [-5.7, -3.5], n = [0.852, 0.523];
  const gaps: string[] = [];
  let worst = 0;
  for (let t = 0.4; t <= 5.01; t += 0.1) {
    const x = gate[0] + n[0] * t, z = gate[1] + n[1] * t;
    let best = 9;
    for (let i = 0; i < L.stageColumns; i++) {
      const o = i * COLUMN_FLOATS;
      if (Math.abs(L.columns[o + 2]) > 0.05) continue; // the anvil's (floor) cells only: their tops at 0
      best = Math.min(best, Math.hypot(L.columns[o] - x, L.columns[o + 1] - z));
    }
    worst = Math.max(worst, best);
    if (best > 0.4) gaps.push(`${t.toFixed(1)} m (${best.toFixed(2)} m to a cell)`);
  }
  assert(!gaps.length, `no floor at ${gaps.join(', ')}`);
  return `from 0.4 to 5 m in, every point within ${worst.toFixed(2)} m of a floor cell's middle (a cell is 0.4 m round)`;
});

test('groundAt keeps a free dancer up from the gate to the stage (the hexagons, not circles inside them)', () => {
  // what the dancer's physics reads (Forge.groundAt is groundOf): along the way in and a body's width either side of it,
  // every 2 cm. The old test (a circle of 0.9 R round each cell) found holes at the cells' corners on this walk
  const L = layoutForge({ coarse: false });
  const gate = [-5.7, -3.5], n = [0.852, 0.523], side = [n[1], -n[0]];
  const holes: string[] = [];
  let checked = 0;
  for (let t = 0.4; t <= 5.01; t += 0.02) for (const s of [-0.3, 0, 0.3]) {
    const x = gate[0] + n[0] * t + side[0] * s, z = gate[1] + n[1] * t + side[1] * s;
    checked++;
    if (groundOf(L, x, z, (_, top) => top, -12) < -0.05) holes.push(`${t.toFixed(2)} m in, ${s} across`);
  }
  // and the old reading of the same points, so the test says what it guards against
  let oldHoles = 0;
  for (let t = 0.4; t <= 5.01; t += 0.02) {
    const x = gate[0] + n[0] * t, z = gate[1] + n[1] * t;
    let ok = false;
    for (let i = 0; i < L.stageColumns; i++) { const o = i * COLUMN_FLOATS; if (Math.hypot(x - L.columns[o], z - L.columns[o + 1]) <= L.columns[o + 3] * 0.9) ok = true; }
    if (!ok) oldHoles++;
  }
  assert(!holes.length, `holes at ${holes.slice(0, 6).join('; ')} (${holes.length})`);
  return `${checked} points on the way in and a body's width either side: floor at every one (the old 0.9 R circles: ${oldHoles} holes on the line)`;
});

/** the old reading: the highest stage column holding the point */
function highest(L: ForgeLayout, x: number, z: number) {
  let best = -12;
  const k = Math.sqrt(3) / 2;
  for (let i = 0; i < L.stageColumns; i++) {
    const o = i * COLUMN_FLOATS, R = L.columns[o + 3] + 0.01;
    const dx = Math.abs(x - L.columns[o]), dz = Math.abs(z - L.columns[o + 1]);
    if (dx > k * R || 0.5 * dx + k * dz > k * R) continue;
    best = Math.max(best, L.columns[o + 2]);
  }
  return best;
}

test('groundAt under the crown (and under the floats’ inner edges) is the anvil, at every beat; past the anvil the floats are floor', () => {
  const L = layoutForge({ coarse: false });
  const crown = L.slabs.find((s) => s.id === 'crown')!, floatL = L.slabs.find((s) => s.id === 'floatL')!;
  // the forge's own lift, as Forge.groundAt passes it
  const at = (beat: number) => (x: number, z: number) => groundOf(L, x, z, (s, top) => (s.ledge ? ledgeY(s.ledge, beat) : top), -12);
  let under = 0, wasCrown = 0, overhead = 0;
  for (const beat of [0, 0.5, 1, 1.5, 2, 3]) {
    const g = at(beat);
    for (let x = -crown.rx; x <= crown.rx; x += 0.05) for (let z = -crown.rz; z <= crown.rz; z += 0.05) {
      if (highest(L, x, z) < 3) continue;   // a point the crown's columns hold
      under++;
      if (beat === 0) wasCrown++;
      near(g(x, z), 0, 1e-6, `under the crown at (${x.toFixed(2)}, ${z.toFixed(2)}), beat ${beat}`);
    }
    // anywhere on the stage: the floor is never above the lowest slab there
    for (let x = -7; x <= 7; x += 0.1) for (let z = -6; z <= 4; z += 0.1) {
      const hi = highest(L, x, z), lo = g(x, z);
      if (hi > 0.5 && lo < 0.05 && lo > -1) overhead++;
    }
  }
  assert(under > 100, 'sampled the crown: ' + under);
  // the float out past the anvil's end still stands, bobbing
  const fx = floatL.x - 0.5;
  near(at(1)(fx, 0), floatL.top + floatL.bob, 1e-4, 'the left float past the anvil, risen');
  near(at(3)(fx, 0), floatL.top - floatL.bob, 1e-4, 'the left float past the anvil, sunk');
  return `${wasCrown} points under the crown read the anvil (0 m), at six beats; ${overhead / 6} on the stage where a slab hangs over the anvil (the crown, the floats' inner edges) read the anvil; the floats past the anvil still floor`;
});

test('a duel body walks under the crown and stays on the anvil, and lands on the crown’s top from above', () => {
  // the page's forge in the duel: its columns and the arena's stones as World.solids, the floor groundAt (beat 0: the
  // bobbing slabs at rest)
  const L = layoutForge({ coarse: false });
  const solids = [...solidsOfForge(L), ...forgeDuel().arena.pieces!];
  const terrain = { groundAt: (x: number, z: number) => groundOf(L, x, z, (s, top) => (s.ledge ? ledgeY(s.ledge, 0) : top), -12), fallY: -4, solids };
  const I = (o: Partial<Intent> = {}): Intent => Object.assign(makeIntent(), o);
  const c = new Character({ plane: null, terrain, phys: DUEL_PHYS });
  c.reset(-3, 0, 0.1); c.yaw = Math.PI / 2;
  for (let i = 0; i < 48; i++) c.update(1 / 240, I(), 0);
  // walk east along the plane, under the crown (x -1.3 … 1.3), to x 3
  let top = -Infinity, passed = false;
  for (let i = 0; i < 240 * 2.5 && c.x < 3; i++) {
    c.update(1 / 240, I({ moveX: 1 }), 0);
    if (Math.abs(c.x) < 1) { passed = true; top = Math.max(top, c.y); }
  }
  assert(passed, 'reached the crown’s middle: x ' + c.x.toFixed(2));
  assert(top < 0.05, `stayed on the anvil under the crown: highest ${top.toFixed(3)} m (the old floor read ${highest(L, 0, 0).toFixed(2)} m there)`);
  assert(c.x > 2.5, 'walked on past it: x ' + c.x.toFixed(2));
  // dropped from 5 m over the crown's middle: lands on its top (its solid stands as high as it bobs)
  const d = new Character({ plane: null, terrain, phys: DUEL_PHYS });
  d.reset(0.2, 5, 0.1);
  let landed = false;
  for (let i = 0; i < 240 * 1.5; i++) { d.update(1 / 240, I(), 0); if (d.grounded) { landed = true; break; } }
  assert(landed, 'landed');
  const crown = L.slabs.find((s) => s.id === 'crown')!;
  assert(d.y > crown.top - 0.05 && d.y < crown.top + crown.bob + 0.05, `on the crown's top: ${d.y.toFixed(3)} m`);
  return `under the crown: highest ${top.toFixed(3)} m, through to x ${c.x.toFixed(2)}; from above: on its top at ${d.y.toFixed(2)} m`;
});

done();

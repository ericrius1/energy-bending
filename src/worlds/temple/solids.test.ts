// The temple's and the redwoods' solids for the camera (World.solids, World.clear): built from the same layouts the
// geometry is drawn from, they stop a segment where it would enter a stone, a trunk, the log or a bough, let it run
// through open air, and ignore a solid the segment starts inside.
import { test, assert, near, done } from '../../dancer/test/check';
import { clearOf } from '../solids';
import { layoutTemple, solidsOf, STAGE_Z } from './layout';
import { layoutWoods, solidsOfWoods } from '../redwoods/layout';
import { layoutStage, solidsOfStage } from '../redwoods/stage';

type V3 = [number, number, number];
const T = layoutTemple({ coarse: false });
const ts = solidsOf(T.stones);

test('temple: every stone but the platform is a solid', () => {
  assert(ts.length === T.stones.filter((s) => !s.open).length);
  return `${ts.length} solids`;
});
test('temple: open air over the court is clear', () => {
  near(clearOf(ts, [0, 1.5, 6], [0, 1.5, 9]), 1, 1e-9);
});
test('temple: a segment toward the altar stops at its face less the margin', () => {
  // low, under the reach of the slab's margin (the slab overhangs from 0.94 m): the carved block's front
  const a: V3 = [0, 0.3, 6], b: V3 = [0, 0.3, STAGE_Z];
  const t = clearOf(ts, a, b);
  const z = a[2] + (b[2] - a[2]) * t;
  near(z, STAGE_Z + 0.55 + 0.4, 0.02, 'the carved block\'s front plus 40 cm');
});
test('temple: a segment through the left broken pillar stops at its side', () => {
  const t = clearOf(ts, [-4.2, 1.0, 2], [-4.2, 1.0, STAGE_Z]);
  const z = 2 + (STAGE_Z - 2) * t;
  near(z, STAGE_Z + 0.5 + 0.4, 0.02);
});
test('temple: over the stump\'s top the segment is clear (the cylinder ends at the top)', () => {
  near(clearOf(ts, [-4.2, 2.5, 2], [-4.2, 2.5, STAGE_Z]), 1, 1e-9);
});
test('temple: a look point inside a margin (a dancer on a stump) does not pull the camera in', () => {
  const t = clearOf(ts, [-4.2, 2.1, STAGE_Z], [-4.2, 2.6, 4]);
  assert(t > 0.99, `clear ${t}`);
});
test('temple: the gate\'s columns and the fallen drums are there', () => {
  assert(clearOf(ts, [-2.7, 3, -5], [-2.7, 3, -12]) < 1, 'gate column');
  assert(clearOf(ts, [-4.8, 0.4, -4], [-4.8, 0.4, -9]) < 1, 'a fallen drum behind the stage');
});

const W = layoutWoods();
const S = layoutStage(W.trunks);
const rs = [...solidsOfStage(S.pieces), ...solidsOfWoods(W)];
const onPlane = (x: number, y: number, w = 0): V3 => [S.right[0] * x - S.right[2] * w, y, S.right[2] * x + S.right[0] * w];

test('redwoods: the fallen log stops a segment coming at it across the plane', () => {
  const a = onPlane(-5, 0.4, 5), b = onPlane(-5, 0.4, -5);
  const t = clearOf(rs, a, b);
  near(10 * t, 5 - 0.85 - 0.4, 0.03, 'from 5 m in front to the bark less 40 cm');
});
test('redwoods: over the log is clear', () => {
  near(clearOf(rs, onPlane(-5, 2.6, 5), onPlane(-5, 2.6, -5)), 1, 1e-9);
});
test('redwoods: the low bough and the high bough are solids', () => {
  assert(clearOf(rs, onPlane(4, 1.72, 4), onPlane(4, 1.72, -4)) < 1, 'low bough');
  assert(clearOf(rs, onPlane(0, 2.92, 4), onPlane(0, 2.92, -4)) < 1, 'high bough');
});
test('redwoods: a trunk of the ring stops a segment', () => {
  const x = W.trunks[0], z = W.trunks[1], R = W.trunks[2];
  const t = clearOf(rs, [x + 8, 3, z], [x, 3, z]);
  assert(t < 1 && 8 * (1 - t) >= R && 8 * (1 - t) <= R + 0.45, `stopped ${(8 * (1 - t)).toFixed(2)} m from the axis (R ${R.toFixed(2)})`);
});

done();

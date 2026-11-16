// A newcomer's first seconds (report 24-newcomer), checked without a GPU: the first view turns off a solid in the frame
// to the nearest clear turn and keeps a clear one; the dance's soft edge turns a run out of the play space along it,
// eases a body past it back in, and leaves a mirror's lane open.
import { test, assert, done } from '../../dancer/test/check';
import { clearTurn, eyeAt, OPENING, type SolidsLike } from '../opening';
import { softEdge } from '../edge';

type V3 = [number, number, number];
/** spheres as solids: a sweep stops at the first, `inside` within r of any */
const balls = (list: { c: V3; r: number }[]): SolidsLike => ({
  sweep(a, b, r) {
    let best = 1;
    for (let k = 1; k <= 40; k++) {
      const u = k / 40, p: V3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
      if (list.some((s) => Math.hypot(p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]) < s.r + r)) { best = (k - 1) / 40; break; }
    }
    return best;
  },
  inside: (p, r) => list.some((s) => Math.hypot(p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]) < s.r + r),
});

const T: V3 = [0, 1, 0];
test('a clear first view keeps its turn', () => {
  const r = clearTurn(balls([]), T, 0.4, 0.22, 6, 48, 16 / 9);
  assert(r.yaw === 0.4 && r.blocked === 0, `kept ${r.yaw}`);
});
test('a slab in the near frame turns the view off it, to the nearest clear turn', () => {
  // a slab a metre and a half in front of the eye at turn 0, a little to its left
  const e = eyeAt(T, 0, 0.22, 6), f = [T[0] - e[0], T[1] - e[1], T[2] - e[2]], l = Math.hypot(f[0], f[1], f[2]);
  const slab = { c: [e[0] + (f[0] / l) * 1.5 - 0.4, e[1] + 0.3, e[2] + (f[2] / l) * 1.5] as V3, r: 0.6 };
  const r = clearTurn(balls([slab]), T, 0, 0.22, 6, 48, 16 / 9);
  assert(r.blocked > 0, 'turn 0 was blocked');
  assert(r.yaw !== 0 && Math.abs(r.yaw) <= 0.9, `turned ${r.yaw.toFixed(2)}`);
  const again = clearTurn(balls([slab]), T, r.yaw, 0.22, 6, 48, 16 / 9);
  assert(again.blocked === 0, 'the turn it chose is clear');
  assert(OPENING.step > 0, 'steps');
});
test('a solid across the boom counts more than one at the frame\'s edge', () => {
  const e = eyeAt(T, 0, 0.22, 6);
  const mid: V3 = [(T[0] + e[0]) / 2, (T[1] + e[1]) / 2, (T[2] + e[2]) / 2];
  const r = clearTurn(balls([{ c: mid, r: 0.5 }]), T, 0, 0.22, 6, 48, 16 / 9);
  assert(r.blocked >= 6 && r.yaw !== 0, `blocked ${r.blocked}, turned ${r.yaw}`);
});

const A = { space: { center: [0, 0, 0] as V3, radius: 10, yKill: -2, yTop: 8 }, exits: [{ id: 'm', at: [0, 0, 9.5] as V3, dir: [0, 1] as [number, number], r: 1.4 }] };
test('a run out of the play space is turned along its edge', () => {
  const c = { root: [9.6, 0, -2], v: [4, 0, 0], yaw: Math.PI / 2 };
  for (let i = 0; i < 90; i++) { softEdge(c, A); c.root[0] += c.v[0] / 60; c.root[2] += c.v[2] / 60; }
  const d = Math.hypot(c.root[0], c.root[2]);
  assert(d < 10.8, `kept in: ${d.toFixed(2)} m from the middle`);
  assert(Math.hypot(c.v[0], c.v[2]) > 2, 'most of the speed kept, along the edge');
});
test('a body past the edge is eased back in', () => {
  const c = { root: [12, 0, 0], v: [0, 0, 0], yaw: 0 };
  for (let i = 0; i < 60; i++) softEdge(c, A);
  assert(Math.hypot(c.root[0], c.root[2]) < 10.2, `back in: ${c.root[0].toFixed(2)}`);
});
test('a mirror\'s lane stays open', () => {
  const c = { root: [0.2, 0, 9.4], v: [0, 0, 3], yaw: 0 };
  softEdge(c, A);
  assert(c.v[2] === 3 && c.root[2] === 9.4, 'untouched in the lane');
});
test('inside the space nothing changes', () => {
  const c = { root: [2, 0, 1], v: [3, 0, 3], yaw: 0 };
  assert(softEdge(c, A) === 0 && c.v[0] === 3, 'untouched');
});
done();

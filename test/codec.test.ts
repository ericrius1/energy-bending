// The binary pose (shared/protocol.ts encodePose / decodePose): sizes, round trips to the millimetre, the yaw across
// ±π, a root far from the origin, the repeated previous snapshot, the world and the move, and refusing what isn't a
// pose. Run: node test/codec.test.ts
import assert from 'node:assert/strict';
import { encodePose, decodePose, poseBytes, isPose, stampSlot, POSE, NLM, MAX_PREV } from '../shared/protocol.ts';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; }
};

const pose = (k: number) => ({
  p: Float64Array.from({ length: NLM * 3 }, (_, j) => Math.sin(j * 1.7 + k) * 0.9 + (j % 3 === 1 ? 1 : 0)),
  root: [1234.5678 + k * 0.01, 0.25, -987.6543] as [number, number, number],
  yaw: 3.1 + k * 0.05,
});

test('sizes: 106 bytes a pose, 89 more per earlier snapshot, plus the world and the move', () => {
  assert.equal(poseBytes(0), 106);
  assert.equal(poseBytes(1), 195);
  assert.equal(poseBytes(2, 'redwoods'), 106 + 1 + 2 * 88 + 9);
  assert.equal(encodePose({ ts: 1, pose: pose(0) }).length, 106);
  assert.equal(encodePose({ ts: 100, pose: pose(1), prev: [{ ts: 50, pose: pose(0) }], world: 'redwoods' }).length, poseBytes(1, 'redwoods'));
  assert.equal(encodePose({ ts: 100, pose: pose(1), move: ['0-12', 99.5] }).length, poseBytes(0, '', '0-12'));
  const four = [3, 2, 1, 0].map((k) => ({ ts: 50 * k, pose: pose(k) }));
  assert.equal(encodePose({ ts: 200, pose: pose(4), prev: four }).length, poseBytes(MAX_PREV), 'at most MAX_PREV');
});

test('round trip: landmarks and root to half a millimetre, yaw to 1e-4 rad (wrapped to ±π), flags, energy, ts', () => {
  const a = pose(0), ts = 1_731_400_000_123.4;
  const f = decodePose(encodePose({ ts, pose: a, flags: POSE.AIRBORNE | POSE.DODGING, energy: 200.4, world: 'geode', move: ['0-7', ts - 300] }))!;
  assert.ok(f);
  assert.equal(f.ts, ts); assert.equal(f.flags, POSE.AIRBORNE | POSE.DODGING); assert.equal(f.energy, 200);
  assert.equal(f.world, 'geode'); assert.deepEqual(f.move, ['0-7', ts - 300]);
  for (let j = 0; j < NLM * 3; j++) assert.ok(Math.abs(f.p[j] - a.p[j]) <= 0.0005, `landmark ${j}`);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(f.root[i] - a.root[i]) <= 0.0005, `root ${i}`);
  const dy = Math.abs(((f.yaw - a.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
  assert.ok(dy < 1e-4, `yaw ${f.yaw} vs ${a.yaw}`);
  assert.ok(f.yaw <= Math.PI && f.yaw > -Math.PI);
  assert.deepEqual(f.prev, []);
});

test('earlier snapshots: each its own ts (to 0.1 ms), root, yaw and landmarks, newest first', () => {
  const a = pose(0), b = pose(1), c = pose(2);
  const f = decodePose(encodePose({ ts: 5000.3, pose: c, prev: [{ ts: 4950.1, pose: b }, { ts: 4900.2, pose: a }] }))!;
  assert.deepEqual(f.prev.map((q) => q.ts), [4950.1, 4900.2]);
  for (const [q, src] of [[f.prev[0], b], [f.prev[1], a]] as const) {
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(q.root[i] - src.root[i]) <= 0.001);
    for (let j = 0; j < NLM * 3; j++) assert.ok(Math.abs(q.p[j] - src.p[j]) <= 0.0005);
    assert.ok(Math.abs(Math.cos(q.yaw) - Math.cos(src.yaw)) < 1e-4);
  }
  // too old to repeat (over 6.5 s): left out
  assert.equal(encodePose({ ts: 9000, pose: b, prev: [{ ts: 1000, pose: a }] }).length, 106);
});

test('limits: landmarks clamp at ±32.767 m, NaN becomes 0, a far root survives', () => {
  const a = pose(0);
  a.p[0] = 50; a.p[1] = NaN; a.root[0] = 1_500_000;
  const f = decodePose(encodePose({ ts: 1, pose: a }))!;
  assert.equal(f.p[0], 32.767); assert.equal(f.p[1], 0); assert.equal(f.root[0], 1_500_000);
});

test('the server stamps the slot; a truncated or foreign frame is refused', () => {
  const b = encodePose({ ts: 1, pose: pose(0), world: 'geode' });
  assert.ok(isPose(b));
  stampSlot(b, 5);
  assert.equal(decodePose(b)!.slot, 5);
  assert.equal(decodePose(b.subarray(0, 50)), null);
  assert.equal(decodePose(b.subarray(0, b.length - 3)), null, 'cut inside the world id');
  const c = b.slice(); c[0] = 0x51;
  assert.equal(decodePose(c), null);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);

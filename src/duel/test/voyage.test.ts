// A crossing as one move (phase 6, report 20-crossing; src/duel/crossing.ts): the camera's way through the disc after
// the pair goes round its rim outside its frame (never across its plane beside it), through it near its middle, and ends
// exactly on the duel camera's pose, with no step in its path; the approach finds the disc the pair is heading for; the
// judgement of a crossing is the disc's; a voyage is the same for the same seed and leaves the pair alone after one.
import { test, assert, done } from '../../dancer/test/check';
import { ThroughCam, approachOf, crossedDisc, Voyage, awayFrom, CROSS, WAY, blendPose, type Disc, type V3, type WaySpace } from '../voyage';
import { gateCrossed, frameSolids } from '../../portals/decor';
import { distTo } from '../../engine/camera';
import type { Solid } from '../../worlds/solids';
import { discCost } from '../camera';

// a mirror facing +z at the origin, its middle 1.35 m up
const D: Disc = { id: 'm', at: [0, 1.35, 0], n: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], r: 1.25, to: 'pool' };
const side = (p: V3) => (p[2] - D.at[2]);
const across = (p: V3) => Math.hypot(p[0] - D.at[0], p[1] - D.at[1]);

test('the way through: from any eye, round outside the frame, through near the middle, onto the duel pose', () => {
  const lines: string[] = [];
  // eyes in the new world's coordinates as the carry leaves them: behind the disc on its axis (the swing in worked),
  // behind and off to a side, beside it past its plane (the old side-on camera), above it, and at a slant
  const eyes: [string, V3][] = [['behind', [0.3, 2.0, -4.5]], ['behind-side', [-2.8, 1.8, -3.2]], ['beside', [5.2, 1.7, 0.6]], ['beside-other', [-4.8, 2.2, 1.4]], ['in front', [0.4, 1.9, 3.5]], ['slant', [3.5, 2.4, -2]]];
  for (const [name, e0] of eyes) {
    const pair: V3 = [0.4, 1.0, 2.2];
    const cam = { eye: [5.5, 1.6, 4.5] as V3, look: [0.4, 1.3, 2.5] as V3 };
    const W = new ThroughCam(D, 1, e0, [pair[0], pair[1] + 0.3, pair[2]]);
    let prev: V3 = [...e0], crossedAt: number | null = null, maxStep = 0, t = 0;
    for (let i = 0; i < 600 && !W.done; i++) {
      // (the pair walks on away from the disc)
      pair[2] += 1.2 / 60;
      const P = W.update(1 / 60, cam, pair);
      t += 1 / 60;
      const sp = side(prev), sn = side(P.eye);
      if (sp <= 0 && sn > 0) {
        const k = sp / (sp - sn), x: V3 = [prev[0] + (P.eye[0] - prev[0]) * k, prev[1] + (P.eye[1] - prev[1]) * k, prev[2] + (P.eye[2] - prev[2]) * k];
        assert(across(x) < D.r * 0.8, `${name}: through the plane ${across(x).toFixed(2)} m from the middle (inside its disc)`);
        crossedAt = t;
      } else if ((sp > 0) !== (sn > 0)) {
        // (crossing the plane the other way, or beside: only outside the frame)
        const k = sp / (sp - sn), x: V3 = [prev[0] + (P.eye[0] - prev[0]) * k, prev[1] + (P.eye[1] - prev[1]) * k, prev[2] + (P.eye[2] - prev[2]) * k];
        assert(across(x) > D.r + 0.6, `${name}: across the plane ${across(x).toFixed(2)} m from the middle, outside the frame`);
      }
      maxStep = Math.max(maxStep, Math.hypot(P.eye[0] - prev[0], P.eye[1] - prev[1], P.eye[2] - prev[2]));
      prev = P.eye;
    }
    assert(W.done, `${name}: done`);
    assert(crossedAt != null, `${name}: through the disc`);
    const end = Math.hypot(prev[0] - cam.eye[0], prev[1] - cam.eye[1], prev[2] - cam.eye[2]);
    assert(end < 1e-6, `${name}: ends on the duel camera's eye (${end})`);
    assert(maxStep < 0.19, `${name}: no jump (${maxStep.toFixed(3)} m a frame)`);
    lines.push(`${name} ${W.how.aligned ? 'aligned' : `round ${(W.how.turn * 57.3).toFixed(0)}°`}: through at ${crossedAt!.toFixed(2)} s, done ${t.toFixed(2)} s, ${(maxStep * 60).toFixed(1)} m/s at most`);
  }
  return lines.join('; ');
});

test('the way through when the duel camera chose a pose beside the disc\'s back: still through the disc, held in front', () => {
  const W = new ThroughCam(D, 1, [4.5, 1.8, 0.8], [0.4, 1.3, 2]);
  const cam = { eye: [3.2, 1.7, -1.5] as V3, look: [0.4, 1.3, 2.5] as V3 };
  let prev: V3 = [4.5, 1.8, 0.8], through = false;
  for (let i = 0; i < 600 && !W.done; i++) {
    const P = W.update(1 / 60, cam, [0.4, 1, 2.4]);
    const sp = side(prev), sn = side(P.eye);
    if (sp <= 0 && sn > 0) { const k = sp / (sp - sn); assert(across([prev[0] + (P.eye[0] - prev[0]) * k, prev[1] + (P.eye[1] - prev[1]) * k, 0]) < D.r * 0.8, 'inside the disc'); through = true; }
    prev = P.eye;
  }
  assert(through && W.clamped && side(prev) >= 1.6 - 1e-6, `through, and ended in front (${side(prev).toFixed(2)})`);
});

test('the way through keeps out of the world\'s pieces and every other gate (phase 7): a screen and a gate on its usual way', () => {
  // (the eye beside the disc on its right; the usual way round goes by that side. A screen stands there, behind the
  // disc's plane, and another gate stands across the way: the way chosen goes round clear of both)
  const screen: Solid = { kind: 'box', c: [2.6, 1.6, -1.6], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], h: [0.9, 1.6, 0.1] };
  const other = { id: 'x', at: [3.6, 1.35, -0.6] as V3, n: [-1, 0, 0] as V3, right: [0, 0, 1] as V3, up: [0, 1, 0] as V3, r: 1.0 };
  const pieces = [screen, ...frameSolids({ at: D.at, n: D.n, right: D.right, up: D.up, r: D.r })];
  const clear = (p: V3) => Math.min(...pieces.map((q) => distTo(q, p)));
  const space: WaySpace = { clear: (p) => clear(p), gate: (a, b) => !!gateCrossed(a, b, [other]) };
  const e0: V3 = [4.6, 1.8, 0.6], pair: V3 = [0.4, 1.0, 2.2], cam = { eye: [5.5, 1.6, 4.5] as V3, look: [0.4, 1.3, 2.5] as V3 };
  const run = (sp?: WaySpace) => {
    const W = new ThroughCam(D, 1, e0, [pair[0], pair[1] + 0.3, pair[2]], sp);
    let prev: V3 = [...e0], minClear = Infinity, gates = 0, through = false;
    for (let i = 0; i < 600 && !W.done; i++) {
      const P = W.update(1 / 60, cam, pair);
      if (P.eye[2] < 2.5) minClear = Math.min(minClear, clear(P.eye));
      if (gateCrossed(prev, P.eye, [other])) gates++;
      if (side(prev) <= 0 && side(P.eye) > 0 && across(P.eye) < D.r) through = true;
      prev = P.eye;
    }
    return { W, minClear, gates, through };
  };
  const a = run(), b = run(space);
  assert(a.minClear < WAY.clear || a.gates > 0, `the usual way meets the screen or the gate (${a.minClear.toFixed(2)} m, ${a.gates} gates)`);
  assert(b.minClear >= WAY.clear * 0.6 && b.gates === 0 && b.through, `the way chosen: ${b.minClear.toFixed(2)} m clear at least, ${b.gates} gates, through ${b.through}`);
  return `usual ${a.minClear.toFixed(2)} m / ${a.gates} gates; chosen "${b.W.how.plan}" (of ${b.W.how.tried}) ${b.minClear.toFixed(2)} m / ${b.gates} gates`;
});

test('the way through bends its tail round a post between the disc and the duel camera\'s eye (phase 7)', () => {
  const e0: V3 = [0.2, 1.9, -3.5], pair: V3 = [0.4, 1.0, 2.2], cam = { eye: [5.5, 1.6, 4.5] as V3, look: [0.4, 1.3, 2.5] as V3 };
  // (where the usual tail passes, out in front of the disc: find it, and stand a post there)
  const probe = new ThroughCam(D, 1, e0, [pair[0], pair[1] + 0.3, pair[2]]);
  let mid: V3 | null = null;
  for (let i = 0; i < 600 && !probe.done; i++) { const P = probe.update(1 / 60, cam, pair); if (!mid && P.eye[2] > 3) mid = P.eye; }
  const post: Solid = { kind: 'capsule', a: [mid![0], 0, mid![2]], b: [mid![0], 3.2, mid![2]], r: 0.3 };
  const clear = (p: V3) => distTo(post, p);
  const W = new ThroughCam(D, 1, e0, [pair[0], pair[1] + 0.3, pair[2]], { clear: (p) => clear(p), gate: () => false });
  let min = Infinity, through = false, prev: V3 = [...e0];
  for (let i = 0; i < 600 && !W.done; i++) {
    const P = W.update(1 / 60, cam, pair);
    if (Math.hypot(P.eye[0] - cam.eye[0], P.eye[2] - cam.eye[2]) > 0.5) min = Math.min(min, clear(P.eye));
    if (side(prev) <= 0 && side(P.eye) > 0 && across(P.eye) < D.r) through = true;
    prev = P.eye;
  }
  assert(through && min > 0.1, `round the post (${min.toFixed(2)} m at the nearest), through the disc ${through}: "${W.how.plan}"`);
  return `"${W.how.plan}" of ${W.how.tried}, ${min.toFixed(2)} m off the post`;
});

test('the approach: the disc the pair runs at, and the voyage\'s disc', () => {
  const A = approachOf([0.2, 1, 3], [0, 0, -3], [D], null);
  assert(A && A.disc.id === 'm' && A.side === 1 && A.w > 0.3, `running at it: ${JSON.stringify(A)}`);
  assert(!approachOf([0.2, 1, 3], [0, 0, 3], [D], null), 'running away: none');
  assert(!approachOf([6, 1, 3], [0, 0, -3], [D], null), 'passing well beside it: none');
  const V = approachOf([1, 1, 4.5], [0, 0, 0], [D], D);
  assert(V && V.w > 0.4, `a voyage near it, standing: ${V?.w}`);
});

test('the judgement: a segment through the disc, not beside it', () => {
  assert(crossedDisc([0.2, 1.2, 0.5], [0.2, 1.2, -0.5], [D])?.front === true, 'in at the front');
  assert(crossedDisc([0.2, 1.2, -0.5], [0.2, 1.2, 0.5], [D])?.front === false, 'in at the back');
  assert(!crossedDisc([2, 1.2, 0.5], [2, 1.2, -0.5], [D]), 'beside');
});

test('a voyage: the same for a seed, none early, none in the grace after a crossing; the settle away', () => {
  const run = (seed: number) => {
    const v = new Voyage(seed), at: number[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      const t = i / 60;
      const p = v.step(1 / 60, { playT: t, left: 60 - t, play: true, energy: 0.6, joined: false, mid: [0, 1, 5], discs: [D] });
      if (p && p.since === t) at.push(t);
      if (p && t - p.since > 3) v.crossed(t, D.id, D);
    }
    return at;
  };
  const a = run(3), b = run(3);
  assert(a.join() === b.join(), 'the same each time');
  assert(a.every((t) => t >= CROSS.quietStart && t <= 60 - CROSS.quietEnd), `none in the set's first or last seconds: ${a}`);
  for (let i = 1; i < a.length; i++) assert(a[i] - a[i - 1] >= CROSS.grace, `the grace between ${a[i - 1]} and ${a[i]}`);
  const [x, z] = awayFrom(D, 0.3, 0.8);
  assert(z >= CROSS.settleDist - 1e-9 && x === 0.3, `a goal at the disc goes out in front of it: ${x}, ${z}`);
  return `voyages at ${a.map((t) => t.toFixed(1)).join(', ')} s`;
});

test('the duel camera pays for a mirror in its eye, behind it, or the pair seen through it', () => {
  const mid: V3 = [0, 1, 3];
  const free = discCost([5, 1.6, 4], mid, [D]);
  assert(free === 0, `a clear side view costs nothing (${free})`);
  assert(discCost([0.6, 1.6, 0.4], mid, [D]) > 1, 'in its frame');
  assert(discCost([1.5, 1.6, -1.5], mid, [D]) > 1, 'beside its back');
  assert(discCost([0.2, 1.4, -4], mid, [D]) >= 3, 'the pair seen through it');
});

test('the pose blend turns by the shorter way about the look point', () => {
  const a = { eye: [5, 1, 0] as V3, look: [0, 1, 0] as V3 }, b = { eye: [0, 1, 5] as V3, look: [0, 1, 0] as V3 };
  const m = blendPose(a, b, 0.5);
  const r = Math.hypot(m.eye[0], m.eye[2]);
  assert(Math.abs(r - 5) < 1e-6 && m.eye[0] > 3 && m.eye[2] > 3, `on the arc: ${m.eye}`);
});

done();

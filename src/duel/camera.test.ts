// The duel's free camera (camera.ts), checked without a GPU: the fit holds every point inside the frame's margins and
// no further back than it must; a launch is framed at its apex, so the flyer never leaves the top of the frame; between
// the temple's lintels the eye stands clear of the stones and sees both bodies where the plain side view would stand
// in them; and through a whole simulated set (the real bodies, brains and arena: sim.ts) the turn is smooth (bounded,
// no snaps) and the flyer stays in frame.
import { test, assert, near, done } from '../dancer/test/check';
import { DUEL_CAM, DuelCamera, apexOf, fit, screenOf, short, type CamBody, type CamSpace, type V3 } from './camera';
import { Solids, distTo } from '../engine/camera';
import { simulateDuel, nodeArena, makeBrains } from './sim';

const ASPECT = 16 / 9;
/** a body standing (or flying) with its feet at r: the points the page frames, from a rough skeleton */
const bodyAt = (r: V3, vel: V3 = [0, 0, 0], air = false): CamBody => {
  const at = (dy: number, dx = 0): V3 => [r[0] + dx, r[1] + dy, r[2]];
  return { pts: [at(0.95), at(1.3), at(1.2, 0.5), at(1.2, -0.5), at(0.05, 0.15), at(0.05, -0.15)], sight: [at(0.95), at(1.3)], head: at(1.8), root: [...r] as V3, vel, air };
};
const spaceOf = (S: Solids, groundAt: (x: number, z: number) => number): CamSpace => ({
  clear: (p) => { let d = Infinity; for (const s of S.list) d = Math.min(d, distTo(s, p)); return d; },
  blocked: (a, b) => S.sweep(a, b, 0.2) < 0.98,
  ground: groundAt,
});
const inFrame = (s: [number, number] | null, top = 0.08) => !!s && s[0] >= 0 && s[0] <= 1 && s[1] >= top && s[1] <= 1;

test('the fit holds every point inside the margins, and stands no further back than it must', () => {
  const m = { top: 0.16, bottom: 0.1, side: 0.1 };
  let worst = 0;
  for (let k = 0; k < 40; k++) {
    const r = (i: number) => Math.sin(k * 12.9898 + i * 78.233) * 43758.5453 % 1;
    const pts: V3[] = [];
    for (let i = 0; i < 8; i++) pts.push([r(i) * 4, 1 + Math.abs(r(i + 9)) * 4, r(i + 20) * 4]);
    const yaw = r(40) * 3, pitch = 0.1 + Math.abs(r(41)) * 0.6;
    const F = fit(pts, yaw, pitch, 46, ASPECT, m, 0, 100);
    let tight = 1;
    for (const p of pts) {
      const s = screenOf(p, F.eye, F.look, F.fov, ASPECT)!;
      assert(s && s[0] >= m.side - 1e-3 && s[0] <= 1 - m.side + 1e-3 && s[1] >= m.top - 1e-3 && s[1] <= 1 - m.bottom + 1e-3, `point out at ${s}`);
      tight = Math.min(tight, s[0] - m.side, 1 - m.side - s[0], s[1] - m.top, 1 - m.bottom - s[1]);
    }
    worst = Math.max(worst, tight);
  }
  // (some point always touches a margin: the boom is the shortest that holds them)
  assert(worst < 0.01, `a fit stood back further than it had to (slack ${worst.toFixed(3)})`);
  return `40 random fits, slack under ${worst.toFixed(4)}`;
});

test('a launch is framed at its apex: 16 m/s up peaks 3.2 m higher at the duel\'s gravity', () => {
  const A = apexOf([0, 2, 0], [1, 16, 0], 40)!;
  near(A[1], 2 + 16 * 16 / 80, 1e-6, 'apex height');
  near(A[0], 0.4, 1e-6, 'drift on the way up');
  assert(apexOf([0, 2, 0], [0, -3, 0], 40) === null, 'a falling body has no apex');
});

test('the flyer stays in frame through a launch and back down to the catch', () => {
  const cam = new DuelCamera();
  const base = bodyAt([0, 0, 0]);
  let p: V3 = [0.6, 1.0, 0], v: V3 = [0.5, 0, 0];
  let frames = 0, out = 0, topMost = 1;
  for (let i = 0; i < 180; i++) {
    const dt = 1 / 60;
    // standing on the base's hands for half a second, launched at 16 m/s, falling back to be caught at 1 m
    if (i === 30) v = [0.5, 16, 0];
    if (i > 30) { v = [v[0], v[1] - 40 * dt, v[2]]; p = [p[0] + v[0] * dt, Math.max(1.0, p[1] + v[1] * dt), p[2]]; }
    const flyer = bodyAt(p, v, i > 30 && p[1] > 1.0);
    const pose = cam.update(dt, { bodies: [base, flyer], aspect: ASPECT, gravity: 40, space: null, near: 0.6, center: [0, 0, 0], room: 30 });
    const s = screenOf([flyer.head[0], flyer.head[1] + 0.12, flyer.head[2]], pose.eye, pose.look, pose.fov, ASPECT);
    if (i > 30) { frames++; if (!inFrame(s)) out++; if (s) topMost = Math.min(topMost, s[1]); }
  }
  assert(out === 0, `the flyer's head left the top 8 % in ${out} of ${frames} frames`);
  return `highest on screen ${(topMost * 100).toFixed(1)} % from the top`;
});

test('between the temple\'s lintels the eye stands clear of the stones and sees both, where side on would not', () => {
  const { arena, world } = nodeArena('temple');
  const S = new Solids(world.solids ?? []), space = spaceOf(S, world.groundAt);
  const P = DUEL_CAM;
  // the places in the court where the plain side view (side on, the lowest pitch) would stand in a stone or look
  // through one at a body, the pair a stride and a half apart along x
  let tried = 0, bad = 0, fixed = 0;
  const worst: string[] = [];
  for (let x = -6; x <= 6; x += 1.5) for (let z = -6; z <= 5; z += 1.5) {
    const g = world.groundAt(x, z);
    if (g < -0.5 || S.inside([x, g + 1, z], 0.4) || S.inside([x + 1.5, g + 1, z], 0.4)) continue;
    const a = bodyAt([x, g, z]), b = bodyAt([x + 1.5, world.groundAt(x + 1.5, z), z]);
    const pts = new DuelCamera().pointsOf({ bodies: [a, b] } as never);
    const sight = (eye: V3) => [a, b].some((q) => [q.pts[0], q.pts[1], q.head].some((p) => S.sweep(eye, short(eye, p, 0.5), 0.12) < 0.98));
    for (const side of [-Math.PI / 2, Math.PI / 2]) {
      const F = fit(pts, side, P.pitches[0], P.fov, ASPECT, { top: P.top, bottom: P.bottom, side: P.side }, P.minDist, P.maxDist);
      if (space.clear(F.eye) > 0.75 && !sight(F.eye)) continue;
      tried++;
      bad++;
      // the camera given a second to settle there (the pair standing still)
      const cam = new DuelCamera();
      let pose = cam.update(1 / 60, { bodies: [a, b], aspect: ASPECT, gravity: 40, space, near: 0.6, center: arena.space.center, room: 22 });
      for (let i = 0; i < 90; i++) pose = cam.update(1 / 60, { bodies: [a, b], aspect: ASPECT, gravity: 40, space, near: 0.6, center: arena.space.center, room: 22 });
      if (space.clear(pose.eye) > 0.75 && !sight(pose.eye)) fixed++;
      else worst.push(`(${x}, ${z}) clear ${space.clear(pose.eye).toFixed(2)}${sight(pose.eye) ? ' blocked' : ''}`);
    }
  }
  assert(bad >= 5, `expected the plain side view to be in the stones somewhere (it was in ${bad})`);
  assert(fixed / bad >= 0.85, `the camera found a clear eye in only ${fixed} of ${bad}: ${worst.slice(0, 6).join(', ')}`);
  return `the plain side view was in the stones or blocked at ${bad} places of the court; the camera stood clear at ${fixed}`;
});

test('through a simulated temple set the turn is smooth and the flyer stays in frame', () => {
  const { arena, world } = nodeArena('temple');
  const S = new Solids(world.solids ?? []), space = spaceOf(S, world.groundAt);
  const cam = new DuelCamera();
  let n = 0, up = 0, upOut = 0, nearEye = 0, maxStep = 0, flips = 0, lastSign = 0, lastT = -9;
  let prev: number | null = null;
  simulateDuel({
    arena, world, seconds: 40, brains: makeBrains(['lead', 'flyer'], [0.7, 0.7], [21, 122]),
    each: ({ t, match, bodies }) => {
      if (match.state.phase !== 'play') return;
      const B = bodies.map((c) => bodyAt([c.root[0], c.root[1], c.root[2]], [c.v[0], c.v[1], c.v[2]], !c.grounded));
      const pose = cam.update(1 / 60, { bodies: B, aspect: ASPECT, gravity: 40, space, near: 0.6, center: arena.space.center, room: arena.camera?.maxDist ?? 22, maxDist: arena.camera?.maxDist });
      n++;
      const dh = B[0].head[1] - B[1].head[1];
      let f: number | null = match.contact.flown?.flyer ?? null;
      if (f == null && Math.abs(dh) > 1) f = dh > 0 ? 0 : 1;
      if (f != null && B[f].air) {
        up++;
        if (!inFrame(screenOf([B[f].head[0], B[f].head[1] + 0.12, B[f].head[2]], pose.eye, pose.look, pose.fov, ASPECT))) upOut++;
      }
      if (space.clear(pose.eye) < 0.6) nearEye++;
      if (prev != null) {
        const d = Math.atan2(Math.sin(pose.yaw - prev), Math.cos(pose.yaw - prev));
        maxStep = Math.max(maxStep, Math.abs(d));
        if (Math.abs(d) * 60 > 0.2) { const sg = Math.sign(d); if (lastSign && sg !== lastSign && t - lastT < 0.5) flips++; lastSign = sg; lastT = t; }
      }
      prev = pose.yaw;
    },
  });
  assert(up > 100, `too little flight to judge (${up} frames)`);
  assert(upOut / up <= 0.05, `the flyer left the frame in ${upOut} of ${up} frames`);
  assert(maxStep <= DUEL_CAM.yawRate / 60 + 1e-6, `the yaw jumped ${maxStep.toFixed(3)} rad in a frame`);
  assert(nearEye / n < 0.02, `the eye stood within the near fade's distance of a stone in ${nearEye} of ${n} frames`);
  assert(flips / (n / 3600) < 30, `the turn reversed ${flips} times (${(flips / (n / 3600)).toFixed(0)} a minute)`);
  return `${n} frames: flyer in frame ${up - upOut}/${up}, eye near a stone ${nearEye}, largest turn a frame ${(maxStep * 57.3).toFixed(2)}°, ${flips} reversals`;
});

done();

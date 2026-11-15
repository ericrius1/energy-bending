// The duel's free camera (camera.ts), checked without a GPU: the fit holds every point inside the frame's margins and
// no further back than it must; a launch is framed at its apex, so the flyer never leaves the top of the frame; between
// the temple's lintels the eye stands clear of the stones and sees both bodies where the plain side view would stand
// in them; and through a whole simulated set (the real bodies, brains and arena: sim.ts) the turn is smooth (bounded,
// no snaps) and the flyer stays in frame.
import { test, assert, near, done } from '../dancer/test/check';
import { DUEL_CAM, IMPULSE, DuelCamera, apexOf, fit, screenOf, short, type CamBody, type CamImpulseKind, type CamInput, type CamSpace, type V3 } from './camera';
import { Solids } from '../engine/camera';
import { simulateDuel, nodeArena, makeBrains } from './sim';
import { judge, spaceOf as camSpaceOf } from './camspace';
import { CAM_WORLDS, nodeWorld } from './camworlds';

const ASPECT = 16 / 9;
/** a body standing (or flying) with its feet at r: the points the page frames, from a rough skeleton */
const bodyAt = (r: V3, vel: V3 = [0, 0, 0], air = false): CamBody => {
  const at = (dy: number, dx = 0): V3 => [r[0] + dx, r[1] + dy, r[2]];
  return { pts: [at(0.95), at(1.3), at(1.2, 0.5), at(1.2, -0.5), at(0.05, 0.15), at(0.05, -0.15)], sight: [at(0.95), at(1.3)], head: at(1.8), root: [...r] as V3, vel, air };
};
/** the page's space (camspace.ts): the eye, the sight lines and the frame's near part judged against every solid */
const spaceOf = (S: Solids, groundAt: (x: number, z: number) => number): CamSpace => camSpaceOf(S.list, groundAt)!;
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

/** a simulated set in a world with the camera framing it, every frame judged (camprobe.ts measures many more) */
function judgeSet(id: string, seed: number, seconds: number, dress: [string, string], impulses = false) {
  const { arena, world } = nodeWorld(id);
  const cam = new DuelCamera();
  let space: CamSpace | null = null, version = -1;
  const T = { n: 0, nearEye: 0, fg10: 0, hidden: 0, flyer: 0, flyerOut: 0, p35: 0, p45: 0 };
  simulateDuel({
    arena, world, seconds, dress, brains: makeBrains(['lead', 'flyer'], [0.85, 0.85], [seed, seed + 7]),
    each: ({ match, powers, bodies, events }) => {
      // (the powers' steps and pillars in the solids while they stand, as World.solids has them in the page)
      if ((powers?.version ?? 0) !== version) { version = powers?.version ?? 0; space = camSpaceOf([...(world.solids ?? [])], world.groundAt); }
      if (match.state.phase !== 'play') return;
      const B = bodies.map((c) => ({ ...bodyAt([c.root[0], c.root[1], c.root[2]], [c.v[0], c.v[1], c.v[2]], !c.grounded), away: c.reforming }));
      const seen = B.filter((b) => !b.away);
      if (impulses) {
        for (const x of match.touches) if (x.kind === 'catch' || x.kind === 'aerial' || x.kind === 'fling' || x.kind === 'lift') cam.impulse({ at: x.at, kind: x.kind === 'aerial' ? 'catch' : x.kind, k: 1 });
        for (const e of events) if (e.k === 'merge') cam.impulse({ at: match.contact.link?.at ?? B[0].head, kind: 'merge', k: 1 });
      }
      const pose = cam.update(1 / 60, { bodies: B, aspect: ASPECT, gravity: 40, space, near: 0.6, center: arena.space.center, room: arena.camera?.maxDist ?? 22, maxDist: arena.camera?.maxDist });
      const J = judge(pose, seen.length ? seen : B, space, ASPECT);
      T.n++;
      if (J.clear < 0.6) T.nearEye++;
      if (J.fg >= 0.1) T.fg10++;
      if (J.pitch > 0.611) T.p35++;
      if (J.pitch > 0.785) T.p45++;
      if (J.hidden[0] >= 0.6 || J.hidden[1] >= 0.6) T.hidden++;
      const dh = B[0].head[1] - B[1].head[1];
      let f: number | null = match.contact.flown?.flyer ?? null;
      if (f == null && Math.abs(dh) > 1) f = dh > 0 ? 0 : 1;
      if (f != null && B[f].air) { T.flyer++; if (!inFrame(screenOf([B[f].head[0], B[f].head[1] + 0.12, B[f].head[2]], pose.eye, pose.look, pose.fov, ASPECT))) T.flyerOut++; }
    },
  });
  return T;
}

test('in all four arenas the eye stays clean: out of the pieces, nothing across the near frame, the flyer in frame', () => {
  const lines: string[] = [];
  let n = 0, nearEye = 0, fg10 = 0, flyer = 0, flyerOut = 0, p35 = 0, p45 = 0;
  const dress: [string, string][] = [['fire', 'water'], ['water', 'ice'], ['plasma', 'gems'], ['ice', 'gems']];
  CAM_WORLDS.forEach((id, i) => {
    const T = judgeSet(id, 11 + i * 17, 30, dress[i]);
    n += T.n; nearEye += T.nearEye; p35 += T.p35; p45 += T.p45; fg10 += T.fg10; flyer += T.flyer; flyerOut += T.flyerOut;
    lines.push(`${id} ${(100 * T.fg10 / T.n).toFixed(1)}% near frame, ${(100 * T.nearEye / T.n).toFixed(1)}% eye near, flyer ${T.flyer - T.flyerOut}/${T.flyer}`);
  });
  // (the judge's yardstick since p3-camera-2: the near part 0.6 of the way to the nearer body, at most 5 m. Over camprobe's
  // 24 sets a piece across a tenth of the frame in 6.1% of frames on master, 5.0% after; this test's geode set, the pair
  // under the high blade and behind the crystal trunk for the whole set, is 39 to 44% with either camera)
  assert(fg10 / n <= 0.14, `a piece across the near frame in ${(100 * fg10 / n).toFixed(1)}% of frames: ${lines.join('; ')}`);
  assert(nearEye / n <= 0.015, `the eye within the near fade's distance in ${(100 * nearEye / n).toFixed(1)}% of frames`);
  // (camprobe's 24 sets: the flyer in frame in every frame; this geode set, the pair behind the great crystal trunk under the
  // high shelves, loses the top 8 % for 2 to 4 frames of 741)
  // a players' view: the look down under 35° nearly always, never past 45°
  assert(p45 === 0, `the camera looked down past 45° in ${p45} frames`);
  assert(p35 / n <= 0.05, `the camera looked down past 35° in ${(100 * p35 / n).toFixed(1)}% of frames`);
  assert(flyerOut / Math.max(1, flyer) <= 0.006, `the flyer left the frame in ${flyerOut} of ${flyer} frames: ${lines.join("; ")}`);
  return `${n} frames, flyer in frame ${flyer - flyerOut}/${flyer}: ${lines.join('; ')}`;
});

/** two bodies standing still, the camera settled on them */
const still = () => {
  const cam = new DuelCamera(), I: CamInput = { bodies: [bodyAt([-1, 0, 0]), bodyAt([1, 0, 0])], aspect: ASPECT, gravity: 40, space: null, near: 0.6, center: [0, 0, 0], room: 30 };
  let pose = cam.update(1 / 60, I);
  for (let i = 0; i < 240; i++) pose = cam.update(1 / 60, I);
  return { cam, I, rest: pose };
};

test('an impulse eases toward the contact and settles back, with no jolt', () => {
  const lines: string[] = [];
  for (const kind of Object.keys(IMPULSE) as CamImpulseKind[]) {
    const { cam, I, rest } = still(), at: V3 = [1.5, 2.2, 0.5];
    cam.impulse({ at, kind, k: 1 });
    const eyes: V3[] = [rest.eye], looks: V3[] = [rest.look];
    // (and the breath's: it comes back in for the moment and opens out again once it has settled, DUEL_CAM.breathe)
    const frames = Math.ceil((IMPULSE[kind].len + 0.3 + 4) * 60);
    for (let i = 0; i < frames; i++) { const p = cam.update(1 / 60, I); eyes.push(p.eye); looks.push(p.look); }
    // (the look point's furthest lean toward the contact, and the eye's largest step and change of step a frame)
    let lean = 0, vMax = 0, aMax = 0;
    const toward = (p: V3) => ((p[0] - rest.look[0]) * (at[0] - rest.look[0]) + (p[1] - rest.look[1]) * (at[1] - rest.look[1]) + (p[2] - rest.look[2]) * (at[2] - rest.look[2])) / Math.hypot(at[0] - rest.look[0], at[1] - rest.look[1], at[2] - rest.look[2]);
    for (const l of looks) lean = Math.max(lean, toward(l));
    for (const path of [eyes, looks]) for (let i = 1; i < path.length; i++) {
      const v = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]) * 60;
      vMax = Math.max(vMax, v);
      if (i > 1) aMax = Math.max(aMax, Math.hypot(...[0, 1, 2].map((j) => path[i][j] - 2 * path[i - 1][j] + path[i - 2][j])) * 3600);
    }
    // the first frame barely moves (it starts at rest), the speed changes smoothly, it leans toward the contact, and it
    // comes back to where it was
    const first = Math.hypot(...[0, 1, 2].map((j) => eyes[1][j] - eyes[0][j]));
    assert(first < 0.002, `${kind}: the first frame moved the eye ${(first * 1000).toFixed(1)} mm`);
    assert(aMax < 12, `${kind}: the eye or the look point accelerated at ${aMax.toFixed(1)} m/s²`);
    if (IMPULSE[kind].lean > 0) assert(lean > 0.08, `${kind}: leaned only ${lean.toFixed(3)} m toward the contact`);
    const back = Math.hypot(...[0, 1, 2].map((j) => looks[looks.length - 1][j] - rest.look[j]));
    assert(back < 0.01, `${kind}: ${back.toFixed(3)} m from rest after it`);
    lines.push(`${kind} lean ${lean.toFixed(2)} m, ≤ ${vMax.toFixed(2)} m/s, ≤ ${aMax.toFixed(1)} m/s²`);
  }
  return lines.join('; ');
});

test('between moments the frame breathes out, lower and wider, and comes back in for a catch without a jolt', () => {
  const { cam, I, rest } = still(), B = DUEL_CAM.breathe;
  // (at rest it has breathed out: the plain view less the breath's look down, the lens opened)
  assert(cam.calm > 0.97, `calm at rest ${cam.calm.toFixed(2)}`);
  near(rest.pitch, DUEL_CAM.pitches[0] - B.low, 0.01, 'the pitch at rest');
  assert(rest.fov > DUEL_CAM.fov + B.widen - 0.5, `the lens at rest ${rest.fov.toFixed(1)}°`);
  cam.impulse({ at: [0, 1.5, 0], kind: 'catch', k: 1 });
  let aMax = 0, out = 0, calmAt1 = 1, fovAt1 = 0, prev = [rest.eye, rest.eye];
  for (let i = 1; i <= 360; i++) {
    const p = cam.update(1 / 60, I);
    aMax = Math.max(aMax, Math.hypot(...[0, 1, 2].map((j) => p.eye[j] - 2 * prev[1][j] + prev[0][j])) * 3600);
    prev = [prev[1], p.eye];
    for (const b of I.bodies) for (const q of [b.head, b.root]) if (!inFrame(screenOf(q, p.eye, p.look, p.fov, ASPECT), 0.02)) out++;
    if (i === 60) { calmAt1 = cam.calm; fovAt1 = p.fov; }
  }
  // (in within a second, back out by six; the pair in frame throughout, and the eye's acceleration gentle)
  assert(calmAt1 < 0.35, `a second after the catch, calm is still ${calmAt1.toFixed(2)}`);
  assert(cam.calm > 0.9, `six seconds on, calm only ${cam.calm.toFixed(2)}`);
  assert(out === 0, `a body left the frame in ${out} frames`);
  assert(aMax < 12, `the eye accelerated at ${aMax.toFixed(1)} m/s²`);
  return `rest: pitch ${(rest.pitch * 57.3).toFixed(1)}°, lens ${rest.fov.toFixed(1)}°; a second after a catch calm ${calmAt1.toFixed(2)}, lens ${fovAt1.toFixed(1)}°; the eye ≤ ${aMax.toFixed(1)} m/s²`;
});

test('impulses never let a body out of the frame, nor take the eye into the pieces', () => {
  // a launch with a merge and catches piling on: the flyer's head stays in frame
  const cam = new DuelCamera();
  const base = bodyAt([0, 0, 0]);
  let p: V3 = [0.6, 1.0, 0], v: V3 = [0.5, 0, 0], out = 0;
  for (let i = 0; i < 200; i++) {
    const dt = 1 / 60;
    if (i === 30) { v = [0.5, 16, 0]; cam.impulse({ at: [0.3, 2.2, 0], kind: 'lift', k: 1 }); cam.impulse({ at: [0.3, 2, 0], kind: 'merge', k: 1 }); }
    if (i === 60 || i === 70) cam.impulse({ at: [-3, 0.5, 0], kind: 'catch', k: 1 });
    if (i > 30) { v = [v[0], v[1] - 40 * dt, v[2]]; p = [p[0] + v[0] * dt, Math.max(1.0, p[1] + v[1] * dt), p[2]]; }
    const flyer = bodyAt(p, v, i > 30 && p[1] > 1.0);
    const pose = cam.update(dt, { bodies: [base, flyer], aspect: ASPECT, gravity: 40, space: null, near: 0.6, center: [0, 0, 0], room: 30 });
    for (const b of [base, flyer]) if (!inFrame(screenOf([b.head[0], b.head[1] + 0.12, b.head[2]], pose.eye, pose.look, pose.fov, ASPECT), 0.06)) out++;
  }
  assert(out === 0, `a head left the frame in ${out} frames`);
  // a temple set with an impulse at every catch, fling, lift and merge: as clean as without
  // (the breath held still in both: the impulses keep it in by design, so with it the two sets frame differently)
  const B = DUEL_CAM.breathe, keep = { ...B };
  Object.assign(B, { low: 0, widen: 0, top: 0, side: 0 });
  const plain = judgeSet('temple', 7, 30, ['fire', 'water']), felt = judgeSet('temple', 7, 30, ['fire', 'water'], true);
  Object.assign(B, keep);
  assert(felt.flyerOut === 0, `with impulses the flyer left the frame in ${felt.flyerOut} frames`);
  assert(felt.nearEye / felt.n <= plain.nearEye / plain.n + 0.005, `with impulses the eye stood near a stone in ${felt.nearEye} frames (${plain.nearEye} without)`);
  assert(felt.fg10 / felt.n <= plain.fg10 / plain.n + 0.01, `with impulses a piece crossed the near frame in ${felt.fg10} frames (${plain.fg10} without)`);
  return `the temple with impulses: near frame ${felt.fg10} frames (${plain.fg10} without), eye near ${felt.nearEye} (${plain.nearEye}), of ${felt.n}`;
});

test('the camera runs on real time: a hit-stop or a slow motion leaves it easing at its own pace', () => {
  // (the bodies frozen, as in a hit-stop: the game's dt is 0, the camera's is the frame's)
  const { cam, I } = still();
  cam.impulse({ at: [0, 2, 0], kind: 'catch', k: 1 });
  let peak = 0;
  for (let i = 0; i < 30; i++) { cam.update(1 / 60, I); peak = Math.max(peak, cam.last.lean); }
  assert(peak > 0.05, `the impulse moved ${peak.toFixed(3)} m while the game stood still`);
  for (let i = 0; i < Math.ceil(IMPULSE.catch.len * 60); i++) cam.update(1 / 60, I);
  assert(cam.last.lean < 1e-6, 'the impulse is over after its length in real seconds');
  // (a slow motion: the bodies move at a fifth of their pace, the camera still turns within its bounds)
  const c2 = new DuelCamera();
  let x = 0, prev: number | null = null, maxStep = 0;
  for (let i = 0; i < 300; i++) {
    x += 0.2 * 6 / 60;
    const pose = c2.update(1 / 60, { bodies: [bodyAt([x, 0, 0], [1.2, 0, 0]), bodyAt([2 - x * 0.5, 0, x * 0.8], [-0.6, 0, 1])], aspect: ASPECT, gravity: 40, space: null, near: 0.6, center: [0, 0, 0], room: 30 });
    if (prev != null) maxStep = Math.max(maxStep, Math.abs(Math.atan2(Math.sin(pose.yaw - prev), Math.cos(pose.yaw - prev))));
    prev = pose.yaw;
  }
  assert(maxStep <= DUEL_CAM.yawRate / 60 + 1e-6, `the yaw jumped ${maxStep.toFixed(3)} rad in a frame`);
  return `an impulse at a hit-stop leaned ${peak.toFixed(2)} m and was over in ${IMPULSE.catch.len} s`;
});


done();

// node scripts/check-portals.mjs: the gates' algebra and the oblique near plane, in plain Node (no GPU). It bundles
// src/portals/gate.ts and src/portals/camera.ts with esbuild (Vite's own), with weft's Camera and math taken from
// its source (the rest of weft wants a GPU), and checks:
//   - a pair's two moves undo each other; the centre goes to the partner's centre; in at one front is out of the other
//   - a point in front of one disc is behind the other (where the camera behind a live gate stands)
//   - a floor gate paired with a sky gate keeps down as down (you fall out of the sky)
//   - crossing: through the disc yes, beside it no, a closed gate no
//   - the oblique projection keeps exactly the far side of the plane (0 ≤ z ≤ w there, z > w on the near side) and
//     never puts anything in the frustum past the far plane (z ≥ 0 out to a kilometre)
//   - the camera rig (engine/camera.ts) through a gate: carried with its player in the same frame by the same move,
//     drawn from where it was until its eye comes through the disc (its line through the disc, never beside it,
//     smoothly, within a couple of seconds, never nearer the player than 1.2 m), ending behind the player; never
//     standing behind a disc; and the locked view holding two dancers whole through a leap and a cartwheel
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const weftSrc = join(root, 'node_modules/@ericrius1/weft/src').replace(/\\/g, '/');
const out = await build({
  stdin: { contents: "export * from './src/portals/gate'; export * from './src/portals/camera'; export * from './src/portals/rigid'; export { CameraRig, Solids, boxOn, distTo, cameraParams } from './src/engine/camera'; export { samplePath } from './src/engine/shots';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', write: false, platform: 'node',
  plugins: [{
    name: 'weft-cpu', setup(b) {
      b.onResolve({ filter: /^@ericrius1\/weft$/ }, () => ({ path: 'weft-cpu', namespace: 'weft-cpu' }));
      b.onLoad({ filter: /.*/, namespace: 'weft-cpu' }, () => ({ contents: `export { Camera } from '${weftSrc}/camera.ts'; export * from '${weftSrc}/math.ts';`, loader: 'ts', resolveDir: root }));
    },
  }],
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const { Gate, GateCamera, setPose, CameraRig, Solids, boxOn, distTo, cameraParams, samplePath } = mod;

let bad = 0, n = 0;
const ok = (cond, what) => { n++; if (!cond) { bad++; console.error('FAIL', what); } };
const near = (a, b, e = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < e);

// a wall door in one world and a turned one in another, a floor and a sky
const a = new Gate({ id: 'a', world: 'A', at: [0, 1.2, -3], normal: [0, 0, 1], radius: 1.1, to: { world: 'B', portal: 'b' } });
const b = new Gate({ id: 'b', world: 'B', at: [4, 2.0, 1], normal: [Math.sin(0.7), 0, Math.cos(0.7)], radius: 1.1, to: { world: 'A', portal: 'a' } });
a.pair(b);
const p = [0.3, -0.7, 2.2];
ok(near(b.through.pt(a.through.pt(p)), p), 'there and back is identity');
ok(near(a.through.pt(a.at), b.at), 'centre to centre');
ok(near(a.through.dir([0, 0, -1]), b.n), 'in at the front of a is out of the front of b');
ok(a.side(p) > 0 && b.side(a.through.pt(p)) < 0, 'in front of a is behind b');
ok(Math.abs(a.through.yawTurn().tilt) < 1e-9, 'two wall doors keep up as up');

const floor = new Gate({ id: 'f', world: 'A', at: [2, 0.01, 1], normal: [0, 1, 0], up: [0, 0, -1], radius: 0.8, to: { world: 'B', portal: 's' } });
const sky = new Gate({ id: 's', world: 'B', at: [-2, 4.4, 1], normal: [0, -1, 0], up: [0, 0, -1], radius: 0.8, to: { world: 'A', portal: 'f' } });
floor.pair(sky);
ok(near(floor.through.dir([0, -1, 0]), [0, -1, 0]), 'falling into the floor, falling out of the sky');

a.open = b.open = 1;
ok(a.crossing([0.2, 1.3, -2], [0.2, 1.3, -4]) !== null, 'through the disc');
ok(a.crossing([2.0, 1.3, -2], [2.0, 1.3, -4]) === null, 'beside the disc');
ok(a.crossing([0.2, 1.3, -2], [0.2, 1.3, -2.5]) === null, 'not as far as the disc');
// walking through in steps that land exactly on the plane: carried once, never straight back
{
  let world = 'A', carry = null, crossings = 0, prev = null;
  for (let k = 0; k <= 40; k++) {
    const z = 0.2 - k * 0.01;                 // the walk in A's coordinates (k = 20 lands on the plane)
    const pA = [0.1, 1.25, a.at[2] + z];
    const p = carry ? carry.pt(pA) : pA;
    if (prev) {
      const g = world === 'A' ? a : b, c = g.crossing(prev, p);
      if (c) { crossings++; world = world === 'A' ? 'B' : 'A'; carry = world === 'B' ? a.through : null; prev = carry ? carry.pt(pA) : pA; continue; }
    }
    // (the walker keeps the last point it had strictly off the plane, as the portals do)
    if (!prev || !(world === 'A' ? a : b).onFace(p)) prev = p;
  }
  ok(crossings === 1 && world === 'B', `stepping onto the plane crosses once (${crossings} crossings, ends in ${world})`);
}
// stopping on the plane and stepping back the way it came is no crossing
{
  const before = [0.1, 1.25, a.at[2] + 0.02], on = [0.1, 1.25, a.at[2]];
  ok(a.crossing(before, on) === null && a.crossing(before, before) === null, 'on the plane is not through it');
}
a.open = 0.3;
ok(a.crossing([0.2, 1.3, -2], [0.2, 1.3, -4]) === null, 'a gate still weaving open is not passable');

// the oblique near plane: a camera behind gate b looking through it at random angles
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (let trial = 0; trial < 200; trial++) {
  const cam = new GateCamera();
  const eye = b.frame.pt([(rnd() - 0.5) * 3, (rnd() - 0.5) * 2, -0.2 - rnd() * 5]);
  const look = b.frame.pt([(rnd() - 0.5) * 2, (rnd() - 0.5) * 2, 3]);
  const f = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], fl = Math.hypot(...f);
  setPose(cam, eye, f.map((x) => x / fl), [0, 1, 0]);
  cam.fovY = 0.5 + rnd();
  cam.clip = [b.n[0], b.n[1], b.n[2], -(b.n[0] * b.at[0] + b.n[1] * b.at[1] + b.n[2] * b.at[2])];
  cam.update(1280, 800);
  const m = cam.viewProj;
  const clip = (q) => [0, 1, 2, 3].map((r) => m[r] * q[0] + m[4 + r] * q[1] + m[8 + r] * q[2] + m[12 + r]);
  for (let k = 0; k < 50; k++) {
    // a point in the frustum at some distance
    const x = (rnd() * 2 - 1) * 0.99, y = (rnd() * 2 - 1) * 0.99, dist = 0.06 + Math.pow(rnd(), 3) * 1000;
    const ty = Math.tan(cam.fovY / 2), tx = ty * 1.6;
    const d = [0, 1, 2].map((i) => cam.forward[i] + cam.right[i] * x * tx + cam.up[i] * y * ty);
    const q = [0, 1, 2].map((i) => cam.position[i] + d[i] * dist);
    const c = clip(q), s = b.side(q);
    if (s > 1e-4) ok(c[2] >= -1e-4 * c[3] && c[2] <= c[3] * (1 + 1e-5), `kept beyond the plane (trial ${trial}, depth ${c[2] / c[3]})`);
    if (s < -1e-4) ok(c[2] > c[3], `cut on the eye's side (trial ${trial})`);
  }
}
// ---------------------------------------------------------------- the camera rig through a gate (engine/camera.ts)
// (the camera's checks say what they measured, passing or not)
const okc = (c, what) => { ok(c, what); console.log(`  ${c ? 'ok' : 'FAIL'}: ${what}`); };
// a joints array (Skeleton.world's layout: 12 floats a joint) for a body standing at (x, z), its hips at y0, moving at v
const body = (x, y0, z, v = [0, 0, 0], scale = 1) => {
  const J = new Float32Array(38 * 12);
  for (let j = 0; j < 38; j++) {
    // a rough figure: the joint's height up the body, arms out a little
    const h = j === 18 || j === 19 ? 0.75 : j >= 20 ? 0.45 : j >= 13 ? 0.35 : j >= 7 ? -0.5 : j >= 1 ? -0.5 : 0;
    const side = j >= 20 && j < 29 ? -0.5 : j >= 29 ? 0.5 : j >= 7 && j < 13 ? 0.15 : j >= 1 && j < 7 ? -0.15 : 0;
    J[j * 12] = x + side * scale; J[j * 12 + 1] = y0 + h * scale * 1.1 + (j === 4 || j === 6 || j === 10 || j === 12 ? -0.35 : 0); J[j * 12 + 2] = z;
    J[j * 12 + 8] = v[0]; J[j * 12 + 9] = v[1]; J[j * 12 + 10] = v[2];
  }
  return J;
};
const input = (dancers, room = 40) => ({ aspect: 1.6, dancers, aimX: 0, aimZ: 0, crowd: 1, ring: false, awake: true, room, maxDist: 14, groundAt: () => 0 });
const stepRig = (rig, n, f, each) => { for (let i = 0; i < n; i++) { each?.(i); rig.update(1 / 60, f(i)); } };

// a follow camera carried with its player through a pair of wall doors: everything moves by the same rigid move
{
  const A = new Gate({ id: 'A', world: 'a', at: [2.9, 1.35, 6], normal: [-0.435, 0, -0.9], radius: 1.25, to: { world: 'b', portal: 'B' } });
  const B = new Gate({ id: 'B', world: 'b', at: [-6.5, 1.35, -5.5], normal: [0.76, 0, 0.65], radius: 1.3, to: { world: 'a', portal: 'A' } });
  A.pair(B); A.open = B.open = 1;
  const rig = new CameraRig();
  // a player walking at 1.8 m/s along A's normal into the door, the camera behind them
  const dirIn = [-A.n[0], 0, -A.n[2]], yaw = Math.atan2(dirIn[0], dirIn[2]);
  let P = [A.at[0] + A.n[0] * 4, 1.1, A.at[2] + A.n[2] * 4], world = 'a', offset = null, rendered = 'a';
  const follow = () => ({ x: P[0], y: P[1], z: P[2], yaw: world === 'a' ? yaw : yaw + Math.atan2(A.through.mat4()[8], A.through.mat4()[10]), speed: 1.8, spread: 0 });
  rig.follow = follow(); rig.yaw = yaw + Math.PI;
  const D = new Float32Array(38 * 12);
  let carriedAt = -1, through = -1, minBoom = Infinity, beside = 0, lastRender = null, jump = 0;
  for (let i = 0; i < 360; i++) {
    const dt = 1 / 60, vel = world === 'a' ? dirIn : A.through.dir(dirIn);
    const next = [P[0] + vel[0] * 1.8 * dt, P[1], P[2] + vel[2] * 1.8 * dt];
    // the player crossing A: carried, and the rig with it (portals.ts carryRig), in the same frame
    if (world === 'a' && A.crossing(P, next, 0.15)) {
      world = 'b'; P = A.through.pt(next); carriedAt = i;
      rig.carry(A.through.mat4());
      offset = A.through.inverse();
      rig.through = { at: [...B.at], n: [...B.n], right: [...B.right], up: [...B.up], reach: B.reach, side: B.side(P) >= 0 ? 1 : -1, t: 0, depth: -1 };
    } else P = next;
    rig.follow = follow();
    const was = [...rig.eye];
    rig.update(dt, input([D], 60));
    // where the view is drawn from (the old world's coordinates until the eye comes through)
    const eyeNow = offset ? offset.pt(rig.eye) : [...rig.eye];
    if (offset) {
      // the eye, in the rig's coordinates, comes through B: the view follows (portals.ts carryCamera)
      if (B.side(was) * B.side(rig.eye) < 0 && i > carriedAt) {
        const c = B.crossing(was, rig.eye);
        if (!c) beside++;
        offset = null; rig.through = null; through = i; rendered = 'b';
      } else {
        // on the old side, the line from the look point to the eye passes through the disc
        const T = rig.look, E = rig.eye, sT = B.side(T), sE = B.side(E);
        if (sT * sE < 0) { const k = sT / (sT - sE), l = B.local([T[0] + (E[0] - T[0]) * k, T[1] + (E[1] - T[1]) * k, T[2] + (E[2] - T[2]) * k]); if (Math.hypot(l[0], l[1]) > B.reach) beside++; }
      }
    }
    if (rendered === 'b') minBoom = Math.min(minBoom, Math.hypot(rig.eye[0] - P[0], rig.eye[2] - P[2]));
    // the drawn eye never jumps (except the one frame its world changes, where it is the same place seen from the other side)
    const drawn = rendered === 'b' && !offset ? [...rig.eye] : eyeNow;
    if (lastRender && i !== through) jump = Math.max(jump, Math.hypot(drawn[0] - lastRender[0], drawn[1] - lastRender[1], drawn[2] - lastRender[2]));
    lastRender = drawn;
  }
  okc(carriedAt > 0, 'the player crossed');
  okc(through > carriedAt && (through - carriedAt) / 60 < 2.5, `the eye comes through the door after its player (${((through - carriedAt) / 60).toFixed(2)} s later)`);
  okc(beside === 0, `the eye's line passes through the disc, never beside it (${beside} frames beside)`);
  okc(jump < 0.2, `the drawn eye moves smoothly (largest step ${jump.toFixed(3)} m a frame)`);
  okc(minBoom > 1.2, `the camera never comes nearer the player than 1.2 m on the far side (${minBoom.toFixed(2)} m)`);
  // and it ends behind the player, looking the way they walk
  const fwd = A.through.dir(dirIn), back = [rig.eye[0] - P[0], rig.eye[2] - P[2]];
  okc(back[0] * fwd[0] + back[1] * fwd[2] < 0, 'the camera ends behind its player in the far world');
}

// a carry is the same rigid move for every point of the rig (target, eye, look) and turns its yaw by the gate's turn
{
  const A = new Gate({ id: 'A', world: 'a', at: [0, 1.2, -3], normal: [0, 0, 1], radius: 1.1, to: { world: 'b', portal: 'B' } });
  const B = new Gate({ id: 'B', world: 'b', at: [4, 1.2, 1], normal: [Math.sin(0.7), 0, Math.cos(0.7)], radius: 1.1, to: { world: 'a', portal: 'A' } });
  A.pair(B);
  const rig = new CameraRig();
  rig.update(1 / 60, input([body(0, 1, 0)]));
  const eye = [...rig.eye], look = [...rig.look], tgt = [...rig.target], yaw = rig.yaw;
  rig.carry(A.through.mat4());
  okc(near(rig.eye, A.through.pt(eye), 1e-5) && near(rig.look, A.through.pt(look), 1e-5) && near(rig.target, A.through.pt(tgt), 1e-5), 'carry moves eye, look and target by the gate');
  const f0 = [look[0] - eye[0], look[2] - eye[2]], f1 = A.through.dir([f0[0], 0, f0[1]]);
  okc(Math.abs(Math.atan2(Math.sin(rig.yaw - yaw - (Math.atan2(f1[0], f1[2]) - Math.atan2(f0[0], f0[1]))), Math.cos(rig.yaw - yaw - (Math.atan2(f1[0], f1[2]) - Math.atan2(f0[0], f0[1]))))) < 1e-6, 'carry turns the orbit by the gate');
}

// a camera never stands behind a disc between it and what it looks at (the portals' clearance)
{
  const G = new Gate({ id: 'G', world: 'a', at: [0, 1.3, 2], normal: [0, 0, -1], radius: 1.2, to: { world: 'b', portal: 'H' } });
  const H = new Gate({ id: 'H', world: 'b', at: [5, 1.3, 0], normal: [1, 0, 0], radius: 1.2, to: { world: 'a', portal: 'G' } });
  G.pair(H); G.open = 1;
  const clear = (a, b) => {
    const sa = G.side(a), sb = G.side(b), m = 0.3;
    if (Math.abs(sa) <= m || ((sa > 0) === (sb > 0) && Math.abs(sb) > m)) return 1;
    const d = Math.abs(sa - sb), k = Math.min(1, Math.abs(sa) / d), l = G.local([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    return Math.hypot(l[0], l[1]) > G.reach + 0.4 ? 1 : Math.max(0, (Math.abs(sa) - m) / d);
  };
  const rig = new CameraRig();
  rig.clearance = clear;
  rig.follow = { x: 0, y: 1.1, z: 0, yaw: Math.PI, speed: 0, spread: 0 };
  rig.yaw = 0; // the eye at +z, behind the disc at z = 2
  let behind = 0;
  stepRig(rig, 120, () => input([body(0, 1, 0)]), () => { rig.follow = { x: 0, y: 1.1, z: 0, yaw: Math.PI, speed: 0, spread: 0 }; rig.lookIdle = 0; });
  for (let i = 0; i < 30; i++) { rig.update(1 / 60, input([body(0, 1, 0)])); if (G.side(rig.eye) < 0.25) behind++; }
  okc(behind === 0, `the follow camera stays in front of a disc behind it (eye ${rig.eye.map((x) => x.toFixed(2))})`);
}

// the locked view: both dancers whole inside the frame, each at least a fifth of its height, through a leap and a
// cartwheel, on a stage seen a little off square-on
{
  const plane = { id: 's', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2, 0], [2, 0]], lens: 20 };
  const rig = new CameraRig();
  rig.lock(plane);
  const project = (p) => {
    const f = [rig.look[0] - rig.eye[0], rig.look[1] - rig.eye[1], rig.look[2] - rig.eye[2]], fl = Math.hypot(...f);
    const fw = f.map((x) => x / fl), r0 = [-fw[2], 0, fw[0]], rl = Math.hypot(...r0), rt = r0.map((x) => x / rl);
    const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
    const q = [p[0] - rig.eye[0], p[1] - rig.eye[1], p[2] - rig.eye[2]], z = q[0] * fw[0] + q[1] * fw[1] + q[2] * fw[2];
    const t = Math.tan((rig.fovNow * Math.PI) / 360);
    return [(q[0] * rt[0] + q[1] * rt[1] + q[2] * rt[2]) / (z * t * 1.6), (q[0] * up[0] + q[1] * up[1] + q[2] * up[2]) / (z * t)];
  };
  let worst = 0, smallest = Infinity;
  const check = (bodies) => {
    for (const J of bodies) {
      let y0 = Infinity, y1 = -Infinity;
      for (let j = 0; j < 38; j++) { const s = project([J[j * 12], J[j * 12 + 1], J[j * 12 + 2]]); worst = Math.max(worst, Math.abs(s[0]), Math.abs(s[1])); y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1]); }
      smallest = Math.min(smallest, (y1 - y0) / 2);
    }
  };
  // standing on far ledges, then one leaps (2 m up at 6 m/s) and one cartwheels (hands to the floor, feet up)
  stepRig(rig, 120, () => input([body(-4.6, 2.1, 0), body(4.6, 1.0, 0)], 9));
  check([body(-4.6, 2.1, 0), body(4.6, 1.0, 0)]);
  for (let i = 0; i < 60; i++) {
    const t = i / 60, y = 1.0 + 6 * t - 4.9 * t * t * 1.2, vy = 6 - 9.8 * 1.2 * t;
    const a = body(-4.6, 2.1, 0, [0, 0, 0]), b = body(4.6 - t * 0.5, y, 0, [-0.5, vy, 0]);
    // the cartwheel: the first dancer's body turned upside down half way
    if (i > 20 && i < 45) for (let j = 0; j < 38; j++) a[j * 12 + 1] = 2.1 + 2.2 - (a[j * 12 + 1] - 2.1 + 0.9);
    rig.update(1 / 60, input([a, b], 9));
    check([a, b]);
  }
  okc(worst <= 1, `locked: every joint of both dancers stays inside the frame (furthest ${worst.toFixed(2)} of 1)`);
  okc(smallest >= 0.2, `locked: each dancer is at least a fifth of the frame's height (smallest ${smallest.toFixed(2)})`);
}

// ---------------------------------------------------------------- the camera and the world's solids (7-cameras.md)
// the critic's orbit (a follow camera at 8 m, turned at 0.52 rad/s) round two dancers in a court of columns, under a
// shelf, by a log, over water: the eye never inside a solid, never a jump
{
  const solids = new Solids([
    // a ring of columns at 3 to 6 m, a fallen log, a low shelf (a tipped box), a lantern
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = k * 0.785 + 0.3, r = 3 + (k % 3); return { kind: 'capsule', a: [Math.sin(a) * r, 0.5, Math.cos(a) * r], b: [Math.sin(a) * r, 4.5, Math.cos(a) * r], r: 0.5 }; }),
    { kind: 'capsule', a: [-6, 0.6, -2], b: [-2.5, 0.6, -5], r: 0.8 },
    boxOn([1.5, 1.6, -4], [3, 0.5, 2.5], 0.4, 0.1),
    { kind: 'capsule', a: [2.2, 2.6, 2.2], b: [2.2, 2.6, 2.2], r: 0.5 },
  ]);
  const rig = new CameraRig();
  rig.solids = solids;
  rig.waterY = 0.1;
  const dancers = [body(-0.8, 1, 0.3), body(0.8, 1, 0.3)];
  let inside = 0, minD = Infinity, jump = 0, low = Infinity, prev = null, pulled = 0;
  for (let i = 0; i < 60 * 12; i++) {
    const t = i / 60;
    rig.follow = { x: 0, y: 0.95, z: 0.3, yaw: 0, speed: 0, spread: 1.6 };
    rig.yaw = t * 0.52; rig.lookIdle = 0;
    cameraParams.followDist = 8; cameraParams.followPitch = 0.18;
    rig.update(1 / 60, input(dancers, 40));
    const d = Math.min(...solids.list.map((s) => distTo(s, rig.eye)));
    minD = Math.min(minD, d);
    if (d < 0.05) inside++;
    if (Math.hypot(rig.eye[0], rig.eye[2]) < 6) pulled++;
    low = Math.min(low, rig.eye[1] - 0.1);
    if (prev && i > 60) { const s = Math.hypot(rig.eye[0] - prev[0], rig.eye[1] - prev[1], rig.eye[2] - prev[2]); if (s > 0.2) console.log("    step", i, s.toFixed(3)); jump = Math.max(jump, s); }
    prev = [...rig.eye];
  }
  cameraParams.followDist = 4.6; cameraParams.followPitch = 0.22;
  okc(inside === 0, `orbit at 8 m through a court of columns: the eye never inside a solid (nearest ${minD.toFixed(2)} m from a surface)`);
  okc(minD > 0.15, `the eye keeps at least 15 cm from every surface (${minD.toFixed(2)} m)`);
  okc(jump < 0.2, `the eye moves smoothly while the boom comes in and out (largest step ${jump.toFixed(3)} m a frame; the orbit alone moves 0.07, the boom at most 0.08 more)`);
  okc(low >= 0.24, `the eye stays 25 cm above the water (lowest ${(low).toFixed(2)} m above it)`);
  okc(pulled > 0, `the boom came in for the columns (${(pulled / 60).toFixed(1)} s of 12 nearer than 6 m)`);
}

// a dancer standing on a slab (the forge's crown): the boom rising away from it is not pinned by the slab underfoot,
// one going down through it is
{
  const S = new Solids([boxOn([0, 2.6, 0], [2.6, 0.5, 1.7])]);
  const T = [0, 3.9, 0.3], up = S.sweep(T, [0, 5.3, 8.2], 0.5), down = S.sweep(T, [0.5, 1.0, 1.0], 0.5);
  okc(up === 1 && down < 0.5, `standing on a slab: a boom rising away is clear (${up.toFixed(2)}), one down through it is not (${down.toFixed(2)})`);
}

// the locked view sees past a column: one standing between the stage's own angle and the dancers turns the view
{
  const plane = { id: 's', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2, 0], [2, 0]], lens: 20, yaw: 0.1 };
  const dancers = [body(-0.6, 1, 0), body(0.9, 1, 0)];
  const rig = new CameraRig();
  rig.lock(plane);
  stepRig(rig, 240, () => input(dancers, 30));   // (all the way locked first)
  // a column on the line from the stage's own eye to the middle of the two, 4 m out
  const e = rig.eye, c = [0.15, 1, 0], k = 4 / Math.hypot(e[0] - c[0], e[2] - c[2]);
  const col = { kind: 'capsule', a: [c[0] + (e[0] - c[0]) * k, 0.3, c[2] + (e[2] - c[2]) * k], b: [c[0] + (e[0] - c[0]) * k, 3.5, c[2] + (e[2] - c[2]) * k], r: 0.45 };
  rig.solids = new Solids([col]);
  const sees = () => {
    let n = 0;
    for (const J of dancers) for (const j of [0, 3, 9, 15, 18]) if (rig.solids.sweep([J[j * 12], J[j * 12 + 1], J[j * 12 + 2]], rig.eye, 0.05) < 0.98) n++;
    return n;
  };
  rig.update(1 / 60, input(dancers, 30));
  const before = sees();
  stepRig(rig, 180, () => input(dancers, 30));
  okc(before > 0 && sees() === 0, `locked: a column across the dancers (${before} of 10 sight lines) is seen past by turning ${rig.dodge.toFixed(2)} rad (${sees()} blocked after 3 s)`);
  okc(Math.abs(rig.dodge) <= 0.41, `locked: the turn stays within lockDodge (${rig.dodge.toFixed(2)} rad)`);
  rig.solids = null;
  stepRig(rig, 300, () => input(dancers, 30));
  okc(Math.abs(rig.dodge) < 0.02, `locked: with the column gone it turns back to the stage's own angle (${rig.dodge.toFixed(3)})`);
}

// a scripted player holding the stick one way walks a straight line through a gate, with the follow camera swinging
// onto the gate and round behind them (stickYaw), where reading the stick in the camera's live turn curves the walk
{
  const walk = (steady) => {
    const rig = new CameraRig(), speed = 1.8, dt = 1 / 60;
    let P = [1.5, 0, 6], heading = 0, maxOff = 0;
    rig.yaw = 0.9;   // the camera starts off to one side of the walk
    // the player faces -z, the gate's disc at z = 0 facing +z; the stick held "into the screen" from the start
    const stickYaw0 = rig.yaw;
    for (let i = 0; i < 300; i++) {
      const sy = steady ? rig.stickYaw(0, 0, 1) : rig.yaw;
      // Character._moveVec: the stick (0, moveZ 1) read in the turn sy
      const z = -1, dir = [z * Math.sin(sy), z * Math.cos(sy)];
      P = [P[0] + dir[0] * speed * dt, 0, P[2] + dir[1] * speed * dt];
      heading = Math.atan2(dir[0], dir[1]);
      rig.follow = { x: P[0], y: 1.05, z: P[2], yaw: heading, speed, spread: 0 };
      rig.approach = P[2] > -0.5 ? { at: [0.9, 1.3, 0], n: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], reach: 1.2, side: 1, w: Math.min(1, Math.max(0, (4.5 - P[2]) / 3)) } : null;
      rig.update(dt, input([body(P[0], 1, P[2])], 40));
      // how far off the line it started on (straight along the turn the stick was first read in)
      const along = [-Math.sin(stickYaw0), -Math.cos(stickYaw0)], q = [P[0] - 1.5, P[2] - 6];
      maxOff = Math.max(maxOff, Math.abs(q[0] * along[1] - q[1] * along[0]));
    }
    return { maxOff, behind: Math.cos(rig.yaw - (heading + Math.PI)) };
  };
  const steady = walk(true), live = walk(false);
  okc(steady.maxOff < 0.01, `the stick held one way walks a straight line (${steady.maxOff.toFixed(3)} m off it over 5 s; read in the live camera turn: ${live.maxOff.toFixed(2)} m)`);
  okc(steady.behind > 0.95, `and the follow camera ends behind the player (cos ${steady.behind.toFixed(2)})`);
}

// a camera path: keys in the pair's space, blended in from the follow camera, held, released back to it, no jumps
{
  const rig = new CameraRig();
  const dancers = [body(-1, 1, 0), body(1, 1, 0)];
  const f = () => input(dancers, 40);
  rig.follow = { x: 0, y: 1, z: 0, yaw: 0, speed: 0, spread: 2 };
  stepRig(rig, 60, f);
  const path = { space: { pair: true }, blendIn: 1, blendOut: 1, lag: 0, keys: [
    { t: 0, orbit: [0.2, 0.15, 5], at: [0, 1, 0], fov: 40 },
    { t: 2, orbit: [1.2, 0.3, 4], at: [0, 1.1, 0] },
    { t: 4, orbit: [2.0, 0.1, 6], at: [0, 1, 0], fov: 30, roll: 0.05, focus: 5.5 },
  ] };
  rig.play(path);
  let jump = 0, prev = [...rig.eye];
  const step = (n) => { for (let i = 0; i < n; i++) { rig.update(1 / 60, f()); jump = Math.max(jump, Math.hypot(rig.eye[0] - prev[0], rig.eye[1] - prev[1], rig.eye[2] - prev[2])); prev = [...rig.eye]; } };
  step(Math.round(60 * 2));   // t = 2: the second key (the pair's space is the world's here: +x toward dancer 1)
  const want = [Math.sin(1.2) * Math.cos(0.3) * 4, 1.1 + Math.sin(0.3) * 4, Math.cos(1.2) * Math.cos(0.3) * 4];
  okc(near(rig.eye, want, 0.02), `path: at its second key the eye is where the key says (${rig.eye.map((x) => x.toFixed(2))})`);
  step(Math.round(60 * 2.5));
  okc(rig.path?.done && Math.abs(rig.fovNow - 30) < 1e-3 && Math.abs(rig.focus - 5.5) < 1e-3, `path: held at its last key (lens ${rig.fovNow.toFixed(1)}, focus ${rig.focus.toFixed(2)})`);
  rig.release();
  step(90);
  okc(rig.path === null && Math.abs(rig.fovNow - cameraParams.followFov) < 1e-3, 'path: released, the rig is its own again');
  okc(jump < 0.25, `path: in, along and out without a jump (largest step ${jump.toFixed(3)} m a frame)`);
  // samplePath alone: a stop key is passed at rest, the ends are held
  const s = (t) => samplePath({ keys: [{ t: 0, eye: [0, 1, 0] }, { t: 1, eye: [1, 1, 0], stop: true }, { t: 2, eye: [3, 1, 0] }] }, t).eye[0];
  okc(Math.abs(s(1.001) - s(0.999)) < 1e-4 && s(-1) === 0 && s(9) === 3, 'path: a stop key is passed at rest; before and after the keys it holds');
}
console.log(bad ? `${bad} of ${n} gate checks failed` : `gates check (${n} checks)`);
process.exit(bad ? 1 : 0);

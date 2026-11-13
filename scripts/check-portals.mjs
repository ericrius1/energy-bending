// node scripts/check-portals.mjs: the gates' algebra and the oblique near plane, in plain Node (no GPU). It bundles
// src/portals/gate.ts and src/portals/camera.ts with esbuild (Vite's own), with weft's Camera and math taken from
// its source (the rest of weft wants a GPU), and checks:
//   - a pair's two moves undo each other; the centre goes to the partner's centre; in at one front is out of the other
//   - a point in front of one disc is behind the other (where the camera behind a live gate stands)
//   - a floor gate paired with a sky gate keeps down as down (you fall out of the sky)
//   - crossing: through the disc yes, beside it no, a closed gate no
//   - the oblique projection keeps exactly the far side of the plane (0 ≤ z ≤ w there, z > w on the near side) and
//     never puts anything in the frustum past the far plane (z ≥ 0 out to a kilometre)
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const weftSrc = join(root, 'node_modules/@ericrius1/weft/src').replace(/\\/g, '/');
const out = await build({
  stdin: { contents: "export * from './src/portals/gate'; export * from './src/portals/camera'; export * from './src/portals/rigid';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', write: false, platform: 'node',
  plugins: [{
    name: 'weft-cpu', setup(b) {
      b.onResolve({ filter: /^@ericrius1\/weft$/ }, () => ({ path: 'weft-cpu', namespace: 'weft-cpu' }));
      b.onLoad({ filter: /.*/, namespace: 'weft-cpu' }, () => ({ contents: `export { Camera } from '${weftSrc}/camera.ts'; export * from '${weftSrc}/math.ts';`, loader: 'ts', resolveDir: root }));
    },
  }],
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const { Gate, GateCamera, setPose } = mod;

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
console.log(bad ? `${bad} of ${n} gate checks failed` : `gates check (${n} checks)`);
process.exit(bad ? 1 : 0);

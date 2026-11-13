// The film camera keeps clear of the bodies (film 2 went through a dancer three times: a full-frame flame, a white-out;
// film 1's fusion orbit ended inside the aurora's column): an eye on a dancer's bone is pushed out to `near`, the push is
// eased (no jump from one frame to the next), an eye already clear is left alone, a fusion's column counts like a bone,
// and `near: 0` lets the eye in.
import { test, assert, done } from '../dancer/test/check';
import { FilmCamera, clearOfBodies, type Capsule, type FilmScene, type V3 } from './filmcam';

const dist = (p: V3, c: Capsule) => {
  const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const u = Math.max(0, Math.min(1, ((p[0] - c.a[0]) * ab[0] + (p[1] - c.a[1]) * ab[1] + (p[2] - c.a[2]) * ab[2]) / L));
  return Math.hypot(p[0] - c.a[0] - ab[0] * u, p[1] - c.a[1] - ab[1] * u, p[2] - c.a[2] - ab[2] * u) - c.r;
};
/** a standing dancer at (x, z): a spine from the hips to the head */
const dancer = (x: number, z: number): Capsule => ({ a: [x, 0.9, z], b: [x, 1.7, z], r: 0.15 });

test('an eye on a dancer is pushed out to near; a clear eye stays', () => {
  const body = dancer(0, 2);
  const eye: V3 = [0.3, 1.2, 2.2], look: V3 = [0, 1, 0];
  const P = clearOfBodies(eye, look, [body], 1.2);
  const out: V3 = [eye[0] + P[0], eye[1] + P[1], eye[2] + P[2]];
  assert(Math.abs(dist(out, body) - 1.2) < 1e-3, `pushed to ${dist(out, body).toFixed(3)} m, want 1.2`);
  const clear = clearOfBodies([0, 1.2, 6], look, [body], 1.2);
  assert(Math.hypot(...clear) === 0, 'a clear eye moved');
  const off = clearOfBodies(eye, look, [body], 0);
  assert(Math.hypot(...off) === 0, 'near 0 still pushed');
});

test('two bodies either side: the push settles clear of both', () => {
  const caps = [dancer(-0.9, 3), dancer(0.9, 3)];
  const eye: V3 = [0.1, 1.3, 3.1];
  const P = clearOfBodies(eye, [0, 1, 0], caps, 1.0);
  const out: V3 = [eye[0] + P[0], eye[1] + P[1], eye[2] + P[2]];
  for (const c of caps) assert(dist(out, c) > 0.98, `${dist(out, c).toFixed(3)} m from a body`);
});

test('a camera orbiting through a dancer never comes within near, and never jumps', () => {
  // the eye's path passes straight through the dancer at (0, 3); the camera eases its push in and out
  const body = dancer(0, 3);
  const cam = new FilmCamera([{ t: 0, around: [0, 0, 0], yaw: -0.6, pitch: 0.1, dist: 3, height: 1.3, lag: 0 }, { t: 4, yaw: 0.6, ease: 'linear' }]);
  const scene: FilmScene = { anchor: () => [0, 0, 0], rig: { eye: [0, 0, 0], look: [0, 0, 0], fov: 38, focus: 5 }, bodies: () => [body], aspect: 16 / 9 };
  let worst = 9, prev: V3 | null = null, jump = 0;
  for (let i = 0; i <= 240; i++) {
    const p = cam.update(i / 60, 1 / 60, scene);
    worst = Math.min(worst, dist(p.eye, body));
    if (prev) jump = Math.max(jump, Math.hypot(p.eye[0] - prev[0], p.eye[1] - prev[1], p.eye[2] - prev[2]));
    prev = [...p.eye];
  }
  // (the push eases in at 7/s, so it lags a fast approach by a little: well clear of the body all the same)
  assert(worst > 0.8, `came within ${worst.toFixed(2)} m of the body`);
  assert(jump < 0.12, `the eye jumped ${jump.toFixed(3)} m in a frame`);
});

done();

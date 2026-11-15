// The fused finale's bloom (bloom.ts, report 18), checked without a GPU: nothing in a finale that didn't fuse; the
// vines grow with the lift and the flower opens on the page's clock; the flower stands over the flyer's head on
// screen and below the HUD's top; the whole bloom is a few hundred glows; and it is gone after the banner.
import { test, assert, done } from '../dancer/test/check';
import { BLOOM, bloomFade, drawBloom, flowerAt } from './bloom';
import { Glows } from '../play/glow';
import type { FinaleLook } from './finale';

type V3 = [number, number, number];
const look = (u: number, t = u * 2.1, fused = true): FinaleLook => ({ fused, u, t, len: 2.1, base: 0, flyer: 1, fuse: 1, bloom: 0 });
const eye: V3 = [0, 2.6, -6];
/** a column-major view-projection looking from `eye` at [0, 1.6, 0] (60° lens, 16:9) */
function viewProj(): number[] {
  const at: V3 = [0, 1.6, 0], f = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]], fl = Math.hypot(...f);
  const F = f.map((x) => x / fl), R = [-F[2], 0, F[0]], rl = Math.hypot(...R), Rn = R.map((x) => x / rl);
  const U = [Rn[1] * F[2] - Rn[2] * F[1], Rn[2] * F[0] - Rn[0] * F[2], Rn[0] * F[1] - Rn[1] * F[0]];
  const dot = (a: number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = [Rn[0], U[0], -F[0], 0, Rn[1], U[1], -F[1], 0, Rn[2], U[2], -F[2], 0, -dot(Rn, eye), -dot(U, eye), dot(F, eye), 1];
  const t = 1 / Math.tan(Math.PI / 6), a = 16 / 9, n = 0.1;
  // (reversed infinite: clip w is the distance in front)
  const proj = [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, 0, -1, 0, 0, n, 0];
  const m = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) m[c * 4 + r] += proj[k * 4 + r] * view[c * 4 + k];
  return m;
}
const onScreen = (m: number[], p: V3) => { const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]; return [((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w) * 0.5 + 0.5, 0.5 - ((m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w) * 0.5]; };

test('a finale that did not fuse has no bloom', () => {
  const G = new Glows();
  assert(drawBloom(G, { look: look(0.6, 1.3, false), open: 0.5, foot: [0, 0, 0], eye, ca: [1, 0.4, 0.8], cb: [0.4, 1.5, 0.7], t: 1 }) === 0, 'glows drawn');
});

test('the vines grow with the lift, the flower opens after it, and it stays a few hundred glows', () => {
  const at = (u: number, open: number) => { const G = new Glows(); return drawBloom(G, { look: look(u), open, foot: [0, 0, 0], eye, ca: [1, 0.4, 0.8], cb: [0.4, 1.5, 0.7], t: u * 2 }); };
  const a = at(0.1, -1), b = at(0.4, -1), c = at(0.6, 0.1), d = at(0.9, 1.2);
  assert(a < b && b < d, `the bloom grows: ${a}, ${b}, ${c}, ${d}`);
  assert(d < 700, `${d} glows open`);
});

test('the flower stands over the flyer\'s head on screen, below the HUD\'s top', () => {
  const vp = viewProj(), head: V3 = [0, 2.9, 0], C = flowerAt([0, 0, 0], head, eye, vp);
  const h = onScreen(vp, head), c = onScreen(vp, C);
  assert(c[1] < h[1] - 0.05, `heart at ${c[1].toFixed(2)}, head at ${h[1].toFixed(2)}`);
  // (below the HUD's top, unless keeping MIN_UP over the head takes it higher: phase 6's flower is over the whole stage)
  assert(c[1] >= BLOOM.SCREEN_TOP - 0.01 || C[1] - head[1] <= BLOOM.MIN_UP + 1e-6, `heart at ${c[1].toFixed(2)} of the screen`);
  assert(C[1] - head[1] >= BLOOM.MIN_UP - 1e-6 && C[1] - head[1] <= BLOOM.UP + 1e-6, `${(C[1] - head[1]).toFixed(2)} m over the head`);
});

test('the bloom is gone after the banner', () => {
  assert(bloomFade(look(1, 2.1 + BLOOM.HOLD_S + BLOOM.FADE_S + 0.1)) < 0.01, 'still showing');
  assert(bloomFade(look(1, 2.1 + 0.5)) > 0.99, 'gone too soon');
});

done();

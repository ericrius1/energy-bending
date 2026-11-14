// The duel's movement kit as poses (docs/design/duel.md): the lean into a wall while sliding down it, and the dash's
// lunge. Like LOCO's in moves.ts: 39 floats (13 landmarks, metres, the dancer's own frame: its left at +x, z forward),
// solved with the body rig `rig` from keyframes in the prototype's figure units and frame (its own right at +x). The
// Character (character.ts) blends them over the locomotion while it slides (Character.wallW) or dashes (dashW). Pure.
//
//   wallPose(out, hand)   facing the wall a body's width ahead: crouched, knees up, one sole and one hand on it (hand
//                         +1 the own right, -1 the left: the one toward the camera), the other arm out for balance
//   dashPose(out, up)     the lunge along the facing, low and stretched (up 0); up +1 stretched upward, arms overhead;
//                         -1 tucked, falling on its target; between, a blend (a diagonal dash is about ±0.7)
import { rig, J, NJ, NP, type RigParams } from './moves';

type V = number[];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** the wall: a body's half width (0.2 m) ahead along the plane, through the locked view's turn toward the camera
 *  (PHYS.viewOpen, 0.45 rad): 0.22 m along the facing, in figure units */
const WALL_Z = 0.22 / 2.296;

const WALL: RigParams = {
  hip: [0, 0.24, -0.03], pitch: 0.3, crunch: 0.9, twist: 0.12, roll: 0.04,
  rh: [0.07, 0.52, WALL_Z], lh: [-0.22, 0.3, -0.06],
  rf: [0.08, 0.15, WALL_Z - 0.005], lf: [-0.09, 0.04, 0.02],
  rkp: [0.45, 0.25, 1], lkp: [-0.3, 0, 1], rep: [0.6, -0.4, -0.2],
};
const LUNGE: RigParams = {
  hip: [0, 0.22, 0], pitch: 0.95, crunch: 1, twist: 0.18,
  rh: [0.1, 0.33, 0.38], lh: [-0.14, 0.27, -0.22],
  rf: [0.09, 0.07, 0.17], lf: [-0.07, 0.1, -0.32],
};
const UP: RigParams = {
  hip: [0, 0.32, 0], pitch: -0.08,
  rh: [0.07, 0.86, 0.06], lh: [-0.07, 0.84, 0.04],
  rf: [0.05, 0, -0.03], lf: [-0.05, 0.06, -0.08],
};
const DOWN: RigParams = {
  hip: [0, 0.34, 0], pitch: 0.5, crunch: 0.92,
  rh: [0.1, 0.3, 0.25], lh: [-0.1, 0.28, 0.2],
  rf: [0.08, 0.2, 0.16], lf: [-0.08, 0.16, 0.08],
};

const PAIRS: [number, number][] = [[J.LS, J.RS], [J.LE, J.RE], [J.LW, J.RW], [J.LH, J.RH], [J.LK, J.RK], [J.LA, J.RA]];
/** a pose mirrored across the body's middle (its left for its right) */
export function mirrorPose(p: Float32Array) {
  for (const [a, b] of PAIRS) for (let k = 0; k < 3; k++) { const t = p[3 * a + k]; p[3 * a + k] = p[3 * b + k]; p[3 * b + k] = t; }
  for (let j = 0; j < NJ; j++) p[3 * j] = -p[3 * j];
  return p;
}

const _wall = new Float32Array(NP);
const _wallM = new Float32Array(NP);
let _wallReady = false;
export function wallPose(out: Float32Array, hand: number) {
  if (!_wallReady) { rig(WALL, _wall); _wallM.set(_wall); mirrorPose(_wallM); _wallReady = true; }
  out.set(hand < 0 ? _wallM : _wall);
  return out;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixV = (a: V, b: V, t: number): V => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
/** keyframes blended as parameters (so the limbs stay their lengths), then solved */
function blend(A: RigParams, B: RigParams, t: number): RigParams {
  const o: RigParams = { hip: mixV(A.hip, B.hip, t) };
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (k === 'hip') continue;
    const a = A[k] ?? B[k], b = B[k] ?? A[k];
    o[k] = typeof a === 'number' ? mix(a, b as number, t) : mixV(a as V, b as V, t);
  }
  return o;
}
export function dashPose(out: Float32Array, up: number) {
  up = clamp(up, -1, 1);
  const k = Math.min(1, Math.abs(up) * 1.15);
  rig(blend(LUNGE, up >= 0 ? UP : DOWN, k), out);
  return out;
}

// The director's shots from Gem Dancers: named framings the free camera eases to when nobody is moving it (its idle
// behaviour). A programme (dancer/programme.ts) picks the shot; the camera rig (engine/camera.ts) does the easing.
// And camera paths: shots written as keyframes, which the rig plays over whatever it is doing (below).
import type { StagePlane } from './camera';

export type Shot = 'heap' | 'wide' | 'close' | 'low' | 'high' | 'overhead' | 'crown' | 'orbit' | 'feet' | 'canopy';

/** a framing: distance (m), pitch (rad, up is positive), the height it looks at (m), how fast it drifts round (rad/s),
 *  field of view (degrees, top to bottom) */
export interface Framing { dist: number; pitch: number; height: number; drift: number; fov: number }

export const SHOTS: Record<Shot, Framing> = {
  heap: { dist: 3.7, pitch: 0.3, height: 0.62, drift: 0.035, fov: 36 },
  wide: { dist: 5.4, pitch: 0.15, height: 1.0, drift: 0.04, fov: 38 },
  close: { dist: 2.5, pitch: 0.08, height: 1.25, drift: 0.035, fov: 32 },
  low: { dist: 3.5, pitch: -0.06, height: 0.95, drift: -0.055, fov: 42 },
  high: { dist: 4.8, pitch: 0.62, height: 0.7, drift: 0.035, fov: 38 },
  // (both stay under the geode's roof, 8.5 m up)
  overhead: { dist: 7.4, pitch: 1.47, height: 0.3, drift: 0.06, fov: 48 },
  crown: { dist: 7.2, pitch: 0.82, height: 0.4, drift: -0.05, fov: 44 },
  orbit: { dist: 3.8, pitch: 0.2, height: 1.0, drift: 0.2, fov: 38 },
  feet: { dist: 2.5, pitch: 0.03, height: 0.38, drift: 0.05, fov: 36 },
  // (in the redwoods) back in the meadow, looking up the trunks into the light
  canopy: { dist: 7.6, pitch: -0.5, height: 5.6, drift: 0.022, fov: 56 },
};

/** which joints a shot keeps in frame on a tall screen (indices into the CMU rig: hips, feet, toes, head, elbows,
 *  hands, fingertips; a close shot the body; a shot of the feet the feet) */
export const FIT_ALL = [0, 4, 6, 10, 12, 19, 22, 23, 26, 31, 32, 35];
export const FIT_CLOSE = [0, 15, 19, 21, 22, 30, 31];
export const FIT_FEET = [0, 4, 6, 10, 12];
export const fitSetOf = (s: Shot) => (s === 'close' ? FIT_CLOSE : s === 'feet' ? FIT_FEET : FIT_ALL);

// ---------------------------------------------------------------- camera paths
// A camera path is a shot written down as keyframes in the rig's own terms (docs/extending/camera.md): where the eye is
// (a position, or an orbit about the point looked at), the point looked at, the lens, the roll, the distance in focus,
// in a space (the world, a dancer, the pair, a stage) resolved every frame. The rig plays it (CameraRig.play), blending
// in from and back out to whatever it was doing (free, follow, locked); collision avoidance is the path's choice.
// Between keys every channel runs on a cubic through its neighbours (Catmull-Rom tangents over the keys' own times), so
// the camera moves without corners; a key marked `stop` (and, unless told otherwise, the first and the last) is
// arrived at and left from rest.

type V3 = [number, number, number];

/** where a path's keys are measured from, resolved every frame (eased by the path's `lag`):
 *  'world': the rig's world coordinates (carried with the rig through a gate);
 *  { dancer: i, turn? }: the ground under dancer i's hips (i indexes the rig's framed dancers: the seats, in order),
 *    turned with the way they face when `turn` (+z ahead of them, +x to their left);
 *  { pair: true }: the ground under the middle of dancers 0 and 1, +x toward dancer 1 (and +z as the world's is to its +x);
 *  { stage }: a stage plane (or the locked one: `stage: true`), +x along its right, y up from its origin, +z toward the
 *    side the locked camera stands on */
export type PathSpace = 'world' | { dancer: number; turn?: boolean } | { pair: true } | { stage: true | StagePlane };

/** a key: its time (s from the path's start), and any of the pose's channels (one left out holds its neighbours') */
export interface PathKey {
  t: number;
  /** the eye in the path's space (m) */
  eye?: V3;
  /** or the eye as an orbit about `at`: [yaw, pitch, distance], the rig's own convention (yaw 0: the eye at +z of what
   *  it looks at, positive turning it toward +x; pitch up is positive) */
  orbit?: [number, number, number];
  /** the point looked at, in the path's space (default [0, 1, 0]: about a dancer's chest over the origin) */
  at?: V3;
  /** the lens (degrees, top to bottom); left out on every key: the rig's */
  fov?: number;
  /** the roll (rad; positive turns the picture counter-clockwise) */
  roll?: number;
  /** the distance in focus (m); left out on every key: the distance to `at` */
  focus?: number;
  /** arrive here and leave from rest (the first and the last key do unless this says false) */
  stop?: boolean;
}

export interface CameraPath {
  keys: PathKey[];
  space?: PathSpace;
  /** seconds to blend in from the rig's own pose (0: a cut; default 1) and back out when released (default 1) */
  blendIn?: number;
  blendOut?: number;
  /** keep the eye out of the world's solids (pulled in along the line to `at`, eased), above the ground and water */
  avoid?: boolean;
  /** after the last key: 'hold' it (default) until released, 'release' (blend back to the rig), or 'loop' */
  end?: 'hold' | 'release' | 'loop';
  /** seconds the space's origin and turn lag behind what they follow (a dancer's hips bob; default 0.25; 0: exact) */
  lag?: number;
}

/** a path's pose at time t, in its own space; a null channel is the rig's */
export interface PathPose { eye: V3; look: V3; fov: number | null; roll: number; focus: number | null }

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** the pose of a path at time t (held at its first and last keys), in the path's space */
export function samplePath(path: CameraPath, t: number): PathPose {
  const K = path.keys, n = K.length;
  const orbit = K.some((k) => k.orbit) && K.every((k) => k.orbit || !k.eye);
  // each key's channel, a missing one filled from the nearest key before it that has it (then after)
  const fill = <T>(get: (k: PathKey) => T | undefined, dflt: T): T[] => {
    const out: (T | undefined)[] = K.map(get);
    let last: T | undefined;
    for (let i = 0; i < n; i++) { if (out[i] === undefined) out[i] = last; else last = out[i]; }
    last = undefined;
    for (let i = n - 1; i >= 0; i--) { if (out[i] === undefined) out[i] = last; else last = out[i]; }
    return out.map((v) => (v === undefined ? dflt : v));
  };
  const at = fill((k) => k.at, [0, 1, 0] as V3);
  const chans: number[][] = [];
  if (orbit) {
    const o = fill((k) => k.orbit, [0, 0.2, 4] as [number, number, number]);
    // (the yaw unwrapped key to key: a path turns the short way between two keys)
    const yaw = [o[0][0]];
    for (let i = 1; i < n; i++) yaw.push(yaw[i - 1] + wrapA(o[i][0] - o[i - 1][0]));
    chans.push(yaw, o.map((v) => v[1]), o.map((v) => v[2]));
  } else {
    // (a path that mixes the two takes each orbit key's eye where its own `at` puts it)
    const e = fill((k) => k.eye ?? (k.orbit ? orbitEye(at[K.indexOf(k)], k.orbit) : undefined), [0, 1.5, 5] as V3);
    chans.push(e.map((v) => v[0]), e.map((v) => v[1]), e.map((v) => v[2]));
  }
  chans.push(at.map((v) => v[0]), at.map((v) => v[1]), at.map((v) => v[2]));
  chans.push(fill((k) => k.fov, 40), fill((k) => k.roll, 0), fill((k) => k.focus, 0));
  const v = chans.map((c) => hermite(K, c, t));
  const look: V3 = [v[3], v[4], v[5]];
  const eye: V3 = orbit ? orbitEye(look, [v[0], v[1], v[2]]) : [v[0], v[1], v[2]];
  return { eye, look, fov: K.some((k) => k.fov !== undefined) ? v[6] : null, roll: v[7], focus: K.some((k) => k.focus !== undefined) ? v[8] : null };
}

/** the eye of an orbit [yaw, pitch, distance] about `at` */
export function orbitEye(at: V3, [yaw, pitch, dist]: [number, number, number]): V3 {
  const cp = Math.cos(pitch);
  return [at[0] + Math.sin(yaw) * cp * dist, at[1] + Math.sin(pitch) * dist, at[2] + Math.cos(yaw) * cp * dist];
}

/** one channel at time t: a cubic Hermite between the keys either side, with Catmull-Rom tangents over the keys' times
 *  (zero at a stop) */
function hermite(K: PathKey[], v: number[], t: number) {
  const n = K.length;
  if (n === 1 || t <= K[0].t) return v[0];
  if (t >= K[n - 1].t) return v[n - 1];
  let i = 0;
  while (i < n - 2 && t > K[i + 1].t) i++;
  const t0 = K[i].t, h = Math.max(1e-6, K[i + 1].t - t0), u = (t - t0) / h;
  const tan = (j: number) => {
    if (K[j].stop ?? (j === 0 || j === n - 1)) return 0;
    const a = Math.max(0, j - 1), b = Math.min(n - 1, j + 1);
    return (v[b] - v[a]) / Math.max(1e-6, K[b].t - K[a].t);
  };
  const m0 = tan(i) * h, m1 = tan(i + 1) * h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v[i] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v[i + 1] + (u3 - u2) * m1;
}

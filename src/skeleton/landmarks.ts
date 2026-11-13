// Landmarks: the light description of a body that procedural moves, camera tracking and the network all speak.
// Thirteen points in 3D, in the order of the 2D prototype's `J` (sketches/dance-first-2d/js/moves.js): head, then
// left and right shoulder, elbow, wrist, hip, knee, ankle. 39 floats.
//
// A LandmarkPose is those points in the dancer's own frame (metres; x across the body, y up, z forward; the origin
// is the ground under the hips), plus where that origin is in the world and which way the body faces (yaw: forward is
// (sin yaw, 0, cos yaw)). So world = root + Ry(yaw) · local, a rotation, never a mirror.
//
// Handedness: here "left" is the dancer's own left, which for a body facing +z is +x (the world is right-handed, y
// up). The 2D prototype puts its L joints at -x (screen left for a figure facing the viewer), so a pose from it is
// mirrored relative to this one: negate x (or swap L and R) when porting its moves. See docs/reports/0-foundation.md.
//
// `extra` carries six optional points a camera tracker has (ears, index knuckles, toes); the retargeter
// (skeleton/retarget.ts) uses them for the head's, hands' and feet's turn when they are there.
import { vec3, type Vec3 } from 'math';
import { JOINT, type Skeleton } from './rig';

export const LM = { HEAD: 0, LS: 1, RS: 2, LE: 3, RE: 4, LW: 5, RW: 6, LH: 7, RH: 8, LK: 9, RK: 10, LA: 11, RA: 12 } as const;
export const NLM = 13;
/** the optional extras, in order: left and right ear, left and right index knuckle, left and right toe */
export const LMX = { LEAR: 0, REAR: 1, LINDEX: 2, RINDEX: 3, LTOE: 4, RTOE: 5 } as const;
export const NLMX = 6;

export interface LandmarkPose {
  /** 13 × xyz in the dancer's frame (see the file's opening note) */
  p: Float32Array;
  /** the frame's origin in the world: the ground point under the hips */
  root: Vec3;
  /** which way the body faces (radians; forward is (sin yaw, 0, cos yaw)) */
  yaw: number;
  /** 6 × xyz in the same frame, or null */
  extra: Float32Array | null;
}

export const newLandmarkPose = (extra = false): LandmarkPose =>
  ({ p: new Float32Array(NLM * 3), root: vec3.create(), yaw: 0, extra: extra ? new Float32Array(NLMX * 3) : null });

/** the CMU joint each landmark sits at (the head's is between Head and HeadEnd: the middle of the head) */
export const LANDMARK_JOINTS: readonly number[] = [
  JOINT.Head, JOINT.LeftArm, JOINT.RightArm, JOINT.LeftForeArm, JOINT.RightForeArm, JOINT.LeftHand, JOINT.RightHand,
  JOINT.LeftUpLeg, JOINT.RightUpLeg, JOINT.LeftLeg, JOINT.RightLeg, JOINT.LeftFoot, JOINT.RightFoot,
];

const _lm_a = vec3.create();
const _lm_b = vec3.create();
const _lm_side = vec3.create();
const _lm_up = vec3.create();
const _lm_fwd = vec3.create();

/** a landmark's point in the world (from a LandmarkPose) */
export function landmarkWorld(lm: LandmarkPose, i: number, out: Vec3, src = lm.p) {
  const c = Math.cos(lm.yaw), s = Math.sin(lm.yaw), x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
  return vec3.set(out, lm.root[0] + x * c + z * s, lm.root[1] + y, lm.root[2] - x * s + z * c);
}

/**
 * The inverse of retargeting: a posed skeleton as 13 landmarks (and the six extras, if `out.extra`). The facing is
 * the pelvis's (across the hips and up the spine); the origin is the floor (y = `ground`) under the hips' middle.
 */
export function landmarksFromSkeleton(sk: Skeleton, out: LandmarkPose, ground = 0) {
  const P = sk.pos;
  // facing: across the hips (left minus right) and up from the hips to the shoulders; forward is side × up
  vec3.subtract(_lm_side, P[JOINT.LeftUpLeg], P[JOINT.RightUpLeg]);
  vec3.scale(_lm_a, vec3.add(_lm_a, P[JOINT.LeftUpLeg], P[JOINT.RightUpLeg]), 0.5);
  vec3.scale(_lm_b, vec3.add(_lm_b, P[JOINT.LeftArm], P[JOINT.RightArm]), 0.5);
  vec3.subtract(_lm_up, _lm_b, _lm_a);
  vec3.cross(_lm_fwd, _lm_side, _lm_up);
  out.yaw = Math.atan2(_lm_fwd[0], _lm_fwd[2]);
  vec3.set(out.root, _lm_a[0], ground, _lm_a[2]);
  const c = Math.cos(out.yaw), s = Math.sin(out.yaw);
  const put = (dst: Float32Array, i: number, w: Vec3) => {
    const x = w[0] - out.root[0], y = w[1] - out.root[1], z = w[2] - out.root[2];
    // the inverse of Ry(yaw): local = Ry(-yaw) · (world - root)
    dst[i * 3] = x * c - z * s; dst[i * 3 + 1] = y; dst[i * 3 + 2] = x * s + z * c;
  };
  for (let i = 0; i < NLM; i++) {
    const j = LANDMARK_JOINTS[i];
    if (i === LM.HEAD) put(out.p, i, vec3.scale(_lm_b, vec3.add(_lm_b, P[JOINT.Head], P[JOINT.HeadEnd]), 0.5));
    else put(out.p, i, P[j]);
  }
  if (out.extra) {
    // ears: either side of the head's middle, across the head; index knuckles and toes are joints of the rig
    vec3.scale(_lm_b, vec3.add(_lm_b, P[JOINT.Head], P[JOINT.HeadEnd]), 0.5);
    vec3.transformQuat(_lm_a, vec3.set(_lm_a, 0.075, 0, 0), sk.rot[JOINT.Head]);
    put(out.extra, LMX.LEAR, vec3.add(_lm_side, _lm_b, _lm_a));
    put(out.extra, LMX.REAR, vec3.subtract(_lm_side, _lm_b, _lm_a));
    put(out.extra, LMX.LINDEX, P[JOINT.LeftHandIndex1]);
    put(out.extra, LMX.RINDEX, P[JOINT.RightHandIndex1]);
    put(out.extra, LMX.LTOE, P[JOINT.LeftToeBase]);
    put(out.extra, LMX.RTOE, P[JOINT.RightToeBase]);
  }
  return out;
}

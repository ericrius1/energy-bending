// Retargeting: fit the 38-joint rig to 13 landmarks (skeleton/landmarks.ts), generalised from Gem Dancers' webcam
// dancer (pose.ts). The rig keeps its own bone lengths and takes only directions from the landmarks:
//   - the pelvis and the chest are frames (across the hips or shoulders, and up the spine), each applied as the turn
//     from the rig's own rest frame, so a rig posed by mocap and read back comes out the same way up;
//   - the spine between them is half of each; the neck and head swing from the chest toward the head landmark;
//   - each limb bone swings (the least turn) from where its parent leaves it to point where the landmarks do;
//   - hands carry on from the forearm and feet point along the body's facing, unless the extras (index knuckles,
//     toes, ears) say otherwise.
// Then forward kinematics from the hips, which are put where the landmarks' hips are.
import { mat3, quat, vec3, type Mat3, type Quat, type Vec3 } from 'math';
import { JOINT, MAXJ, type Rig, type Skeleton } from './rig';
import { LM, LMX, landmarkWorld, type LandmarkPose } from './landmarks';

// scratch, allocated once
const W: Vec3[] = Array.from({ length: 13 }, () => vec3.create());
const X: Vec3[] = Array.from({ length: 6 }, () => vec3.create());
const _r_q: Quat = quat.create();
const _r_a: Vec3 = vec3.create();
const _r_b: Vec3 = vec3.create();
const _r_x: Vec3 = vec3.create();
const _r_y: Vec3 = vec3.create();
const _r_z: Vec3 = vec3.create();
const _r_m: Mat3 = mat3.create();
const _r_hips: Vec3 = vec3.create();
const _r_sh: Vec3 = vec3.create();
const _r_fwd: Vec3 = vec3.create();
const _r_pelvis: Quat = quat.create();
const _r_chest: Quat = quat.create();
const _r_spine: Quat = quat.create();
const _r_root: Vec3 = vec3.create();

/** the rotation whose x, y, z axes are a frame from a sideways axis and an up axis (up wins; forward is x × y) */
function frameOf(out: Quat, side: Vec3, up: Vec3) {
  vec3.normalize(_r_y, up);
  vec3.scaleAndAdd(_r_x, side, _r_y, -vec3.dot(side, _r_y));
  if (vec3.length(_r_x) < 1e-5) vec3.set(_r_x, 1, 0, 0);
  vec3.normalize(_r_x, _r_x);
  vec3.cross(_r_z, _r_x, _r_y);
  for (let k = 0; k < 3; k++) { _r_m[k] = _r_x[k]; _r_m[3 + k] = _r_y[k]; _r_m[6 + k] = _r_z[k]; }
  return quat.normalize(out, quat.fromMat3(out, _r_m));
}

/** what retargeting needs to know about a rig at rest (every joint unturned): its frames and directions */
interface Rest {
  pos: Vec3[];
  pelvisInv: Quat;
  chestInv: Quat;
  /** from the shoulders' middle to the head's middle, in the chest's rest frame */
  head: Vec3;
}
const rests = new WeakMap<Rig, Rest>();
function restOf(rig: Rig): Rest {
  let r = rests.get(rig);
  if (r) return r;
  const J = rig.joints, pos = Array.from({ length: Math.min(J.length, MAXJ) }, () => vec3.create());
  for (let k = 0; k < pos.length; k++) if (J[k].parent >= 0) vec3.add(pos[k], pos[J[k].parent], J[k].offset as unknown as Vec3);
  const mid = (a: number, b: number, out: Vec3) => vec3.scale(out, vec3.add(out, pos[a], pos[b]), 0.5);
  const hips = mid(JOINT.LeftUpLeg, JOINT.RightUpLeg, vec3.create()), sh = mid(JOINT.LeftArm, JOINT.RightArm, vec3.create());
  const up = vec3.subtract(vec3.create(), sh, hips);
  const pelvis = frameOf(quat.create(), vec3.subtract(vec3.create(), pos[JOINT.LeftUpLeg], pos[JOINT.RightUpLeg]), up);
  const chest = frameOf(quat.create(), vec3.subtract(vec3.create(), pos[JOINT.LeftArm], pos[JOINT.RightArm]), up);
  const headMid = mid(JOINT.Head, JOINT.HeadEnd, vec3.create());
  const head = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), headMid, sh));
  const chestInv = quat.invert(quat.create(), chest);
  vec3.transformQuat(head, head, chestInv);
  r = { pos, pelvisInv: quat.invert(quat.create(), pelvis), chestInv, head };
  rests.set(rig, r);
  return r;
}

/**
 * pose `out` (its pos and rot; call out.commit(dt) after) from landmarks. The hips go where the landmarks' hips are;
 * `lift` raises the whole body (a controller that keeps the feet on the floor passes how far).
 */
export function fitSkeleton(lm: LandmarkPose, out: Skeleton, lift = 0) {
  const rig = out.rig, J = rig.joints, rest = restOf(rig), R = out.rot, P = out.pos, n = out.count;
  for (let i = 0; i < 13; i++) landmarkWorld(lm, i, W[i]);
  const ex = lm.extra;
  if (ex) for (let i = 0; i < 6; i++) landmarkWorld(lm, i, X[i], ex);
  vec3.scale(_r_hips, vec3.add(_r_hips, W[LM.LH], W[LM.RH]), 0.5);
  vec3.scale(_r_sh, vec3.add(_r_sh, W[LM.LS], W[LM.RS]), 0.5);
  vec3.subtract(_r_b, _r_sh, _r_hips);
  // the pelvis and the chest, each as the turn from the rig's rest frame to the one the landmarks make
  frameOf(_r_pelvis, vec3.subtract(_r_a, W[LM.LH], W[LM.RH]), _r_b);
  quat.multiply(_r_pelvis, _r_pelvis, rest.pelvisInv);
  frameOf(_r_chest, vec3.subtract(_r_a, W[LM.LS], W[LM.RS]), _r_b);
  quat.multiply(_r_chest, _r_chest, rest.chestInv);
  quat.slerp(_r_spine, _r_pelvis, _r_chest, 0.5);
  for (let k = 0; k < n; k++) quat.copy(R[k], _r_pelvis);
  quat.copy(R[JOINT.Spine], _r_spine);
  for (const k of [JOINT.Spine1, JOINT.Neck, JOINT.LeftShoulder, JOINT.RightShoulder]) quat.copy(R[k], _r_chest);
  // the head: ears give its turn; without them it swings from the chest toward the head landmark
  if (ex) {
    vec3.scale(_r_x, vec3.add(_r_x, X[LMX.LEAR], X[LMX.REAR]), 0.5);
    frameOf(_r_q, vec3.subtract(_r_a, X[LMX.LEAR], X[LMX.REAR]), vec3.subtract(_r_b, _r_x, _r_sh));
    quat.multiply(_r_q, _r_q, rest.chestInv);
  } else {
    vec3.transformQuat(_r_a, rest.head, _r_chest);
    vec3.normalize(_r_b, vec3.subtract(_r_b, W[LM.HEAD], _r_sh));
    quat.rotationTo(_r_q, _r_a, _r_b);
    quat.multiply(_r_q, _r_q, _r_chest);
  }
  quat.copy(R[JOINT.Neck1], _r_q);
  quat.copy(R[JOINT.Head], _r_q);
  // a bone turned from its parent's frame to point from `from` to `to` (the least turn that gets it there)
  const swing = (k: number, parent: number, child: number, from: Vec3, to: Vec3) => {
    vec3.normalize(_r_a, vec3.transformQuat(_r_a, J[child].offset as unknown as Vec3, R[parent]));
    vec3.subtract(_r_b, to, from);
    if (vec3.length(_r_b) < 1e-6) { quat.copy(R[k], R[parent]); return; }
    vec3.normalize(_r_b, _r_b);
    quat.rotationTo(_r_q, _r_a, _r_b);
    quat.multiply(R[k], _r_q, R[parent]);
  };
  // which way is forward along the floor (for feet without toes)
  vec3.set(_r_fwd, Math.sin(lm.yaw), 0, Math.cos(lm.yaw));
  const sides = [
    { hj: JOINT.LHipJoint, up: JOINT.LeftUpLeg, leg: JOINT.LeftLeg, foot: JOINT.LeftFoot, toe: JOINT.LeftToeBase, sh: JOINT.LeftShoulder, arm: JOINT.LeftArm, fore: JOINT.LeftForeArm,
      hand: JOINT.LeftHand, fb: JOINT.LeftFingerBase, idx: JOINT.LeftHandIndex1, thumb: JOINT.LThumb, H: LM.LH, K: LM.LK, A: LM.LA, S: LM.LS, E: LM.LE, Wr: LM.LW, T: LMX.LTOE, I: LMX.LINDEX },
    { hj: JOINT.RHipJoint, up: JOINT.RightUpLeg, leg: JOINT.RightLeg, foot: JOINT.RightFoot, toe: JOINT.RightToeBase, sh: JOINT.RightShoulder, arm: JOINT.RightArm, fore: JOINT.RightForeArm,
      hand: JOINT.RightHand, fb: JOINT.RightFingerBase, idx: JOINT.RightHandIndex1, thumb: JOINT.RThumb, H: LM.RH, K: LM.RK, A: LM.RA, S: LM.RS, E: LM.RE, Wr: LM.RW, T: LMX.RTOE, I: LMX.RINDEX },
  ];
  for (const s of sides) {
    swing(s.up, s.hj, s.leg, W[s.H], W[s.K]);
    swing(s.leg, s.up, s.foot, W[s.K], W[s.A]);
    if (ex) swing(s.foot, s.leg, s.toe, W[s.A], X[s.T]);
    else {
      // a foot points along the body's facing, a little down to the floor
      vec3.scaleAndAdd(_r_x, W[s.A], _r_fwd, 0.14);
      _r_x[1] -= 0.05;
      swing(s.foot, s.leg, s.toe, W[s.A], _r_x);
    }
    quat.copy(R[s.toe], R[s.foot]);
    swing(s.arm, s.sh, s.fore, W[s.S], W[s.E]);
    swing(s.fore, s.arm, s.hand, W[s.E], W[s.Wr]);
    if (ex) swing(s.fb, s.fore, s.idx, W[s.Wr], X[s.I]);
    else quat.copy(R[s.fb], R[s.fore]);
    for (const f of [s.hand, s.idx, s.thumb]) quat.copy(R[f], R[s.fb]);
  }
  // forward kinematics with the rig's own lengths from the root at 0, then moved so its hips are the landmarks'
  for (let k = 0; k < n; k++) {
    const j = J[k];
    if (j.parent < 0) vec3.zero(P[k]);
    else vec3.add(P[k], P[j.parent], vec3.transformQuat(_r_a, j.offset as unknown as Vec3, R[j.parent]));
  }
  vec3.scale(_r_root, vec3.add(_r_root, P[JOINT.LeftUpLeg], P[JOINT.RightUpLeg]), 0.5);
  vec3.subtract(_r_root, _r_hips, _r_root);
  _r_root[1] += lift;
  for (let k = 0; k < n; k++) vec3.add(P[k], P[k], _r_root);
}

/** the lowest the feet go in a posed skeleton (for keeping a tracked body on the floor) */
export function lowestFoot(sk: Skeleton) {
  const P = sk.pos;
  return Math.min(P[JOINT.LeftFoot][1], P[JOINT.RightFoot][1], P[JOINT.LeftToeBase][1], P[JOINT.RightToeBase][1]);
}

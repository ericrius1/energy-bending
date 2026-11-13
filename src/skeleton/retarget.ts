// Retargeting: fit the 38-joint rig to 13 landmarks (skeleton/landmarks.ts), generalised from Gem Dancers' webcam
// dancer (pose.ts). The rig keeps its own bone lengths and takes only directions from the landmarks:
//   - the pelvis and the chest are frames (across the hips or shoulders, and up the spine), each applied as the turn
//     from the rig's own rest frame, so a rig posed by mocap and read back comes out the same way up;
//   - the spine between them is half of each; the neck and head swing from the chest toward the head landmark;
//   - each limb bone swings (the least turn) from where its parent leaves it to point where the landmarks do;
//   - hands carry on from the forearm and feet point along the body's facing, unless the extras (index knuckles,
//     toes, ears) say otherwise.
// Then forward kinematics from the hips, which are put where the landmarks' hips are.
//
// Thirteen points under-determine a body: they say nothing of the hands, the feet's angle, how the spine curves or
// where the eyes look. `PoseHints` (optional; a procedural dancer passes them, dancer/intent-controller.ts) fill that
// in with defaults that read: feet lie flat on the floor near it and point (or flex) in the air, the lower back stays
// nearer upright than the line from hips to shoulders so the spine curves between them, the forearms turn so the palms
// face sensibly (in to the body, out in a block, down on the floor) and the hands relax, close or open by move, and
// the head turns toward something to look at.
import { mat3, quat, vec3, type Mat3, type Quat, type Vec3 } from 'math';
import { JOINT, MAXJ, type Rig, type Skeleton } from './rig';
import { LM, LMX, landmarkWorld, type LandmarkPose } from './landmarks';

/** a hand: relaxed (a soft curl), a fist, open (palm out, wrist back: a block, a push), or flat on the floor */
export type HandStyle = 'relaxed' | 'fist' | 'open' | 'floor';
/** a foot: auto (flat when near the floor, pointed off it), pointed (toes along the shin), flexed (toes to the knee) */
export type FootStyle = 'auto' | 'point' | 'flex';

/** what 13 landmarks can't say (all optional; [left, right] for pairs) */
export interface PoseHints {
  /** the floor's height under the dancer (world y), or null in the air: feet near it lie flat */
  ground?: number | null;
  /** how high the rig's ankle stands above a flat sole (m) */
  ankle?: number;
  feet?: [FootStyle, FootStyle];
  hands?: [HandStyle, HandStyle];
  /** somewhere to look (world) and how much (0..1) */
  lookAt?: ArrayLike<number> | null;
  look?: number;
  /** how much the spine curves between the hips and the shoulders (0: straight, as without hints; 1: natural) */
  curve?: number;
}

// scratch, allocated once
const W: Vec3[] = Array.from({ length: 13 }, () => vec3.create());
const X: Vec3[] = Array.from({ length: 6 }, () => vec3.create());
const _r_q: Quat = quat.create();
const _r_q2: Quat = quat.create();
const _r_a: Vec3 = vec3.create();
const _r_b: Vec3 = vec3.create();
const _r_c: Vec3 = vec3.create();
const _r_d: Vec3 = vec3.create();
const _r_e: Vec3 = vec3.create();
const _r_x: Vec3 = vec3.create();
const _r_y: Vec3 = vec3.create();
const _r_z: Vec3 = vec3.create();
const _r_m: Mat3 = mat3.create();
const _r_hips: Vec3 = vec3.create();
const _r_sh: Vec3 = vec3.create();
const _r_fwd: Vec3 = vec3.create();
const _r_left: Vec3 = vec3.create();
const _r_pelvis: Quat = quat.create();
const _r_chest: Quat = quat.create();
const _r_spine: Quat = quat.create();
const _r_root: Vec3 = vec3.create();
const DOWN: Vec3 = [0, -1, 0];
const FWD: Vec3 = [0, 0, 1];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

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
  /** the hip joints' middle, from the root (rest), and the lower spine's first bone */
  hipMid: Vec3;
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
  r = { pos, pelvisInv: quat.invert(quat.create(), pelvis), chestInv, head, hipMid: hips };
  rests.set(rig, r);
  return r;
}

/** turn `q` (in place) by the least rotation that takes direction `from` toward `to`, by `w` of the way, at most `most` rad */
function turnToward(q: Quat, from: Vec3, to: Vec3, w = 1, most = Math.PI) {
  quat.rotationTo(_r_q2, from, to);
  const angle = 2 * Math.acos(clamp(Math.abs(_r_q2[3]), 0, 1));
  const k = angle > 1e-6 ? Math.min(angle * w, most) / angle : 0;
  quat.slerp(_r_q2, quat.identity(_r_q), _r_q2, k);
  quat.multiply(q, _r_q2, q);
}
/** turn `q` (in place) about `axis` (unit, world) by `angle` */
function turnAbout(q: Quat, axis: Vec3, angle: number) {
  quat.setAxisAngle(_r_q2, axis, angle);
  quat.multiply(q, _r_q2, q);
}

/**
 * pose `out` (its pos and rot; call out.commit(dt) after) from landmarks. The hips go where the landmarks' hips are;
 * `lift` raises the whole body (a controller that keeps the feet on the floor passes how far); `hints` fill in what the
 * landmarks don't say (see PoseHints; without them the fit is exactly the plain one).
 */
export function fitSkeleton(lm: LandmarkPose, out: Skeleton, lift = 0, hints?: PoseHints) {
  const rig = out.rig, J = rig.joints, rest = restOf(rig), R = out.rot, P = out.pos, n = out.count;
  for (let i = 0; i < 13; i++) landmarkWorld(lm, i, W[i]);
  const ex = lm.extra;
  if (ex) for (let i = 0; i < 6; i++) landmarkWorld(lm, i, X[i], ex);
  vec3.scale(_r_hips, vec3.add(_r_hips, W[LM.LH], W[LM.RH]), 0.5);
  vec3.scale(_r_sh, vec3.add(_r_sh, W[LM.LS], W[LM.RS]), 0.5);
  vec3.subtract(_r_b, _r_sh, _r_hips);
  vec3.set(_r_fwd, Math.sin(lm.yaw), 0, Math.cos(lm.yaw));
  vec3.set(_r_left, Math.cos(lm.yaw), 0, -Math.sin(lm.yaw));
  const curve = hints?.curve ?? 0;
  // the pelvis and the chest, each as the turn from the rig's rest frame to the one the landmarks make
  if (curve > 0) {
    // the lower back stays nearer the thighs' upright than the line to the shoulders does (a spine curves; it isn't a
    // rod), turned only forward and back about the hips' axis, and never more than 0.4 rad off that line
    vec3.subtract(_r_a, W[LM.LH], W[LM.RH]);
    vec3.normalize(_r_a, _r_a);
    vec3.add(_r_c, vec3.subtract(_r_c, W[LM.LH], W[LM.LK]), vec3.subtract(_r_d, W[LM.RH], W[LM.RK]));
    vec3.scaleAndAdd(_r_c, _r_c, _r_a, -vec3.dot(_r_c, _r_a));
    vec3.normalize(_r_d, _r_b);
    if (vec3.length(_r_c) > 1e-4) {
      vec3.normalize(_r_c, _r_c);
      // (thighs well behind the torso, as in a lean back or a high kick, are no guide: keep to the torso then)
      const agree = smooth((vec3.dot(_r_c, _r_d) - 0.2) / 0.5);
      vec3.lerp(_r_e, _r_d, _r_c, 0.35 * curve * agree);
      vec3.normalize(_r_e, _r_e);
      const off = Math.acos(clamp(vec3.dot(_r_e, _r_d), -1, 1));
      if (off > 0.4) vec3.lerp(_r_e, _r_d, _r_e, 0.4 / off);
    } else vec3.copy(_r_e, _r_d);
    frameOf(_r_pelvis, _r_a, _r_e);
  } else frameOf(_r_pelvis, vec3.subtract(_r_a, W[LM.LH], W[LM.RH]), _r_b);
  quat.multiply(_r_pelvis, _r_pelvis, rest.pelvisInv);
  if (curve > 0) {
    // the chest takes the rest of the bend: up from where the lower back ends to the shoulders
    vec3.subtract(_r_c, rest.pos[JOINT.Spine], rest.hipMid);
    vec3.transformQuat(_r_c, _r_c, _r_pelvis);
    vec3.add(_r_c, _r_c, _r_hips);
    vec3.subtract(_r_d, _r_sh, _r_c);
    frameOf(_r_chest, vec3.subtract(_r_a, W[LM.LS], W[LM.RS]), vec3.lerp(_r_d, _r_b, _r_d, curve));
  } else frameOf(_r_chest, vec3.subtract(_r_a, W[LM.LS], W[LM.RS]), _r_b);
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
  // looking: the head (and the neck, a third as much) turns toward something, within what a neck can do
  const look = hints?.look ?? 0;
  if (!ex && hints?.lookAt && look > 0.01) {
    const L = hints.lookAt;
    vec3.set(_r_c, L[0] - W[LM.HEAD][0], L[1] - W[LM.HEAD][1], L[2] - W[LM.HEAD][2]);
    if (vec3.length(_r_c) > 0.1) {
      vec3.normalize(_r_c, _r_c);
      vec3.transformQuat(_r_d, FWD, R[JOINT.Head]);
      turnToward(R[JOINT.Neck1], _r_d, _r_c, 0.35 * look, 0.45);
      turnToward(R[JOINT.Head], _r_d, _r_c, look, 1.1);
    }
  }
  // a bone turned from its parent's frame to point from `from` to `to` (the least turn that gets it there)
  const swing = (k: number, parent: number, child: number, from: Vec3, to: Vec3) => {
    vec3.normalize(_r_a, vec3.transformQuat(_r_a, J[child].offset as unknown as Vec3, R[parent]));
    vec3.subtract(_r_b, to, from);
    if (vec3.length(_r_b) < 1e-6) { quat.copy(R[k], R[parent]); return; }
    vec3.normalize(_r_b, _r_b);
    quat.rotationTo(_r_q, _r_a, _r_b);
    quat.multiply(R[k], _r_q, R[parent]);
  };
  const sides = [
    { hj: JOINT.LHipJoint, up: JOINT.LeftUpLeg, leg: JOINT.LeftLeg, foot: JOINT.LeftFoot, toe: JOINT.LeftToeBase, sh: JOINT.LeftShoulder, arm: JOINT.LeftArm, fore: JOINT.LeftForeArm,
      hand: JOINT.LeftHand, fb: JOINT.LeftFingerBase, idx: JOINT.LeftHandIndex1, thumb: JOINT.LThumb, H: LM.LH, K: LM.LK, A: LM.LA, S: LM.LS, E: LM.LE, Wr: LM.LW, T: LMX.LTOE, I: LMX.LINDEX, sign: 1 },
    { hj: JOINT.RHipJoint, up: JOINT.RightUpLeg, leg: JOINT.RightLeg, foot: JOINT.RightFoot, toe: JOINT.RightToeBase, sh: JOINT.RightShoulder, arm: JOINT.RightArm, fore: JOINT.RightForeArm,
      hand: JOINT.RightHand, fb: JOINT.RightFingerBase, idx: JOINT.RightHandIndex1, thumb: JOINT.RThumb, H: LM.RH, K: LM.RK, A: LM.RA, S: LM.RS, E: LM.RE, Wr: LM.RW, T: LMX.RTOE, I: LMX.RINDEX, sign: -1 },
  ];
  for (let si = 0; si < 2; si++) {
    const s = sides[si];
    swing(s.up, s.hj, s.leg, W[s.H], W[s.K]);
    swing(s.leg, s.up, s.foot, W[s.K], W[s.A]);
    if (ex) swing(s.foot, s.leg, s.toe, W[s.A], X[s.T]);
    else if (hints) footHint(s.foot, s.leg, s.toe, W[s.H], W[s.K], W[s.A], hints, hints.feet?.[si] ?? 'auto', swing);
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
    if (!ex && hints?.hands) handHint(s, hints.hands[si], R, J);
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

/** a foot's turn from the hints: flat on a floor it's near (along the way the knee points, the sole level), pointed
 *  (toes on along the shin, curving a little forward) or flexed (toes up toward the knee) in the air */
function footHint(foot: number, leg: number, toe: number, H: Vec3, K: Vec3, A: Vec3, hints: PoseHints, style: FootStyle,
  swing: (k: number, parent: number, child: number, from: Vec3, to: Vec3) => void) {
  // the shin, and which way the knee points (off the line from hip to ankle; the body's facing for a straight leg)
  const shin = vec3.normalize(_r_c, vec3.subtract(_r_c, A, K));
  vec3.subtract(_r_d, A, H);
  const L2 = vec3.dot(_r_d, _r_d);
  const t = L2 > 1e-8 ? vec3.dot(vec3.subtract(_r_e, K, H), _r_d) / L2 : 0;
  vec3.scaleAndAdd(_r_e, H, _r_d, t);
  const knee = vec3.subtract(_r_d, K, _r_e);
  const bent = smooth((vec3.length(knee) - 0.02) / 0.06);
  vec3.scaleAndAdd(knee, knee, shin, -vec3.dot(knee, shin));
  if (vec3.length(knee) > 1e-5) vec3.normalize(knee, knee);
  // (a straight leg: its front is the body's forward, square to the shin)
  vec3.scaleAndAdd(_r_e, _r_fwd, shin, -vec3.dot(_r_fwd, shin));
  if (vec3.length(_r_e) > 1e-5) vec3.normalize(_r_e, _r_e);
  vec3.lerp(knee, _r_e, knee, bent);
  vec3.normalize(knee, knee);
  // flat: level, along the knee's way over the floor (and the facing), turned out a touch, with the rig's own slope
  vec3.set(_r_x, knee[0] + _r_fwd[0] * 0.6, 0, knee[2] + _r_fwd[2] * 0.6);
  if (vec3.length(_r_x) < 1e-4) vec3.copy(_r_x, _r_fwd);
  vec3.normalize(_r_x, _r_x);
  vec3.scaleAndAdd(_r_x, _r_x, DOWN, 0.34);
  // pointed and flexed
  const pointed = vec3.normalize(_r_y, vec3.scaleAndAdd(_r_y, shin, knee, 0.35));
  const flexed = vec3.normalize(_r_z, vec3.scaleAndAdd(_r_z, knee, shin, -0.2));
  const ground = hints.ground ?? null, ankle = hints.ankle ?? 0.075;
  const near = ground == null ? 0 : 1 - smooth((A[1] - ground - ankle - 0.04) / 0.22);
  const air = style === 'flex' ? flexed : pointed;
  const w = style === 'auto' ? near : near * 0.6;
  vec3.lerp(_r_x, air, _r_x, w);
  vec3.normalize(_r_x, _r_x);
  vec3.add(_r_x, A, _r_x);
  swing(foot, leg, toe, A, _r_x);
}

/** a hand from the hints: the forearm turns so the palm faces in (relaxed, a fist), out (open) or down (on the floor);
 *  the wrist bends and the fingers curl to match. The CMU rig's palms face down at rest (-y), its fingers along ±x. */
function handHint(s: { fore: number; hand: number; fb: number; idx: number; thumb: number; sign: number }, style: HandStyle, R: Quat[], J: Rig['joints']) {
  // the forearm's axis and where its palm faces now
  const d = vec3.normalize(_r_c, vec3.transformQuat(_r_c, J[s.hand].offset as unknown as Vec3, R[s.fore]));
  const palm = vec3.transformQuat(_r_d, DOWN, R[s.fore]);
  // where it should face: in toward the body's middle, out ahead (a block), or down
  if (style === 'open') vec3.copy(_r_e, _r_fwd);
  else if (style === 'floor') vec3.copy(_r_e, DOWN);
  else vec3.scale(_r_e, _r_left, -s.sign);
  vec3.scaleAndAdd(_r_e, _r_e, d, -vec3.dot(_r_e, d));
  vec3.scaleAndAdd(palm, palm, d, -vec3.dot(palm, d));
  if (vec3.length(_r_e) > 0.2 && vec3.length(palm) > 1e-4) {
    vec3.normalize(_r_e, _r_e); vec3.normalize(palm, palm);
    // the turn about the forearm (a wrist can't turn a full circle: at most 1.8 rad)
    const ang = Math.atan2(vec3.dot(vec3.cross(_r_x, palm, _r_e), d), vec3.dot(palm, _r_e));
    turnAbout(R[s.fore], d, clamp(ang, -1.8, 1.8));
  }
  // the wrist: flexed toward the palm (+) or bent back (-); on the floor the hand lies flat, fingers forward
  const palmN = vec3.transformQuat(_r_d, DOWN, R[s.fore]);
  const axis = vec3.normalize(_r_e, vec3.cross(_r_e, d, palmN));
  quat.copy(R[s.hand], R[s.fore]);
  let wrist = 0.2, curl = 0.5, thumb = 0.3;
  if (style === 'fist') { wrist = 0.1; curl = 1.75; thumb = 0.9; }
  else if (style === 'open') { wrist = -0.7; curl = -0.05; thumb = 0; }
  else if (style === 'floor') {
    // bend back until the fingers lie along the floor (toward the forearm's way over it, or forward)
    vec3.set(_r_x, d[0], 0, d[2]);
    if (vec3.length(_r_x) < 0.15) vec3.copy(_r_x, _r_fwd);
    vec3.normalize(_r_x, _r_x);
    wrist = -Math.acos(clamp(vec3.dot(d, _r_x), -1, 1));
    wrist = clamp(wrist, -1.4, 0);
    curl = 0.1; thumb = 0;
  }
  turnAbout(R[s.hand], axis, wrist);
  quat.copy(R[s.fb], R[s.hand]);
  quat.copy(R[s.thumb], R[s.hand]);
  turnAbout(R[s.thumb], axis, thumb);
  quat.copy(R[s.idx], R[s.hand]);
  turnAbout(R[s.idx], axis, curl);
}

/** the lowest the feet go in a posed skeleton (for keeping a tracked body on the floor) */
export function lowestFoot(sk: Skeleton) {
  const P = sk.pos;
  return Math.min(P[JOINT.LeftFoot][1], P[JOINT.RightFoot][1], P[JOINT.LeftToeBase][1], P[JOINT.RightToeBase][1]);
}


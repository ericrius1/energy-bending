// The rig and the posed skeleton. The rig is Gem Dancers' 38-joint CMU skeleton: names, parents and rest offsets
// (metres, y up, facing +z), as scripts/mocap.mjs packs it. A Skeleton is one rig posed in the world this frame:
// every joint's position and rotation, which a controller writes, and the same laid out the way the GPU reads joints
// (`world`: 12 floats a joint, see JOINT_FLOATS) once `commit(dt)` has worked out the velocities.
import { quat, vec3, type Quat, type Vec3 } from 'math';
import { LIMITS } from '../engine/limits';

export const MAXJ = LIMITS.joints;
/** a joint on the GPU (matter/core/body.wgsl `Joint`): pos xyz + speed, rotation xyzw, velocity xyz + 0 */
export const JOINT_FLOATS = 12;

export interface RigJoint { name: string; parent: number; offset: [number, number, number]; rotates: boolean }
export interface Rig { joints: RigJoint[] }

/** the CMU rig's joint indices by name (the same in every clip: scripts/mocap.mjs keeps them so) */
export const JOINT = {
  Hips: 0, LHipJoint: 1, LeftUpLeg: 2, LeftLeg: 3, LeftFoot: 4, LeftToeBase: 5, LeftToeBaseEnd: 6,
  RHipJoint: 7, RightUpLeg: 8, RightLeg: 9, RightFoot: 10, RightToeBase: 11, RightToeBaseEnd: 12,
  LowerBack: 13, Spine: 14, Spine1: 15, Neck: 16, Neck1: 17, Head: 18, HeadEnd: 19,
  LeftShoulder: 20, LeftArm: 21, LeftForeArm: 22, LeftHand: 23, LeftFingerBase: 24, LeftHandIndex1: 25, LeftHandIndex1End: 26,
  LThumb: 27, LThumbEnd: 28,
  RightShoulder: 29, RightArm: 30, RightForeArm: 31, RightHand: 32, RightFingerBase: 33, RightHandIndex1: 34, RightHandIndex1End: 35,
  RThumb: 36, RThumbEnd: 37,
} as const;

/** check a rig has the joints in the order JOINT says (every clip shipped does) */
export function checkRig(rig: Rig) {
  for (const [name, k] of Object.entries(JOINT)) {
    if (rig.joints[k]?.name !== name) throw new Error(`rig: joint ${k} is ${rig.joints[k]?.name}, expected ${name}`);
  }
}

/** a posed rig: write `pos` and `rot` (world space), then `commit(dt)` fills `world` for the GPU */
export class Skeleton {
  readonly pos: Vec3[] = Array.from({ length: MAXJ }, () => vec3.create());
  readonly rot: Quat[] = Array.from({ length: MAXJ }, () => quat.create());
  /** pos + speed | rotation | velocity + 0, per joint: what the GPU's joints buffer holds for this dancer */
  readonly world = new Float32Array(MAXJ * JOINT_FLOATS);
  private prev = new Float32Array(MAXJ * 3);
  private fresh = true;
  constructor(public rig: Rig) {}

  get count() { return Math.min(this.rig.joints.length, MAXJ); }

  /** after a jump (a new controller, a teleport): the next commit starts the velocities from rest */
  reset() { this.fresh = true; }

  /** lay pos and rot out for the GPU, with velocities from the last commit (smoothed by half: mocap is 30 fps) */
  commit(dt: number) {
    const w = this.world, n = this.count, inv = dt > 0 ? 1 / dt : 0;
    const keep = this.fresh ? 0 : 0.5;
    for (let k = 0; k < n; k++) {
      const o = k * JOINT_FLOATS, p = this.pos[k];
      for (let a = 0; a < 3; a++) {
        const v = this.fresh ? 0 : (p[a] - this.prev[k * 3 + a]) * inv;
        w[o + 8 + a] = v + (w[o + 8 + a] - v) * keep;
        w[o + a] = p[a];
        this.prev[k * 3 + a] = p[a];
      }
      w[o + 3] = Math.hypot(w[o + 8], w[o + 9], w[o + 10]);
      quat.toBuffer(w, this.rot[k], o + 4);
      w[o + 11] = 0;
    }
    this.fresh = false;
  }

  /** a joint's world position as last committed */
  joint(k: number, out: Vec3) { return vec3.set(out, this.world[k * JOINT_FLOATS], this.world[k * JOINT_FLOATS + 1], this.world[k * JOINT_FLOATS + 2]); }
}

const _fk_local = quat.create();
const _fk_off = vec3.create();

/**
 * forward kinematics: local rotations (one quaternion per rotating joint, in rig order, in `local` from `at`) and a
 * root position (already in world space) into a skeleton's pos and rot, turned by `rootRot` about the root
 */
export function forward(out: Skeleton, root: Vec3, rootRot: Quat, local: ArrayLike<number>, at: number) {
  const J = out.rig.joints, n = out.count;
  let r = 0;
  for (let k = 0; k < n; k++) {
    const j = J[k], pos = out.pos[k], rot = out.rot[k];
    if (j.rotates) {
      quat.set(_fk_local, local[at + 4 * r], local[at + 4 * r + 1], local[at + 4 * r + 2], local[at + 4 * r + 3]);
      r++;
    } else quat.identity(_fk_local);
    if (j.parent < 0) {
      vec3.copy(pos, root);
      quat.multiply(rot, rootRot, _fk_local);
    } else {
      vec3.transformQuat(_fk_off, j.offset as unknown as Vec3, out.rot[j.parent]);
      vec3.add(pos, out.pos[j.parent], _fk_off);
      quat.multiply(rot, out.rot[j.parent], _fk_local);
    }
  }
}

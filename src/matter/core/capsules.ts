// The body as capsules: what matter is laid on. Each capsule runs from a joint along its child's rest offset (in the
// joint's own frame), with an elliptical section that tapers (ra across, rb the other way) and maybe rounded ends.
// Gem Dancers' 25 capsules, each tagged with the body part a loadout names and the role it plays in a gem suite
// (heart, limb, accent). `segmentTable` writes one dancer's capsules as the GPU reads them (particle.wgsl `Seg`).
import type { Rig } from '../../skeleton/rig';
import { LIMITS } from '../../engine/limits';

/** the parts of a body a loadout can put matter on */
export type BodyPart = 'torso' | 'head' | 'arms' | 'hands' | 'legs' | 'feet';
export const BODY_PARTS: readonly BodyPart[] = ['torso', 'head', 'arms', 'hands', 'legs', 'feet'];

/** joint, child, radii at the joint end (ra, rb) and at the child end, whether the ends are rounded, the part */
export interface Capsule { joint: string; child: string; ra0: number; rb0: number; ra1: number; rb1: number; round: boolean; part: BodyPart }

const C = (joint: string, child: string, ra0: number, rb0: number, ra1: number, rb1: number, part: BodyPart, round = false): Capsule =>
  ({ joint, child, ra0, rb0, ra1, rb1, round, part });

const SIDE = (s: 'Left' | 'Right', h: 'L' | 'R'): Capsule[] => [
  C(`${h}HipJoint`, `${s}UpLeg`, 0.125, 0.115, 0.1, 0.095, 'torso'),
  C(`${s}UpLeg`, `${s}Leg`, 0.1, 0.098, 0.062, 0.064, 'legs'),
  C(`${s}Leg`, `${s}Foot`, 0.064, 0.067, 0.04, 0.043, 'legs'),
  C(`${s}Foot`, `${s}ToeBase`, 0.038, 0.048, 0.03, 0.047, 'feet', true),
  C(`${s}ToeBase`, `${s}ToeBaseEnd`, 0.027, 0.043, 0.019, 0.035, 'feet', true),
  C(`${s}Shoulder`, `${s}Arm`, 0.06, 0.066, 0.06, 0.06, 'arms'),
  C(`${s}Arm`, `${s}ForeArm`, 0.057, 0.058, 0.042, 0.042, 'arms', true),
  C(`${s}ForeArm`, `${s}Hand`, 0.042, 0.042, 0.03, 0.033, 'arms', true),
  C(`${s}FingerBase`, `${s}HandIndex1`, 0.015, 0.044, 0.013, 0.045, 'hands', true),
  C(`${s}HandIndex1`, `${s}HandIndex1End`, 0.012, 0.039, 0.009, 0.031, 'hands', true),
];

export const CAPSULES: readonly Capsule[] = [
  C('LowerBack', 'Spine', 0.14, 0.105, 0.145, 0.102, 'torso'),
  C('Spine', 'Spine1', 0.145, 0.102, 0.16, 0.112, 'torso'),
  C('Neck', 'Neck1', 0.16, 0.112, 0.1, 0.08, 'torso'),
  C('Neck1', 'Head', 0.055, 0.057, 0.052, 0.054, 'head'),
  C('Head', 'HeadEnd', 0.09, 0.1, 0.078, 0.088, 'head', true),
  ...SIDE('Left', 'L'),
  ...SIDE('Right', 'R'),
];
if (CAPSULES.length > LIMITS.capsules) throw new Error('more capsules than LIMITS.capsules');

/** a capsule's role in a suite of three: the heart (pelvis, belly, chest), the limbs, and the accents (head, hands, feet) */
export const roleOf = (joint: string) =>
  /^(LowerBack|Spine|Neck|LHipJoint|RHipJoint)$/.test(joint) ? 0 : /Head|Foot|Toe|Finger|HandIndex/.test(joint) ? 2 : 1;

const FLOATS = 16;
const len = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);

function basis(off: readonly number[]) {
  const l = len(off) || 1;
  const d = [off[0] / l, off[1] / l, off[2] / l];
  const ref = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let b1 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const k = len(b1);
  b1 = b1.map((x) => x / k);
  const b2 = [d[1] * b1[2] - d[2] * b1[1], d[2] * b1[0] - d[0] * b1[2], d[0] * b1[1] - d[1] * b1[0]];
  return { b1, b2 };
}

/** one rig's capsules for the GPU: LIMITS.capsules × (off + len, b1 + ra0, b2 + rb0, joint, child, ra1, rb1) */
export function segmentTable(rig: Rig, out = new Float32Array(LIMITS.capsules * FLOATS), at = 0) {
  const idx = new Map(rig.joints.map((j, i) => [j.name, i]));
  CAPSULES.forEach((c, s) => {
    const j = idx.get(c.joint), k = idx.get(c.child);
    if (j === undefined || k === undefined) throw new Error(`the rig has no ${c.joint} → ${c.child}`);
    const off = rig.joints[k].offset;
    const { b1, b2 } = basis(off);
    out.set([off[0], off[1], off[2], len(off), b1[0], b1[1], b1[2], c.ra0, b2[0], b2[1], b2[2], c.rb0, j, k, c.ra1, c.rb1], at + s * FLOATS);
  });
  return out;
}

/** a capsule's length on a rig */
export const capsuleLength = (rig: Rig, c: Capsule) => len(rig.joints.find((j) => j.name === c.child)!.offset);

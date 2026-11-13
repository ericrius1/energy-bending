// Small helpers for a matter kind's voice (its `hear(ears)`: docs/extending/sound.md): where a dancer's body is, how
// fast its limbs move, a seeded number per frame (so a stepped capture or a film hears the same thing every time), and
// a trigger that fires once when a value climbs past a line and rests a while after. CPU only: every kind's sounds
// are worked out from the skeleton and the kind's own CPU state, so no GPU readback is needed.
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';
import type { Dancer } from '../../dancer/dancer';

type V3 = [number, number, number];

/** a joint's position in the dancer's world */
export function jointAt(d: Dancer, j: number, out: V3 = [0, 0, 0]): V3 {
  const w = d.skeleton.world, o = j * JOINT_FLOATS;
  out[0] = w[o]; out[1] = w[o + 1]; out[2] = w[o + 2];
  return out;
}

/** the middle of the body (between the hips and the chest) */
export function middleOf(d: Dancer, out: V3 = [0, 0, 0]): V3 {
  const w = d.skeleton.world, h = JOINT.Hips * JOINT_FLOATS, c = JOINT.Spine1 * JOINT_FLOATS;
  out[0] = (w[h] + w[c]) / 2; out[1] = (w[h + 1] + w[c + 1]) / 2; out[2] = (w[h + 2] + w[c + 2]) / 2;
  return out;
}

const LIMB_ENDS = [JOINT.LeftHand, JOINT.RightHand, JOINT.LeftFoot, JOINT.RightFoot];

/** the fastest hand or foot (m/s; a joint's pos.w is its speed) and which joint it is */
export function fastestLimb(d: Dancer): { speed: number; joint: number } {
  const w = d.skeleton.world;
  let speed = 0, joint = LIMB_ENDS[0];
  for (const j of LIMB_ENDS) { const s = w[j * JOINT_FLOATS + 3]; if (s > speed) { speed = s; joint = j; } }
  return { speed, joint };
}

/** a number in [0, 1) from integers (the frame, a dancer, a channel): deterministic */
export function seeded(a: number, b = 0, c = 0) {
  let x = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** fires once when a value rises past `on`, then rests until it falls below `off` and `rest` seconds have passed */
export class Trigger {
  private armed = true;
  private last = -1e9;
  constructor(private on: number, private off: number, private rest = 0.2) {}
  /** true on the frame it fires */
  test(v: number, t: number) {
    if (this.armed && v >= this.on && t - this.last >= this.rest) { this.armed = false; this.last = t; return true; }
    if (!this.armed && v < this.off) this.armed = true;
    return false;
  }
}

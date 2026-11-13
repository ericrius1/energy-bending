// How a gem body moves in the game's fast moves, read off each dancer's skeleton on the CPU each frame:
//   spin and accel  every joint's angular velocity and linear acceleration, so a stone's home moves exactly with its
//                   bone (the joint's velocity plus ω × r) and, going fast, the spring is fed the bone's acceleration
//                   (centripetal too) instead of lagging it (sim.wgsl; body.wgsl's `hold`);
//   peaks           the moments a limb's end stops being fast (a kick's peak) or stops suddenly (a hand or a foot
//                   meeting the floor): the gems shed in a burst there, or a large crystal cracks, rather than leaking
//                   stones all the time it moves fast;
//   squash          a landing: the body squashes towards the ground and springs back.
// The numbers go up in the gems' Motion uniform (sim.wgsl) and to the crystals (crystals.ts).
import { LIMITS } from '../../engine/limits';
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';
import type { Dancer } from '../../dancer/dancer';
import { CAPSULES } from '../core/capsules';

const D = LIMITS.dancers, J = LIMITS.joints, SEGS = LIMITS.capsules;

/** what decides a burst (gems/params.ts) */
export interface PeakParams { peakSpeed: number; impact: number; landSquash: number }

/** a moment a capsule's limb end peaked or hit: which slot, how hard (0 … 1), how fast it was going (m/s) */
export interface Peak { slot: number; strength: number; speed: number }

// the joint whose speed says how fast a capsule's matter is going: its far end
const ENDS = CAPSULES.map((c) => JOINT[c.child as keyof typeof JOINT] ?? JOINT[c.joint as keyof typeof JOINT] ?? 0);
// the capsules whose far end can hit the floor (a hand or a foot): only they burst on an impact
const STRIKES = CAPSULES.map((c) => /Foot|Toe|Finger|HandIndex/.test(c.joint));
const FEET = [JOINT.LeftFoot, JOINT.LeftToeBase, JOINT.RightFoot, JOINT.RightToeBase];

export class GemMotion {
  /** per dancer × joint: ω (rad/s, world) and acceleration (m/s²), each a vec4 */
  readonly spin = new Float32Array(D * J * 4);
  readonly accel = new Float32Array(D * J * 4);
  /** per dancer: squash (0 … ~0.15), the ground it squashes onto, the hips' x and z */
  readonly squash = new Float32Array(D * 4);
  /** this frame's peaks */
  readonly peaks: Peak[] = [];
  private prevRot = new Float32Array(D * J * 4);
  private prevVel = new Float32Array(D * J * 3);
  private prevPos = new Float32Array(D * J * 3);
  private fresh = new Array(D).fill(true);
  private speed = new Float32Array(D * SEGS);
  private abs = new Float32Array(D * SEGS);
  private rising = new Uint8Array(D * SEGS);
  /** seconds until a capsule may burst again (a burst is an event, not a rattle) */
  private rest = new Float32Array(D * SEGS);
  private sq = new Float32Array(D * 2);   // squash, its rate
  private hipsVy = new Float32Array(D);
  /** counts for stats */
  bursts = 0;
  landings = 0;

  update(dancers: readonly Dancer[], dt: number, P: PeakParams) {
    this.peaks.length = 0;
    const n = Math.min(dancers.length, D);
    if (dt <= 1e-5) return;
    for (let d = 0; d < n; d++) this.dancer(d, dancers[d].skeleton.world, dt, P);
    for (let d = n; d < D; d++) { this.fresh[d] = true; this.squash[d * 4] = 0; }
  }

  private dancer(d: number, w: Float32Array, dt: number, P: PeakParams) {
    const fresh = this.fresh[d];
    let jumped = false;
    for (let j = 0; j < J; j++) {
      const o = j * JOINT_FLOATS, k = d * J + j;
      const dx = w[o] - this.prevPos[k * 3], dy = w[o + 1] - this.prevPos[k * 3 + 1], dz = w[o + 2] - this.prevPos[k * 3 + 2];
      if (dx * dx + dy * dy + dz * dz > 0.25) jumped = true;
    }
    // a teleport (placed, reset, carried) is not motion
    const still = fresh || jumped;
    for (let j = 0; j < J; j++) {
      const o = j * JOINT_FLOATS, k = d * J + j;
      // ω from the change of rotation: dq = q · conj(q₀), ω = axis × angle / dt (smoothed by half, as the velocities are)
      const qx = w[o + 4], qy = w[o + 5], qz = w[o + 6], qw = w[o + 7];
      const px = -this.prevRot[k * 4], py = -this.prevRot[k * 4 + 1], pz = -this.prevRot[k * 4 + 2], pw = this.prevRot[k * 4 + 3];
      let rx = qw * px + qx * pw + qy * pz - qz * py;
      let ry = qw * py - qx * pz + qy * pw + qz * px;
      let rz = qw * pz + qx * py - qy * px + qz * pw;
      let rw = qw * pw - qx * px - qy * py - qz * pz;
      if (rw < 0) { rx = -rx; ry = -ry; rz = -rz; rw = -rw; }
      const s = Math.hypot(rx, ry, rz);
      const ang = 2 * Math.atan2(s, rw);
      let f = still || s < 1e-7 ? 0 : ang / (s * dt);
      // (a turn faster than 40 rad/s is a glitch, not a move)
      if (ang / dt > 40) f *= 40 / (ang / dt);
      const sp = this.spin;
      sp[k * 4] = 0.5 * (sp[k * 4] + rx * f); sp[k * 4 + 1] = 0.5 * (sp[k * 4 + 1] + ry * f); sp[k * 4 + 2] = 0.5 * (sp[k * 4 + 2] + rz * f);
      if (still) sp.fill(0, k * 4, k * 4 + 4);
      this.prevRot.set(w.subarray(o + 4, o + 8), k * 4);
      // acceleration from the change of velocity (smoothed by half; capped)
      const ac = this.accel;
      for (let a = 0; a < 3; a++) {
        const acc = still ? 0 : (w[o + 8 + a] - this.prevVel[k * 3 + a]) / dt;
        ac[k * 4 + a] = 0.5 * (ac[k * 4 + a] + acc);
        this.prevVel[k * 3 + a] = w[o + 8 + a];
        this.prevPos[k * 3 + a] = w[o + a];
      }
      const am = Math.hypot(ac[k * 4], ac[k * 4 + 1], ac[k * 4 + 2]);
      if (am > 150) for (let a = 0; a < 3; a++) ac[k * 4 + a] *= 150 / am;
    }
    this.fresh[d] = false;

    // (a peak is measured against the hips: a kick is a limb moving on the body, a jump's apex is not)
    const hx = w[8], hy = w[9], hz = w[10];
    // peaks: a capsule's far end was fast and has just started to slow (a kick at full stretch), or slowed hard in a
    // frame (a hand or a foot meeting the floor)
    for (let c = 0; c < CAPSULES.length; c++) {
      const e = ENDS[c] * JOINT_FLOATS, i = d * SEGS + c;
      const v = Math.hypot(w[e + 8] - hx, w[e + 9] - hy, w[e + 10] - hz);
      const was = this.speed[i];
      this.speed[i] = v;
      const va = Math.hypot(w[e + 8], w[e + 9], w[e + 10]), wasA = this.abs[i];
      this.abs[i] = va;
      this.rest[i] = Math.max(0, this.rest[i] - dt);
      if (still) { this.rising[i] = 0; continue; }
      const decel = STRIKES[c] ? (wasA - va) / dt : 0;
      if (v > was && decel <= P.impact) { this.rising[i] = 1; continue; }
      let strength = 0;
      if (this.rising[i] && v <= was && was > P.peakSpeed) strength = Math.min(1, (was - P.peakSpeed) / P.peakSpeed + 0.35);
      if (decel > P.impact && wasA > 2.5) strength = Math.max(strength, Math.min(1, decel / (P.impact * 2) + 0.3));
      this.rising[i] = 0;
      if (strength > 0 && this.rest[i] <= 0) { this.rest[i] = 0.7; this.peaks.push({ slot: i, strength, speed: was }); this.bursts++; }
    }

    // a landing: the hips were falling and have stopped; the body squashes onto the ground and springs back
    const vy = w[JOINT.Hips * JOINT_FLOATS + 9];
    const was = this.hipsVy[d];
    this.hipsVy[d] = vy;
    const q = this.sq;
    if (!still && was < -2 && vy - was > 1.2) {
      q[d * 2 + 1] += Math.min(1.2, -was * 0.12) * P.landSquash;
      let ground = Infinity;
      for (const j of FEET) ground = Math.min(ground, w[j * JOINT_FLOATS + 1]);
      this.squash[d * 4 + 1] = ground;
      this.landings++;
    }
    // a stiff damped spring (about 4 Hz, a bounce and a half)
    q[d * 2 + 1] += (-q[d * 2] * 600 - q[d * 2 + 1] * 22) * dt;
    q[d * 2] = Math.max(-0.05, Math.min(0.18, q[d * 2] + q[d * 2 + 1] * dt));
    if (still) q[d * 2] = q[d * 2 + 1] = 0;
    this.squash[d * 4] = q[d * 2];
    this.squash[d * 4 + 2] = w[0];
    this.squash[d * 4 + 3] = w[2];
  }
}

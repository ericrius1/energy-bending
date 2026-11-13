// A stand-in dancer for the lab: a skeleton laid out the way the GPU reads joints (12 floats each: position and
// speed, rotation, velocity), moved by a few sine waves instead of mocap. Feet step and land, hands sweep and flick,
// the hips bounce and sway, so the score's feet, the conductor's melody and the groove's intensity all have something
// to hear without the GPU or the clips. `energy` scales how hard it dances (0 still … 1 wild).
import { JOINT, MAXJ } from '../../skeleton/rig';
import type { Dancer } from '../../dancer/dancer';

const NAMES = Object.keys(JOINT);

export interface LabDancer { dancer: Dancer; pose(t: number, dt: number, energy: number): void }

export function labDancer(id: string, kind: string, x0: number, z0: number, seed = 0): LabDancer {
  const world = new Float32Array(MAXJ * 12);
  const prev = new Float32Array(MAXJ * 3);
  let first = true;
  const dancer = {
    id, loadout: { layers: [] },
    controller: { kind },
    skeleton: { world, count: NAMES.length },
    rig: { joints: NAMES.map((name) => ({ name })) },
  } as unknown as Dancer;
  const set = (j: number, x: number, y: number, z: number) => { world[j * 12] = x; world[j * 12 + 1] = y; world[j * 12 + 2] = z; };
  return {
    dancer,
    pose(t, dt, e) {
      const ph = t * Math.PI * 2, s = seed * 1.7;
      const bounce = 0.04 * e * Math.max(0, Math.sin(ph * 1.8 + s)), sway = 0.12 * e * Math.sin(ph * 0.45 + s);
      const hx = x0 + sway, hy = 0.98 + bounce;
      for (let j = 0; j < NAMES.length; j++) set(j, hx, hy, z0);
      set(JOINT.Head, hx, hy + 0.66, z0);
      set(JOINT.LeftShoulder, hx + 0.19, hy + 0.47, z0);
      set(JOINT.RightShoulder, hx - 0.19, hy + 0.47, z0);
      // feet: alternate steps, lifted 12 cm × energy and put down
      const step = (o: number) => Math.max(0, Math.sin(ph * 0.95 + o + s)) * 0.12 * Math.min(1, e * 1.5);
      set(JOINT.LeftToeBase, hx + 0.12, 0.03 + step(0), z0 + 0.1);
      set(JOINT.RightToeBase, hx - 0.12, 0.03 + step(Math.PI), z0 + 0.1);
      // hands: slow arcs, and every couple of seconds a quick flick of the right hand
      const flick = Math.exp(-Math.pow(((t + seed) % 2.3) - 1.9, 2) * 90);
      set(JOINT.LeftHand, hx + 0.35 + 0.25 * e * Math.sin(ph * 0.6 + s), hy + 0.25 + 0.55 * e * Math.sin(ph * 0.33 + s), z0 + 0.2 * Math.cos(ph * 0.6));
      set(JOINT.RightHand, hx - 0.35 - 0.3 * e * Math.sin(ph * 0.7 + 1 + s) - 0.5 * flick * e, hy + 0.3 + 0.6 * e * Math.sin(ph * 0.41 + 2 + s) + 0.3 * flick * e, z0 + 0.25 * Math.sin(ph * 0.7));
      // velocities and speeds, from the last pose
      for (let j = 0; j < NAMES.length; j++) {
        const o = j * 12;
        for (let a = 0; a < 3; a++) {
          const v = first ? 0 : (world[o + a] - prev[j * 3 + a]) / Math.max(dt, 1e-3);
          world[o + 8 + a] = v; prev[j * 3 + a] = world[o + a];
        }
        world[o + 3] = Math.hypot(world[o + 8], world[o + 9], world[o + 10]);
      }
      first = false;
    },
  };
}

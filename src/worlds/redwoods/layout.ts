// Where everything in the redwoods stands: a fairy ring of nine old redwoods round the clearing (the ring that grows
// from the roots of a fallen giant), the wood beyond them fading into the mist, low limbs reaching in over the
// clearing, paper lanterns hung from them on cords. Laid out once from a seed (Gem Dancers' forest.ts).
import { mulberry32 } from 'math/random';
import { LIMITS } from '../../engine/limits';
import { cylinder, type Solid } from '../solids';

/** the fairy ring's radius (m) */
export const RING = 12.6;
const MAXLAMP = LIMITS.lanterns;
const MAXTRUNK = LIMITS.trunks;
/** a log as the trunks shader reads it: foot xyz, radius; axis xyz, length; tip radius, flare, droop, seed */
const LOG = 12;

export interface Lantern { anchor: [number, number, number]; cord: number; size: number; at: number; ax: number; az: number; vx: number; vz: number; seed: number }

export interface Layout {
  /** every log: the near trunks, the far trunks, then the limbs */
  logs: Float32Array;
  near: number;
  far: number;
  limbs: number;
  /** each trunk for the light (the nearest first): x, z, radius, height */
  trunks: Float32Array;
  lanterns: Lantern[];
}

export function layoutWoods(seed = 7): Layout {
  const rng = mulberry32.create(seed);
  const r = () => mulberry32.sample(rng);
  type Trunk = { x: number; z: number; R: number; H: number };
  const trunks: Trunk[] = [];
  // the ring: nine big trees round the clearing
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.21 + (r() - 0.5) * 0.25;
    const rr = RING + (r() - 0.5) * 1.3;
    trunks.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, R: 1.0 + 0.6 * r(), H: 72 + 22 * r() });
  }
  // the wood beyond: darts thrown into the ring of land outside, kept where there's room
  for (let tries = 0; tries < 3000 && trunks.length < MAXTRUNK + 6; tries++) {
    const a = r() * Math.PI * 2, rr = 17 + 66 * Math.sqrt(r());
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr, R = 0.45 + 1.35 * r() * r();
    if (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < 4.2 + (t.R + R) * 1.7)) continue;
    trunks.push({ x, z, R, H: 50 + 45 * r() });
  }
  trunks.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
  const near = Math.min(14, trunks.length), far = trunks.length - near;

  // the limbs: one or two from each tree of the ring, reaching in over the clearing a little above the lanterns
  type Limb = { foot: [number, number, number]; axis: [number, number, number]; len: number; R: number; droop: number };
  const limbs: Limb[] = [];
  const ring = trunks.filter((t) => Math.hypot(t.x, t.z) < RING + 2);
  ring.forEach((t, k) => {
    const n = k % 3 === 1 ? 2 : 1;
    for (let j = 0; j < n; j++) {
      const toward = Math.atan2(-t.z, -t.x) + (r() - 0.5) * 1.1 + (j ? 0.7 : 0);
      const up = 0.12 + 0.22 * r();
      const y = 6.5 + 4.5 * r();
      const dir: [number, number, number] = [Math.cos(toward) * Math.cos(up), Math.sin(up), Math.sin(toward) * Math.cos(up)];
      limbs.push({ foot: [t.x, y, t.z], axis: dir, len: t.R * 1.2 + 4.8 + 2.8 * r(), R: 0.15 + 0.1 * r(), droop: 0.7 + 0.9 * r() });
    }
  });

  const logs = new Float32Array((trunks.length + limbs.length) * LOG);
  trunks.forEach((t, i) => {
    const lx = (r() - 0.5) * 0.04, lz = (r() - 0.5) * 0.04, l = Math.hypot(lx, 1, lz);
    logs.set([t.x, -0.3, t.z, t.R, lx / l, 1 / l, lz / l, t.H, 0.04, 0.85, 0, r()], i * LOG);
  });
  limbs.forEach((b, i) => logs.set([...b.foot, b.R, ...b.axis, b.len, 0.22, 0, b.droop, r()], (trunks.length + i) * LOG));

  const light = new Float32Array(MAXTRUNK * 4);
  trunks.slice(0, MAXTRUNK).forEach((t, i) => light.set([t.x, t.z, t.R, t.H], i * 4));

  // the lanterns, along the limbs (a point s along one: its foot, out along its axis, sagging towards the tip)
  const lanterns: Lantern[] = [];
  for (let pass = 0; lanterns.length < MAXLAMP && pass < 4; pass++) {
    for (const b of limbs) {
      if (lanterns.length >= MAXLAMP) break;
      const u = 0.5 + 0.45 * r();
      const s = u * b.len;
      const anchor: [number, number, number] = [b.foot[0] + b.axis[0] * s, b.foot[1] + b.axis[1] * s - b.droop * u * u, b.foot[2] + b.axis[2] * s];
      if (pass && lanterns.some((l) => Math.hypot(l.anchor[0] - anchor[0], l.anchor[2] - anchor[2]) < 1.4)) continue;
      // hung anywhere from a little over head height up into the limbs
      const bottom = 2.6 + 4.2 * r();
      lanterns.push({ anchor, cord: Math.max(0.6, anchor[1] - bottom), size: 0.16 + 0.11 * r(), at: 4.5 - 6 * r(), ax: 0, az: 0, vx: 0, vz: 0, seed: r() * 100 });
    }
  }
  return { logs, near, far, limbs: limbs.length, trunks: light, lanterns };
}

/** the trees as the camera's solids (World.solids), from the logs they're drawn from: each trunk a tall cylinder of its
 *  radius and a short fat one round its flared foot (the buttresses), each limb two capsules following its droop */
export function solidsOfWoods(L: Layout): Solid[] {
  const out: Solid[] = [];
  const g = L.logs;
  for (let i = 0; i < L.near + L.far; i++) {
    const o = i * LOG, x = g[o], y = g[o + 1], z = g[o + 2], R = g[o + 3], len = g[o + 7];
    out.push(cylinder([x, y, z], [x + g[o + 4] * len, y + g[o + 5] * len, z + g[o + 6] * len], R));
    out.push(cylinder([x, y, z], [x, 1.6, z], R * (1 + g[o + 9] * 0.75)));
  }
  for (let i = L.near + L.far; i < L.near + L.far + L.limbs; i++) {
    const o = i * LOG, R = g[o + 3], len = g[o + 7], droop = g[o + 10];
    const at = (u: number): [number, number, number] => [g[o] + g[o + 4] * len * u, g[o + 1] + g[o + 5] * len * u - droop * u * u, g[o + 2] + g[o + 6] * len * u];
    out.push({ kind: 'capsule', a: at(0), b: at(0.5), r: R }, { kind: 'capsule', a: at(0.5), b: at(1), r: R * 0.7 });
  }
  return out;
}

// What a free brain knows of a world's solid things (World.solids, src/worlds/solids.ts: the one description the camera
// and World.clear read too): where their footprints are on the floor, so a free pair circling in the redwoods keeps
// off the fallen log and a free dancer off the temple's columns. Only what stands in a body's way counts (a solid that
// reaches below 1.2 m over the floor, and not one high overhead: a bough, a lintel); a box or capsule is taken as its
// footprint on the floor plane. Pure arithmetic, run per brain per frame against a handful of nearby solids.
import type { Solid } from '../worlds/solids';

/** a body's radius as the brains keep it from a solid (m), and how far out the push starts */
const BODY_R = 0.32, REACH = 0.55;

/** the push (a unit direction on the floor, and 0 … 1 how hard) away from the nearest solid footprint within reach of
 *  (x, z) for a body standing at floor height y; null when nothing is near */
export function solidPush(solids: readonly Solid[] | undefined, x: number, y: number, z: number): { x: number; z: number; k: number } | null {
  if (!solids?.length) return null;
  let best: { x: number; z: number; k: number } | null = null;
  for (const s of solids) {
    let px: number, pz: number, r: number;
    if (s.kind === 'capsule') {
      // the nearest point of the axis to the body (in 3D, from the body's middle), then its footprint
      if (Math.min(s.a[1], s.b[1]) - s.r > y + 1.2) continue;
      if (Math.max(s.a[1], s.b[1]) + s.r < y + 0.05) continue;
      const ax = s.b[0] - s.a[0], ay = s.b[1] - s.a[1], az = s.b[2] - s.a[2], L2 = ax * ax + ay * ay + az * az;
      const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - s.a[0]) * ax + (y + 0.6 - s.a[1]) * ay + (z - s.a[2]) * az) / L2)) : 0;
      px = s.a[0] + ax * u; pz = s.a[2] + az * u; r = s.r;
    } else {
      // a box: its footprint is the box's extent along its axes projected on the floor (the axes are near level)
      const lo = s.c[1] - Math.abs(s.y[1]) * s.h[1] - Math.abs(s.x[1]) * s.h[0] - Math.abs(s.z[1]) * s.h[2];
      const hi = s.c[1] + Math.abs(s.y[1]) * s.h[1] + Math.abs(s.x[1]) * s.h[0] + Math.abs(s.z[1]) * s.h[2];
      if (lo > y + 1.2 || hi < y + 0.05) continue;
      const dx = x - s.c[0], dz = z - s.c[2];
      const lx = dx * s.x[0] + dz * s.x[2], lz = dx * s.z[0] + dz * s.z[2];
      const cx = Math.max(-s.h[0], Math.min(s.h[0], lx)), cz = Math.max(-s.h[2], Math.min(s.h[2], lz));
      px = s.c[0] + s.x[0] * cx + s.z[0] * cz; pz = s.c[2] + s.x[2] * cx + s.z[2] * cz; r = 0;
    }
    let ox = x - px, oz = z - pz;
    const d = Math.hypot(ox, oz), gap = d - r - BODY_R;
    if (gap > REACH) continue;
    if (d < 1e-4) { ox = 1; oz = 0; } else { ox /= d; oz /= d; }
    const k = Math.max(0, Math.min(1, 1 - gap / REACH));
    if (!best || k > best.k) best = { x: ox, z: oz, k };
  }
  return best;
}

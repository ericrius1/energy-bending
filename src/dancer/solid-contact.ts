// A body against the world's solids (World.solids, src/worlds/solids.ts: capsules and boxes) in free 3D: how far a
// point is from a solid's surface and the way out of it, where a solid's top is under a point (a floor to stand on),
// and a bound to skip the far ones. The Character (character.ts) samples its axis at a few heights against these: the
// faces it meets stop it and are its walls (slide, kick off, run along), the tops are floors. Pure; runs in Node.
import type { Solid } from '../worlds/solids';
export type { Solid };

type V3 = [number, number, number];
export interface Contact { d: number; n: V3 }

/** the gap from p to the solid's surface (negative inside) and the unit normal out of it toward p, into `out` */
export function solidContact(s: Solid, px: number, py: number, pz: number, out: Contact): Contact {
  if (s.kind === 'capsule') {
    const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2], L2 = bx * bx + by * by + bz * bz;
    const ax = px - s.a[0], ay = py - s.a[1], az = pz - s.a[2];
    const t = L2 > 1e-12 ? Math.max(0, Math.min(1, (ax * bx + ay * by + az * bz) / L2)) : 0;
    const vx = ax - bx * t, vy = ay - by * t, vz = az - bz * t, L = Math.hypot(vx, vy, vz);
    out.d = L - s.r;
    if (L > 1e-9) { out.n[0] = vx / L; out.n[1] = vy / L; out.n[2] = vz / L; } else { out.n[0] = 1; out.n[1] = 0; out.n[2] = 0; }
    return out;
  }
  const qx = px - s.c[0], qy = py - s.c[1], qz = pz - s.c[2];
  const ax = [s.x, s.y, s.z];
  const l = ax.map((a) => qx * a[0] + qy * a[1] + qz * a[2]);
  let outside = false;
  const c = l.map((v, k) => { const w = Math.max(-s.h[k], Math.min(s.h[k], v)); if (w !== v) outside = true; return w; });
  if (outside) {
    const dl = [l[0] - c[0], l[1] - c[1], l[2] - c[2]], L = Math.hypot(dl[0], dl[1], dl[2]);
    out.d = L;
    for (let i = 0; i < 3; i++) out.n[i] = (ax[0][i] * dl[0] + ax[1][i] * dl[1] + ax[2][i] * dl[2]) / L;
    return out;
  }
  // inside: out through the nearest face
  let k = 0, pen = Infinity;
  for (let i = 0; i < 3; i++) { const p = s.h[i] - Math.abs(l[i]); if (p < pen) { pen = p; k = i; } }
  const sg = l[k] < 0 ? -1 : 1;
  out.d = -pen;
  for (let i = 0; i < 3; i++) out.n[i] = ax[k][i] * sg;
  return out;
}

/** the height of a solid's top under (x, z), or -Infinity where it has none to stand on there: an upright box's top
 *  (its footprint grown by `margin`), a standing capsule's crown, a lying one's back (a log, a bough). Tipped boxes
 *  (blades) and steep capsules give none: they are walls, not floors */
export function solidTop(s: Solid, x: number, z: number, margin = 0.08): number {
  if (s.kind === 'box') {
    if (Math.abs(s.y[1]) < 0.95) return -Infinity;
    const qx = x - s.c[0], qz = z - s.c[2];
    const lx = qx * s.x[0] + qz * s.x[2], lz = qx * s.z[0] + qz * s.z[2];
    if (Math.abs(lx) > s.h[0] + margin || Math.abs(lz) > s.h[2] + margin) return -Infinity;
    return s.c[1] + s.h[1] * Math.abs(s.y[1]) + s.h[0] * Math.abs(s.x[1]) + s.h[2] * Math.abs(s.z[1]);
  }
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], dz = s.b[2] - s.a[2], L = Math.hypot(dx, dy, dz);
  if (L < 1e-6 || Math.abs(dy) / L > 0.9) {
    const t = s.a[1] >= s.b[1] ? s.a : s.b, hd = Math.hypot(x - t[0], z - t[2]);
    if (hd > s.r + margin) return -Infinity;
    return t[1] + Math.sqrt(Math.max(0, s.r * s.r - Math.min(hd, s.r) ** 2));
  }
  if (Math.abs(dy) / L > 0.5) return -Infinity;
  const h2 = dx * dx + dz * dz, u = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[2]) * dz) / h2));
  const qx = s.a[0] + dx * u, qy = s.a[1] + dy * u, qz = s.a[2] + dz * u, hd = Math.hypot(x - qx, z - qz);
  if (hd > s.r * 0.85) return -Infinity;
  return qy + Math.sqrt(s.r * s.r - hd * hd);
}

/** a bounding sphere's middle and radius, and the solid's height span (cached per solid) */
const bounds = new WeakMap<Solid, { c: V3; R: number; y0: number; y1: number }>();
export function solidBound(s: Solid) {
  let b = bounds.get(s);
  if (!b) {
    if (s.kind === 'capsule') {
      b = { c: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2], R: Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]) / 2 + s.r,
        y0: Math.min(s.a[1], s.b[1]) - s.r, y1: Math.max(s.a[1], s.b[1]) + s.r };
    } else {
      const ey = Math.abs(s.x[1]) * s.h[0] + Math.abs(s.y[1]) * s.h[1] + Math.abs(s.z[1]) * s.h[2];
      b = { c: [s.c[0], s.c[1], s.c[2]], R: Math.hypot(s.h[0], s.h[1], s.h[2]), y0: s.c[1] - ey, y1: s.c[1] + ey };
    }
    bounds.set(s, b);
  }
  return b;
}

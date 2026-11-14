// A world's big solid things as simple shapes (World.solids), the one description every reader shares: the camera
// keeps its eye out of them (engine/camera.ts `Solids`), World.clear answers from them, and the brains keep a free
// pair off them (ai's Sight.solids). Capsules (a segment and a radius: trunks, logs, boughs, columns lying or standing;
// a sphere when a = b) and boxes (a middle, three unit axes and the half extents along them: blocks, lintels, altars,
// slabs, blades). A world builds them once from the same description it builds its geometry from, in its own
// coordinates; rough is fine (a few centimetres fat rather than thin; nothing under about 30 cm). `clearOf` answers
// World.clear: how much of a segment is clear, with a margin round every solid (the eye's near plane and a little air).
// A solid the segment starts inside is ignored, so a look point that happens to be inside a margin (a dancer standing on
// a stump) doesn't pull the camera in to nothing.
type V3 = [number, number, number];

export type Solid =
  | { kind: 'capsule'; a: V3; b: V3; r: number }
  | { kind: 'box'; c: V3; x: V3; y: V3; z: V3; h: V3 };

/** a box by its middle and half sizes, turned `yaw` about up (local x → (cos, 0, −sin), local z → (sin, 0, cos): the
 *  temple's and the geode's convention) */
export function box(c: V3, half: V3, yaw = 0): Solid {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return { kind: 'box', c, x: [cy, 0, -sy], y: [0, 1, 0], z: [sy, 0, cy], h: half };
}

/** a box standing on `foot` (the middle of its underside), turned `yaw` about up and tipped `pitch` up about its own x */
export function boxOn(foot: V3, size: V3, yaw = 0, pitch = 0): Solid {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x: V3 = [cy, 0, -sy], y: V3 = [-sp * sy, cp, -sp * cy], z: V3 = [cp * sy, sp, cp * cy];
  const h: V3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  return { kind: 'box', c: [foot[0] + y[0] * h[1], foot[1] + y[1] * h[1], foot[2] + y[2] * h[1]], x, y, z, h };
}

/** a standing or lying cylinder (foot to top, radius r) as a capsule whose round ends stop at the foot and the top */
export function cylinder(foot: V3, top: V3, r: number): Solid {
  const d: V3 = [top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]], L = Math.hypot(...d) || 1, k = Math.min(r, L / 2) / L;
  return { kind: 'capsule', a: [foot[0] + d[0] * k, foot[1] + d[1] * k, foot[2] + d[2] * k], b: [top[0] - d[0] * k, top[1] - d[1] * k, top[2] - d[2] * k], r };
}

/** where along the ray o + d·t (t ≥ 0) it first enters the capsule, or Infinity; -1 if o is inside it (iq's capsule) */
function hitCapsule(o: V3, d: V3, a: V3, b: V3, r: number) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], oa = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const baba = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const bard = ba[0] * d[0] + ba[1] * d[1] + ba[2] * d[2];
  const baoa = ba[0] * oa[0] + ba[1] * oa[1] + ba[2] * oa[2];
  const rdoa = d[0] * oa[0] + d[1] * oa[1] + d[2] * oa[2];
  const oaoa = oa[0] * oa[0] + oa[1] * oa[1] + oa[2] * oa[2];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  // inside: the nearest point of the axis is within r
  const h0 = baba > 0 ? Math.max(0, Math.min(1, baoa / baba)) : 0;
  if (Math.hypot(oa[0] - ba[0] * h0, oa[1] - ba[1] * h0, oa[2] - ba[2] * h0) < r) return -1;
  const A = baba * dd - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  if (A > 1e-12) {
    const h = B * B - A * C;
    if (h >= 0) {
      const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard;
      if (t >= 0 && y > 0 && y < baba) return t;
    }
  }
  // the round ends
  let best = Infinity;
  for (const c of [a, b]) {
    const oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
    const bb = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2], cc = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - r * r;
    const h = bb * bb - dd * cc;
    if (h >= 0) { const t = (-bb - Math.sqrt(h)) / dd; if (t >= 0) best = Math.min(best, t); }
  }
  return best;
}

/** where along o + d·t the ray first enters the box (grown by m all round), or Infinity; -1 if o is inside */
function hitBox(o: V3, d: V3, s: Extract<Solid, { kind: 'box' }>, m: number) {
  // into the box's own frame (its three axes)
  const px = o[0] - s.c[0], py = o[1] - s.c[1], pz = o[2] - s.c[2];
  const dot = (a: V3, x: number, y: number, z: number) => a[0] * x + a[1] * y + a[2] * z;
  const lo = [dot(s.x, px, py, pz), dot(s.y, px, py, pz), dot(s.z, px, py, pz)];
  const ld = [dot(s.x, d[0], d[1], d[2]), dot(s.y, d[0], d[1], d[2]), dot(s.z, d[0], d[1], d[2])];
  const h = [s.h[0] + m, s.h[1] + m, s.h[2] + m];
  if (Math.abs(lo[0]) < h[0] && Math.abs(lo[1]) < h[1] && Math.abs(lo[2]) < h[2]) return -1;
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ld[k]) < 1e-12) { if (Math.abs(lo[k]) >= h[k]) return Infinity; continue; }
    let a = (-h[k] - lo[k]) / ld[k], b = (h[k] - lo[k]) / ld[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** how far p is from a solid's surface (negative inside) */
function distOf(s: Solid, p: V3) {
  if (s.kind === 'capsule') {
    const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2], L2 = bx * bx + by * by + bz * bz;
    const px = p[0] - s.a[0], py = p[1] - s.a[1], pz = p[2] - s.a[2];
    const t = L2 > 1e-12 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / L2)) : 0;
    return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - s.r;
  }
  const px = p[0] - s.c[0], py = p[1] - s.c[1], pz = p[2] - s.c[2];
  const q = [s.x, s.y, s.z].map((ax, k) => Math.abs(px * ax[0] + py * ax[1] + pz * ax[2]) - s.h[k]);
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0);
}

/** how much of the segment a → b (0 … 1, from a) is clear of the solids, each grown by `margin` (m). A start nearer a
 *  solid than the margin (a dancer standing on a slab of columns, the look point a hand's breadth over the crown)
 *  shrinks the margin to start clear of all of them, as the camera's own sweep does: otherwise the grown slab next to
 *  the one underfoot read as 0 clear for any boom not rising steeply, and pinned the eye at its 0.9 m (9-stage.md: the
 *  retired forge's orbit with the pair on its crown) */
export function clearOf(solids: readonly Solid[], a: V3, b: V3, margin = 0.4) {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 1e-12) return 1;
  for (const s of solids) {
    const e = distOf(s, a);
    if (e > 0 && e < margin) margin = e * 0.95;
  }
  let best = 1;
  for (const s of solids) {
    const t = s.kind === 'capsule' ? hitCapsule(a, d, s.a, s.b, s.r + margin) : hitBox(a, d, s, margin);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

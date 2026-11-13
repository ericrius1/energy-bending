// A world's big solid things as simple shapes, for a camera that must not stand inside one (World.solids, World.clear):
// capsules (a segment and a radius: trunks, logs, boughs, columns lying or standing) and boxes (a centre, half sizes
// along the box's own axes, turned about up: blocks, lintels, altars). A world builds them from the same description
// it builds its geometry from, once. `clearOf` answers World.clear from them: how much of a segment is clear, with a
// margin round every solid (the eye's near plane and a little air). A solid the segment starts inside is ignored, so a
// look point that happens to be inside a margin (a dancer standing on a stump) doesn't pull the camera in to nothing.
type V3 = [number, number, number];

export type Solid =
  | { kind: 'capsule'; a: V3; b: V3; r: number }
  | { kind: 'box'; c: V3; half: V3; yaw: number };

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
function hitBox(o: V3, d: V3, c: V3, half: V3, yaw: number, m: number) {
  // into the box's own frame (stones.wgsl `place`: x' = x cos + z sin, z' = -x sin + z cos is the box's turn)
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const px = o[0] - c[0], py = o[1] - c[1], pz = o[2] - c[2];
  const lo = [px * cs - pz * sn, py, px * sn + pz * cs], ld = [d[0] * cs - d[2] * sn, d[1], d[0] * sn + d[2] * cs];
  const h = [half[0] + m, half[1] + m, half[2] + m];
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

/** how much of the segment a → b (0 … 1, from a) is clear of the solids, each grown by `margin` (m) */
export function clearOf(solids: readonly Solid[], a: V3, b: V3, margin = 0.4) {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 1e-12) return 1;
  let best = 1;
  for (const s of solids) {
    const t = s.kind === 'capsule' ? hitCapsule(a, d, s.a, s.b, s.r + margin) : hitBox(a, d, s.c, s.half, s.yaw, margin);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

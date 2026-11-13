// The geode's stage and its great crystals, from one description. The stage is a plane through the middle; its ledges
// are three great blades of selenite (like the beams in the Naica cave), their tops flat, each a ledge exactly where
// the blade the eye sees is: two grown out of druses of tall crystals at either end of the stage, running along the
// plane to their tips, and a high one out of a tall druse behind the middle, reaching out over it. Smaller points
// cluster round their roots. Round the room, clusters of great crystals stand out from the wall (in its veins'
// colours) to catch the light, and round every gate a ring of crystals has grown about its disc, in its world's colour,
// so the hub reads as a room of doors. The blades are drawn by shelves.wgsl, the points (druses, clusters, crowns) by
// crystals.wgsl, one instance each.
import { mulberry32 } from 'math/random';
import type { Ledge } from '../stage';
import type { Solid } from '../solids';

/** a blade: where its top's middle leaves the wall (x, y, z), its turn about up (0: it grows along +z; a quarter turn along +x)
 *  and its tilt up from level; its width, thickness and length; how long its chisel tip is; a seed; its tint (-1
 *  selenite, 0 … 3 a gate's world, 4 the wall's veins) and how strongly it glows from within */
export interface Blade { at: [number, number, number]; yaw: number; pitch: number; w: number; thick: number; len: number; tip: number; seed: number; tint?: number; glow?: number }

export const BLADE_FLOATS = 12;

/** a gate the crystals grow round: its disc's middle, the way it faces, its radius, its world's tint (0 … 3) */
export interface GateSite { at: [number, number, number]; normal: [number, number, number]; radius: number; tint: number }

type V3 = [number, number, number];

/** yaw and pitch that point a blade along d */
function aim(d: V3): { yaw: number; pitch: number } {
  const l = Math.hypot(...d) || 1;
  return { yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / l))) };
}

/** The stage is the plane through the middle (where the dancers are), seen from the front. Its ledges: a low blade from
 *  a druse at the left end and a middling one from the right, each running along the plane to its tip, and a high one
 *  from a druse behind the middle, reaching out over it, across the plane. */
export function layoutShelves(o: { caveRadius: number; gates?: GateSite[]; seed?: number }) {
  const rng = mulberry32.create(o.seed ?? 5);
  const r = () => mulberry32.sample(rng);
  const ledges: Ledge[] = [];
  const blades: Blade[] = [];
  /** the crystal points (druses, the wall's clusters, the gates' crowns): the same rows, drawn by crystals.wgsl */
  const points: Blade[] = [];
  // a shelf is a raft of prisms grown side by side, their tops flush (the ledge), each a little longer or shorter past
  // where the ledge ends; across: which way is across them (unit, level)
  const raft = (root: V3, yaw: number, across: [number, number], w: number, len: number) => {
    const n = Math.max(2, Math.round(w / 0.7)), pw = w / n;
    for (let k = 0; k < n; k++) {
      const off = (k + 0.5) * pw - w / 2;
      blades.push({ at: [root[0] + across[0] * off, root[1], root[2] + across[1] * off], yaw, pitch: 0, w: pw * 0.97, thick: pw * (0.75 + 0.35 * r()), len: len + 0.45 * r(), tip: 0.9 + 0.5 * r(), seed: r() });
    }
  };
  const cluster = (x: number, y: number, z: number, yaw: number) => {
    // smaller points round a blade's root, splayed
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + r() * 0.9;
      const w = 0.12 + 0.22 * r();
      const side = Math.cos(a) * (0.5 + 0.7 * r()), up = Math.sin(a) * (0.35 + 0.5 * r());
      blades.push({
        at: [x + Math.cos(yaw) * side, Math.max(0.15, y + up - 0.15), z - Math.sin(yaw) * side], yaw: yaw + (r() - 0.5) * 1.1, pitch: (r() - 0.3) * 0.9,
        w, thick: w * (0.6 + 0.4 * r()), len: 0.6 + 1.3 * r(), tip: 0.35 + 0.35 * r(), seed: r(),
      });
    }
  };
  // a crystal point (crystals.wgsl): its root, the way it points, its width and length, its colour and glow
  const point = (at: V3, dir: V3, w: number, len: number, tint: number, glow: number) => {
    points.push({ at, ...aim(dir), w, thick: w, len, tip: w * (0.9 + 0.8 * r()), seed: r(), tint, glow });
  };
  // a druse: crystal points standing out of the floor round (x, z), leaning out, the tallest reaching `high`
  const druse = (x: number, z: number, high: number, n: number, spread: number, tint = -1, glow = 0.3) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, rr = spread * Math.sqrt(r()) * (k === 0 ? 0.2 : 1), lean = (0.12 + 0.4 * r()) * (k === 0 ? 0.3 : 1);
      point([x + Math.cos(a) * rr, 0.0, z + Math.sin(a) * rr], [Math.cos(a) * lean, 1, Math.sin(a) * lean],
        (0.16 + 0.22 * r()) * (k === 0 ? 1.6 : 1), (k === 0 ? 1 : 0.3 + 0.55 * r()) * high, tint, glow);
    }
  };
  // the side blades: out of a druse at each end, along the plane (their width across it), ledges from the stage's
  // edge to their tips
  for (const [id, side, y, tipX, w, thick] of [['shelfL', -1, 1.1, -3.55, 1.5, 0.42], ['shelfR', 1, 1.9, 3.5, 1.4, 0.45]] as const) {
    const root = side * 7.4;
    raft([root, y, 0], -side * Math.PI / 2, [0, 1], w, Math.abs(tipX - root));
    // (the low one stands in the way at knee height: solid; the other you jump up through)
    ledges.push({ id, x0: side < 0 ? -5.75 : tipX, x1: side < 0 ? tipX : 5.75, y, thick, ...(y < 1.5 ? { solid: true } : {}) });
    druse(side * 7.7, 0, y + 1.3, 6, 0.8, 4, 0.55);
    cluster(side * 6.9, y, 0, -side * Math.PI / 2);
  }
  // the high blade: out of a tall druse behind the middle, 0.7 m past the plane (it and its cluster are the last blades:
  // the front of the game draws the ones before high only)
  const high = blades.length;
  const hy = 3.1, hw = 2.2, hz = -4.4;
  raft([0, hy, hz], 0, [1, 0], hw, 0.7 - hz);
  ledges.push({ id: 'shelfC', x0: -hw / 2, x1: hw / 2, y: hy, thick: 0.5 });
  druse(0, hz - 0.4, hy + 1.6, 7, 1.0, 4, 0.55);
  cluster(0, hy, hz + 0.6, 0);
  // great crystals round the wall, behind and beside the stage (the gates have the front), in the wall's colours
  const R = o.caveRadius;
  for (const deg of [-12, -48, -85, -128, -165, 192]) {
    const a = (deg * Math.PI) / 180, at = R - 1.4 - 0.8 * r();
    druse(Math.cos(a) * at, Math.sin(a) * at, 2.4 + 2.6 * r(), 3 + Math.floor(r() * 3), 1.0, 4, 0.8);
  }
  // round each gate's disc a crown of crystals grown on its rim, a little behind it, pointing out and toward the room,
  // longer at its foot and sides; and a few on the floor either side of the way in
  for (const g of o.gates ?? []) {
    const n = g.normal, T: V3 = [n[2], 0, -n[0]];
    const N = 22;
    for (let k = 0; k < N; k++) {
      const a = -0.5 + (k / (N - 1)) * (Math.PI + 1.0) + (r() - 0.5) * 0.1;
      const rad: V3 = [T[0] * Math.cos(a), Math.sin(a), T[2] * Math.cos(a)];
      const rim = g.radius + 0.06 + 0.06 * r();
      const at: V3 = [g.at[0] + rad[0] * rim - n[0] * 0.12, Math.max(0.03, g.at[1] + rad[1] * rim), g.at[2] + rad[2] * rim - n[2] * 0.12];
      const out: V3 = [rad[0] + 0.3 * (r() - 0.5) + n[0] * 0.45, rad[1] + 0.15, rad[2] + 0.3 * (r() - 0.5) + n[2] * 0.45];
      const low = 1 - Math.max(0, Math.sin(a));
      point(at, out, 0.05 + 0.06 * r() + 0.05 * low, 0.14 + 0.18 * r() + 0.3 * low * r(), g.tint, 1);
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const off = s * (g.radius + 0.3 + 0.45 * r());
        const at: V3 = [g.at[0] + T[0] * off + n[0] * (0.1 + 0.4 * r()), 0.0, g.at[2] + T[2] * off + n[2] * (0.1 + 0.4 * r())];
        point(at, [T[0] * s * (0.2 + 0.4 * r()) + n[0] * 0.2, 1, T[2] * s * (0.2 + 0.4 * r()) + n[2] * 0.2], 0.1 + 0.12 * r(), 0.35 + 0.7 * r(), g.tint, 0.8);
      }
    }
  }
  return { ledges, blades, points, high };
}

export function packBlades(blades: Blade[]) {
  const out = new Float32Array(blades.length * BLADE_FLOATS);
  blades.forEach((b, i) => out.set([...b.at, b.yaw, b.w, b.thick, b.len, b.pitch, b.tip, b.seed, b.tint ?? -1, b.glow ?? 0], i * BLADE_FLOATS));
  return out;
}

/** the blades and the bigger crystal points as the camera's solids (World.solids): a blade a box from its top's root,
 *  across ±w/2, down `thick`, along `len`, turned `yaw` and tipped `pitch` (as shelves.wgsl builds it); a point longer
 *  than 45 cm a capsule along the same axis, about w/2 round (the small ones round the gates are left to the gates' own
 *  clearance). The cameras agent's reading, moved here so the geode says its own */
export function solidsOfShelves(blades: readonly Blade[], points: readonly Blade[]): Solid[] {
  type V3 = [number, number, number];
  const out: Solid[] = [];
  const axes = (b: Blade) => {
    const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw), cp = Math.cos(b.pitch), sp = Math.sin(b.pitch);
    return { x: [cy, 0, -sy] as V3, y: [-sp * sy, cp, -sp * cy] as V3, z: [cp * sy, sp, cp * cy] as V3 };
  };
  for (const b of blades) {
    const { x, y, z } = axes(b);
    const c = [0, 1, 2].map((k) => b.at[k] - y[k] * b.thick / 2 + z[k] * b.len / 2) as V3;
    out.push({ kind: 'box', c, x, y, z, h: [b.w / 2, b.thick / 2, b.len / 2] });
  }
  for (const b of points) {
    if (b.len < 0.45) continue;
    const { z } = axes(b), r = b.w * 0.6;
    out.push({ kind: 'capsule', a: [...b.at], b: [b.at[0] + z[0] * (b.len - r), b.at[1] + z[1] * (b.len - r), b.at[2] + z[2] * (b.len - r)], r });
  }
  return out;
}

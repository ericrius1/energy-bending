// Where particles live on bodies: Gem Dancers' layout of homes over capsules, generalised to loadouts. A kind's
// particles are shared out among the layers that wear it (a layer is one dancer's share of one kind, on some of its
// body parts) in proportion to their weights, in order. Each layer's block tiles its capsules like scales
// (hex-packed rings, spaced by role, so a suite's heart stones sit wider and bigger and its accents small and close),
// and the rest of the block fills the inside. With one full-body layer per dancer and equal weights this gives
// exactly Gem Dancers' homes (the same random sequence, the same blocks).
//
// Per particle it writes a Home (particle.wgsl): place = capsule slot (dancer × SEGS + capsule), t, angle, depth;
// look = 0 (the kind's own: gems put the specimen here), size (m), role (0 heart, 1 limb, 2 accent), random.
import { mulberry32 } from 'math/random';
import type { Rig } from '../../skeleton/rig';
import { LIMITS } from '../../engine/limits';
import { CAPSULES, roleOf, type BodyPart } from './capsules';

export interface LayoutLayer {
  /** the dancer's slot (0 … LIMITS.dancers − 1) */
  dancer: number;
  rig: Rig;
  /** the parts it covers (all when undefined) */
  parts?: readonly BodyPart[];
  /** its share of the kind's particles, relative to the other layers' */
  weight: number;
}

export interface LayoutOptions {
  /** how many times as many particles the hands and feet carry (for the trails they leave) */
  extremities?: number;
  /** spacing and size by role (heart, limb, accent): gems' defaults */
  spacing?: readonly [number, number, number];
  size?: readonly [number, number, number];
}

export interface LayoutRange { from: number; to: number }

const HOME_FLOATS = 8;
const len = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);

/** lay out n particles over the layers into `out` (n × 8 floats); returns each layer's range of particles */
export function layoutHomes(n: number, layers: readonly LayoutLayer[], out: Float32Array, o: LayoutOptions = {}): LayoutRange[] {
  const extra = Math.max(1, o.extremities ?? 1);
  const SPACING = o.spacing ?? [2.1, 1, 0.72];
  const SIZE = o.size ?? [1.2, 1, 0.88];
  const rng = mulberry32.create(12345);
  const r = () => mulberry32.sample(rng);
  const W = layers.reduce((a, l) => a + l.weight, 0) || 1;
  const ranges: LayoutRange[] = [];
  let i0 = 0, cum = 0;
  for (const layer of layers) {
    cum += layer.weight;
    let i1 = i0;
    while (i1 < n && (i1 * W) / n < cum) i1++;
    if (layer === layers[layers.length - 1]) i1 = n;
    const nd = i1 - i0;
    ranges.push({ from: i0, to: i1 });
    if (nd > 0) placeLayer(layer, i0, nd, out, r, extra, SPACING, SIZE);
    i0 = i1;
  }
  return ranges;
}

function placeLayer(layer: LayoutLayer, i0: number, nd: number, out: Float32Array, r: () => number, extra: number,
  ROLE_SPACING: readonly number[], ROLE_SIZE: readonly number[]) {
  const { rig } = layer;
  const idx = new Map(rig.joints.map((j, k) => [j.name, k]));
  const segs = CAPSULES.map((c, si) => ({ c, si })).filter(({ c }) => !layer.parts || layer.parts.includes(c.part)).map(({ c, si }) => {
    const l = len(rig.joints[idx.get(c.child)!].offset);
    const rEnd = Math.max(c.ra1, c.rb1);
    const tEnd = 1 + (c.round ? (rEnd / Math.max(l, 1e-3)) * 0.85 : 0);
    const end = /Foot|Toe|Finger|HandIndex/.test(c.joint);
    return { si, joint: c.joint, role: roleOf(c.joint), end, l: l * tEnd, tEnd, circ: Math.PI * ((c.ra0 + c.ra1) / 2 + (c.rb0 + c.rb1) / 2) };
  });
  if (!segs.length) return;
  // find the spacing whose lattice holds ~88% of the block
  const grid = (h: number) => segs.map((g) => {
    const hh = h * ROLE_SPACING[g.role] / (g.end ? Math.sqrt(extra) : 1);
    return { cols: Math.max(3, Math.round(g.circ / hh)), rows: Math.max(1, Math.round(g.l / (hh * 0.866))), hh };
  });
  const total = (h: number) => grid(h).reduce((a, g) => a + g.cols * g.rows, 0);
  let lo = 0.002, hi = 0.3;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (total(m) > nd * 0.88) lo = m; else hi = m; }
  const G = grid(hi);
  // a cell: capsule, t, angle, depth, (kind's own), size, role, random
  const cells: number[][] = [];
  segs.forEach((g, gi) => {
    const { cols, rows, hh } = G[gi];
    for (let row = 0; row < rows; row++) {
      const t = ((row + 0.5) / rows) * g.tEnd;
      for (let c = 0; c < cols; c++) {
        const th = ((c + 0.5 * (row % 2) + (r() - 0.5) * 0.15) / cols) * Math.PI * 2;
        // limbs borrow the heart's role near the body and the accent's near the ends, so a suite blends
        let role = g.role;
        if (role === 1) {
          const u = t / g.tEnd;
          if (/UpLeg|Shoulder/.test(g.joint) && r() < (1 - u) * 0.45) role = 0;
          else if (/ForeArm|^(Left|Right)Leg$/.test(g.joint) && r() < u * u * 0.6) role = 2;
        }
        cells.push([g.si, t, th, 1, 0, hh * 0.62 * ROLE_SIZE[role], role, r()]);
      }
    }
  });
  // a few extra fill the inside, small
  const areaCdf: number[] = [];
  let acc = 0;
  segs.forEach((g) => areaCdf.push((acc += g.circ * g.l)));
  while (cells.length < nd) {
    const u = r() * acc;
    let k = areaCdf.findIndex((c) => u <= c);
    if (k < 0) k = segs.length - 1;
    const g = segs[k];
    const role = g.role === 0 ? 0 : 1;
    cells.push([g.si, r() * g.tEnd, r() * Math.PI * 2, 0.35 + 0.45 * r(), 0, hi * 0.45, role, r()]);
  }
  // if the lattice overshot, drop evenly spread cells
  while (cells.length > nd) cells.splice(Math.floor(r() * cells.length), 1);
  const slot0 = layer.dancer * LIMITS.capsules;
  cells.forEach((c, k) => {
    c[0] += slot0;
    out.set(c, (i0 + k) * HOME_FLOATS);
  });
}

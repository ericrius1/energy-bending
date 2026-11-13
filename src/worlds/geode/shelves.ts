// The geode's stage, from one description: a plane through the middle, and three great blades of selenite grown out
// of the wall (like the beams in the Naica cave), their tops flat, each a ledge exactly where the blade the eye sees
// is: two from the side walls running along the plane, one from the back wall reaching out over the middle. Smaller
// points cluster round their roots. Drawn by shelves.wgsl.
import { mulberry32 } from 'math/random';
import type { Ledge } from '../stage';

/** a blade: where its top's middle leaves the wall (x, y, z), its turn about up (0: it grows along +z; a quarter turn along +x)
 *  and its tilt up from level; its width, thickness and length; how long its chisel tip is; a seed */
export interface Blade { at: [number, number, number]; yaw: number; pitch: number; w: number; thick: number; len: number; tip: number; seed: number }

export const BLADE_FLOATS = 12;

/** The stage is the plane through the middle (where the dancers are), seen from the front. Its ledges: a low blade from
 *  the left wall and a middling one from the right, each running along the plane to its tip, and a high one from the
 *  back wall reaching out over the middle, across the plane. */
export function layoutShelves(o: { caveRadius: number; seed?: number }) {
  const rng = mulberry32.create(o.seed ?? 5);
  const r = () => mulberry32.sample(rng);
  const wallAt = (y: number) => Math.sqrt(o.caveRadius * o.caveRadius - y * y);
  const ledges: Ledge[] = [];
  const blades: Blade[] = [];
  // a shelf is a raft of prisms grown side by side, their tops flush (the ledge), each a little longer or shorter past
  // where the ledge ends; across: which way is across them (unit, level)
  const raft = (root: [number, number, number], yaw: number, across: [number, number], w: number, len: number) => {
    const n = Math.max(2, Math.round(w / 0.7)), pw = w / n;
    for (let k = 0; k < n; k++) {
      const o = (k + 0.5) * pw - w / 2;
      blades.push({ at: [root[0] + across[0] * o, root[1], root[2] + across[1] * o], yaw, pitch: 0, w: pw * 0.97, thick: pw * (0.75 + 0.35 * r()), len: len + 0.45 * r(), tip: 0.45 + 0.3 * r(), seed: r() });
    }
  };
  const cluster = (x: number, y: number, z: number, yaw: number) => {
    // smaller points out of the wall round a blade's root, splayed
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
  // the side blades: from the wall along the plane (their width across it), ledges from the stage's edge to their tips
  for (const [id, side, y, tipX, w, thick] of [['shelfL', -1, 1.1, -3.55, 1.5, 0.42], ['shelfR', 1, 1.9, 3.5, 1.4, 0.45]] as const) {
    const root = side * (wallAt(y) + 0.5);
    const len = Math.abs(tipX - root);
    raft([root, y, 0], -side * Math.PI / 2, [0, 1], w, len);
    // (the low one stands in the way at knee height: solid; the other you jump up through)
    ledges.push({ id, x0: side < 0 ? -5.75 : tipX, x1: side < 0 ? tipX : 5.75, y, thick, ...(y < 1.5 ? { solid: true } : {}) });
    cluster(side * (wallAt(y) - 0.2), y, 0, -side * Math.PI / 2);
  }
  // the high blade: from the back wall out over the middle, 0.7 m past the plane
  const hy = 3.1, hw = 2.2;
  const hroot = -(wallAt(hy) + 0.4);
  raft([0, hy, hroot], 0, [1, 0], hw, 0.7 - hroot);
  ledges.push({ id: 'shelfC', x0: -hw / 2, x1: hw / 2, y: hy, thick: 0.5 });
  cluster(0, hy, -(wallAt(hy) - 0.2), 0);
  return { ledges, blades };
}

export function packBlades(blades: Blade[]) {
  const out = new Float32Array(blades.length * BLADE_FLOATS);
  blades.forEach((b, i) => out.set([...b.at, b.yaw, b.w, b.thick, b.len, b.pitch, b.tip, b.seed, 0, 0], i * BLADE_FLOATS));
  return out;
}

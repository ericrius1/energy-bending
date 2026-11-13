// The geode's stage, from one description: a plane across the back of the hollow, and three great blades of selenite
// grown out of the wall behind it (like the beams in the Naica cave) reaching forward across the plane, their tops flat,
// so each is a ledge exactly as wide as the blade the eye sees. Smaller blades cluster round their roots. Drawn by
// shelves.wgsl.
import { mulberry32 } from 'math/random';
import type { Ledge } from '../stage';

/** where the stage plane stands (z) */
export const STAGE_Z = -4.5;

/** a blade: where its top's middle leaves the wall (x, y, z), its turn about up and its tilt up from level; its width,
 *  thickness and length; how long its chisel tip is; a seed */
export interface Blade { at: [number, number, number]; yaw: number; pitch: number; w: number; thick: number; len: number; tip: number; seed: number }

export const BLADE_FLOATS = 12;

export function layoutShelves(o: { caveRadius: number; seed?: number }) {
  const rng = mulberry32.create(o.seed ?? 5);
  const r = () => mulberry32.sample(rng);
  // the ledges: low on the left, middling on the right, high in the middle, as the stage's proportions ask
  const ledges: Ledge[] = [
    { id: 'shelfL', x0: -5.45, x1: -3.55, y: 1.1, thick: 0.42 },
    { id: 'shelfR', x0: 3.5, x1: 5.4, y: 1.9, thick: 0.45 },
    { id: 'shelfC', x0: -1.15, x1: 1.15, y: 3.1, thick: 0.5 },
  ];
  const blades: Blade[] = [];
  for (const l of ledges) {
    const cx = (l.x0 + l.x1) / 2;
    // its root half a metre into the wall (the dome at that height), its tip 0.6 m past the plane
    const R = Math.sqrt(o.caveRadius * o.caveRadius - l.y * l.y);
    const wallZ = -Math.sqrt(Math.max(0, R * R - cx * cx));
    const z0 = wallZ - 0.6, z1 = STAGE_Z + 0.6;
    blades.push({ at: [cx, l.y, z0], yaw: 0, pitch: 0, w: l.x1 - l.x0, thick: l.thick ?? 0.45, len: z1 - z0, tip: 0.55, seed: r() });
    // smaller blades out of the wall round its root, splayed
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + r() * 0.8;
      const ox = Math.cos(a) * (0.9 + 0.6 * r()), oy = Math.sin(a) * (0.55 + 0.4 * r());
      const w = 0.3 + 0.45 * r();
      blades.push({
        at: [cx + ox, l.y + oy - 0.1, wallZ - 0.3], yaw: (r() - 0.5) * 1.0 + ox * 0.15, pitch: (r() - 0.35) * 0.7, w, thick: w * (0.4 + 0.3 * r()),
        len: 0.9 + 1.4 * r(), tip: 0.3 + 0.3 * r(), seed: r(),
      });
    }
  }
  return { ledges, blades };
}

export function packBlades(blades: Blade[]) {
  const out = new Float32Array(blades.length * BLADE_FLOATS);
  blades.forEach((b, i) => out.set([...b.at, b.yaw, b.w, b.thick, b.len, b.pitch, b.tip, b.seed, 0, 0], i * BLADE_FLOATS));
  return out;
}

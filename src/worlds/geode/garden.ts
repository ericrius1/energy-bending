// The geode's planting (phase 5, report 18), laid out for garden.wgsl: plants with real silhouettes where phase 4 had
// moss and vines painted on the stone. Everywhere (the hub and the duel): a row of white-and-brass planters along the
// foot of the great window behind the stage (geode.wgsl geodeGreatWindow), each with a fern, broad leaves, flowers and
// a vine over its rim. In the duel (geode/arena.ts `decor`): ferns and flowers round each standing beam's foot, vines
// trailing over the shelves' edges. Nothing here is solid; the near fade drops it where it stands in the lens.
import { mulberry32 } from 'math/random';
import type { GeodeDuel } from './arena';

type V3 = [number, number, number];

/** the floats a plant is to garden.wgsl (struct Plant): at.xyz kind; yaw, pitch, length, width; seed, colour, droop, - */
export const PLANT_FLOATS = 12;
/** a planter (struct Pot): foot.xyz radius; height, seed, -, - */
export const POT_FLOATS = 8;
export const PLANT = { fern: 0, leaf: 1, vine: 2, flower: 3 } as const;

/** the great window's place (geode.wgsl GW_*): its middle's bearing, its bays' width and how many */
const GW_MID = -1.745, GW_BAY = 3.5, GW_N = 7;

export interface GeodeGarden {
  plants: Float32Array;
  pots: Float32Array;
  /** how many plants and planters are the hub's (drawn always); the duel's come after them */
  hubPlants: number;
  potCount: number;
}

/** `open(x, z)`: whether the duel's floor is there (not one of its drops) */
export function layoutGeodeGarden(duel: GeodeDuel['decor'], wallR: number, coarse: boolean, open: (x: number, z: number) => boolean = () => true): GeodeGarden {
  const rng = mulberry32.create(97);
  const r = () => mulberry32.sample(rng);
  const plants: number[] = [], pots: number[] = [];
  const plant = (at: V3, kind: number, yaw: number, pitch: number, len: number, width: number, colour = 0, droop = 0) =>
    plants.push(at[0], at[1], at[2], kind, yaw, pitch, len, width, r(), colour, droop, 0);
  /** a fern clump: fronds arching out all round from `at` */
  const fern = (at: V3, size: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const yaw = (k / n) * Math.PI * 2 + r() * 0.6;
      plant([at[0] + Math.sin(yaw) * 0.04, at[1], at[2] + Math.cos(yaw) * 0.04], PLANT.fern, yaw, 0.9 + 0.5 * r(), size * (0.75 + 0.4 * r()), size * 0.2, 0, 1.6 + 0.8 * r());
    }
  };
  /** broad leaves on their stalks, rising and turning out */
  const leaves = (at: V3, size: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const yaw = r() * Math.PI * 2;
      plant(at, PLANT.leaf, yaw, 1.0 + 0.4 * r(), size * (0.7 + 0.5 * r()), size * 0.38, 0, 1.2 + 0.6 * r());
    }
  };
  /** flowers on their stems */
  const flowers = (at: V3, spread: number, n: number, colour: number, tall: number) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = spread * Math.sqrt(r());
      plant([at[0] + Math.cos(a) * d, at[1], at[2] + Math.sin(a) * d], PLANT.flower, r() * 6.28, 1.35 + 0.2 * r(), tall * (0.7 + 0.5 * r()), 0.05 + 0.03 * r(), (colour + (r() < 0.25 ? 1 : 0)) % 4, 0);
    }
  };
  /** vines hanging from a point on an edge */
  const vine = (at: V3, len: number) => plant(at, PLANT.vine, 0, 0, len, 0.16, 0, 0);

  // the hub's and the duel's: planters along the foot of the great window, one at each mullion and one in front of the
  // middle lancet (a little in from the wall, the window over them)
  const potAt = (bearing: number, rr: number, R: number, H: number) => {
    const at: V3 = [Math.cos(bearing) * rr, 0, Math.sin(bearing) * rr];
    pots.push(at[0], 0, at[2], R, H, r(), 0, 0);
    const top: V3 = [at[0], H * 0.92, at[2]];
    fern(top, 0.75 + 0.3 * r(), coarse ? 5 : 8);
    leaves(top, 0.55, 3);
    flowers(top, R * 0.55, coarse ? 2 : 4, Math.floor(r() * 4), 0.55);
    // vines over its rim, toward the room
    for (let k = 0; k < 3; k++) {
      const a = bearing + Math.PI + (r() - 0.5) * 1.6;
      vine([at[0] + Math.cos(a) * R * 1.02, H, at[2] + Math.sin(a) * R * 1.02], 0.3 + 0.4 * r());
    }
  };
  const ringR = wallR - 1.2;
  for (let k = 0; k <= GW_N; k++) {
    const s = (k - GW_N / 2) * GW_BAY, b = GW_MID + s / ringR;
    potAt(b, ringR, 0.42 + 0.06 * r(), 0.62 + 0.1 * r());
  }
  const hubPlants = plants.length / PLANT_FLOATS;

  // the duel's: round each standing beam's foot, ferns and flowers at two of its corners, a broad leaf; vines down its
  // face from its top now and then
  for (const b of duel.beams) {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const corner = (u: number, v: number): V3 => [b.x + c * u * (b.w / 2 + 0.12) + s * v * (b.depth / 2 + 0.12), 0, -s * u * (b.w / 2 + 0.12) + c * v * (b.depth / 2 + 0.12) + b.z];
    const pick = r() < 0.5 ? [[1, 1], [-1, -1]] : [[-1, 1], [1, -1]];
    for (const [u, v] of pick) {
      const at = corner(u, v);
      if (!open(at[0], at[2])) continue;
      fern(at, 0.8 + 0.3 * r(), coarse ? 5 : 8);
      if (r() < 0.7) flowers(at, 0.3, coarse ? 2 : 4, Math.floor(r() * 4), 0.5);
      if (r() < 0.6) leaves(at, 0.6, 3);
    }
    if (b.top > 1.2) for (let k = 0; k < 2; k++) {
      const u = (r() - 0.5) * 0.8, v = r() < 0.5 ? 1 : -1;
      vine([b.x + c * u * b.w / 2 + s * v * (b.depth / 2 + 0.01), b.top, -s * u * b.w / 2 + c * v * (b.depth / 2 + 0.01) + b.z], Math.min(b.top * 0.5, 0.5 + 0.7 * r()));
    }
  }
  // vines trailing over the shelves' long edges and their ends, every 30 to 60 cm
  for (const sh of duel.shelves) {
    const d: V3 = [Math.sin(sh.yaw), 0, Math.cos(sh.yaw)], across: V3 = [d[2], 0, -d[0]];
    for (const side of [-1, 1]) {
      for (let t = 0.3 + 0.3 * r(); t < sh.len - 0.2; t += 0.3 + 0.35 * r()) {
        if (r() < 0.35) continue;
        const at: V3 = [sh.root[0] + d[0] * t + across[0] * side * (sh.w / 2 + 0.01), sh.root[1] - 0.02, sh.root[2] + d[2] * t + across[2] * side * (sh.w / 2 + 0.01)];
        vine(at, 0.25 + 0.75 * r() * r());
      }
    }
    // and a fern or flowers on its top here and there, back from its edge
    for (let t = 0.6; t < sh.len - 0.6; t += 1.4 + r()) {
      if (r() < 0.4) continue;
      const o = (r() - 0.5) * sh.w * 0.5, at: V3 = [sh.root[0] + d[0] * t + across[0] * o, sh.root[1], sh.root[2] + d[2] * t + across[2] * o];
      if (r() < 0.5) fern(at, 0.35 + 0.15 * r(), coarse ? 3 : 5);
      else flowers(at, 0.18, 2, Math.floor(r() * 4), 0.25);
    }
  }
  return { plants: new Float32Array(plants), pots: new Float32Array(pots), hubPlants, potCount: pots.length / POT_FLOATS };
}

// Where everything in the Sky Forge floats, from one description: slabs of basalt, each a cluster of hexagonal
// columns with one flat top, hanging below it like an upturned mountain. The stage's slabs (the great anvil, two
// floats either side, the crown above) are laid so a row of columns runs along the stage plane (z = 0): their flat
// sides meet there, so the ledge each one gives is exactly the run of columns the eye sees, edge to edge. Then
// islands far off in the sky round it, for the place to be a place. Laid out once from a seed.
import { mulberry32 } from 'math/random';
import type { Ledge } from '../stage';
import { boxOn, type Solid } from '../solids';

/** a column: centre xz, its top, its radius (centre to corner); how far it hangs down, which slab it's in, a seed */
export const COLUMN_FLOATS = 8;
/** the stage's slabs bob by the uniform (one value each, by the beat); the islands by the clock */
export const STAGE_SLABS = 8;

export interface Slab {
  id: string;
  /** the middle of its top */
  x: number; z: number; top: number;
  /** its footprint's half extents (an ellipse, ragged at the edge), and an extra lobe (x, z, radius) */
  rx: number; rz: number; lobe?: [number, number, number];
  /** the columns' corner radius, and how deep the middle hangs */
  R: number; depth: number;
  /** how far it bobs with the bass (m; its ledge's bob) */
  bob: number;
  /** the stage's: its ledge (the row along z = 0); islands have none */
  ledge?: Ledge;
  /** the run of columns along the stage plane (cells either side of its middle): -k0 … k1 */
  row?: [number, number];
  solid?: boolean;
}

export interface ForgeLayout {
  slabs: Slab[];
  ledges: Ledge[];
  columns: Float32Array;
  /** how many of the columns are the stage's (they come first) */
  stageColumns: number;
  count: number;
}

const S3 = Math.sqrt(3);

export function layoutForge(o: { coarse: boolean; seed?: number }): ForgeLayout {
  const rng = mulberry32.create(o.seed ?? 23);
  const r = () => mulberry32.sample(rng);
  // the stage: the anvil (the floor: its top is y = 0), two floats beside it, the crown over the middle
  const stage: Slab[] = [
    { id: 'anvil', x: 0, z: 0, top: 0, rx: 4.0, rz: 3.2, lobe: [-5.6, -3.6, 1.9], R: 0.4, depth: 7.5, bob: 0, row: [5, 5], solid: true },
    // (their middles hang out past the anvil's edge; their edges, over it, hang short and clear of it)
    { id: 'floatL', x: -4.75, z: 0, top: 1.75, rx: 1.15, rz: 0.95, R: 0.33, depth: 1.4, bob: 0.18, row: [1, 1] },
    { id: 'floatR', x: 4.75, z: 0, top: 1.75, rx: 1.15, rz: 0.95, R: 0.33, depth: 1.4, bob: 0.18, row: [1, 1] },
    // (shallow, so there's head room under it on the anvil)
    { id: 'crown', x: 0, z: 0, top: 3.1, rx: 1.3, rz: 0.85, R: 0.25, depth: 0.3, bob: 0.28, row: [2, 2] },
  ];
  const cols: number[] = [];
  const ledges: Ledge[] = [];
  const add = (s: Slab, slab: number, island: boolean) => {
    const w = S3 * s.R;
    // rows of cells, flat sides facing ±x: row j at z = 1.5 R j, every other row shifted by half a cell
    const J = Math.ceil((s.rz + (s.lobe ? s.lobe[2] + Math.abs(s.lobe[1]) : 0)) / (1.5 * s.R)) + 1;
    const K = Math.ceil((s.rx + (s.lobe ? s.lobe[2] + Math.abs(s.lobe[0]) : 0)) / w) + 1;
    for (let j = -J; j <= J; j++) {
      for (let k = -K; k <= K; k++) {
        const cx = s.x + (k + (j & 1 ? 0.5 : 0)) * w, cz = s.z + j * 1.5 * s.R;
        const ex = (cx - s.x) / s.rx, ez = (cz - s.z) / s.rz;
        let inside = ex * ex + ez * ez <= 1 - 0.25 * r();
        if (s.lobe) inside ||= Math.hypot(cx - s.lobe[0], cz - s.lobe[1]) < s.lobe[2] * (0.85 + 0.15 * r());
        // the row on the stage plane is exactly the cells the ledge says
        if (s.row && j === 0) inside = k >= -s.row[0] && k <= s.row[1];
        if (!inside) continue;
        const e = Math.min(1, Math.sqrt(ex * ex + ez * ez));
        const hang = 0.5 + s.depth * Math.pow(Math.max(0, 1 - e * e), 0.8) * (0.7 + 0.6 * r());
        // (an island's columns stand at many heights; the stage's are one flat floor)
        const top = island ? s.top + (r() - 0.5) * 0.3 * s.R - e * e * Math.max(s.rx, s.rz) * 0.12 : s.top;
        cols.push(cx, cz, top, s.R, hang, slab, r(), island ? 1 : 0);
      }
    }
    if (s.row) {
      const l: Ledge = { id: s.id, x0: s.x - s.row[0] * w - w / 2, x1: s.x + s.row[1] * w + w / 2, y: s.top, thick: s.solid ? s.depth * 0.5 : 0.6 };
      if (s.solid) l.solid = true;
      if (s.bob) l.bob = s.bob;
      s.ledge = l;
      ledges.push(l);
    }
  };
  stage.forEach((s, i) => add(s, i, false));
  const stageColumns = cols.length / COLUMN_FLOATS;
  // the islands: near ones a few tens of metres out and low, far ones higher and bigger, none in front of the stage
  const islands: Slab[] = [];
  const n = o.coarse ? 10 : 22;
  for (let i = 0; i < n; i++) {
    const far = 22 + 120 * Math.pow(r(), 1.3);
    let a = r() * Math.PI * 2;
    // (keep the audience's side clear: the locked camera stands at +z)
    if (Math.sin(a) > 0.55 && far < 60) a += Math.PI;
    const size = 1.5 + far * 0.05 * (0.5 + r());
    islands.push({ id: `isle${i}`, x: Math.cos(a) * far, z: Math.sin(a) * far, top: -14 + 30 * r() + far * 0.08, rx: size * (0.8 + 0.5 * r()), rz: size * (0.6 + 0.4 * r()), R: 0.35 + size * 0.045, depth: size * (1.2 + r()), bob: 0 });
  }
  islands.forEach((s, i) => add(s, STAGE_SLABS + i, true));
  return { slabs: [...stage, ...islands], ledges, columns: new Float32Array(cols), stageColumns, count: cols.length / COLUMN_FLOATS };
}

/** the stage's columns as the camera's solids (World.solids): each a box from its flat top down `hang`, the bobbing ones
 *  (the floats and the crown) as high as they rise. The far islands are out of the camera's reach (the cameras agent's
 *  reading, moved here so the forge says its own) */
export function solidsOfForge(L: ForgeLayout): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i < L.stageColumns; i++) {
    const o = i * COLUMN_FLOATS, x = L.columns[o], z = L.columns[o + 1], top = L.columns[o + 2], R = L.columns[o + 3], hang = L.columns[o + 4];
    const bob = L.slabs[L.columns[o + 5]]?.bob ?? 0;
    out.push(boxOn([x, top - hang - bob, z], [Math.sqrt(3) * R, hang + 2 * bob, 2 * R]));
  }
  return out;
}

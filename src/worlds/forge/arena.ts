// The Sky Forge's duel arena (src/duel/arena.ts), from one description: the jogo's stage (the anvil, its two floats, the
// crown) and, only in the duel, floating stones of the same basalt hung all round it at many heights, each a cluster of
// hexagonal columns with one flat top, like the stage's own slabs. Low ones in front (toward the lock's camera) and at the
// sides to catch a fall off the anvil, higher ones climbing away behind it, and along the stage plane a set whose run of
// columns lies exactly on it (z = 0), so its ledge is exactly the columns the eye sees and its walls are their flat sides.
// No ground: between the stones is the sky, the fire far below; a fall past the low stones is a KO. The stones don't bob
// (the stage's floats and crown still do, with the bass).
import { mulberry32 } from 'math/random';
import type { Ledge, Wall } from '../../engine/camera';
import { stagePlane } from '../stage';
import { boxOn, type Solid } from '../solids';
import { arenas, mergeWalls, type Arena, type PieceGroup } from '../../duel/arena';
import { COLUMN_FLOATS, layoutForge, STAGE_SLABS, type ForgeLayout } from './layout';

/** a floating stone: the middle of its top (x, z), its top, the columns' corner radius, how far its top reaches round
 *  (m), how deep its middle hangs and how deep its rim; `row`: a stone on the stage plane, its run of cells on z = 0
 *  either side of its middle (its ends exactly its walls) */
interface Stone { id: string; x: number; z: number; top: number; R: number; rad: number; depth: number; edge: number; row?: [number, number] }

const STONES: Stone[] = [
  // on the stage plane: low ones past the anvil's ends, tall ones over them (a shaft with the plane's ends), high ones
  // over the floats, the top over the crown
  { id: 'lowL', x: -7.3, z: 0, top: -1.0, R: 0.36, rad: 1.1, depth: 2.6, edge: 1.9, row: [1, 1] },
  { id: 'lowR', x: 7.3, z: 0, top: -1.0, R: 0.36, rad: 1.1, depth: 2.6, edge: 1.9, row: [1, 1] },
  { id: 'midL', x: -7.2, z: 0, top: 3.4, R: 0.36, rad: 1.0, depth: 2.4, edge: 2.0, row: [1, 1] },
  { id: 'midR', x: 7.2, z: 0, top: 3.4, R: 0.36, rad: 1.0, depth: 2.4, edge: 2.0, row: [1, 1] },
  { id: 'highL', x: -4.5, z: 0, top: 5.6, R: 0.3, rad: 0.9, depth: 1.6, edge: 1.1, row: [1, 1] },
  { id: 'highR', x: 4.5, z: 0, top: 5.6, R: 0.3, rad: 0.9, depth: 1.6, edge: 1.1, row: [1, 1] },
  { id: 'top', x: 0, z: 0, top: 7.2, R: 0.3, rad: 0.9, depth: 1.4, edge: 0.9, row: [1, 1] },
  // behind the stage, climbing away from the anvil's back edge (the gate's lobe left clear)
  { id: 'back1', x: 3.2, z: -5.6, top: 1.2, R: 0.36, rad: 1.3, depth: 2.2, edge: 1.2 },
  { id: 'back2', x: 7.2, z: -4.2, top: 2.7, R: 0.36, rad: 1.1, depth: 2.4, edge: 1.4 },
  { id: 'back3', x: 0.8, z: -8.6, top: 3.3, R: 0.38, rad: 1.3, depth: 2.8, edge: 1.5 },
  { id: 'back4', x: -2.6, z: -6.9, top: 4.7, R: 0.33, rad: 1.0, depth: 2.2, edge: 1.2 },
  { id: 'back5', x: 4.6, z: -8.4, top: 5.5, R: 0.33, rad: 1.0, depth: 2.0, edge: 1.1 },
  { id: 'back6', x: -7.4, z: -7.6, top: 2.3, R: 0.36, rad: 1.2, depth: 2.6, edge: 1.3 },
  { id: 'back7', x: -0.8, z: -11.2, top: 6.4, R: 0.33, rad: 1.0, depth: 2.4, edge: 1.2 },
  { id: 'back8', x: 9.6, z: -7.6, top: 4.0, R: 0.33, rad: 1.0, depth: 2.2, edge: 1.2 },
  // in front, low (the lock's camera looks over them), and off the plane's ends
  { id: 'front1', x: -3.2, z: 5.6, top: -0.6, R: 0.38, rad: 1.2, depth: 2.4, edge: 1.2 },
  { id: 'front2', x: 3.4, z: 5.4, top: 0.7, R: 0.36, rad: 1.1, depth: 2.2, edge: 1.1 },
  { id: 'front3', x: 7.4, z: 5.8, top: 1.9, R: 0.36, rad: 1.0, depth: 2.2, edge: 1.1 },
  { id: 'front4', x: -7.6, z: 4.8, top: 1.1, R: 0.36, rad: 1.1, depth: 2.2, edge: 1.1 },
  { id: 'front5', x: 0.4, z: 9.0, top: -1.2, R: 0.38, rad: 1.3, depth: 2.4, edge: 1.2 },
  { id: 'sideL', x: -10.4, z: 1.6, top: 2.4, R: 0.33, rad: 0.9, depth: 2.0, edge: 1.1 },
  { id: 'sideR', x: 10.4, z: 2.0, top: 1.0, R: 0.33, rad: 0.9, depth: 2.0, edge: 1.1 },
];

/** the slab index the stones' columns carry: one of the stage's bob slots nobody fills (no bob), above the anvil's 0 so
 *  they taper a little as they hang, like the floats */
const SLAB = STAGE_SLABS - 1;
const S3 = Math.sqrt(3);

export interface ForgeDuel {
  arena: Arena;
  /** the stones' columns (COLUMN_FLOATS each, as slabs.wgsl reads them) */
  columns: Float32Array;
  count: number;
}

function build(L: ForgeLayout): ForgeDuel {
  const rng = mulberry32.create(91);
  const r = () => mulberry32.sample(rng);
  const cols: number[] = [], groups: PieceGroup[] = [], outlines: [number, number, number][][] = [];
  for (const st of STONES) {
    const w = S3 * st.R, solids: Solid[] = [], corners: [number, number][] = [];
    const cell = (cx: number, cz: number, hang: number, top: number) => {
      cols.push(cx, cz, top, st.R, hang, SLAB, r(), 0);
      solids.push(boxOn([cx, top - hang, cz], [w, hang, 2 * st.R]));
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; corners.push([cx + Math.cos(a) * st.R * 0.97, cz + Math.sin(a) * st.R * 0.97]); }
    };
    // rows of cells, flat sides facing ±x (row j at z + 1.5 R j, every other row half a cell over), inside a ragged
    // circle; the middle hangs deepest, the rim `edge`. A stone on the plane has its row j = 0 exactly the run it says
    const J = Math.ceil(st.rad / (1.5 * st.R)), K = Math.ceil(st.rad / w) + 1;
    for (let j = -J; j <= J; j++) for (let k = -K; k <= K; k++) {
      const cx = st.x + (k + (j & 1 ? 0.5 : 0)) * w, cz = st.z + j * 1.5 * st.R;
      const e = Math.hypot(cx - st.x, cz - st.z) / st.rad;
      let inside = e * e <= 1 - 0.2 * r();
      let end = false;
      if (st.row && j === 0) { inside = k >= -st.row[0] && k <= st.row[1]; end = k === -st.row[0] || k === st.row[1]; }
      else if (st.row && Math.abs(j) > 1) inside = false;
      if (!inside) continue;
      const hang = end ? st.edge : st.edge + (st.depth - st.edge) * Math.pow(Math.max(0, 1 - e * e), 0.8) * (0.85 + 0.3 * r());
      cell(cx, cz, hang, st.top - (j && !st.row ? 0.03 * r() : 0));
    }
    groups.push({ id: st.id, solids });
    // (its top's outline for the rim light: the hull of its columns' corners)
    outlines.push(hull(corners).map(([x, z]) => [x, st.top + 0.01, z]));
  }
  // the stage's slabs too, where they hold still (the floats and the crown bob: the plane's ledges mark them)
  for (const s of L.slabs.slice(0, 4)) {
    if (s.bob) continue;
    const corners: [number, number][] = [];
    for (let i = 0; i < L.stageColumns; i++) {
      const o = i * COLUMN_FLOATS;
      if (L.slabs[L.columns[o + 5]] !== s) continue;
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; corners.push([L.columns[o] + Math.cos(a) * L.columns[o + 3] * 0.97, L.columns[o + 1] + Math.sin(a) * L.columns[o + 3] * 0.97]); }
    }
    // (the anvil is two lobes: its main body and the gate's, each its own hull)
    const lobe = s.lobe, inLobe = (p: [number, number]) => !!lobe && Math.hypot(p[0] - lobe[0], p[1] - lobe[1]) < lobe[2] + 0.5 && (p[0] - s.x) ** 2 / (s.rx * s.rx) + (p[1] - s.z) ** 2 / (s.rz * s.rz) > 1;
    for (const part of [corners.filter((p) => !inLobe(p)), corners.filter(inLobe)]) if (part.length >= 3) outlines.push(hull(part).map(([x, z]) => [x, s.top + 0.01, z]));
  }
  const pieces = groups.flatMap((g) => g.solids);

  // the plane: the jogo's stage slabs as they are (the floats and the crown bob: their walls span where they can be),
  // walls as deep as the end columns of their row on the plane hang; then what the stones give it where they cross it
  const halfWidth = 9;
  const base = stagePlane({ id: 'forge.duel', origin: [0, 0, 0], right: [1, 0, 0], halfWidth, ground: null, ledges: [], spawns: [[-2.4, 0], [2.4, 0]], lens: 28, height: 8.6 });
  const ledges: Ledge[] = [], walls: Wall[] = [];
  for (const l of L.ledges) {
    ledges.push({ ...l });
    const ends = endHangs(L, l.id), b = l.bob ?? 0;
    walls.push({ id: `${l.id}.l`, s: l.x0, side: -1, y0: l.y - ends[0] - b, y1: l.y + b }, { id: `${l.id}.r`, s: l.x1, side: 1, y0: l.y - ends[1] - b, y1: l.y + b });
  }
  // (a stone on the plane: its ledge as wide as its row, its walls as deep as its end columns hang)
  for (const st of STONES) if (st.row) {
    const w = S3 * st.R, x0 = st.x - st.row[0] * w - w / 2, x1 = st.x + st.row[1] * w + w / 2;
    ledges.push({ id: st.id, x0, x1, y: st.top, solid: true, thick: st.edge });
    walls.push({ id: `${st.id}.l`, s: x0, side: -1, y0: st.top - st.edge, y1: st.top }, { id: `${st.id}.r`, s: x1, side: 1, y0: st.top - st.edge, y1: st.top });
  }
  const plane = { ...base, ledges, walls: mergeWalls(walls, halfWidth) };
  const arena: Arena = {
    world: 'forge',
    space: { center: [0, 0, -1], radius: 12, yKill: -3.6, yTop: 10 },
    spawns: [[-2.4, 0, 0.6], [2.4, 0, -0.6], [3.2, 1.2, -5.6], [-3.2, -0.6, 5.6], [-7.2, 3.4, 0], [7.4, 1.9, 5.8], [0.8, 3.3, -8.6]],
    pieces, plane,
    camera: { minDist: 9, maxDist: 24, lens: 28 },
    drops: [], outlines,
    rim: [1.0, 0.42, 0.16],
  };
  return { arena, columns: new Float32Array(cols), count: cols.length / COLUMN_FLOATS };
}

/** the convex hull of points (x, z), counter-clockwise (Andrew's monotone chain) */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** how deep the first and the last columns of a stage slab's row on the plane hang (its walls) */
function endHangs(L: ForgeLayout, id: string): [number, number] {
  const slab = L.slabs.findIndex((s) => s.id === id), s = L.slabs[slab];
  let lo = Infinity, hi = -Infinity, hLo = 0, hHi = 0;
  for (let i = 0; i < L.stageColumns; i++) {
    const o = i * COLUMN_FLOATS;
    if (L.columns[o + 5] !== slab || Math.abs(L.columns[o + 1] - s.z) > 1e-6) continue;
    const x = L.columns[o], hang = L.columns[o + 4];
    if (x < lo) { lo = x; hLo = hang; }
    if (x > hi) { hi = x; hHi = hang; }
  }
  return [hLo, hHi];
}

let made: ForgeDuel | null = null;
/** the forge's duel arena and the stones it adds (built once; the stage's slabs are laid the same on any device) */
export function forgeDuel(): ForgeDuel { return (made ??= build(layoutForge({ coarse: false }))); }

export function registerForgeArena() { arenas.register(forgeDuel().arena); }

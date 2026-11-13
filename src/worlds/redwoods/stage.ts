// The redwoods' stage, from one description: a plane through the middle of the clearing, aimed at the biggest tree of
// the fairy ring (its trunk stands on the plane, past the stage's right end), with a fallen giant lying along the
// plane on the left (its broken end towards the middle, its root plate torn up near the ring) and two boughs from that
// tree reaching in along the plane: a low one and, above it, a higher one that runs on over the middle. Each ledge is
// where a log's top runs level, and the logs are built from the same numbers: a chain of tapered capsules (drawn by
// trunks.wgsl vs_stage with the trunks' bark), level and of one radius wherever a ledge is.
import type { Ledge } from '../stage';

type V3 = [number, number, number];

/** a capsule of the chain: from a (radius ra) to b (radius rb); each end round (0), flat (1), broken (2) or a torn
 *  root plate (3); `kind`: 0 bark, 1 the root plate's earth */
export interface Piece { a: V3; ra: number; b: V3; rb: number; capA: number; capB: number; kind: number; seed: number }

/** what a piece is to trunks.wgsl (struct StageLog): a.xyz ra; b.xyz rb; capA capB along0 seed; kind - - - */
export const PIECE_FLOATS = 16;

export interface RedwoodsStage {
  right: [number, number, number];
  ledges: Ledge[];
  pieces: Piece[];
  /** for the plants to keep off: the fallen log's axis on the ground (x0 z0 x1 z1); its radius, then its root plate
   *  (x z radius) */
  log: [number, number, number, number];
  plate: [number, number, number, number];
}

/** trunks: the light's trunk list (x, z, radius, height per trunk, nearest first) */
export function layoutStage(trunks: Float32Array): RedwoodsStage {
  // the anchor tree: the biggest of the ring nearest the bearing the plane was drawn for (east, a little south)
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < 9; i++) {
    const x = trunks[i * 4], z = trunks[i * 4 + 1], R = trunks[i * 4 + 2];
    const score = Math.cos(Math.atan2(z, x) - 0.09) * 3 + R;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  const tx = trunks[best * 4], tz = trunks[best * 4 + 1];
  const tl = Math.hypot(tx, tz);
  const right: V3 = [tx / tl, 0, tz / tl];
  // the trunk's own place along the plane (its middle; the boughs start inside it)
  const T = tl;
  const P = (x: number, y: number): V3 => [right[0] * x, y, right[2] * x];
  const pieces: Piece[] = [];
  let seed = 0.137;
  const chain = (pts: [number, number, number][], kind = 0, caps: [number, number] = [0, 0]) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0, r0] = pts[i], [x1, y1, r1] = pts[i + 1];
      pieces.push({ a: P(x0, y0), ra: r0, b: P(x1, y1), rb: r1, capA: i === 0 ? caps[0] : 0, capB: i === pts.length - 2 ? caps[1] : 0, kind, seed: (seed = (seed * 9.31 + 0.37) % 1) });
    }
  };
  // the ledges, and the logs that are them
  const log = { x0: -8.5, x1: -2.3, y: 1.1 };
  const low = { x0: 2.6, x1: 5.4, y: 1.9, r: 0.17 };
  const high = { x0: -1.3, x1: 1.2, y: 3.1, r: 0.19 };
  const ledges: Ledge[] = [
    { id: 'log', x0: log.x0, x1: log.x1, y: log.y, solid: true, thick: log.y },
    { id: 'bough', x0: low.x0, x1: low.x1, y: low.y, thick: low.r * 2 },
    { id: 'high', x0: high.x0, x1: high.x1, y: high.y, thick: high.r * 2 },
  ];
  // the fallen giant: one radius (its top is the ledge) from the broken end to where it flares into its roots
  const R = log.y / 2;
  chain([[-2.2, R, R], [log.x0 - 0.1, R, R]], 0, [2, 0]);
  chain([[log.x0 - 0.1, R, R], [-9.7, R + 0.1, R * 1.55]], 0, [0, 0]);
  // the root plate, torn up on its edge, earth and roots on its face; root stubs reaching out of it
  const plateX = -10.0, plateY = 0.95, plateR = 1.45;
  chain([[-9.75, plateY, plateR], [plateX - 0.35, plateY, plateR * 0.92]], 1, [3, 3]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4;
    const ry = Math.sin(a) * plateR * 0.85, rz = Math.cos(a) * plateR * 0.85;
    const at: V3 = [right[0] * (plateX - 0.25) - right[2] * rz, plateY + ry, right[2] * (plateX - 0.25) + right[0] * rz];
    const to: V3 = [at[0] - right[0] * (0.9 + 0.3 * (k % 2)) - right[2] * rz * 0.5, Math.max(-0.2, at[1] + ry * 0.4 - 0.3), at[2] - right[2] * (0.9 + 0.3 * (k % 2)) + right[0] * rz * 0.5];
    pieces.push({ a: at, ra: 0.13, b: to, rb: 0.035, capA: 0, capB: 0, kind: 0, seed: (seed = (seed * 9.31 + 0.37) % 1) });
  }
  // the low bough: out of the trunk, down, level along its ledge, its tip lifting
  chain([[T - 1.4, 2.6, 0.3], [8.3, 2.12, 0.24], [low.x1 + 0.2, low.y - low.r, low.r], [low.x0 - 0.2, low.y - low.r, low.r], [low.x0 - 1.1, low.y - 0.02, 0.07]]);
  // the high bough: out of the trunk higher up, down over the low one, level along its ledge, on over the middle
  chain([[T - 1.2, 6.7, 0.38], [7.8, 5.6, 0.31], [5.0, 4.7, 0.26], [2.6, 3.6, 0.22], [high.x1 + 0.1, high.y - high.r, high.r], [high.x0 - 0.3, high.y - high.r, high.r], [high.x0 - 1.6, high.y + 0.18, 0.07]]);
  const a = P(log.x1 + 0.1, 0), b = P(-9.6, 0), pc = P(plateX, 0);
  return { right, ledges, pieces, log: [a[0], a[2], b[0], b[2]], plate: [R, pc[0], pc[2], plateR] };
}

/** the pieces as trunks.wgsl reads them, each with how far along its chain it starts (the bark runs on unbroken) */
export function packPieces(pieces: Piece[]) {
  const out = new Float32Array(pieces.length * PIECE_FLOATS);
  let along = 0;
  pieces.forEach((p, i) => {
    const len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
    out.set([...p.a, p.ra, ...p.b, p.rb, p.capA, p.capB, along, p.seed, p.kind, 0, 0, 0], i * PIECE_FLOATS);
    along += len;
  });
  return out;
}

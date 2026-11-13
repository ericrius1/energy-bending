// The redwoods' stage, from one description: a plane through the middle of the clearing, aimed at the biggest tree of
// the fairy ring (its trunk stands on the plane, past the stage's right end), with a fallen giant lying along the
// plane on the left (its broken, hollow end towards the middle, its root plate torn up near the ring) and two boughs
// from that tree reaching in along the plane: a low one and, above it, a higher one that runs on over the middle. Each
// ledge is where a log's top runs level, and the logs are built from the same numbers: chains of tapered capsules
// (drawn by trunks.wgsl vs_stage with the trunks' bark), level and of one radius wherever a ledge is.
//
// A bough is a polyline smoothed into a curve (every corner rounded, so no kinks at its joints), cut into short
// capsules; it swells into a collar where it leaves the trunk, wanders a little off the plane where it isn't a ledge,
// and tapers to a lifting tip. The big pieces (the log, its root plate and roots) come first in `pieces`, the boughs'
// after them (`big` says where), because they are drawn at two levels of detail.
import type { Ledge } from '../stage';
import type { Solid } from '../solids';

type V3 = [number, number, number];

/** a capsule of the chain: from a (radius ra) to b (radius rb); each end round (0), flat (1), broken (2) or a torn
 *  root plate (3); `kind`: 0 bark, 1 the root plate's earth; `tiles`: how many times the bark goes round it (one
 *  number for a whole chain, so the bark meets itself from piece to piece) */
export interface Piece { a: V3; ra: number; b: V3; rb: number; capA: number; capB: number; kind: number; seed: number; tiles: number; chain: number }

/** what a piece is to trunks.wgsl (struct StageLog): a.xyz ra; b.xyz rb; capA capB along0 seed; kind tiles chain-seed - */
export const PIECE_FLOATS = 16;

export interface RedwoodsStage {
  right: [number, number, number];
  ledges: Ledge[];
  pieces: Piece[];
  /** how many of `pieces` are the big ones (the log, its plate, its roots); the boughs follow */
  big: number;
  /** for the plants to keep off: the fallen log's axis on the ground (x0 z0 x1 z1); its radius, then its root plate
   *  (x z radius) */
  log: [number, number, number, number];
  plate: [number, number, number, number];
}

/** a point on a bough's path in the plane: x along it, y up, r the radius, w how far off the plane (towards the eye) */
type Pt = [number, number, number, number?];

/** the path through pts with every corner rounded (a quadratic arc from `dIn` before the corner to `dOut` after it),
 *  sampled every `step` m: [x, y, r, w]. A level run (same height and radius both ends: a ledge) is kept straight to
 *  within 0.2 m of its ends, so the ledge stays level under the feet */
export function smoothPath(pts: Pt[], step = 0.3): [number, number, number, number][] {
  const P = pts.map(([x, y, r, w]) => [x, y, r, w ?? 0]);
  const n = P.length;
  const len = (i: number) => Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
  const level = (i: number) => Math.abs(P[i + 1][1] - P[i][1]) < 1e-6 && Math.abs(P[i + 1][2] - P[i][2]) < 1e-6;
  const lerp = (a: number[], b: number[], t: number) => a.map((v, k) => v + (b[k] - v) * t);
  const out: [number, number, number, number][] = [];
  const line = (a: number[], b: number[]) => {
    const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = out.length ? 1 : 0; k <= m; k++) out.push(lerp(a, b, k / m) as [number, number, number, number]);
  };
  let from = P[0];
  for (let i = 1; i < n - 1; i++) {
    const dIn = level(i - 1) ? 0.2 : Math.min(0.45 * len(i - 1), 1.0);
    const dOut = level(i) ? 0.2 : Math.min(0.45 * len(i), 1.0);
    const e = lerp(P[i], P[i - 1], dIn / len(i - 1)), x = lerp(P[i], P[i + 1], dOut / len(i));
    line(from, e);
    // the arc: a quadratic from e through the corner's pull to x
    const m = Math.max(2, Math.ceil((dIn + dOut) / step));
    for (let k = 1; k <= m; k++) {
      const t = k / m, u = 1 - t;
      out.push(e.map((v, j) => u * u * v + 2 * u * t * P[i][j] + t * t * x[j]) as [number, number, number, number]);
    }
    from = x;
  }
  line(from, P[n - 1]);
  return out;
}

/** the lanterns hung low between the stage and the locked camera (on its side of the plane, 3 to 8 m out, within 4 m
 *  of the middle along it) hang higher, their bottoms at `clear` m or more: from the lock's distance one hung large and
 *  blurred across the top of the frame. They keep their limbs and their light; only their cords are shorter */
export function liftLanterns(lanterns: { anchor: V3; cord: number }[], right: V3, clear = 6.4) {
  const lifted: number[] = [];
  lanterns.forEach((L, k) => {
    const along = L.anchor[0] * right[0] + L.anchor[2] * right[2], across = -L.anchor[0] * right[2] + L.anchor[2] * right[0];
    if (across > 3 && across < 8 && Math.abs(along) < 4 && L.anchor[1] - L.cord < clear) {
      L.cord = Math.max(0.6, L.anchor[1] - clear);
      lifted.push(k);
    }
  });
  return lifted;
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
  const toward: V3 = [-right[2], 0, right[0]];
  // the trunk's own place along the plane (its middle; the boughs start inside it)
  const T = tl;
  const P = (x: number, y: number, w = 0): V3 => [right[0] * x + toward[0] * w, y, right[2] * x + toward[2] * w];
  const pieces: Piece[] = [];
  let seed = 0.137;
  const next = () => (seed = (seed * 9.31 + 0.37) % 1);
  const tilesFor = (r: number) => Math.max(1, Math.round((6.2831853 * r) / 1.7));
  const chain = (pts: Pt[], kind = 0, caps: [number, number] = [0, 0]) => {
    const tiles = tilesFor(Math.max(...pts.map((p) => p[2]))), ch = next();
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0, r0, w0] = pts[i], [x1, y1, r1, w1] = pts[i + 1];
      pieces.push({ a: P(x0, y0, w0), ra: r0, b: P(x1, y1, w1), rb: r1, capA: i === 0 ? caps[0] : 0, capB: i === pts.length - 2 ? caps[1] : 0, kind, seed: next(), tiles, chain: ch });
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
  // the fallen giant, settled into the ground (its middle a little above it): one radius from the broken end to where
  // it flares into its roots, so its top is the ledge
  const R = 0.85, cy = log.y - R;
  chain([[-2.2, cy, R], [log.x0 - 0.1, cy, R]], 0, [2, 0]);
  chain([[log.x0 - 0.1, cy, R], [-9.7, cy + 0.15, R * 1.4]], 0, [0, 0]);
  // the root plate, torn up on its edge, earth and roots on its face; root stubs reaching out of it
  const plateX = -10.05, plateY = 1.05, plateR = 1.6;
  chain([[-9.75, plateY, plateR], [plateX - 0.35, plateY, plateR * 0.92]], 1, [3, 3]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4;
    const ry = Math.sin(a) * plateR * 0.85, rz = Math.cos(a) * plateR * 0.85;
    const at: V3 = [right[0] * (plateX - 0.3) - right[2] * rz, plateY + ry, right[2] * (plateX - 0.3) + right[0] * rz];
    const to: V3 = [at[0] - right[0] * (0.9 + 0.3 * (k % 2)) - right[2] * rz * 0.5, Math.max(-0.2, at[1] + ry * 0.4 - 0.3), at[2] - right[2] * (0.9 + 0.3 * (k % 2)) + right[0] * rz * 0.5];
    pieces.push({ a: at, ra: 0.13, b: to, rb: 0.035, capA: 0, capB: 0, kind: 0, seed: next(), tiles: 1, chain: next() });
  }
  const big = pieces.length;
  // the boughs: smooth paths cut into short capsules (each piece the next sample of its path)
  const bough = (pts: Pt[]) => chain(smoothPath(pts, 0.3).map(([x, y, r, w]) => [x, y, r, w] as Pt));
  // the low bough: a collar where it leaves the trunk, down, level along its ledge, its tip lifting (and off the plane a
  // little where it isn't a ledge, so it isn't ruled straight from above)
  bough([[T - 1.0, 2.66, 0.52], [T - 1.95, 2.58, 0.44], [9.2, 2.42, 0.3, 0.12], [8.0, 2.18, 0.25, 0.22], [6.8, 2.0, 0.21, 0.1],
    [low.x1 + 0.2, low.y - low.r, low.r], [low.x0 - 0.2, low.y - low.r, low.r], [low.x0 - 0.8, low.y - 0.12, 0.13, -0.08], [low.x0 - 1.4, low.y + 0.05, 0.085, -0.2]]);
  // the high bough: out of the trunk higher up, down over the low one (clear of a head standing on it), level along its
  // ledge, on over the middle, its tip lifting
  bough([[T - 1.0, 6.78, 0.58], [T - 1.7, 6.64, 0.48], [9.0, 6.25, 0.36, -0.15], [7.6, 5.55, 0.31, -0.3], [6.1, 4.8, 0.27, -0.25], [4.6, 4.15, 0.245, -0.1],
    [3.2, 3.75, 0.22], [2.1, 3.3, 0.2], [high.x1 + 0.1, high.y - high.r, high.r], [high.x0 - 0.3, high.y - high.r, high.r],
    [high.x0 - 1.0, high.y - 0.1, 0.14, 0.1], [high.x0 - 1.8, high.y + 0.08, 0.09, 0.25]]);
  const a = P(log.x1 + 0.1, 0), b = P(-9.6, 0), pc = P(plateX, 0);
  return { right, ledges, pieces, big, log: [a[0], a[2], b[0], b[2]], plate: [R, pc[0], pc[2], plateR] };
}

/** the pieces as trunks.wgsl reads them, each with how far along its chain it starts (the bark runs on unbroken) */
export function packPieces(pieces: Piece[]) {
  const out = new Float32Array(pieces.length * PIECE_FLOATS);
  let along = 0;
  pieces.forEach((p, i) => {
    const len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
    out.set([...p.a, p.ra, ...p.b, p.rb, p.capA, p.capB, along, p.seed, p.kind, p.tiles, p.chain, 0], i * PIECE_FLOATS);
    along += len;
  });
  return out;
}

/** the stage's logs as the camera's solids (World.solids): every piece of the chains a capsule of its wider radius
 *  (the fallen giant, its root plate and roots, every piece of both boughs) */
export function solidsOfStage(pieces: Piece[]): Solid[] {
  return pieces.map((p) => ({ kind: 'capsule' as const, a: [...p.a] as V3, b: [...p.b] as V3, r: Math.max(p.ra, p.rb) }));
}

// The redwoods' duel arena (src/duel/arena.ts), from one description: the clearing inside the fairy ring, the ring's
// trunks its walls all round, the jogo's stage as it lies (the fallen giant along the plane, the two boughs from the
// anchor tree) and, only in the duel, more of the wood to climb: low boughs grown in from the ring's trees toward the
// middle, each running level where a body can stand on it (its top exactly the bough's), a high one from a tree behind
// the stage's left end running along the plane over the log, another from the anchor tree, a second log fallen behind,
// stumps cut flat. Two drops open in the meadow on the plane (the backdrop opens them; the plants keep off them), one
// at the fallen giant's broken end. All of it drawn with the stage's own bark (trunks.wgsl vs_stage), built from chains
// of capsules as the stage's logs are.
import type { Ledge, Wall } from '../../engine/camera';
import { stagePlane } from '../stage';
import type { Solid } from '../solids';
import { arenas, drumSolid, floorWithDrops, mergeWalls, slicePlane, type Arena, type Drop, type PieceGroup } from '../../duel/arena';
import { layoutWoods } from './layout';
import { layoutStage, packPieces, type Piece } from './stage';

type V3 = [number, number, number];

export interface RedwoodsDuel {
  arena: Arena;
  /** its pieces as trunks.wgsl reads them (the big ones first: `big` of them, drawn in detail), packed */
  pieces: Float32Array;
  big: number;
  count: number;
}

/** the drops' depth */
const DEEP = 2.6;
const HALF = 8.4;

function build(): RedwoodsDuel {
  const woods = layoutWoods(), stage = layoutStage(woods.trunks);
  const right = stage.right, toward: V3 = [-right[2], 0, right[0]];
  /** a point given in the plane's coordinates (along, up, toward the camera) in the world */
  const P = (s: number, y: number, w = 0): V3 => [right[0] * s + toward[0] * w, y, right[2] * s + toward[2] * w];
  const big: Piece[] = [], small: Piece[] = [], groups: PieceGroup[] = [];
  let seed = 0.611;
  const next = () => (seed = (seed * 9.31 + 0.37) % 1);
  const tilesFor = (r: number) => Math.max(1, Math.round((6.2831853 * r) / 1.7));
  /** a chain of capsules through points [x, y, z, r] (world), into `to`; its solids into a group */
  const chain = (_id: string, pts: [V3, number][], to: Piece[], caps: [number, number] = [0, 0], kind = 0) => {
    const tiles = tilesFor(Math.max(...pts.map((p) => p[1]))), ch = next(), solids: Solid[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, ra] = pts[i], [b, rb] = pts[i + 1];
      to.push({ a, ra, b, rb, capA: i === 0 ? caps[0] : 0, capB: i === pts.length - 2 ? caps[1] : 0, kind, seed: next(), tiles, chain: ch });
      solids.push({ kind: 'capsule', a: [...a] as V3, b: [...b] as V3, r: Math.max(ra, rb) });
    }
    return solids;
  };
  /** a bough from ring tree k toward the clearing's middle (turned `turn` rad off it): out of a collar in the trunk, down
   *  to a level run from `d0` to `d1` metres from the tree's middle with its top at y, then a lifting tip */
  const ring = (k: number) => ({ x: woods.trunks[k * 4], z: woods.trunks[k * 4 + 1], R: woods.trunks[k * 4 + 2] });
  const bough = (id: string, k: number, turn: number, y: number, d0: number, d1: number, r: number) => {
    const t = ring(k), a0 = Math.atan2(-t.z, -t.x) + turn, dir: V3 = [Math.cos(a0), 0, Math.sin(a0)];
    const at = (d: number, h: number): V3 => [t.x + dir[0] * d, h, t.z + dir[2] * d];
    const solids = chain(id, [
      [at(t.R - 0.5, y + 0.75), r * 1.9], [at(t.R + 0.5, y + 0.45), r * 1.4], [at(d0, y - r), r], [at(d1, y - r), r],
      [at(d1 + 0.8, y - r + 0.1), r * 0.6], [at(d1 + 1.4, y - r + 0.3), r * 0.35],
    ], small);
    groups.push({ id, solids });
  };
  /** a stump cut flat at `top` (the drum's flat end: a broken one shows the heartwood) */
  const stump = (id: string, at: V3, r: number, top: number) => {
    big.push({ a: [at[0], -0.3, at[2]], ra: r * 1.25, b: [at[0], 0.4, at[2]], rb: r, capA: 1, capB: 0, kind: 0, seed: next(), tiles: tilesFor(r), chain: next() });
    big.push({ a: [at[0], 0.4, at[2]], ra: r, b: [at[0], top, at[2]], rb: r * 0.97, capA: 0, capB: 2, kind: 0, seed: next(), tiles: tilesFor(r), chain: next() });
    groups.push({ id, solids: [drumSolid([at[0], 0, at[2]], top, r)] });
  };

  // on the plane: a stump between the log and the low bough, a high bough along the plane over the log (from the ring
  // tree behind the stage's left end), and one more from the anchor tree under its high bough
  stump('stump', P(2.0, 0), 0.6, 1.5);
  {
    const t = ring(6), y = 4.6, r = 0.26;
    const tw: [number, number] = [t.x * right[0] + t.z * right[2], -t.x * right[2] + t.z * right[0]];
    const solids = chain('highL', [
      [P(tw[0] + t.R - 0.4, y + 0.9, tw[1] + 0.3), r * 1.9], [P(tw[0] + t.R + 0.4, y + 0.55, tw[1] + 1.4), r * 1.5],
      [P(-9.6, y - r + 0.15, -1.2), r * 1.15], [P(-8.6, y - r, 0), r], [P(-5.4, y - r, 0), r],
      [P(-4.6, y - r + 0.1, 0.1), r * 0.6], [P(-3.9, y - r + 0.3, 0.25), r * 0.35],
    ], small);
    groups.push({ id: 'highL', solids });
  }
  {
    const T = ring(0), tl = Math.hypot(T.x, T.z), y = 3.6, r = 0.22;
    const solids = chain('lowR', [
      [P(tl - 0.9, y + 0.5, 0), r * 1.9], [P(tl - 1.9, y + 0.25, 0.1), r * 1.4], [P(9.2, y - r, 0), r], [P(7.0, y - r, 0), r],
      [P(6.3, y - r + 0.1, -0.1), r * 0.6], [P(5.8, y - r + 0.3, -0.2), r * 0.35],
    ], small);
    groups.push({ id: 'lowR', solids });
  }
  // round the clearing: low boughs from the ring's trees (in front, toward the lock's camera, only low ones), stumps,
  // a second log fallen behind the stage
  bough('bough1', 1, 0.15, 2.2, 3.0, 6.0, 0.24);
  bough('bough7', 7, -0.2, 4.0, 2.6, 5.4, 0.25);
  bough('bough8', 8, 0.2, 2.8, 2.6, 5.6, 0.24);
  bough('bough4', 4, 0.35, 1.6, 2.6, 4.8, 0.22);
  bough('bough2', 2, -0.15, 1.5, 2.4, 4.8, 0.22);
  bough('bough3', 3, 0.25, 2.0, 2.5, 4.9, 0.22);
  stump('stumpL', P(-4.0, 0, 4.2), 0.75, 1.2);
  stump('stumpB', P(5.2, 0, -3.8), 0.8, 2.2);
  stump('stumpBL', P(-6.6, 0, -3.4), 0.65, 1.7);
  {
    const R = 0.6, a = P(-5.6, R - 0.08, -6.0), b = P(-1.0, R - 0.08, -8.0);
    const solids = chain('log2', [[a, R], [b, R * 0.9]], big, [2, 1]);
    groups.push({ id: 'log2', solids });
  }

  // the plane: the jogo's stage (the log solid, the boughs one-way), what the added pieces give it where they cross it,
  // the meadow with its two drops (one at the log's broken end)
  const halfWidth = HALF;
  const base = stagePlane({ id: 'redwoods.duel', origin: [0, 0, 0], right, halfWidth, ground: null, ledges: [], spawns: [[-0.4, 0], [3.4, 0]], lens: 40, height: 8 });
  const ledges: Ledge[] = [], walls: Wall[] = [];
  for (const l of stage.ledges) ledges.push({ ...l, x0: Math.max(l.x0, -HALF), x1: Math.min(l.x1, HALF) });
  const log = stage.ledges[0];
  walls.push({ id: 'log.r', s: log.x1, side: 1, y0: 0, y1: log.y });
  const cut = slicePlane(base, groups.filter((g) => ['stump', 'highL', 'lowR'].includes(g.id)).map((g) => ({ ...g, oneWay: g.id !== 'stump' })));
  for (const l of cut.ledges) ledges.push({ ...l, x0: Math.max(l.x0, -HALF), x1: Math.min(l.x1, HALF) });
  walls.push(...cut.walls.filter((w) => !w.id.startsWith('highL') && !w.id.startsWith('lowR')));
  const drops: Drop[] = [
    { s0: log.x1, s1: -0.9, behind: 0.9, front: 1.8, deep: DEEP },
    { s0: 5.8, s1: 7.0, behind: 0.9, front: 1.8, deep: DEEP },
  ];
  const floor = floorWithDrops('floor', -HALF, HALF, 0, DEEP, drops.map((d) => [d.s0, d.s1]));
  ledges.unshift(...floor.ledges);
  walls.push(...floor.walls);
  const plane = { ...base, ledges, walls: mergeWalls(walls, halfWidth) };

  const pieces = [...big, ...small];
  const arena: Arena = {
    world: 'redwoods',
    space: { center: [0.4, 0, 0], radius: 11, yKill: -2.2, yTop: 8.6 },
    spawns: [P(-0.2, 0, 2.6), P(3.6, 0, 2.2), P(-5.0, 1.1, 0), P(5.2, 2.2, -3.8), P(-4.0, 1.2, 4.2), P(1.0, 0, -5.5), P(2.0, 1.5, 0)],
    pieces: groups.flatMap((g) => g.solids), plane, drops,
    camera: { minDist: 6, maxDist: 9.5, lens: 40, low: -0.6 },
    // (the lanterns' warm light, a little green from the leaves)
    rim: [1.0, 0.82, 0.45],
  };
  return { arena, pieces: packPieces(pieces), big: big.length, count: pieces.length };
}

let made: RedwoodsDuel | null = null;
/** the redwoods' duel arena and the wood it adds (built once) */
export function redwoodsDuel(): RedwoodsDuel { return (made ??= build()); }

export function registerRedwoodsArena() { arenas.register(redwoodsDuel().arena); }

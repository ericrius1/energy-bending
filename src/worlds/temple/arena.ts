// The Tide Temple's duel arena (src/duel/arena.ts), from one description: the jogo's stage as it stands (the two broken
// pillars, the altar, the lintel on its two columns behind the stage) and, only in the duel, more of the ruin in the same
// stone, laid so each ledge is exactly the stone the eye sees: a second lintel on two columns mirroring the first, a
// high lintel over the middle on two taller columns further back, and at both ends of the court a tall column snapped
// off, still carrying a piece of its architrave out over a drop. The drops are pits in the court (the backdrop opens
// them: worlds/drops.wgsl), lined with ashlar down to the sea bed and flooded by the tide; the tall column's face and the
// broken pillar's face are their walls, and between them a shaft to kick up.
import { mulberry32 } from 'math/random';
import type { Ledge, Wall } from '../../engine/camera';
import { stagePlane } from '../stage';
import { arenas, floorWithDrops, mergeWalls, sides, type Arena, type Drop } from '../../duel/arena';
import { layoutTemple, solidsOf, STAGE_Z, STONE_FLOATS, type Stone } from './layout';
import { tideHazard } from '../../duel/hazards';

type V3 = [number, number, number];

export interface TempleDuel {
  arena: Arena;
  /** the duel's stones, blocks first (`blocks` of them), then drums, as stones.wgsl reads them */
  data: Float32Array;
  blocks: number;
  drums: number;
  /** the same stones as layout.ts describes them (the vines round its columns: garden.ts) */
  stones: Stone[];
}

/** how deep the drops are (to the sea bed, the backdrop's SEA) */
const DEEP = 2.6;

function build(): TempleDuel {
  const rng = mulberry32.create(37);
  const r = () => mulberry32.sample(rng);
  const SZ = STAGE_Z;
  const stones: Stone[] = [];
  const block = (at: V3, size: V3, more: Partial<Stone> = {}) => { stones.push({ kind: 'block', at, size, yaw: 0, tilt: 0, broken: 0, carve: 0, seed: r(), ...more }); };
  const drum = (at: V3, rad: number, h: number, more: Partial<Stone> & { top?: number } = {}) => {
    const { top, ...rest } = more;
    stones.push({ kind: 'drum', at, size: [rad, h, top ?? rad], yaw: r() * 6.283, tilt: 0, broken: 0, carve: 3, seed: r(), ...rest });
  };
  /** a whole column from y0 to y1, as layout.ts builds them: a base, the fluted shaft, a capital */
  const column = (x: number, z: number, y0: number, y1: number, rad: number) => {
    const bh = Math.min(0.2, rad * 0.32), ch = Math.min(0.42, rad * 0.62);
    drum([x, y0, z], rad * 1.28, bh, { top: rad * 1.03, carve: 0 });
    drum([x, y0 + bh, z], rad, y1 - y0 - bh - ch, { carve: 3 });
    drum([x, y1 - ch, z], rad * 0.97, ch, { top: rad * 1.3, carve: 0 });
  };
  /** a lintel on two columns standing behind the plane, its front edge over the stage (the jogo's lintel's build) */
  const lintel = (x0: number, x1: number, top: number, thick: number, z0: number, z1: number, inset: number, colZ: number) => {
    for (const x of [x0 + inset, x1 - inset]) {
      block([x, 0, colZ], [0.95, 0.2, 0.95]);
      column(x, colZ, 0.2, top - thick - 0.25, 0.35);
      block([x, top - thick - 0.25, colZ], [0.95, 0.25, 0.95], { carve: 1 });
    }
    block([(x0 + x1) / 2, top - thick, (z0 + z1) / 2], [x1 - x0, thick, z1 - z0], { carve: 1, broken: 0.03 });
  };
  const ledges: Ledge[] = [], walls: Wall[] = [];

  // the jogo's stage, as it stands (its stones are the world's own: layout.ts)
  const jogo = layoutTemple({ coarse: false }).ledges;
  const pillarL = jogo.find((l) => l.id === 'pillarL')!, pillarR = jogo.find((l) => l.id === 'pillarR')!, altar = jogo.find((l) => l.id === 'altar')!;
  for (const l of jogo) ledges.push({ ...l });
  for (const l of [pillarL, altar, pillarR]) walls.push(...sides(l.id, l.x0, l.x1, 0, l.y));

  // the tall broken columns at the ends: a stack of fluted drums snapped off at 4.6 m, a piece of their architrave lying
  // on them and reaching out over the drop toward the middle
  const colR = 0.63, colTop = 4.6, arch = { len: 2.8, thick: 0.5, depth: 1.05 };
  for (const side of [-1, 1] as const) {
    const id = side < 0 ? 'L' : 'R', x = side * (9 - colR), face = side * (9 - 2 * colR);
    let y = 0;
    for (const h of [1.55, 1.5, colTop - 3.05]) {
      drum([x, y, SZ], colR, h, { top: colR * (1 - 0.01 * (y + h)), carve: 3, broken: y + h >= colTop - 1e-6 ? 0.06 : 0 });
      y += h;
    }
    const a0 = side * 9, a1 = side * (9 - arch.len);
    block([(a0 + a1) / 2, colTop, SZ], [arch.len, arch.thick, arch.depth], { carve: 1, broken: 0.04, yaw: side * 0.015 });
    ledges.push({ id: `col${id}`, x0: Math.min(x - colR, face), x1: Math.max(x + colR, face), y: colTop, solid: true, thick: colTop });
    ledges.push({ id: `arch${id}`, x0: Math.min(a0, a1), x1: Math.max(a0, a1), y: colTop + arch.thick, solid: true, thick: arch.thick });
    walls.push({ id: `col${id}.face`, s: face, side: side < 0 ? 1 : -1, y0: 0, y1: colTop });
    walls.push({ id: `arch${id}.end`, s: a1, side: side < 0 ? 1 : -1, y0: colTop, y1: colTop + arch.thick });
  }
  // a second lintel mirroring the jogo's (its columns behind the stage at the same depth), and the high one over the
  // middle on two taller columns further back, clear of the low lintels' columns and their back edge, high enough over
  // them (2.25 m under it) that a jump from a low lintel doesn't meet its underside
  const low = jogo.find((l) => l.id === 'lintel')!;
  lintel(-low.x1, -low.x0, low.y, low.thick ?? 0.5, SZ - 1.55, SZ + 0.35, 0.55, SZ - 0.95);
  ledges.push({ id: 'lintelL', x0: -low.x1, x1: -low.x0, y: low.y, thick: low.thick });
  const high = { x0: -2.0, x1: 2.0, top: 5.9, thick: 0.55 };
  lintel(high.x0, high.x1, high.top, high.thick, SZ - 2.55, SZ + 0.3, 0.55, SZ - 2.15);
  ledges.push({ id: 'high', x0: high.x0, x1: high.x1, y: high.top, thick: high.thick });

  // round the court, off the plane: more of the ruin to climb, kick off and stand on in 3D. In front (toward the lock's
  // camera) low things: drums fallen on their sides, a toppled lintel, a plinth, a stub of a pillar; at the sides two more
  // tall snapped columns and courses of a wall; behind, a block and steps by the great gate, a column snapped at 3 m
  const lying = (x: number, z: number, rad: number, len: number, yaw: number) => drum([x, 0, z], rad, len, { tilt: 1, yaw, carve: 3 });
  const stack = (x: number, z: number, rad: number, heights: number[]) => {
    let y = 0;
    heights.forEach((h, i) => { drum([x, y, z], rad * (1 - 0.01 * y), h, { carve: 3, broken: i === heights.length - 1 ? 0.06 : 0 }); y += h; });
  };
  // (phase 5, the flow: report 18-flow. The same stones, moved off the court's floor to its rim, where each run of them
  // is a way up: the court in front of the stage is open floor to dance across (and the duel camera's side clear), and
  // the two mirrors' sites at the court's sides, in front of the tall columns, are open with a lane in to each. The
  // right rim is a stair from the front to its mirror: the stepped blocks, a fallen drum to hop on, a snapped stack;
  // past the mirror the tall stack beside the broken column. The left the same from the steps by the gate to its mirror,
  // then the stub and the tall stack up to the column; behind, the plinth, the cube, the low block and the stack toward
  // the high lintel)
  block([8.6, 0, 6.0], [1.8, 0.5, 1.3], { yaw: 0.6 });
  block([8.7, 0.5, 6.1], [1.1, 0.55, 0.9], { yaw: 0.6, broken: 0.04 });
  lying(10.2, 4.4, 0.5, 1.0, 0.25);
  stack(9.9, 2.6, 0.55, [1.0, 0.9]);
  stack(10.4, -3.0, 0.6, [1.5, 1.5]);
  block([6.0, 0, -7.6], [2.2, 0.9, 1.6], { yaw: 0.6, carve: 2 });
  stack(-10.4, -2.2, 0.6, [1.4]);
  lying(-9.0, -5.2, 0.5, 1.0, 1.0);
  block([-10.2, 0, 3.0], [1.7, 0.95, 1.0], { yaw: 1.3 });
  block([-10.25, 0.95, 3.0], [1.2, 0.5, 0.9], { yaw: 1.3, broken: 0.05 });
  stack(-10.6, -4.6, 0.6, [1.3, 1.2, 1.1]);
  block([-7.4, 0, -7.6], [3.0, 0.7, 1.0], { yaw: -0.65, broken: 0.05, carve: 1 });
  lying(-4.6, -8.7, 0.48, 0.96, 0.2);
  block([-2.4, 0, -7.6], [1.4, 1.4, 1.4], { carve: 2 });
  block([-0.6, 0, -6.7], [1.6, 0.55, 1.1]);
  stack(3.0, -8.0, 0.55, [1.6, 1.4]);
  block([9.4, 0, -5.2], [1.2, 2.2, 1.2], { broken: 0.06 });

  // the court's floor with its two drops: between each tall column and the broken pillar beside it
  const drops: Drop[] = [
    { s0: -(9 - 2 * colR), s1: pillarL.x0, behind: 0.65, front: 2.2, deep: DEEP },
    { s0: pillarR.x1, s1: 9 - 2 * colR, behind: 0.65, front: 2.2, deep: DEEP },
  ];
  const floor = floorWithDrops('floor', -9, 9, 0, DEEP, drops.map((d) => [d.s0, d.s1]));
  ledges.unshift(...floor.ledges);
  walls.push(...floor.walls);

  const halfWidth = 9;
  const plane = {
    ...stagePlane({ id: 'temple.duel', origin: [0, 0, SZ], right: [1, 0, 0], halfWidth, ground: null, ledges, spawns: [[-3, 0], [3, 0]], lens: 30, yaw: 0.07, pitch: 0.05, height: 7.6 }),
    walls: mergeWalls(walls, halfWidth),
  };
  const blocks = stones.filter((st) => st.kind === 'block'), drums = stones.filter((st) => st.kind === 'drum');
  const all = [...blocks, ...drums];
  const data = new Float32Array(all.length * STONE_FLOATS);
  all.forEach((st, i) => data.set([...st.at, st.yaw, ...st.size, st.kind === 'drum' ? 1 : 0, st.seed, st.broken, st.carve, st.tilt], i * STONE_FLOATS));
  const arena: Arena = {
    world: 'temple',
    space: { center: [0, 0, -0.5], radius: 11, yKill: -2.2, yTop: 9.0 },
    // (phase 5: the set starts out in the open court in front of the stage, not under its lintels)
    spawns: [[-2.6, 0, 1.6], [2.6, 0, 1.6], [6.0, 0.9, -7.6], [-7.6, colTop + arch.thick, SZ], [7.6, colTop + arch.thick, SZ], [3.0, 3.0, -8.0], [-3.5, 0, 5.5]],
    // the ways out (phase 5: report 18-flow): the two mirrors' sites (p5-wayfinding), at the court's sides in front of
    // the tall columns, each with a lane three metres deep in front of it and a stair of stones leading to it
    exits: [
      { id: 'right', at: [8.5, 0, -0.5], dir: [1, 0], r: 1.4 },
      { id: 'left', at: [-8.0, 0, 0.2], dir: [-1, 0], r: 1.4 },
    ],
    pieces: solidsOf(all), plane, drops,
    camera: { minDist: 9, maxDist: 22, lens: 30, low: -0.6 },
    // (the afterglow's warmth: the moon already silvers every top)
    rim: [1.0, 0.6, 0.32],
    // the hazard: the spring tide, in over the court for a while and out again over sixteen bars (highest on a phrase's
    // line): at its height 1.45 m deep, the court's floor and its low stones under it and the drops pools to swim,
    // a body floating with its feet 0.3 m over the floor; at its lowest the drops' water 0.5 m down their sides
    hazard: tideHazard({ low: -0.5, high: 1.45, bars: 16 }),
    // the shared energy here (phase 5, report 18-flow): the flowing movement carries the two further apart after a fling
    // (1.8 m apart on average, 1.6 before) and the energy ebbs more; gains a little larger and ebbs a little slower keep
    // the fusion about as often as before (Node: 7 of 40 sets, 5 before)
    energy: { gain: 1.06, ebb: 0.92 },
  };
  return { arena, data, blocks: blocks.length, drums: drums.length, stones: all };
}

let made: TempleDuel | null = null;
/** the temple's duel arena and the stones it adds (built once) */
export function templeDuel(): TempleDuel { return (made ??= build()); }

export function registerTempleArena() { arenas.register(templeDuel().arena); }

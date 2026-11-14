// The Pool's duel arena (src/duel/arena.ts), from one description: in the duel the black water is deep (a body that falls
// in sinks past the kill floor) and the space is a field of things rising out of it, drawn by stones.wgsl: stepping
// stones of dark wet stone and ice floes a stride apart, blocks a jump high, standing stones taller than a jump to kick
// off and climb, and through the middle, along the stage plane, a row of them laid as a stage: a big flat stone at each
// end with a standing stone on it, a floe either side of the middle, and in the middle a stone with an arch on it (two
// pillars, a lintel, a capstone balanced on top). Every piece is a rounded box whose solid is the box, so its top is
// exactly where a body stands and its sides are its walls.
import { mulberry32 } from 'math/random';
import { stagePlane } from '../stage';
import { boxOn, type Solid } from '../solids';
import { arenas, mergeWalls, slicePlane, topAt, type Arena, type PieceGroup } from '../../duel/arena';

type V3 = [number, number, number];

/** a piece: the middle of its foot, its size (width along its turn's x, height, depth), its turn, ice or stone, how
 *  round its edges */
interface Rock { at: V3; size: V3; yaw: number; ice: boolean; round: number; seed: number }

export const ROCK_FLOATS = 12;

export interface PoolDuel {
  arena: Arena;
  /** the pieces as stones.wgsl reads them */
  data: Float32Array;
  count: number;
}

/** how deep the stones go into the water (their feet), and the water's surface */
const FOOT = -1.6;

function build(): PoolDuel {
  const rng = mulberry32.create(71);
  const r = () => mulberry32.sample(rng);
  const rocks: Rock[] = [], groups: PieceGroup[] = [];
  /** a piece from its foot to `top` (on the plane: x from s0 to s1, depth d) */
  const rock = (id: string, x: number, z: number, w: number, d: number, y0: number, top: number, yaw = 0, ice = false, round = 0.12) => {
    rocks.push({ at: [x, y0, z], size: [w, top - y0, d], yaw, ice, round, seed: r() });
    const s = boxOn([x, y0, z], [w, top - y0, d], yaw);
    const g = groups.find((q) => q.id === id);
    if (g) g.solids.push(s); else groups.push({ id, solids: [s] });
    return s;
  };
  const span = (id: string, s0: number, s1: number, d: number, y0: number, top: number, ice = false, round = 0.12) => rock(id, (s0 + s1) / 2, 0, s1 - s0, d, y0, top, 0, ice, round);

  // along the plane: the stage
  span('endL', -9.0, -7.0, 2.0, FOOT, 0.3);
  span('menhirL', -8.8, -7.6, 1.0, 0.3, 3.7, false, 0.18);
  span('floeL', -5.9, -3.7, 2.4, -0.3, 0.2, true, 0.1);
  span('middle', -2.6, 2.6, 2.6, FOOT, 0.3);
  span('pillarL', -2.4, -1.6, 0.8, 0.3, 3.1, false, 0.1);
  span('pillarR', 1.6, 2.4, 0.8, 0.3, 3.1, false, 0.1);
  span('lintel', -2.6, 2.6, 1.0, 3.1, 3.55, false, 0.08);
  span('cap', -0.7, 0.7, 0.9, 3.55, 5.4, false, 0.2);
  span('floeR', 3.7, 5.9, 2.4, -0.3, 0.2, true, 0.1);
  span('endR', 7.0, 9.0, 2.0, FOOT, 0.3);
  span('menhirR', 7.6, 8.8, 1.0, 0.3, 3.7, false, 0.18);
  const onPlane = groups.map((g) => g.id);

  // round it: a lattice of places a stride and a half apart (jittered), each a stepping stone, a floe, a block or a
  // standing stone; the plane's band and the gate's water left clear
  const gate: [number, number] = [-7.5, 4.5];
  const step = 2.75, places: [number, number][] = [];
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
    const x = (i + (j & 1 ? 0.5 : 0)) * step + (r() - 0.5) * 0.6, z = j * step * 0.866 + (r() - 0.5) * 0.6;
    if (Math.hypot(x, z) > 11.6) continue;
    if (Math.abs(z) < 2.4 && Math.abs(x) < 10) continue;
    if (Math.hypot(x - gate[0], z - gate[1]) < 2.6) continue;
    places.push([x, z]);
  }
  // the standing stones: six round the field at mid radius, alternating sides; a block a jump high beside each
  const tall = new Set<number>(), steps = new Set<number>();
  const order = places.map((p, k) => [k, Math.atan2(p[1], p[0]), Math.hypot(p[0], p[1])] as const).filter(([, , d]) => d > 4.5 && d < 9.5).sort((a, b) => a[1] - b[1]);
  for (let k = 0; k < order.length && tall.size < 7; k += Math.max(1, Math.floor(order.length / 7))) tall.add(order[k][0]);
  for (const t of tall) {
    let best = -1, bd = Infinity;
    places.forEach((p, k) => {
      if (k === t || tall.has(k) || steps.has(k)) return;
      const d = Math.hypot(p[0] - places[t][0], p[1] - places[t][1]);
      if (d < bd) { bd = d; best = k; }
    });
    if (best >= 0) steps.add(best);
  }
  places.forEach(([x, z], k) => {
    const yaw = r() * Math.PI, id = `rock${k}`;
    if (tall.has(k)) rock(id, x, z, 1.0 + 0.4 * r(), 0.9 + 0.3 * r(), FOOT, 3.2 + 1.6 * r(), yaw, false, 0.18);
    else if (steps.has(k)) rock(id, x, z, 1.4 + 0.4 * r(), 1.3 + 0.3 * r(), FOOT, 1.4 + 0.6 * r(), yaw);
    else if (r() < 0.4) rock(id, x, z, 1.5 + 0.6 * r(), 1.3 + 0.5 * r(), -0.3, 0.18 + 0.04 * r(), yaw, true, 0.1);
    else if (r() < 0.22) rock(id, x, z, 1.3 + 0.4 * r(), 1.2 + 0.4 * r(), FOOT, 0.8 + 0.4 * r(), yaw);
    else rock(id, x, z, 1.3 + 0.5 * r(), 1.2 + 0.5 * r(), FOOT, 0.25 + 0.1 * r(), yaw);
  });

  const halfWidth = 9;
  const base = stagePlane({ id: 'pool.duel', origin: [0, 0, 0], right: [1, 0, 0], halfWidth, ground: null, ledges: [], spawns: [[-4.8, 0.2], [4.8, 0.2]], lens: 26, height: 7 });
  const cut = slicePlane(base, groups.filter((g) => onPlane.includes(g.id)).map((g) => (g.id.startsWith('pillar') ? { ...g, noTop: true } : g)));
  const plane = { ...base, ledges: cut.ledges.map((l) => ({ ...l, x0: Math.max(l.x0, -halfWidth), x1: Math.min(l.x1, halfWidth) })), walls: mergeWalls(cut.walls, halfWidth) };

  const pieces: Solid[] = groups.flatMap((g) => g.solids);
  // the spawns: the middle stone under the arch, the two floes, and stones round the field far apart
  const standOn = (x: number, z: number): V3 => [x, Math.max(...pieces.map((s) => topAt(s, x, z))), z];
  const spawns: V3[] = [[0, 0.3, 0.7], [-4.8, 0.2, 0], [4.8, 0.2, 0]];
  for (const want of [Math.PI * 0.5, Math.PI * 1.5, Math.PI * 0.15, Math.PI * 1.15]) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const [x, z] of places) {
      const d = Math.abs(Math.atan2(Math.sin(Math.atan2(z, x) - want), Math.cos(Math.atan2(z, x) - want))) * 6 + Math.abs(Math.hypot(x, z) - 7.5);
      if (d < bd) { bd = d; best = [x, z]; }
    }
    if (best) spawns.push(standOn(best[0], best[1]));
  }
  const arena: Arena = {
    world: 'pool',
    space: { center: [0, 0, 0], radius: 12, yKill: -1.4, yTop: 8.0 },
    spawns, pieces, plane,
    camera: { minDist: 8, maxDist: 24, lens: 26, low: -1.0 },
    drops: [],
    // (the moon's cold light)
    rim: [0.6, 0.78, 1.0],
  };
  const data = new Float32Array(rocks.length * ROCK_FLOATS);
  rocks.forEach((k, i) => data.set([...k.at, k.yaw, ...k.size, k.ice ? 1 : 0, k.seed, k.round, 0, 0], i * ROCK_FLOATS));
  return { arena, data, count: rocks.length };
}

let made: PoolDuel | null = null;
/** the Pool's duel arena and the stones it adds (built once) */
export function poolDuel(): PoolDuel { return (made ??= build()); }

/** the water's floor in the duel: the top of a stone or floe a body could wade onto from the water (none: deep) */
export function poolGround(x: number, z: number) {
  let g = -3;
  for (const s of poolDuel().arena.pieces!) { const t = topAt(s, x, z); if (t > g && t < 0.5) g = t; }
  return g;
}

export function registerPoolArena() { arenas.register(poolDuel().arena); }

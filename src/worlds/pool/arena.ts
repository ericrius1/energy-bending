// The Pool's duel arena (src/duel/arena.ts), from one description: in the duel the water is deep, and it is a floor
// to swim in (phase 3, hazards.ts: a body that misses a stone lands in the water with a ripple, floats with its head and
// shoulders out, swims slower than it runs, and kicks up onto a stone; nobody falls out of the Pool), and on each phrase a
// swell rolls across it that the floes ride and the low stones rock on. The space is a field of things rising out of
// the water, drawn by stones.wgsl (phase 5, report 18: the low stones glazed planters with brass rims and planting round
// their rims, the blocks and standing stones terracotta and brass, the floes woven rafts; the water garden round them is
// garden.ts, the pavilion, arches and fountains at the rim edge.ts): stepping
// stones and floes a stride apart, blocks a jump high, standing stones taller than a jump to kick
// off and climb, and through the middle, along the stage plane, a row of them laid as a stage: a big flat stone at each
// end with a standing stone on it, a floe either side of the middle, and in the middle a stone with an arch on it (two
// pillars, a lintel, a capstone balanced on top). Every piece is a rounded box whose solid is the box, so its top is
// exactly where a body stands and its sides are its walls (the low ones drawn with their corners rounded off as pads, up
// to 17 cm inside the box's corners: nothing about the solids changed).
import { mulberry32 } from 'math/random';
import { stagePlane } from '../stage';
import { boxOn, type Solid } from '../solids';
import { arenas, mirrorExits, mergeWalls, slicePlane, topAt, type Arena, type PieceGroup } from '../../duel/arena';
import { MIRROR_SITES } from '../../portals/mirrors';
import { swellHazard, waterFloor, type Mover } from '../../duel/hazards';

type V3 = [number, number, number];

/** a piece: the middle of its foot, its size (width along its turn's x, height, depth), its turn, ice or stone, how
 *  round its edges, how round its corners seen from above (drawn only: the solid stays the box), and what it is to the
 *  eye (ROCK_LOOK) */
interface Rock { at: V3; size: V3; yaw: number; ice: boolean; round: number; seed: number; plan: number; look: number }

/** what a piece is drawn as (stones.wgsl, phase 5): a low stone a glazed ceramic planter with a brass rim, a block a jump
 *  high terracotta with a band of glazed tile, a raft woven fibre bound in brass; (report 24) a standing stone a column of
 *  white glaze on a teal dado, a green-glazed whiplash up it, copper bands, its top planted; and the arch on the middle
 *  stone the sun gate: its pillars such columns with copper capitals, its lintel a beam of copper gone green with a gold
 *  whiplash, its capstone a lantern of stained glass in copper. Drawn only: the solids are the boxes they were */
export const ROCK_LOOK = { planter: 0, block: 1, standing: 2, raft: 3, gatePillar: 4, beam: 5, lantern: 6 } as const;
const LOOK_OF: Record<string, number> = { pillarL: ROCK_LOOK.gatePillar, pillarR: ROCK_LOOK.gatePillar, lintel: ROCK_LOOK.beam, cap: ROCK_LOOK.lantern };

export const ROCK_FLOATS = 12;

export interface PoolDuel {
  arena: Arena;
  /** the pieces as stones.wgsl reads them */
  data: Float32Array;
  count: number;
}

/** how deep the stones go into the water (their feet), and the water's surface */
const FOOT = -1.6;
/** the mirrors' sites (p5-wayfinding: a gate to another world each, at the field's edge), kept open water this far round
 *  (m, to a stone's middle) */
const MIRRORS: [number, number][] = MIRROR_SITES.filter((s) => s.world === 'pool').map((s) => [s.x, s.z]);
const MIRROR_CLEAR = 2.4;
/** the channels of open water out from the middle (bearings, atan2(z, x)): toward the gate to the geode and toward each
 *  mirror; and how far either side of each line no stone stands (m) */
const CHANNELS = [Math.atan2(4.5, -7.5), ...MIRRORS.map(([x, z]) => Math.atan2(z, x))];
const CHANNEL_HALF = 1.5;

function build(): PoolDuel {
  const rng = mulberry32.create(71);
  const r = () => mulberry32.sample(rng);
  const rocks: Rock[] = [], groups: PieceGroup[] = [], movers: Mover[] = [];
  /** the stones on the plane's stage stay put (the arch stands on the middle one, the menhirs on the ends) */
  const still = new Set(['endL', 'middle', 'endR', 'menhirL', 'menhirR', 'pillarL', 'pillarR', 'lintel', 'cap']);
  /** a piece from its foot to `top` (on the plane: x from s0 to s1, depth d) */
  const rock = (id: string, x: number, z: number, w: number, d: number, y0: number, top: number, yaw = 0, ice = false, round = 0.12) => {
    // (the low pieces seen from above as round pads, not square tiles: their corners rounded off in the drawing by up to
    // 0.4 m, which leaves the box's corner 0.17 m out along its diagonal, where nobody stands; report 18)
    const look = LOOK_OF[id] ?? (ice ? ROCK_LOOK.raft : top < 0.5 ? ROCK_LOOK.planter : top < 2.5 && y0 <= FOOT ? ROCK_LOOK.block : ROCK_LOOK.standing);
    const small = Math.min(w, d) / 2;
    // (report 24: a standing stone and the gate's pillars round in plan as columns, up to 0.4 m off a corner like the
    // planters: the box's corner left 0.17 m out along its diagonal)
    const column = look === ROCK_LOOK.standing || look === ROCK_LOOK.gatePillar;
    const plan = look === ROCK_LOOK.raft || look === ROCK_LOOK.planter || column ? Math.min(0.4, small * 0.6) : look === ROCK_LOOK.block ? Math.min(0.24, small * 0.4) : round;
    rocks.push({ at: [x, y0, z], size: [w, top - y0, d], yaw, ice, round, seed: r(), plan: Math.max(plan, round), look });
    const s = boxOn([x, y0, z], [w, top - y0, d], yaw);
    // (the floes ride the swell; the low stepping stones rock on it a little; the tall ones stand)
    if (!still.has(id) && (ice || top < 0.5) && s.kind === 'box') movers.push({ solid: s, rest: [s.c[0], s.c[1], s.c[2]], k: ice ? 1 : 0.4, index: rocks.length - 1 });
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
    // (phase 5, the flow: report 18-flow. Channels of open water run out from the middle, a stone's width and more,
    // to glide along: to the gate and to each mirror's site, beside the one along the stage; round each mirror open water)
    if (MIRRORS.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < MIRROR_CLEAR)) continue;
    if (CHANNELS.some((a) => { const along = x * Math.cos(a) + z * Math.sin(a); return along > 2 && Math.abs(-x * Math.sin(a) + z * Math.cos(a)) < CHANNEL_HALF; })) continue;
    places.push([x, z]);
  }
  // the standing stones: five round the field toward its rim (phase 5, report 18-flow: seven at mid radius before,
  // walling the pair and the camera in), spread round it; a block a jump high beside each
  const tall = new Set<number>(), steps = new Set<number>();
  const order = places.map((p, k) => [k, Math.atan2(p[1], p[0]), Math.hypot(p[0], p[1])] as const).filter(([, , d]) => d > 7.5 && d < 10.8).sort((a, b) => a[1] - b[1]);
  for (let k = 0; k < order.length && tall.size < 5; k += Math.max(1, Math.floor(order.length / 5))) tall.add(order[k][0]);
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
      if (spawns.some((s) => Math.hypot(s[0] - x, s[2] - z) < 3.5)) continue;
      const d = Math.abs(Math.atan2(Math.sin(Math.atan2(z, x) - want), Math.cos(Math.atan2(z, x) - want))) * 6 + Math.abs(Math.hypot(x, z) - 7.5);
      if (d < bd) { bd = d; best = [x, z]; }
    }
    if (best) spawns.push(standOn(best[0], best[1]));
  }
  const arena: Arena = {
    world: 'pool',
    // (the water is a floor now: the kill floor stands for a body somehow under it)
    space: { center: [0, 0, 0], radius: 12, yKill: -2.0, yTop: 8.0 },
    spawns, pieces, plane,
    camera: { minDist: 8, maxDist: 24, lens: 26, low: -1.0 },
    drops: [],
    // the ways out (phase 5: report 18-flow): the mirrors' sites, each at the end of its channel
    exits: mirrorExits('pool', { at: [-7.5, 0, 4.5], dir: [-0.83, 0.55], r: 1.4 }),
    // (the evening sun's gold, faint: the stones and rafts are dark and warm now, the bodies on them pale)
    rim: [0.34, 0.24, 0.11],
    // the hazard: a swell across the pool on each phrase, from a different side in turn (hazards.ts)
    hazard: swellHazard({ amp: 0.32, width: 2.1, reach: 13, dirs: [0.3, 2.4, 4.4, 1.3, 3.5, 5.5], movers }),
    // the shared energy here (shared/duel.ts DuelTune): the water keeps the two within reach and the swell throws them
    // together, so they meet more and more often in the air (three catches in four from the air, a third more catches
    // than elsewhere) and the energy sat at the top; its gains a little smaller and its ebbs a little faster keep the
    // fusion as rare as in the other worlds (report 14-pool-fusion: 31 of 40 sets fused, now about 1 in 9). Phase 5
    // (report 18-flow): with the channels open and the flowing movement the two are carried further apart, and 0.93
    // and 1.15 fused no set of 40 in Node (8 before); 1.0 and 1.02 fuse 8 of 40 again
    energy: { gain: 1.0, ebb: 1.02 },
  };
  const data = new Float32Array(rocks.length * ROCK_FLOATS);
  rocks.forEach((k, i) => data.set([...k.at, k.yaw, ...k.size, k.ice ? 1 : 0, k.seed, k.round, k.plan, k.look], i * ROCK_FLOATS));
  return { arena, data, count: rocks.length };
}

let made: PoolDuel | null = null;
/** the Pool's duel arena and the stones it adds (built once) */
export function poolDuel(): PoolDuel { return (made ??= build()); }

/** the pool's bed in the duel: the top of a stone or floe a body could wade onto from the water (none: deep) */
export function poolBed(x: number, z: number) {
  let g = -3;
  for (const s of poolDuel().arena.pieces!) { const t = topAt(s, x, z); if (t > g && t < 0.8) g = t; }
  return g;
}
/** the floor in the duel: the bed, or the water a body floats in over it (with the swell on it) */
export function poolGround(x: number, z: number) { return Math.max(poolBed(x, z), waterFloor(poolDuel().arena.hazard, x, z)); }

/** the stones' data for stones.wgsl with each mover where the swell has it now (into `out`, a copy of `data`); whether
 *  any moved */
export function poolStonesNow(out: Float32Array): boolean {
  const D = poolDuel(), S = D.arena.hazard?.swell;
  if (!S) return false;
  let moved = false;
  S.movers.forEach((m, i) => {
    const o = m.index * ROCK_FLOATS + 1, y = D.data[o] + S.bob[i];
    if (out[o] !== y) { out[o] = y; moved = true; }
  });
  return moved;
}

export function registerPoolArena() { arenas.register(poolDuel().arena); }

// The geode's duel arena (src/duel/arena.ts), from one description: the jogo's stage through the middle of the hollow
// (the low blade of selenite on the left, solid, the higher one on the right, the high one reaching out over the middle
// from its druse behind) and, only in the duel, more crystal grown the same way. At the arena's ends two great crystals
// stand up out of the floor, its walls; from each a shelf of selenite grows in along the plane. From behind, out of
// druses and a great crystal trunk behind the middle, three more shelves reach forward across the plane, two high and
// one at the top, as the jogo's high blade does. Two drops crack the agate either side of the middle, each with a
// standing beam of selenite on its outer edge, snapped off flat: a wall from the bottom of the drop to its top. Shelves
// are rafts of blades (shelves.wgsl), their tops flush (the ledge); the beams are blades stood upright, so their faces
// are exactly where the walls are; the great crystals and druses are crystal points (crystals.wgsl).
import { mulberry32 } from 'math/random';
import type { Ledge, Wall } from '../../engine/camera';
import { stagePlane } from '../stage';
import { arenas, floorWithDrops, mergeWalls, sides, type Arena, type Drop } from '../../duel/arena';
import { layoutShelves, packBlades, solidsOfShelves, type Blade } from './shelves';
import { HUB_GATES } from './gates';
import { boxOn, type Solid } from '../solids';
import { humHazard } from '../../duel/hazards';

type V3 = [number, number, number];

export interface GeodeDuel {
  arena: Arena;
  /** the shelves and beams (shelves.wgsl) and the crystal points (crystals.wgsl) it adds, packed */
  blades: Float32Array;
  bladeCount: number;
  points: Float32Array;
  pointCount: number;
  /** where its beams stand and its shelves reach, for the planting (garden.ts: ferns at a beam's foot, vines over a
   *  shelf's edge): a beam's middle (x, z), its top, its width and depth, its turn; a shelf's root, its turn, width and
   *  length */
  decor: { beams: { x: number; z: number; top: number; w: number; depth: number; yaw: number }[]; shelves: { root: V3; yaw: number; w: number; len: number }[] };
}

/** the drops' depth (m), and how far they reach in front of the plane (2.2 m until phase 4: the pair dances most in
 *  front of the middle, and the drops' front corners took most of the falls) */
const DEEP = 2.4;
const FRONT = 1.2;
/** where the hum's column may rise: open agate with floor all round (r + 0.6 m clear of the drops) and nothing over it
 *  for 6 m, spread where the pair dances (most in front of the middle: report 16's map of where the two stand) */
const HUM_SPOTS: V3[] = [[0, 0, 2.6], [-2.5, 0, -4.5], [3.3, 0, 4.2], [-6.6, 0, 2.6], [0, 0, 4.8], [2.5, 0, -4.5], [-3.5, 0, 4.0], [0, 0, 6.8]];
/** the arena's ends: the great crystals' faces */
const HALF = 8.7;

function build(): GeodeDuel {
  const rng = mulberry32.create(53);
  const r = () => mulberry32.sample(rng);
  const blades: Blade[] = [], points: Blade[] = [], beamSolids = new Map<Blade, Solid>();
  const decor: GeodeDuel['decor'] = { beams: [], shelves: [] };
  const aim = (d: V3) => { const l = Math.hypot(...d) || 1; return { yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / l))) }; };
  /** a shelf as shelves.ts grows them: a raft of prisms side by side, their tops flush, from `root` along `yaw` */
  const raft = (root: V3, yaw: number, across: [number, number], w: number, len: number) => {
    decor.shelves.push({ root, yaw, w, len });
    const n = Math.max(2, Math.round(w / 0.7)), pw = w / n;
    for (let k = 0; k < n; k++) {
      const off = (k + 0.5) * pw - w / 2;
      blades.push({ at: [root[0] + across[0] * off, root[1], root[2] + across[1] * off], yaw, pitch: 0, w: pw * 0.97, thick: pw * (0.7 + 0.25 * r()), len: len + 0.35 * r(), tip: 0.7 + 0.4 * r(), seed: r() });
    }
  };
  /** a beam of selenite stood up out of the floor (a blade pitched straight up, its width along the plane, its depth
   *  across it, centred on the plane), snapped off flat at `top` */
  const beam = (s0: number, s1: number, top: number, depth: number, z = 0, yaw = 0) => {
    // (from the floor up: the backdrop writes no depth, so anything under the floor would show through it; the drop's
    // side below is the backdrop's)
    const x = (s0 + s1) / 2;
    decor.beams.push({ x, z, top, w: s1 - s0, depth, yaw });
    const b: Blade ={ at: [x - Math.sin(yaw) * depth / 2, 0, z - Math.cos(yaw) * depth / 2], yaw, pitch: Math.PI / 2, w: s1 - s0, thick: depth, len: top, tip: 0.04, seed: r() };
    blades.push(b);
    beamSolids.set(b, boxOn([x, 0, z], [s1 - s0, top, depth], yaw));
  };
  const point = (at: V3, dir: V3, w: number, len: number, tint: number, glow: number, tip?: number) => {
    points.push({ at, ...aim(dir), w, thick: w, len, tip: tip ?? w * (0.9 + 0.8 * r()), seed: r(), tint, glow });
  };
  const druse = (x: number, z: number, high: number, n: number, spread: number, tint = 4, glow = 0.55) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, rr = spread * Math.sqrt(r()) * (k === 0 ? 0.2 : 1), lean = (0.12 + 0.4 * r()) * (k === 0 ? 0.3 : 1);
      point([x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr], [Math.cos(a) * lean, 1, Math.sin(a) * lean], (0.16 + 0.22 * r()) * (k === 0 ? 1.6 : 1), (k === 0 ? 1 : 0.3 + 0.55 * r()) * high, tint, glow);
    }
  };
  const ledges: Ledge[] = [], walls: Wall[] = [];

  // the jogo's shelves (shelves.ts), the side ones running on to their roots and stopping at the beams
  const jogo = layoutShelves({ caveRadius: 12 }).ledges;
  const beamL: [number, number] = [-4.2, -3.4], beamR: [number, number] = [3.4, 4.2], beamTop = 3.0;
  for (const l of jogo) {
    if (l.id === 'shelfL') ledges.push({ ...l, x0: -7.4, x1: beamL[0] });
    else if (l.id === 'shelfR') ledges.push({ ...l, x0: beamR[1], x1: 7.4 });
    else ledges.push({ ...l });
  }
  // the great crystals at the ends (the plane's ends are their faces), each with a druse round its foot
  for (const side of [-1, 1]) {
    point([side * (HALF + 0.62), 0, 0.05], [side * 0.02, 1, 0], 1.3, 7.6, 4, 0.7, 1.7);
    druse(side * (HALF + 0.3), 0.7, 1.6, 4, 0.6);
  }
  // shelves from the great crystals in along the plane: the left lower than the right, as the jogo's are
  // (2 m clear over the jogo's low shelves under them, so a jump from those doesn't meet their undersides)
  const mids = [{ id: 'midL', side: -1, y: 3.6, to: -6.0 }, { id: 'midR', side: 1, y: 4.4, to: 6.0 }];
  for (const m of mids) {
    raft([m.side * HALF, m.y, 0], -m.side * Math.PI / 2, [0, 1], 1.4, Math.abs(m.to - m.side * HALF));
    ledges.push({ id: m.id, x0: Math.min(m.side * HALF, m.to), x1: Math.max(m.side * HALF, m.to), y: m.y, thick: 0.45 });
  }
  // from behind: a great crystal trunk behind the middle and druses behind the high shelves, the shelves reaching out of
  // them across the plane (0.7 m past it, as the jogo's high blade does)
  point([0, 0, -5.7], [0, 1, 0.03], 1.6, 8.4, 4, 0.8, 1.6);
  druse(0, -5.2, 2.2, 5, 1.0);
  const highs = [{ id: 'highL', x: -4.3, y: 5.8, w: 1.8, z: -3.9 }, { id: 'highR', x: 4.3, y: 5.8, w: 1.8, z: -3.9 }, { id: 'top', x: 0, y: 7.4, w: 2.0, z: -5.0 }];
  for (const h of highs) {
    raft([h.x, h.y, h.z], 0, [1, 0], h.w, 0.7 - h.z);
    ledges.push({ id: h.id, x0: h.x - h.w / 2, x1: h.x + h.w / 2, y: h.y, thick: 0.5 });
    if (h.x !== 0) druse(h.x, h.z - 0.4, h.y + 1.4, 6, 0.9);
  }
  // the drops either side of the middle, each with a beam on its outer edge
  const drops: Drop[] = [
    { s0: beamL[1], s1: -1.9, behind: 0.8, front: FRONT, deep: DEEP },
    { s0: 1.9, s1: beamR[0], behind: 0.8, front: FRONT, deep: DEEP },
  ];
  const floor = floorWithDrops('floor', -HALF, HALF, 0, DEEP, drops.map((d) => [d.s0, d.s1]));
  ledges.unshift(...floor.ledges);
  walls.push(...floor.walls);
  for (const [id, b, low] of [['beamL', beamL, 1.1], ['beamR', beamR, 0]] as const) {
    beam(b[0], b[1], beamTop, 0.9);
    ledges.push({ id, x0: b[0], x1: b[1], y: beamTop, solid: true, thick: beamTop + DEEP });
    const [l, rw] = sides(id, b[0], b[1], 0, beamTop);
    // (the left beam's outer face is under the solid low shelf up to its top; the beams' faces over the drops go down
    // into them)
    walls.push(id === 'beamL' ? { ...l, y0: low } : l, rw);
  }
  // a few small points round the beams' feet and the drops' rims
  for (const s of [beamL[0] - 0.2, beamR[1] + 0.2, -1.6, 1.6]) for (let k = 0; k < 2; k++) {
    point([s + (r() - 0.5) * 0.4, 0, -0.5 - r() * 0.6], [(r() - 0.5) * 0.5, 1, -0.3 * r()], 0.1 + 0.08 * r(), 0.3 + 0.4 * r(), 4, 0.6);
  }

  // round the hollow, off the plane: beams of selenite standing up out of the agate (their flat tops to stand on, their
  // faces to kick off), and shelves grown in from the wall behind and at the sides, each out of a druse; the front, where
  // the gates stand and their paths run to the middle, left open but for two low beams
  const beams3: [number, number, number, number, number][] = [
    // x, z, top, width (= depth), turn
    [-6.4, -3.4, 2.0, 0.9, 0.3], [6.6, -3.0, 2.4, 0.9, -0.4], [-3.4, -6.9, 3.6, 0.8, 0.2], [3.4, -6.6, 2.8, 0.9, -0.2],
    [-8.4, -5.6, 1.4, 1.0, 0.6], [8.3, -5.8, 3.4, 0.8, -0.5], [0, -8.9, 1.6, 1.0, 0],
    [1.6, 3.4, 1.0, 0.8, 0.4], [-1.7, 3.6, 1.3, 0.8, -0.3],
    // (phase 5, report 18-flow: off the redwoods gate's path in front, where it stood at [0, 7.4] and the camera's eye
    // passes, to the right side behind the plane's end)
    [8.4, -1.9, 1.6, 0.8, 0.3],
  ];
  for (const [x, z, top, w, yaw] of beams3) {
    beam(x - w / 2, x + w / 2, top, w, z, yaw);
    point([x + 0.4 * (r() - 0.5), 0, z + w * 0.6], [(r() - 0.5) * 0.5, 1, 0.3], 0.12 + 0.08 * r(), 0.4 + 0.4 * r(), 4, 0.6);
  }
  // shelves from the wall: (bearing in degrees, 0 along +x, negative behind), height, width, length in
  const wallShelves: [number, number, number, number][] = [[-28, 1.8, 1.6, 2.6], [-58, 4.4, 1.6, 3.0], [-122, 4.4, 1.6, 3.0], [-152, 1.9, 1.6, 2.6], [-90, 5.9, 1.6, 2.4], [14, 3.2, 1.4, 1.6], [166, 3.0, 1.4, 1.6]];
  for (const [deg, y, w, len] of wallShelves) {
    const a = (deg * Math.PI) / 180, root = 10.9 - y * 0.12, inward = Math.atan2(-Math.cos(a), -Math.sin(a));
    raft([Math.cos(a) * root, y, Math.sin(a) * root], inward, [Math.cos(inward), -Math.sin(inward)], w, len);
    druse(Math.cos(a) * (root + 0.4), Math.sin(a) * (root + 0.4), y + 1.2, 5, 0.8);
  }

  // brass-and-glass lanterns hung under the shelves (crystals.wgsl's tint 5, their points down; under 45 cm, not
  // solids), laid without the dice so nothing grown before them moves
  const lanterns: V3[] = [[-7.3, 3.6, 0.4], [7.3, 4.4, -0.4], [-4.3, 5.8, -1.2], [4.3, 5.8, -1.2], [-0.6, 7.4, -1.8], [0.6, 7.4, -3.2]];
  lanterns.forEach(([x, y, z], k) => points.push({ at: [x, y - 0.5, z], yaw: 0, pitch: -Math.PI / 2, w: 0.2, thick: 0.2, len: 0.4, tip: 0.1, seed: (k * 0.37) % 1, tint: 5, glow: 1 }));

  const plane = {
    ...stagePlane({ id: 'geode.duel', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: HALF, ground: null, ledges, spawns: [[-1.2, 0], [1.2, 0]], lens: 40, pitch: 0.06, yaw: 0.04, height: 8.6 }),
    walls: mergeWalls(walls, HALF),
  };
  // (a beam's solid with its y axis up, as the movement reads a box's top; the rest as the shelves' own)
  const pieces = [...solidsOfShelves(blades.filter((b) => !beamSolids.has(b)), points), ...beamSolids.values()];
  const arena: Arena = {
    world: 'geode',
    space: { center: [0, 0, -1.2], radius: 10.5, yKill: -2.0, yTop: 9.6 },
    spawns: [[-1.2, 0, 0.6], [3.0, 0, 2.4], [6.6, 2.4, -3.0], [-7.0, 3.6, 0], [-3.4, 3.6, -6.9], [0, 3.1, -1.6]],
    pieces, plane, drops,
    camera: { minDist: 6, maxDist: 10.5, lens: 40, low: -0.6 },
    // no rim light (phase 6, report 20): a gold line round every block and drop was a game's debug over the greenhouse;
    // the drops read by their brass-and-moss lips, the selenite's tops by their own sheen
    rim: [0, 0, 0],
    // the hazard: the crystals' hum, each phrase at the open spot nearest the pair as its warning begins (hazards.ts
    // chooseHum: phase 4; it took four spots in turn before, two of them behind the stage where the pair seldom is)
    hazard: humHazard({ spots: HUM_SPOTS, r: 1.25, h: 4.2 }),
    // the world's energy (DuelTune): the hum lifting the pair together four times as often as before (14 rides a set
    // against 3), more of the catches from the air (53 % against 40) and the peak up (0.91 against 0.86) made the geode
    // the easiest world to fuse in Node (28 of 120 sets); its gains a little smaller and its ebbs a little faster keep it
    // about 1 in 8 in the page (3 of 28; Node 22 of 120), as elsewhere. (×0.96 and ×1.05 was 15 of 120 in Node but 1 of
    // 28 in the page: report 16)
    // (phase 5, report 18-flow: the flowing movement carries the two further apart, and 0.98 and 1.025 fused 1 set of 40
    // in Node, 9 before: now 1.05 and 0.93)
    energy: { gain: 1.05, ebb: 0.93 },
    // the ways out (phase 5: report 18-flow): the hub's three gates (r: inside each one's crown of crystals), each with a
    // clear lane to it from the middle (the front beam moved off the redwoods gate's path)
    exits: Object.entries(HUB_GATES).map(([id, [x, z]]) => { const dx = x, dz = z, l = Math.hypot(dx, dz); return { id, at: [x, 0, z] as V3, dir: [dx / l, dz / l] as [number, number], r: 1.2 }; }),
  };
  // (the gates stand clear: none within 2 m of the plane between the ends, nor of a piece)
  for (const [w, [x, z]] of Object.entries(HUB_GATES)) {
    if (Math.abs(z) < 2 && Math.abs(x) < HALF) throw new Error(`geode arena: the ${w} gate stands on its plane`);
    for (const [bx, bz] of beams3) if (Math.hypot(bx - x, bz - z) < 2.2) throw new Error(`geode arena: a beam stands in the ${w} gate`);
  }
  return { arena, blades: packBlades(blades), bladeCount: blades.length, points: packBlades(points), pointCount: points.length, decor };
}

let made: GeodeDuel | null = null;
/** the geode's duel arena and the crystal it adds (built once) */
export function geodeDuel(): GeodeDuel { return (made ??= build()); }

export function registerGeodeArena() { arenas.register(geodeDuel().arena); }

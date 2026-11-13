// Where everything in the Tide Temple stands, from one description: the stage's ledges first (two broken pillars, the
// altar, a lintel on two columns standing just behind the stage), then the stones that make them, so a ledge the eye
// can see is exactly where the feet land; then the court round it: the drowned platform, the steps down to the sea in
// front, broken colonnades down both sides, a great gate behind the stage framing the moon, low ruined walls, fallen
// drums. Laid out once from a seed. Every stone is a block or a drum (a column's section), drawn by stones.wgsl.
import { mulberry32 } from 'math/random';
import type { Ledge } from '../stage';

type V3 = [number, number, number];

/** a stone: a block (size: width along its yaw's x, height, depth) or a drum (size: radius, height; lying when tilt is
 *  set, its axis along its yaw's z), standing on `at` (the middle of its foot). broken: how ragged its top is (m);
 *  carve: 0 plain, 1 a meander band, 2 panels of glyphs, 3 fluted; open: no top face (the platform, whose top is the
 *  floor the backdrop draws) */
export interface Stone { kind: 'block' | 'drum'; at: V3; size: V3; yaw: number; tilt: number; broken: number; carve: number; open?: boolean; seed: number }

/** the floats a stone is to stones.wgsl (struct Stone): at.xyz yaw; size.xyz kind; seed broken carve tilt (+ open) */
export const STONE_FLOATS = 12;

/** the stage plane's place: z = STAGE_Z, behind the middle of the court (where the dancers dance when nobody plays,
 *  clear of the altar), seen from the front (+z) */
export const STAGE_Z = -3.2;

/** the court's floor (the backdrop's flagstones): x from -X to X, z from Z0 to Z1, its top at 0 */
export const COURT = { X: 12.5, Z0: -10.8, Z1: 11.6, sea: -2.6 };

export interface TempleLayout {
  ledges: Ledge[];
  stones: Stone[];
  /** the drums standing up (that throw the moon's shadow): x, z, radius, top */
  pillars: [number, number, number, number][];
  /** the solid things' tops, for groundAt: x0, x1, z0, z1 (world, axis-aligned), top */
  tops: [number, number, number, number, number][];
}

export function layoutTemple(o: { coarse: boolean; seed?: number }): TempleLayout {
  const rng = mulberry32.create(o.seed ?? 11);
  const r = () => mulberry32.sample(rng);
  const stones: Stone[] = [];
  const pillars: [number, number, number, number][] = [];
  const tops: [number, number, number, number, number][] = [];
  const block = (at: V3, size: V3, more: Partial<Stone> = {}) => { stones.push({ kind: 'block', at, size, yaw: 0, tilt: 0, broken: 0, carve: 0, seed: r(), ...more }); };
  const drum = (at: V3, rad: number, h: number, more: Partial<Stone> = {}) => {
    stones.push({ kind: 'drum', at, size: [rad, h, rad], yaw: r() * 6.283, tilt: 0, broken: 0, carve: 3, seed: r(), ...more });
    if (!more.tilt) pillars.push([at[0], at[2], rad, at[1] + h]);
  };

  // ---------------------------------------------------------------- the stage (the plane z = STAGE_Z, seen from +z)
  const SZ = STAGE_Z;
  const stumpR = 0.5, stumpH = 1.9;
  const stumpL = -4.2, stumpRx = 4.3;
  const altarW = 2.4, altarTop = 1.1;
  const lintel = { x0: 0.35, x1: 3.85, top: 3.1, thick: 0.5, z0: SZ - 1.55, z1: SZ + 0.35 };
  const ledges: Ledge[] = [
    { id: 'pillarL', x0: stumpL - stumpR, x1: stumpL + stumpR, y: stumpH, solid: true, thick: stumpH },
    { id: 'altar', x0: -altarW / 2, x1: altarW / 2, y: altarTop, solid: true, thick: altarTop },
    { id: 'pillarR', x0: stumpRx - stumpR, x1: stumpRx + stumpR, y: stumpH, solid: true, thick: stumpH },
    { id: 'lintel', x0: lintel.x0, x1: lintel.x1, y: lintel.top, thick: lintel.thick },
  ];
  // the two broken pillars: fluted drums snapped off a little ragged at the rim (their tops are flat where you stand)
  drum([stumpL, 0, SZ], stumpR, stumpH, { broken: 0.05, yaw: 0.4 });
  drum([stumpRx, 0, SZ], stumpR, stumpH, { broken: 0.05, yaw: 2.1 });
  tops.push([stumpL - stumpR, stumpL + stumpR, SZ - stumpR, SZ + stumpR, stumpH], [stumpRx - stumpR, stumpRx + stumpR, SZ - stumpR, SZ + stumpR, stumpH]);
  // the altar: a carved block under an overhanging slab
  block([0, 0, SZ], [altarW - 0.3, altarTop - 0.16, 1.1], { carve: 2 });
  block([0, altarTop - 0.16, SZ], [altarW, 0.16, 1.32], { carve: 1 });
  tops.push([-altarW / 2, altarW / 2, SZ - 0.66, SZ + 0.66, altarTop]);
  // the lintel on two columns just behind the stage (their fronts clear of it), its front edge over the stage
  const lz = (lintel.z0 + lintel.z1) / 2, colZ = lintel.z0 + 0.6;
  for (const x of [lintel.x0 + 0.55, lintel.x1 - 0.55]) {
    block([x, 0, colZ], [0.95, 0.2, 0.95]);
    drum([x, 0.2, colZ], 0.38, lintel.top - lintel.thick - 0.45, { carve: 3 });
    block([x, lintel.top - lintel.thick - 0.25, colZ], [0.95, 0.25, 0.95], { carve: 1 });
  }
  block([(lintel.x0 + lintel.x1) / 2, lintel.top - lintel.thick, lz], [lintel.x1 - lintel.x0, lintel.thick, lintel.z1 - lintel.z0], { carve: 1 });

  // ---------------------------------------------------------------- the court
  // the platform under the floor (its sides go down into the sea; its top is the backdrop's floor)
  block([0, COURT.sea, (COURT.Z0 + COURT.Z1) / 2], [COURT.X * 2, -COURT.sea, COURT.Z1 - COURT.Z0], { open: true });
  // steps down into the sea in front, towards the audience
  for (let k = 0; k < 4; k++) {
    const d = 0.62;
    block([0, COURT.sea, COURT.Z1 + d * (k + 0.5)], [COURT.X * 2 - k * 1.2, -COURT.sea - 0.42 * (k + 1), d], { seed: r() });
  }
  // the great gate behind the stage: two tall columns and a lintel, the moon rising in it
  const gz = -9.4;
  for (const x of [-2.7, 2.7]) {
    block([x, 0, gz], [1.6, 0.35, 1.6]);
    drum([x, 0.35, gz], 0.62, 5.4, { carve: 3 });
    block([x, 5.75, gz], [1.6, 0.4, 1.6], { carve: 1 });
  }
  block([0.25, 6.15, gz], [7.9, 0.95, 1.5], { carve: 2, broken: 0.25, yaw: 0.02 });
  // colonnades down both sides: some standing whole, some snapped, one fallen in drums across the floor
  const sides = o.coarse ? [-6.8, -0.4, 6.0] : [-7.2, -3.6, 0, 3.6, 7.2];
  for (const sx of [-11.2, 11.2]) {
    for (const z of sides) {
      const state = r();
      const zz = z + (r() - 0.5) * 0.4;
      block([sx, 0, zz], [1.25, 0.22, 1.25], { yaw: (r() - 0.5) * 0.1 });
      if (state < 0.35) {
        drum([sx, 0.22, zz], 0.48, 4.3, { carve: 3 });
        block([sx, 4.52, zz], [1.25, 0.32, 1.25], { carve: 1, broken: r() < 0.5 ? 0.15 : 0 });
      } else if (state < 0.85) {
        drum([sx, 0.22, zz], 0.48, 0.9 + 3.0 * r(), { broken: 0.25 + 0.35 * r() });
      } else {
        // fallen: its drums lie across the floor towards the middle
        const a = Math.atan2(-zz * 0.3, -sx) + (r() - 0.5) * 0.6;
        for (let k = 0; k < 3; k++) {
          const s = 1.0 + k * 1.05 + r() * 0.2;
          drum([sx + Math.cos(a) * s, 0, zz + Math.sin(a) * s], 0.48, 0.96, { tilt: 1, yaw: -a + Math.PI / 2 + (r() - 0.5) * 0.3 });
        }
      }
    }
  }
  // the back row either side of the gate
  for (const x of o.coarse ? [-8.0, 8.0] : [-9.6, -6.4, 6.4, 9.6]) {
    block([x, 0, -8.4], [1.25, 0.22, 1.25]);
    drum([x, 0.22, -8.4], 0.48, 1.2 + 2.8 * r(), { broken: 0.2 + 0.3 * r() });
  }
  // low ruined walls in the back corners: courses of ashlar, the top ones fallen away
  if (!o.coarse) {
    for (const side of [-1, 1]) {
      let y = 0;
      for (let course = 0; course < 3; course++) {
        let x = side * 6.9;
        const h = 0.48 + r() * 0.08;
        while (Math.abs(x) < 12.2) {
          const w = 0.9 + r() * 0.8;
          if (course === 0 || r() < 0.75 - course * 0.2) block([x + side * w / 2, y, -10.1 + (r() - 0.5) * 0.06], [w - 0.03, h, 0.8], { yaw: (r() - 0.5) * 0.04, broken: course === 2 ? 0.08 : 0, carve: course === 1 && r() < 0.3 ? 2 : 0 });
          x += side * w;
        }
        y += h;
      }
    }
    // a few drums lying loose on the floor
    for (const [x, z, a] of [[-7.6, 3.2, 0.4], [7.9, -4.6, 2.1], [-2.6, -5.8, 1.2], [8.6, 6.2, -0.7]] as const) {
      drum([x, 0, z], 0.46, 0.92, { tilt: 1, yaw: a });
    }
  }
  return { ledges, stones, pillars, tops };
}

/** the stones as stones.wgsl reads them (blocks first, then drums; `blocks` says where the drums begin) */
export function packStones(stones: Stone[]) {
  const blocks = stones.filter((s) => s.kind === 'block'), drums = stones.filter((s) => s.kind === 'drum');
  const out = new Float32Array((blocks.length + drums.length) * STONE_FLOATS);
  [...blocks, ...drums].forEach((s, i) => out.set([...s.at, s.yaw, ...s.size, s.kind === 'drum' ? 1 : 0, s.seed, s.broken, s.carve + (s.open ? 8 : 0), s.tilt], i * STONE_FLOATS));
  return { data: out, blocks: blocks.length, drums: drums.length };
}

// What hangs in the Tide Temple's air (the solarpunk pass, report 16): banners of dyed cloth from the great gate's lintel
// and the colonnades' capitals, strands of flowering vine from the lintels' edges, and wind chimes of bronze gone green;
// all of it moving in the sea air (garden.wgsl draws them; fountains.wgsl the fountains' jets). Hung from the stones
// as they stand (layout.ts and the duel's arena.ts describe the same stones), never in the way: nothing here is solid,
// the banners hang behind the stage or at the court's sides, the strands over the pair's lintels are short (a body
// passes under them), and the arena's shapes and collision are the stones', untouched.
import { mulberry32 } from 'math/random';
import type { Stone } from './layout';
import { STAGE_Z } from './layout';

type V3 = [number, number, number];

/** the floats a hanging is to garden.wgsl (struct Hang): at.xyz kind; n.xz (the face it hangs from, outward), len,
 *  width; seed, colour, -, - */
export const HANG_FLOATS = 12;
export const HANG = { banner: 0, vine: 1, chime: 2, leafy: 3, screen: 5 } as const;

/** the hangings, packed for garden.wgsl, and how many there are (`court`: the court's own; `duel`: the duel arena's,
 *  drawn only while it is shown, after them; then the vines round the columns, the court's and the duel's, vs_vine) */
export function layoutGarden(court: readonly Stone[], coarse: boolean, duelStones: readonly Stone[] = []) {
  const rng = mulberry32.create(23);
  const r = () => mulberry32.sample(rng);
  const out: number[] = [];
  const hang = (at: V3, n: [number, number], kind: number, len: number, width: number, colour = 0) => {
    out.push(at[0], at[1], at[2], kind, n[0], n[1], len, width, r(), colour, 0, 0);
  };
  /** a face's bottom edge: from its block's middle, along its own x, at its foot, `out` m in front of the face */
  const edge = (s: Stone, face: 1 | -1, along: number, outward = 0.02): { at: V3; n: [number, number] } => {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = along, lz = face * (s.size[2] / 2 + outward);
    return { at: [s.at[0] + lx * c + lz * sn, s.at[1], s.at[2] - lx * sn + lz * c], n: [face * sn, face * c] };
  };
  /** flowering strands along a face's bottom edge, `every` m apart, `lo` to `hi` m long, some missing */
  const strands = (s: Stone, face: 1 | -1, lo: number, hi: number, every: number, skip = 0.25, x0 = -s.size[0] / 2, x1 = s.size[0] / 2) => {
    for (let x = x0 + every / 2; x < x1; x += every * (0.8 + 0.4 * r())) {
      if (r() < skip) continue;
      const e = edge(s, face, x);
      hang(e.at, e.n, HANG.vine, lo + (hi - lo) * r() * r(), 0.16 + 0.06 * r());
    }
  };
  const chime = (at: V3, n: [number, number]) => {
    // five tubes, a little apart along the face, of falling lengths
    for (let k = 0; k < 5; k++) hang([at[0] + n[1] * (k - 2) * 0.07, at[1], at[2] - n[0] * (k - 2) * 0.07], n, HANG.chime, 0.55 - k * 0.06, 0.028);
  };

  // the court's own: the great gate's lintel (carved panel, high), the colonnades' capitals
  for (const s of court) {
    if (s.kind !== 'block' || s.far) continue;
    const gateLintel = s.carve === 2 && s.at[1] > 6;
    const capital = s.carve === 1 && Math.abs(s.at[1] - 4.52) < 0.01;
    if (gateLintel) {
      // banners in the gate's opening, between its columns (its inner faces at ±2.1), cloth of the palette
      // (report 18: two, framing the stained-glass screen in the gate)
      const xs = [-1.55, 1.55];
      xs.forEach((x, i) => { const e = edge(s, 1, x - 0.25, 0.05); hang(e.at, e.n, HANG.banner, 3.3 + 0.3 * r(), 0.62, i % 5); });
      strands(s, 1, 0.4, 1.5, 0.3, 0.2);
      strands(s, -1, 0.3, 1.0, 0.45, 0.4);
      for (const x of [-3.4, 3.8]) { const e = edge(s, 1, x, 0.06); chime(e.at, e.n); }
    } else if (capital) {
      // a banner down the court side of each whole column of the colonnades, a chime at its corner
      const face = (s.at[0] > 0 ? -1 : 1) as 1 | -1;
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      // (the court side is along the block's x: hang from that face, turned)
      const n: [number, number] = [face * c, -face * sn];
      const at: V3 = [s.at[0] + n[0] * (s.size[0] / 2 + 0.04), s.at[1], s.at[2] + n[1] * (s.size[0] / 2 + 0.04)];
      hang(at, n, HANG.banner, 2.6 + 0.4 * r(), 0.55, Math.floor(r() * 5));
      chime([at[0], at[1], at[2] + 0.5], n);
      strands({ ...s, yaw: Math.atan2(n[0], n[1]) }, 1, 0.2, 0.8, 0.3, 0.3);
    }
  }
  const court0 = out.length / HANG_FLOATS;

  // the duel arena's lintels (arena.ts, the same numbers): short strands from their front and back edges, a chime at
  // each end of the high lintel's back
  const SZ = STAGE_Z;
  const block = (x0: number, x1: number, y: number, z0: number, z1: number): Stone =>
    ({ kind: 'block', at: [(x0 + x1) / 2, y, (z0 + z1) / 2], size: [x1 - x0, 0.5, z1 - z0], yaw: 0, tilt: 0, broken: 0, carve: 1, seed: 0 });
  for (const L of [block(0.35, 3.85, 2.6, SZ - 1.55, SZ + 0.35), block(-3.85, -0.35, 2.6, SZ - 1.55, SZ + 0.35)]) {
    strands(L, 1, 0.12, 0.42, 0.24, 0.2);
    strands(L, -1, 0.15, 0.5, 0.3, 0.3);
  }
  const high = block(-2, 2, 5.35, SZ - 2.55, SZ + 0.3);
  strands(high, 1, 0.15, 0.55, 0.26, 0.2);
  strands(high, -1, 0.3, 1.1, 0.3, 0.2);
  for (const x of [-1.7, 1.7]) { const e = edge(high, -1, x, 0.04); chime(e.at, e.n); }
  // the tall columns' architraves over the drops: a few short strands on their fronts
  for (const side of [-1, 1]) strands(block(side < 0 ? -9 : 6.2, side < 0 ? -6.2 : 9, 4.6, SZ - 0.525, SZ + 0.525), 1, 0.1, 0.35, 0.3, 0.3);
  const duel0 = out.length / HANG_FLOATS;

  // the vines round the columns (report 18): leaves and flowers on the two stems stones.wgsl winds up a fluted shaft
  // (its `has`, `reach` and `wind` from the stone's seed, the same numbers), above the spring tide's reach
  const vines = (stones: readonly Stone[]) => {
    for (const s of stones) {
      if (s.kind !== 'drum' || s.far || s.tilt || s.carve !== 3 || s.size[1] < 1.0) continue;
      const fr = (x: number) => x - Math.floor(x);
      if (fr(s.seed * 3.17) > 0.7) continue;
      const reach = 2.2 + 4.0 * fr(s.seed * 7.31);
      const y0 = Math.max(s.at[1], VINE_FLOOR), y1 = Math.min(s.at[1] + s.size[1] - 0.05, reach);
      if (y1 - y0 < 0.4) continue;
      for (const m of [0, 1]) {
        out.push(s.at[0], 0, s.at[2], HANG.leafy, s.size[0], y0, y1, Math.PI * (0.5 + m - 5 * s.seed) - s.yaw, s.seed + m * 0.5, -0.21 * Math.PI, 0, 0);
      }
    }
  };
  vines(court);
  const vines0 = out.length / HANG_FLOATS;
  vines(duelStones);
  const screens0 = out.length / HANG_FLOATS;

  // the stained-glass screens at the court's edge (report 18: the temple's landmark, the canopy's glass brought down to
  // the height of the bodies, so the duel's low camera always has some in its frame): one filling the great gate behind
  // the stage, one between each pair of the colonnades' columns down both sides, and a row behind the low walls either
  // side of the gate; facing the court. Not solid, and outside where the bodies dance (the colonnades and the walls
  // stand between)
  const screen = (x: number, z: number, nx: number, nz: number, h: number, w: number) => out.push(x, 0, z, HANG.screen, nx, nz, h, w, r(), 0, 0, 0);
  for (const s of court) {
    if (s.kind !== 'block' || s.far || !(s.carve === 2 && s.at[1] > 6)) continue;
    // (the gate's lintel: the screen under it between the columns' inner faces, a hand behind the banners)
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), n: [number, number] = [sn, c];
    screen(s.at[0] - 0.25 * c - n[0] * 0.05, s.at[2] + 0.25 * sn - n[1] * 0.05, n[0], n[1], s.at[1] - 0.05, 4.1);
  }
  const sideZ = coarse ? [-3.6, 2.7] : [-5.4, -1.8, 1.8, 5.4];
  for (const sx of [-11.3, 11.3]) for (const z of sideZ) screen(sx, z, -Math.sign(sx), 0, 3.6, 2.5);
  for (const x of coarse ? [-8.2, 8.2] : [-11.0, -8.0, 8.0, 11.0]) screen(x, -10.75, 0, 1, 4.0, 2.4);
  return {
    data: new Float32Array(out), court: court0, duel: duel0 - court0,
    courtVines: vines0 - duel0, duelVines: screens0 - vines0, screens: out.length / HANG_FLOATS - screens0,
  };
}

/** no leaves under this (m): the duel's spring tide reaches 1.45 m, and salt kills them (stones.wgsl the same) */
const VINE_FLOOR = 1.6;

// What the redwoods' people have hung in the clearing (the solarpunk pass, report 16): strings of cloth pennants slung
// from ring tree to ring tree high over the meadow, pennants along the duel's boughs, and wind chimes of bronze gone
// green at the boughs' tips; all of it moving in the air and swinging out with a gust (garden.wgsl). Nothing here is
// solid: the arena's wood and its collision are untouched, the strings run high (7 to 8 m, over the play) and the
// boughs' pennants are a hand long.
import { mulberry32 } from 'math/random';

type V3 = [number, number, number];

/** the floats a hanging is to garden.wgsl (struct Hang): at.xyz kind; n.xz (its face, outward), len, width; seed,
 *  colour, -, -; b.xyz (a string's far end) sag */
export const HANG_FLOATS = 16;
export const HANG = { pennant: 0, chime: 2, string: 3 } as const;

/** the hangings: the clearing's own (the strings between the ring's trees), then the duel's (on its boughs) */
export function layoutGarden(ringTrunks: Float32Array, rings: number, runs: { a: V3; b: V3; r: number; tip: V3 }[], coarse: boolean) {
  const rng = mulberry32.create(41);
  const r = () => mulberry32.sample(rng);
  const out: number[] = [];
  const hang = (at: V3, n: [number, number], kind: number, len: number, width: number, colour = 0, b: V3 = [0, 0, 0], sag = 0) =>
    out.push(at[0], at[1], at[2], kind, n[0], n[1], len, width, r(), colour, 0, 0, b[0], b[1], b[2], sag);
  /** pennants along a line from a to b (sagging `sag` m in the middle), every `every` m */
  const bunting = (a: V3, b: V3, sag: number, every: number, len: number, string: boolean) => {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), d = [(b[0] - a[0]) / L, (b[2] - a[2]) / L];
    const n: [number, number] = [-d[1], d[0]];
    if (string) hang(a, n, HANG.string, L, 0.012, 0, b, sag);
    let c = Math.floor(r() * 5);
    for (let s = every / 2; s < L - every / 3; s += every) {
      const t = s / L;
      hang([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t), a[2] + (b[2] - a[2]) * t], n, HANG.pennant, len * (0.9 + 0.2 * r()), len * 0.8, c++ % 5);
    }
  };
  const chime = (at: V3) => {
    const n: [number, number] = [1, 0];
    for (let k = 0; k < 5; k++) hang([at[0] + Math.cos(k * 1.257) * 0.07, at[1], at[2] + Math.sin(k * 1.257) * 0.07], n, HANG.chime, 0.5 - k * 0.05, 0.026);
  };

  // strings between neighbouring trees of the ring, high over the meadow, tied a little into each trunk's side
  const ring = Array.from({ length: rings }, (_, k) => ({ x: ringTrunks[k * 4], z: ringTrunks[k * 4 + 1], R: ringTrunks[k * 4 + 2] }))
    .sort((p, q) => Math.atan2(p.z, p.x) - Math.atan2(q.z, q.x));
  ring.forEach((t, k) => {
    if (coarse && k % 2) return;
    const u = ring[(k + 1) % ring.length], y = 7.2 + 0.9 * r(), y2 = 7.2 + 0.9 * r();
    const dx = u.x - t.x, dz = u.z - t.z, L = Math.hypot(dx, dz);
    // (from each trunk's surface at that height: about 0.6 of its radius above the flare)
    const a: V3 = [t.x + (dx / L) * t.R * 0.62, y, t.z + (dz / L) * t.R * 0.62], b: V3 = [u.x - (dx / L) * u.R * 0.62, y2, u.z - (dz / L) * u.R * 0.62];
    bunting(a, b, 0.5 + 0.3 * r(), 0.5, 0.42, true);
  });
  const clearing = out.length / HANG_FLOATS;

  // the duel's boughs: small pennants tied along the underside of each level run, a chime at its tip
  for (const run of runs) {
    const under = (p: V3): V3 => [p[0], p[1] - 2 * run.r - 0.01, p[2]];
    bunting(under(run.a), under(run.b), 0, 0.42, 0.24, false);
    chime(run.tip);
  }
  return { data: new Float32Array(out), clearing, duel: out.length / HANG_FLOATS - clearing };
}

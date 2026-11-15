// The redwoods' arbour (phase 5, report 18), laid out for arbour.wgsl: the clearing's landmark at the bodies' height,
// all the way round so the duel's eye has it behind the pair wherever it stands. An arch of honey wood from each tree
// of the fairy ring to the next (its feet bound to the trunks 1.1 m up, its crown about 3.7 m), seed-pod lanterns of
// solar glass hanging from it, and fungi round the trees' feet and the duel's stumps that glow after dusk. Nothing here
// is solid: the arena's wood and its collision are untouched. The ring stands outside the duel's space (its trees are
// the arena's walls), so no body dances through an arch.
import { mulberry32 } from 'math/random';

type V3 = [number, number, number];

/** an arch to arbour.wgsl (struct Arch): a.xyz radius; b.xyz rise; seed, -, -, - */
export const ARCH_FLOATS = 12;
/** a pod or a fungus (struct Pod): at.xyz cord (a fungus: its height); radius, seed, glass, fungus */
export const POD_FLOATS = 8;

/** `pods`: the pods, then the fungi round the ring's feet (`always` of them, drawn always), then the duel's stumps'
 *  (`duel`, drawn while its arena is shown) */
export interface Arbour { arches: Float32Array; archCount: number; pods: Float32Array; podCount: number; always: number; duel: number }

/** the ring's trees (x, z, radius above the flare: the woods' layout, its first `rings`), the duel's stumps, and where
 *  the floor is open (not a drop, not under the fallen log) */
export function layoutArbour(trunks: Float32Array, rings: number, stumps: { at: V3; r: number }[], open: (x: number, z: number) => boolean, coarse: boolean): Arbour {
  const rng = mulberry32.create(23);
  const r = () => mulberry32.sample(rng);
  const arches: number[] = [], pods: number[] = [], fungi: number[] = [];
  const ring = Array.from({ length: rings }, (_, k) => ({ x: trunks[k * 4], z: trunks[k * 4 + 1], R: trunks[k * 4 + 2] }))
    .sort((p, q) => Math.atan2(p.z, p.x) - Math.atan2(q.z, q.x));
  const FOOT = 1.1, CROWN = 3.7;
  ring.forEach((t, k) => {
    const u = ring[(k + 1) % ring.length];
    const dx = u.x - t.x, dz = u.z - t.z, L = Math.hypot(dx, dz);
    if (L > 12) return;
    // (from each trunk's surface at the arch's foot: the flare there is about 1.45 × the radius above it)
    const a: V3 = [t.x + (dx / L) * t.R * 1.35, FOOT, t.z + (dz / L) * t.R * 1.35];
    const b: V3 = [u.x - (dx / L) * u.R * 1.35, FOOT, u.z - (dz / L) * u.R * 1.35];
    arches.push(...a, 0.1, ...b, CROWN - FOOT, r(), 0, 0, 0);
    // pods along it, hanging on cords of different lengths
    const n = coarse ? 2 : 3;
    for (let j = 0; j < n; j++) {
      const s = (j + 0.5 + (r() - 0.5) * 0.4) / n;
      const rise = Math.pow(Math.sin(Math.PI * s), 0.75) * (CROWN - FOOT);
      const at: V3 = [a[0] + (b[0] - a[0]) * s, FOOT + rise - 0.08, a[2] + (b[2] - a[2]) * s];
      pods.push(...at, 0.35 + 0.6 * r(), 0.13 + 0.05 * r(), r(), Math.floor(r() * 3), 0);
    }
  });
  const podCount = pods.length / POD_FLOATS;
  // fungi: clusters round the ring's feet (on the clearing's side) and the duel's stumps
  const cluster = (x: number, z: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = 0.25 * Math.sqrt(r());
      const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
      if (!open(fx, fz)) continue;
      const cap = 0.035 + 0.06 * r() * r();
      fungi.push(fx, 0, fz, cap * (1.6 + 1.6 * r()), cap, r(), 0, 1);
    }
  };
  for (const t of ring) {
    const toMid = Math.atan2(-t.z, -t.x);
    for (let k = 0; k < (coarse ? 2 : 4); k++) {
      const a = toMid + (r() - 0.5) * 2.4, d = t.R * (1.9 + 0.5 * r());
      cluster(t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, coarse ? 3 : 5);
    }
  }
  const ringFungi = fungi.length / POD_FLOATS;
  for (const s of stumps) for (let k = 0; k < 2; k++) {
    const a = r() * Math.PI * 2, d = s.r * 1.35 + 0.1;
    cluster(s.at[0] + Math.cos(a) * d, s.at[2] + Math.sin(a) * d, coarse ? 3 : 4);
  }
  const all = new Float32Array([...pods, ...fungi]);
  return { arches: new Float32Array(arches), archCount: arches.length / ARCH_FLOATS, pods: all, podCount, always: podCount + ringFungi, duel: fungi.length / POD_FLOATS - ringFungi };
}

// The jogo's own light in the world (glow.wgsl): a list of glowing points, segments, rings and gems built on the CPU
// every frame by whoever wants one (the meters, the feel of an exchange, the fusion, the results) and drawn once, in
// the main view's scene after everything else that glows, additive, before bloom. A glow lives one frame: ask again
// next frame. Like the plasma arcs, it is drawn in the main view only (it belongs to the jogo, which is one world's).
//
// The drawing half (glow-draw.ts) needs the kit; the list here is plain arrays, so anything that only builds glows can
// be run and checked without a GPU.
import { LIMITS } from '../engine/limits';

type V3 = readonly [number, number, number] | Float32Array | number[];
export type RGB = readonly [number, number, number];

export const SHAPE = { soft: 0, ring: 1, gem: 2, spark: 3 } as const;
export type Shape = keyof typeof SHAPE;

/** floats per glow (glow.wgsl's Glow: three vec4s) */
export const GLOW_FLOATS = 12;
const FLOATS = GLOW_FLOATS;
const MAX = LIMITS.glows;

/** this frame's glows */
export class Glows {
  readonly data = new Float32Array(MAX * FLOATS);
  count = 0;
  /** how bright everything is this frame (the meters dim in the free view) */
  gain = 1;
  /** how bright the rings lying on the floor are (the exchanges' and the unisons' rings, the count-in's pulses, the
   *  meters' rings at the feet): jogoParams.rings, 0 for a film that wants none */
  rings = 1;

  private put(a: V3, b: V3, r: number, col: RGB, I: number, kind: number) {
    if (this.count >= MAX || !(r > 0) || !(I > 0)) return;
    const D = this.data, o = this.count++ * FLOATS;
    D[o] = a[0]; D[o + 1] = a[1]; D[o + 2] = a[2]; D[o + 3] = r;
    D[o + 4] = b[0]; D[o + 5] = b[1]; D[o + 6] = b[2]; D[o + 7] = I;
    D[o + 8] = col[0]; D[o + 9] = col[1]; D[o + 10] = col[2]; D[o + 11] = kind;
  }
  /** a glow at p (radius r, m) facing the camera */
  dot(p: V3, r: number, col: RGB, I = 1, shape: Shape = 'soft') { this.put(p, p, r, col, I, SHAPE[shape]); }
  /** a capsule of light from a to b */
  seg(a: V3, b: V3, r: number, col: RGB, I = 1, shape: Shape = 'soft') { this.put(a, b, r, col, I, SHAPE[shape]); }
  /** a disc or ring lying on the floor round p */
  flat(p: V3, r: number, col: RGB, I = 1, shape: Shape = 'ring') { this.put(p, p, r, col, shape === 'ring' ? I * this.rings : I, SHAPE[shape] + 4); }
  /** a petal (or with `leaf` a pointed leaf) from its base a to its tip b, r its half width at its widest (m), turned
   *  to the camera, or with `lying` lying across the floor (glow.wgsl kinds 8, 9, 12, 13: the finale's bloom); `soft`: its gold
   *  midrib, rim and heart faint (kind 10, 14) */
  petal(a: V3, b: V3, r: number, col: RGB, I = 1, leaf = false, lying = false, soft = false) { this.put(a, b, r, col, I, 8 + (leaf ? 1 : 0) + (soft && !leaf ? 2 : 0) + (lying ? 4 : 0)); }
  /** a polyline of soft segments (flat xyz) */
  line(pts: ArrayLike<number>, r: number, col: RGB, I = 1) {
    for (let i = 3; i + 2 < pts.length; i += 3) this.put([pts[i - 3], pts[i - 2], pts[i - 1]], [pts[i], pts[i + 1], pts[i + 2]], r, col, I, 0);
  }
  /** an arc of a ring on the floor round c (radius R), from angle a0 to a1 (radians), as `n` beads of light */
  arc(c: V3, R: number, a0: number, a1: number, r: number, col: RGB, I = 1, n = 24) {
    const k = Math.max(2, Math.round(n * Math.abs(a1 - a0) / (2 * Math.PI)) + 1);
    let px = c[0] + Math.cos(a0) * R, pz = c[2] + Math.sin(a0) * R;
    for (let i = 1; i < k; i++) {
      const a = a0 + ((a1 - a0) * i) / (k - 1), x = c[0] + Math.cos(a) * R, z = c[2] + Math.sin(a) * R;
      this.put([px, c[1], pz], [x, c[1], z], r, col, I, 0);
      px = x; pz = z;
    }
  }
  clear() { this.count = 0; }
}

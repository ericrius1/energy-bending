// The Pool's edge (edge.wgsl draws it; report 18): the garden's built things standing round the duel's water at the
// height of the bodies, so the duel's low camera, which turns all the way round the pair, always has one of them in its
// frame: the landmark, a glass-and-brass pavilion on a ceramic plinth behind the stage with sailcloth shades on brass
// masts beside it (the sun sets behind them), and round the rest of the rim a ring of trellis arches (brass, in glazed
// tubs, a flowering vine over each) and fountains in glazed basins between them. All of it outside the arena's water
// (radius 12: the stones reach 11.6), so no body reaches it; the camera sometimes stands among it, where it fades
// (decorDrop). Laid out once, seeded.
import type { Kit } from '@ericrius1/weft';
import { mulberry32 } from 'math/random';
import edgeShader from './edge.wgsl';
import type { ScenePass } from '../../engine/scene';

type V3 = [number, number, number];

/** what it adds, packed for edge.wgsl (each list's stride in vec4s: lathes 2, tubes 2, leaves 3, sails 3, jets 1) */
interface Edge { lathes: number[]; tubes: number[]; leaves: number[]; sails: number[]; jets: number[] }

/** the ring's radius, the pavilion's place (behind the stage, a little left of the sun's bearing) */
const RING = 13.4;
const PAVILION: V3 = [-5.2, 0, -15.6];

const PROFILE = { pavilion: 0, basin: 1, tub: 2 } as const;
const MAT = { ceramic: 0, brass: 1 } as const;

function layout(coarse: boolean): Edge {
  const rng = mulberry32.create(1213);
  const r = () => mulberry32.sample(rng);
  const E: Edge = { lathes: [], tubes: [], leaves: [], sails: [], jets: [] };
  const lathe = (at: V3, scale: number, profile: number) => E.lathes.push(at[0], at[1], at[2], scale, profile, r() * 6.283, r(), 0);
  const tube = (a: V3, b: V3, radius: number, mat: number) => E.tubes.push(a[0], a[1], a[2], radius, b[0], b[1], b[2], mat);
  const leaf = (at: V3, size: number, out: V3, flower: boolean) => E.leaves.push(at[0], at[1], at[2], size, out[0], out[1], out[2], flower ? 1 : 0, r(), r(), 0, 0);
  /** a vine along a path of points: leaves every few cm either side, a flower now and then */
  const vine = (path: V3[], every: number, size: number, flowers: number) => {
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1], d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
      for (let s = r() * every; s < L; s += every * (0.7 + 0.6 * r())) {
        const f = s / L, p: V3 = [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f];
        // (out from the path, any way round it)
        const ang = r() * Math.PI * 2, u: V3 = Math.abs(d[1]) / L > 0.7 ? [Math.cos(ang), 0.2 * (r() - 0.5), Math.sin(ang)] : [Math.cos(ang) * 0.6, Math.sin(ang), (r() - 0.5) * 0.8];
        leaf(p, size * (0.75 + 0.5 * r()), u, r() < flowers);
      }
    }
  };

  // the pavilion: its body (plinth, dome, beam) turned on the lathe, eight white ceramic columns, a vine up every other
  // column and leaves hanging from the beam
  lathe(PAVILION, 1, PROFILE.pavilion);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2, x = PAVILION[0] + Math.cos(a) * 3.0, z = PAVILION[2] + Math.sin(a) * 3.0;
    tube([x, 0.36, z], [x, 3.05, z], 0.1, MAT.ceramic);
    if (k % 2 === 0) {
      const path: V3[] = [];
      for (let j = 0; j <= 12; j++) { const y = 0.4 + j * 0.22, w = j * 1.3; path.push([x + Math.cos(w) * 0.13, y, z + Math.sin(w) * 0.13]); }
      vine(path, 0.06, 0.13, 0.12);
    }
  }
  for (let k = 0; k < (coarse ? 20 : 40); k++) {
    const a = r() * Math.PI * 2, x = PAVILION[0] + Math.cos(a) * 3.38, z = PAVILION[2] + Math.sin(a) * 3.38, len = 0.3 + 0.9 * r();
    vine([[x, 3.1, z], [x + Math.cos(a) * 0.05, 3.1 - len, z + Math.sin(a) * 0.05]], 0.07, 0.11, 0.15);
  }
  // sailcloth shades beside it on brass masts, stretched toward the sun's side
  const masts: V3[] = [[-11.6, 0, -13.4], [-9.0, 0, -18.8], [0.8, 0, -18.6], [3.2, 0, -14.6]];
  const tops = masts.map((m, i): V3 => [m[0], 4.6 + 0.8 * (i % 2), m[2]]);
  masts.forEach((m, i) => { lathe([m[0], 0, m[2]], 1, PROFILE.tub); tube([m[0], 0.42, m[2]], tops[i], 0.05, MAT.brass); });
  const sail = (a: V3, b: V3, c: V3, billow: number, tint: number) => E.sails.push(a[0], a[1], a[2], billow, b[0], b[1], b[2], r(), c[0], c[1], c[2], tint);
  sail(tops[0], tops[1], [PAVILION[0] - 3.35, 3.2, PAVILION[2] + 0.3], 0.35, 1);
  sail(tops[2], tops[3], [PAVILION[0] + 3.35, 3.2, PAVILION[2] - 0.4], 0.35, 0);
  sail(tops[1], tops[2], [PAVILION[0], 6.85, PAVILION[2]], 0.3, 1);

  // round the rest of the rim: trellis arches and fountains in turn, facing the water's middle; none in the pavilion's
  // sector
  const pavA = Math.atan2(PAVILION[2], PAVILION[0]), n = coarse ? 12 : 18;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.08;
    const off = Math.abs(Math.atan2(Math.sin(a - pavA), Math.cos(a - pavA)));
    if (off < 0.42) continue;
    const cx = Math.cos(a) * RING, cz = Math.sin(a) * RING, tx = -Math.sin(a), tz = Math.cos(a);
    if (k % 3 !== 1) {
      // an arch: two posts in their tubs, the round top in eight pieces, a vine up one post, over the top, down the other
      const w = 0.85, h = 2.25, path: V3[] = [];
      const foot = (s: number): V3 => [cx + tx * w * s, 0, cz + tz * w * s];
      for (const s of [-1, 1]) { const f = foot(s); lathe(f, 1, PROFILE.tub); tube([f[0], 0.42, f[2]], [f[0], h, f[2]], 0.035, MAT.brass); }
      const arc: V3[] = [];
      for (let j = 0; j <= 8; j++) { const t = Math.PI * (1 - j / 8), s = Math.cos(t); arc.push([cx + tx * w * s, h + Math.sin(t) * w, cz + tz * w * s]); }
      for (let j = 0; j < 8; j++) tube(arc[j], arc[j + 1], 0.035, MAT.brass);
      const L = foot(-1), R = foot(1);
      path.push([L[0], 0.45, L[2]], [L[0], h, L[2]], ...arc, [R[0], h, R[2]], [R[0], 0.45 + r() * 0.8, R[2]]);
      vine(path, coarse ? 0.09 : 0.06, 0.12, 0.16);
    } else {
      // a fountain: a glazed basin, a brass spout with its cup, the jet (the glow pass)
      lathe([cx, 0, cz], 1, PROFILE.basin);
      tube([cx, 0.45, cz], [cx, 1.05, cz], 0.045, MAT.brass);
      tube([cx, 1.05, cz], [cx, 1.12, cz], 0.12, MAT.brass);
      E.jets.push(cx, 1.12, cz, 0.45 + 0.15 * r());
    }
  }
  return E;
}

export class PoolEdge {
  private bufs: Record<keyof Edge, ReturnType<Kit['storage']>>;
  private counts: Record<keyof Edge, number>;

  constructor(kit: Kit, private coarse: boolean) {
    const E = layout(coarse), stride = { lathes: 8, tubes: 8, leaves: 12, sails: 12, jets: 4 };
    const buf = (k: keyof Edge) => kit.storage({ label: `pool.edge.${k}`, data: new Float32Array(E[k].length ? E[k] : [0, 0, 0, 0]), usage: ['storage'] });
    this.bufs = { lathes: buf('lathes'), tubes: buf('tubes'), leaves: buf('leaves'), sails: buf('sails'), jets: buf('jets') };
    this.counts = { lathes: E.lathes.length / stride.lathes, tubes: E.tubes.length / stride.tubes, leaves: E.leaves.length / stride.leaves, sails: E.sails.length / stride.sails, jets: E.jets.length / stride.jets };
  }

  /** the opaque phase's four draws and the glow phase's jets, on while `on` (the duel's arena shown) */
  declare(s: ScenePass, on: () => boolean) {
    const d = (k: keyof Edge, vertex: string, count: number) =>
      s.pass.draw(edgeShader, { label: `pool.edge.${k}`, vertex, fragment: 'fs', bind: { items: this.bufs[k] }, count, instances: this.counts[k], cull: 'none', enabled: () => on() && this.counts[k] > 0 });
    if (s.phase === 'opaque') {
      d('lathes', 'vs_lathe', 28 * 15 * 6);
      d('tubes', 'vs_tube', 8 * 6);
      d('leaves', 'vs_leaf', 6);
      d('sails', 'vs_sail', 36 * 3);
    } else if (s.phase === 'glow') {
      const per = this.coarse ? 60 : 120;
      s.pass.draw(edgeShader, { label: 'pool.edge.jets', vertex: 'vs_jet', fragment: 'fs_jet', bind: { items: this.bufs.jets }, count: 6, instances: this.counts.jets * per, constants: { PER: per }, blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && this.counts.jets > 0 });
    }
  }
}

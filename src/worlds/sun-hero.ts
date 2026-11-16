// The sun worlds' hero architecture (report 24-sun-built; sun-hero.wgsl draws it): one built piece at the bodies' height
// in each arena, inside the frame the duel's camera keeps, so a still of the duel shows a place and not only pieces on a
// floor. Each world lays its own out of the same parts (`HeroParts`): lathes (plinths, a dome, bowls, urns), tubes
// (columns, rings, ribs, tendrils), leaves and flowers on vines, round windows of stained glass, and fountain jets. The
// temple's is its sun fountain (heroTemple, temple/hero.ts), the Pool's its sun window (pool/hero.ts). Decoration, not
// solid, and outside the arena's space: play and the camera's solids are as they were.
import type { Kit } from '@ericrius1/weft';
import { mulberry32 } from 'math/random';
import heroShader from './sun-hero.wgsl';
import type { ScenePass } from '../engine/scene';
import { defineParams } from '../engine/params';

/** the heroes shown (off: for measuring what they cost, `--set '{"hero":{"show":false}}'`) */
export const heroParams = defineParams('hero', { show: true }, {});

export type V3 = [number, number, number];

/** the profiles a lathe turns (sun-hero.wgsl PROFILES) */
export const PROFILE = { plinth: 0, dome: 1, basin: 2, bowl: 3, top: 4, urn: 5, foot: 6 } as const;
/** the materials of a tube */
export const MAT = { ceramic: 0, copper: 1, teal: 3, gold: 5 } as const;

/** the parts of a hero, packed for sun-hero.wgsl (each list's stride in vec4s: lathes 2, tubes 2, leaves 3, windows 2,
 *  jets 1, spills 2) */
export class HeroParts {
  lathes: number[] = []; tubes: number[] = []; leaves: number[] = []; windows: number[] = []; jets: number[] = []; spills: number[] = [];
  private rng;
  constructor(seed: number) { this.rng = mulberry32.create(seed); }
  r() { return mulberry32.sample(this.rng); }
  lathe(at: V3, scale: number, profile: number) { this.lathes.push(at[0], at[1], at[2], scale, profile, this.r() * 6.283, this.r(), 0); }
  tube(a: V3, b: V3, radius: number, mat: number) { this.tubes.push(a[0], a[1], a[2], radius, b[0], b[1], b[2], mat); }
  /** a polyline of tubes */
  path(pts: V3[], radius: number, mat: number) { for (let k = 0; k + 1 < pts.length; k++) this.tube(pts[k], pts[k + 1], radius, mat); }
  leaf(at: V3, size: number, out: V3, flower: boolean) { this.leaves.push(at[0], at[1], at[2], size, out[0], out[1], out[2], flower ? 1 : 0, this.r(), this.r(), 0, 0); }
  /** a vine along a path: leaves every few cm either side, a flower now and then */
  vine(path: V3[], every: number, size: number, flowers: number) {
    const r = () => this.r();
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1], d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
      for (let s = r() * every; s < L; s += every * (0.7 + 0.6 * r())) {
        const f = s / L, p: V3 = [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f];
        const ang = r() * Math.PI * 2, u: V3 = Math.abs(d[1]) / L > 0.7 ? [Math.cos(ang), 0.2 * (r() - 0.5), Math.sin(ang)] : [Math.cos(ang) * 0.6, Math.sin(ang), (r() - 0.5) * 0.8];
        this.leaf(p, size * (0.75 + 0.5 * r()), u, r() < flowers);
      }
    }
  }
  /** a round window of stained glass: its middle, radius, the way it faces, the share of its radius open in the middle */
  window(at: V3, radius: number, n: V3, open = 0) { this.windows.push(at[0], at[1], at[2], radius, n[0], n[1], n[2], open); }
  /** a plume with arcs off it (how high it rises) */
  jet(at: V3, rise: number) { this.jets.push(at[0], at[1], at[2], rise); }
  /** water falling all round off a rim (its middle at the rim's height, its radius, how far it falls) */
  spill(at: V3, radius: number, drop: number) { this.spills.push(at[0], at[1], at[2], radius, drop, 0, 0, 0); }
}

type List = 'lathes' | 'tubes' | 'leaves' | 'windows' | 'jets' | 'spills';
const STRIDE: Record<List, number> = { lathes: 8, tubes: 8, leaves: 12, windows: 8, jets: 4, spills: 8 };

/** a hero's draws in a world (WORLD: 2 the Pool, 3 the temple), on while `on` */
export class SunHero {
  private bufs: Record<List, ReturnType<Kit['storage']>>;
  private counts: Record<List, number>;

  constructor(kit: Kit, parts: HeroParts, private world: number, private coarse: boolean, label: string) {
    const lists: List[] = ['lathes', 'tubes', 'leaves', 'windows', 'jets', 'spills'];
    this.bufs = {} as Record<List, ReturnType<Kit['storage']>>;
    this.counts = {} as Record<List, number>;
    for (const k of lists) {
      const data = parts[k];
      this.bufs[k] = kit.storage({ label: `${label}.${k}`, data: new Float32Array(data.length ? data : [0, 0, 0, 0, 0, 0, 0, 0]), usage: ['storage'] });
      this.counts[k] = data.length / STRIDE[k];
    }
  }

  declare(s: ScenePass, shown: () => boolean) {
    const W = this.world, on = () => heroParams.show && shown();
    const d = (k: List, vertex: string, count: number) =>
      s.pass.draw(heroShader, { label: `hero.${k}`, vertex, fragment: 'fs', bind: { items: this.bufs[k] }, count, instances: this.counts[k], constants: { WORLD: W }, cull: 'none', enabled: () => on() && this.counts[k] > 0 });
    if (s.phase === 'opaque') {
      // (a handful of draws, about thirty thousand triangles in all; a phone draws the same, fewer droplets)
      d('lathes', 'vs_lathe', 40 * 15 * 6);
      d('tubes', 'vs_tube', 10 * 6);
      d('leaves', 'vs_leaf', 6);
      d('windows', 'vs_window', 6);
    } else if (s.phase === 'glow') {
      const per = this.coarse ? 70 : 150;
      const j = (k: 'jets' | 'spills', spill: number) =>
        s.pass.draw(heroShader, { label: `hero.${k}`, vertex: 'vs_jet', fragment: 'fs_jet', bind: { items: this.bufs[k] }, count: 6, instances: this.counts[k] * per, constants: { WORLD: W, PER: per, SPILL: spill }, blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && this.counts[k] > 0 });
      j('jets', 0);
      j('spills', 1);
    }
  }
}

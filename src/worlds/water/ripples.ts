// Ripples on a world's water (the pool's, the temple's tide): a damped wave height field on the GPU (ripples.wgsl) in a
// square window that follows the dancers. The dancers' feet and hands stir it by themselves (the shader reads the shared
// joints); anything else (a landing the game knows of, matter falling in) calls `ripple(x, z, strength, radius)`. The
// field is one texture the world shares in the light group, so its backdrop, its air (the reflections it bends) and the
// matter lit there can all read the surface's height and slope (water.wgsl `waveNormal`).
//
// Two steps a frame (each reads one texture and writes the other, so the texture everything samples is always the
// finished one), only while the world is on screen.
import type { Kit, Texture, UniformBuffer } from '@ericrius1/weft';
import rippleShader, { type Ripples as RipplesU } from './ripples.wgsl';
import type { FrameBuilder, FrameCtx } from '../../engine/frame';

const MAXDROPS = 16;

export interface RippleOptions {
  label: string;
  /** texels a side (a power of two keeps the dispatch tidy) and metres per texel */
  cells: number;
  cell: number;
  /** the waves' speed (m/s) and how quickly they die (per second, of their motion) */
  speed: number;
  fade: number;
  /** how hard a foot pushes the water */
  feet: number;
  /** whether the world is on screen this frame (the steps are skipped otherwise) */
  enabled: () => boolean;
}

export class Ripples {
  /** the height field everything samples: r the height (m), g a step ago */
  readonly tex: Texture;
  private tmp: Texture;
  private u: UniformBuffer<RipplesU>;
  private drops: number[] = [];
  private ox = 0;
  private oz = 0;
  private placed = false;
  private vals = { origin: [0, 0] as [number, number], shift: [0, 0] as [number, number], waterY: 0, drops: 0, drop: new Float32Array(MAXDROPS * 4) };

  constructor(kit: Kit, frame: FrameBuilder, private o: RippleOptions) {
    const t = (label: string) => kit.texture({ label, format: 'rgba16float', size: [o.cells, o.cells], usage: ['sample', 'storage', 'copy-dst'] });
    this.tex = t(`${o.label}.ripples`);
    this.tmp = t(`${o.label}.ripples.b`);
    this.u = kit.uniforms(rippleShader.structs.Ripples, `${o.label}.ripples`);
    // two steps of half a 60 fps frame each
    const dt = 1 / 120;
    const c = (o.speed * dt) / o.cell;
    this.u.set({ cell: o.cell, n: o.cells, c2: Math.min(0.45, c * c), damp: Math.exp(-o.fade * dt), feet: o.feet, edge: Math.max(4, o.cells / 16) });
    frame.add('sim', kit.compute(rippleShader, { label: `${o.label}.ripples.a`, bind: { rip: this.u, src: this.tex, dst: this.tmp }, threads: [o.cells, o.cells], constants: { FIRST: 1 }, enabled: o.enabled }), o.label);
    frame.add('sim', kit.compute(rippleShader, { label: `${o.label}.ripples.b`, bind: { rip: this.u, src: this.tmp, dst: this.tex }, threads: [o.cells, o.cells], constants: { FIRST: 0 }, enabled: o.enabled }), o.label);
  }

  /** a push on the water at (x, z): strength ~1 for a hard landing (about a centimetre of push), radius in m */
  ripple(x: number, z: number, strength: number, radius: number) {
    if (this.drops.length >= MAXDROPS * 4) this.drops.splice(0, 4);
    this.drops.push(x, z, strength * 0.012, Math.max(radius, this.o.cell * 1.5));
  }

  /** each frame the world is shown: centre the window on (cx, cz) in whole texels, the surface at waterY */
  update(_f: FrameCtx, cx: number, cz: number, waterY: number) {
    const { cell, cells } = this.o;
    const ox = Math.round(cx / cell) * cell - (cells / 2) * cell, oz = Math.round(cz / cell) * cell - (cells / 2) * cell;
    // a big jump (a new world, a cut) starts the window fresh where it is
    const sx = this.placed ? Math.round((ox - this.ox) / cell) : 0, sz = this.placed ? Math.round((oz - this.oz) / cell) : 0;
    this.ox = ox; this.oz = oz; this.placed = true;
    const v = this.vals;
    v.origin[0] = ox; v.origin[1] = oz;
    v.shift[0] = Math.max(-cells, Math.min(cells, sx)); v.shift[1] = Math.max(-cells, Math.min(cells, sz));
    v.waterY = waterY;
    v.drops = this.drops.length / 4;
    v.drop.fill(0);
    v.drop.set(this.drops);
    this.drops.length = 0;
    this.u.set(v);
  }

  /** where the field lies, for a shader: xz of its corner, its size (m), and 1 / texels */
  window(): [number, number, number, number] {
    const { cell, cells } = this.o;
    return [this.ox - cell / 2, this.oz - cell / 2, cell * cells, 1 / cells];
  }
}

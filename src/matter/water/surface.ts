// The screen-space surface of water and ice for one view. Where it sits in the frame, and why:
//
//   'cull' stage (before the scene)   water.splat.depth   the body's particles as spheres: the nearest one's view distance
//                                                         and the capsule it is on
//                                     water.splat.thick   the same spheres added up: thickness, foam, frost
//                                     water.smooth.*      the narrow-range filter, x then y, `smoothPasses` times
//   then, by the kind of view:
//   the main view (and ?pip)          'air' stage, first: water.scene.copy (the resolved scene, so the surface can bend
//                                     what is behind it while it writes over it), water.surface (one fullscreen draw per
//                                     world over the resolved `hdr`: colour only, the scene's alpha is left alone), then
//                                     water.focus (the surface's view distance for the lens: MatterPasses.focus)
//   a gate's view                     its own scene pass, glow phase: water.surface (fs_scene), blended over the scene
//                                     at the surface's own depth. A gate's scene runs in the 'gates' stage, before the
//                                     'air' stage, so a composite there would come too late; the splats in 'cull' are
//                                     early enough. No bending of what is behind (a small view: not missed)
//   a mirroring floor's copy          the same splats reflected in the floor, at a lower resolution, added onto the
//                                     floor in the view's opaque phase (fs_mirror), as the gems and the fire add theirs
//
// The splats don't need the scene, so they run before it, into targets of their own (single-sample: the surface is
// smooth by then, and its outline comes from the blurred thickness). Kinds declare before the post chain does
// (main.ts), so the composite added to 'air' here runs before the post chain's own 'air' pass, with no hook in src/post.
import type { Kit, RenderPass, StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import splatShader from './splat.wgsl';
import smoothShader from './smooth.wgsl';
import surfaceShader from './surface.wgsl';
import type { FrameBuilder } from '../../engine/frame';
import type { ViewCtx } from '../../engine/views';
import type { ScenePass } from '../../engine/scene';
import { waterParams } from './params';

/** what the surface needs of the pool */
export interface SurfacePool {
  sim: UniformBuffer<any>;
  state: StorageBuffer;
  aux: StorageBuffer;
  homes: StorageBuffer;
  surf: UniformBuffer<any>;
  /** the smoothing's two directions (a uniform holds one value per run, so one buffer each) */
  smoothX: UniformBuffer<any>;
  smoothY: UniformBuffer<any>;
  count(): number;
  /** anything on a body to draw */
  liquid(): boolean;
}

/** the most smoothing passes (each one x then y); waterParams.smoothPasses picks how many run */
export const MAX_SMOOTH = 3;

/** how a surface is shown: composited over the main view's resolved scene, drawn inside a gate view's scene pass, or
 *  added as a mirroring floor's reflection */
export type SurfaceMode = 'air' | 'scene' | 'mirror';

// premultiplied over the colour; the alpha (the scene's opaque view distance) kept as it is
const OVER_KEEP_ALPHA: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
};
const ADD_KEEP_ALPHA: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
};

export class WaterSurface {
  /** the surface's view distance where it shows, 1e5 elsewhere (r16float, the size of the surface's targets): the
   *  main view's and ?pip's only (null in a gate's view and for a mirror) */
  readonly focus: Texture | null = null;
  private composite: RenderPass | null = null;
  private worlds = new Set<string>();
  private dist: Texture;
  private smoothed: Texture;
  private copy: Texture | null = null;

  constructor(kit: Kit, frame: FrameBuilder, private view: ViewCtx, private pool: SurfacePool, private mode: SurfaceMode, private on: () => boolean, resolution = 1) {
    const scale = view.scale * waterParams.resolution * resolution;
    const id = (view.id === 'main' ? '' : `.${view.id}`) + (mode === 'mirror' ? '.mirror' : '');
    const v = view.id === 'main' ? undefined : view.view;
    const tex = (label: string, format: GPUTextureFormat, s = scale) => kit.texture({ label: `water.${label}${id}`, format, size: 'render', scale: s });
    const dist = (this.dist = tex('dist', 'rg32float'));
    const depth = tex('depth', 'depth32float');
    const thick = tex('thick', 'rgba16float');
    const A = tex('smoothA', 'rgba32float');
    const B = tex('smoothB', 'rgba32float');
    this.smoothed = B;
    // (seen: what this view sees of each dancer, engine/seen.wgsl)
    const bind = { sim: pool.sim, state: pool.state, aux: pool.aux, homes: pool.homes, seen: view.seen };
    const constants = { MIRROR: mode === 'mirror' ? 1 : 0 };

    const splatD = kit.pass({ label: `water.splat.depth${id}`, color: [{ target: dist, clear: [0, 0, 0, 0] }], depth: { target: depth, clear: 0 }, view: v, enabled: on });
    splatD.draw(splatShader, { label: `water.splat.depth${id}`, fragment: 'fs_depth', bind, constants, count: 6, instances: () => pool.count(), cull: 'none' });
    const splatT = kit.pass({ label: `water.splat.thick${id}`, color: [{ target: thick, clear: [0, 0, 0, 0] }], view: v, enabled: on });
    splatT.draw(splatShader, { label: `water.splat.thick${id}`, fragment: 'fs_thick', bind, constants, count: 6, instances: () => pool.count(), cull: 'none', blend: 'add', depthWrite: false });
    frame.add('cull', splatD, 'water');
    frame.add('cull', splatT, 'water');
    // x into A, y into B; the first reads the splats; every pass binds all three sources (smooth.wgsl says why). A
    // mirror's copy is dim and soft: one pass is enough
    const passes = mode === 'mirror' ? 1 : MAX_SMOOTH;
    for (let k = 0; k < passes; k++) {
      const passOn = () => on() && k < Math.max(1, Math.round(waterParams.smoothPasses));
      const h = kit.pass({ label: `water.smooth.x${k}${id}`, color: [{ target: A }], view: v, enabled: passOn });
      h.fullscreen(smoothShader, { label: `water.smooth.x${k}${id}`, fragment: k === 0 ? 'fs_first' : 'fs_next', bind: { sm: pool.smoothX, dist, thick, src: B } });
      const w = kit.pass({ label: `water.smooth.y${k}${id}`, color: [{ target: B }], view: v, enabled: passOn });
      w.fullscreen(smoothShader, { label: `water.smooth.y${k}${id}`, fragment: 'fs_next', bind: { sm: pool.smoothY, dist, thick, src: A } });
      frame.add('cull', h, 'water');
      frame.add('cull', w, 'water');
    }
    if (mode === 'air') {
      const copy = (this.copy = tex('behind', 'rgba16float', view.scale));
      const copyItem = Object.assign(kit.copy(view.targets.hdr, copy, `water.scene.copy${id}`), { enabled: on });
      frame.add('air', copyItem, 'water');
      this.composite = kit.pass({ label: `water.surface${id}`, color: [{ target: view.targets.hdr, clear: false }], view: v, enabled: on });
      frame.add('air', this.composite, 'water');
      // the focus: cleared to "nothing here" whenever the view is drawn, so it is never stale when there is no water
      const focus = tex('focus', 'r16float');
      const fp = kit.pass({ label: `water.focus${id}`, color: [{ target: focus, clear: [1e5, 0, 0, 0] }], view: v, enabled: view.on });
      fp.fullscreen(surfaceShader, { label: `water.focus${id}`, fragment: 'fs_focus', bind: { surf: pool.surf, scene: copy, water: B, raw: dist, seen: view.seen }, enabled: on });
      frame.add('air', fp, 'water');
      this.focus = focus;
    }
  }

  /** the draw for one world (its light), once: in the composite pass, or in the view's scene pass for its phase */
  addWorld(s: ScenePass) {
    const view = this.view, world = s.world;
    const key = `${world.id}.${s.phase}`;
    const tag = `${world.id}${view.id === 'main' ? '' : `.${view.id}`}`;
    const bind = { surf: this.pool.surf, water: this.smoothed, raw: this.dist, seen: view.seen };
    if (this.mode === 'air') {
      if (this.worlds.has(world.id)) return;
      this.worlds.add(world.id);
      this.composite!.fullscreen(surfaceShader, {
        label: `water.surface.${tag}`, constants: { WORLD: world.light },
        bind: { ...bind, scene: this.copy! }, enabled: () => view.world === world.id,
      });
      return;
    }
    const phase = this.mode === 'scene' ? 'glow' : 'opaque';
    if (s.phase !== phase || this.worlds.has(key)) return;
    this.worlds.add(key);
    s.pass.fullscreen(surfaceShader, {
      label: `water.${this.mode === 'scene' ? 'surface' : 'mirror'}.${tag}`, fragment: this.mode === 'scene' ? 'fs_scene' : 'fs_mirror',
      constants: { WORLD: world.light }, bind, blend: this.mode === 'scene' ? OVER_KEEP_ALPHA : ADD_KEEP_ALPHA,
      depthCompare: 'greater-equal', depthWrite: false, enabled: () => s.on() && this.on(),
    });
  }
}

// The screen-space water surface for one view. Where it sits in the frame, and why:
//
//   'cull' stage (before the scene)   water.splat.depth   liquid particles as spheres: the nearest one's view distance
//                                     water.splat.thick   the same spheres added up: thickness, foam, frost
//                                     water.smooth.*      bilateral blur, x then y, `smoothPasses` times
//   'scene' stage                     the view's scene pass (worlds, gems, ice shards, glow), untouched
//   'air' stage, first                water.scene.copy    the resolved scene copied (the surface reads what is behind it
//                                                         while it writes over it)
//                                     water.surface       one fullscreen draw per world over the view's resolved `hdr`:
//                                                         where the water is nearer than the scene (alpha is the scene's
//                                                         view distance) it is shaded and its distance written to alpha
//   'air' stage, then                 the post chain's air, depth of field, bloom: they see the water as scene
//
// The splats don't need the scene, so they run before it, into targets of their own (single-sample: the surface is
// smooth by then, and its outline is softened by the blurred thickness). The composite has to come after the scene's
// MSAA resolve, because it refracts what is behind the water, and before the air, so the fog, the depth of field and
// the bloom treat the water as part of the scene. Kinds declare before the post chain does (main.ts), so the
// composite added to 'air' here runs before the post chain's own 'air' pass, with no hook in src/post.
import type { Kit, RenderPass, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import splatShader from './splat.wgsl';
import smoothShader from './smooth.wgsl';
import surfaceShader from './surface.wgsl';
import type { FrameBuilder } from '../../engine/frame';
import type { ViewCtx } from '../../engine/views';
import type { World } from '../../worlds/world';
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
  /** any liquid to draw */
  liquid(): boolean;
}

/** the most smoothing passes (each one x then y); waterParams.smoothPasses picks how many run */
export const MAX_SMOOTH = 3;

export class WaterSurface {
  private composite: RenderPass;
  private worlds = new Set<string>();

  constructor(kit: Kit, frame: FrameBuilder, private view: ViewCtx, private pool: SurfacePool) {
    const scale = view.scale * waterParams.resolution, id = view.id === 'main' ? '' : `.${view.id}`;
    const v = view.id === 'main' ? undefined : view.view;
    const on = () => view.on() && pool.liquid();
    const tex = (label: string, format: GPUTextureFormat, s = scale) => kit.texture({ label: `water.${label}${id}`, format, size: 'render', scale: s });
    const dist = tex('dist', 'r32float');
    const depth = tex('depth', 'depth32float');
    const thick = tex('thick', 'rgba16float');
    const A = tex('smoothA', 'rgba32float');
    const B = tex('smoothB', 'rgba32float');
    const copy = tex('behind', 'rgba16float', view.scale);
    // (seen: what this view sees of each dancer, engine/seen.wgsl)
    const bind = { sim: pool.sim, state: pool.state, aux: pool.aux, homes: pool.homes, seen: view.seen };

    const splatD = kit.pass({ label: `water.splat.depth${id}`, color: [{ target: dist, clear: [0, 0, 0, 0] }], depth: { target: depth, clear: 0 }, view: v, enabled: on });
    splatD.draw(splatShader, { label: `water.splat.depth${id}`, fragment: 'fs_depth', bind, count: 6, instances: () => pool.count(), cull: 'none' });
    const splatT = kit.pass({ label: `water.splat.thick${id}`, color: [{ target: thick, clear: [0, 0, 0, 0] }], view: v, enabled: on });
    splatT.draw(splatShader, { label: `water.splat.thick${id}`, fragment: 'fs_thick', bind, count: 6, instances: () => pool.count(), cull: 'none', blend: 'add', depthWrite: false });
    frame.add('cull', splatD, 'water');
    frame.add('cull', splatT, 'water');
    // x into A, y into B; the first reads the splats; every pass binds all three sources (smooth.wgsl says why)
    for (let k = 0; k < MAX_SMOOTH; k++) {
      const passOn = () => on() && k < Math.max(1, Math.round(waterParams.smoothPasses));
      const h = kit.pass({ label: `water.smooth.x${k}${id}`, color: [{ target: A }], view: v, enabled: passOn });
      h.fullscreen(smoothShader, { label: `water.smooth.x${k}${id}`, fragment: k === 0 ? 'fs_first' : 'fs_next', bind: { sm: pool.smoothX, dist, thick, src: B } });
      const w = kit.pass({ label: `water.smooth.y${k}${id}`, color: [{ target: B }], view: v, enabled: passOn });
      w.fullscreen(smoothShader, { label: `water.smooth.y${k}${id}`, fragment: 'fs_next', bind: { sm: pool.smoothY, dist, thick, src: A } });
      frame.add('cull', h, 'water');
      frame.add('cull', w, 'water');
    }
    const copyItem = Object.assign(kit.copy(view.targets.hdr, copy, `water.scene.copy${id}`), { enabled: on });
    frame.add('air', copyItem, 'water');
    this.composite = kit.pass({ label: `water.surface${id}`, color: [{ target: view.targets.hdr, clear: false }], view: v, enabled: on });
    frame.add('air', this.composite, 'water');
    this.copy = copy;
    this.smoothed = B;
  }
  private copy;
  private smoothed;

  /** the composite's draw for one world (its light), once */
  addWorld(world: World) {
    if (this.worlds.has(world.id)) return;
    this.worlds.add(world.id);
    const view = this.view;
    this.composite.fullscreen(surfaceShader, {
      label: `water.surface.${world.id}${view.id === 'main' ? '' : `.${view.id}`}`, constants: { WORLD: world.light },
      bind: { surf: this.pool.surf, scene: this.copy, water: this.smoothed }, enabled: () => view.world === world.id,
    });
  }
}

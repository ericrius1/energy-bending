// The fire field of one view: where the flames are splatted and made light. Per view, at `fireParams.resolution` of
// the view's size (half by default):
//
//   fire.splat      the flames (and, in a world with a mirror floor, their reflection) added into `heat` and `flow`
//                   (field.wgsl), each tested against the scene's opaque view distance (its alpha) where it lands
//   fire.focus      the focus texture: the flames' view distance where they are dense (MatterPasses.focus)
//   fire.composite  one fullscreen draw over the view's scene: the ramp on the sum, the smoke laid over
//
// Where they run. The splat needs the scene (to be hidden by what is in front of it), so it runs after the view's
// scene pass, and the composite before the air if it can, so the fog, the Pool's reflection and the depth of field
// see the fire as part of the scene:
//   the main view (and ?pip)   'air' stage, declared with the view (kinds declare before the post chain, so these land
//                              before the view's air pass), tested against the resolved scene `hdr` and laid into the
//                              view's `glow` target, which the air fogs at the fire's focus distance
//   a gate's view              its scene and air both run in the 'gates' stage, declared together by the portals, with
//                              nowhere for a kind to go between them; so its field is declared afterwards (the fire's
//                              declarePost) at the end of 'gates', over the view's `air` (before the main scene shows
//                              it). The cost: a gate's fire isn't fogged, and a gate seen through a gate shows the
//                              deeper view without its fire (that view was sampled before its field was laid)
import type { Kit, RenderPass, StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import splatShader from './splat.wgsl';
import compositeShader, { type FireField } from './composite.wgsl';
import type { FrameBuilder, Stage } from '../../engine/frame';
import type { ViewCtx } from '../../engine/views';
import type { World } from '../../worlds/world';
import { fireParams } from './params';

/** what a view's field needs of the flame pool */
export interface FieldPool {
  sim: UniformBuffer<any>;
  field: UniformBuffer<FireField>;
  flames: StorageBuffer;
  homes: StorageBuffer;
  noise: Texture;
  count(): number;
}

export class FlameField {
  readonly heat: Texture;
  readonly flow: Texture;
  readonly focus: Texture;
  private splat: RenderPass;
  private items: { stage: Stage; item: RenderPass }[] = [];

  constructor(kit: Kit, private frame: FrameBuilder, readonly view: ViewCtx, pool: FieldPool, worlds: readonly World[], gate: boolean) {
    const id = view.id === 'main' ? '' : `.${view.id}`;
    const v = view.id === 'main' ? undefined : view.view;
    const scale = view.scale * fireParams.resolution;
    const tex = (label: string, format: GPUTextureFormat) => kit.texture({ label: `fire.${label}${id}`, format, size: 'render', scale });
    this.heat = tex('heat', 'rgba16float');
    this.flow = tex('flow', 'rgba16float');
    this.focus = tex('focus', 'r16float');
    const on = () => view.on() && pool.count() > 0;
    // the scene it is tested against (its alpha is the opaque view distance): before the air for the main view, after
    // it for a gate's. What it is laid over: the main view's glow target (the depth contract: translucent matter never
    // touches the opaque scene, so the Pool's water and the merge of water bodies never take a flame for a surface;
    // the air fogs the glow at the fire's own distance, from its focus texture); a gate's air, after its air
    const scene = gate ? view.targets.air : view.targets.hdr;
    const over = gate ? view.targets.air : view.targets.glow;
    const bind = { sim: pool.sim, field: pool.field, flames: pool.flames, homes: pool.homes, seen: view.seen, scene };
    const add = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } as const;
    this.splat = kit.pass({
      label: `fire.splat${id}`, view: v, enabled: on,
      color: [{ target: this.heat, clear: [0, 0, 0, 0] }, { target: this.flow, clear: [0, 0, 0, 0] }],
    });
    const common = { bind, count: 6, instances: () => pool.count(), cull: 'none' as const, depthWrite: false, blend: [add, add] };
    const mirrored = () => worlds.find((w) => w.id === view.world)?.mirrorFloor === true && fireParams.reflect > 0;
    this.splat.draw(splatShader, { ...common, label: `fire.splat.mirror${id}`, constants: { MIRROR: 1 }, enabled: mirrored });
    this.splat.draw(splatShader, { ...common, label: `fire.splat${id}`, constants: { MIRROR: 0 } });
    const focus = kit.pass({ label: `fire.focus${id}`, view: v, enabled: on, color: [{ target: this.focus }] });
    focus.fullscreen(compositeShader, { label: `fire.focus${id}`, fragment: 'fs_focus', bind: { field: pool.field, heat: this.heat, flow: this.flow } });
    const composite = kit.pass({ label: `fire.composite${id}`, view: v, enabled: on, color: [{ target: over, clear: false }] });
    // light added, smoke laid over (premultiplied), the alpha (the opaque view distance) left as it is
    composite.fullscreen(compositeShader, {
      label: `fire.composite${id}`, fragment: 'fs', bind: { field: pool.field, heat: this.heat, flow: this.flow, noiseTex: pool.noise },
      blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } }, writeMask: 0x7,
    });
    const stage: Stage = gate ? 'gates' : 'air';
    this.items = [this.splat, focus, composite].map((item) => ({ stage, item }));
    if (!gate) this.declare();
  }

  private declared = false;
  /** put the passes in the frame (a gate view's wait for the fire's declarePost: see the file's comment) */
  declare() {
    if (this.declared) return;
    this.declared = true;
    for (const { stage, item } of this.items) this.frame.add(stage, item, 'fire');
  }
}

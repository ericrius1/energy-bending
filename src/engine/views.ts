// Views: a camera, weft's View for it (its own Frame uniform), the world it shows, and its scene targets. The main
// view is the canvas's; others (the ?pip inset now, a portal's destination later) are drawn into smaller targets in
// the same frame. Everything that draws into a scene is declared once per view (worlds' `declareScene`, matter kinds'
// `declareView`), so a second view is the same code pointed at another camera.
import { Camera, type Kit, type RenderPass, type Texture, type View } from '@ericrius1/weft';

/** what a scene pass draws into: MSAA colour (alpha carries the view distance) resolved to `hdr`, and depth */
export interface SceneTargets {
  hdrMS: Texture;
  depthMS: Texture;
  hdr: Texture;
  /** after the air pass: the scene with the light in the air and the fog */
  air: Texture;
}

export interface ViewCtx {
  readonly id: string;
  /** weft's view: the passes and computes that draw from this camera take it as `view` */
  readonly view: View;
  readonly camera: Camera;
  /** the world this view shows now (a world id); it may change at runtime (the main view moving to another world) */
  world: string;
  /** fraction of the render size its targets are */
  readonly scale: number;
  readonly targets: SceneTargets;
  /** its scene pass (worlds and matter declare their draws into it) */
  readonly scene: RenderPass;
  /** whether it's drawn this frame */
  readonly on: () => boolean;
}

/** a view and its scene targets and pass. The main view uses the kit's camera and canvas size (scale 1) */
export function makeView(kit: Kit, id: string, o: { world: string; scale?: number; main?: boolean; on?: () => boolean; samples?: 1 | 4 }): ViewCtx {
  const scale = o.scale ?? 1;
  const camera = o.main ? kit.camera : new Camera();
  const view = o.main ? kit.mainView : kit.view(camera, scale, `view.${id}`);
  const samples = o.samples ?? 4;
  const tex = (label: string, format: GPUTextureFormat, s = 1) =>
    kit.texture({ label: `${id}.${label}`, format, size: 'render', scale, samples: s });
  const targets: SceneTargets = {
    hdrMS: tex('hdrMS', 'rgba16float', samples),
    depthMS: tex('depthMS', 'depth32float', samples),
    hdr: tex('hdr', 'rgba16float'),
    air: tex('air', 'rgba16float'),
  };
  const on = o.on ?? (() => true);
  // alpha clears to 80: "nothing here, 80 m away", which the air and the depth of field read as distance
  const scene = kit.pass({
    label: id === 'main' ? 'scene' : `scene.${id}`,
    color: [{ target: targets.hdrMS, resolve: targets.hdr, clear: [0, 0, 0, 80], store: false }],
    depth: { target: targets.depthMS, clear: 0, store: false },
    view: o.main ? undefined : view,
    enabled: on,
  });
  return { id, view, camera, world: o.world, scale, targets, scene, on };
}

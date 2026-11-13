// Views: a camera, weft's View for it (its own Frame uniform), the world it shows, and its scene targets. The main
// view is the canvas's; others (the ?pip inset now, a portal's destination later) are drawn into smaller targets in
// the same frame. Everything that draws into a scene is declared once per view (worlds' `declareScene`, matter kinds'
// `declareView`), so a second view is the same code pointed at another camera. Each view also has a small uniform
// saying what it sees of each dancer (`seen`, engine/seen.wgsl): which dancers are in its world, and where a dancer
// half way through a gate is cut at the door; matter kinds bind it in their culls and draws.
//
// A view's scene is two passes over one depth buffer (the depth contract, src/post/air.wgsl): the scene pass (the
// backdrop and every opaque thing: colour, and in alpha the opaque view distance) and the glow pass after it (what
// translucent matter adds: flames, sparks, motes, drops, the gates' halos), depth-tested against the opaque things
// but drawn into a target of its own, so nothing translucent can change what the water, the reflections and the fog
// read as the opaque distance. engine/scene.ts declares each phase into the right one.
import { Camera, type Kit, type RenderPass, type Texture, type UniformBuffer, type View } from '@ericrius1/weft';
import seenShader, { type ViewSeen } from './seen.wgsl';
import { LIMITS } from './limits';
import { follow } from './frame';

/** what the glow target's alpha clears to: "no flame here" (src/post/air.wgsl reads past 5000 as none) */
export const NO_FOCUS = 1e4;

/** what a scene pass draws into: MSAA colour (alpha carries the opaque view distance) resolved to `hdr`, and depth;
 *  and what its glow pass draws into: MSAA colour resolved to `glow` (rgb the light translucent matter adds; alpha the
 *  nearest distance a flame min-blended there, NO_FOCUS where none) */
export interface SceneTargets {
  hdrMS: Texture;
  depthMS: Texture;
  hdr: Texture;
  glowMS: Texture;
  glow: Texture;
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
  /** its scene pass (worlds and matter declare their backdrop and opaque draws into it) */
  readonly scene: RenderPass;
  /** its glow pass, right after the scene pass (the glow phase's draws: engine/scene.ts); whoever adds `scene` to the
   *  frame adds this after it (engine/frame.ts follow) */
  readonly glow: RenderPass;
  /** whether it's drawn this frame */
  readonly on: () => boolean;
  /** what it sees of each dancer (engine/seen.wgsl): bind as `seen` in every cull and draw of a dancer's matter */
  readonly seen: UniformBuffer<ViewSeen>;
  /** 'world': only the dancers in the world it shows (the main view, a gate's); 'all': every dancer (the ?pip proof) */
  readonly cast: 'world' | 'all';
}

/** every dancer drawn where it stands, nothing cut: what a view sees before the portals say otherwise */
export function seenEveryone(): ViewSeen {
  const one = { x: [1, 0, 0, 0], y: [0, 1, 0, 0], z: [0, 0, 1, 0], q: [0, 0, 0, 1], clip: [0, 0, 0, 1] } as ViewSeen['d'][number];
  return { d: Array.from({ length: LIMITS.dancers }, () => one), keep: 1, grow: 1, pad0: 0, pad1: 0 } as ViewSeen;
}

/** a view and its scene targets and pass. The main view uses the kit's camera and canvas size (scale 1) */
export function makeView(kit: Kit, id: string, o: { world: string; scale?: number; main?: boolean; on?: () => boolean; samples?: 1 | 4; camera?: Camera; cast?: 'world' | 'all' }): ViewCtx {
  const scale = o.scale ?? 1;
  const camera = o.main ? kit.camera : o.camera ?? new Camera();
  const view = o.main ? kit.mainView : kit.view(camera, scale, `view.${id}`);
  const samples = o.samples ?? 4;
  const tex = (label: string, format: GPUTextureFormat, s = 1) =>
    kit.texture({ label: `${id}.${label}`, format, size: 'render', scale, samples: s });
  const targets: SceneTargets = {
    hdrMS: tex('hdrMS', 'rgba16float', samples),
    depthMS: tex('depthMS', 'depth32float', samples),
    hdr: tex('hdr', 'rgba16float'),
    glowMS: tex('glowMS', 'rgba16float', samples),
    glow: tex('glow', 'rgba16float'),
    air: tex('air', 'rgba16float'),
  };
  const on = o.on ?? (() => true);
  // alpha clears to 80: "nothing here, 80 m away", which the air and the depth of field read as distance
  const scene = kit.pass({
    label: id === 'main' ? 'scene' : `scene.${id}`,
    color: [{ target: targets.hdrMS, resolve: targets.hdr, clear: [0, 0, 0, 80], store: false }],
    depth: { target: targets.depthMS, clear: 0, store: true },
    view: o.main ? undefined : view,
    enabled: on,
  });
  const glow = kit.pass({
    label: id === 'main' ? 'glow' : `glow.${id}`,
    color: [samples > 1 ? { target: targets.glowMS, resolve: targets.glow, clear: [0, 0, 0, NO_FOCUS], store: false } : { target: targets.glow, clear: [0, 0, 0, NO_FOCUS] }],
    depth: { target: targets.depthMS, clear: false, store: false },
    view: o.main ? undefined : view,
    enabled: on,
  });
  follow(scene, glow);
  const seen = kit.uniforms(seenShader.structs.ViewSeen, `${id}.seen`).set(seenEveryone());
  return { id, view, camera, world: o.world, scale, targets, scene, glow, on, seen, cast: o.cast ?? 'world' };
}

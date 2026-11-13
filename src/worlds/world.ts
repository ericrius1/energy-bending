// The World contract and the registry of worlds. A world is a place to dance: its backdrop and its own things,
// its light (which matter drawn in it is lit by), its air, its sound, where the camera may stand, the stage planes
// a view can lock to, its portals and spawn points, and any matter it is built of (the geode's crystal wall).
//
// Light that depends on the world is chosen per pipeline, not per pixel: worlds/light.wgsl switches on an
// `override WORLD` constant, and each world's `light` is the number of its case there. A matter kind declares one
// draw per world with `constants: { WORLD: world.light }` (engine/scene.ts asks it once per world and view). The
// worlds' light uniforms are one shared bind group (group 2) that every shader including worlds/light.wgsl sees.
import type { Kit, Texture, UniformBuffer } from '@ericrius1/weft';
import type { FrameBuilder, FrameCtx } from '../engine/frame';
import type { ScenePass } from '../engine/scene';
import type { StagePlane } from '../engine/camera';
import type { Tone } from '../audio/sound';
import { Registry } from '../engine/registry';
import type { BodyBuffers } from '../matter/core/bodies';

type V3 = [number, number, number];

/** a gate to another world: where its disc's centre stands, which way it faces (the side you walk in from), how big
 *  it is. The world chooses the site (a clear, flat approach); src/portals draws it and makes the crossing */
export interface PortalDef { id: string; at: V3; normal: V3; radius: number; to: { world: string; portal: string } }

/** matter a world is built of, placed once: { kind: 'gems', ...that kind's own fields } */
export interface Fixture { kind: string; [field: string]: unknown }

/** what a world is handed when it loads */
export interface WorldCtx {
  kit: Kit;
  /** the site's base URL (import.meta.env.BASE_URL): assets are at `${base}worlds/<id>/…` */
  base: string;
  bodies: BodyBuffers;
  /** a phone-sized device: fewer things, less detail */
  coarse: boolean;
  /** rendering a film (more detail, its own clock) */
  film: boolean;
  /** the frame: a world with a simulation of its own (the pool's ripples) adds its compute steps under 'sim' */
  frame: FrameBuilder;
}

export interface World {
  readonly id: string;
  /** its case in worlds/light.wgsl (the WORLD override constant) */
  readonly light: number;
  /** its emotional temperature, -1 (still, cool) … 1 (bright, warm), for the music and brains to read */
  readonly mood: number;
  /** its uniforms (and textures: the water's height field) in the shared light group (worlds/light.wgsl's binding
   *  names), made in the constructor */
  readonly shared: Record<string, UniformBuffer<any> | Texture>;
  /** stage planes the view can lock to, portals, where dancers may start */
  readonly stages: StagePlane[];
  readonly portals: PortalDef[];
  readonly spawns: V3[];
  /** matter it is built of (the gems kind makes the geode's wall from its fixture) */
  readonly fixtures: Fixture[];
  /** whether its floor is a mirror (matter adds its reflection) */
  readonly mirrorFloor: boolean;
  /** how far from the middle the camera may stand, and the furthest it may dolly out */
  readonly room: number;
  readonly maxDist: number;

  /** fetch what it needs (textures) before it is first shown */
  load(ctx: WorldCtx): Promise<void>;
  /** each frame it is on screen: its light (the day going by), from the dancers' middle */
  update(f: FrameCtx, centre: { x: number; z: number; ring: boolean; dancers: number }): void;
  /** declare its draws into one view's scene, one phase at a time (engine/scene.ts calls this once per view and
   *  phase; every draw takes `enabled: scene.on`). Callable for any number of views */
  declareScene(scene: ScenePass): void;
  /** the floor's height under (x, z) */
  groundAt(x: number, z: number): number;
  /** a world with no ground everywhere (the forge): a body that falls below this height has fallen out of the world
   *  and re-forms at a spawn (the dancers' physics, free or locked). Leave it out where there is always a floor */
  readonly fallY?: number;
  /** the exposure it wants now (× the post chain's), and how it sounds there */
  exposure(): number;
  tone(): Tone;
  /** the wood's own sound, told a few times a second: day, night, dawn (0 … 1) and wind; null where there is none */
  ambience(): [number, number, number, number] | null;
}

/** what a world's folder registers: its id, and how to make it (once, at start, with the kit) */
export interface WorldDef { readonly id: string; make(ctx: WorldCtx): World }

/** the worlds: each world's folder calls `worlds.register({ id, make })` from its index.ts */
export const worlds = new Registry<WorldDef>('world');

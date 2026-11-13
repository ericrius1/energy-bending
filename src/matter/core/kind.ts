// The MatterKind contract, loadouts, and the registry of kinds. A matter kind is one way a body can be made: gems now,
// fire, water, ice and plasma in wave 1. Each lives in its own folder under src/matter and registers itself once.
//
// What a kind does, in order:
//   declare(ctx)     once at start: make its buffers, add its compute steps to the frame (ctx.frame.add('sim', …)),
//                    and return its MatterPasses;
//   declareView(s)   once per view, world and scene phase: add its draws to the scene pass, lit by that world
//                    (constants: { WORLD: s.world.light }, enabled: s.on);
//   layout(layers)   when the cast or a loadout changes: where its particles live (matter/core/layout.ts does the
//                    work over capsules; the kind adds its own look per particle);
//   update(f)        each frame, in the 'matter' phase: its uniforms (from its parameters, the hand, the world);
//   resize(budget)   how many particles to run (a programme, the device, the panel).
// The shared body buffers (joints, capsules, the hand) are bind group 3: include matter/core/body.wgsl and use them.
import type { Kit } from '@ericrius1/weft';
import type { FrameBuilder, FrameCtx } from '../../engine/frame';
import type { ScenePass } from '../../engine/scene';
import type { World } from '../../worlds/world';
import type { BodyBuffers } from './bodies';
import type { Hand } from './touch';
import type { Field } from '../field/field';
import type { PostChain } from '../../post/post';
import type { BodyPart } from './capsules';
import type { LayoutLayer } from './layout';
import { Registry } from '../../engine/registry';

export type { BodyPart };

/** one layer of what a dancer wears: a kind, its share of the dancer, the parts it covers, the kind's own params */
export interface LoadoutLayer {
  kind: string;
  /** how much of the dancer this layer is, relative to the dancer's other layers (and, across dancers, how much of
   *  the kind's particles this dancer gets) */
  share: number;
  /** the body parts it covers (all when left out) */
  parts?: BodyPart[];
  /** the kind's own settings for this layer (gems: { suite: 'Violet' }) */
  params?: Record<string, unknown>;
}
/** what a dancer wears */
export interface Loadout { layers: LoadoutLayer[] }

/** a gem dancer, as in Gem Dancers: gems everywhere, in one suite */
export const gemsLoadout = (suite: string): Loadout => ({ layers: [{ kind: 'gems', share: 1, params: { suite } }] });

/** how many particles a kind should run */
export interface Budget { count: number }

/** one layer of one dancer, as handed to a kind's layout */
export interface MatterLayer extends LayoutLayer {
  layer: LoadoutLayer;
}

/** what a kind is handed at start */
export interface MatterCtx {
  kit: Kit;
  frame: FrameBuilder;
  bodies: BodyBuffers;
  hand: Hand;
  field: Field;
  /** every world (a kind may build fixtures some world is made of) */
  worlds: readonly World[];
  /** the site's base URL (import.meta.env.BASE_URL) */
  base: string;
  coarse: boolean;
  film: boolean;
  /** extra views the frame draws (their culls etc. are declared through declareView) */
  views: number;
}

/** the moments of a show that every kind can act on (rise into the bodies, shatter off them, stay down) */
export interface MatterActs {
  /** what's on the floor rises into the bodies, feet first, over `spread` seconds from dance time `at` */
  rise(at: number, spread: number): void;
  /** everything comes off the bodies now, from a blast at (x, y, z) */
  shatter(x: number, y: number, z: number, strength: number): void;
  /** while true, what falls stays down */
  settle(on: boolean): void;
  /** while true the dance is on: bodies shed matter as they move and leave trails (not while rising or falling) */
  dancing(on: boolean): void;
}

export interface MatterPasses {
  readonly id: string;
  declareView(scene: ScenePass): void;
  layout(layers: MatterLayer[]): void;
  update(f: FrameCtx): void;
  resize?(budget: Budget): void;
  acts?: MatterActs;
  /** dancers carried through a gate this frame (src/portals): move each one's particles (positions, velocities,
   *  orientations) by its rigid move before this frame's simulation, so they arrive with the body. `move` is a
   *  column-major 4×4. Kinds whose particles live on the body should implement it (docs/extending/portal.md) */
  carry?(moves: readonly Carry[]): void;
  /** translucent matter with no one distance (steam): draws added to `post.lens` after the depth of field, over the
   *  focused image, tested against the scene's view distance by hand (post.sceneTex's alpha). Called once, after the
   *  post chain is built (main.ts); the main view only */
  declarePost?(post: PostChain): void;
  /** numbers for bend.stats() */
  stats?(): Record<string, number | string>;
}

/** one dancer's particles carried by a rigid move (a column-major 4×4) */
export interface Carry { dancer: number; move: Float32Array }

export interface MatterKind {
  readonly id: string;
  declare(ctx: MatterCtx): MatterPasses | Promise<MatterPasses>;
}

/** the kinds: each kind's folder calls `matterKinds.register(kind)` from its index.ts */
export const matterKinds = new Registry<MatterKind>('matter kind');

/** the layers wearing one kind, across the cast, in slot order */
export function layersOf(kind: string, cast: readonly { rig: import('../../skeleton/rig').Rig; loadout: Loadout }[]): MatterLayer[] {
  const out: MatterLayer[] = [];
  cast.forEach((d, dancer) => {
    const total = d.loadout.layers.reduce((a, l) => a + l.share, 0) || 1;
    for (const layer of d.loadout.layers) {
      if (layer.kind !== kind || layer.share <= 0) continue;
      out.push({ dancer, rig: d.rig, parts: layer.parts, weight: layer.share / total, layer });
    }
  });
  return out;
}

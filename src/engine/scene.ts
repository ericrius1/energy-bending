// Scene assembly. A scene pass draws its draws in the order they were declared (weft rule), and a frame needs them
// in layers: the world's backdrop first (it writes no depth), then everything solid (matter and the world's own
// solid things), then what glows (additive, no depth writes). So the scene is declared in three phases, and in each
// phase every world and every matter kind is asked in turn. A world's draws, and the matter drawn lit by that world,
// are enabled only while the view shows that world (`ScenePass.on`), so a view can switch worlds at runtime and two
// views can show two worlds in one frame.
//
// Besides the worlds and the matter, a scene can have layers that belong to every world (the gates between them,
// src/portals): each registers with `sceneLayers` and is asked once per view and phase, after the worlds, so in the
// opaque phase it lands after every solid thing (and is depth-tested against them) and before every glow.
import type { RenderPass } from '@ericrius1/weft';
import type { ViewCtx } from './views';
import type { World } from '../worlds/world';
import type { MatterPasses } from '../matter/core/kind';
import { Registry } from './registry';

export type ScenePhase = 'backdrop' | 'opaque' | 'glow';
export const SCENE_PHASES: readonly ScenePhase[] = ['backdrop', 'opaque', 'glow'];

/** what a world or a matter kind is handed to declare its draws into */
export interface ScenePass {
  readonly pass: RenderPass;
  readonly phase: ScenePhase;
  readonly view: ViewCtx;
  /** the world this declaration is for */
  readonly world: World;
  /** true while `view` shows `world`: pass it (or something that includes it) as each draw's `enabled` */
  readonly on: () => boolean;
}

/** something drawn in every world's scene, whichever world a view shows (the gates): asked per view and phase */
export interface SceneLayer {
  readonly id: string;
  declareLayer(pass: RenderPass, phase: ScenePhase, view: ViewCtx): void;
}
/** the layers every scene declaration includes (src/portals registers the gates) */
export const sceneLayers = new Registry<SceneLayer>('scene layer');

/** declare one view's whole scene: for each phase, each world, then each matter kind lit by that world; then the
 *  layers that belong to no one world */
export function declareScene(view: ViewCtx, worlds: readonly World[], matter: readonly MatterPasses[]) {
  for (const phase of SCENE_PHASES) {
    for (const world of worlds) {
      const s: ScenePass = { pass: view.scene, phase, view, world, on: () => view.world === world.id };
      // the backdrop is the world's alone; matter goes before the world's own solid things and its glows
      if (phase !== 'backdrop') for (const m of matter) m.declareView(s);
      world.declareScene(s);
    }
    for (const l of sceneLayers.all()) l.declareLayer(view.scene, phase, view);
  }
}

// Scene assembly. A scene pass draws its draws in the order they were declared (weft rule), and a frame needs them
// in layers: the world's backdrop first (it writes no depth), then everything solid (matter and the world's own
// solid things), then what glows (additive, no depth writes). So the scene is declared in three phases, and in each
// phase every world and every matter kind is asked in turn. A world's draws, and the matter drawn lit by that world,
// are enabled only while the view shows that world (`ScenePass.on`), so a view can switch worlds at runtime and two
// views can show two worlds in one frame.
//
// The depth contract (src/post/air.wgsl): the scene target's alpha is the opaque view distance, written by opaque
// draws and never by translucent matter. So the backdrop and opaque phases go into the view's scene pass, where a
// blended draw (a reflection added onto the floor, a decal) has its alpha write turned off here, whatever its blend
// says; and the glow phase goes into the view's glow pass (engine/views.ts), a target of its own over the same depth.
// Translucent kinds that want the lens to focus on them hand over a focus texture (MatterPasses.focus): the post chain
// finds them with `focusSources(view)`.
//
// Besides the worlds and the matter, a scene can have layers that belong to every world (the gates between them,
// src/portals): each registers with `sceneLayers` and is asked once per view and phase, after the worlds, so in the
// opaque phase it lands after every solid thing (and is depth-tested against them) and before every glow.
import type { BlendMode, RenderPass } from '@ericrius1/weft';
import type { ViewCtx } from './views';
import type { World } from '../worlds/world';
import type { MatterPasses } from '../matter/core/kind';
import { Registry } from './registry';

export type ScenePhase = 'backdrop' | 'opaque' | 'glow';
export const SCENE_PHASES: readonly ScenePhase[] = ['backdrop', 'opaque', 'glow'];

/** what a world or a matter kind is handed to declare its draws into */
export interface ScenePass {
  /** the view's scene pass (backdrop, opaque) or its glow pass (glow) */
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

const focusOf = new WeakMap<ViewCtx, MatterPasses[]>();
/** the kinds that hand over a focus texture for this view (MatterPasses.focus), in declaration order */
export function focusSources(view: ViewCtx): readonly MatterPasses[] { return focusOf.get(view) ?? []; }

/** declare one view's whole scene: for each phase, each world, then each matter kind lit by that world; then the
 *  layers that belong to no one world */
export function declareScene(view: ViewCtx, worlds: readonly World[], matter: readonly MatterPasses[]) {
  focusOf.set(view, matter.filter((m) => !!m.focus));
  const opaque = keepAlpha(view.scene);
  for (const phase of SCENE_PHASES) {
    const pass = phase === 'glow' ? view.glow : opaque;
    for (const world of worlds) {
      const s: ScenePass = { pass, phase, view, world, on: () => view.world === world.id };
      // the backdrop is the world's alone; matter goes before the world's own solid things and its glows
      if (phase !== 'backdrop') for (const m of matter) m.declareView(s);
      world.declareScene(s);
    }
    for (const l of sceneLayers.all()) l.declareLayer(pass, phase, view);
  }
}

// ---------------------------------------------------------------- the opaque distance, kept
// weft's blend presets, colour part only: a blended draw in the scene pass keeps its colour blend and leaves the
// alpha (the opaque distance) as it was
const COLOR: Record<string, GPUBlendComponent | undefined> = {
  alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
  premultiplied: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  add: { srcFactor: 'one', dstFactor: 'one' },
  'add-alpha': { srcFactor: 'src-alpha', dstFactor: 'one' },
  multiply: { srcFactor: 'dst', dstFactor: 'zero' },
  max: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
};
const KEEP: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one' };

function keepBlend(b: BlendMode | undefined): BlendMode | undefined {
  if (b === undefined || b === 'opaque') return b;
  if (typeof b === 'string') return COLOR[b] ? { color: COLOR[b]!, alpha: KEEP } : b;
  return { color: b.color, alpha: KEEP };
}

/** the scene pass as a declarer sees it: every draw with a blend has its alpha write turned off (opaque draws, which
 *  write the distance, are untouched) */
function keepAlpha(pass: RenderPass): RenderPass {
  return new Proxy(pass, {
    get(t, k) {
      if (k === 'draw' || k === 'fullscreen') {
        return (shader: Parameters<RenderPass['draw']>[0], o: Parameters<RenderPass['draw']>[1] = {}) => {
          const blend = Array.isArray(o.blend) ? o.blend.map((b) => keepBlend(b)!) : keepBlend(o.blend);
          return t[k](shader, { ...o, blend });
        };
      }
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

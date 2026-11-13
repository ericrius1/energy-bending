// ?pip: proof that a scene can be declared for more than one view in a frame. A second view, a third of the render
// size, shows the *other* world (with the same dancers in it, lit by that world: the gems' pipelines for its WORLD)
// from a camera orbiting the stage, in an inset at the top right. A portal (wave 1) will use the same path to draw its
// destination.
import type { Kit } from '@ericrius1/weft';
import { makeView, type ViewCtx } from './views';

export interface Pip { view: ViewCtx; rect: () => [number, number, number, number]; update(t: number, other: string, centre: [number, number]): void }

export function makePip(kit: Kit, world: string): Pip {
  const scale = 1 / 3;
  const view = makeView(kit, 'pip', { world, scale });
  return {
    view,
    // a third of the canvas, top right, a little in from the edges (the same aspect as the view)
    rect: () => [1 - scale - 0.015, 0.02, scale, scale],
    update(t, other, [cx, cz]) {
      view.world = other;
      const a = t * 0.25, r = 5.2;
      view.camera.fovY = (40 * Math.PI) / 180;
      view.camera.lookAt([cx + Math.sin(a) * r, 2.0, cz + Math.cos(a) * r], [cx, 0.95, cz]);
    },
  };
}

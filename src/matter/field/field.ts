// The matter field's resource object (a stub): see field.wgsl for what it is. Kinds include
// "../field/field.wgsl" (from their own folder) and call fieldWind / fieldHeat / fieldWet; they hand deposits to
// `deposit` (a no-op for now). Wave 1 gives this object its grid (3D textures that follow the dancers' middle), a
// compute step in the 'sim' stage that diffuses and decays it, and a shared bind group for the samplers.
import type { FrameCtx } from '../../engine/frame';

/** something a kind puts into the field this frame: at p, so much wind, heat and wet, spread over radius r */
export interface Deposit { p: [number, number, number]; wind?: [number, number, number]; heat?: number; wet?: number; r: number }

export class Field {
  /** the grid's centre and half size (m): it follows the dancers */
  readonly centre: [number, number, number] = [0, 1, 0];
  halfSize = 4;
  /** cells along each side */
  readonly cells = 32;
  /** whether it does anything yet (kinds can skip their deposits while it doesn't) */
  readonly live = false;

  /** CPU deposits (a GPU kind will write its own in a compute step instead) */
  deposit(_d: Deposit) { /* the stub keeps nothing */ }

  /** each frame: follow the dancers */
  update(f: FrameCtx) {
    let x = 0, z = 0;
    for (const d of f.dancers) { x += d.skeleton.world[0]; z += d.skeleton.world[2]; }
    if (f.dancers.length) { this.centre[0] = x / f.dancers.length; this.centre[2] = z / f.dancers.length; }
  }
}

// A Dancer: a skeleton, the controller that moves it, and the loadout of matter it wears. The cast (dancer/show.ts)
// keeps a list of them; their slot in that list is their slot in the shared joint and capsule buffers.
import { Skeleton } from '../skeleton/rig';
import type { Controller } from './controller';
import type { FrameCtx } from '../engine/frame';
import type { Loadout } from '../matter/core/kind';

export class Dancer {
  readonly skeleton: Skeleton;
  constructor(public readonly id: string, public controller: Controller, public loadout: Loadout) {
    this.skeleton = new Skeleton(controller.rig);
  }

  get rig() { return this.skeleton.rig; }

  /** hand the skeleton to another controller (its velocities start again from rest) */
  setController(c: Controller) {
    this.controller = c;
    this.skeleton.rig = c.rig;
    this.skeleton.reset();
  }

  /** pose and commit, in dance time */
  update(f: FrameCtx) {
    this.controller.update(f.danceDt, f, this.skeleton);
    this.skeleton.commit(f.danceDt);
  }
}

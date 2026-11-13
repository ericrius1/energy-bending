// A Dancer: a skeleton, the controller that moves it, and the loadout of matter it wears. The cast (dancer/show.ts)
// keeps a list of them; their slot in that list is their slot in the shared joint and capsule buffers.
import { Skeleton } from '../skeleton/rig';
import type { Controller } from './controller';
import type { FrameCtx } from '../engine/frame';
import type { Loadout } from '../matter/core/kind';

export class Dancer {
  readonly skeleton: Skeleton;
  /** the dancer's power form, 0 … 1: fire toward plasma, water toward ice (gems ignore it). The one place it lives:
   *  the field's auras, the fire kind and the water pool all read it each frame (bend.form sets it; a loadout
   *  layer's own `params.form` number still wins for that layer) */
  form = 0;
  /** how much of its matter is on its body, 0 … 1: the show lowers it while the matter lies in a heap or is
   *  shattered, so a bare skeleton doesn't warm or wet the air (the field reads it) */
  presence = 1;
  /** the world it is in (src/portals keeps it: main.ts copies gates.worldOf each frame; '' before the first frame,
   *  which means the main view's). The field and the matter that belongs to no one body read it */
  world = '';
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

// A dancer that has gone through a gate: its own controller still poses it where it thinks it is (a mocap clip on its
// floor, a wanderer heading for its goal), and this wrapper carries every joint through the gates it has passed (one
// rigid move, the product of them all), so nothing in the controller has to know. Going back through the same gate
// multiplies the move back to identity and the wrapper comes off.
import type { Controller } from '../dancer/controller';
import type { FrameCtx } from '../engine/frame';
import type { Skeleton } from '../skeleton/rig';
import { Rigid, qmul } from './rigid';

export class Carried implements Controller {
  readonly move = new Rigid();
  constructor(readonly inner: Controller) {}
  get kind() { return this.inner.kind; }
  get rig() { return this.inner.rig; }

  update(dt: number, ctx: FrameCtx, out: Skeleton) {
    this.inner.update(dt, ctx, out);
    const m = this.move, q = m.rotation(), n = out.count;
    for (let k = 0; k < n; k++) {
      const p = out.pos[k], r = out.rot[k];
      const w = m.pt(p);
      p[0] = w[0]; p[1] = w[1]; p[2] = w[2];
      const o = qmul(q, r);
      r[0] = o[0]; r[1] = o[1]; r[2] = o[2]; r[3] = o[3];
    }
  }
}

/** the controller under any wrappers (a demo steering a wanderer through a gate reaches it here) */
export function innermost(c: Controller): Controller { return c instanceof Carried ? innermost(c.inner) : c; }

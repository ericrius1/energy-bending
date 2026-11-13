// The near fade: what the camera can't fix by moving (a column right beside a dancer, a stub in a locked frame's
// foreground, a trunk in a tight follow, a blade the boom grazes) the worlds dissolve instead of letting it fill the
// frame. One mechanism for every world: each world's solid draws call `sightDrop(p, px)` (worlds/light.wgsl) first in
// their fragment shader and discard, a dither, so the depth contract holds (what is drawn is opaque and writes its
// distance; what is dropped shows what stands behind it). It needs no binding: its numbers ride in the worlds' light
// uniform as the `sight` member, and the main view marks itself with weft's per-view `Frame.user.x` (1), so a gate's
// view and the inset, which read the same uniform in the same run, fade nothing.
//
// Each frame (after the camera, so a film's camera counts too) this reads the eye, the world's solids (World.solids,
// as the rig has them) and the framed dancers as the main view sees them, and asks two things on the CPU: is a solid
// within `near` of the eye, and does a solid cross the sight lines from the eye to a dancer's hips, chest or head.
// Each eases a strength up quickly and down slowly; while both are 0 the shaders skip the fade with one uniform branch.
// On the GPU a fragment fades (worlds/light.wgsl sightFade) where it is within `near` of the eye, or where the ray
// through it passes within a body's radius of a framed dancer and it is well in front of that dancer. Nothing below a
// dancer's feet fades (the floor it stands on), nor near the eye below the ground under it.
import type { Kit } from '@ericrius1/weft';
import type { ViewCtx } from '../engine/views';
import type { Solids } from '../engine/camera';
import { defineParams } from '../engine/params';
import { JOINT, JOINT_FLOATS, MAXJ } from '../skeleton/rig';
import { lightSlot, type LightSlot } from './shared';
import type { Sight } from './light.wgsl';

export const fadeParams = defineParams('fade', {
  /** the near fade at all */
  on: true,
  /** fade what is within this of the eye (m; the rig's sight.near) */
  near: 0.6,
  /** fade what stands in front of a framed dancer across the sight line to it */
  between: true,
  /** how far round a dancer's middle the line of sight is kept clear (m, at least) */
  radius: 0.45,
  /** seconds to fade in and to come back */
  easeIn: 0.15,
  easeOut: 0.5,
}, {
  near: { min: 0, max: 2 },
  radius: { min: 0.2, max: 1.2 },
  easeIn: { min: 0, max: 1 },
  easeOut: { min: 0, max: 2 },
});

/** the joints a sight line is drawn to (generous: this only wakes the shaders' own test, which decides what fades) */
const SIGHT = [JOINT.Hips, JOINT.Spine1, JOINT.Head, JOINT.LeftLeg, JOINT.RightLeg, JOINT.LeftHand, JOINT.RightHand];

export class NearFade {
  private slot: LightSlot<Sight>;
  private near = 0;
  private bodies = [0, 0];
  /** each framed body's capsule (lo: feet and radius, hi: top and strength) and the near test's numbers */
  private lo: [number, number, number, number][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  private hi: [number, number, number, number][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  private k: [number, number, number, number] = [0.6, -1e9, 0, 0];
  /** what the last update found (for the stats and the checks): the eye near a solid, which bodies were blocked */
  readonly seen = { near: false, blocked: [false, false] };

  constructor(kit: Kit, main: ViewCtx) {
    this.slot = lightSlot(kit, 'sight');
    // weft's per-view Frame.user: the main view is the one `sight` describes (a gate's view and the inset keep 0)
    main.view.user[0] = 1;
    this.upload();
  }

  private upload() {
    this.slot.set({ body: [{ lo: this.lo[0], hi: this.hi[0] }, { lo: this.lo[1], hi: this.hi[1] }], k: this.k } as Sight);
  }

  /** each frame, after the camera: the eye (the camera's, a film's included), the world's solids (null: none) and
   *  the framed dancers' joints as the main view sees them (JOINT_FLOATS a joint), and the ground's height under a
   *  point */
  update(dt: number, eye: ArrayLike<number>, solids: Solids | null, dancers: readonly Float32Array[], groundAt: (x: number, z: number) => number) {
    const P = fadeParams, E: [number, number, number] = [eye[0], eye[1], eye[2]];
    const ease = (v: number, want: number) => {
      const tau = want > v ? P.easeIn : P.easeOut;
      const n = tau <= 0 ? want : v + (want - v) * (1 - Math.exp(-dt / tau));
      return Math.abs(n - want) < 1e-3 ? want : n;
    };
    const on = P.on && !!solids;
    this.seen.near = on && P.near > 0 && solids!.inside(E, P.near + 0.15);
    this.near = ease(this.near, this.seen.near ? 1 : 0);
    let feet = Infinity;
    for (let k = 0; k < 2; k++) {
      const J = dancers[k], lo4 = this.lo[k], hi4 = this.hi[k];
      let blocked = false;
      if (J) {
        // an upright capsule round the dancer: its lowest and highest joint, its widest reach from the hips
        let lo = Infinity, hi = -Infinity, reach = 0;
        const hx = J[0], hz = J[2];
        for (let j = 0; j < MAXJ; j++) {
          const o = j * JOINT_FLOATS, y = J[o + 1];
          if (y < lo) lo = y;
          if (y > hi) hi = y;
          reach = Math.max(reach, Math.hypot(J[o] - hx, J[o + 2] - hz));
        }
        feet = Math.min(feet, lo);
        lo4[0] = hx; lo4[1] = lo; lo4[2] = hz; lo4[3] = Math.max(P.radius, Math.min(0.9, reach * 0.8 + 0.1));
        hi4[0] = hx; hi4[1] = Math.max(hi, lo + 0.5); hi4[2] = hz;
        if (on && P.between) for (const j of SIGHT) {
          const o = j * JOINT_FLOATS;
          if (solids!.sweep(E, [J[o], J[o + 1], J[o + 2]], 0.2) < 0.98) { blocked = true; break; }
        }
      }
      this.seen.blocked[k] = blocked;
      this.bodies[k] = J ? ease(this.bodies[k], blocked ? 1 : 0) : 0;
      hi4[3] = this.bodies[k];
    }
    const g = groundAt(E[0], E[2]);
    // (the floor under the eye: the rig keeps the eye 25 cm over it, so a "ground" above that is a raised slab the eye
    // stands beside, which is what should fade)
    const floor = Math.min(Number.isFinite(g) && g > -1e4 ? g : Number.isFinite(feet) ? feet : -1e9, E[1] - 0.25);
    const any = this.near > 0 || this.bodies[0] > 0 || this.bodies[1] > 0;
    this.k[0] = P.near; this.k[1] = floor + 0.1; this.k[2] = this.near; this.k[3] = any ? 1 : 0;
    this.upload();
  }
}

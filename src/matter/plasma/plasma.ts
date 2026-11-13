// Plasma, fire's power form. Its body is the fire's flames at form 1 (matter/fire: one pool, a form per particle), so
// this kind hands its loadout layers to the flame pool and adds what is plasma's alone: the arcs. Each frame it arcs
// between the hands of every dancer whose hands are plasma enough (handForm past 0.4) and close enough, and draws
// whatever arcs the game asked for (`arcs.add(from, to, intensity)`, e.g. from a hand to a target).
import type { MatterCtx, MatterLayer, MatterPasses } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import type { FirePasses } from '../fire/fire';
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';
import { Arcs } from './arcs';
import { arcParams } from './params';

export class PlasmaPasses implements MatterPasses {
  readonly id = 'plasma';
  readonly arcs: Arcs;

  constructor(ctx: MatterCtx, readonly flame: FirePasses) {
    this.arcs = new Arcs(ctx.kit);
  }

  /** the game's per-dancer form (0 fire … 1 plasma), the same array as the fire kind's */
  get form() { return this.flame.form; }

  declareView(s: ScenePass) { this.arcs.declareView(s); }

  layout(layers: MatterLayer[]) { this.flame.setLayers('plasma', layers); }

  update(f: FrameCtx) {
    if (arcParams.handArcs) {
      // a stroke is on for a few frames, then off for one or two: decided per dancer on the frame number
      f.dancers.forEach((d, k) => {
        const form = this.flame.handForm(k);
        if (form < 0.4) return;
        const on = hash(f.frame * 31 + k * 977) < arcParams.handDuty;
        if (!on) return;
        const w = d.skeleton.world, l = JOINT.LeftHandIndex1 * JOINT_FLOATS, r = JOINT.RightHandIndex1 * JOINT_FLOATS;
        const a = [w[l], w[l + 1], w[l + 2]], b = [w[r], w[r + 1], w[r + 2]];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const reach = 1 - smooth(arcParams.handReach * 0.7, arcParams.handReach, dist);
        this.arcs.add(a, b, smooth(0.4, 1, form) * reach * (0.8 + 0.4 * hash(f.frame * 7 + k)));
      });
    }
    this.arcs.update(f.frame);
  }

  stats() { return { arcs: this.arcs.arcs, arcSegments: this.arcs.count }; }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** a number in [0, 1) from an integer (stepped captures repeat) */
function hash(n: number) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

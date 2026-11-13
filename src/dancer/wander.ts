// WanderController: a dancer that walks (dances) to random points on the floor, on motion matching
// (skeleton/locomotion). A tiny demo of locomotion, and the shape a brain will take: something that sets a Mover's
// goal, facing and liveliness each frame and lets it find the moves. Shown with ?wander.
import { mulberry32 } from 'math/random';
import type { Controller } from './controller';
import type { FrameCtx } from '../engine/frame';
import type { Rig, Skeleton } from '../skeleton/rig';
import { Mover } from '../skeleton/locomotion/mover';
import { Moves, STYLES, styleMask } from '../skeleton/locomotion/moves';
import type { Motion } from '../skeleton/clips';

let shared: Moves | null = null;
/** the motion-matching database, built once (a few hundred ms) from the dances and the travelling dances */
export function movesOf(motion: Motion, travel: Motion | null) { return (shared ??= new Moves(motion, travel)); }

export class WanderController implements Controller {
  readonly kind = 'wander';
  readonly mover: Mover;
  /** how far from (cx, cz) it may wander (m) */
  radius = 3;
  cx = 0;
  cz = 0;
  private rng: ReturnType<typeof mulberry32.create>;
  private next = 0;

  constructor(moves: Moves, style = 'modern', seed = 7, rig?: Rig) {
    const s = STYLES.find((x) => x.id === style);
    const key = s?.clips[0] ?? 'salsa/1';
    const clip = Math.max(0, moves.clips.findIndex((c) => c.key === key));
    this.mover = new Mover(moves, rig ?? moves.clips[clip].skeleton, clip, 40);
    this.mover.mask = styleMask(style);
    this.rng = mulberry32.create(seed);
  }
  get rig() { return this.mover.rig; }

  place(x: number, z: number, yaw = 0) { this.mover.place(x, z, yaw); this.cx = x; this.cz = z; }

  update(dt: number, f: FrameCtx, out: Skeleton) {
    const m = this.mover, r = () => mulberry32.sample(this.rng);
    const there = Math.hypot(m.goalX - m.x, m.goalZ - m.z) < m.arrive + 0.15;
    if (f.t >= this.next || there) {
      // somewhere new on the floor, not too near where it stands
      for (let k = 0; k < 8; k++) {
        const a = r() * Math.PI * 2, d = this.radius * Math.sqrt(r());
        m.goalX = this.cx + Math.cos(a) * d; m.goalZ = this.cz + Math.sin(a) * d;
        if (Math.hypot(m.goalX - m.x, m.goalZ - m.z) > 1.2) break;
      }
      m.face = Math.atan2(m.goalX - m.x, m.goalZ - m.z);
      m.energy = 0.25 + 0.5 * r();
      this.next = f.t + 5 + 4 * r();
    }
    m.maxSpeed = 0.75 + 0.45 * m.energy;
    m.rate = 30 * (0.92 + 0.22 * m.energy);
    m.update(dt, out);
  }
}

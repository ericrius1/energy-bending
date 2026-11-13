// One side of a gate: a disc in a world (its centre, full orientation and radius), paired with a disc in another
// world. Its frame is (right, up, normal) at its centre; the normal points out of its front. Crossing its front
// face takes you out of its partner's front face, so the move from this world into the partner's is
//     through = partner.frame · FLIP · this.frame⁻¹,      FLIP = a half turn about the gate's up
// (what is in front of this disc is behind the partner's: the camera behind each live gate stands there). Both faces
// work: going in at the back brings you out of the partner's back. Pure numbers (no GPU): the tests in
// scripts/check-portals.mjs run it in Node.
import type { PortalDef } from '../worlds/world';
import { Rigid, cross, dot, norm, type V3 } from './rigid';

/** a gate as the game opens it: a PortalDef (worlds/world.ts) plus the world it is in, and (optionally) which way is
 *  its up: a wall gate's is the world's up; a floor or ceiling gate needs one (default: -z) */
export interface GateDef extends PortalDef { world: string; up?: V3 }

const FLIP = Rigid.frame([-1, 0, 0], [0, 1, 0], [0, 0, -1], [0, 0, 0]);

/** a ripple started on the surface: where (the disc's own coordinates, -1 … 1), when, how hard */
export interface Poke { u: number; v: number; t: number; s: number }

export class Gate {
  readonly id: string;
  readonly world: string;
  readonly radius: number;
  readonly at: V3;
  readonly n: V3;
  readonly up: V3;
  readonly right: V3;
  /** local (right, up, normal) ↦ world */
  readonly frame: Rigid;
  readonly inv: Rigid;
  partner: Gate | null = null;
  /** this world ↦ the partner's world (identity until paired) */
  readonly through = new Rigid();
  /** how open (0 … 1), and where it is heading (opening 1, closing 0) */
  open = 0;
  want = 1;
  /** the rim's colour: whoever last passed (linear rgb), and a flash that dies away after a crossing */
  rim: V3 = [0.55, 0.7, 1.0];
  flash = 0;
  readonly pokes: Poke[] = [];
  /** a seed for its own ripples and threads */
  readonly seed: number;

  constructor(readonly def: GateDef) {
    this.id = def.id;
    this.world = def.world;
    this.radius = def.radius;
    this.at = [def.at[0], def.at[1], def.at[2]];
    this.n = norm(def.normal);
    let up: V3 = def.up ? norm(def.up) : Math.abs(this.n[1]) < 0.9 ? [0, 1, 0] : [0, 0, -1];
    // (up made square to the normal)
    const k = dot(up, this.n);
    up = norm([up[0] - this.n[0] * k, up[1] - this.n[1] * k, up[2] - this.n[2] * k]);
    this.up = up;
    this.right = cross(up, this.n);
    this.frame = Rigid.frame(this.right, this.up, this.n, this.at);
    this.inv = this.frame.inverse();
    let h = 2166136261;
    for (let i = 0; i < def.id.length; i++) h = Math.imul(h ^ def.id.charCodeAt(i), 16777619);
    this.seed = ((h >>> 0) % 10000) / 10000;
  }

  /** pair with the other side (both ways) */
  pair(b: Gate) {
    this.partner = b; b.partner = this;
    b.frame.mul(FLIP, new Rigid()).mul(this.inv, this.through);
    this.frame.mul(FLIP, new Rigid()).mul(b.inv, b.through);
  }

  /** the open disc's radius now (it weaves open from the middle) */
  get reach() { return this.radius * smooth(this.open); }
  /** whether it can be passed (and seen through) */
  get passable() { return !!this.partner && this.open > 0.6; }

  /** signed distance from its plane (positive in front) */
  side(p: ArrayLike<number>) { return dot(this.n, [p[0] - this.at[0], p[1] - this.at[1], p[2] - this.at[2]]); }
  /** a world point in the gate's own coordinates (right, up, along the normal) */
  local(p: ArrayLike<number>): V3 { return this.inv.pt(p); }

  /** where the segment a → b passes through the open disc: null if it doesn't. `margin` widens the disc (a body's
   *  middle passes when it is within the disc's reach) */
  crossing(a: ArrayLike<number>, b: ArrayLike<number>, margin = 0): { u: number; v: number; front: boolean } | null {
    if (!this.passable) return null;
    const sa = this.side(a), sb = this.side(b);
    if ((sa > 0) === (sb > 0) || sa === sb) return null;
    const k = sa / (sa - sb);
    const p: V3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const l = this.local(p), r = this.reach + margin;
    if (l[0] * l[0] + l[1] * l[1] > r * r) return null;
    return { u: l[0] / this.radius, v: l[1] / this.radius, front: sa > 0 };
  }

  /** start a ripple at a point of the disc (its own coordinates, -1 … 1); the partner ripples at the same place
   *  seen from its side */
  poke(u: number, v: number, t: number, s = 1, echo = true) {
    this.pokes.unshift({ u, v, t, s });
    if (this.pokes.length > 4) this.pokes.length = 4;
    if (echo) this.partner?.poke(-u, v, t, s, false);
  }
}

const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

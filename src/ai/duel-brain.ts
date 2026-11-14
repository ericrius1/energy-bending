// The duel's virtual player (docs/design/duel.md: the contact dance, the owner's second correction; 3D native, the lock
// an option anywhere). A Brain that plays the dance battle through Intents only, as a person on a keyboard or a pad
// would, free in the world or locked to the stage plane, whichever the body is in:
//
//   seeing     the other body as it was a reaction time ago (log-normal, a lapse now and then), carried forward by how
//              it was moving (more of it the better the player), with an aim error that drifts between reads
//   contact    it seeks the other: a lead runs in to catch it (best out of the air: it times the grab, the punch
//              button, as the other's hand, waist or ankle comes within reach), a base keeps a little off and catches
//              what comes at it, a flyer runs and jumps at the other to be caught or to vault off its shoulders. Holding,
//              it pumps the swing with the stick round the contact on the beat, then lets go (the fling) when the swing
//              carries the other toward somewhere good to land: a ledge, a stone, a wall to kick off, up and in from the
//              edges, its stick aimed there. Held, it rides, launches off the other's hands when above them (the lift) or
//              spins out its own way (the counter). Flown, it steers to land, kicks off a wall, flips
//   dancing    between contacts the ginga, and on the beat a flourish (an aú, a macaco, a spin, the pirouette)
//   moving     free: toward the place, around the world's solids (a pillar is gone round; a stump, a slab is jumped
//              onto), never off into a pit it can't come back from, the air jump at the top or over the void, a wall
//              kick off a solid it falls against (only toward somewhere to land); locked: along the plane's floor and
//              ledges and off its walls. The dash (Intent.dash) to close a gap, to get away, back from the void
//   holding    a person's thumbs: the stick in eight directions, held a while once moved (no flicker), a jump committed
//              to once pressed, the grab held as long as the hold lasts
//   powers     (the duel's phase 2: shared/powers.ts, src/duel/powers.ts) cast as a person would, when one makes contact
//              happen and the flow is there, a few a minute: a whip at a flyer out of reach, a step under a falling
//              partner (or under its own feet over a drop), a flare into a catch, a pillar under the other to launch it
//              into a catch, an arc at it in the air, a prism on a flung partner's path, a wave or a slide to ride to
//              it; the power form a moment after the bar fills
//
// The knobs: `skill` 0 … 1 (reaction time, aim error, beat accuracy, how well it times a catch and a fling) and `style`:
// lead (a generous lead: catches, swings, flings), flyer (showy: runs at the other to be caught, lifts off, vaults,
// wall kicks, flips), base (grounded: plants, catches what comes, swings it). Deterministic for a seed.
import { Character, PHYS, type Phys } from '../dancer/character';
import { MOVES, J } from '../dancer/moves';
import { ledgeY as defaultLedgeY, distTo, type Ledge, type StagePlane } from '../engine/camera';
import { makeIntent, type Intent } from '../input/intent';
import type { Solid } from '../worlds/solids';
import { Rng, newHints, type Brain, type Sight } from './brain';
import { canStart, pressMove, stickFor } from './body';
import { groundUnder } from '../duel/arena';
import type { HazardSight } from '../duel/hazards';

export type DuelStyle = 'lead' | 'flyer' | 'base';
export const DUEL_STYLES: readonly DuelStyle[] = ['lead', 'flyer', 'base'];
/** the fight's old style names, read as the dance's */
export const STYLE_ALIAS: Record<string, DuelStyle> = { aggressive: 'lead', showy: 'flyer', evasive: 'base' };

/** what the brain may know of the duel beyond the bodies (the rules' state), and of the arena */
export interface DuelSight {
  /** the seats that can't move (the count-in, reforming after a fall) */
  frozen: [boolean, boolean];
  /** the contact: who holds whom now, and who is flown (a fling in flight), or null */
  link: { holder: number; held: number; age: number } | null;
  flown: number | null;
  /** below this (world y) is a fall */
  yKill: number;
  /** the play space (a circle on the ground: past it is a soft wall) */
  space: { center: [number, number, number]; radius: number };
  /** where bodies re-form */
  spawns: readonly (readonly [number, number, number])[];
  /** the world's solids and the arena's pieces, and the floor's height (World.groundAt) */
  solids: readonly Solid[];
  groundAt(x: number, z: number): number;
  /** each seat's powers (src/duel/powers.ts sight()): its flow, the form left, its two powers and whether each is
   *  ready; absent: no powers */
  powers?: { flow: number; form: number; ids: [string, string]; ready: [boolean, boolean]; matter: string }[];
  /** the powers' effects standing now (powers.ts liveSight): a wave's crest, a step's or a pillar's top, a geyser */
  bends?: { kind: string; seat: number; at: [number, number, number] }[];
  /** the arena's hazard as it stands now (src/duel/hazards.ts sight()): its water, the wind, the hum's columns, the
   *  swell; absent or null: none */
  hazard?: HazardSight | null;
}

export interface DuelBrainOptions {
  skill?: number;
  style?: DuelStyle;
  seed?: number;
  duel?: () => DuelSight | null;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** what stands under (x, z) for a body at height y: the highest top of the world's solids and the arena's pieces no
 *  more than `up` above it (a step, or a jump's reach when planning one), else the world's floor (with its drops) */
const groundOf = (D: DuelSight, x: number, z: number, y: number, up = 0.4) => groundUnder(D.solids, x, z, y, D.groundAt(x, z), up);
const sgn = (x: number) => (x < 0 ? -1 : 1);

/** what a body looked like at a moment (world; s along the plane when locked) */
interface Snap { t: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; vs: number; grounded: boolean; reforming: boolean }

/** a surface of the locked plane to stand on (s along the plane; y world) */
interface Surf { id: string; x0: number; x1: number; y: number; solid: boolean; thick: number; ground: boolean }

/** the dance between exchanges (flourishes on the beat) */
const FLOURISHES = ['au', 'macaco', 'spin', 'pirueta', 'au', 'giro'] as const;

/** the body's own jump, from its physics (the jogo's PHYS or the duel's DUEL_PHYS): the height reached holding the
 *  jump for `hold` seconds from the start */
export function jumpHeight(hold: number, P: Phys = PHYS) {
  const v0 = P.jumpV, g = P.gravity, T = Math.min(hold, v0 / g);
  if (T >= v0 / g - 1e-6) return (v0 * v0) / (2 * g);
  const h1 = v0 * T - 0.5 * g * T * T, v1 = v0 - g * T;
  return h1 + (v1 * v1) / (2 * g * P.cutMul);
}
/** how long to hold the jump to rise `h` metres (a full hold past the body's single jump) */
export function holdFor(h: number, P: Phys = PHYS) {
  const full = P.jumpV / P.gravity;
  if (h >= jumpHeight(full, P) - 0.02) return full + 0.05;
  let a = 0, b = full;
  for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (jumpHeight(m, P) < h) a = m; else b = m; }
  return b;
}

export class DuelBrain implements Brain {
  readonly name: string;
  readonly body = newHints();
  readonly skill: number;
  readonly style: DuelStyle;
  /** what it did (the harness counts these) */
  readonly counts: Record<string, number> = {};
  /** why it did the last thing (for probes) */
  why = '';
  private rng: Rng;
  private duel: (() => DuelSight | null) | null;
  private hist: Snap[] = [];
  private K: {
    react: number; sigma: number; lapse: number; aimErr: number; beatSd: number; beatWait: number; decide: number; predict: number;
    want: number; seek: number; leap: number; showy: number; hold: number; swings: number; dance: number; catchP: number;
  };
  // the plan and the thumbs
  private nextDecide = 0;
  private goal: { x: number; y: number; z: number; s: number; why: string } = { x: 0, y: 0, z: 0, s: 0, why: 'start' };
  private stick: [number, number] = [0, 0];
  private stickSince = -1;
  private jumpUntil = -1;
  private jumpPressAt = -1;
  private airJumpAt = -1;
  private airUsed = false;
  private dropUntil = -1;
  private down = -1;
  private pending: { move: string; at: number; dir: [number, number]; why: string; tries?: number } | null = null;
  private lastPress = -1;
  private aimOff: [number, number] = [0, 0];
  /** the grab: pressed this frame, held until (s); the hold's plan (how long it lasts) */
  private grabPress = false;
  private grabUntil = -1;
  private holdFor = 1.5;
  private wasLinked = false;
  private leapT = -1;
  private flipT = -1;
  private avoidSide = 1;
  private hadDash: boolean;
  /** the powers' own dice (so a duel without powers plays exactly as before), the next cast's earliest time, when the
   *  form will be pressed */
  private prng: Rng;
  private nextCast = 0;
  private formAt = -1;
  /** casts of each slot this duel (the less cast is reached for), and when a step was set to run up onto */
  private castN = [0, 0];
  private stepGoal = -1;

  constructor(o: DuelBrainOptions = {}) {
    this.skill = clamp(o.skill ?? 0.6, 0, 1);
    this.style = STYLE_ALIAS[o.style as string] ?? o.style ?? 'lead';
    this.name = `duel-${this.style}`;
    this.rng = new Rng(o.seed ?? 7);
    this.prng = new Rng((o.seed ?? 7) * 31 + 5);
    this.duel = o.duel ?? null;
    const k = this.skill;
    // want: how near it stays; seek: how keen to catch; leap: how keen to jump at the other to be caught; hold: how
    // long a hold lasts (s); swings: pumps before a fling
    const st = { lead: { want: 0.7, seek: 0.9, leap: 0.25, showy: 0.2, hold: 1.6, swings: 3, dance: 0.4 },
      flyer: { want: 2.2, seek: 0.35, leap: 0.9, showy: 0.8, hold: 1.0, swings: 2, dance: 0.9 },
      base: { want: 1.4, seek: 0.75, leap: 0.1, showy: 0.1, hold: 2.0, swings: 4, dance: 0.5 } }[this.style];
    this.K = {
      react: 0.33 - 0.15 * k, sigma: 0.22, lapse: 0.09 - 0.06 * k, aimErr: 0.5 - 0.38 * k, beatSd: 0.095 - 0.075 * k,
      beatWait: 0.1 + 0.85 * k, decide: 0.24 - 0.09 * k, predict: 0.2 + 0.7 * k, catchP: 0.25 + 0.6 * k, ...st,
    };
    this.hadDash = 'dash' in makeIntent();
    this.avoidSide = this.rng.chance(0.5) ? 1 : -1;
  }

  private count(k: string) { this.counts[k] = (this.counts[k] ?? 0) + 1; }

  // ---------------------------------------------------------------- the locked plane's surfaces
  private surfaces(p: StagePlane, beat: number): Surf[] {
    const ly = p.ledgeY ?? defaultLedgeY, oy = p.origin[1], out: Surf[] = [];
    if (p.ground != null) out.push({ id: '_ground', x0: -p.halfWidth, x1: p.halfWidth, y: oy + p.ground, solid: true, thick: 0, ground: true });
    for (const L of p.ledges as Ledge[]) out.push({ id: L.id, x0: L.x0, x1: L.x1, y: oy + ly(L, beat), solid: !!L.solid, thick: L.thick ?? PHYS.solidThick, ground: false });
    return out;
  }
  /** the highest surface at s at or below y */
  private under(S: Surf[], s: number, y: number): Surf | null {
    let best: Surf | null = null;
    for (const q of S) if (s >= q.x0 - 0.05 && s <= q.x1 + 0.05 && q.y <= y + 0.08 && (!best || q.y > best.y)) best = q;
    return best;
  }

  // ---------------------------------------------------------------- seeing
  private snap(c: Character, t: number): Snap {
    const pl = c.plane, vs = pl ? c.v[0] * pl.right[0] + c.v[2] * pl.right[2] : 0;
    return { t, x: c.root[0], y: c.root[1], z: c.root[2], vx: c.v[0], vy: c.v[1], vz: c.v[2], s: pl ? c.s : 0, vs, grounded: c.grounded, reforming: c.reforming };
  }
  /** the other body as this player sees it now: as it was a reaction time ago, carried forward, misjudged a little */
  private seen(t: number, lag: number, pl: StagePlane | null): Snap | null {
    const H = this.hist;
    if (!H.length) return null;
    let i = H.length - 1;
    while (i > 0 && H[i].t > t - lag) i--;
    const o = H[i], k = this.K.predict * Math.min(lag, 0.35), e = this.aimOff;
    const x = o.x + o.vx * k + e[0], z = o.z + o.vz * k + (pl ? 0 : e[1]);
    const s = pl ? (x - pl.origin[0]) * pl.right[0] + (z - pl.origin[2]) * pl.right[2] : 0;
    return { ...o, x, z, s, y: o.y + (o.grounded ? 0 : o.vy * k * 0.5) };
  }

  // ---------------------------------------------------------------- thinking
  think(S: Sight): Intent {
    const it = makeIntent();
    const c = S.self, t = S.t, pl = c.plane;
    const O = S.partner?.character ?? null;
    this.body.flourish = null;
    this.body.groove = 1;
    if (!O) return it;
    const D = this.duel?.() ?? null;
    const me = S.seat, them = 1 - me;
    this.hist.push(this.snap(O, t));
    while (this.hist.length > 2 && this.hist[1].t < t - 1) this.hist.shift();
    if ((D?.frozen[me] ?? false) || c.reforming) {
      // held: let go of everything, forget the plan (the thumbs rest)
      this.pending = null; this.jumpUntil = -1; this.stick = [0, 0]; this.down = -1;
      this.nextDecide = t + this.rng.reaction(this.K.react, this.K.sigma, this.K.lapse);
      return it;
    }
    const lag = this.rng.reaction(this.K.react, 0.05, 0);
    const o = this.seen(t, lag, pl);
    if (!o) return it;
    const mine = this.snap(c, t);
    const yKill = D?.yKill ?? -2.2;
    const otherOut = (D?.frozen[them] ?? false) || o.reforming;
    const L = D?.link ?? null, holding = L?.holder === me, held = L?.held === me;
    if (L && !this.wasLinked) { this.holdFor = this.K.hold * this.rng.range(0.7, 1.3); this.count(holding ? 'holding' : 'held'); }
    this.wasLinked = !!L;

    if (t >= this.nextDecide) {
      if (pl) this.decideLocked(S, c, mine, o, this.surfaces(pl, S.beat), otherOut, yKill);
      else this.decideFree(S, mine, o, otherOut, D);
      this.nextDecide = t + this.K.decide * this.rng.range(0.75, 1.35);
      this.aimOff = [this.aimOff[0] * 0.4 + this.rng.normal() * this.K.aimErr * 0.6, this.aimOff[1] * 0.4 + this.rng.normal() * this.K.aimErr * 0.6];
    }
    if (!this.pending && !L) this.dance(S, c, mine, o, otherOut);
    if (!L && !otherOut && D) this.ride(S, c, mine, o, D, it);
    if (pl) this.legsLocked(S, c, mine, this.surfaces(pl, S.beat), yKill, it, t);
    else this.legsFree(S, c, mine, D, yKill, it, t);
    // the contact: the grab, the pump, the fling, the lift, the counter, the leap at the other (over the legs)
    if (!otherOut) this.partner(S, c, O, mine, o, D, it, holding, held);
    else this.grabUntil = -1;
    if (!otherOut && D?.powers) this.bend(S, c, mine, o, D, it, !!L);
    it.punch = this.grabPress; it.punchHeld = this.grabPress || t <= this.grabUntil;
    this.grabPress = false;

    // ---- a planned press due now
    const p = this.pending;
    if (p && t >= p.at) {
      this.pending = null;
      const ok = MOVES[p.move] ? canStart(c, p.move) && (c.grounded || MOVES[p.move].airOk) : canStart(c, 'spin');
      if (ok && !holding) {
        const fl = pressMove(c, p.move, p.dir, it);
        if (fl) this.body.flourish = fl;
        this.lastPress = t; this.why = p.why; this.count(p.move);
      }
    }
    return it;
  }

  // ---------------------------------------------------------------- free: deciding where to be
  private decideFree(S: Sight, me: Snap, o: Snap, otherOut: boolean, D: DuelSight | null) {
    const K = this.K;
    const rx = me.x - o.x, rz = me.z - o.z, ad = Math.hypot(rx, rz);
    // (in the Pool, nearer: across water the run-up is a swim)
    const near = D?.hazard?.kind === 'swell' ? 0.65 : 1;
    let want = K.want * near, why = 'close';
    if (otherOut) { want = 2.4; why = 'wait for it'; }
    else if (this.style === 'flyer' && ad < 1.4) { want = 2.4 * near; why = 'run-up'; }
    // round the other, as the jogo's pair circles: both the same way, the sense turning every four bars
    let th = ad > 1e-3 ? Math.atan2(rz, rx) : this.rng.range(-Math.PI, Math.PI);
    const sense = Math.floor(S.beat / 16) % 2 ? 1 : -1;
    th += sense * this.rng.range(0.15, 0.5);
    let gx = o.x + Math.cos(th) * want, gz = o.z + Math.sin(th) * want;
    let gy = D ? groundOf(D, gx, gz, me.y, 2.5) : 0;
    if (D) {
      // inside the space; over solid floor (the other in the air over the pit: the edge it will come back to)
      const C = D.space.center, R = D.space.radius - 0.9, cx = gx - C[0], cz = gz - C[2], cl = Math.hypot(cx, cz);
      if (cl > R) { gx = C[0] + (cx / cl) * R; gz = C[2] + (cz / cl) * R; }
      // (and a step back from any edge: the floor a metre further out from the middle stands too)
      const edgy = (x: number, z: number) => {
        const ox = x - C[0], oz = z - C[2], ol = Math.hypot(ox, oz) || 1;
        return groundOf(D, x, z, me.y, 2.5) < D.yKill + 0.6 || groundOf(D, x + (ox / ol) * 1.1, z + (oz / ol) * 1.1, me.y, 2.5) < D.yKill + 0.6;
      };
      for (let k = 0; k < 8 && edgy(gx, gz); k++) { gx += (C[0] - gx) * 0.25; gz += (C[2] - gz) * 0.25; }
      gy = groundOf(D, gx, gz, me.y, 2.5);
      // the hazard's places and the ice steps: a step to run up onto, the hum's column, a stone out of the water
      const place = otherOut ? null : this.placeFor(S, me, o, D, gx, gz);
      if (place) { this.goal = { ...place, s: 0 }; return; }
      // now and then: up onto something (a stump, the altar, a slab), or a solid to kick off (showy most)
      if (!otherOut && why === 'close' && this.rng.chance(0.04 + K.showy * 0.15)) {
        const high = this.highPlace(me, D);
        if (high) { [gx, gy, gz] = high; why = 'climb'; }
      } else if (this.rng.chance(K.showy * 0.2) && ad > 2) {
        const w = this.wallNear3(me, D, 4.5);
        if (w) { gx = w[0]; gz = w[2]; why = 'wall kick'; }
      }
    }
    this.goal = { x: gx, y: gy, z: gz, s: 0, why };
  }

  /** a place within a few metres that stands 0.6 to 1.9 m above here, clear to stand on */
  private highPlace(me: Snap, D: DuelSight): [number, number, number] | null {
    let best: [number, number, number] | null = null, bh = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = 1.2 + (i % 3) * 0.9, x = me.x + Math.cos(a) * r, z = me.z + Math.sin(a) * r, y = groundOf(D, x, z, me.y, 1.9);
      const h = y - me.y;
      if (h < 0.6 || h > 1.9 || D.solids.some((s) => distTo(s, [x, y + 1, z]) < 0.4)) continue;
      const C = D.space.center;
      if (Math.hypot(x - C[0], z - C[2]) > D.space.radius - 0.8) continue;
      if (h > bh) { bh = h; best = [x, y, z]; }
    }
    return best;
  }
  /** a solid tall enough to kick off within reach (its middle, at chest height: running at it meets its face), or null */
  private wallNear3(me: Snap, D: DuelSight, reach: number): [number, number, number] | null {
    let best: [number, number, number] | null = null, bd = reach;
    for (const s of D.solids) {
      const c: [number, number, number] = s.kind === 'capsule' ? [(s.a[0] + s.b[0]) / 2, me.y + 1.6, (s.a[2] + s.b[2]) / 2] : [s.c[0], me.y + 1.6, s.c[2]];
      if (distTo(s, c) >= 0) continue;             // (not as tall as a body's chest above here: a step, not a wall)
      const d = distTo(s, [me.x, me.y + 1, me.z]);
      if (d > 0.4 && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // ---------------------------------------------------------------- free: the legs
  private legsFree(S: Sight, c: Character, me: Snap, D: DuelSight | null, yKill: number, it: Intent, t: number) {
    const g = this.goal;
    // (a small top to land on, an ice step or a stone: in the air over it the thumbs settle at once, and it is aimed
    // at more closely)
    const small = g.why === 'step' || g.why === 'stone';
    const minHold = small && !c.grounded ? 0 : 0.13 + (1 - this.skill) * 0.08;
    const ground = (x: number, z: number, up = 0.4) => (D ? groundOf(D, x, z, me.y, up) : 0);
    const solids = D?.solids ?? [];
    if (c.grounded) this.airUsed = false;
    let dx = g.x - me.x, dz = g.z - me.z;
    const dist = Math.hypot(dx, dz);
    let want: [number, number] = dist < (small && !c.grounded ? 0.25 : 0.35) ? [0, 0] : [dx / dist, dz / dist];
    // a strike planned: stand to throw it (a body that stands turns to face the other; one that runs faces its way)
    if (this.pending && MOVES[this.pending.move]?.attack && c.grounded) want = [0, 0];
    // a pillar in the way: round it (a stump or a slab low enough is jumped onto instead)
    if (want[0] || want[1]) {
      const blocked = (u: [number, number]) => {
        for (const r of [0.45, 0.9, 1.35]) {
          const x = me.x + u[0] * r, z = me.z + u[1] * r, top = ground(x, z, 3.2);
          if (top - me.y > 2.1 || solids.some((s) => distTo(s, [x, Math.max(me.y, top) + 1.0, z]) < 0.35)) return true;
        }
        return false;
      };
      if (g.why !== 'wall kick' && blocked(want)) {
        let found = false;
        for (const a of [0.45, 0.9, 1.4, 2.0]) {
          for (const sd of [this.avoidSide, -this.avoidSide]) {
            const ca = Math.cos(a * sd), sa = Math.sin(a * sd), u: [number, number] = [want[0] * ca - want[1] * sa, want[0] * sa + want[1] * ca];
            if (!blocked(u)) { want = u; found = true; this.avoidSide = sd; break; }
          }
          if (found) break;
        }
      }
    }
    if (c.grounded) {
      const ax = me.x + want[0] * 0.55, az = me.z + want[1] * 0.55, ahead = ground(ax, az, 3.2);
      // up: a stump, the altar, a slab: jump onto it (the air jump at the top for a tall one)
      if ((want[0] || want[1]) && ahead > me.y + 0.3 && ahead - me.y < 3.2 && t >= this.jumpUntil + 0.05) {
        const h = ahead - me.y;
        this.jumpNow(t, holdFor(Math.min(h + 0.35, jumpHeight(10, c.phys) + 0.05), c.phys));
        this.airJumpAt = h + 0.3 > jumpHeight(10, c.phys) ? t + 0.36 : -1;
        this.count('jump');
      }
      // a pit ahead: a gap it can clear it jumps, running; else it doesn't go
      if ((want[0] || want[1]) && ahead < yKill + 0.6) {
        let land = -1;
        for (let r = 0.9; r <= 3.4; r += 0.3) { const y = ground(me.x + want[0] * r, me.z + want[1] * r, 1.6); if (y > yKill + 0.6 && y < me.y + 1.6) { land = r; break; } }
        const edge = ground(me.x + want[0] * 0.25, me.z + want[1] * 0.25) < yKill + 0.6;
        if (land > 0 && edge && t >= this.jumpUntil + 0.05) {
          this.jumpNow(t, holdFor(1.4, c.phys)); this.airJumpAt = land > 2.2 ? t + 0.34 : -1; this.count('jump');
        } else if (land < 0) want = [0, 0];
      }
      // showy: a flip now and then when nothing presses
      if (this.style === 'flyer' && !this.pending && t - this.lastPress > 0.9 && t >= this.jumpUntil + 0.1 && this.rng.chance(0.006 * this.K.showy * 60 * S.dt)) {
        this.jumpNow(t, holdFor(2.2, c.phys)); this.flipT = t + 0.3; this.count('jump');
      }
    } else {
      // in the air: over the void, back toward floor and the air jump; the planned air jump at the top; a wall kick
      const over = ground(me.x, me.z) < yKill + 0.6;
      if (over) {
        let best = Infinity, bx = me.x, bz = me.z;
        for (let i = 0; i < 16; i++) for (const r of [0.8, 1.6, 2.6]) {
          const a = (i / 16) * Math.PI * 2, x = me.x + Math.cos(a) * r, z = me.z + Math.sin(a) * r, y = ground(x, z, 2.5);
          if (y > yKill + 0.6 && y < me.y + 2.5 && r < best) { best = r; bx = x; bz = z; }
        }
        const l = Math.hypot(bx - me.x, bz - me.z);
        if (l > 1e-3) want = [(bx - me.x) / l, (bz - me.z) / l];
        if (me.vy < 0.5) { this.airJumpAt = -1; this.pressAirJump(t); }
      } else if (this.airJumpAt > 0 && t >= this.airJumpAt && me.vy < 1.2) { this.airJumpAt = -1; this.pressAirJump(t); }
      // a wall to kick off: the body's own reading (Character.wallKick and wallNormal, the duel's profile: what a jump
      // means now), or, on the jogo's profile, a solid it falls against
      let away: [number, number] | null = null;
      if (c.phys.wallSlide) { const n = c.wallNormal; if (c.wallKick && n) away = n; }
      else {
        const touching = solids.find((s) => distTo(s, [me.x, me.y + 1.0, me.z]) < c.phys.halfW + 0.35);
        if (touching) {
          const p: [number, number, number] = [me.x, me.y + 1, me.z], e = 0.05;
          const gx = distTo(touching, [p[0] + e, p[1], p[2]]) - distTo(touching, [p[0] - e, p[1], p[2]]);
          const gz = distTo(touching, [p[0], p[1], p[2] + e]) - distTo(touching, [p[0], p[1], p[2] - e]);
          const gl = Math.hypot(gx, gz) || 1;
          away = [gx / gl, gz / gl];
        }
      }
      // (only toward somewhere to land: a kick off a rock out over the pool's water, or off a ledge out over a drop,
      // is a fall; with nothing that way the body slides down the face instead)
      const lands = (k: number) => !!away && ground(me.x + away[0] * k, me.z + away[1] * k, 2.5) > yKill + 0.6;
      if (away && !(lands(1.6) || lands(2.6) || lands(3.6))) away = null;
      if (away && me.vy < 1.5 && t >= this.jumpUntil + 0.12) {
        // (sliding: hold into it a moment, then kick off away from it)
        if (this.rng.chance(this.style === 'flyer' || g.why === 'wall kick' ? 0.6 : 0.2 + 0.4 * this.skill)) {
          this.jumpNow(t, 0.3);
          want = away;
          this.airUsed = false;
          this.count('wall-jump');
          if (g.why === 'wall kick') this.goal = { ...g, why: 'close' };
        }
      }
      if (this.flipT > 0 && t >= this.flipT && Math.abs(me.vy) < 2 && canStart(c, 'spin')) {
        this.flipT = -1; this.pending = { move: 'spin', at: t, dir: [Math.sin(c.yaw), Math.cos(c.yaw)], why: 'flip' };
      }
    }
    this.dash(c, dist, it, t, want, ground(me.x, me.z) < yKill + 0.6);
    // the thumbs: eight directions, held a while once moved
    const q = makeIntent();
    if (want[0] || want[1]) stickFor(c, want[0], want[1], 1, q);
    const sx = Math.abs(q.moveX) > 0.38 ? sgn(q.moveX) : 0, sz = Math.abs(q.moveZ) > 0.38 ? sgn(q.moveZ) : 0;
    if ((sx !== this.stick[0] || sz !== this.stick[1]) && (t - this.stickSince >= minHold || this.stickSince < 0)) { this.stick = [sx, sz]; this.stickSince = t; }
    it.moveX = this.stick[0]; it.moveZ = this.stick[1];
    this.thumbs(it, t);
  }

  // ---------------------------------------------------------------- locked: deciding where to be, and the legs
  private decideLocked(_S: Sight, c: Character, me: Snap, o: Snap, surf: Surf[], otherOut: boolean, yKill: number) {
    const K = this.K, pl = c.plane!, lim = pl.halfWidth - c.phys.wallMargin - 0.1;
    const ad = Math.abs(o.s - me.s);
    let want = K.want, why = 'close';
    if (otherOut) { want = 2.2; why = 'wait for it'; }
    else if (this.style === 'flyer' && ad < 1.4) { want = 2.4; why = 'run-up'; }
    let side = sgn(me.s - o.s);
    if (Math.abs(o.s + side * want) > lim) side = -side;
    let gs = clamp(o.s + side * want, -lim, lim), gy = o.y;
    const below = this.under(surf, o.s, o.y + 0.1);
    if (!below || below.y < yKill + 0.5) {
      const ref = this.under(surf, me.s, me.y + 0.1);
      if (ref) { gs = clamp(gs, ref.x0 + 0.4, ref.x1 - 0.4); gy = ref.y; }
    } else gy = below.y;
    if ((this.style === 'flyer' || this.rng.chance(K.showy * 0.3)) && ad > 2.2 && this.rng.chance(K.showy * 0.5)) {
      const wall = sgn(me.s) * lim;
      if (Math.abs(wall - me.s) < 3.5) { gs = wall; why = 'wall kick'; }
    }
    this.goal = { x: 0, y: gy, z: 0, s: gs, why };
  }

  private legsLocked(S: Sight, c: Character, me: Snap, surf: Surf[], yKill: number, it: Intent, t: number) {
    const pl = c.plane!, lim = pl.halfWidth - c.phys.wallMargin;
    const g = this.goal;
    const here = c.grounded ? surf.find((q) => q.id === c.support?.id) ?? this.under(surf, me.s, me.y + 0.1) : null;
    let target = this.under(surf, g.s, g.y + 0.2) ?? here;
    const minHold = 0.08 + (1 - this.skill) * 0.08;
    let want = this.stick[0];
    const ds = g.s - me.s;
    if (Math.abs(ds) > 0.45) want = sgn(ds);
    else if (Math.abs(ds) < 0.2) want = 0;
    if (c.grounded) this.airUsed = false;
    // a solid block between here and there (the temple's altar, a pillar): over it
    if (c.grounded && here) {
      const dir = sgn(g.s - me.s);
      let wall: Surf | null = null;
      for (const q of surf) {
        if (!q.solid || q.ground || q === here || q.y < here.y + 0.25 || q.y - q.thick > here.y + 1.4) continue;
        const face = dir > 0 ? q.x0 : q.x1;
        if ((face - me.s) * dir > -0.3 && (face - g.s) * dir < 0 && (!wall || Math.abs(face - me.s) < Math.abs((dir > 0 ? wall.x0 : wall.x1) - me.s))) wall = q;
      }
      if (wall && (!target || target.y < wall.y)) target = wall;
    }
    if (c.grounded && here) {
      if (target && target !== here && target.y > here.y + 0.35) {
        const h = target.y - here.y;
        let take = target.solid && !target.ground ? (me.s < target.x0 ? target.x0 - 0.75 : me.s > target.x1 ? target.x1 + 0.75 : me.s) : clamp(me.s, target.x0 + 0.25, target.x1 - 0.25);
        take = clamp(take, here.x0 + 0.15, here.x1 - 0.15);
        const toward = sgn(clamp(g.s, target.x0 + 0.3, target.x1 - 0.3) - me.s);
        if (Math.abs(take - me.s) < 0.35 && t >= this.jumpUntil + 0.05) {
          this.jumpNow(t, holdFor(Math.min(h + 0.35, jumpHeight(10, c.phys) + 0.05), c.phys));
          this.airJumpAt = h + 0.3 > jumpHeight(10, c.phys) ? t + 0.36 : -1;
          this.count('jump');
          want = toward; this.stick = [toward, 0]; this.stickSince = t;
        } else if (Math.abs(take - me.s) >= 0.35) want = sgn(take - me.s);
      } else if (target && target !== here && target.y < here.y - 0.3 && !here.solid && g.s >= here.x0 && g.s <= here.x1) {
        if (t >= this.dropUntil + 0.4) { this.dropUntil = t + 0.18; this.count('drop'); }
      } else if (target && target !== here && Math.abs(ds) > 0.5 && (g.s > here.x1 || g.s < here.x0)) {
        const edge = ds > 0 ? here.x1 : here.x0;
        const gap = ds > 0 ? target.x0 - here.x1 : here.x0 - target.x1;
        if (gap > 0.05 && Math.abs(edge - me.s) < 0.55 && t >= this.jumpUntil + 0.05) {
          this.jumpNow(t, holdFor(Math.max(0.6, target.y - here.y + 0.6), c.phys)); this.count('jump'); want = sgn(ds);
          this.airJumpAt = gap > 1.4 || target.y - here.y > 1.6 ? t + 0.34 : -1;
        }
      }
      if (want !== 0) {
        const ahead = me.s + want * 0.45;
        if (ahead > here.x1 + 0.05 || ahead < here.x0 - 0.05) {
          const land = this.under(surf, ahead, here.y - 0.1);
          if ((!land || land.y < yKill + 0.6) && t > this.jumpPressAt + 0.05 && this.jumpUntil < t) want = 0;
        }
      }
      if (this.style === 'flyer' && !this.pending && t - this.lastPress > 0.9 && t >= this.jumpUntil + 0.1 && this.rng.chance(0.006 * this.K.showy * 60 * S.dt)) {
        this.jumpNow(t, holdFor(2.2, c.phys)); this.flipT = t + 0.3; this.count('jump');
      }
    } else if (!c.grounded) {
      const landing = this.under(surf, me.s, me.y);
      const void_ = !landing || landing.y < yKill + 0.5;
      const aimS = target ? clamp(g.s, target.x0 + 0.2, target.x1 - 0.2) : g.s;
      if (Math.abs(aimS - me.s) > 0.25) want = sgn(aimS - me.s);
      if (void_) {
        let best = Infinity, bs = me.s;
        for (const q of surf) { if (q.y > me.y + 2.5 || q.y < yKill + 0.5) continue; const e = clamp(me.s, q.x0 + 0.3, q.x1 - 0.3), dd = Math.abs(e - me.s); if (dd < best) { best = dd; bs = e; } }
        want = sgn(bs - me.s);
        if (me.vy < 0.5) { this.airJumpAt = -1; this.pressAirJump(t); }
      } else if (this.airJumpAt > 0 && t >= this.airJumpAt && me.vy < 1.2) { this.airJumpAt = -1; this.pressAirJump(t); }
      const wk = c.phys.wallSlide ? c.wallKick : 0;
      const nearWall = wk ? { into: wk } : c.phys.wallSlide ? null : this.wallNear(pl, me.s, me.y - pl.origin[1], c.phys);
      if (nearWall && me.vy < 0.8 && t >= this.jumpUntil + 0.12 && (want === nearWall.into || g.why === 'wall kick' || void_)) {
        want = nearWall.into;
        if (this.rng.chance(this.style === 'flyer' ? 0.5 : 0.25 + 0.5 * this.skill)) {
          this.jumpNow(t, 0.3); this.airUsed = false; this.count('wall-jump');
          want = -nearWall.into; this.stick = [want, 0]; this.stickSince = t;
          if (g.why === 'wall kick') this.goal = { ...g, s: clamp(-sgn(me.s) * (lim - 0.1), -lim, lim) };
        }
      }
      if (this.flipT > 0 && t >= this.flipT && Math.abs(me.vy) < 2 && canStart(c, 'spin')) {
        this.flipT = -1; this.pending = { move: 'spin', at: t, dir: [pl.right[0] * c.dir, pl.right[2] * c.dir], why: 'flip' };
      }
      if (!void_ && target && me.vy < 0 && Math.abs(aimS - me.s) < 0.3 && me.y > target.y + 0.8 && this.jumpUntil < t) this.down = t + 0.1;
    }
    this.dash(c, Math.abs(ds), it, t, [pl.right[0] * want, pl.right[2] * want]);
    if (want !== this.stick[0] && (t - this.stickSince >= minHold || this.stickSince < 0)) { this.stick = [want, 0]; this.stickSince = t; }
    it.moveX = this.stick[0];
    this.thumbs(it, t);
  }

  /** the jump held for its height, a drop or a fast fall held down */
  private thumbs(it: Intent, t: number) {
    if (Math.abs(this.jumpPressAt - t) < 1e-9) it.jump = true;
    it.jumpHeld = t <= this.jumpUntil;
    if (t <= this.dropUntil || t <= this.down) it.moveY = -1;
  }

  /** the dash, where the body has one (Intent.dash, the movement work's): to close a long gap on the ground */
  /** the dash (the body's, Intent.dash, on the duel's profile): to close a long gap on the ground, to get away when
   *  crowded (evasive), and back to the floor from over the void when the air jump is spent */
  private dash(c: Character, dist: number, it: Intent, t: number, want: [number, number], void_ = false) {
    if (!this.hadDash || !c.phys.dash || c.dashReady < 0.99 || this.pending || !(want[0] || want[1])) return;
    const why = void_ && this.airUsed && !c.grounded ? 'recover'
      : t - this.lastPress < 0.6 ? null
      : dist > 3 && c.grounded && this.style !== 'base' && this.rng.chance(0.03) ? 'close'
      : this.style === 'flyer' && this.goal.why === 'run-up' && c.grounded && this.rng.chance(0.05) ? 'away'
      : null;
    if (!why) return;
    it.dash = true; this.lastPress = t; this.count(`dash-${why}`);
  }

  private jumpNow(t: number, hold: number) { this.jumpPressAt = t; this.jumpUntil = t + hold; }
  private pressAirJump(t: number) {
    if (this.airUsed) return;
    this.airUsed = true;
    this.jumpPressAt = t; this.jumpUntil = t + 0.3; this.count('air-jump');
  }

  /** a wall of the locked plane within reach of the body at plane (s, y): the plane's ends or its walls */
  private wallNear(pl: StagePlane, s: number, y: number, P: Phys): { into: number } | null {
    const lim = pl.halfWidth - P.wallMargin;
    if (s > lim - 0.3) return { into: 1 };
    if (s < -lim + 0.3) return { into: -1 };
    for (const w of ((pl as StagePlane & { walls?: { s: number; side: number; y0: number; y1: number; climb?: boolean }[] }).walls ?? [])) {
      if (w.climb === false || y + 1.2 < w.y0 || y > w.y1) continue;
      const gap = (s - w.s) * w.side;
      if (gap > 0 && gap < P.halfW + 0.3) return { into: -w.side };
    }
    return null;
  }

  // ---------------------------------------------------------------- fighting
  /** my facing, horizontal unit (along the plane when locked) */
  private fwd(c: Character): [number, number] {
    return c.plane ? [c.plane.right[0] * c.dir, c.plane.right[2] * c.dir] : [Math.sin(c.yaw), Math.cos(c.yaw)];
  }

  /** when to press so the move lands on the next 8th-note line (a good player waits for it when it comes soon) */
  private onBeatAt(S: Sight, maxWait: number) {
    const t = S.t;
    let at = t;
    if (this.rng.chance(this.K.beatWait)) {
      const spb = 60 / S.bpm, b = S.beat, line = Math.ceil(b * 2 - 1e-6) / 2, wait = (line - b) * spb;
      if (wait < maxWait) at = t + wait - S.dt * 0.75;
    }
    return Math.max(t, at + this.rng.normal() * this.K.beatSd * 0.5);
  }

  /** the dance between exchanges: on the beat, a flourish (an aú, a macaco, a spin, the pirouette) */
  private dance(S: Sight, c: Character, me: Snap, o: Snap, otherOut: boolean) {
    const t = S.t, dist = Math.hypot(o.x - me.x, o.z - me.z) || Math.abs(o.s - me.s);
    if (!c.grounded || c.move || t - this.lastPress < 1.1 - this.K.dance * 0.5 || t < this.jumpUntil + 0.2) return;
    if (!otherOut && dist < 2.3) return;
    if (!this.rng.chance(this.K.dance * 0.03 * 60 * S.dt)) return;
    let move: string = this.rng.pick(FLOURISHES);
    if (!MOVES[move]) move = 'spin';
    // (an aú travels: round the other, never toward a pit; the others turn on the spot)
    const f = this.fwd(c), side: [number, number] = c.plane ? f : [-f[1] * this.avoidSide, f[0] * this.avoidSide];
    const D = this.duel?.();
    if (move === 'au' && D && groundOf(D, me.x + side[0] * 1.5, me.z + side[1] * 1.5, me.y) < D.yKill + 0.6) move = 'macaco';
    this.pending = { move, at: this.onBeatAt(S, 0.3), dir: side, why: `dance ${move}` };
  }

  // ---------------------------------------------------------------- the contact
  /** the nearest of my hands to the other's hands, waist and ankles (m) */
  private reachTo(c: Character, O: Character) {
    const P = O.pose, mine = [J.LW, J.RW].map((j) => [c.pose[3 * j], c.pose[3 * j + 1], c.pose[3 * j + 2]]);
    const waist = [(P[3 * J.LH] + P[3 * J.RH]) / 2, (P[3 * J.LH + 1] + P[3 * J.RH + 1]) / 2, (P[3 * J.LH + 2] + P[3 * J.RH + 2]) / 2];
    const theirs = [J.LW, J.RW, J.LA, J.RA].map((j) => [P[3 * j], P[3 * j + 1], P[3 * j + 2]]).concat([waist]);
    let best = Infinity;
    for (const a of mine) for (const b of theirs) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    return best;
  }

  /** where a fling should put the other: somewhere to land a little above it (a stone, a ledge), a wall to kick off,
   *  or up and in from the edges (the space's middle) */
  private flingTarget(c: Character, O: Character, D: DuelSight | null): [number, number] {
    const at: Snap = { ...this.snap(O, 0) };
    if (D && !c.plane) {
      const hi = this.highPlace({ ...at, y: at.y - 0.5 }, D);
      if (hi) return [hi[0] - O.root[0], hi[2] - O.root[2]];
      if (this.rng.chance(this.K.showy)) { const w = this.wallNear3(at, D, 5); if (w) return [w[0] - O.root[0], w[2] - O.root[2]]; }
      const C = D.space.center;
      return [C[0] - O.root[0], C[2] - O.root[2]];
    }
    // locked: in toward the stage's middle, or onto a ledge
    const pl = c.plane;
    if (pl) { const s = -Math.sign(O.s) || 1; return [pl.right[0] * s, pl.right[2] * s]; }
    return [0, 1];
  }

  /** the contact: the catch, the pump and the fling while holding, the lift or the counter while held, the leap at the
   *  other to be caught */
  private swingSense = 1;
  private partner(S: Sight, c: Character, O: Character, me: Snap, o: Snap, D: DuelSight | null, it: Intent, holding: boolean, held: boolean) {
    const t = S.t, K = this.K, pl = c.plane, L = D?.link ?? null;
    if (holding && L) {
      const hold = L.age;
      this.grabUntil = t + 0.05;
      // the pump: the stick round the contact, the way the held body already goes round (or the brain's sense)
      const px = O.root[0] - c.root[0], pz = O.root[2] - c.root[2];
      let tx: number, tz: number;
      if (pl) {
        const vs = O.v[0] * pl.right[0] + O.v[2] * pl.right[2], side = px * pl.right[0] + pz * pl.right[2];
        const sg = Math.abs(vs) > 0.5 ? Math.sign(vs) : -(Math.sign(side) || 1);
        tx = pl.right[0] * sg; tz = pl.right[2] * sg;
      } else {
        const l = Math.hypot(px, pz) || 1;
        tx = (-pz / l) * this.swingSense; tz = (px / l) * this.swingSense;
        if (O.v[0] * tx + O.v[2] * tz < -1.2) { this.swingSense = -this.swingSense; tx = -tx; tz = -tz; }
      }
      // the fling: once the hold has lasted, when the swing carries the other toward where it should land (or soon after
      // regardless); the stick aimed there
      const aim = this.flingTarget(c, O, D), al = Math.hypot(aim[0], aim[1]) || 1;
      const vl = Math.hypot(O.v[0], O.v[2]) || 1, toward = (O.v[0] * aim[0] + O.v[2] * aim[1]) / (vl * al);
      if (hold > this.holdFor && (toward > 0.55 - 0.3 * (1 - this.skill) || hold > this.holdFor + 0.9)) {
        this.grabUntil = -1;
        stickFor(c, aim[0] / al, aim[1] / al, 1, it);
        this.count('fling'); this.why = 'fling';
        return;
      }
      // pumped on the beat (a good player only near the 8th lines; a weaker one all the time)
      const ph = Math.abs(S.beat * 2 - Math.round(S.beat * 2));
      const pump = this.rng.chance(this.skill) ? ph < 0.22 : true;
      if (pump) stickFor(c, tx, tz, 1, it); else { it.moveX = 0; it.moveZ = 0; }
      this.why = 'swing';
      return;
    }
    if (held && L) {
      this.grabUntil = -1;
      // (held, a jump or a dodge is the contact's: the lift or the counter, chosen here, not the legs' habits)
      it.jump = false; it.dodge = false; this.jumpUntil = -1;
      const hold = L.age, above = c.root[1] > O.root[1] - 0.1 && !c.grounded;
      const onBeatNow = Math.abs(S.beat * 2 - Math.round(S.beat * 2)) < 0.25;
      if (above && hold > 0.8 && (onBeatNow || !this.rng.chance(this.skill)) && this.rng.chance(K.leap * 0.015 * 60 * S.dt)) { it.jump = true; this.jumpNow(t, 0.5); this.count('lift'); this.why = 'lift'; }
      else if (hold > 1.6 && this.rng.chance((0.3 + K.showy) * 0.02 * 60 * S.dt)) {
        it.dodge = true; this.count('counter'); this.why = 'counter';
        if (D && !pl) { const C = D.space.center; stickFor(c, C[0] - c.root[0], C[2] - c.root[2], 1, it); }
      }
      return;
    }
    // not joined: a catch when a hand comes within reach of the other's hand, waist or ankle (out of the air most)
    const d = this.reachTo(c, O), reach = (c.grounded && O.grounded ? 0.55 : 0.75) + 0.15;
    if (d < reach && t > this.grabUntil + 0.2 && this.rng.chance((K.catchP * K.seek + (O.grounded ? 0 : 0.25)) * 0.35 * 60 * S.dt)) {
      this.grabPress = true; this.grabUntil = t + 0.3; this.count(O.grounded ? 'grab' : 'grab-air'); this.why = 'grab';
    }
    // the leap: run at the other and jump at its hands, to be caught (or to land on its shoulders)
    const dist = pl ? Math.abs(o.s - me.s) : Math.hypot(o.x - me.x, o.z - me.z);
    if (c.grounded && dist > 1.3 && dist < 3.4 && t >= this.jumpUntil + 0.3 && t - this.leapT > 1.4 && this.rng.chance(K.leap * 0.05 * 60 * S.dt)) {
      this.leapT = t; this.jumpNow(t, holdFor(1.3 + this.rng.range(0, 0.6), c.phys));
      this.goal = { x: o.x, y: o.y, z: o.z, s: o.s, why: 'leap' }; this.nextDecide = t + 0.8;
      this.count('leap'); this.why = 'leap';
    }
  }

  // ---------------------------------------------------------------- the powers
  /** a power when it makes contact happen (each power's moment below), at most one every few seconds (sooner in the
   *  power form, when they are free); the form a moment after the bar fills. Each matter's two powers about as often
   *  as each other (the one cast less lately is reached for more), and the reactions set up: water rolls its wave to a
   *  fire partner, ice sets a step for a water partner's lash or a fire partner's flare, and the other answers at once
   *  (the geyser, the bar, the melt), the answer not waiting its turn */
  private bend(S: Sight, c: Character, me: Snap, o: Snap, D: DuelSight, it: Intent, linked: boolean) {
    const P = D.powers?.[S.seat];
    if (!P) return;
    const t = S.t, R = this.prng;
    if (P.flow >= 0.999 && P.form <= 0) {
      if (this.formAt < 0) this.formAt = t + R.range(0.3, 1.8);
      if (t >= this.formAt && !linked) { it.form = true; this.formAt = -1; this.count('form'); }
    } else this.formAt = -1;
    const dx = o.x - me.x, dz = o.z - me.z, dist = c.plane ? Math.abs(o.s - me.s) : Math.hypot(dx, dz), dy = o.y - me.y;
    const falling = !c.grounded && me.vy < 0 && groundOf(D, me.x, me.z, me.y) < D.yKill + 0.6;
    const toward: [number, number] = c.plane ? [c.plane.right[0] * sgn(o.s - me.s), c.plane.right[2] * sgn(o.s - me.s)] : dist > 1e-3 ? [dx / dist, dz / dist] : [Math.sin(c.yaw), Math.cos(c.yaw)];
    const oAir = !o.grounded, flown = D.flown === 1 - S.seat;
    const overVoid = groundOf(D, me.x, me.z, me.y) < D.yKill + 0.6;
    // the other's effects nearby, for a reaction: its wave to set alight (a geyser), its step to melt or to lash
    const theirs = (kind: string) => {
      let best: { at: [number, number, number]; d: number } | null = null;
      for (const b of D.bends ?? []) if (b.kind === kind && b.seat !== S.seat) { const d = Math.hypot(b.at[0] - me.x, b.at[2] - me.z); if (!best || d < best.d) best = { at: b.at, d }; }
      return best;
    };
    const wave = theirs('wave'), step = theirs('step'), them = D.powers?.[1 - S.seat], other = them?.matter;
    /** the other's power ready to answer a setup (its flare or ribbon, its whip) */
    const answers = (...ids: string[]) => !!them && them.ids.some((id, i) => ids.includes(id) && them.ready[i]);
    const to = (p: [number, number, number]): [number, number] => { const x = p[0] - me.x, z = p[2] - me.z, l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
    // (a reaction's answer and a save from the void don't wait their turn)
    const answer = (wave && wave.d < 5) || (step && step.d < 6.5);
    if (linked || (t < this.nextCast && !falling && !answer)) return;
    /** floor all along a way from here (a dash that carries the body: none over a drop or the water) */
    const floorAlong = (u: [number, number], len: number) => {
      for (let r = 0.8; r <= len; r += 0.8) if (groundOf(D, me.x + u[0] * r, me.z + u[1] * r, me.y, 0.6) < me.y - 0.6) return false;
      return true;
    };
    let best: { slot: 0 | 1; keen: number; aim: [number, number] | null; urgent: boolean } | null = null;
    for (const slot of [0, 1] as const) {
      if (!P.ready[slot]) continue;
      // the moment for it (how keen, a second), and which way the stick points: at the other, or none (null)
      let keen = 0, aim: [number, number] | null = toward, urgent = false;
      switch (P.ids[slot]) {
        case 'flare':
          if (wave && wave.d < 2.2) { keen = 14; aim = wave.d > 0.5 ? to(wave.at) : null; urgent = true; }
          else if (step && step.d < 1.4 && c.grounded && step.at[1] - me.y < 2.2) { keen = 8; aim = null; urgent = true; }
          else keen = c.grounded && dist < 2.0 && Math.abs(dy) < 0.8 ? 0.6 : oAir && dist < 3 && dy > 0.5 && dy < 3.5 ? 1.2 : 0;
          break;
        case 'ribbon':
          if (wave && wave.d > 0.8 && wave.d < 5 && floorAlong(to(wave.at), Math.min(4, wave.d))) { keen = 10; aim = to(wave.at); urgent = true; }
          else if (step && step.d > 1 && step.d < 4 && c.grounded && step.at[1] - me.y < 2.2 && floorAlong(to(step.at), step.d)) { keen = 3; aim = to(step.at); urgent = true; }
          // (a dash to the other leaving a rising ribbon behind it: the other, crossing it, rides up into the catch;
          // or the other in the air above: under it, the ribbon lifts this body to it)
          else keen = c.grounded && dist > 2.5 && dist < 7 && floorAlong(toward, 4) ? 0.8 : oAir && dy > 1 && dist < 3 && floorAlong(toward, dist) ? 1.0 : 0;
          break;
        case 'whip':
          if (step && step.d > 1.2 && step.d < 6.5 && step.at[1] > me.y + 0.3 && step.at[1] < me.y + 4.5) { keen = 10; aim = to(step.at); urgent = true; }
          else keen = dist > 2.2 && dist < 6 ? (oAir ? 1.4 : dist > 3.2 ? 0.35 : 0) : 0;
          break;
        case 'wave':
          // (to a fire partner whose flare or ribbon is ready: it sets the wave alight, the geyser)
          if (other === 'fire' && answers('flare', 'ribbon') && c.grounded && dist > 1.5 && dist < 5.5) keen = 1.6;
          else keen = c.grounded && o.grounded && dist > 1.5 && dist < 6 ? 0.6 : c.grounded && oAir && dist < 4 ? 0.4 : 0;
          break;
        case 'step':
          if (oAir && o.vy < -1.5 && dist < 4.5 && o.y - groundOf(D, o.x, o.z, o.y) > 1.2) keen = 1.4;
          else if (!c.grounded && me.vy < -2 && (overVoid || this.style === 'flyer')) { keen = overVoid ? 3 : 0.6; aim = null; }
          // (a step set between the two for a water partner's lash, the bar, or a fire partner's flare, the melt; or one
          // to climb: a ledge the body runs up onto)
          else if (other === 'water' && answers('whip') && c.grounded && dist > 2.5 && dist < 5.5) keen = 1.2;
          else if (other === 'fire' && answers('flare', 'ribbon') && c.grounded && dist > 1.5 && dist < 4) keen = 0.8;
          else if (c.grounded && dist > 2 && dist < 6) keen = 0.35;
          break;
        case 'slide': keen = c.grounded && dist > 3 && dist < 9 ? 0.7 : 0; break;
        case 'blink': keen = dist > 2.5 && dist < 7 ? 0.5 : 0; break;
        case 'arc': keen = dist > 2.5 && dist < 7.5 ? (oAir || !c.grounded ? 1.2 : 0.6) : 0; break;
        case 'pillar':
          if (o.grounded && c.grounded && dist > 1.2 && dist < 4) keen = 0.6;
          else if (oAir && dy > 1.5 && dist < 2 && c.grounded) { keen = 0.6; aim = null; }
          break;
        case 'prism':
          if (flown && dist > 2 && dist < 7) keen = 2;
          // (the other flying fast on its own, a leap, a launch, a wall kick: a facet on its path turns it here)
          else if (oAir && Math.hypot(o.vx, o.vy, o.vz) > 4.5 && dist > 2 && dist < 6.5) keen = 1.0;
          else if (oAir && dist > 2.5 && dist < 6) keen = 0.3;
          break;
      }
      // over the void and falling: a power that saves it, as a person would reach for one (a rocket jump, a lash or a
      // tether to the other, a blink toward it; the step under its feet is above)
      const id = P.ids[slot];
      if (overVoid && !c.grounded && me.vy < 0 && (id === 'flare' || id === 'blink' || ((id === 'whip' || id === 'arc') && dist < 6))) { keen = Math.max(keen, 4); aim = toward; urgent = true; }
      // (in the power form they are free: keener, and toward the other whatever the moment, from close enough)
      if (P.form > 0) keen = Math.max(keen * 3, dist < 7 ? 0.8 : 0);
      // the two powers about as often as each other: the one cast more lately waits, the other is reached for
      const lead = this.castN[slot] - this.castN[1 - slot];
      if (!urgent) keen *= lead >= 2 ? 0.25 : lead >= 1 ? 0.5 : lead <= -2 ? 2.2 : lead <= -1 ? 1.5 : 1;
      if (keen > 0 && (!best || keen > best.keen)) best = { slot, keen, aim, urgent };
    }
    if (!best || (t < this.nextCast && !best.urgent) || !R.chance(best.keen * (0.5 + 0.5 * this.skill) * S.dt)) return;
    const { slot, aim } = best;
    if (aim) stickFor(c, aim[0], aim[1], 1, it); else { it.moveX = 0; it.moveZ = 0; if (!c.plane) it.moveY = 0; }
    if (slot === 0) it.power1 = true; else it.power2 = true;
    this.castN[slot]++;
    this.count(`power-${P.ids[slot]}`); this.why = `power ${P.ids[slot]}`;
    this.nextCast = t + (P.form > 0 ? R.range(0.8, 1.6) : R.range(4.5, 9) + (1 - this.skill) * 3);
    // an ice step set on the ground ahead: a ledge to run up onto, now
    if (P.ids[slot] === 'step' && c.grounded && aim && !c.plane) this.stepGoal = t + 0.08;
  }

  // ---------------------------------------------------------------- the hazards and the ledges
  /** where to be, given the hazard and the ice steps standing: up onto a step (a ledge), into the hum's column with the
   *  other, out of the Pool's water onto a stone near the other. Null: the plan stands */
  private placeFor(S: Sight, me: Snap, o: Snap, D: DuelSight, gx: number, gz: number): { x: number; y: number; z: number; why: string } | null {
    const t = S.t, Z = D.hazard ?? null;
    // an ice step standing near, its top a jump up: a ledge (a body that has just set one runs up onto it)
    const steps = (D.bends ?? []).filter((b) => b.kind === 'step');
    const stepNow = t < this.stepGoal + 0.4;
    for (const b of steps) {
      const h = b.at[1] - me.y, d = Math.hypot(b.at[0] - me.x, b.at[2] - me.z);
      if (h < 0.5 || h > 2.4 || d > 3.6) continue;
      // (only over floor: a step out over a drop or the water is a save, not a ledge to run up onto)
      if (groundOf(D, b.at[0], b.at[2], b.at[1] - 0.7, 0.1) < me.y - 0.6) continue;
      if (stepNow || this.rng.chance(0.35 + 0.3 * this.K.showy)) { this.count('step-ledge'); return { x: b.at[0], y: b.at[1], z: b.at[2], why: 'step' }; }
    }
    if (!Z) return null;
    // the hum: into its column with the other (live, or about to be), to float up together
    for (const L of Z.lifts) {
      const dMe = Math.hypot(L.at[0] - me.x, L.at[2] - me.z), dO = Math.hypot(L.at[0] - o.x, L.at[2] - o.z);
      if (dMe < 5.5 && dO < 3.5 && Math.hypot(o.x - me.x, o.z - me.z) < 4 && this.rng.chance(L.live ? 0.5 : 0.25)) {
        const a = this.rng.range(0, Math.PI * 2), r = L.r * 0.4;
        this.count('hum-go');
        return { x: L.at[0] + Math.cos(a) * r, y: L.at[1], z: L.at[2] + Math.sin(a) * r, why: 'hum' };
      }
    }
    // the Pool: keep to the stones near the other (the water is for coming back from a miss, not for staying in)
    if (Z.kind === 'swell') {
      const w = Z.water(gx, gz);
      if (w != null && groundOf(D, gx, gz, me.y, 2.5) < w - 0.5) {
        let bx = gx, bz = gz, bd = Infinity;
        for (let i = 0; i < 16; i++) for (const r of [0.8, 1.5, 2.3]) {
          const a = (i / 16) * Math.PI * 2, x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r, y = groundOf(D, x, z, me.y, 2.5);
          const wz = Z.water(x, z) ?? 0;
          if (y > wz - 0.3 && y < me.y + 2.2 && r < bd) { bd = r; bx = x; bz = z; }
        }
        if (bd < Infinity) return { x: bx, y: groundOf(D, bx, bz, me.y, 2.5), z: bz, why: 'stone' };
      }
    }
    return null;
  }

  /** riding the hazard now: a leap at the other with a gust behind it, a jump off the swell's crest toward the other */
  private ride(S: Sight, c: Character, me: Snap, o: Snap, D: DuelSight, it: Intent) {
    const Z = D.hazard, t = S.t;
    if (!Z || !c.grounded || this.pending || t < this.jumpUntil + 0.3 || c.plane) return;
    const dx = o.x - me.x, dz = o.z - me.z, dist = Math.hypot(dx, dz);
    if (dist < 2.2 || dist > 8) return;
    const ux = dx / dist, uz = dz / dist;
    const w = Z.wind, ws = Math.hypot(w[0], w[1]);
    if (ws > 0.4 && (w[0] * ux + w[1] * uz) / ws > 0.45 && this.rng.chance(1.4 * S.dt)) {
      this.jumpNow(t, holdFor(2.0, c.phys)); this.airJumpAt = dist > 4.5 ? t + 0.34 : -1;
      this.goal = { x: o.x, y: o.y, z: o.z, s: 0, why: 'gust' }; this.nextDecide = t + 0.9;
      this.count('gust-leap'); this.why = 'gust';
      return;
    }
    if (Z.swell) {
      const h = Z.swell(me.x, me.z), wy = Z.water(me.x, me.z) ?? 0;
      if (h > 0.14 && me.y < wy + 0.6 && dist < 6 && this.rng.chance(3 * S.dt)) {
        this.jumpNow(t, holdFor(2.0, c.phys));
        this.goal = { x: o.x, y: o.y, z: o.z, s: 0, why: 'crest' }; this.nextDecide = t + 0.8;
        this.count('crest-jump'); this.why = 'crest';
        stickFor(c, ux, uz, 1, it);
      }
    }
  }
}

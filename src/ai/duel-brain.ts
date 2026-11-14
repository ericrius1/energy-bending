// The duel's virtual player (docs/design/duel.md, "Virtual players", and the owner's correction: still a dance, 3D
// native, the lock an option anywhere, dancing is fighting). A Brain that plays the duel through Intents only, as a
// person on a keyboard or a pad would, free in the world or locked to the stage plane, whichever the body is in:
//
//   seeing     the other body as it was a reaction time ago (log-normal, a lapse now and then), carried forward by how
//              it was moving (more of it the better the player), with an aim error that drifts between reads
//   deciding   every so often (a fifth of a second or so): a place to be, by style (aggressive: in its face; evasive:
//              at arm's length plus, closing only to punish; showy: close, by way of wall kicks, flips and aús), the
//              pair circling each other as the jogo's do (both turning the same way, the sense changing every four
//              bars), now and then a high place to jump onto or a solid to kick off
//   fighting   a strike when the other will be in a move's reach (measured once from the move library's own capsules),
//              timed onto the 8th-note line when the player is good; an answer to an attack it has seen start: a jump,
//              an esquiva, a negativa, an aú or a roll away, a block, or a strike back
//   dancing    between exchanges the ginga, and on the beat a flourish (an aú, a macaco, a spin, the pirouette): dancing
//              well is what builds flow
//   moving     free: toward the place, around the world's solids (a pillar is gone round; a stump, the altar, a slab
//              is jumped onto), never off into a pit it can't come back from (a gap it can clear it jumps, running),
//              the air jump at the top or over the void, a wall kick off a solid it falls against; locked: along the
//              plane's floor and ledges (run-ups onto solid ledges, drops through one-way ones, gaps jumped) and off
//              its walls. The dash (Intent.dash) where the body has one
//   holding    a person's thumbs: the stick in eight directions, held a while once moved (no flicker), a jump
//              committed to once pressed, one button at a time
//
// The knobs: `skill` 0 … 1 (reaction time, aim error, beat accuracy, how often it answers, how far it reads ahead)
// and `style`. Deterministic for a seed (its only randomness is its Rng, its only clock the Sight's).
import { Character, PHYS, type Phys } from '../dancer/character';
import { MOVES, tempoScale } from '../dancer/moves';
import { ledgeY as defaultLedgeY, distTo, type Ledge, type StagePlane } from '../engine/camera';
import { makeIntent, type Intent } from '../input/intent';
import type { Solid } from '../worlds/solids';
import { Rng, newHints, type Brain, type SeenMove, type Sight } from './brain';
import { canStart, hypotheticalEvent, pressMove, stickFor } from './body';
import { groundUnder } from '../duel/arena';
import { readThreat } from './read';

export type DuelStyle = 'aggressive' | 'evasive' | 'showy';
export const DUEL_STYLES: readonly DuelStyle[] = ['aggressive', 'evasive', 'showy'];

/** what the brain may know of the duel beyond the bodies (the rules' state), and of the arena */
export interface DuelSight {
  /** the seats that can't be hit now (re-forming, just re-formed) and that can't move (the count-in, scattered) */
  untouchable: [boolean, boolean];
  frozen: [boolean, boolean];
  /** below this (world y) is a KO */
  yKill: number;
  /** the play space (a circle on the ground: past it is a soft wall) */
  space: { center: [number, number, number]; radius: number };
  /** where bodies re-form */
  spawns: readonly (readonly [number, number, number])[];
  /** the world's solids and the arena's pieces, and the floor's height (World.groundAt) */
  solids: readonly Solid[];
  groundAt(x: number, z: number): number;
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

/** an attack's reach from a standing body facing forward: where its hit capsule goes (forward f, sideways l, up y,
 *  relative to the root) while it is live, and when it is live */
interface Reach { name: string; f0: number; f1: number; l0: number; l1: number; y0: number; y1: number; a0: number; a1: number; dur: number; air: boolean }

const GROUND_ATTACKS = ['strike', 'meia-lua', 'bencao', 'martelo', 'rasteira', 'armada'] as const;
const AIR_ATTACKS = ['martelo', 'strike'] as const;
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

/** the reach of every attack at a tempo, measured once from the library's capsules on a free body facing +z */
const REACH = new Map<number, Reach[]>();
function reaches(bpm: number): Reach[] {
  const key = Math.round(bpm);
  const hit = REACH.get(key);
  if (hit) return hit;
  const out: Reach[] = [];
  const c = new Character({ seat: 0, plane: null });
  c.reset(0, 0, 0); c.yaw = 0;
  for (const air of [false, true]) for (const name of air ? AIR_ATTACKS : GROUND_ATTACKS) {
    const def = MOVES[name];
    if (!def || !def.active || !def.hit) continue;
    const ev = hypotheticalEvent(c, name, bpm);
    Object.assign(ev, { vx: 0, vz: 0, vy: 0, air });
    const dur = def.dur * tempoScale(bpm), a0 = def.active[0] * dur, a1 = def.active[1] * dur;
    const r: Reach = { name, f0: Infinity, f1: -Infinity, l0: Infinity, l1: -Infinity, y0: Infinity, y1: -Infinity, a0, a1, dur, air };
    for (let t = a0; t <= a1 + 1e-9; t += 1 / 60) {
      for (const cap of Character.shapesAt(ev, t)) {
        for (const [x, y, z] of [[cap.ax, cap.ay, cap.az], [cap.bx, cap.by, cap.bz]]) {
          r.f0 = Math.min(r.f0, z - cap.r); r.f1 = Math.max(r.f1, z + cap.r);
          r.l0 = Math.min(r.l0, x - cap.r); r.l1 = Math.max(r.l1, x + cap.r);
          r.y0 = Math.min(r.y0, y - cap.r); r.y1 = Math.max(r.y1, y + cap.r);
        }
      }
    }
    if (Number.isFinite(r.f0)) out.push(r);
  }
  REACH.set(key, out);
  return out;
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
    react: number; sigma: number; lapse: number; aimErr: number; beatSd: number; beatWait: number; answer: number; decide: number;
    predict: number; want: number; aggro: number; punish: number; showy: number; retreat: number; dance: number;
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
  private answered = new Set<number>();
  /** the reaction time drawn for each attack seen (by serial) */
  private seenAt = new Map<number, number>();
  private flipT = -1;
  private avoidSide = 1;
  private hadDash: boolean;

  constructor(o: DuelBrainOptions = {}) {
    this.skill = clamp(o.skill ?? 0.6, 0, 1);
    this.style = o.style ?? 'aggressive';
    this.name = `duel-${this.style}`;
    this.rng = new Rng(o.seed ?? 7);
    this.duel = o.duel ?? null;
    const k = this.skill;
    const st = { aggressive: { want: 0.85, aggro: 0.92, punish: 0.7, showy: 0.1, retreat: 0.15, dance: 0.35 },
      evasive: { want: 2.2, aggro: 0.55, punish: 0.95, showy: 0.08, retreat: 0.85, dance: 0.5 },
      showy: { want: 1.3, aggro: 0.7, punish: 0.6, showy: 0.75, retreat: 0.35, dance: 0.9 } }[this.style];
    this.K = {
      react: 0.33 - 0.15 * k, sigma: 0.22, lapse: 0.09 - 0.06 * k, aimErr: 0.5 - 0.38 * k, beatSd: 0.095 - 0.075 * k,
      beatWait: 0.1 + 0.85 * k, answer: 0.18 + 0.62 * k, decide: 0.24 - 0.09 * k, predict: 0.2 + 0.7 * k, ...st,
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
    const otherOut = (D?.untouchable[them] ?? false) || o.reforming;

    this.answer(S, c, mine, t);
    if (t >= this.nextDecide) {
      if (pl) this.decideLocked(S, c, mine, o, this.surfaces(pl, S.beat), otherOut, yKill);
      else this.decideFree(S, mine, o, otherOut, D);
      this.nextDecide = t + this.K.decide * this.rng.range(0.75, 1.35);
      this.aimOff = [this.aimOff[0] * 0.4 + this.rng.normal() * this.K.aimErr * 0.6, this.aimOff[1] * 0.4 + this.rng.normal() * this.K.aimErr * 0.6];
    }
    if (!otherOut && !this.pending) this.strike(S, c, mine, o);
    if (!this.pending) this.dance(S, c, mine, o, otherOut);
    if (pl) this.legsLocked(S, c, mine, this.surfaces(pl, S.beat), yKill, it, t);
    else this.legsFree(S, c, mine, D, yKill, it, t);

    // ---- a planned press due now
    const p = this.pending;
    if (p && t >= p.at) {
      this.pending = null;
      let ok = MOVES[p.move] ? canStart(c, p.move) && (c.grounded || MOVES[p.move].airOk) : canStart(c, 'spin');
      // free, a strike goes where the body faces: thrown only once it has turned to the other (else let go)
      if (ok && !pl && MOVES[p.move]?.attack) {
        const f = this.fwd(c), dx = O.root[0] - c.root[0], dz = O.root[2] - c.root[2], l = Math.hypot(dx, dz) || 1;
        if ((f[0] * dx + f[1] * dz) / l < 0.75) {
          ok = false;
          // (still turning: a moment more, twice; then let it go)
          if ((p.tries ?? 0) < 2) this.pending = { ...p, at: t + 0.06, tries: (p.tries ?? 0) + 1 };
          else this.count('held');
        }
      }
      if (ok) {
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
    let want = K.want, why = 'close';
    if (otherOut) { want = Math.max(2.4, K.want); why = 'wait out its re-forming'; }
    else if (this.style === 'evasive') {
      // at the edge of its own reach, poking; backing off when crowded; in at once on an opening
      if (O_recovering(S)) { want = 0.75; why = 'punish'; }
      else if (ad < 1.1 && !O_attacking(S) && this.rng.chance(K.retreat * 0.6)) { want = 2.4; why = 'back off'; }
      else { want = this.rng.range(1.0, 1.5); why = 'poke'; }
    } else if (O_recovering(S) && ad < 3) { want = 0.7; why = 'punish'; }
    // round the other, as the jogo's pair circles: both the same way, the sense turning every four bars
    let th = ad > 1e-3 ? Math.atan2(rz, rx) : this.rng.range(-Math.PI, Math.PI);
    const sense = Math.floor(S.beat / 16) % 2 ? 1 : -1;
    if (why !== 'punish') th += sense * this.rng.range(0.15, 0.5);
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
      // now and then: up onto something (a stump, the altar, a slab), or a solid to kick off (showy most)
      if (!otherOut && (why === 'close' || why === 'poke') && this.rng.chance(0.06 + K.showy * 0.25)) {
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
    const g = this.goal, minHold = 0.13 + (1 - this.skill) * 0.08;
    const ground = (x: number, z: number, up = 0.4) => (D ? groundOf(D, x, z, me.y, up) : 0);
    const solids = D?.solids ?? [];
    if (c.grounded) this.airUsed = false;
    let dx = g.x - me.x, dz = g.z - me.z;
    const dist = Math.hypot(dx, dz);
    let want: [number, number] = dist < 0.35 ? [0, 0] : [dx / dist, dz / dist];
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
      if (this.style === 'showy' && !this.pending && t - this.lastPress > 0.9 && t >= this.jumpUntil + 0.1 && this.rng.chance(0.006 * this.K.showy * 60 * S.dt)) {
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
      // (only toward somewhere to land: a kick off a rock out over the pool's water, or off a stone over the forge's
      // void, is a fall; with nothing that way the body slides down the face instead)
      const lands = (k: number) => !!away && ground(me.x + away[0] * k, me.z + away[1] * k, 2.5) > yKill + 0.6;
      if (away && !(lands(1.6) || lands(2.6) || lands(3.6))) away = null;
      if (away && me.vy < 1.5 && t >= this.jumpUntil + 0.12) {
        // (sliding: hold into it a moment, then kick off away from it)
        if (this.rng.chance(this.style === 'showy' || g.why === 'wall kick' ? 0.6 : 0.2 + 0.4 * this.skill)) {
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
  private decideLocked(S: Sight, c: Character, me: Snap, o: Snap, surf: Surf[], otherOut: boolean, yKill: number) {
    const K = this.K, pl = c.plane!, lim = pl.halfWidth - c.phys.wallMargin - 0.1;
    const ad = Math.abs(o.s - me.s);
    let want = K.want, why = 'close';
    if (otherOut) { want = Math.max(2.2, K.want); why = 'wait out its re-forming'; }
    else if (this.style === 'evasive') {
      if (ad < 1.6 && !O_attacking(S) && this.rng.chance(K.retreat)) { want = 3.2; why = 'back off'; }
      else if (O_recovering(S)) { want = 0.7; why = 'punish'; }
    } else if (O_recovering(S) && ad < 3) { want = 0.6; why = 'punish'; }
    let side = sgn(me.s - o.s);
    if (Math.abs(o.s + side * want) > lim) side = -side;
    let gs = clamp(o.s + side * want, -lim, lim), gy = o.y;
    const below = this.under(surf, o.s, o.y + 0.1);
    if (!below || below.y < yKill + 0.5) {
      const ref = this.under(surf, me.s, me.y + 0.1);
      if (ref) { gs = clamp(gs, ref.x0 + 0.4, ref.x1 - 0.4); gy = ref.y; }
    } else gy = below.y;
    if ((this.style === 'showy' || this.rng.chance(K.showy * 0.3)) && ad > 2.2 && this.rng.chance(K.showy * 0.5)) {
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
      if (this.style === 'showy' && !this.pending && t - this.lastPress > 0.9 && t >= this.jumpUntil + 0.1 && this.rng.chance(0.006 * this.K.showy * 60 * S.dt)) {
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
        if (this.rng.chance(this.style === 'showy' ? 0.5 : 0.25 + 0.5 * this.skill)) {
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
      : dist > 3 && c.grounded && this.style !== 'evasive' && this.rng.chance(0.03) ? 'close'
      : this.style === 'evasive' && this.goal.why === 'back off' && c.grounded && this.rng.chance(0.05) ? 'away'
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

  /** a strike if the other will be in reach when it lands */
  private strike(S: Sight, c: Character, me: Snap, o: Snap) {
    const K = this.K, t = S.t;
    if (t - this.lastPress < 0.14 + (1 - this.skill) * 0.12) return;
    if (!canStart(c, 'strike') && !canStart(c, 'martelo')) return;
    const f0 = this.fwd(c), pl = c.plane;
    // (locked, it can turn on the ground to face the other; free, it strikes where it faces: it turns to face the other
    // when it stands, and runs at it otherwise)
    let fx = f0[0], fz = f0[1];
    if (pl && c.grounded) { const d = sgn(o.s - me.s); fx = pl.right[0] * d; fz = pl.right[2] * d; }
    const cands: { r: Reach; w: number }[] = [];
    for (const r of reaches(S.bpm)) {
      if (r.air === c.grounded || !canStart(c, r.name)) continue;
      const tm = (r.a0 + r.a1) / 2, k = K.predict * tm;
      const ox = o.x + o.vx * k, oz = o.z + o.vz * k, oy = o.y + (o.grounded ? 0 : (o.vy * tm - 0.5 * c.phys.gravity * tm * tm) * K.predict);
      const rx = ox - me.x, rz = oz - me.z;
      const f = rx * fx + rz * fz, l = pl ? 0 : -rx * fz + rz * fx, h = oy - me.y;
      if (f + 0.18 < r.f0 || f - 0.18 > r.f1 || f < 0.2) continue;
      if (l + 0.18 < r.l0 || l - 0.18 > r.l1 || Math.abs(l) > 0.6) continue;
      if (h + 1.6 < r.y0 || h + 0.05 > r.y1) continue;
      let w = 1 / (0.25 + r.a0);
      if (this.style === 'showy' && (r.name === 'armada' || r.name === 'martelo')) w *= 2.2;
      if (this.style === 'aggressive' && (r.name === 'meia-lua' || r.name === 'bencao')) w *= 1.6;
      if (this.style === 'evasive' && (r.name === 'strike' || r.name === 'bencao')) w *= 1.8;
      if (r.name === 'rasteira' && o.grounded) w *= 0.8;
      if (r.name === 'armada') w *= 0.3;
      cands.push({ r, w });
    }
    if (!cands.length) return;
    const p = O_recovering(S) ? Math.max(K.aggro, K.punish) : K.aggro;
    if (!this.rng.chance(p * 0.35 + 0.05)) return;
    const pick = this.rng.weighted(cands, (x) => x.w)!.r;
    // (free and moving: a moment to stand and turn to it first)
    const settle = !pl && c.grounded && (Math.hypot(c.v[0], c.v[2]) > 0.7 || (o.x - me.x) * fx + (o.z - me.z) * fz < 0.8 * Math.hypot(o.x - me.x, o.z - me.z)) ? 0.18 : 0;
    this.pending = { move: pick.name, at: Math.max(t + settle, this.onBeatAt(S, 0.16 + settle)), dir: [fx, fz], why: `strike ${pick.name}` };
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

  /** an attack seen starting (its start event, a reaction time old): jump it, dodge it (esquiva, negativa, aú, a roll
   *  away), block it or strike back */
  private answer(S: Sight, c: Character, me: Snap, t: number) {
    const K = this.K;
    const moves = S.partner?.moves ?? [];
    for (const m of moves as SeenMove[]) {
      if (!m.attack || this.answered.has(m.serial)) continue;
      let lag = this.seenAt.get(m.serial);
      if (lag == null) { lag = this.rng.reaction(K.react, K.sigma, K.lapse); this.seenAt.set(m.serial, lag); }
      if (m.age < lag) continue;
      this.answered.add(m.serial);
      if (this.seenAt.size > 64) { const k = this.seenAt.keys().next().value!; this.seenAt.delete(k); }
      if (this.answered.size > 64) { const k = this.answered.values().next().value!; this.answered.delete(k); }
      const def = MOVES[m.name];
      if (!def?.active) continue;
      const dur = def.dur * tempoScale(m.ev.bpm || S.bpm), a1 = def.active[1] * dur, a0 = def.active[0] * dur;
      if (m.age > a1) continue;
      // will it reach me where I stand? (from where it started, along the way it travels)
      const fd = (m.ev.fdir as number[] | undefined) ?? [1, 0], fl = Math.hypot(fd[0], fd[1]) || 1;
      const rx = me.x - m.ev.x, rz = me.z - (m.ev.z ?? 0), along = (rx * fd[0] + rz * fd[1]) / fl, lat = Math.abs(-rx * fd[1] + rz * fd[0]) / fl;
      if (along < -0.3 || Math.hypot(rx, rz) > 2.2 || (!c.plane && lat > 0.9)) continue;
      if (!this.rng.chance(K.answer)) { this.count('missed'); continue; }
      // read it (src/ai/read.ts: the attack replayed against this body's own hurt shapes where it stands): one that will
      // miss is let go by (and punished in its recovery: deciding sees the opening) rather than answered; a weaker player
      // misreads some and answers those anyway
      const th = readThreat(m.ev, c.hurtShapes(), c.plane, m.age);
      if (th && th.first == null && this.rng.chance(0.3 + 0.7 * this.skill)) { this.count('read-miss'); this.nextDecide = Math.min(this.nextDecide, t + 0.1); continue; }
      const left = Math.max(0, (th?.first ?? a0) - m.age);
      const rl = Math.hypot(rx, rz) || 1, away: [number, number] = [rx / rl, rz / rl], toward: [number, number] = [-away[0], -away[1]];
      // the answers that work: an evasion whose i-frames, started now, cover the attack's live window; a jump over a
      // low one; a roll or an aú away; a block; a strike back if there is time. A good player takes the best; a weaker
      // one any that comes to mind
      const win = (th?.last ?? a1) - Math.max(th?.first ?? a0, m.age), bpm = S.bpm;
      const covers = (name: string) => {
        const d = MOVES[name];
        if (!d?.iframes || !canStart(c, name)) return false;
        const dd = d.dur * tempoScale(bpm);
        return left >= d.iframes[0] * dd - 0.01 && left + win <= d.iframes[1] * dd + 0.02;
      };
      const low = m.name === 'rasteira' || m.name === 'meia-lua';
      const opts: { k: string; w: number }[] = [];
      if (c.grounded) {
        if (covers('esquiva') && !low) opts.push({ k: 'esquiva', w: 3 });
        if (MOVES.negativa && covers('negativa') && !low) opts.push({ k: 'negativa', w: 2.5 });
        if (covers('role')) opts.push({ k: 'role', w: 1.5 });
        if (canStart(c, 'jump')) opts.push({ k: 'jump', w: low ? 3.5 : 0.8 });
        opts.push({ k: 'au', w: 0.8 }, { k: 'block', w: 0.9 });
      }
      if (left > 0.12 && rl < 1.0 && canStart(c, 'strike')) opts.push({ k: 'strike', w: 0.9 });
      if (!opts.length) continue;
      const pick = this.rng.chance(this.skill) ? opts.reduce((p, q) => (q.w > p.w ? q : p)).k : this.rng.pick(opts).k;
      if (pick === 'jump') {
        this.jumpNow(t, 0.42); this.stick = c.plane ? [sgn(away[0] * c.plane.right[0] + away[1] * c.plane.right[2]), 0] : this.stick; this.stickSince = t;
        this.why = `jump ${m.name}`; this.count('jump-dodge');
      } else this.pending = { move: pick, at: t, dir: pick === 'role' || pick === 'au' ? away : toward, why: `${pick} for ${m.name}` };
      this.nextDecide = Math.min(this.nextDecide, t + 0.3);
    }
  }
}

/** is the other in an attack's recovery (an opening)? */
function O_recovering(S: Sight) {
  const m = S.partner?.character?.move;
  if (!m || !m.def.attack || !m.def.active) return false;
  return m.t / m.dur > m.def.active[1];
}
/** is the other's attack live or winding up? */
function O_attacking(S: Sight) {
  const m = S.partner?.character?.move;
  return !!(m && m.def.attack && m.def.active && m.t / m.dur <= m.def.active[1]);
}

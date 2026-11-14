// The duel's virtual player (docs/design/duel.md, "Virtual players"): a Brain that plays the duel through Intents only,
// as a person on a keyboard or a pad would. It reads the arena (the plane's floor and ledges, its walls and ends, the
// kill floor), both bodies and the beat, and each frame decides the stick and the buttons:
//
//   seeing     the other body as it was a reaction time ago (log-normal, a lapse now and then), carried forward by
//              how it was moving (more of it the better the player), with an aim error that drifts between reads
//   deciding   every so often (a fifth of a second or so, sooner when something new is seen): a place to be, by style
//              (aggressive: in its face; evasive: at arm's length plus, closing only to punish; showy: close, by way of
//              wall-jump chains, flips and cartwheels), a strike when the other is in a move's reach (measured once
//              from the move library's own capsules), timed onto the 8th-note line when the player is good, and an
//              answer to an attack it has seen start (a jump, a low dodge, a roll, a block, or a strike back)
//   moving     along the arena: run, jump (held for the height it needs: a short hop or the full jump), the air jump
//              at the top, a drop through a one-way ledge, a run-up and a jump onto a solid one, a wall jump off a wall
//              it falls against, steering in the air to land, never walking off into a pit it can't come back from,
//              and the dash (Intent.dash) where the body has one
//   holding    a person's thumbs: the stick held for a while once moved (no flicker), a jump committed to once pressed,
//              one button at a time
//
// The knobs: `skill` 0 … 1 (reaction time, aim error, beat accuracy, how often it answers, how far it reads ahead)
// and `style`. Deterministic for a seed (its only randomness is its Rng, its only clock the Sight's).
import { Character, PHYS } from '../dancer/character';
import { MOVES, tempoScale } from '../dancer/moves';
import { ledgeY as defaultLedgeY, type Ledge, type StagePlane } from '../engine/camera';
import { makeIntent, type Intent } from '../input/intent';
import { Rng, newHints, type Brain, type SeenMove, type Sight } from './brain';
import { canStart, hypotheticalEvent, pressMove } from './body';

export type DuelStyle = 'aggressive' | 'evasive' | 'showy';
export const DUEL_STYLES: readonly DuelStyle[] = ['aggressive', 'evasive', 'showy'];

/** what the brain may know of the duel beyond the bodies (the rules' state), and of the arena */
export interface DuelSight {
  /** the seats that can't be hit now (re-forming, just re-formed) and that can't move (the count-in, scattered) */
  untouchable: [boolean, boolean];
  frozen: [boolean, boolean];
  /** below this (plane y) is a KO */
  yKill: number;
  /** where bodies re-form */
  spawns: readonly (readonly [number, number])[];
}

export interface DuelBrainOptions {
  skill?: number;
  style?: DuelStyle;
  seed?: number;
  duel?: () => DuelSight | null;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const sgn = (x: number) => (x < 0 ? -1 : 1);

/** what a body looked like at a moment (plane coordinates) */
interface Snap { t: number; s: number; y: number; vs: number; vy: number; grounded: boolean; dir: number; reforming: boolean }

/** a surface to stand on, in plane coordinates */
interface Surf { id: string; x0: number; x1: number; y: number; solid: boolean; thick: number; ground: boolean }

/** an attack's reach from a standing body facing +s: where its hit capsule's ends go (relative to the root) while it
 *  is live, and when it is live */
interface Reach { name: string; f0: number; f1: number; y0: number; y1: number; a0: number; a1: number; dur: number; air: boolean }

const GROUND_ATTACKS = ['strike', 'meia-lua', 'bencao', 'martelo', 'rasteira', 'armada'] as const;
const AIR_ATTACKS = ['martelo', 'strike'] as const;

/** the body's own jump, from PHYS: the height reached holding the jump for `hold` seconds from the start */
export function jumpHeight(hold: number, v0 = PHYS.jumpV) {
  const g = PHYS.gravity, T = Math.min(hold, v0 / g);
  if (T >= v0 / g - 1e-6) return (v0 * v0) / (2 * g);
  const h1 = v0 * T - 0.5 * g * T * T, v1 = v0 - g * T;
  return h1 + (v1 * v1) / (2 * g * PHYS.cutMul);
}
/** how long to hold the jump to rise `h` metres (a full hold past the body's single jump) */
export function holdFor(h: number, v0 = PHYS.jumpV) {
  const full = v0 / PHYS.gravity;
  if (h >= jumpHeight(full, v0) - 0.02) return full + 0.05;
  let a = 0, b = full;
  for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (jumpHeight(m, v0) < h) a = m; else b = m; }
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
  private reachCache = new Map<number, Reach[]>();
  // the knobs, from skill and style
  private K: {
    react: number; sigma: number; lapse: number; aimErr: number; beatSd: number; beatWait: number; answer: number; decide: number;
    predict: number; want: number; aggro: number; punish: number; showy: number; retreat: number; patience: number;
  };
  // the plan and the thumbs
  private nextDecide = 0;
  private goal: { s: number; y: number; why: string } = { s: 0, y: 0, why: 'start' };
  private stick = 0;
  private stickSince = -1;
  private jumpUntil = -1;
  private jumpPressAt = -1;
  private airJumpAt = -1;
  private dropUntil = -1;
  private down = -1;
  private pending: { move: string; at: number; dir: number; why: string } | null = null;
  private lastPress = -1;
  private aimOff = 0;
  private answered = new Set<number>();
  /** the reaction time drawn for each attack seen (by serial) */
  private seenAt = new Map<number, number>();
  private flipT = -1;
  private hadDash: boolean;
  /** the air jump pressed this airtime (a person presses it once; a wall or the floor gives it back) */
  private airUsed = false;

  constructor(o: DuelBrainOptions = {}) {
    this.skill = clamp(o.skill ?? 0.6, 0, 1);
    this.style = o.style ?? 'aggressive';
    this.name = `duel-${this.style}`;
    this.rng = new Rng(o.seed ?? 7);
    this.duel = o.duel ?? null;
    const k = this.skill;
    const st = { aggressive: { want: 0.75, aggro: 0.92, punish: 0.7, showy: 0.08, retreat: 0.15, patience: 0.25 },
      evasive: { want: 2.6, aggro: 0.45, punish: 0.95, showy: 0.05, retreat: 0.85, patience: 0.8 },
      showy: { want: 1.2, aggro: 0.7, punish: 0.6, showy: 0.75, retreat: 0.35, patience: 0.45 } }[this.style];
    this.K = {
      react: 0.33 - 0.15 * k, sigma: 0.22, lapse: 0.09 - 0.06 * k, aimErr: 0.5 - 0.38 * k, beatSd: 0.095 - 0.075 * k,
      beatWait: 0.1 + 0.85 * k, answer: 0.18 + 0.62 * k, decide: 0.24 - 0.09 * k, predict: 0.2 + 0.7 * k, ...st,
    };
    this.hadDash = 'dash' in makeIntent();
    this.body.groove = 0.6;
  }

  private count(k: string) { this.counts[k] = (this.counts[k] ?? 0) + 1; }

  // ---------------------------------------------------------------- the arena
  private surfaces(p: StagePlane, beat: number): Surf[] {
    const ly = p.ledgeY ?? defaultLedgeY, out: Surf[] = [];
    if (p.ground != null) out.push({ id: '_ground', x0: -p.halfWidth, x1: p.halfWidth, y: p.ground, solid: true, thick: 0, ground: true });
    for (const L of p.ledges as Ledge[]) out.push({ id: L.id, x0: L.x0, x1: L.x1, y: ly(L, beat), solid: !!L.solid, thick: L.thick ?? PHYS.solidThick, ground: false });
    return out;
  }
  /** the highest surface at s at or below y */
  private under(S: Surf[], s: number, y: number): Surf | null {
    let best: Surf | null = null;
    for (const q of S) if (s >= q.x0 - 0.05 && s <= q.x1 + 0.05 && q.y <= y + 0.08 && (!best || q.y > best.y)) best = q;
    return best;
  }

  // ---------------------------------------------------------------- reach
  /** every attack's reach at this tempo, measured from the library's own capsules (Character.shapesAt) */
  private reaches(c: Character, bpm: number): Reach[] {
    const key = Math.round(bpm);
    const hit = this.reachCache.get(key);
    if (hit) return hit;
    const out: Reach[] = [];
    const pl = c.plane!;
    for (const air of [false, true]) for (const name of air ? AIR_ATTACKS : GROUND_ATTACKS) {
      const def = MOVES[name];
      if (!def || !def.active || !def.hit) continue;
      const ev = hypotheticalEvent(c, name, bpm, 1);
      // (measured from where the body stands, standing still: plane coordinates relative to the root, facing +s)
      Object.assign(ev, { vx: 0, vz: 0, vy: 0, air });
      const dur = def.dur * tempoScale(bpm), a0 = def.active[0] * dur, a1 = def.active[1] * dur;
      const r: Reach = { name, f0: Infinity, f1: -Infinity, y0: Infinity, y1: -Infinity, a0, a1, dur, air };
      const s0 = (ev.x - pl.origin[0]) * pl.right[0] + (ev.z - pl.origin[2]) * pl.right[2], y0 = ev.y;
      for (let t = a0; t <= a1 + 1e-9; t += 1 / 60) {
        for (const cap of Character.shapesAt(ev, t)) {
          for (const [x, y, z] of [[cap.ax, cap.ay, cap.az], [cap.bx, cap.by, cap.bz]]) {
            const f = (x - pl.origin[0]) * pl.right[0] + (z - pl.origin[2]) * pl.right[2] - s0;
            r.f0 = Math.min(r.f0, f - cap.r); r.f1 = Math.max(r.f1, f + cap.r);
            r.y0 = Math.min(r.y0, y - y0 - cap.r); r.y1 = Math.max(r.y1, y - y0 + cap.r);
          }
        }
      }
      if (Number.isFinite(r.f0)) out.push(r);
    }
    this.reachCache.set(key, out);
    return out;
  }

  // ---------------------------------------------------------------- seeing
  private snap(c: Character, t: number): Snap {
    const pl = c.plane!, vs = c.v[0] * pl.right[0] + c.v[2] * pl.right[2];
    return { t, s: c.s, y: c.root[1] - pl.origin[1], vs, vy: c.v[1], grounded: c.grounded, dir: c.dir, reforming: c.reforming };
  }
  /** the other body as this player sees it now: as it was a reaction time ago, carried forward */
  private seen(t: number, lag: number): Snap | null {
    const H = this.hist;
    if (!H.length) return null;
    let i = H.length - 1;
    while (i > 0 && H[i].t > t - lag) i--;
    const o = H[i], k = this.K.predict * Math.min(lag, 0.35);
    return { ...o, s: o.s + o.vs * k + this.aimOff, y: o.y + (o.grounded ? 0 : o.vy * k * 0.5) };
  }

  // ---------------------------------------------------------------- thinking
  think(S: Sight): Intent {
    const it = makeIntent();
    const c = S.self, t = S.t, pl = c.plane;
    const O = S.partner?.character ?? null;
    if (!pl || !O) return it;
    const D = this.duel?.() ?? null;
    const me = S.seat, them = 1 - me;
    this.hist.push(this.snap(O, t));
    while (this.hist.length > 2 && this.hist[1].t < t - 1) this.hist.shift();
    const frozen = D?.frozen[me] ?? false;
    if (frozen || c.reforming) {
      // held: let go of everything, forget the plan (the thumbs rest)
      this.pending = null; this.jumpUntil = -1; this.stick = 0; this.down = -1;
      this.nextDecide = t + this.rng.reaction(this.K.react, this.K.sigma, this.K.lapse);
      return it;
    }
    const lag = this.rng.reaction(this.K.react, 0.05, 0);   // (this frame's lag: the median, barely varied, so the view is steady)
    const o = this.seen(t, lag);
    if (!o) return it;
    const surf = this.surfaces(pl, S.beat);
    const mine = this.snap(c, t);
    const yKill = D?.yKill ?? Math.min(...surf.map((q) => q.y)) - 2.2;
    const otherOut = (D?.untouchable[them] ?? false) || o.reforming;

    // ---- an attack seen starting: answer it (once, after a reaction time)
    this.answer(S, c, O, mine, t);

    // ---- decide (every so often, or at once when something changed a lot)
    if (t >= this.nextDecide) {
      this.decide(S, c, mine, o, surf, otherOut, yKill);
      this.nextDecide = t + this.K.decide * this.rng.range(0.75, 1.35);
      // the aim error drifts: a new misjudgement each read
      this.aimOff = this.aimOff * 0.4 + this.rng.normal() * this.K.aimErr * 0.6;
    }

    // ---- a strike when the other is in reach
    if (!otherOut && !this.pending) this.strike(S, c, mine, o);

    // ---- the legs: toward the goal along the arena
    this.legs(S, c, mine, surf, yKill, it, t);

    // ---- a planned press due now
    const p = this.pending;
    if (p && t >= p.at) {
      this.pending = null;
      if (canStart(c, p.move) && (c.grounded || MOVES[p.move]?.airOk)) {
        const dir = p.dir;
        const fl = pressMove(c, p.move, [pl.right[0] * dir, pl.right[2] * dir], it);
        if (fl) this.body.flourish = fl;
        this.lastPress = t; this.why = p.why; this.count(p.move);
        // (the press holds the stick its own way this frame; the legs' hold goes on after)
      }
    }
    return it;
  }

  /** a new place to be, and whether to go there by a flourish */
  private decide(S: Sight, c: Character, me: Snap, o: Snap, surf: Surf[], otherOut: boolean, yKill: number) {
    const K = this.K, pl = c.plane!, lim = pl.halfWidth - PHYS.wallMargin - 0.1;
    const d = o.s - me.s, ad = Math.abs(d);
    let want = K.want, why = 'close';
    // keep away while it can't be hit (and from where it will come back); evasive keeps away when it's near
    if (otherOut) { want = Math.max(2.2, K.want); why = 'wait out its re-forming'; }
    else if (this.style === 'evasive') {
      const theyAttack = this.hist.length && O_attacking(S);
      if (ad < 1.6 && !theyAttack && this.rng.chance(K.retreat)) { want = 3.2; why = 'back off'; }
      else if (O_recovering(S)) { want = 0.7; why = 'punish'; }
    } else if (this.style === 'aggressive') {
      if (O_recovering(S) && ad < 3) { want = 0.6; why = 'punish'; }
    }
    // the side to stand on: this side of the other, unless cornered (then over it)
    let side = sgn(me.s - o.s);
    if (Math.abs(o.s + side * want) > lim) side = -side;
    let gs = clamp(o.s + side * want, -lim, lim), gy = o.y;
    // the other in the air over nothing (the forge's pit): stand at the edge it will come back to
    const below = this.under(surf, o.s, o.y + 0.1);
    if (!below || below.y < yKill + 0.5) {
      const ref = this.under(surf, me.s, me.y + 0.1);
      if (ref) { gs = clamp(gs, ref.x0 + 0.4, ref.x1 - 0.4); gy = ref.y; }
    } else gy = below.y;
    // showy: a wall-jump chain or a flip now and then when nothing presses
    if (this.style === 'showy' || this.rng.chance(K.showy * 0.3)) {
      if (ad > 2.2 && this.rng.chance(K.showy * 0.5)) {
        const wall = sgn(me.s) * lim;
        if (Math.abs(wall - me.s) < 3.5) { gs = wall; why = 'wall chain'; }
      }
    }
    this.goal = { s: gs, y: gy, why };
  }

  /** a strike if the other will be in reach when it lands */
  private strike(S: Sight, c: Character, me: Snap, o: Snap) {
    const K = this.K, t = S.t;
    if (t - this.lastPress < 0.14 + (1 - this.skill) * 0.12) return;
    if (!canStart(c, 'strike') && !canStart(c, 'martelo')) return;
    const dir = sgn(o.s - me.s);
    // (a body can only strike the way it faces; in the air it can't turn)
    if (!c.grounded && dir !== c.dir) return;
    const R = this.reaches(c, S.bpm).filter((r) => r.air === !c.grounded);
    const cands: { r: Reach; w: number }[] = [];
    for (const r of R) {
      if (!canStart(c, r.name)) continue;
      // where the other will be when the strike is live (carried by how it moves), relative to my root, facing it
      const tm = (r.a0 + r.a1) / 2;
      const os = o.s + o.vs * tm * K.predict, oy = o.y + (o.grounded ? 0 : (o.vy * tm - 0.5 * PHYS.gravity * tm * tm) * K.predict);
      const f = (os - me.s) * dir, h = oy - me.y;
      // its body: a column 0.22 m wide either side, from its feet to its head
      if (f + 0.22 < r.f0 || f - 0.22 > r.f1) continue;
      if (h + 1.6 < r.y0 || h + 0.05 > r.y1) continue;
      // fast moves close, long ones further; each style has its taste
      let w = 1 / (0.25 + r.a0);
      if (this.style === 'showy' && (r.name === 'armada' || r.name === 'martelo')) w *= 2.2;
      if (this.style === 'aggressive' && (r.name === 'meia-lua' || r.name === 'bencao')) w *= 1.6;
      if (this.style === 'evasive' && (r.name === 'strike' || r.name === 'bencao')) w *= 1.8;
      if (r.name === 'rasteira' && o.grounded) w *= 0.8;
      if (r.name === 'armada') w *= 0.5;
      cands.push({ r, w });
    }
    if (!cands.length) return;
    // willing? (an aggressive player takes nearly every chance; an evasive one waits for an opening)
    const recovering = O_recovering(S);
    const p = recovering ? Math.max(K.aggro, K.punish) : K.aggro;
    if (!this.rng.chance(p * 0.35 + 0.05)) return;
    const pick = this.rng.weighted(cands, (x) => x.w)!.r;
    // on the beat: a good player waits for the next 8th-note line (when it comes soon), and lands near it
    let at = t;
    if (this.rng.chance(K.beatWait)) {
      const spb = 60 / S.bpm, b = S.beat, line = Math.ceil(b * 2 - 1e-6) / 2, wait = (line - b) * spb;
      if (wait < 0.16) at = t + wait - (S.dt * 0.75);
    }
    at += this.rng.normal() * K.beatSd * 0.5;
    this.pending = { move: pick.name, at: Math.max(t, at), dir, why: `strike ${pick.name}` };
  }

  /** an attack seen starting (its start event, a reaction time old): jump it, dodge it, block it or strike back */
  private answer(S: Sight, c: Character, O: Character, me: Snap, t: number) {
    const K = this.K;
    const moves = S.partner?.moves ?? [];
    for (const m of moves as SeenMove[]) {
      if (!m.attack || this.answered.has(m.serial)) continue;
      // (one reaction time per attack, drawn when it is first in sight)
      let lag = this.seenAt.get(m.serial);
      if (lag == null) { lag = this.rng.reaction(K.react, K.sigma, K.lapse); this.seenAt.set(m.serial, lag); }
      if (m.age < lag) continue;
      this.answered.add(m.serial);
      if (this.seenAt.size > 64) { const k = this.seenAt.keys().next().value!; this.seenAt.delete(k); }
      const def = MOVES[m.name];
      if (!def?.active) continue;
      const dur = def.dur * tempoScale(m.ev.bpm || S.bpm), a1 = def.active[1] * dur, a0 = def.active[0] * dur;
      if (m.age > a1) continue;
      // will it reach me where I stand? (along the plane, roughly: its reach from where it started, facing me)
      const pl = c.plane!, ds = me.s - ((m.ev.x - pl.origin[0]) * pl.right[0] + (m.ev.z - pl.origin[2]) * pl.right[2]);
      const facing = sgn(m.ev.dir ?? O.dir) === sgn(ds);
      if (!facing || Math.abs(ds) > 2.2) continue;
      if (!this.rng.chance(K.answer)) { this.count('missed'); continue; }
      const left = Math.max(0, a0 - m.age);
      const away = sgn(ds);
      // what to do: jump a low or a ground kick, dodge low under a high one, roll away, block, or hit first
      const low = m.name === 'rasteira' || m.name === 'meia-lua' || m.name === 'armada';
      const roll = this.rng.next();
      if (c.grounded && (low || roll < 0.35) && canStart(c, 'jump')) {
        this.jumpNow(t, 0.42, away); this.why = `jump ${m.name}`; this.count('jump-dodge');
      } else if (c.grounded && roll < 0.55 && left > 0.03) {
        this.pending = { move: 'esquiva', at: t, dir: -away, why: `esquiva ${m.name}` };
      } else if (c.grounded && roll < 0.75) {
        this.pending = { move: 'role', at: t, dir: away, why: `roll from ${m.name}` };
      } else if (left > 0.12 && Math.abs(ds) < 1.0 && canStart(c, 'strike') && c.dir === -away) {
        this.pending = { move: 'strike', at: t, dir: -away, why: `strike back at ${m.name}` };
      } else if (c.grounded) {
        this.pending = { move: 'block', at: t, dir: -away, why: `block ${m.name}` };
      } else {
        // in the air: drift away
        this.stick = away; this.stickSince = t;
      }
      this.nextDecide = Math.min(this.nextDecide, t + 0.3);
    }
  }

  private jumpNow(t: number, hold: number, dir: number) {
    this.jumpPressAt = t; this.jumpUntil = t + hold;
    if (dir) { this.stick = dir; this.stickSince = t; }
  }

  /** the legs: the stick toward the goal along the arena, the jumps it takes to get there, the air jump, a wall jump,
   *  drops, the edge kept */
  private legs(S: Sight, c: Character, me: Snap, surf: Surf[], yKill: number, it: Intent, t: number) {
    const pl = c.plane!, lim = pl.halfWidth - PHYS.wallMargin;
    const g = this.goal;
    const here = c.grounded ? surf.find((q) => q.id === c.support?.id) ?? this.under(surf, me.s, me.y + 0.1) : null;
    let target = this.under(surf, g.s, g.y + 0.2) ?? here;
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
    const minHold = 0.08 + (1 - this.skill) * 0.08;
    let want = this.stick;
    const ds = g.s - me.s;
    // the stick: toward the goal, with a dead band (no dithering at the goal), held a moment once moved
    if (Math.abs(ds) > 0.45) want = sgn(ds);
    else if (Math.abs(ds) < 0.2) want = 0;

    if (c.grounded) this.airUsed = false;
    if (c.grounded && here) {
      // a higher surface: a run-up and a jump; one straight above, a jump from under it
      if (target && target !== here && target.y > here.y + 0.35) {
        const h = target.y - here.y;
        let take: number;
        if (target.solid && !target.ground) take = me.s < target.x0 ? target.x0 - 0.75 : me.s > target.x1 ? target.x1 + 0.75 : me.s;
        else take = clamp(me.s, target.x0 + 0.25, target.x1 - 0.25);
        // (the take-off must be on this surface)
        take = clamp(take, here.x0 + 0.15, here.x1 - 0.15);
        const toward = sgn(clamp(g.s, target.x0 + 0.3, target.x1 - 0.3) - me.s);
        if (Math.abs(take - me.s) < 0.35 && t >= this.jumpUntil + 0.05) {
          this.jumpNow(t, holdFor(Math.min(h + 0.35, 2.05)), toward);
          this.airJumpAt = h + 0.3 > jumpHeight(10) ? t + 0.36 : -1;
          this.count('jump');
          want = toward;
        } else if (Math.abs(take - me.s) >= 0.35) want = sgn(take - me.s);
      } else if (target && target !== here && target.y < here.y - 0.3 && !here.solid && g.s >= here.x0 && g.s <= here.x1) {
        // below, under this one-way ledge: drop through
        if (t >= this.dropUntil + 0.4) { this.dropUntil = t + 0.18; this.count('drop'); }
      } else if (target && target !== here && Math.abs(ds) > 0.5 && (g.s > here.x1 || g.s < here.x0)) {
        // across a gap at about the same height or below: jump it from the edge, running
        const edge = ds > 0 ? here.x1 : here.x0;
        const gap = ds > 0 ? target.x0 - here.x1 : here.x0 - target.x1;
        if (gap > 0.05 && Math.abs(edge - me.s) < 0.55 && t >= this.jumpUntil + 0.05) {
          this.jumpNow(t, holdFor(Math.max(0.6, target.y - here.y + 0.6)), sgn(ds)); this.count('jump'); want = sgn(ds);
          this.airJumpAt = gap > 1.4 || target.y - here.y > 1.6 ? t + 0.34 : -1;
        }
      }
      // never walk off into a pit (nothing to land on above the kill floor within reach)
      if (want !== 0) {
        const ahead = me.s + want * 0.45;
        if (ahead > here.x1 + 0.05 || ahead < here.x0 - 0.05) {
          const land = this.under(surf, ahead, here.y - 0.1);
          if ((!land || land.y < yKill + 0.6) && t > this.jumpPressAt + 0.05 && this.jumpUntil < t) want = 0;
        }
      }
      // showy: flips and cartwheels when there is room and nothing presses
      if (this.style === 'showy' && !this.pending && t - this.lastPress > 0.9 && this.rng.chance(0.012 * this.K.showy * 60 * S.dt)) {
        if (Math.abs(me.s) < lim - 1.5 && this.rng.chance(0.5)) this.pending = { move: 'au', at: t, dir: want || c.dir, why: 'au' };
        else if (t >= this.jumpUntil + 0.1) { this.jumpNow(t, holdFor(2), want); this.flipT = t + 0.3; this.count('jump'); }
      }
    } else if (!c.grounded) {
      // in the air: steer to land on the goal's surface; the air jump at the top when it is still too low or over the
      // void; a wall jump off a wall it falls against
      const landing = this.under(surf, me.s, me.y);
      const void_ = !landing || landing.y < yKill + 0.5;
      const aimS = target ? clamp(g.s, target.x0 + 0.2, target.x1 - 0.2) : g.s;
      if (Math.abs(aimS - me.s) > 0.25) want = sgn(aimS - me.s);
      if (void_) {
        // back over something: the nearest surface edge
        let best = Infinity, bs = me.s;
        for (const q of surf) { if (q.y > me.y + 2.5 || q.y < yKill + 0.5) continue; const e = clamp(me.s, q.x0 + 0.3, q.x1 - 0.3), dd = Math.abs(e - me.s); if (dd < best) { best = dd; bs = e; } }
        want = sgn(bs - me.s);
        if (me.vy < 0.5 && (this.airJumpAt < 0 || t >= this.airJumpAt)) { this.airJumpAt = t; this.pressAirJump(t); }
      } else if (this.airJumpAt > 0 && t >= this.airJumpAt && me.vy < 1.2) {
        this.airJumpAt = -1; this.pressAirJump(t);
      }
      // a wall: falling against it, pushing into it: kick off (the body's wall jump, or the air jump where it has none)
      const nearWall = this.wallNear(pl, me.s, me.y);
      if (nearWall && me.vy < 0.8 && t >= this.jumpUntil + 0.12 && (want === nearWall.into || this.goal.why === 'wall chain' || void_)) {
        want = nearWall.into;
        if (this.rng.chance(this.style === 'showy' ? 0.5 : 0.25 + 0.5 * this.skill)) {
          this.jumpNow(t, 0.3, -nearWall.into);
          this.airUsed = false;
          this.count('wall-jump');
          if (this.goal.why === 'wall chain') this.goal = { ...this.goal, s: clamp(-sgn(me.s) * (lim - 0.1), -lim, lim) };
        }
      }
      // a flip at the top of a showy jump
      if (this.flipT > 0 && t >= this.flipT && Math.abs(me.vy) < 2 && canStart(c, 'spin')) {
        this.flipT = -1; this.pending = { move: 'spin', at: t, dir: c.dir, why: 'flip' };
      }
      // fast fall onto the goal when it is right below and the jump is spent
      if (!void_ && target && me.vy < 0 && Math.abs(aimS - me.s) < 0.3 && me.y > target.y + 0.8 && this.jumpUntil < t) this.down = t + 0.1;
    }

    // the dash, where the body has one: to close a long gap on the ground, or back to the stage from the void
    if (this.hadDash && !this.pending && t - this.lastPress > 0.6) {
      const far = Math.abs(ds) > 3 && c.grounded && this.style !== 'evasive' && this.rng.chance(0.02);
      if (far) { (it as Intent & { dash?: boolean }).dash = true; this.lastPress = t; this.count('dash'); }
    }

    // the thumbs: the stick holds a while once moved
    if (want !== this.stick && (t - this.stickSince >= minHold || this.stickSince < 0)) { this.stick = want; this.stickSince = t; }
    it.moveX = this.stick;
    // the jump: pressed once, held for its height (a committed jump: the stick stays while it rises)
    if (this.jumpPressAt === t) it.jump = true;
    it.jumpHeld = t <= this.jumpUntil;
    if (t <= this.dropUntil || t <= this.down) it.moveY = -1;
  }

  private pressAirJump(t: number) {
    if (this.airUsed) return;
    this.airUsed = true;
    this.jumpPressAt = t; this.jumpUntil = t + 0.3; this.count('air-jump');
  }

  /** a wall within reach of the body at (s, y): the plane's ends or the plane's own walls; `into` the stick toward it */
  private wallNear(pl: StagePlane, s: number, y: number): { into: number } | null {
    const lim = pl.halfWidth - PHYS.wallMargin;
    if (s > lim - 0.3) return { into: 1 };
    if (s < -lim + 0.3) return { into: -1 };
    for (const w of ((pl as StagePlane & { walls?: { s: number; side: number; y0: number; y1: number; climb?: boolean }[] }).walls ?? [])) {
      if (w.climb === false || y + 1.2 < w.y0 || y > w.y1) continue;
      // a wall facing +s stands left of the body: the stick into it is -1
      const gap = (s - w.s) * w.side;
      if (gap > 0 && gap < PHYS.halfW + 0.3) return { into: -w.side };
    }
    return null;
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

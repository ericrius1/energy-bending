// The duel's contact physics: two bodies (Characters) catching, swinging, flinging, lifting and vaulting off each other,
// free in 3D or locked to the stage plane, on the ground or in the air (docs/design/duel.md, "The contact dance"). A
// coupling laid over the two bodies after they moved each frame: it reads their poses and velocities and writes their
// roots and velocities (the public state every reader of a Character shares), so the movement kit (runs, jumps, wall
// jumps and runs, dashes) carries on underneath and chains into it. Pure: no DOM, no GPU (tested in Node).
//
//   catch    the grab button (pressed, or pressed a moment before) with a hand within reach of the other's hand,
//            wrist, waist or ankle: the two are joined by a soft link, a rope through the contact. The base (the
//            holder) is the one on the ground or on a wall, else the one who grabbed. Caught out of the air: an aerial
//   swing    while joined the held body orbits the contact: the rope keeps it at its length (its outward speed taken
//            away, its speed round the contact kept), gravity pulls it down the arc, and the base pumps it with the
//            stick (the push round the contact), twice as hard on the beat; a held body on the ground is lifted off it
//   fling    the base lets go (releases the grab): the held body leaves on the swing's tangent, faster, aimed a little by
//            the base's stick and lifted; it is flown until it lands, is caught, or falls
//   lift     the held body, above the contact, jumps: it launches off the base's hands higher than any jump
//   counter  the held body, below or level, jumps or dodges: it spins out of the hold its own way (never stuck)
//   vault    a body falling onto the other's head and shoulders bounces off them (a body is a platform)
// While joined the base stands braced (its stick is the pump, not its run), and both reach for the contact: the pose
// pass (`pose`) puts the holding hand and the held part on it, the held body's arms stretched out.
import { Character } from '../dancer/character';
import { solidBound, solidContact } from '../dancer/solid-contact';
import { J } from '../dancer/moves';
import { planeNormal } from '../engine/camera';

type V3 = [number, number, number];

export const CONTACT = {
  /** how near a hand must come to a hand, a wrist, the waist or an ankle to catch it (m), and in the air */
  REACH: 0.55,
  REACH_AIR: 0.75,
  /** a grab pressed is good for this long (s): a catch timed a moment early still lands */
  BUFFER: 0.2,
  /** the rope's length: as caught, within these (m) */
  REST_MIN: 0.75,
  REST_MAX: 1.45,
  /** the pump (m/s² round the contact), twice on the beat; a carried body's gravity (eased: it is held), its damping
   *  (1/s) and its top speed (m/s) */
  PUMP: 22,
  PUMP_BEAT: 2,
  CARRY_G: 9,
  CARRY_DAMP: 0.35,
  CARRY_MAX: 13,
  /** a swing link for every this many radians round the contact (at most SWINGS a hold) */
  SWING_ARC: Math.PI * 0.8,
  SWINGS: 4,
  /** the fling: the held body's speed times FLING, plus the base's aim and a lift (m/s), at most MAX_SPEED */
  FLING: 1.35,
  FLING_AIM: 4.5,
  FLING_UP: 2.6,
  MAX_SPEED: 17,
  /** a fling's flight counts as landed within this (s) */
  FLOWN_MAX: 3,
  /** the lift's launch (m/s up: the duel's jump is 13.3) and the counter's push */
  LAUNCH: 16,
  COUNTER: 6,
  /** the vault's bounce (m/s up), where on the other it lands (horizontal reach, height above its feet) */
  VAULT: 12.5,
  VAULT_R: 0.5,
  VAULT_Y: [1.25, 2.0] as [number, number],
  /** a hold lets go by itself after this long (s), or when stretched past BREAK (m) */
  HOLD_MAX: 3.2,
  BREAK: 2.8,
  /** a body can't be caught again for this long after a fling or a counter (s) */
  REGRAB: 0.35,
};

/** what a seat's thumbs say to the contact this frame */
export interface ContactInput {
  /** the grab: held (keep the link), pressed this frame */
  grab: boolean;
  grabEdge: boolean;
  /** jump and dodge pressed this frame (a held body's lift or counter) */
  jump: boolean;
  dodge: boolean;
  /** the stick as a world direction (x, z; length 0 … 1) */
  stick: [number, number];
}
export const noInput = (): ContactInput => ({ grab: false, grabEdge: false, jump: false, dodge: false, stick: [0, 0] });

export type ContactKind = 'catch' | 'aerial' | 'swing' | 'fling' | 'flown' | 'lift' | 'counter' | 'vault' | 'landed' | 'release';
export interface ContactEvent { kind: ContactKind; seat: number; other: number; perfect: boolean; at: V3; speed?: number; /** a fling's velocity (world) */ v?: V3; /** a release's cause: stretched past BREAK, or a body re-forming */ why?: 'stretched' | 'reform' }

export interface Link {
  holder: number;
  held: number;
  /** the part of the held body caught: a hand, the waist, an ankle */
  part: 'hand' | 'waist' | 'ankle';
  rest: number;
  since: number;
  /** radians swung round the contact since the last swing link, swings so far, a pump on the beat since then */
  arc: number;
  swings: number;
  beatPump: boolean;
  /** the contact point now (world) */
  at: V3;
  /** carried: the held body flying round the contact (its centre and velocity, the link's own) */
  flying: boolean;
  c: V3;
  v: V3;
  /** which way round it is pumped (+1, -1) */
  sense: number;
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const lm = (c: Character, j: number): V3 => [c.pose[3 * j], c.pose[3 * j + 1], c.pose[3 * j + 2]];

export class Contact {
  link: Link | null = null;
  /** a fling in flight: who flung whom, since when */
  flown: { flinger: number; flyer: number; since: number } | null = null;
  private grabT = [-1, -1];
  private noGrab = [0, 0];
  private vaultT = [0, 0];
  private t = 0;
  private ct = { d: 0, n: [0, 0, 0] as [number, number, number] };

  constructor(readonly chars: readonly [Character, Character]) {}

  /** how long the link has held (s), 0 without one */
  get age() { return this.link ? this.t - this.link.since : 0; }
  /** whether seat k is the base of a link / is held */
  holding(k: number) { return this.link?.holder === k; }
  held(k: number) { return this.link?.held === k; }

  /** the pivot a holder swings round: its chest, the arm reaching a little toward the held body */
  private pivot(h: Character, toward: V3): V3 {
    const p: V3 = [h.root[0], h.root[1] + 1.3, h.root[2]];
    const d = sub(toward, p), l = len(d) || 1;
    return [p[0] + (d[0] / l) * 0.3, p[1] + (d[1] / l) * 0.3, p[2] + (d[2] / l) * 0.3];
  }
  /** the held body's centre (the point the rope pulls) */
  private centre(c: Character): V3 { return [c.root[0], c.root[1] + 1.0, c.root[2]]; }
  /** a direction kept in the locked plane (its depth across taken away) */
  private flat(c: Character, v: V3): V3 {
    if (!c.plane) return v;
    const n = planeNormal(c.plane), d = v[0] * n[0] + v[2] * n[2];
    return [v[0] - n[0] * d, v[1], v[2] - n[2] * d];
  }

  /** a grab by seat k: the nearest of its hands to the other's hands, waist and ankles, within reach */
  private tryCatch(k: number): { part: Link['part']; at: V3 } | null {
    const a = this.chars[k], b = this.chars[1 - k];
    if (a.reforming || b.reforming) return null;
    const reach = a.grounded && b.grounded ? CONTACT.REACH : CONTACT.REACH_AIR;
    const hands = [lm(a, J.LW), lm(a, J.RW)];
    const waist: V3 = [(b.pose[3 * J.LH] + b.pose[3 * J.RH]) / 2, (b.pose[3 * J.LH + 1] + b.pose[3 * J.RH + 1]) / 2, (b.pose[3 * J.LH + 2] + b.pose[3 * J.RH + 2]) / 2];
    const targets: [Link['part'], V3][] = [['hand', lm(b, J.LW)], ['hand', lm(b, J.RW)], ['waist', waist], ['ankle', lm(b, J.LA)], ['ankle', lm(b, J.RA)]];
    let best: { part: Link['part']; at: V3 } | null = null, bd = reach;
    for (const h of hands) for (const [part, p] of targets) {
      const d = len(sub(h, p));
      if (d < bd) { bd = d; best = { part, at: [(h[0] + p[0]) / 2, (h[1] + p[1]) / 2, (h[2] + p[2]) / 2] }; }
    }
    return best;
  }

  /** each frame, after both bodies moved: catches, the rope, the pump, flings, lifts, counters, vaults */
  step(inputs: readonly [ContactInput, ContactInput], dt: number, onBeat: boolean): ContactEvent[] {
    const out: ContactEvent[] = [], C = this.chars;
    this.t += dt;
    for (let k = 0; k < 2; k++) {
      if (inputs[k].grabEdge) this.grabT[k] = this.t;
      this.vaultT[k] = Math.max(0, this.vaultT[k] - dt);
    }
    // ---- a catch (a grab pressed lately, still held, a hand within reach)
    if (!this.link) {
      for (let k = 0; k < 2; k++) {
        if (!inputs[k].grab || this.t - this.grabT[k] > CONTACT.BUFFER || this.t < this.noGrab[k]) continue;
        const c = this.tryCatch(k);
        if (!c) continue;
        const a = C[k], b = C[1 - k];
        // the base: the one on the ground or a wall; when both or neither, the one who grabbed
        const aBase = a.grounded || a.onWall, bBase = b.grounded || b.onWall;
        const holder = aBase === bBase ? k : aBase ? k : 1 - k, held = 1 - holder;
        const hp = this.pivot(C[holder], this.centre(C[held])), rest = Math.min(CONTACT.REST_MAX, Math.max(CONTACT.REST_MIN, len(sub(this.centre(C[held]), hp))));
        const F0 = C[held];
        this.link = { holder, held, part: c.part, rest, since: this.t, arc: 0, swings: 0, beatPump: false, at: c.at, flying: false, c: this.centre(F0), v: [F0.v[0], F0.v[1], F0.v[2]], sense: 1 };
        this.grabT[k] = -1;
        // (a fling caught: the flight ends in a catch, which the flinger is credited for)
        if (this.flown && this.flown.flyer === (1 - k)) { out.push({ kind: 'landed', seat: this.flown.flinger, other: this.flown.flyer, perfect: false, at: c.at }); this.flown = null; }
        out.push({ kind: b.grounded ? 'catch' : 'aerial', seat: k, other: 1 - k, perfect: onBeat, at: c.at });
        break;
      }
    }
    // ---- the link
    const L = this.link;
    if (L) {
      const H = C[L.holder], F = C[L.held], hin = inputs[L.holder], fin = inputs[L.held];
      const c = this.centre(F), p = this.pivot(H, c);
      let r = sub(c, p);
      const d = len(r) || 1e-6;
      let n: V3 = [r[0] / d, r[1] / d, r[2] / d];
      L.at = [p[0] + n[0] * 0.25, p[1] + n[1] * 0.25, p[2] + n[2] * 0.25];
      const tooLong = this.t - L.since > CONTACT.HOLD_MAX, broken = d > CONTACT.BREAK || F.reforming || H.reforming;
      // the held body's own moves: a lift (above the contact) or a counter, its jump or dodge
      if ((fin.jump || fin.dodge) && !broken) {
        // (at the contact's height or above: swung round at chest height counts, its feet off the ground)
        const above = c[1] > p[1] - 0.35;
        const s = fin.stick;
        if (above && fin.jump) {
          this.setV(F, [F.v[0] + s[0] * 3, CONTACT.LAUNCH, F.v[2] + s[1] * 3]);
          out.push({ kind: 'lift', seat: L.held, other: L.holder, perfect: onBeat, at: L.at });
        } else {
          const sl = Math.hypot(s[0], s[1]), dir: [number, number] = sl > 0.2 ? [s[0] / sl, s[1] / sl] : [n[0], n[2]];
          this.setV(F, [dir[0] * CONTACT.COUNTER, Math.max(F.v[1], 4.5), dir[1] * CONTACT.COUNTER]);
          out.push({ kind: 'counter', seat: L.held, other: L.holder, perfect: onBeat, at: L.at });
        }
        this.noGrab[L.holder] = this.t + CONTACT.REGRAB;
        this.link = null;
        return out;
      }
      // the base lets go: the fling
      if (!hin.grab || tooLong || broken) {
        if (!broken) {
          const v = F.v, s = hin.stick;
          const fv: V3 = [v[0] * CONTACT.FLING + s[0] * CONTACT.FLING_AIM, v[1] * CONTACT.FLING + CONTACT.FLING_UP, v[2] * CONTACT.FLING + s[1] * CONTACT.FLING_AIM];
          const sp = len(fv);
          if (sp > CONTACT.MAX_SPEED) for (let a = 0; a < 3; a++) fv[a] *= CONTACT.MAX_SPEED / sp;
          this.setV(F, fv);
          this.flown = { flinger: L.holder, flyer: L.held, since: this.t };
          out.push({ kind: 'fling', seat: L.holder, other: L.held, perfect: onBeat, at: L.at, speed: len(fv), v: [fv[0], fv[1], fv[2]] });
          out.push({ kind: 'flown', seat: L.held, other: L.holder, perfect: onBeat, at: L.at });
        } else out.push({ kind: 'release', seat: L.holder, other: L.held, perfect: false, at: L.at, why: F.reforming || H.reforming ? 'reform' : 'stretched' });
        this.noGrab[L.holder] = this.t + CONTACT.REGRAB;
        this.link = null;
        return out;
      }
      // the swing. Until it is pumped (or if it was caught standing and is left standing) the link is a soft rope: past
      // its length the held body is brought back, its outward speed taken away. Pumped, or caught in the air, the held
      // body is carried: it flies round the contact as a weight on a rope of the link's length (its own gravity eased:
      // it is held), pumped round by the base's stick, twice as hard on the beat, its feet kept off the ground below
      // (free: round the base at about chest height; locked: arcs in the stage's plane down to the knees). A base
      // itself in the air is pulled as much as the held body: the two orbit their middle
      const wH = H.grounded || H.onWall ? 0 : 0.5;
      const s = hin.stick, sl = Math.hypot(s[0], s[1]);
      if (!L.flying && (sl > 0.2 || !F.grounded)) { L.flying = true; L.c = c; L.v = [F.v[0], F.v[1], F.v[2]]; }
      if (!L.flying) {
        if (d > L.rest) {
          const corr = d - L.rest;
          this.move(F, [-n[0] * corr, -n[1] * corr, -n[2] * corr]);
          const vr = (F.v[0] - H.v[0]) * n[0] + (F.v[1] - H.v[1]) * n[1] + (F.v[2] - H.v[2]) * n[2];
          if (vr > 0) this.setV(F, [F.v[0] - n[0] * vr, F.v[1] - n[1] * vr, F.v[2] - n[2] * vr]);
        }
      } else {
        const v = L.v;
        v[1] -= CONTACT.CARRY_G * dt;
        if (sl > 0.2) {
          // the way round: free, the horizontal tangent (up × the rope); locked, the tangent in the stage's plane. The
          // stick starts the spin its way (across the rope); after that any stick keeps it going (a player leaning into
          // it), and only a stick pushed hard against the way it goes turns it round
          let tg: V3;
          if (F.plane) { const R = F.plane.right, a = n[0] * R[0] + n[2] * R[2], b = n[1]; tg = [-b * R[0], a, -b * R[2]]; }
          else { const h = Math.hypot(n[0], n[2]) || 1; tg = [-n[2] / h, 0, n[0] / h]; }
          const across = s[0] * tg[0] + s[1] * tg[2], vt = v[0] * tg[0] + v[1] * tg[1] + v[2] * tg[2];
          if (Math.abs(vt) < 1 && Math.abs(across) > 0.3 * sl) L.sense = Math.sign(across);
          else if (Math.abs(vt) >= 1) {
            L.sense = Math.sign(vt);
            const vl = Math.hypot(v[0], v[2]) || 1;
            if ((s[0] * v[0] + s[1] * v[2]) / (vl * sl) < -0.6) L.sense = -L.sense;
          }
          const tv: V3 = [tg[0] * L.sense * sl, tg[1] * L.sense * sl, tg[2] * L.sense * sl];
          const k = CONTACT.PUMP * dt * (onBeat ? CONTACT.PUMP_BEAT : 1);
          if (onBeat) L.beatPump = true;
          for (let a = 0; a < 3; a++) v[a] += tv[a] * k;
        }
        const damp = Math.exp(-CONTACT.CARRY_DAMP * dt);
        for (let a = 0; a < 3; a++) v[a] *= damp;
        const sp = len(v);
        if (sp > CONTACT.CARRY_MAX) for (let a = 0; a < 3; a++) v[a] *= CONTACT.CARRY_MAX / sp;
        const fv = this.flat(F, v);
        let q: V3 = [L.c[0] + fv[0] * dt, L.c[1] + fv[1] * dt, L.c[2] + fv[2] * dt];
        // on the rope: at its length from the contact, the speed along the rope taken away
        const rq = sub(q, p), dq = len(rq) || 1e-6, nq: V3 = [rq[0] / dq, rq[1] / dq, rq[2] / dq];
        q = [p[0] + nq[0] * L.rest, p[1] + nq[1] * L.rest, p[2] + nq[2] * L.rest];
        const vr = fv[0] * nq[0] + fv[1] * nq[1] + fv[2] * nq[2];
        let nv: V3 = [fv[0] - nq[0] * vr, fv[1] - nq[1] * vr, fv[2] - nq[2] * vr];
        // its feet kept off the ground below
        const low = F.plane ? Math.max(H.root[1] + 0.55, F.groundY + 1.02) : H.root[1] + 1.05;
        if (q[1] < low) { q[1] = low; if (nv[1] < 0) nv = [nv[0], 0, nv[2]]; }
        // (free, the world's solids stop the swing: a body swung into a block or a column stays out of it, bounced off)
        const hit = F.plane ? null : this.into(F, q);
        if (hit) {
          q = [L.c[0], L.c[1], L.c[2]];
          const vn = nv[0] * hit[0] + nv[1] * hit[1] + nv[2] * hit[2];
          if (vn < 0) nv = [nv[0] - hit[0] * vn * 1.4, nv[1] - hit[1] * vn * 1.4, nv[2] - hit[2] * vn * 1.4];
        }
        const step: V3 = [q[0] - L.c[0], q[1] - L.c[1], q[2] - L.c[2]];
        if (wH) this.move(H, [-step[0] * wH * 0.5, -step[1] * wH * 0.5, -step[2] * wH * 0.5]);
        L.c = q; L.v = nv;
        F.root[0] = q[0]; F.root[1] = q[1] - 1.0; F.root[2] = q[2];
        F.v = [nv[0], nv[1], nv[2]]; F.grounded = false; F.support = null;
      }
      // swings: the arc travelled round the contact
      r = sub(this.centre(F), p);
      const rl = len(r) || 1;
      n = [r[0] / rl, r[1] / rl, r[2] / rl];
      const vt = sub(F.v as unknown as V3, H.v as unknown as V3), vrad = vt[0] * n[0] + vt[1] * n[1] + vt[2] * n[2];
      void d;
      const tang = Math.sqrt(Math.max(0, vt[0] ** 2 + vt[1] ** 2 + vt[2] ** 2 - vrad * vrad));
      L.arc += (tang / rl) * dt;
      if (L.arc >= CONTACT.SWING_ARC && L.swings < CONTACT.SWINGS) {
        L.arc = 0; L.swings++;
        out.push({ kind: 'swing', seat: L.holder, other: L.held, perfect: L.beatPump, at: L.at });
        L.beatPump = false;
      }
    }
    // ---- a fling's flight: landed (on its feet or a wall) or fallen
    const fl = this.flown;
    if (fl) {
      const f = C[fl.flyer];
      if ((f.grounded || f.onWall) && this.t - fl.since > 0.15) { out.push({ kind: 'landed', seat: fl.flinger, other: fl.flyer, perfect: false, at: [f.root[0], f.root[1], f.root[2]] }); this.flown = null; }
      else if (f.reforming || this.t - fl.since > CONTACT.FLOWN_MAX) this.flown = null;
    }
    // ---- vaults: a body falling onto the other's head and shoulders bounces off them
    for (let k = 0; k < 2; k++) {
      const a = C[k], b = C[1 - k];
      if (this.link || a.grounded || a.v[1] > 0 || this.vaultT[k] > 0 || a.reforming || b.reforming) continue;
      const dx = a.root[0] - b.root[0], dz = a.root[2] - b.root[2], dy = a.root[1] - b.root[1];
      if (Math.hypot(dx, dz) < CONTACT.VAULT_R && dy > CONTACT.VAULT_Y[0] && dy < CONTACT.VAULT_Y[1]) {
        const s = inputs[k].stick;
        this.setV(a, [a.v[0] * 0.5 + s[0] * 3, CONTACT.VAULT, a.v[2] * 0.5 + s[1] * 3]);
        this.setV(b, [b.v[0], Math.min(b.v[1], -1), b.v[2]]);
        this.vaultT[k] = 0.4;
        out.push({ kind: 'vault', seat: k, other: 1 - k, perfect: onBeat, at: [b.root[0], b.root[1] + 1.6, b.root[2]] });
      }
    }
    return out;
  }

  /** a body's velocity set (kept in its plane when locked; in the air from here on if it goes up) */
  private setV(c: Character, v: V3) {
    const f = this.flat(c, v);
    c.v = [f[0], f[1], f[2]];
    if (f[1] > 0.5 && c.grounded) { c.grounded = false; c.support = null; }
  }
  /** a body moved by d (kept in its plane when locked) */
  private move(c: Character, d: V3) {
    const f = this.flat(c, d);
    c.root[0] += f[0]; c.root[1] += f[1]; c.root[2] += f[2];
    if (f[1] > 0.02 && c.grounded) { c.grounded = false; c.support = null; }
  }

  /** a carried body's centre at q inside one of the world's solids: the way out of it (the normal), else null */
  private into(F: Character, q: V3): V3 | null {
    const solids = F.terrain.solids;
    if (!solids || !solids.length) return null;
    const R = F.phys.bodyR + 0.05;
    for (const s of solids) {
      const b = solidBound(s);
      if (Math.hypot(q[0] - b.c[0], q[2] - b.c[2]) > b.R + 1 || b.y1 < q[1] - 1 || b.y0 > q[1] + 0.8) continue;
      for (const dy of [-0.6, 0, 0.55]) {
        solidContact(s, q[0], q[1] + dy, q[2], this.ct);
        if (this.ct.d < R) return [this.ct.n[0], this.ct.n[1], this.ct.n[2]];
      }
    }
    return null;
  }

  /** the pose pass, after a body's own pose (Character.update): the holder's nearer hand on the contact, the held
   *  body's caught hand on it too and its other arm reaching out along the swing; the base's hips braced a little */
  pose(k: number) {
    const L = this.link;
    if (!L || (L.holder !== k && L.held !== k)) return;
    const c = this.chars[k], P = c.pose, at = L.at;
    const put = (wj: number, ej: number, sj: number, w: number) => {
      const W = lm(c, wj), S = lm(c, sj);
      const x = W[0] + (at[0] - W[0]) * w, y = W[1] + (at[1] - W[1]) * w, z = W[2] + (at[2] - W[2]) * w;
      P[3 * wj] = x; P[3 * wj + 1] = y; P[3 * wj + 2] = z;
      // the elbow halfway, a little below the line (an arm, not a stick)
      P[3 * ej] = (S[0] + x) / 2; P[3 * ej + 1] = (S[1] + y) / 2 - 0.05; P[3 * ej + 2] = (S[2] + z) / 2;
    };
    const near = len(sub(lm(c, J.LW), at)) < len(sub(lm(c, J.RW), at));
    if (k === L.holder || L.part === 'hand') {
      if (near) put(J.LW, J.LE, J.LS, 1); else put(J.RW, J.RE, J.RS, 1);
    }
    if (k === L.held) {
      // the other arm stretched out along the swing, away from the contact
      const other = near ? [J.RW, J.RE, J.RS] : [J.LW, J.LE, J.LS];
      const S = lm(c, other[2]), d = sub(S, at), l = len(d) || 1;
      const reach: V3 = [S[0] + (d[0] / l) * 0.55, S[1] + (d[1] / l) * 0.55, S[2] + (d[2] / l) * 0.55];
      const W = lm(c, other[0]);
      for (let a = 0; a < 3; a++) { P[3 * other[0] + a] = W[a] + (reach[a] - W[a]) * 0.7; P[3 * other[1] + a] = (S[a] + P[3 * other[0] + a]) / 2; }
    }
  }
}

/** a seat's Intent split between its body and the contact: the grab is the punch button (held: keep the link; let go:
 *  the fling), taken from the body (no strikes in the dance battle); a base holding braces (its stick is the pump, its
 *  jump nothing), a held body's jump and dodge are its lift and counter. Returns what the contact reads; `it` is left
 *  as the body should see it */
export function splitIntent(c: Character, it: { moveX: number; moveZ: number; jump: boolean; jumpHeld: boolean; punch: boolean; punchHeld: boolean; dodge: boolean; dodgeHeld: boolean }, holding: boolean, held: boolean): ContactInput {
  let sx: number, sz: number;
  if (c.plane) { sx = c.plane.right[0] * it.moveX; sz = c.plane.right[2] * it.moveX; }
  else {
    // (Character's camera-relative stick: world = (x cos + z sin, -x sin + z cos), x = moveX, z = -moveZ)
    const cy = Math.cos(c.inputYaw), sy = Math.sin(c.inputYaw), x = it.moveX, z = -(it.moveZ || 0);
    sx = x * cy + z * sy; sz = -x * sy + z * cy;
  }
  const l = Math.hypot(sx, sz);
  if (l > 1) { sx /= l; sz /= l; }
  const ci: ContactInput = { grab: !!(it.punchHeld || it.punch), grabEdge: !!it.punch, jump: !!it.jump, dodge: !!it.dodge, stick: [sx, sz] };
  it.punch = false; it.punchHeld = false;
  if (holding) { it.moveX = 0; it.moveZ = 0; it.jump = false; it.jumpHeld = false; }
  if (held) { it.jump = false; it.dodge = false; it.dodgeHeld = false; }
  return ci;
}

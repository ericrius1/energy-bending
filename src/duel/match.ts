// A duel between two bodies: the rules (shared/duel.ts) joined to two Characters on the arena's plane. Pure (no DOM,
// no GPU), so the page (src/duel/index.ts) and the Node harness (sim.ts) run the same thing. Each frame, after the
// bodies moved: each body is read as the rules want it (its hit and hurt capsules flattened onto the plane, the move
// it is in and the beat that move started on), the rules step, and what they decided is done to the bodies: the
// knockback (Character.applyKnock, along the plane), a KO's re-forming at the spawn the rules chose (Character.spawn,
// which re-forms at its plane's spawns[seat]: the duel's own copy of the arena's plane, whose spawns it moves), the
// round's start (both re-form at the round's spawns). `frozen(seat)` says when a seat's controls are held.
import type { Character, Capsule } from '../dancer/character';
import type { StagePlane } from '../engine/camera';
import { DUEL, newDuel, duelStep, frozen, untouchable, restartDuel, type DuelBody, type DuelEvent, type DuelState, type Seg } from '../../shared/duel.ts';
import type { Arena } from './arena';

/** the duel's own copy of an arena's plane: its spawns are the two seats' re-forming points, moved by the duel */
export function duelPlane(a: Arena): StagePlane {
  return { ...a.plane, spawns: [[a.spawns[0][0], a.spawns[0][1]], [a.spawns[1][0], a.spawns[1][1]]] };
}

export class DuelMatch {
  readonly state: DuelState;
  /** what the last step decided */
  events: DuelEvent[] = [];
  /** every event so far with its time (ms), trimmed (probes, the films' logs) */
  readonly history: { t: number; e: DuelEvent }[] = [];
  bpm = 112;
  private starts = [{ serial: -1, beat: 0 }, { serial: -1, beat: 0 }];

  constructor(readonly chars: readonly [Character, Character], readonly arena: Arena, readonly plane: StagePlane, now = 0, bpm = 112) {
    this.bpm = bpm;
    this.state = newDuel(now, bpm);
  }

  /** a seat's controls are held (the count-in, scattered, re-forming) */
  frozen(seat: number) { return frozen(this.state, seat); }
  untouchable(seat: number, now: number) { return untouchable(this.state, seat, now); }
  restart(now: number) { restartDuel(this.state, now, this.bpm); }

  /** a world capsule flattened onto the plane */
  private seg(c: Capsule): Seg {
    const p = this.plane, o = p.origin, r = p.right;
    return { ax: (c.ax - o[0]) * r[0] + (c.az - o[2]) * r[2], ay: c.ay - o[1], bx: (c.bx - o[0]) * r[0] + (c.bz - o[2]) * r[2], by: c.by - o[1], r: c.r };
  }
  /** one body as the rules read it */
  body(k: number): DuelBody {
    const c = this.chars[k], m = c.move, hit = c.hitShapes();
    return {
      s: c.s, y: c.root[1] - this.plane.origin[1],
      hurt: c.hurtShapes().map((x) => this.seg(x)), hit: hit.map((x) => this.seg(x)),
      move: m?.name ?? null, serial: hit.length && m ? m.serial : 0,
      moveBeat: m && this.starts[k].serial === m.serial ? this.starts[k].beat : null,
      facing: c.dir < 0 ? -1 : 1, invulnerable: c.invulnerable, blocking: c.blocking,
    };
  }

  /** each frame, after the bodies moved: the rules, then what they decided done to the bodies */
  step(now: number, beat: number, bpm: number): DuelEvent[] {
    this.bpm = bpm;
    // the beat each body's move started on (seen the first frame it is in it: back by how far it has run)
    for (let k = 0; k < 2; k++) {
      const m = this.chars[k].move;
      if (m && m.serial !== this.starts[k].serial) this.starts[k] = { serial: m.serial, beat: beat - (m.t * bpm) / 60 };
    }
    const ev = duelStep(this.state, now, [this.body(0), this.body(1)], { spawns: this.arena.spawns, yKill: this.arena.bounds.yKill, bpm });
    for (const e of ev) this.apply(e);
    this.events = ev;
    for (const e of ev) this.history.push({ t: Math.round(now), e });
    if (this.history.length > 600) this.history.splice(0, this.history.length - 400);
    return ev;
  }

  private knock(k: number, v: readonly [number, number, number]) {
    const r = this.plane.right;
    this.chars[k].applyKnock(r[0] * v[0], v[1], v[2], r[2] * v[0]);
  }
  private reformAt(k: number, at: readonly [number, number]) {
    this.plane.spawns[k] = [at[0], at[1]];
  }

  private apply(e: DuelEvent) {
    switch (e.k) {
      case 'hit': case 'block': this.knock(e.target, e.knock); break;
      case 'clash': this.knock(e.a, e.knock[0]); this.knock(e.b, e.knock[1]); break;
      // (the body keeps flying with its knock, or falling, while its matter is scattered; if it falls out of the
      // stage on its own it re-forms where the rules chose)
      case 'ko': this.reformAt(e.target, e.reformAt); break;
      case 'reform': { const c = this.chars[e.seat]; this.reformAt(e.seat, e.at); if (!c.reforming) c.spawn(); break; }
      case 'round': for (let k = 0; k < 2; k++) { this.reformAt(k, e.at[k]); this.chars[k].spawn(); } break;
    }
  }

  /** a round's clock: seconds of play, and the count showing */
  clock(now: number) {
    const d = this.state;
    return { time: d.phase === 'countdown' ? 0 : (d.phase === 'won' ? d.since : now) - d.playFrom, count: d.count };
  }
}

export { DUEL };

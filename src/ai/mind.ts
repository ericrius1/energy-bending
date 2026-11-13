// A brain's working memory and its two outputs. Behaviours (behaviours.ts) don't write the Intent themselves: they
// plan presses ("start a meia-lua on the 8th line at beat 37.5, toward the partner; give up if it can't start by
// 37.75") and claim the legs ("walk that way at a third of a run") with a priority, and the Mind turns the winners
// into this frame's Intent: a press on exactly the frame whose start lands nearest its grid line, and the legs of
// the most urgent claim. While a press is waiting the legs stand still (a planned dodge was planned from here).
//
// It also remembers what this dancer has done lately (for variety and for not echoing an echo), and holds the brain's
// Rng, so every behaviour draws from one seeded stream.
import type { Character } from '../dancer/character';
import { MOVES } from '../dancer/moves';
import type { Intent } from '../input/intent';
import { Rng, type BodyHints, type Sight } from './brain';
import { blank, canStart, pressFrame, pressMove, startBeat, stickFor } from './body';
import { solidPush } from './solids';

export interface Press {
  move: string;
  /** the beat to start on (an 8th-note line, or "now") */
  line: number;
  /** how late it may still start (beats past the line) */
  late: number;
  /** the world direction it travels or faces (unit x, z), for aú and rolê "that way" */
  toward: [number, number];
  /** higher wins a clash of plans (an answer beats an offer) */
  prio: number;
  why: string;
  /** hold the dodge button this long (s): a held block */
  hold?: number;
  /** told when it starts (or is dropped) */
  done?: (started: boolean, beat: number) => void;
  /** checked on the frame it would start: false drops it (an offer to a partner who has become busy) */
  ok?: () => boolean;
}

export interface Legs { x: number; z: number; k: number; walk: boolean; prio: number; why: string; jump?: boolean; drop?: boolean; merge?: boolean; crouch?: boolean }

export class Mind {
  readonly rng: Rng;
  presses: Press[] = [];
  legs: Legs | null = null;
  /** what this dancer started lately: name and beat */
  readonly mine: { name: string; beat: number; why: string }[] = [];
  /** serials of the other's moves already dealt with */
  readonly handled = new Set<number>();
  private holdDodge = 0;
  private holdJump = 0;
  private stuck = 0;
  private was: [number, number] = [0, 0];

  constructor(seed: number) { this.rng = new Rng(seed); }

  /** plan a press; a lower-priority plan for an overlapping time is dropped in favour of a higher one */
  plan(p: Press) {
    for (const q of this.presses) if (Math.abs(q.line - p.line) < 0.75 && q.prio >= p.prio) return false;
    this.presses = this.presses.filter((q) => { const keep = !(Math.abs(q.line - p.line) < 0.75 && q.prio < p.prio); if (!keep) q.done?.(false, p.line); return keep; });
    this.presses.push(p);
    this.presses.sort((a, b) => a.line - b.line);
    return true;
  }
  /** is anything at or above this priority waiting? */
  waiting(prio = 0) { return this.presses.some((p) => p.prio >= prio); }
  cancel(pred: (p: Press) => boolean) { this.presses = this.presses.filter((p) => { const x = pred(p); if (x) p.done?.(false, p.line); return !x; }); }

  /** claim the legs (the highest priority this frame wins) */
  claim(l: Legs) { if (!this.legs || l.prio > this.legs.prio) this.legs = l; }

  /** how many of the last n moves were `name` */
  recent(name: string, n = 6) { let k = 0; for (let i = Math.max(0, this.mine.length - n); i < this.mine.length; i++) if (this.mine[i].name === name) k++; return k; }
  lastMine() { return this.mine[this.mine.length - 1] ?? null; }

  /** this frame's Intent from the plans and the legs; the flourish hint if a named move is pressed */
  act(s: Sight, body: BodyHints): Intent {
    const out = blank(), c: Character = s.self;
    const sb = startBeat(s.beatPrev, s.beat);
    // drop what is too late
    this.presses = this.presses.filter((p) => { const late = sb > p.line + p.late; if (late) p.done?.(false, sb); return !late; });
    let p = this.presses[0];
    // a press whose moment has come but whose reason has gone is dropped
    while (p && (pressFrame(p.line, s.beatPrev, s.beat) || sb > p.line) && p.ok && !p.ok()) { this.presses.shift(); p.done?.(false, sb); p = this.presses[0]; }
    let pressed = false;
    if (p && (pressFrame(p.line, s.beatPrev, s.beat) || sb > p.line) && this.canPress(c, p.move)) {
      const fl = pressMove(c, p.move, p.toward, out);
      if (fl) body.flourish = fl;
      this.presses.shift();
      this.mine.push({ name: p.move, beat: sb, why: p.why });
      if (this.mine.length > 24) this.mine.shift();
      if (p.move === 'jump') this.holdJump = p.hold ?? 0.45;
      else if (p.hold) this.holdDodge = p.hold;
      p.done?.(true, sb);
      pressed = true;
    }
    if (this.holdDodge > 0) { out.dodgeHeld = true; this.holdDodge -= s.dt; }
    if (this.holdJump > 0) { out.jumpHeld = true; this.holdJump -= s.dt; }
    // legs: still while a press waits close by (it was planned from here), else the claim
    const soon = !!p && p.line - sb < 0.75 && p.prio >= 2;
    const L = this.legs;
    if (!pressed && L && !soon) {
      // free on the floor: never into a world's solid thing (the redwoods' log, a column): the part of the stick that
      // goes into the nearest one goes, and a push away from it comes in as it nears (StageView.solids)
      const push = c.plane ? null : solidPush(s.stage.solids, c.x, c.y, c.z);
      if (!push) stickFor(c, L.x, L.z, L.k, out);
      else {
        let lx = L.x * L.k, lz = L.z * L.k;
        const into = -(lx * push.x + lz * push.z);
        if (into > 0) { lx += push.x * into; lz += push.z * into; }
        lx += push.x * push.k * 0.8; lz += push.z * push.k * 0.8;
        stickFor(c, lx, lz, 1, out);
      }
      if (L.walk) out.walk = true;
      if (L.jump) { out.jump = true; out.jumpHeld = true; this.holdJump = 0.45; }
      if (L.drop || L.crouch) out.moveY = -1;
      if (L.merge) out.merge = true;
      // pushing and not getting anywhere (a solid ledge in the way): over it
      const moved = Math.hypot(c.x - this.was[0], c.z - this.was[1]);
      this.stuck = L.k > 0.1 && moved < 0.2 * L.k * s.dt && c.grounded && !c.move ? this.stuck + s.dt : 0;
      if (this.stuck > 0.35) { out.jump = true; out.jumpHeld = true; this.holdJump = 0.45; this.stuck = 0; }
    } else if (L?.merge) out.merge = true;
    this.was[0] = c.x; this.was[1] = c.z;
    this.legs = null;
    return out;
  }

  private canPress(c: Character, name: string) {
    if (name === 'jump') return c.grounded && !c.move;
    if (!MOVES[name] && name !== 'jump') return false;
    return canStart(c, name);
  }
}

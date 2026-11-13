// Scripted play: two dancers taken through a jogo from JSON, for the captures and the films (and the tests). The
// script is read on the jogo's own clock (the room's, moved on by each frame's dt), so stepped with `bend.step` it
// repeats exactly. Times are in beats from the first beat of play (the bar line the intro ends on); a cue's `at` may be
// fractional (0.5 is the off-beat 8th).
//
//   {
//     "world": "pool", "lock": true, "dress": ["fire", "water"],      // where, locked or free, what each seat wears
//     "cues": [
//       { "at": 0,    "seat": 0, "move": "meia-lua" },                 // a move by name (dancer/moves.ts), now
//       { "at": 0.25, "seat": 1, "press": "dodge", "hold": { "moveY": -1 }, "for": 0.5 },   // a button, a stick held
//       { "at": 2,    "seat": 1, "goto": 0.4 },                        // walk to s on the stage (or x free), then stop
//       { "at": 4,    "seat": 0, "press": "form" },                    // edges: jump punch kick spin dodge form interact
//       { "at": 6,    "seat": 0, "build": true },                      // arm the build button (the next perfect move sets)
//       { "at": 8,    "seat": "both", "hold": { "merge": true }, "for": 12 },
//       { "at": 1,    "tension": 80 },                                 // (a local room only) set the rules' tension: a
//                                                                      //   shortcut for a film that can't wait for it
//       { "at": 3,    "place": 0.5, "seat": 0 }                        // stand somewhere now
//     ]
//   }
// Seats with no cue at a moment dance their ginga. A script runs only in a local room (both seats on this page).
import type { IntentController } from '../dancer/intent-controller';
import type { Intent } from '../input/intent';

export interface Cue {
  at: number;
  seat?: number | 'both';
  move?: string;
  press?: string | string[];
  hold?: Partial<Intent>;
  for?: number;
  goto?: number;
  place?: number;
  build?: boolean;
  tension?: number;
}
export interface JogoScript {
  name?: string;
  world?: string;
  lock?: boolean;
  dress?: string[];
  cues: Cue[];
}

const EDGE_OK = new Set(['jump', 'punch', 'kick', 'spin', 'dodge', 'form', 'interact', 'lock']);

export interface ScriptCtx {
  controllers(): (IntentController | null)[];
  /** beats since play began (null before it has) */
  beat(): number | null;
  arm(seat: number): void;
  /** a local room's rules (for `tension`) */
  setTension?(v: number): void;
  plane(): { origin: number[]; right: number[] } | null;
}

/** a script running */
export class ScriptRunner {
  private next = 0;
  private releases: { at: number; seat: number; keys: string[] }[] = [];
  private gotos: (number | null)[] = [null, null];
  readonly cues: Cue[];
  /** cues fired so far (for the tests and the films' probes) */
  fired = 0;

  constructor(readonly script: JogoScript, private ctx: ScriptCtx) {
    this.cues = [...script.cues].sort((a, b) => a.at - b.at);
  }

  get done() { return this.next >= this.cues.length && !this.releases.length; }

  /** each frame, in the 'input' phase (before the dancers move) */
  update() {
    const beat = this.ctx.beat();
    if (beat == null) return;
    const C = this.ctx.controllers();
    while (this.next < this.cues.length && this.cues[this.next].at <= beat + 1e-6) this.fire(this.cues[this.next++], C, beat);
    for (let i = this.releases.length - 1; i >= 0; i--) {
      const r = this.releases[i];
      if (r.at > beat) continue;
      const c = C[r.seat];
      if (c) c.script.set(Object.fromEntries(r.keys.map((k) => [k, undefined])) as Partial<Intent>);
      this.releases.splice(i, 1);
    }
    // walking somewhere
    const P = this.ctx.plane();
    for (let s = 0; s < 2; s++) {
      const g = this.gotos[s], c = C[s];
      if (g == null || !c) continue;
      const ch = c.character, at = P ? (ch.root[0] - P.origin[0]) * P.right[0] + (ch.root[2] - P.origin[2]) * P.right[2] : ch.root[0];
      const d = g - at;
      if (Math.abs(d) < 0.08) { c.script.set({ moveX: undefined }); this.gotos[s] = null; continue; }
      c.script.set({ moveX: Math.max(-1, Math.min(1, d * 2.5)) * (Math.abs(d) < 0.4 ? 0.6 : 1) });
    }
  }

  private fire(q: Cue, C: (IntentController | null)[], beat: number) {
    this.fired++;
    if (q.tension != null) this.ctx.setTension?.(q.tension);
    const seats = q.seat === 'both' ? [0, 1] : q.seat != null ? [q.seat] : [];
    for (const s of seats) {
      const c = C[s];
      if (!c) continue;
      if (q.place != null) { const ch = c.character; if (ch.plane) ch.reset(q.place); else ch.reset(q.place, undefined, ch.root[2]); }
      if (q.move) c.move(q.move);
      if (q.build) this.ctx.arm(s);
      if (q.goto != null) this.gotos[s] = q.goto;
      const patch: Partial<Intent> = { ...(q.hold ?? {}) };
      for (const k of q.press == null ? [] : Array.isArray(q.press) ? q.press : [q.press]) if (EDGE_OK.has(k)) (patch as Record<string, boolean>)[k] = true;
      if (Object.keys(patch).length) c.script.set(patch);
      if (q.hold && q.for != null) this.releases.push({ at: beat + q.for, seat: s, keys: Object.keys(q.hold) });
    }
  }
}

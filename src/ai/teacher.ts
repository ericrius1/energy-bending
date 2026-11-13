// The mirror, or teacher: call and response, the gentle way to learn the vocabulary with no text on screen. It stands
// out of reach, facing the student, and on a bar line demonstrates a call (one move, later two or three on the beat);
// then it waits, grooving, for the student to answer with the same moves in the same order, within two bars (inside
// one bar the rules count it as an echo). An answer moves it on; three in a row at a level take it up a level (new
// moves, then pairs, then quicker phrases on the 8ths); a call let pass three times is made easier (the level before,
// or the call cut to its first move). It claps an answer it liked.
//
// A lesson (`new TeacherBrain({ lesson: 'first' })`, the front's first jogo) is a fixed list instead of the ladder:
// the first is a kick (meia-lua) and the dodge (esquiva), each answered twice, the ginga between calls; then `done`, and
// whoever seated it hands the seat back (play/partner.ts AiPartner.teach).
//
// `StudentBrain` is the other side, scripted: it copies what it sees a beat or two later and sometimes gets it wrong
// (less as it practises). It is for the tests and for filming the drill; a person is the real student.
import { MOVES } from '../dancer/moves';
import type { Intent } from '../input/intent';
import { newHints, type Brain, type BodyHints, type Other, type Sight } from './brain';
import { Mind } from './mind';
import { busyFor, startBeat } from './body';
import { jogoAxis, keepDistance } from './behaviours';

/** the ladder: per level, the moves it calls from and how many in a call, and their spacing (beats) */
export const LADDER: { moves: string[]; length: number; gap: number }[] = [
  { moves: ['esquiva', 'meia-lua', 'block', 'spin'], length: 1, gap: 1 },
  { moves: ['martelo', 'bencao', 'rasteira', 'armada', 'au', 'strike'], length: 1, gap: 1 },
  { moves: ['esquiva', 'meia-lua', 'block', 'spin', 'martelo', 'bencao', 'rasteira'], length: 2, gap: 2 },
  { moves: ['meia-lua', 'armada', 'esquiva', 'role', 'macaco', 'au', 'martelo'], length: 2, gap: 1.5 },
  { moves: ['meia-lua', 'armada', 'martelo', 'esquiva', 'block', 'spin', 'bencao', 'rasteira'], length: 3, gap: 1 },
];

type Phase = 'call' | 'calling' | 'wait' | 'praise';

/** the lessons: each a list of calls, each to be answered once before the next (a call let pass is called again) */
export const LESSONS = { first: ['meia-lua', 'meia-lua', 'esquiva', 'esquiva'] } as const;
export type Lesson = keyof typeof LESSONS;

export class TeacherBrain implements Brain {
  readonly name = 'teacher';
  readonly body: BodyHints = newHints();
  readonly mind: Mind;
  level = 0;
  /** answers in a row at this level, calls let pass in a row */
  streak = 0;
  misses = 0;
  /** what it is calling now, and when the call ended (beats) */
  call: string[] = [];
  phase: Phase = 'call';
  private callEnd = 0;
  private callStart = 0;
  private seen = new Set<number>();
  private heard: string[] = [];
  private until = 0;
  /** history, for tests and the report: each call and whether it was answered */
  readonly log: { beat: number; level: number; call: string[]; answered: boolean }[] = [];

  /** a lesson's calls still to answer (null: the ladder, open-ended) */
  private lesson: string[] | null;
  /** a lesson answered to its end: the seat can go back to whoever had it */
  done = false;

  constructor(o: { seed?: number; level?: number; lesson?: Lesson } = {}) {
    this.mind = new Mind(o.seed ?? 9); this.level = o.level ?? 0;
    this.lesson = o.lesson ? [...LESSONS[o.lesson]] : null;
  }

  think(s: Sight): Intent {
    const m = this.mind, b = this.body, o = s.partner ?? s.others[0];
    b.flourish = null; b.groove = 0.7; b.lookAt = null;
    if (!o) return m.act(s, b);
    // out of reach of the student's kicks, facing them
    keepDistance(s, m, o, 2.9, 0.1);
    const sb = startBeat(s.beatPrev, s.beat);
    switch (this.phase) {
      case 'call': {
        if (busyFor(s.self) > 0 || m.waiting(0)) break;
        const L = LADDER[this.level];
        if (this.lesson && !this.lesson.length) { this.done = true; break; }
        if (!this.call.length) this.call = this.lesson ? [this.lesson[0]] : this.compose(L);
        const bar = Math.ceil(sb / 4 + 1e-6) * 4;
        const ax = jogoAxis(s, o), toward: [number, number] = [ax.dir[0], ax.dir[1]];
        let line = bar;
        for (const name of this.call) {
          m.plan({ move: name, line, late: 0.2, toward: name === 'role' || name === 'macaco' ? [-toward[0], -toward[1]] : toward, prio: 1, why: 'call' });
          line += Math.max(L.gap, Math.ceil(((MOVES[name]?.dur ?? 0.8) * s.bpm) / 60 * 2) / 2);
        }
        this.callStart = bar; this.callEnd = line; this.phase = 'calling';
        break;
      }
      case 'calling':
        if (sb >= this.callEnd) { this.phase = 'wait'; this.heard = []; this.until = this.callEnd + 8; this.markSeen(o); }
        break;
      case 'wait': {
        for (const mv of o.moves) {
          if (this.seen.has(mv.serial)) continue;
          this.seen.add(mv.serial);
          if (mv.beat >= this.callStart + 0.5 && MOVES[mv.name] && mv.name !== 'ginga') this.heard.push(mv.name);
        }
        if (this.answered()) { this.pass(s, true); break; }
        if (sb > this.until) this.pass(s, false);
        break;
      }
      case 'praise':
        if (sb > this.until) this.phase = 'call';
        break;
    }
    return m.act(s, b);
  }

  /** the student's moves since the call, in order, contain the call */
  private answered() {
    let i = 0;
    for (const h of this.heard) if (h === this.call[i]) { i++; if (i === this.call.length) return true; }
    return false;
  }

  private markSeen(o: Other) { for (const mv of o.moves) this.seen.add(mv.serial); }

  private pass(s: Sight, ok: boolean) {
    const m = this.mind, sb = startBeat(s.beatPrev, s.beat);
    this.log.push({ beat: this.callStart, level: this.level, call: [...this.call], answered: ok });
    if (this.lesson) {
      // a lesson: an answer moves it on (two claps), a call let pass is called again
      if (ok) this.lesson.shift();
      this.call = [];
      if (ok && MOVES.palmas) { const b0 = Math.ceil(sb + 0.5); this.mind.plan({ move: 'palmas', line: b0, late: 0.2, toward: [0, 1], prio: 0.5, why: 'praise' }); this.phase = 'praise'; this.until = b0 + 1; }
      else this.phase = 'call';
      return;
    }
    if (ok) {
      this.misses = 0; this.streak++;
      if (this.streak >= 3 && this.level < LADDER.length - 1) { this.level++; this.streak = 0; }
      this.call = [];
      // two claps for a good answer, on the next beats
      const b0 = Math.ceil(sb + 0.5);
      if (MOVES.palmas) { m.plan({ move: 'palmas', line: b0, late: 0.2, toward: [0, 1], prio: 0.5, why: 'praise' }); m.plan({ move: 'palmas', line: b0 + 1, late: 0.2, toward: [0, 1], prio: 0.5, why: 'praise' }); }
      this.phase = 'praise'; this.until = b0 + 2;
    } else {
      this.misses++; this.streak = 0;
      // let pass three times: easier (the level below, or just the call's first move)
      if (this.misses >= 3) {
        this.misses = 0;
        if (this.call.length > 1) this.call = this.call.slice(0, 1);
        else { this.level = Math.max(0, this.level - 1); this.call = []; }
      }
      this.phase = 'call';
    }
  }

  private compose(L: (typeof LADDER)[number]) {
    const m = this.mind, out: string[] = [];
    for (let i = 0; i < L.length; i++) {
      const last = out[out.length - 1];
      out.push(m.rng.weighted(L.moves, (n) => (n === last ? 0 : 1 / (1 + this.recentCalls(n))))!);
    }
    return out;
  }
  private recentCalls(n: string) { return this.log.slice(-4).filter((x) => x.call.includes(n)).length; }
}

/** a scripted student: copies the other's moves a beat or two later, wrong now and then (less with practice) */
export class StudentBrain implements Brain {
  readonly name = 'student';
  readonly body: BodyHints = newHints();
  readonly mind: Mind;
  private seen = new Set<number>();
  private practice = 0;
  constructor(o: { seed?: number; error?: number; attentive?: number } = {}) {
    this.mind = new Mind(o.seed ?? 13); this.error = o.error ?? 0.35; this.attentive = o.attentive ?? 1;
  }
  private error: number;
  private attentive: number;
  think(s: Sight): Intent {
    const m = this.mind, o = s.partner ?? s.others[0];
    if (!o) return m.act(s, this.body);
    for (const mv of o.moves) {
      if (this.seen.has(mv.serial)) continue;
      this.seen.add(mv.serial);
      if (mv.name === 'palmas' || !m.rng.chance(this.attentive)) continue;
      const wrong = m.rng.chance(this.error / (1 + this.practice * 0.15));
      this.practice++;
      const name = wrong ? m.rng.pick(['spin', 'block', 'esquiva', 'martelo']) : mv.name;
      const ax = jogoAxis(s, o);
      const line = Math.round((mv.beat + 4 + m.rng.range(0, 1.5)) * 2) / 2;
      m.plan({ move: name, line, late: 0.4, toward: name === 'role' || name === 'macaco' ? [-ax.dir[0], -ax.dir[1]] : [ax.dir[0], ax.dir[1]], prio: 1, why: 'copy' });
    }
    keepDistance(s, m, o, 2.9, 0.1);
    return m.act(s, this.body);
  }
}

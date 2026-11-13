// A small referee for a jogo between two simulated bodies: the rules (shared/rules.ts) run directly, the way LocalNet
// runs them in the page, with the body physics' own judgement of each exchange. It is what the brains' tests and
// demos play inside; the game proper (src/play) owns the real one, and brains only ever see its result (a RulesView).
//
// Each frame, for both seats: a move the body has started (a new serial) goes to the rules as a 'move' (judged
// perfect against the rules' own 8th-note grid, gridError within PERFECT_MS); a jump (a take-off) as the move 'jump';
// an attack in its dangerous window is resolved against the other body (resolveExchange, folded with foldExchange,
// reported by the dancer attacked, as the rules want); a hit knocks the other back; the form button toggles the power
// form; merge held is reported with the distance between the roots; the rules tick. Times are the rules' ms; the
// music's epoch is 0, so beat = ms × bpm / 60000, the same clock the bodies are given.
import { Character, resolveExchange, foldExchange, type Exchange } from '../dancer/character';
import { MOVES } from '../dancer/moves';
import {
  RULES, createSession, gridError, onExchange, onForm, onMerge, onMove, publicState, setPresent, tick, type Session,
} from '../../shared/rules.ts';
import type { MoveMsg, RulesEvent } from '../../shared/protocol.ts';
import type { Intent } from '../input/intent';
import type { RulesView } from './brain';
import { moveEventOf } from './body';

interface Live { seat: number; serial: number; id: string; fold: { res: Exchange; final: boolean } | null; reported: boolean }

/** what happened, for tests and the report */
export interface JogoStats {
  moves: [number, number];
  perfect: [number, number];
  /** |gridError| of every move (ms), both seats */
  errors: number[];
  distinct: [Set<string>, Set<string>];
  /** exchange results, by the seat that was attacked */
  xch: [Record<string, number>, Record<string, number>];
  echoes: number;
  unisons: number;
  fusions: number;
  mergeReady: number;
  tensionMax: number;
  /** the longest stretch (s) of play in which neither dancer started anything */
  maxGap: number;
  /** names of every move started, by seat (with refused ones: named flourishes the rules don't know) */
  names: [Record<string, number>, Record<string, number>];
  refused: number;
  /** tension earned by kind (the rules' nominal amounts, before the cap): exchanges, echoes, unisons */
  tensionFrom: { xch: number; echo: number; unison: number };
}

export class JogoReferee {
  readonly session: Session;
  readonly stats: JogoStats;
  /** this frame's rules events (what the brains' RulesView carries) */
  events: RulesEvent[] = [];
  /** told of every exchange the rules took (target seat, result, the attack's id) */
  onXch: ((target: number, res: string, id: string) => void) | null = null;
  /** told of every attack when its window closes, answered or not (for tuning) */
  onAttack: ((seat: number, id: string, res: Exchange, dist: number) => void) | null = null;
  private serial: [number, number] = [-1, -1];
  private live: (Live | null)[] = [null, null];
  private grounded: [boolean, boolean] = [true, true];
  private lastMoveAt = 0;

  constructor(readonly seats: [Character, Character], stage = 'geode', nowMs = 0) {
    this.session = createSession(stage, nowMs, null);
    this.session.music.epoch = 0;
    setPresent(this.session, 0, true, nowMs);
    this.events = setPresent(this.session, 1, true, nowMs);
    this.stats = {
      moves: [0, 0], perfect: [0, 0], errors: [], distinct: [new Set(), new Set()], xch: [{}, {}], echoes: 0, unisons: 0,
      fusions: 0, mergeReady: 0, tensionMax: 0, maxGap: 0, names: [{}, {}], refused: 0, tensionFrom: { xch: 0, echo: 0, unison: 0 },
    };
  }

  get bpm() { return this.session.music.bpm; }
  /** the rules' view for a brain */
  view(): RulesView {
    const p = publicState(this.session);
    return { phase: p.phase, tension: p.tension, mergeReady: p.mergeReady, flow: [p.flow[0], p.flow[1]], form: [p.form[0], p.form[1]], fusion: !!p.fusion, events: this.events };
  }

  /** one frame, after both bodies stepped: now in the rules' ms, the intents the bodies were given */
  update(nowMs: number, intents: [Intent | null, Intent | null]) {
    const s = this.session, ev: RulesEvent[] = [];
    for (let seat = 0; seat < 2; seat++) {
      const c = this.seats[seat], m = c.move;
      // a new move
      if (m && m.serial !== this.serial[seat] && !m.def.loop) {
        this.serial[seat] = m.serial;
        const e = moveEventOf(c)!, ts = nowMs - m.t * 1000;
        const err = gridError(s.music, ts);
        const perfect = Math.abs(err) <= RULES.PERFECT_MS;
        this.send(seat, { ...e, id: `${seat}-${m.serial}`, ts, perfect }, nowMs, ev, err);
        if (m.def.attack) this.live[seat] = { seat, serial: m.serial, id: `${seat}-${m.serial}`, fold: null, reported: false };
      }
      // a take-off is the move 'jump'
      if (this.grounded[seat] && !c.grounded && c.v[1] > 4) {
        const ts = nowMs, err = gridError(s.music, ts);
        this.send(seat, { move: 'jump', id: `${seat}-j${Math.round(nowMs)}`, ts, x: c.x, y: c.y, z: c.z, dir: c.dir, perfect: Math.abs(err) <= RULES.PERFECT_MS }, nowMs, ev, err);
      }
      this.grounded[seat] = c.grounded;
    }
    // exchanges: each live attack against the other body, this frame
    for (let seat = 0; seat < 2; seat++) {
      const L = this.live[seat];
      if (!L || L.reported) continue;
      const a = this.seats[seat], d = this.seats[1 - seat], m = a.move;
      const over = !m || m.serial !== L.serial || (m.def.active && m.t / m.dur > m.def.active[1]);
      if (!over) L.fold = foldExchange(L.fold, resolveExchange(a.hitShapes(), d, { plane: d.plane }));
      if ((L.fold && L.fold.final) || over) {
        L.reported = true;
        const res = L.fold?.res ?? null;
        if (res) this.exchange(1 - seat, L.id, res, nowMs, ev);
        this.onAttack?.(seat, L.id, res, Math.hypot(a.x - d.x, a.z - d.z));
        this.live[seat] = null;
      }
    }
    // the form, merge
    for (let seat = 0; seat < 2; seat++) {
      const it = intents[seat];
      if (!it) continue;
      if (it.form) ev.push(...onForm(s, seat, !s.form[seat], nowMs).events);
      const o = this.seats[1 - seat], c = this.seats[seat];
      ev.push(...onMerge(s, seat, !!it.merge, Math.hypot(c.x - o.x, c.z - o.z), nowMs).events);
    }
    ev.push(...tick(s, nowMs));
    // book-keeping
    for (const e of ev) {
      if (e.k === 'echo') { this.stats.echoes++; this.stats.tensionFrom.echo += RULES.echo.tension; }
      else if (e.k === 'unison') { this.stats.unisons++; this.stats.tensionFrom.unison += RULES.unison.tension; }
      else if (e.k === 'mergeReady') this.stats.mergeReady++;
    }
    this.stats.fusions = s.fusions;
    this.stats.tensionMax = Math.max(this.stats.tensionMax, s.tension);
    if (s.phase === 'play' || s.phase === 'fusion' || s.phase === 'release') this.stats.maxGap = Math.max(this.stats.maxGap, (nowMs - this.lastMoveAt) / 1000);
    else this.lastMoveAt = nowMs;
    this.events = ev;
    return ev;
  }

  private send(seat: number, e: Record<string, any>, nowMs: number, ev: RulesEvent[], err: number) {
    const S = this.stats;
    S.names[seat][e.move] = (S.names[seat][e.move] ?? 0) + 1;
    this.lastMoveAt = nowMs;
    const r = onMove(this.session, seat, { t: 'move', ...e } as MoveMsg, nowMs);
    if (!r.ok) { if (r.reason === 'move') S.refused++; return; }
    S.moves[seat]++;
    S.errors.push(Math.abs(err));
    if (e.perfect) S.perfect[seat]++;
    S.distinct[seat].add(e.move);
    ev.push(...r.events);
  }

  private exchange(target: number, id: string, res: NonNullable<Exchange>, nowMs: number, ev: RulesEvent[]) {
    const r = onExchange(this.session, target, { id, res }, nowMs);
    if (!r.ok) return;
    this.onXch?.(target, res, id);
    const x = this.stats.xch[target];
    x[res] = (x[res] ?? 0) + 1;
    this.stats.tensionFrom.xch += RULES.xch[res].tension;
    ev.push(...r.events);
    if (res === 'hit') {
      // knocked back, away from the attacker, and a moment's stagger
      const d = this.seats[target], a = this.seats[1 - target];
      const dx = d.x - a.x, dz = d.z - a.z, l = Math.hypot(dx, dz) || 1;
      d.applyKnock((dx / l) * 2.6, 2.2, 0.35, (dz / l) * 2.6);
    }
  }
}

/** a move the rules know (named flourishes, the clap and clip phrases are the body's own: the rules refuse them) */
export const scored = (name: string) => Object.hasOwn(RULES.moves, name) && !!MOVES[name];

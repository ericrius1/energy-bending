// The jogo's loop on the client: what happens between the dancers and the rules (shared/rules.ts) each frame. Pure: no
// DOM, no GPU, only the Room (a Session), the seats' bodies and a judge of time, so it runs in Node for the tests.
//
//   moves      each local dancer's moves (Character 'move' events) go to the rules, judged perfect against the
//              music's grid as heard (the judge: music.beatError(heardTime, 2) live, the room's grid when stepped)
//   exchanges  every live attack by the other seat (its move as relayed, replayed with Character.shapesAt) is tested
//              against each local defender every frame (resolveExchange), folded over the move's active window
//              (foldExchange) and reported, by the dancer being attacked, as one `xch`
//   merge      a local seat holding merge sends how far it is from the other; the rules fuse on the bar line
//   form       the form button asks the rules; their answer (state.form) is what the dancer's form eases to
//   building   a move the builder says should set a piece (build.ts) sends `build` once the move is done
//   ready      at the end, a button says ready for the next jogo
// Everything the room says, and everything decided here, becomes a JogoEvent in `events`, which the feel (feel.ts),
// the fusion (fusion.ts), the meters (hud.ts) and the session flow (flow.ts) read and clear each frame.
import { Character, resolveExchange, foldExchange, type Exchange, type Capsule } from '../dancer/character';
import { MOVES, tempoScale } from '../dancer/moves';
import type { Intent } from '../input/intent';
import type { StagePlane } from '../engine/camera';
import { RULES } from '../../shared/rules.ts';
import type { FusionKind, MoveRelay, Phase, PublicState, SetPiece, XchResult } from '../../shared/protocol.ts';
import type { Room } from './room';

type V3 = [number, number, number];

/** what each seat's body is made of, as far as the jogo's looks and perks care (its dominant kind at its form) */
export type Element = 'fire' | 'plasma' | 'water' | 'ice' | 'gems';

/** one seat as the jogo sees it */
export interface SeatBody {
  /** the body physics: local seats only (a remote seat is posed by the network) */
  readonly character: Character | null;
  /** its ground point (world, m), every seat */
  root(): V3;
  /** the middle of its chest (world, m), for the meters and the matter thrown between them */
  chest(): V3;
  /** this frame's Intent (local seats; null for a remote one) */
  intent(): Intent | null;
  /** what it is made of now */
  element(): Element;
}

/** a piece of matter a move asks to set (build.ts decides): points in mm (flat xyz), width mm */
export interface BuildAsk { kind: string; points: number[]; width: number; life?: number }
/** asked when a local move starts: should it build? (null: no). Asked again with the finished move to shape it */
export interface Builder {
  wants(seat: number, ev: MoveStart, flow: number): string | null;
  shape(seat: number, kind: string, ev: MoveStart, end: V3, c: Character): BuildAsk | null;
}

/** a local move as it started (the Character's event, with the rules' id) */
export interface MoveStart { id: string; seat: number; move: string; perfect: boolean; err: number; x: number; y: number; z: number; dir: number; yaw: number; t: number }

export type JogoEvent =
  /** a move by a seat: this page's own (`local`, with how far from the grid it was, ms) or one relayed from the room */
  | { k: 'move'; seat: number; id: string; move: string; perfect: boolean; err: number; at: V3; local: boolean }
  /** an exchange: the dancer `target` answered `by`'s move `id` with `res`. `mine`: decided on this page (felt at once;
   *  the room's echo of it is not repeated). `move`: the attack as relayed (null if this page never saw it) */
  | { k: 'xch'; id: string; by: number; target: number; res: XchResult; move: MoveRelay | null; mine: boolean; streak: number }
  | { k: 'phase'; phase: Phase; prev: Phase | null }
  | { k: 'echo' | 'unison'; move: string }
  | { k: 'mergeReady' }
  | { k: 'fusion'; kind: FusionKind; t0: number; tEnd: number; finale: boolean }
  | { k: 'release'; kind: FusionKind; tEnd: number }
  | { k: 'form'; seat: number; on: boolean }
  | { k: 'build'; seat: number; move: string; kind: string }
  | { k: 'set'; piece: SetPiece }
  | { k: 'unset'; id: string; how: 'expire' | 'melt' | 'shatter' }
  | { k: 'travel'; world: string; by: number }
  | { k: 'refused'; of: string; reason: string };

/** moves the rules don't know by their own name (the CMU pirouette is a spin to them) */
const RULES_NAME: Record<string, string> = { pirueta: 'spin' };

interface Watch { move: MoveRelay; defender: number; fold: { res: Exchange; final: boolean } | null }

const dist2 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export interface JogoOptions {
  /** signed ms from the grid line (8th notes) nearest to when a move by `seat` starts now, as heard */
  judge(seat: number): number;
  /** the stage plane the jogo is locked to (exchanges are flattened onto it), or null when free */
  plane(): StagePlane | null;
  builder?: Builder | null;
}

export class Jogo {
  /** what happened this frame (and any frames the reader skipped): read and cleared by whoever renders it */
  readonly events: JogoEvent[] = [];
  /** recent moves by id: this page's own and every one relayed (the attack's path for a trail, a clash's place) */
  readonly moves = new Map<string, MoveRelay>();
  /** while true (a dancer is between worlds: travel), nothing goes to the rules and no exchange is judged */
  paused = false;
  private watches = new Map<string, Watch>();
  private felt = new Set<string>();
  private lastPhase: Phase | null = null;
  private mergeSent: { held: boolean; at: number; dist: number }[] = [{ held: false, at: -1e9, dist: Infinity }, { held: false, at: -1e9, dist: Infinity }];
  private lastSent = [-1e9, -1e9];
  private builds: { id: string; seat: number; kind: string; ev: MoveStart; serial: number }[] = [];
  private off: (() => void)[] = [];

  constructor(readonly room: Room, readonly bodies: readonly SeatBody[], readonly opts: JogoOptions) {
    const R = room;
    this.off.push(R.on('move', (m) => {
      this.remember(m);
      // a move by the other seat online (a local room's relays are its own seats' moves, already told)
      if (!R.local && m.from <= 1) this.events.push({ k: 'move', seat: m.from, id: m.id, move: m.move, perfect: m.perfect, err: 0, at: [m.x, m.y, m.z], local: false });
      // an attack against a seat this page plays: watch it (the defender reports it)
      const defender = R.local ? (m.to ?? 0) : R.seats[0];
      if (defender == null || m.from === defender || m.from > 1 || !MOVES[m.move]?.attack) return;
      if (!R.seats.includes(defender) || !this.bodies[defender]?.character) return;
      this.watches.set(m.id, { move: m, defender, fold: null });
    }));
    this.off.push(R.on('xch', (x) => {
      if (this.felt.has(x.id)) return;
      this.felt.add(x.id);
      this.events.push({ k: 'xch', id: x.id, by: x.by, target: x.target, res: x.res, move: this.moves.get(x.id) ?? null, mine: false, streak: x.streak });
    }));
    this.off.push(R.on('ev', (e) => {
      switch (e.k) {
        case 'echo': case 'unison': this.events.push({ k: e.k, move: e.move }); break;
        case 'mergeReady': this.events.push({ k: 'mergeReady' }); break;
        case 'fusion': this.events.push({ k: 'fusion', kind: e.kind, t0: e.t0, tEnd: e.tEnd, finale: !!e.finale }); break;
        case 'release': this.events.push({ k: 'release', kind: e.kind, tEnd: e.tEnd }); break;
        case 'formOff': this.events.push({ k: 'form', seat: e.seat, on: false }); break;
        case 'set': this.events.push({ k: 'set', piece: e.piece }); break;
        case 'expire': this.events.push({ k: 'unset', id: e.id, how: 'expire' }); break;
        case 'shatter': this.events.push({ k: 'unset', id: e.id, how: 'shatter' }); break;
        case 'melt': this.events.push({ k: 'unset', id: e.id, how: 'melt' }); break;
        case 'travel': this.events.push({ k: 'travel', world: e.world, by: e.by }); break;
      }
    }));
    this.off.push(R.on('no', (n) => { if (n.of || n.reason !== 'rate') this.events.push({ k: 'refused', of: n.of ?? 'move', reason: n.reason }); }));
    let wasForm: [number, number] = [0, 0];
    this.off.push(R.on('state', (s) => {
      for (let i = 0; i < 2; i++) if (s.form[i] && !wasForm[i]) this.events.push({ k: 'form', seat: i, on: true });
      wasForm = [s.form[0], s.form[1]];
    }));
  }

  get state(): PublicState | null { return this.room.state; }
  get phase(): Phase { return this.room.state?.phase ?? 'waiting'; }
  /** the rules accept moves and exchanges */
  get playing() { const p = this.phase; return p === 'play' || p === 'fusion' || p === 'finale'; }

  /** the body events each local seat had this frame (steps, landings, blinks: the feel reads them) */
  readonly raw: Record<string, unknown>[][] = [[], []];

  /** each frame, first (the 'input' phase): the room's clock moves on and its messages are heard */
  clock(dt: number) { this.room.advance(dt); }

  /** each frame, after the dancers have moved: the rules hear what they did, the exchanges are judged */
  update() {
    this.room.flush();
    const now = this.room.now();
    const st = this.room.state;
    if (st && st.phase !== this.lastPhase) { this.events.push({ k: 'phase', phase: st.phase, prev: this.lastPhase }); this.lastPhase = st.phase; }
    for (const seat of this.room.seats) this.seatFrame(seat, now);
    this.judgeExchanges(now);
    // forget old moves
    for (const [id, m] of this.moves) if (now - m.ts > RULES.MOVE_TTL_MS + 2000) this.moves.delete(id);
    if (this.felt.size > 256) this.felt = new Set([...this.felt].slice(-128));
  }

  private seatFrame(seat: number, now: number) {
    const b = this.bodies[seat], c = b?.character;
    if (!c) return;
    // the body's events since last frame (the Character keeps them until someone takes them)
    const evs = c.events;
    c.events = [];
    this.raw[seat] = evs;
    const st = this.room.state;
    const it = b.intent();
    for (const e of evs) {
      if (this.paused) continue;
      if (e.type === 'move') this.sendMove(seat, e, now);
      else if (e.type === 'jump' && now - this.lastSent[seat] > RULES.MOVE_GAP_MS + 15) this.sendMove(seat, { ...e, move: 'jump', dir: c.dir, yaw: c.yaw }, now);
    }
    this.finishBuilds(seat, c);
    if (!st || this.paused) return;
    // merge: held, and how far from the other
    const other = this.bodies[1 - seat];
    const held = !!it?.merge && (this.playing || st.phase === 'fusion');
    const d = other ? dist2(b.root(), other.root()) : Infinity;
    const ms = this.mergeSent[seat];
    if (held !== ms.held || (held && now - ms.at > 150 && Math.abs(d - ms.dist) > 0.02)) {
      this.room.send(seat, { t: 'merge', held, dist: Number.isFinite(d) ? Math.round(d * 1000) / 1000 : 1e6 });
      ms.held = held; ms.at = now; ms.dist = d;
    }
    // the form button asks; the rules answer through state.form
    if (it?.form && this.playing) this.room.send(seat, { t: 'form', on: !st.form[seat as 0 | 1] });
    // ready for another, at the end
    if (st.phase === 'over' && it && (it.jump || it.punch || it.kick) && !st.ready[seat as 0 | 1]) this.room.send(seat, { t: 'ready' });
  }

  private sendMove(seat: number, e: Record<string, any>, now: number) {
    const name = RULES_NAME[e.move] ?? e.move;
    if (!RULES.moves[name] || !this.playing) return;
    const err = this.opts.judge(seat);
    const perfect = Math.abs(err) <= RULES.PERFECT_MS;
    const { type: _t, serial: _s, offMs: _o, camera: _c, limb: _l, perfect: _p, ...rest } = e;
    const msg = this.room.move(seat, { ...rest, move: name, x: e.x, y: e.y, z: e.z, dir: e.dir ?? 1, perfect });
    this.lastSent[seat] = now;
    this.remember({ ...msg, from: seat, ts: msg.ts ?? now, z: e.z ?? 0, perfect } as MoveRelay);
    this.events.push({ k: 'move', seat, id: msg.id, move: name, perfect, err, at: [e.x, e.y, e.z ?? 0], local: true });
    // a local attack against the other local seat is watched when its relay arrives (local rooms relay to 'others')
    const b = this.opts.builder, st = this.room.state;
    if (b && st) {
      const ev: MoveStart = { id: msg.id, seat, move: e.type === 'jump' ? 'jump' : e.move, perfect, err, x: e.x, y: e.y, z: e.z ?? 0, dir: e.dir ?? 1, yaw: e.yaw ?? 0, t: now };
      const kind = b.wants(seat, ev, st.flow[seat as 0 | 1] ?? 0);
      if (kind) {
        const c = this.bodies[seat].character!;
        this.builds.push({ id: msg.id, seat, kind, ev, serial: c.serial });
      }
    }
  }

  /** a building move that has finished (or been cut short) is shaped and sent */
  private finishBuilds(seat: number, c: Character) {
    for (let i = this.builds.length - 1; i >= 0; i--) {
      const B = this.builds[i];
      if (B.seat !== seat) continue;
      // (a jump builds where it lands: a stomp)
      const done = B.ev.move === 'jump' ? c.grounded && this.room.now() - B.ev.t > 150 : !c.move || c.move.serial !== B.serial;
      const tooOld = this.room.now() - B.ev.t > RULES.MOVE_TTL_MS - 500;
      if (!done && !tooOld) continue;
      this.builds.splice(i, 1);
      const ask = this.opts.builder!.shape(seat, B.kind, B.ev, [c.root[0], c.root[1], c.root[2]], c);
      if (!ask || this.paused) continue;
      this.room.send(seat, { t: 'build', move: B.id, kind: ask.kind, points: ask.points, width: ask.width, ...(ask.life ? { life: ask.life } : {}) });
      this.events.push({ k: 'build', seat, move: B.id, kind: ask.kind });
    }
  }

  private remember(m: MoveRelay) { this.moves.set(m.id, m); }

  /** every watched attack, replayed at this instant (less the delay the attacker is shown with) against its defender */
  private judgeExchanges(now: number) {
    const plane = this.opts.plane(), lagMs = this.room.delay();
    for (const [id, w] of this.watches) {
      const m = w.move, def = MOVES[m.move], c = this.bodies[w.defender]?.character;
      if (!def || !def.active || !c) { this.watches.delete(id); continue; }
      const dur = def.dur * tempoScale(m.bpm || RULES.BPM);
      const t = (now - lagMs - m.ts) / 1000;
      const a0 = def.active[0] * dur, a1 = def.active[1] * dur;
      if (t > a1 + 0.05 || this.paused) {
        // the window is over: the best of dodge and near, if anything came close
        if (!this.paused && w.fold && w.fold.res) this.report(id, w);
        this.watches.delete(id);
        continue;
      }
      if (t < a0) continue;
      const shapes = Character.shapesAt(m, t);
      const res = resolveExchange(shapes, c, { plane });
      w.fold = foldExchange(w.fold, res);
      if (w.fold.final) { this.report(id, w); this.watches.delete(id); }
    }
  }

  private report(id: string, w: Watch) {
    const res = w.fold!.res as XchResult;
    if (!this.playing) return;
    // felt here first (a local room answers before send returns, and its echo is then not felt again)
    if (!this.felt.has(id)) {
      this.felt.add(id);
      const st = this.room.state, x = RULES.xch[res];
      const streak = x?.streak ? (st?.streak ?? 0) + 1 : 0;
      this.events.push({ k: 'xch', id, by: w.move.from, target: w.defender, res, move: w.move, mine: true, streak });
    }
    this.room.send(w.defender, { t: 'xch', id, res });
  }

  /** an attack's hit capsules along its active window (n samples): the path a trail follows */
  static path(m: MoveRelay, n = 12): Capsule[] {
    const def = MOVES[m.move];
    if (!def || !def.active) return [];
    const dur = def.dur * tempoScale(m.bpm || RULES.BPM), out: Capsule[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (def.active[0] + ((def.active[1] - def.active[0]) * i) / n) * dur;
      out.push(...Character.shapesAt(m, t));
    }
    return out;
  }

  dispose() { for (const f of this.off) f(); this.off = []; }
}

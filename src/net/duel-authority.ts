// The online duel's authority: one room's duel stepped by the room server (server/duel.ts) at DUEL_NET.TICK_HZ, the
// same pieces the page and the Node harness run (src/duel/sim.ts, index.ts): two Characters on the duel's profile in
// the world's arena (free in 3D, or locked to its stage plane), the contact (match.ts, contact.ts), the powers
// (powers.ts), the rules (shared/duel.ts, shared/powers.ts) and the finale's duet (finale.ts). Each seat's thumbs
// arrive as numbered inputs (shared/protocol.ts DuelInput) into a short queue, and each tick takes one per seat (an
// empty queue repeats the last input without its presses). What it makes:
//   events     every tick's rules', contact's and powers' events, the same for everyone (`step` returns them)
//   snapshots  both bodies, which input of the receiver's has been applied, the rules' state, the link, the powers'
//              effects, and the receiver's own body's kit (`snapshot`)
// One thing the page doesn't do: a catch is judged as the catcher saw it. A grab pressed while the other body showed
// on the catcher's screen within reach (the input says which tick that screen showed, `view`) catches, up to
// DUEL_NET.REWIND_MS back, though the other has moved on since: the catcher's own moment wins, as in contact
// improvisation the one who reaches decides. Pure (no I/O, no timers): the server and the tests drive it.
import { Character } from '../dancer/character';
import { makeIntent, type Intent } from '../input/intent';
import { DuelMatch, duelPlane } from '../duel/match';
import { Contact, splitIntent, noInput, type ContactEvent, type ContactInput, type Link } from '../duel/contact';
import { DuelPowers, noPower, type Live, type PowerFx, type PowerInput } from '../duel/powers';
import { Finale } from '../duel/finale';
import { DuelHazards } from '../duel/hazards';
import type { Arena } from '../duel/arena';
import type { WorldLike } from '../duel/fallback';
import { NODE_WORLDS } from '../duel/stages';
import { CrossJudge, crossPair, duelDoors, nodeWorld } from '../duel/crossing';
import type { Solid } from '../worlds/solids';
import { onBeat, duelLink, duelFlingLanded, DUEL, type DuelEvent, type DuelState } from '../../shared/duel.ts';
import { matterOf, type PowerEvent, type PowersState } from '../../shared/powers.ts';
import { tempoOf, beatAt, nextBar, RULES } from '../../shared/rules.ts';
import { DUEL_NET, DUEL_FLAG, encodeDuelSnap, type DuelHello, type DuelCrossing, type DuelInput, type DuelWelcome, type MusicClock } from '../../shared/protocol.ts';
import { bodySnap, intentOf, kitOf, poseHazard, EDGE_BITS } from './duel-body';

type V3 = [number, number, number];

/** the worlds a duel can be played in online: those Node can build (src/duel/stages.ts) */
export function duelWorld(id: string): { arena: Arena; world: WorldLike } | null {
  const w = nodeWorld(id);
  return w ? { arena: w.arena, world: w } : null;
}
/** the worlds a duel can be played in online: every world the duel's Node harness builds */
export const ONLINE_WORLDS = NODE_WORLDS;

/** a seat's inputs at the server */
interface SeatIn {
  queue: DuelInput[];
  last: DuelInput | null;
  /** the newest seq received, the last applied (-1: none) */
  recv: number;
  ack: number;
  /** ticks an empty queue made the last input repeat; inputs folded away (a queue past its length); lost (a gap) */
  starved: number;
  /** ticks in a row with no input (a page in a background tab sends none: past DUEL_NET.STILL_TICKS its body stands) */
  dry: number;
  folded: number;
  lost: number;
}
/** a body as it was at a tick (for judging a catch where the catcher saw it) */
interface Past { tick: number; pose: Float32Array; root: V3; grounded: boolean; onWall: boolean; reformT: number }

/** the contact's own state and helpers, read by name (contact.ts keeps them private: the judged catch makes its link
 *  as the contact makes one) */
interface ContactInner {
  link: Link | null; flown: Contact['flown']; t: number; grabT: number[]; noGrab: number[];
  tryCatch(k: number): { part: Link['part']; at: V3 } | null;
  pivot(h: Character, c: V3): V3;
}

/** a tick's output: its events, in order, as the clients get them; the slow state (JSON) when it changed */
export interface TickOut { n: number; ev: DuelEvent[]; tc: ContactEvent[]; pe: PowerEvent[]; fx: PowerFx[]; st?: string; x?: DuelCrossing[] }

/** the rules' numbers that change every tick (they ride every snapshot; the rest is sent when it changes) */
const FAST = ['energy', 'merge', 'peak', 'highSince', 'highBest'] as const;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const rv = (v: readonly number[]) => v.map(r3);
/** a value with its numbers rounded to a millimetre (a JSON tail kept small) */
function lite(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? r3(v) : null;
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Set) return [...v];
  if (Array.isArray(v)) return v.map(lite);
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = lite(x);
  return o;
}

export interface AuthorityOptions extends DuelHello {
  /** server time (ms) of tick 0 */
  t0?: number;
}

export class DuelAuthority {
  static readonly TICK_MS = 1000 / DUEL_NET.TICK_HZ;
  readonly tickMs = DuelAuthority.TICK_MS;
  /** the world the duel is in now, its arena (a crossing changes them: crossing.ts) */
  arena: Arena;
  world: WorldLike;
  readonly chars: [Character, Character];
  readonly match: DuelMatch;
  readonly powers: DuelPowers;
  readonly finale: Finale;
  hazards: DuelHazards | null;
  /** the music's clock: the world's tempo from its epoch (a crossing moves it to the new world's from the next bar) */
  music: MusicClock;
  readonly setMs: number;
  readonly t0: number;
  readonly hello: DuelHello;
  tick = 0;
  /** the match runs (both seats came); before that the bodies move but nothing counts */
  running = false;
  /** each seat's player is here (the server says) */
  present: [boolean, boolean] = [false, false];
  readonly seats: [SeatIn, SeatIn];
  /** the powers' temporary solids, laid into the world's while they stand */
  private solids: Solid[];
  private past: Past[][] = [[], []];
  /** the last tick the contact or a power moved each body (beyond its own step) */
  private pushed = [-1e9, -1e9];
  /** what each tick cost (ms), the last few hundred */
  readonly cost: number[] = [];
  /** catches judged where the catcher saw them that the present would have missed, and grabs it didn't judge so (why) */
  rewound = 0;
  readonly refused: Record<string, number> = {};
  /** the mirrors: who crosses (crossing.ts), and every crossing so far */
  private judge = new CrossJudge(duelDoors());
  readonly crossings: DuelCrossing[] = [];
  private no(why: string) { this.refused[why] = (this.refused[why] ?? 0) + 1; }

  constructor(o: AuthorityOptions) {
    const W = duelWorld(o.world);
    if (!W) throw new Error(`duel: no world ${o.world} online (${ONLINE_WORLDS.join(', ')})`);
    this.hello = { world: o.world, dress: o.dress, matter: o.matter, locked: !!o.locked, setS: o.setS };
    this.arena = W.arena; this.world = W.world;
    this.t0 = o.t0 ?? 0;
    this.setMs = Math.max(15, Math.min(600, o.setS ?? DUEL.SET_MS / 1000)) * 1000;
    const bpm = tempoOf(o.world);
    this.music = { epoch: this.t0, bpm, mood: RULES.STAGE_MOODS[o.world] ?? 0 };
    const plane = duelPlane(this.arena);
    this.solids = [...(this.world.solids ?? [])];
    const self = this;
    const terrain = { groundAt: (x: number, z: number) => this.world.groundAt(x, z), get fallY() { return self.world.fallY; }, solids: this.solids };
    this.chars = [0, 1].map((k) => {
      const c = new Character({ seat: k, plane: o.locked ? plane : null, terrain });
      c.setProfile('duel');
      const s = this.arena.spawns[k];
      if (!o.locked) c.reset(s[0], undefined, s[2]);
      c.yaw = k ? -Math.PI / 2 : Math.PI / 2;
      return c;
    }) as [Character, Character];
    this.match = new DuelMatch(this.chars, this.arena, plane, 0, bpm, { solids: () => this.solids, setMs: this.setMs });
    this.powers = new DuelPowers(this.chars, this.match, { matter: [matterOf(o.matter[0]), matterOf(o.matter[1])], sink: this.solids, groundAt: terrain.groundAt, yKill: this.arena.space.yKill });
    this.finale = new Finale(this.chars);
    this.hazards = this.arena.hazard ? new DuelHazards(this.chars, this.match, this.arena, { on: true }) : null;
    this.seats = [0, 1].map((): SeatIn => ({ queue: [], last: null, recv: -1, ack: -1, starved: 0, dry: 0, folded: 0, lost: 0 })) as unknown as [SeatIn, SeatIn];
  }

  /** what a joiner is told of the room */
  welcome(): DuelWelcome { return { ...this.hello, setMs: this.setMs, tickMs: this.tickMs, t0: this.t0, music: this.music, crossings: this.crossings.length, last: this.crossings[this.crossings.length - 1] ?? null }; }
  /** the server time (ms) of a tick */
  timeOf(tick: number) { return this.t0 + tick * this.tickMs; }
  /** the duel's clock (ms) at the current tick: what DuelState's times are on */
  get now() { return this.tick * this.tickMs; }
  get bpm() { return this.music.bpm; }

  /** a seat's player came (true) or went; the match begins when both have come */
  seat(k: number, here: boolean) {
    this.present[k] = here;
    if (!here) { const S = this.seats[k]; S.queue.length = 0; S.last = null; }
    if (here && !this.running && this.present[0] && this.present[1]) { this.running = true; this.match.restart(this.now); }
  }
  /** a new player in a seat (after one left for good): its inputs count from its own first */
  reseat(k: number) { const S = this.seats[k]; S.queue.length = 0; S.last = null; S.recv = -1; S.ack = -1; }

  /** inputs from a seat (an input frame: the newest and a few before it) */
  receive(k: number, list: readonly DuelInput[]) {
    const S = this.seats[k];
    for (const x of list) {
      if (x.seq <= S.recv) continue;
      if (S.recv >= 0 && x.seq > S.recv + 1) S.lost += x.seq - S.recv - 1;
      S.recv = x.seq;
      S.queue.push(x);
    }
    // a client running ahead: its oldest folded into the next (their presses kept), so the queue stays short
    while (S.queue.length > DUEL_NET.QUEUE_MAX) {
      const a = S.queue.shift()!, b = S.queue[0];
      b.b |= a.b & EDGE_BITS;
      S.ack = a.seq; S.folded++;
    }
  }
  /** a seat's input for this tick */
  private take(k: number): { x: DuelInput | null; fresh: boolean } {
    const S = this.seats[k];
    const x = S.queue.shift();
    if (x) { S.last = x; S.ack = x.seq; S.dry = 0; return { x, fresh: true }; }
    if (this.present[k]) S.starved++;
    // (the last input repeated for a moment; a page that has gone quiet, its tab hidden, stands its body still)
    return { x: ++S.dry > DUEL_NET.STILL_TICKS ? null : S.last, fresh: false };
  }

  /** one tick */
  step(): TickOut {
    const t0 = performance.now();
    this.tick++;
    const now = this.now, dt = this.tickMs / 1000, bpm = this.bpm, beat = beatAt(this.music, this.timeOf(this.tick));
    const C = this.chars, M = this.match, P = this.powers;
    // (the arena's hazard is one object every room in this process shares: the worlds' layouts are made once. Put this
    // room's beat and its stones back on it before its bodies step; another room stepped it with its own)
    const H = this.arena.hazard;
    if (H) { H.on = true; poseHazard(H, beatAt(this.music, this.timeOf(this.tick - 1))); }
    C[0].lookAt = C[1].root; C[1].lookAt = C[0].root;
    const ins: ContactInput[] = [], pins: PowerInput[] = [], grabs: (DuelInput | null)[] = [null, null];
    for (let k = 0; k < 2; k++) {
      const { x, fresh } = this.take(k);
      let it: Intent = intentOf(x, fresh);
      const held = this.running && (M.frozen(k) || this.finale.holds(k));
      if (held) it = makeIntent();
      ins.push(held ? noInput() : splitIntent(C[k], it, M.contact.holding(k), M.contact.held(k)));
      pins.push(held ? noPower() : { p1: !!it.power1, p2: !!it.power2, form: !!it.form, stick: ins[k].stick });
      if (ins[k].grabEdge && x) grabs[k] = x;
      if (x) C[k].inputYaw = x.yaw;
      C[k].bpm = bpm;
      C[k].update(dt, it, { beats: beat, bpm });
    }
    const out: TickOut = { n: this.tick, ev: [], tc: [], pe: [], fx: [] };
    // (where each body's own step left it: anything the contact or the powers change after is a push)
    const mine = C.map((c) => [c.root[0], c.root[1], c.root[2], c.v[0], c.v[1], c.v[2]]);
    if (this.running) {
      const pre: DuelEvent[] = [], preTouch: ContactEvent[] = [];
      for (let k = 0; k < 2; k++) if (grabs[k]) this.rewoundCatch(k, grabs[k]!, onBeat(beat, bpm), pre, preTouch);
      P.gripInputs(ins);
      const ev = M.step(now, beat, bpm, this.tickMs, [ins[0], ins[1]]);
      P.step(now, this.tickMs, pins, [...pre, ...ev], onBeat(beat, bpm));
      ev.unshift(...pre);
      ev.push(...P.duelEvents);
      for (const e of ev) {
        // (the finale: the set's powers end and fade, as the page's own duel does)
        if (e.k === 'finale') { this.finale.start(e.fused, bpm, [M.state.seats[0].style, M.state.seats[1].style]); P.settle(); }
        else if (e.k === 'set') this.finale.stop();
      }
      this.finale.update(dt);
      for (let k = 0; k < 2; k++) {
        const c = C[k], m = mine[k];
        if (Math.hypot(c.root[0] - m[0], c.root[1] - m[1], c.root[2] - m[2]) > 1e-4 || Math.hypot(c.v[0] - m[3], c.v[1] - m[4], c.v[2] - m[5]) > 1e-3) this.pushed[k] = this.tick;
      }
      // (the arena's gentle hazard, after the powers, on the room's beat: the tide, the wind, the swell, the hum; each
      // page's prediction runs it too, so its push is not counted as the other's)
      this.hazards?.step(beat, this.tickMs);
      out.ev = ev; out.tc = [...preTouch, ...M.touches]; out.pe = P.events; out.fx = P.fx;
    } else for (const c of C) c.events.length = 0;
    // the mirrors: a body whose middle passed a disc takes the duel to that world (crossing.ts), the other brought along
    const x = crossPair(C, this.world.id, this.judge, dt, M.contact.link);
    if (x) out.x = [this.moveTo(x)];
    const st = this.slowDelta();
    if (st) out.st = st;
    // (each body as it stands now, for a catch judged later where a catcher saw it)
    for (let k = 0; k < 2; k++) {
      const c = C[k], list = this.past[k];
      const rec = list.length >= Math.ceil(DUEL_NET.REWIND_MS / this.tickMs) + 4 ? list.shift()! : { tick: 0, pose: new Float32Array(c.pose.length), root: [0, 0, 0] as V3, grounded: false, onWall: false, reformT: -1 };
      rec.tick = this.tick; rec.pose.set(c.pose); rec.root = [c.root[0], c.root[1], c.root[2]]; rec.grounded = c.grounded; rec.onWall = c.onWall; rec.reformT = c.reformT;
      list.push(rec);
    }
    this.cost.push(performance.now() - t0);
    if (this.cost.length > 600) this.cost.splice(0, 300);
    return out;
  }

  /** the duel goes into the world a crossing leads to: its arena, solids, hazard and plane; the powers' effects settle
   *  (they stood in the old world); the music takes the new world's tempo from the next bar line; the set goes on */
  private moveTo(x: ReturnType<typeof crossPair> & {}): DuelCrossing {
    const N = nodeWorld(x.to)!;
    this.hazards?.rest();
    this.powers.settle();
    this.world = N; this.arena = N.arena;
    const plane = duelPlane(this.arena);
    this.solids.length = 0; this.solids.push(...(N.solids ?? []));
    for (const s of this.powers.solids) this.solids.push(s);
    this.match.moveTo(this.arena, plane);
    (this.powers as unknown as { o: { yKill?: number } }).o.yKill = this.arena.space.yKill;
    this.hazards = this.arena.hazard ? new DuelHazards(this.chars, this.match, this.arena, { on: true }) : null;
    this.hello.world = x.to;
    // (both bodies were moved by the gate: not a push of the other's, and no catch is judged against where they were)
    for (const list of this.past) list.length = 0;
    const t = this.timeOf(this.tick);
    this.music = { epoch: Math.round(nextBar(this.music, t)), bpm: tempoOf(x.to), mood: RULES.STAGE_MOODS[x.to] ?? 0 };
    const c: DuelCrossing = { n: this.tick, i: this.crossings.length + 1, ...x, music: { ...this.music } };
    this.crossings.push(c);
    return c;
  }

  /** a grab pressed by seat k while its screen showed the other at tick `x.view`: judged against the other as it was
   *  then (within REWIND_MS). Only when the present misses it (the contact's own catch then needs no help) */
  private rewoundCatch(k: number, x: DuelInput, beatOn: boolean, ev: DuelEvent[], tc: ContactEvent[]) {
    const M = this.match, contact = M.contact as unknown as ContactInner;
    if (M.state.phase !== 'play') return;
    if (contact.link) return this.no('joined');
    if (M.frozen(0) || M.frozen(1) || this.finale.active) return this.no('frozen');
    if (contact.t < contact.noGrab[k]) return this.no('regrab');
    const back = this.tick - x.view;
    if (!(back >= 0.5 && back <= DUEL_NET.REWIND_MS / this.tickMs)) return this.no('window');
    const o = 1 - k, list = this.past[o];
    const near = list.reduce<Past | null>((a, p) => (!a || Math.abs(p.tick - x.view) < Math.abs(a.tick - x.view) ? p : a), null);
    if (!near || near.reformT >= 0) return this.no('reforming');
    const C = this.chars;
    // (not when the other has gone too far since: the rope would snap it across the floor)
    const hands = [C[k].pose.subarray(3 * 4, 3 * 4 + 3), C[k].pose.subarray(3 * 7, 3 * 7 + 3)];
    const oc: V3 = [C[o].root[0], C[o].root[1] + 1, C[o].root[2]];
    if (Math.min(...hands.map((h) => Math.hypot(h[0] - oc[0], h[1] - oc[1], h[2] - oc[2]))) > DUEL_NET.REWIND_M) return this.no('far');
    // the present first: when it catches, the contact's own step will
    if (contact.tryCatch(k)) return this.no('present');
    // the other as it was: a stand-in body with its pose then
    const ghost = new Character({ seat: o, plane: C[o].plane, terrain: C[o].terrain });
    ghost.setProfile('duel');
    ghost.pose.set(near.pose); ghost.root = [...near.root]; ghost.grounded = near.grounded; ghost.reformT = -1;
    const pair = (k === 0 ? [C[0], ghost] : [ghost, C[1]]) as [Character, Character];
    const judge = new Contact(pair) as unknown as ContactInner;
    const hit = judge.tryCatch(k);
    if (!hit) return this.no('miss');
    // caught: the link as the contact makes one (contact.ts), between the bodies as they are now
    const a = C[k], b = C[o];
    const aBase = a.grounded || a.onWall, bBase = b.grounded || b.onWall;
    const holder = aBase === bBase ? k : aBase ? k : o, held = 1 - holder;
    const centre = (c: Character): V3 => [c.root[0], c.root[1] + 1.0, c.root[2]];
    const hp = contact.pivot(C[holder], centre(C[held]));
    const cc = centre(C[held]), dd = Math.hypot(cc[0] - hp[0], cc[1] - hp[1], cc[2] - hp[2]);
    const F = C[held];
    contact.link = { holder, held, part: hit.part, rest: Math.min(1.45, Math.max(0.75, dd)), since: contact.t, arc: 0, swings: 0, beatPump: false, at: hit.at, flying: false, c: cc, v: [F.v[0], F.v[1], F.v[2]], sense: 1 };
    contact.grabT[k] = -1;
    if (contact.flown && contact.flown.flyer === o) {
      tc.push({ kind: 'landed', seat: contact.flown.flinger, other: o, perfect: false, at: hit.at, how: 'catch' });
      ev.push(...duelFlingLanded(M.state, contact.flown.flinger));
      contact.flown = null;
    }
    const kind = near.grounded ? 'catch' : 'aerial';
    tc.push({ kind, seat: k, other: o, perfect: beatOn, at: hit.at });
    ev.push(...duelLink(M.state, k, kind, beatOn, this.now, this.setMs));
    this.rewound++;
  }

  /** the slow state as last sent: each top-level field of the rules' state, each seat, the powers' state (JSON) */
  private sentSlow = new Map<string, string>();
  /** the rules' state without its stats and its fast numbers, and the powers' rules' state */
  private slowParts() {
    const d = this.match.state as DuelState, pr = this.powers.rules as PowersState;
    const { stats: _s, ...rest } = d;
    void _s;
    const slow: Record<string, unknown> = { ...rest };
    for (const k of FAST) delete slow[k];
    slow.seats = d.seats.map(({ groundSince: _g, ...s }) => { void _g; return lite(s); });
    for (const k of Object.keys(slow)) if (k !== 'seats') slow[k] = lite(slow[k]);
    // (in the power form the flow is the form's time left, which the client works out from formUntil)
    const pw = { seats: pr.seats.map((s) => lite({ matter: s.matter, flow: s.formUntil > 0 ? 1 : s.flow, formUntil: s.formUntil, formFrom: s.formFrom, cool: s.cool, gap: s.gap, casts: s.casts, forms: s.forms })), reactions: pr.reactions };
    return { d: slow, pw };
  }
  /** the whole slow state (a joiner's), as JSON: { full, d, pw } */
  slowNow(): string { const { d, pw } = this.slowParts(); return JSON.stringify({ full: true, d, pw }); }
  /** what changed in it since the last tick, as JSON ({ d: the fields that changed, seats with null for one that
   *  didn't; pw when it did }), or null */
  private slowDelta(): string | null {
    const { d, pw } = this.slowParts(), S = this.sentSlow;
    const out: { d?: Record<string, unknown>; pw?: unknown } = {};
    const changed = (key: string, v: unknown) => { const j = JSON.stringify(v); if (S.get(key) === j) return false; S.set(key, j); return true; };
    for (const [k, v] of Object.entries(d)) {
      if (k === 'seats') {
        const seats = (v as unknown[]).map((s, i) => (changed(`seat${i}`, s) ? s : null));
        if (seats.some((s) => s)) (out.d ??= {}).seats = seats;
      } else if (changed(k, v)) (out.d ??= {})[k] = v;
    }
    if (changed('pw', pw)) out.pw = pw;
    return out.d || out.pw ? JSON.stringify(out) : null;
  }

  /** the flags the server knows of a body beyond the body's own */
  private flagsOf(k: number) {
    const M = this.match, P = this.powers as unknown as { carried: unknown[]; boost: unknown[]; ride: unknown[] };
    const held = M.contact.held(k), fin = this.finale.active;
    let f = (held ? DUEL_FLAG.HELD : 0) | (M.contact.holding(k) ? DUEL_FLAG.HOLDING : 0);
    if (held || P.carried[k] || P.boost[k] || P.ride[k] || fin) f |= DUEL_FLAG.CARRIED;
    if (this.tick - this.pushed[k] < DUEL_NET.TICK_HZ / DUEL_NET.SNAP_HZ) f |= DUEL_FLAG.PUSHED;
    if (this.running && (M.frozen(k) || fin)) f |= DUEL_FLAG.FROZEN;
    return f;
  }

  /** the JSON tail every receiver shares this tick: the rules' state, the link, the fling in flight, the powers */
  private shared(): string {
    const M = this.match, L = M.contact.link, P = this.powers;
    const d = M.state as DuelState;
    const x: Record<string, unknown> = {
      run: this.running,
      w: this.world.id, xi: this.crossings.length,
      e: [...FAST.map((k) => r3(d[k])), ...d.seats.map((s) => r3(s.groundSince))],
      L: L ? { holder: L.holder, held: L.held, part: L.part, at: rv(L.at), flying: L.flying, rest: r3(L.rest), age: r3(M.contact.age), swings: L.swings } : null,
      fl: M.contact.flown ? { flinger: M.contact.flown.flinger, flyer: M.contact.flown.flyer } : null,
      pc: r3(P.clock),
      fin: this.finale.active ? { fused: this.finale.fused, t: r3(this.finale.t), len: r3(this.finale.len), base: this.finale.base, flyer: this.finale.flyer } : null,
    };
    if (P.live.length) x.lv = P.live.map((l: Live) => lite({ ...l, riders: l.riders ? [...l.riders] : undefined }));
    return JSON.stringify(x);
  }

  private tail = { tick: -1, json: '' };
  /** the snapshot for a receiver: a seat (its ack and its own kit) or a watcher (null) */
  snapshot(seat: number | null): Uint8Array {
    if (this.tail.tick !== this.tick) this.tail = { tick: this.tick, json: this.shared() };
    const ts = this.timeOf(this.tick);
    const bodies = [0, 1].map((k) => bodySnap(this.chars[k], k, ts, this.flagsOf(k)));
    const json = seat == null ? this.tail.json : `{"k":${JSON.stringify(kitOf(this.chars[seat]))},"q":${this.seats[seat].queue.length},"r":${this.seats[seat].dry},` + this.tail.json.slice(1);
    return encodeDuelSnap({ tick: this.tick, ts, ack: seat == null ? -1 : this.seats[seat].ack, bodies }, json);
  }

  /** what the server's log and the tests read */
  stats() {
    const c = [...this.cost].sort((a, b) => a - b), q = (p: number) => c[Math.min(c.length - 1, Math.floor(p * c.length))] ?? 0;
    return {
      tick: this.tick, running: this.running, phase: this.match.state.phase, set: this.match.state.set,
      tickMs: { mean: c.reduce((a, b) => a + b, 0) / Math.max(1, c.length), p50: q(0.5), p99: q(0.99), max: c[c.length - 1] ?? 0 },
      seats: this.seats.map((S) => ({ ack: S.ack, queue: S.queue.length, starved: S.starved, folded: S.folded, lost: S.lost })),
      rewound: this.rewound, refused: { ...this.refused }, world: this.world.id, crossings: this.crossings.map((c) => ({ n: c.n, from: c.from, to: c.to, seat: c.seat, held: c.held })), heldBack: this.judge.held.map((h) => ({ tick: Math.round(h.t * DUEL_NET.TICK_HZ), seat: h.k, gate: h.gate })), style: this.match.state.seats.map((s) => Math.round(s.style)), stats: { ...this.match.state.stats },
    };
  }
}

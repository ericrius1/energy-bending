// An online duel from one page's side (the server is src/net/duel-authority.ts, run by server/duel.ts). Pure (no DOM,
// no GPU), so the Node tests run two of these against the real server; src/duel/online.ts joins one to the page.
//
//   inputs     the page's Intent, sampled at the server's tick rate into numbered inputs (an edge pressed between two
//              ticks goes into the next), each sent in a frame with the few before it. The tick rate leans a percent or
//              two either way to keep the server's queue for this seat near its target (the input's latency)
//   predicted  this seat's own body is a real Character stepped here with the same inputs the server will step it
//              with, so it answers the thumbs at once. Every snapshot says which input the server applied last (ack)
//              and where the body was then: if that differs from what was predicted for the same input (by more than
//              a couple of centimetres, or in the kit: grounded, the air jump, the dash), the body goes back to the
//              server's state at that input and the inputs since are stepped again; what that moves on screen is
//              eased out (`offset`), unless it is a jump of metres (a fall, a reform, a blink: a cut)
//   shown      the other body is played back from the snapshots (PoseBuffer: the jogo's jitter buffer), a little in
//              the past. While the two are joined (a catch, a swing), or this body is carried (a power, the finale),
//              this body is shown the same way, in the same past, so the hands that hold each other meet on screen
//   catches    a grab pressed with this body's hand within reach of the other as shown is felt at once (the catch's
//              events here, `local`), and the input says which tick was shown, so the server judges the catch there
//              (duel-authority.ts). The server's own catch event is then the confirmation (its duplicate not played
//              twice); one that doesn't come is a denial
//   events     everything else is the server's: each tick's events, played as they come, the same on every page
//   the rules  the rules' state, the link, the powers' effects: the last snapshot's
//   crossings  a mirror (src/duel/crossing.ts): the server judges every crossing and sends it with its tick (`x` in a
//              tick's events), and each snapshot says which world it is in. This page's own body crosses in its
//              prediction the moment its middle passes the disc (the same judge, the same carry), and is brought along
//              the moment the server says the other crossed; a prediction the server doesn't make is put right like any
//              other (the server's world, the inputs since stepped again there). The other body's snapshots are kept in
//              one frame across the crossings (`toF`: each world's coordinates into the first world's), so its playback
//              goes through the disc without a cut. What the page shows is in one world (`shownWorld`): this seat's
//              predicted world, or for a watcher (and a seat shown from the server, joined or carried) the world the
//              playback has reached. Each change of it is queued for the page (`takeCrossings`: the gate to bring both
//              bodies through, as Portals.bring does offline)
import { Character, type Terrain } from '../dancer/character';
import { makeIntent, EDGES, type Intent } from '../input/intent';
import { Contact, splitIntent, type ContactEvent, type Link } from '../duel/contact';
import type { StagePlane } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import type { Live, PowerFx } from '../duel/powers';
import { DuelHazards } from '../duel/hazards';
import type { Arena } from '../duel/arena';
import type { DuelMatch } from '../duel/match';
import { onBeat, DUEL, type DuelEvent, type DuelState } from '../../shared/duel.ts';
import type { PowerEvent } from '../../shared/powers.ts';
import { beatAt } from '../../shared/rules.ts';
import {
  DUEL_NET, DUEL_FLAG, encodeDuelInputs, decodeDuelSnap,
  type DuelBodySnap, type DuelCrossing, type DuelInput, type DuelSnap, type DuelTickEvents, type DuelWelcome, type DuelSlowState, type MusicClock, type V3,
} from '../../shared/protocol.ts';
import { Rigid } from '../portals/rigid';
import { CROSS, CrossJudge, bringMove, carryBody, duelDoors, middleOf, nodeWorld, yawOfMove, type JudgeState } from '../duel/crossing';
import type { NodeWorld } from '../duel/stages';
import { duelPlane } from '../duel/match';
import { PoseBuffer, DIM, YAW, LOCAL, type BufferParams } from './net';
import { inputOf, intentOf, kitOf, kitField, setKit, poseHazard, saveChar, loadChar, puppet, styleByte, type CharSave, type Kit, type ShownBody } from './duel-body';

/** what the client needs of its connection (Net has these) */
export interface DuelLink {
  now(): number;
  readonly rtt: number;
  readonly jitter: number;
  sendBinary(b: Uint8Array): void;
}

export const CLIENT = {
  /** a prediction off by more than this at the acknowledged input is corrected (m, m/s) */
  EPS: 0.02,
  EPS_V: 0.25,
  /** a correction this big is a cut, not eased (m) */
  CUT: 1.5,
  /** how fast a correction's shift on screen eases out (s) */
  EASE: 0.09,
  /** the most ticks one update steps (a page that stalled catches up no faster) */
  MAX_TICKS: 6,
  /** the server's input queue for this seat is kept near 2 + jitter / tick (ticks), within these: an input that
   *  isn't there when its tick comes makes the server repeat the last (a correction here) */
  QUEUE_MIN: 3,
  QUEUE_MAX: 8,
  /** how much the tick rate leans to move the queue (a fraction) */
  LEAN: 0.03,
  /** a local catch the server hasn't confirmed by rtt + this (ms), or by this many ticks past its input, was denied
   *  (a grab is good for the contact's BUFFER, 0.2 s: the server may catch with it a little later) */
  CONFIRM_MS: 400,
  CONFIRM_TICKS: 14,
  LATE_MS: 800,
  /** after a fling, a counter or a lift the holder can't catch again for the contact's REGRAB (s) */
  REGRAB_S: 0.35,
  /** a snapshot past a crossing this page hasn't heard of is kept back this long (ms) before the crossing counts as missed */
  AHEAD_MS: 2500,
  /** the shown world going back within this long (ms) counts as a flip-flop (the server holds 1.5 s between crossings) */
  FLIP_MS: 1000,
  /** a seat's shown world goes straight back only once the prediction has stood there this long (ms) */
  BACK_HOLD_MS: 250,
  /** this page's prediction holds its body back this much longer after a crossing than the server does (s): the tick an
   *  input will be stepped on is known only to a tick or two, and a crossing right at the end of the hold, predicted a
   *  tick early, was put back a moment later (a flip-flop); a tick late, the server's word brings it along instead */
  HOLD_PAD: 0.1,
  /** the other body's snapshots kept for where it stood when an input is stepped (a second and a half at SNAP_HZ),
   *  and how far past the newest it is carried on by its velocity (s) */
  TRACK: 30,
  LOOK_AHEAD: 0.3,
  /** at most this many ticks the server stepped without an input of this seat's are stepped again here (more: a stall,
   *  the server's state taken as it is) */
  REP_MAX: 6,
};

/** a tick's events as the page plays them (`local`: this page's own catch, felt before the server says so) */
export interface DuelFrameEvents { n: number; ev: DuelEvent[]; tc: ContactEvent[]; pe: PowerEvent[]; fx: PowerFx[]; local?: boolean; x?: DuelCrossing[] }

interface Hist { x: DuelInput; save: CharSave; root: V3; v: V3; at: number; grounded: boolean; world: string; judge: JudgeState }

/** a change of the world this page shows, for the page to follow (src/duel/online.ts: both bodies brought through
 *  `gate`, the duel moved to `to`): why it changed (this seat's prediction, the server's word, a correction going back) */
export interface ShownCrossing { gate: string; partner: string; from: string; to: string; front: boolean; held: boolean; why: 'predicted' | 'server' | 'corrected'; t: number }
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface DuelClientOptions {
  welcome: DuelWelcome;
  /** this page's seat (0, 1), or null watching */
  seat: number | null;
  link: DuelLink;
  /** unused: the client stands its body in the world it is in (crossing.ts nodeWorld), with the powers' solids */
  terrain?: Terrain;
  /** the arena's plane when the room is locked to it */
  plane: StagePlane | null;
  /** unused: the arena is the world's (its gentle hazard moves the predicted body as the server's moves the server's) */
  arena?: Arena | null;
  buffer?: Partial<BufferParams>;
}

export class DuelClient {
  readonly seat: number | null;
  readonly w: DuelWelcome;
  /** this seat's body as predicted (null watching) */
  readonly pred: Character | null;
  /** the bodies as last shown (puppets the page's rig and effects read) */
  readonly shownChars: [Character, Character];
  // ---- the mirror of the server's: the last snapshot's
  running = false;
  state: Partial<DuelState> | null = null;
  link: (Partial<Link> & { holder: number; held: number; at: V3; age: number }) | null = null;
  flown: { flinger: number; flyer: number } | null = null;
  live: Live[] = [];
  powers: { seats: Record<string, unknown>[]; reactions: Record<string, number> } | null = null;
  /** the powers' clock (s) at the last snapshot, and that snapshot's server time */
  pclock = 0;
  finale: { fused: boolean; t: number; len: number; base: number; flyer: number } | null = null;
  /** the powers' temporary solids as the server has them (the predicted body stands on them) */
  readonly solids: Solid[] = [];
  solidsVersion = 0;
  last: DuelSnap | null = null;
  /** the newest snapshot of each body */
  readonly newest: (DuelBodySnap | null)[] = [null, null];

  private bufs: PoseBuffer[];
  private sampled = new Float64Array(DIM);
  private seq = 0;
  private acc = 0;
  private pending: Intent = makeIntent();
  private sent: DuelInput[] = [];
  private hist = new Map<number, Hist>();
  private ack = -1;
  /** ticks the server stepped past the last ack without an input (the snapshot's `r`), and that ack's prediction */
  private ackRep = 0;
  private ackHist: Hist | null = null;
  /** the tick of the snapshot that told the link, and the last tick the server's events ended one */
  private linkAt = -1;
  private linkEnd = -1;
  /** the server tick of the last ack */
  private ackTick = 0;
  private replaying = false;
  private yaw = 0;
  /** what a correction moved on screen, easing out */
  private offset: V3 = [0, 0, 0];
  private follow = false;
  private followW = 0;
  private queue: DuelFrameEvents[] = [];
  private tent: { seq: number; until: number; kind: 'catch' | 'aerial' } | null = null;
  private look: V3 = [0, 0, 0];
  /** each body's recent snapshots (server time, root and velocity in the frame the snapshots are kept in) */
  private track: { ts: number; root: V3; v: V3 }[][] = [[], []];
  /** the worst steady errors this run (report().worst) */
  worst: { e: number; d: number[]; v: number[]; ack: number; diff: Record<string, unknown> }[] = [];
  /** the arena's hazard as the server steps it, on the predicted body */
  private hz: DuelHazards | null = null;
  private hzMatch: { bodyEvents: Record<string, unknown>[][] } | null = null;
  private hzPair: [Character, Character] | null = null;
  private hzOn(A: Arena | null) { this.hz = A?.hazard && this.hzPair && this.hzMatch ? new DuelHazards(this.hzPair, this.hzMatch as unknown as DuelMatch, A) : null; }
  /** the arena this seat's body is predicted in */
  private get arenaNow(): Arena | null { return this.N?.arena ?? this.o.arena ?? null; }
  /** the server tick before which each seat can't catch again (a fling, a counter or a lift just ended its hold) */
  private noGrab = [0, 0];
  private judge: Contact | null = null;
  private lastSnapTick = -1;
  /** every server event, in order, as a line each (the tests compare two pages' logs) */
  readonly log: string[] = [];
  // ---- the worlds (crossing.ts)
  /** the world the server's duel is in (its newest word), this seat's predicted body's, and the one shown */
  world: string;
  predWorld: string;
  shownWorld: string;
  /** the music's clock now (the welcome's, then each crossing's) */
  music: MusicClock;
  /** the server's crossings this page has heard of (from the room's `xi0`-th on) */
  readonly xs: DuelCrossing[] = [];
  private xi0 = 0;
  /** how many of them (the list keeps the last few) */
  private xn = 0;
  /** a crossing was missed (a dropped connection): the page should start again in the room's world */
  lost = false;
  lostWhy = "";
  private aheadSince = -1;
  private pendingBack: { to: string; since: number } | null = null;
  /** the predictions put back, what they were (for the measures) */
  readonly putBacks: Record<string, unknown>[] = [];
  /** the worst error near a crossing, and what it was */
  worstX: Record<string, unknown> & { e: number } | null = null;
  /** each world's coordinates into the frame the snapshots are kept in (the first world's) */
  private toF = new Map<string, Rigid>();
  /** the gate last crossed between two worlds ("from>to"), either way */
  private gateOf = new Map<string, { gate: string; front: boolean; held: boolean }>();
  private cross = new CrossJudge(duelDoors());
  private shownQ: ShownCrossing[] = [];
  private shownAt: { to: string; from: string; t: number } | null = null;
  /** the world each newest snapshot body was in */
  private newestW: string[];
  private N: NodeWorld | null;
  private terrain: Terrain;
  private plane: StagePlane | null;
  readonly stats = {
    snaps: 0, bytesIn: 0, bytesOut: 0, devBytes: 0, ticks: 0,
    /** the prediction's error at each acknowledged input (m), before any correction */
    err: [] as number[],
    /** the same, where the other or a power moved this body (the first snapshot after a hold let it go, a vault, a
     *  wave): not this page's to predict */
    errAfter: [] as number[],
    corrections: 0, cuts: 0, replayed: 0,
    /** crossings: this seat's predicted (and how many the server then made too), brought along by the other's (heard
     *  from the server), predictions put back (the server didn't cross), changes of the shown world and those that went
     *  straight back within 1.5 s (a flip-flop), and the prediction's error at the acks within a second of a crossing */
    crossPred: 0, crossOk: 0, crossBrought: 0, crossBack: 0, shown: 0, flips: 0,
    errX: [] as number[],
    /** this page's catches: felt here, confirmed by the server, denied */
    caught: 0, confirmed: 0, denied: 0, mutual: 0,
    /** ticks shown from the server (joined, carried) */
    followTicks: 0,
    since: 0,
  };

  constructor(readonly o: DuelClientOptions) {
    this.seat = o.seat;
    this.w = o.welcome;
    this.world = this.predWorld = this.shownWorld = o.welcome.world;
    this.music = { ...o.welcome.music };
    this.xi0 = o.welcome.crossings ?? 0;
    this.toF.set(this.world, new Rigid());
    this.newestW = [this.world, this.world];
    this.N = nodeWorld(this.world);
    this.plane = o.plane;
    // the world as this page's body stands in it: its floor, its solids with the powers' temporary ones (as the server
    // has them), its fall-out; the world it is in is whichever it has crossed into
    const self = this;
    let solidsAt = -1, solidsList: Solid[] = [], solidsOf: NodeWorld | null = null;
    this.terrain = o.terrain && !this.N ? o.terrain : {
      groundAt: (x: number, z: number) => (self.N ? self.N.groundAt(x, z) : 0),
      get fallY() { return self.N?.fallY; },
      get solids(): readonly Solid[] {
        if (solidsAt !== self.solidsVersion || solidsOf !== self.N) { solidsAt = self.solidsVersion; solidsOf = self.N; solidsList = [...(self.N?.solids ?? []), ...self.solids]; }
        return solidsList;
      },
    };
    this.bufs = [0, 1].map(() => new PoseBuffer(o.buffer));
    this.shownChars = [0, 1].map((k) => { const c = new Character({ seat: k, plane: null, terrain: this.terrain }); c.setProfile('duel'); return c; }) as [Character, Character];
    if (o.seat != null) {
      const c = new Character({ seat: o.seat, plane: o.plane, terrain: this.terrain });
      c.setProfile('duel');
      c.yaw = o.seat ? -Math.PI / 2 : Math.PI / 2;
      this.pred = c;
      // the arena's hazard on the predicted body, as the server steps it after the powers: a stand-in for the match
      // (the phase, who is frozen or held, this body's own events) and a body that stands in for the other seat
      {
        const other = new Character({ seat: 1 - o.seat, plane: null, terrain: this.terrain });
        const pair = (o.seat === 0 ? [c, other] : [other, c]) as [Character, Character];
        const self = this;
        const stand = {
          get state() { return { phase: self.running ? self.state?.phase ?? 'done' : 'done' }; },
          frozen: (k: number) => !!((self.newest[k]?.flags ?? 0) & DUEL_FLAG.FROZEN),
          contact: { held: (k: number) => self.link?.held === k },
          bodyEvents: [[], []] as Record<string, unknown>[][],
        };
        this.hzMatch = stand;
        this.hzPair = pair;
        this.hzOn(this.N?.arena ?? o.arena ?? null);
      }
    } else this.pred = null;
    this.stats.since = performance.now();
  }

  get tickMs() { return this.w.tickMs; }
  /** the duel's clock now (ms): the server's present, which DuelState's times are on */
  now() { return this.o.link.now() - this.w.t0; }
  /** the server's tick now (fractional) */
  serverTick() { return this.now() / this.tickMs; }
  beat(t = this.o.link.now()) { return beatAt(this.music, t); }
  /** the powers' clock now (s) */
  powersClock() { return this.last && this.running ? this.pclock + Math.max(0, this.o.link.now() - this.last.ts) / 1000 : this.pclock; }
  /** the other body's playback delay (ms) */
  get delay() { return this.bufs[this.other]?.delay ?? 0; }
  get other() { return this.seat == null ? 1 : 1 - this.seat; }

  // ---------------------------------------------------------------- inputs and the prediction
  /** each frame: this seat's Intent as the device made it (null: none), the camera's yaw; steps the ticks due */
  update(dtMs: number, intent: Intent | null, yaw = 0) {
    this.yaw = yaw;
    if (intent) {
      const P = this.pending as unknown as Record<string, unknown>, I = intent as unknown as Record<string, unknown>;
      for (const k of Object.keys(intent)) if (!(EDGES as readonly string[]).includes(k)) P[k] = I[k];
      for (const e of EDGES) if (I[e]) P[e] = true;
    }
    if (this.seat == null || !this.pred) return;
    // (the tick rate leans to keep the server's queue for this seat near its target)
    const qs = this.last?.x.q as number | undefined;
    const want = Math.max(CLIENT.QUEUE_MIN, Math.min(CLIENT.QUEUE_MAX, 3 + Math.ceil(this.o.link.jitter / this.tickMs)));
    const lean = qs == null ? 0 : Math.max(-1, Math.min(1, (want - qs) / 2)) * CLIENT.LEAN;
    this.acc += dtMs * (1 + lean);
    let n = 0;
    while (this.acc >= this.tickMs && n < CLIENT.MAX_TICKS) { this.acc -= this.tickMs; this.tickOnce(); n++; }
    if (this.acc > this.tickMs * CLIENT.MAX_TICKS) this.acc = 0;
    this.ease(dtMs / 1000);
  }

  private tickOnce() {
    const x = inputOf(this.pending, this.seq++, this.yaw, this.viewTick());
    for (const e of EDGES) (this.pending as unknown as Record<string, boolean>)[e] = false;
    // (the beat this input will be stepped on at the server: half a round trip and the queue ahead of now)
    const q = Number(this.last?.x.q ?? 3);
    this.predict(x, this.o.link.now() + this.o.link.rtt / 2 + q * this.tickMs, null);
    this.sent.push(x);
    if (this.sent.length > DUEL_NET.REDUNDANT + 1) this.sent.shift();
    const frame = encodeDuelInputs(this.sent);
    this.stats.bytesOut += frame.length;
    this.stats.ticks++;
    this.o.link.sendBinary(frame);
  }

  /** the tick the other body shows at now (the catch is judged there) */
  private viewTick() { return (this.o.link.now() - this.delay - this.w.t0) / this.tickMs; }

  /** this seat's flags as the server last had them */
  private get flags() { return this.seat != null ? this.newest[this.seat]?.flags ?? 0 : 0; }

  /** one tick of this seat's body, as the server will step it (`at`: the server time it will be stepped at) */
  private predict(x: DuelInput, at: number, h: Hist | null, rep?: { n: number; T: number }): Hist {
    // (the server tick this input will be stepped on: the last ack's tick and the inputs since. Its time is the beat the
    // server steps it on: the estimate from the queue (`at`) ran two ticks early, report 22)
    const T = rep ? rep.T : this.ack >= 0 ? this.ackTick + (x.seq - this.ack) : this.serverTick();
    if (this.ack >= 0 || rep) at = this.w.t0 + T * this.tickMs;
    const c = this.pred!, k = this.seat!, beat = this.beat(at), bpm = this.music.bpm;
    // (a tick the server stepped with no input of this seat's to take: the last repeated without its presses, and past
    // DUEL_NET.STILL_TICKS none, as duel-authority.ts `take` does)
    let it = rep ? (rep.n > DUEL_NET.STILL_TICKS ? makeIntent() : intentOf(x, false)) : intentOf(x, true);
    const frozen = this.frozenAt(T);
    if (frozen) it = makeIntent();
    // (only the server's link: a catch felt here and not yet confirmed changes nothing of the body, so a denied one
    // costs no correction. A link the server's events say ended (a fling, a release, a counter) holds no input stepped
    // after that tick: the holder's thumbs move it again at once, report 22)
    const L = this.link && !(this.linkEnd >= this.linkAt && T > this.linkEnd) ? this.link : null;
    const ci = frozen ? null : splitIntent(c, it, L?.holder === k, L?.held === k);
    // (this seat holds the other and lets its grab go: the server flings on this tick, after the bodies' step
    // (contact.ts), and the inputs after it move this body again. The prediction runs a queue ahead of the server, so
    // the fling's event comes too late for them)
    if (L && L.holder === k && !ci?.grab) this.linkEnd = Math.max(this.linkEnd, T);
    c.inputYaw = x.yaw; c.bpm = bpm;
    // (it faces the other where the server's body does: the other as it stood at the end of the tick before (the server
    // points lookAt at the other's root as the tick begins), from its snapshots, carried on by its velocity past the
    // newest. Not where the other is now, nor as shown: a replayed input faces where the other was when it is stepped)
    c.lookAt = this.lookAtTime(1 - k, this.w.t0 + (T - 1) * this.tickMs) ?? this.shownChars[1 - k].root;
    // (the hazard's water and stones where the server's will be when it steps this input: its last tick's beat)
    poseHazard(this.arenaNow?.hazard, this.beat(at - this.tickMs));
    c.update(this.tickMs / 1000, it, { beats: beat, bpm });
    if (this.hz && this.hzMatch) { this.hzMatch.bodyEvents[k] = c.events.slice(); this.hz.step(beat, this.tickMs); this.hzMatch.bodyEvents[k] = []; }
    c.events.length = 0;
    if (ci?.grabEdge && !this.replaying) this.tryCatch(x.seq);
    // the mirrors: this body's middle through a disc of its world crosses at once, as the server will judge it
    // (on the server's clock: the tick this input will be stepped on, from the last ack's. A crossing the server made
    // holds this body back as the server holds it, from the server's tick, however late this page heard of it)
    this.cross.t = T * this.tickMs / 1000;
    const X = this.xs[this.xs.length - 1];
    if (X && X.to === this.predWorld) {
      const tX = (X.n * this.tickMs) / 1000;
      this.cross.exempt[k] = Math.max(this.cross.exempt[k], tX + (X.held ? CROSS.HOLD_HELD : CROSS.HOLD_FREE) + CLIENT.HOLD_PAD);
      if (!this.cross.behind || this.cross.behind.until < tX + CROSS.BEHIND_S) this.cross.behind = { gate: X.partner, until: tX + CROSS.BEHIND_S };
    }
    const hit = this.cross.body(k, this.predWorld, middleOf(c));
    if (hit && hit.gate.partner) {
      const g = hit.gate, held = !!L;
      carryBody(c, g.through);
      this.cross.after({ partner: g.partner!.id, held });
      this.cross.exempt[k] += CLIENT.HOLD_PAD;
      this.link3(g.id, hit.front, held);
      this.setPredWorld(g.partner!.world);
      if (!this.replaying) this.stats.crossPred++;
      if (!this.replaying) this.predX.push({ seq: x.seq, to: g.partner!.world });
    }
    const rec: Hist = h ?? { x, save: {}, root: [0, 0, 0], v: [0, 0, 0], at, grounded: false, world: '', judge: this.cross.save() };
    rec.save = saveChar(c); rec.root = [c.root[0], c.root[1], c.root[2]]; rec.v = [c.v[0], c.v[1], c.v[2]]; rec.grounded = c.grounded;
    rec.world = this.predWorld; rec.judge = this.cross.save();
    if (!h && !rep) this.hist.set(x.seq, rec);
    return rec;
  }

  /** is this seat's body held still (no thumbs) on server tick T? The last snapshot's word, carried on to T by the
   *  rules' clock: the count-in and a reform end on their time, and an input stepped after that moves the body (the
   *  server decides it from the state the tick before) */
  private frozenAt(T: number) {
    if (!this.running || !(this.flags & DUEL_FLAG.FROZEN)) return false;
    const d = this.state, k = this.seat!, t = (T - 1) * this.tickMs;
    if (!d || this.finale) return true;
    if (d.phase === 'intro' && d.since != null && d.countMs) return t - d.since < DUEL.COUNT_FROM * d.countMs;
    const fa = d.seats?.[k]?.fellAt;
    if (fa != null && fa >= 0) return t - fa < DUEL.REFORM_MS;
    return true;
  }

  /** the other body's root at server time t, in this seat's predicted world: between its snapshots, or carried on by
   *  its velocity past the newest (at most LOOK_AHEAD s). Null: none yet */
  private lookAtTime(o: number, t: number): ArrayLike<number> | null {
    const tr = this.track[o], F = this.toF.get(this.predWorld);
    if (!tr.length || !F) return null;
    let i = tr.length - 1;
    while (i > 0 && tr[i].ts > t) i--;
    const a = tr[i], b = tr[i + 1], out = this.look;
    if (b && t >= a.ts) {
      const u = (t - a.ts) / Math.max(1e-6, b.ts - a.ts);
      for (let j = 0; j < 3; j++) out[j] = a.root[j] + (b.root[j] - a.root[j]) * u;
    } else {
      const s = Math.max(-CLIENT.LOOK_AHEAD, Math.min(CLIENT.LOOK_AHEAD, (t - a.ts) / 1000));
      for (let j = 0; j < 3; j++) out[j] = a.root[j] + (j === 1 ? 0 : a.v[j] * s);
    }
    F.inverse().pt(out, out);
    return out;
  }

  // ---------------------------------------------------------------- the worlds
  /** this seat's predicted crossings (the input's seq, the world it went to), for the error around them */
  private predX: { seq: number; to: string }[] = [];
  /** a gate crossed: the frame of the world it leads to, and the gate remembered between the two (either way) */
  private link3(id: string, front: boolean, held: boolean) {
    const g = duelDoors().get(id);
    if (!g?.partner) return;
    const from = g.world, to = g.partner.world, F = this.toF.get(from);
    if (F) this.toF.set(to, F.mul(g.partner.through));
    this.gateOf.set(`${from}>${to}`, { gate: g.id, front, held });
    this.gateOf.set(`${to}>${from}`, { gate: g.partner.id, front, held });
  }
  /** the move from world a's coordinates into world b's (null: not known) */
  move(a: string, b: string): Rigid | null {
    if (a === b) return IDENTITY;
    const A = this.toF.get(a), B = this.toF.get(b);
    return A && B ? B.inverse().mul(A) : null;
  }
  /** this seat's body is in another world: its floor, solids, arena hazard and plane are that world's */
  private setPredWorld(id: string) {
    if (id === this.predWorld) return;
    this.predWorld = id;
    this.N = nodeWorld(id);
    this.hzOn(this.N?.arena ?? null);
    if (this.plane && this.pred && this.N) { this.plane = duelPlane(this.N.arena); this.pred.setPlane(this.plane); }
  }
  /** a crossing the server judged: the music's clock, the frames; this seat's body brought along (or carried, if it
   *  crossed and the prediction missed it) unless the prediction made it already */
  private heard(x: DuelCrossing) {
    this.xs.push(x); this.xn++;
    if (this.xs.length > 64) this.xs.splice(0, 32);
    this.music = { ...x.music };
    this.link3(x.gate, x.front, x.held);
    this.world = x.to;
    if (this.seat == null || !this.pred) return;
    if (this.predWorld === x.to) { this.stats.crossOk++; return; }
    // (the prediction elsewhere, a crossing of its own in flight: the next acknowledged input puts it right)
    const seqN = this.ack + (x.n - this.ackTick);
    if (this.predWorld !== x.from || [...this.hist].some(([q, h]) => q >= seqN && h.world !== x.from)) return;
    const g = duelDoors().get(x.gate)!, c = this.pred;
    // (the bring as the server made it: from where this body was at the input the server stepped on the crossing's tick,
    // which the last ack and its tick tell; then that same rigid move for every state predicted since, and for now)
    const hN = this.hist.get(seqN), mid = middleOf(c);
    const at: V3 = hN ? [hN.root[0], hN.root[1] + (mid[1] - c.root[1]), hN.root[2]] : mid;
    const Mv = x.seat === this.seat ? g.through : bringMove(g, at, x.front, x.held);
    carryBody(c, Mv);
    this.cross.after({ partner: x.partner, held: x.held });
    for (const [q, h] of this.hist) {
      if (q < seqN) continue;
      h.root = Mv.pt(h.root); h.v = Mv.dir(h.v); h.world = x.to; h.save = this.carried(h.save, Mv);
      h.judge = { ...this.cross.save(), t: h.judge.t };
    }
    this.setPredWorld(x.to);
    this.stats.crossBrought++;
  }
  /** a saved body carried by a move (a stand-in body loaded, carried, saved again) */
  private scratch: Character | null = null;
  private carried(s: CharSave, M: Rigid): CharSave {
    const t = (this.scratch ??= (() => { const c = new Character({ seat: this.seat ?? 0, plane: null, terrain: this.terrain }); c.setProfile('duel'); return c; })());
    loadChar(t, s); carryBody(t, M);
    return saveChar(t);
  }
  /** the crossings the page should follow since the last call (both bodies through the gate, the duel moved) */
  takeCrossings(): ShownCrossing[] { const q = this.shownQ; this.shownQ = []; return q; }
  /** the world the server's duel was in at server time t (the playback's, a little in the past) */
  private worldAt(t: number) {
    let w = this.xs.length ? this.xs[0].from : this.world;
    for (const x of this.xs) if (this.w.t0 + x.n * this.tickMs <= t) w = x.to;
    return w;
  }
  /** the page goes into another world (why: whose word) */
  private showIn(to: string, why: ShownCrossing['why']) {
    const from = this.shownWorld, G = this.gateOf.get(`${from}>${to}`), g = G ? duelDoors().get(G.gate) : null;
    if (!G || !g?.partner) { this.lost = true; this.lostWhy = `no gate ${from}>${to}`; return; }
    const t = this.o.link.now();
    if (this.shownAt && this.shownAt.from === to && this.shownAt.to === from && t - this.shownAt.t < CLIENT.FLIP_MS) this.stats.flips++;
    this.shownAt = { from, to, t };
    this.shownWorld = to;
    this.stats.shown++;
    this.shownQ.push({ gate: G.gate, partner: g.partner.id, from, to, front: G.front, held: G.held, why, t });
  }

  /** a grab pressed: within reach of the other as shown? Then it is felt now (the server's word follows) */
  private tryCatch(seq: number) {
    const k = this.seat!, s = this.state;
    if (!this.running || s?.phase !== 'play' || this.link || this.tent) return;
    // (just let go of a hold: not yet, as the server would say; its tick about when this input reaches it)
    if (this.serverTick() + this.o.link.rtt / 2 / this.tickMs < this.noGrab[k]) return;
    const me = this.pred!, them = this.shownChars[1 - k];
    if (me.reforming || them.reforming || this.predWorld !== this.shownWorld) return;
    const pair = (k === 0 ? [me, them] : [them, me]) as [Character, Character];
    if (!this.judge || this.judge.chars[0] !== pair[0]) this.judge = new Contact(pair);
    const hit = (this.judge as unknown as { tryCatch(k: number): { at: V3 } | null }).tryCatch(k);
    if (!hit) return;
    const aBase = me.grounded || me.onWall, bBase = them.grounded || them.onWall;
    const holder = aBase === bBase ? k : aBase ? k : 1 - k;
    const kind = them.grounded ? 'catch' : 'aerial';
    this.tent = { seq, until: performance.now() + this.o.link.rtt + CLIENT.CONFIRM_MS, kind };
    void holder;
    this.stats.caught++;
    const beat = this.beat(), bpm = this.music.bpm, perfect = onBeat(beat, bpm);
    const C = s.seats?.[k]?.combo;
    const n = (C?.n ?? 0) + 1;
    this.queue.push({
      n: Math.round(this.serverTick()), local: true, pe: [], fx: [],
      tc: [{ kind, seat: k, other: 1 - k, perfect, at: hit.at }],
      ev: [{ k: 'link', seat: k, kind, perfect, n, mult: Math.min(4, 1 + n * 0.25), value: 0 }],
    });
  }

  // ---------------------------------------------------------------- what the server sends
  /** a binary frame from the server: a snapshot */
  onFrame(b: Uint8Array) {
    this.stats.bytesIn += b.length;
    const s = decodeDuelSnap(b);
    if (!s || s.tick <= this.lastSnapTick) return;
    this.lastSnapTick = s.tick;
    this.stats.snaps++;
    this.last = s;
    const x = s.x as Record<string, any>;
    this.running = !!x.run;
    this.fast(x.e);
    this.link = x.L ?? null;
    this.linkAt = s.tick;
    this.flown = x.fl ?? null;
    this.pclock = x.pc ?? 0;
    this.finale = x.fin ?? null;
    this.mirrorLive((x.lv ?? []) as Live[]);
    const now = this.o.link.now();
    // (the world it is in: a world this page has no way into is a crossing it missed, a dropped connection)
    const Ws = typeof x.w === 'string' ? x.w : this.world;
    // (a snapshot past a crossing whose event hasn't come yet: the conditioner, or a slow reliable channel, can pass the
    // snapshots ahead of the events. Kept back until the event comes; still ahead after AHEAD_MS, it was missed)
    const F = this.toF.get(Ws), ahead = (typeof x.xi === 'number' && x.xi > this.xi0 + this.xn) || !F;
    if (ahead) {
      const t = performance.now();
      if (this.aheadSince < 0) this.aheadSince = t;
      if (t - this.aheadSince > CLIENT.AHEAD_MS && !this.lost) { this.lost = true; this.lostWhy = F ? `crossing ${x.xi} not heard (${this.xi0}+${this.xn})` : `no way into ${Ws}`; }
      return;
    }
    this.aheadSince = -1;
    const dy = yawOfMove(F);
    for (const B of s.bodies) {
      if (B.seat > 1) continue;
      this.newest[B.seat] = B; this.newestW[B.seat] = Ws;
      const tr = this.track[B.seat];
      // (carried on by the way it went between its last two snapshots: a move carries a body by its pose, and its
      // velocity says less of where it goes next than its last steps do)
      const fr = F.pt(B.root), pv = tr[tr.length - 1], gap = pv ? (B.ts - pv.ts) / 1000 : 0;
      const fv = pv && gap > 1e-3 && gap < 0.2 && dist(pv.root, fr) < 1 ? [0, 1, 2].map((j) => (fr[j] - pv.root[j]) / gap) as V3 : F.dir(B.v);
      tr.push({ ts: B.ts, root: fr, v: fv });
      if (tr.length > CLIENT.TRACK) tr.shift();
      const v = new Float64Array(DIM), r = F.pt(B.root);
      v[0] = r[0]; v[1] = r[1]; v[2] = r[2]; v[YAW] = B.yaw + dy;
      v.set(B.p, LOCAL);
      this.bufs[B.seat].push(B.ts, v, { flags: B.flags, energy: B.energy * 255, world: '', move: B.move }, now);
    }
    if (this.seat != null && this.pred) {
      const B = s.bodies.find((b) => b.seat === this.seat);
      if (B && s.ack >= 0) this.reconcile(s.ack, B, x.k as Kit | undefined, Ws, s.tick, Number(x.r) || 0);
    }
    // a local catch not confirmed in time, or the server past its input with nobody joined: denied
    if (this.tent && (performance.now() > this.tent.until || (s.ack >= this.tent.seq + CLIENT.CONFIRM_TICKS && !this.link))) {
      this.deniedAt = performance.now(); this.tent = null; this.stats.denied++;
    }
  }
  /** when this page's last felt catch was given up on (a late confirmation within LATE_MS still counts) */
  private deniedAt = -1e9;

  /** the rules' state and the powers' state, as they changed (reliable, in order with the events) */
  onState(m: DuelSlowState & { full?: boolean }, bytes = 0) {
    this.stats.devBytes += bytes;
    const d = (m.d ?? {}) as Partial<DuelState>;
    if (m.full || !this.state) this.state = { ...d };
    else {
      // (a change: the fields that changed, and each seat that did)
      const { seats, ...rest } = d;
      Object.assign(this.state, rest);
      if (seats) this.state.seats = this.state.seats!.map((s, i) => (seats[i] ?? s)) as DuelState['seats'];
    }
    if (m.pw) this.powers = m.pw as DuelClient['powers'];
    this.fast(this.lastFast ?? undefined);
  }
  private lastFast: number[] | null = null;
  /** the rules' numbers every snapshot carries (energy, merge, peak, the stretch near the top; each seat's ground) */
  private fast(e: number[] | undefined) {
    if (!e || !this.state) { if (e) this.lastFast = e; return; }
    this.lastFast = e;
    const d = this.state as Record<string, unknown>;
    d.energy = e[0]; d.merge = e[1]; d.peak = e[2]; d.highSince = e[3]; d.highBest = e[4];
    const seats = this.state.seats;
    if (seats) for (let k = 0; k < 2; k++) if (seats[k]) seats[k].groundSince = e[5 + k];
  }

  /** a tick's events from the server (reliable, in order) */
  onEvents(m: DuelTickEvents, bytes = 0) {
    this.stats.devBytes += bytes;
    const e: DuelFrameEvents = { n: m.n, ev: (m.ev ?? []) as DuelEvent[], tc: (m.tc ?? []) as ContactEvent[], pe: (m.pe ?? []) as PowerEvent[], fx: (m.fx ?? []) as PowerFx[], ...(m.x?.length ? { x: m.x } : {}) };
    this.log.push(`${m.n} ${JSON.stringify([m.ev ?? [], m.tc ?? [], m.pe ?? [], ...(m.x?.length ? [m.x.map((c) => [c.i, c.gate, c.seat, c.held])] : [])])}`);
    for (const x of m.x ?? []) if (x.i > this.xi0 + this.xn) this.heard(x);
    if (this.log.length > 20000) this.log.splice(0, 10000);
    // (the holder of a hold that just ended can't catch again for a moment: the server's rule, kept here too)
    for (const t of e.tc) {
      if (t.kind === 'fling' || t.kind === 'release' || t.kind === 'counter') this.linkEnd = Math.max(this.linkEnd, m.n);
      const holder = t.kind === 'fling' || t.kind === 'release' ? t.seat : t.kind === 'lift' || t.kind === 'counter' ? t.other : -1;
      if (holder >= 0) this.noGrab[holder] = m.n + (CLIENT.REGRAB_S * 1000) / this.tickMs;
    }
    // this page's catch, felt already: the server's confirms it (not played twice)
    const k = this.seat;
    const late = !this.tent && performance.now() - this.deniedAt < CLIENT.LATE_MS;
    if ((this.tent || late) && k != null) {
      const i = e.tc.findIndex((t) => (t.kind === 'catch' || t.kind === 'aerial') && t.seat === k);
      if (i >= 0) {
        e.tc.splice(i, 1);
        const j = e.ev.findIndex((x) => x.k === 'link' && x.seat === k && (x.kind === 'catch' || x.kind === 'aerial'));
        if (j >= 0) e.ev.splice(j, 1);
        this.tent = null; this.stats.confirmed++;
        if (late) { this.stats.denied--; this.deniedAt = -1e9; }
      } else if (this.tent && e.tc.some((t) => (t.kind === 'catch' || t.kind === 'aerial') && t.other === k)) {
        // (both reached in the same moment and the other's hand was first: joined all the same)
        this.tent = null; this.stats.mutual++;
      }
    }
    this.queue.push(e);
  }

  /** the events to play since the last call, in order */
  take(): DuelFrameEvents[] { const q = this.queue; this.queue = []; return q; }

  /** the powers' effects as the server has them: the same objects kept by id (the drawing keys its state on them) */
  private mirrorLive(list: Live[]) {
    const byId = new Map(this.live.map((L) => [L.id, L]));
    const next: Live[] = [];
    let solidsChanged = false;
    for (const L of list) {
      const was = byId.get(L.id);
      const riders = (L as unknown as { riders?: number[] }).riders;
      const fresh = { ...L, riders: riders ? new Set(riders) : undefined } as Live;
      if (was) { if (JSON.stringify(was.solid ?? null) !== JSON.stringify(fresh.solid ?? null)) solidsChanged = true; Object.assign(was, fresh); next.push(was); }
      else { if (fresh.solid) solidsChanged = true; next.push(fresh); }
    }
    if (next.length !== this.live.length) solidsChanged = true;
    this.live = next;
    if (solidsChanged) {
      this.solids.length = 0;
      for (const L of next) if (L.solid) this.solids.push(L.solid);
      this.solidsVersion++;
    }
  }

  /** the server applied input `ack` and its body stood as `B` (and its kit `K`): was the prediction right? */
  private reconcile(ack: number, B: DuelBodySnap, K: Kit | undefined, Ws: string = this.world, sTick = 0, rep = 0) {
    // (the same input again, with more ticks the server stepped without one since: put right again from there)
    const again = ack === this.ack && rep > this.ackRep && !!this.ackHist;
    if (ack < this.ack || (ack === this.ack && !again)) return;
    this.ack = ack; this.ackTick = sTick; this.ackRep = rep;
    const c = this.pred!;
    const wasFollow = this.follow;
    this.follow = !!(B.flags & (DUEL_FLAG.CARRIED | DUEL_FLAG.HELD | DUEL_FLAG.HOLDING));
    const h0 = again ? this.ackHist : this.hist.get(ack);
    for (const s of [...this.hist.keys()]) if (s < ack) this.hist.delete(s);
    this.ackHist = h0 ?? null;
    const wasWorld = this.predWorld, Mb = this.move(wasWorld, Ws);
    const before: V3 = Mb ? Mb.pt(c.root) : [c.root[0], c.root[1], c.root[2]];
    // (the server ran out of this seat's inputs after it applied `ack` and stepped `rep` ticks more without one: the
    // prediction for `ack` stepped those ticks too, as the server did, before it is compared. Its inputs since will be
    // stepped that much later, which the ack's tick (the snapshot's) already says)
    // (more than REP_MAX of them, a page or a link that stalled: the server's state is taken as it is, unmeasured. Stepping
    // them all again at every snapshot of a long stall slowed the page that was already behind)
    const blind = rep > CLIENT.REP_MAX;
    const h = h0 && rep > 0 && !blind && h0.world === Ws ? this.repeated(h0, rep, sTick) : h0;
    if (!h) {
      // (nothing predicted for it: the first snapshot, or a gap) the server's state as it is
      if (K) setKit(c, K); else { c.root = [...B.root]; c.v = [...B.v]; }
      this.setPredWorld(Ws); this.cross.forget();
      this.hist.delete(ack);
      return;
    }
    // (in another world than predicted: compared where the gate puts it)
    const Mh = h.world === Ws ? IDENTITY : this.move(h.world, Ws);
    const hr = Mh ? Mh.pt(h.root) : h.root, hv = Mh ? Mh.dir(h.v) : h.v;
    const e = Mh ? dist(hr, B.root) : 9, ev = dist(hv, B.v);
    // (within a second of a crossing, the server's or this seat's own: the error around the crossing)
    const xn = this.xs.length ? this.xs[this.xs.length - 1].n : -1e9, px = this.predX.length ? this.predX[this.predX.length - 1].seq : -1e9;
    // (as the error at large: not while shown from the server, frozen, or moved by the other or a power (the count-in's
    // spawn, a wave): a crossing is neither)
    const own = !this.follow && !(B.flags & (DUEL_FLAG.FROZEN | DUEL_FLAG.PUSHED));
    if (own && !blind && (Math.abs(sTick - xn) <= DUEL_NET.TICK_HZ || Math.abs(ack - px) <= DUEL_NET.TICK_HZ)) { this.stats.errX.push(e); if (e > (this.worstX?.e ?? 0)) this.worstX = { e: +e.toFixed(3), ack, sTick, xn, px, h: h.world, s: Ws, follow: this.follow, flags: B.flags, hr: hr.map((v) => +v.toFixed(2)), b: B.root.map((v) => +v.toFixed(2)) }; if (this.stats.errX.length > 5000) this.stats.errX.splice(0, 2500); }
    while (this.predX.length && this.predX[0].seq < ack - 4 * DUEL_NET.TICK_HZ) this.predX.shift();
    const kitOff = K ? ['grounded', 'airJumps', 'dashes', 'wallSide'].some((f) => kitField(K, f) !== h.save[f]) : h.grounded !== !(B.flags & DUEL_FLAG.AIRBORNE);
    if (!this.follow && !blind && !(B.flags & DUEL_FLAG.FROZEN)) (wasFollow || B.flags & DUEL_FLAG.PUSHED ? this.stats.errAfter : this.stats.err).push(e);
    // (the worst steady errors, with what differed: the probe's way to find what a prediction gets wrong)
    if (!this.follow && !wasFollow && !blind && !(B.flags & (DUEL_FLAG.FROZEN | DUEL_FLAG.PUSHED)) && e > 0.03) {
      const diff: Record<string, unknown> = {};
      if (K) for (const f of ['grounded', 'airJumps', 'dashes', 'dashT', 'wallSide', 'coyote', 'jumpBuf', 'lastGroundY', 'groundY', 'yaw', 'dir', 'reformT', 'landLagT', 'stagger']) {
        const a = kitField(K, f), b = h.save[f];
        if (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-3 : a !== b) diff[f] = [b, a];
      }
      const kmv = K ? K[K.length - 2] : null, pmv = (h.save.move as { name?: string } | null)?.name ?? null;
      if (kmv !== pmv) diff.move = [pmv, kmv];
      this.worst.push({ e: +e.toFixed(3), d: [0, 1, 2].map((i) => +(B.root[i] - h.root[i]).toFixed(3)), v: [0, 1, 2].map((i) => +(B.v[i] - h.v[i]).toFixed(2)), ack, diff });
      this.worst.sort((x, y) => y.e - x.e);
      if (this.worst.length > 12) this.worst.length = 12;
    }
    if (this.stats.err.length > 20000) this.stats.err.splice(0, 10000);
    this.hist.delete(ack);
    const otherWorld = h.world !== Ws;
    // (after the repeats the body stands as they left it, not as predicted: put back and stepped again in any case)
    if (rep === 0 && e <= CLIENT.EPS && ev <= CLIENT.EPS_V && !kitOff && !this.follow && !otherWorld) return;
    // corrected: back to the server's state at that input, the inputs since stepped again (in the server's world)
    // (a state saved in another world carried into the server's first: its pose, its move under way, its walls)
    loadChar(c, otherWorld && Mh ? this.carried(h.save, Mh) : h.save);
    if (K) setKit(c, K); else { c.root = [...B.root]; c.v = [...B.v]; }
    this.cross.load(h.judge);
    // (the body is in the server's world now, whatever the prediction since had crossed into: the replay crosses again
    // if the inputs still take it through)
    if (!otherWorld) this.setPredWorld(Ws);
    if (otherWorld) {
      // (the server didn't cross where this page did, or crossed where it didn't: its world, no crossing back at once)
      if (wasWorld !== Ws && this.predX.some((p) => p.to === wasWorld) && !this.xs.some((x) => x.to === wasWorld && x.n >= sTick - DUEL_NET.TICK_HZ)) { this.stats.crossBack++; const p = this.predX[this.predX.length - 1]; this.putBacks.push({ ack, sTick, from: wasWorld, to: Ws, predSeq: p?.seq, predTick: p ? this.ackTick + (p.seq - ack) : null, exempt: h.judge.exempt.map((e) => Math.round(e * DUEL_NET.TICK_HZ)), behind: h.judge.behind, held: this.cross.held.slice(-3) }); if (this.putBacks.length > 8) this.putBacks.shift(); }
      this.setPredWorld(Ws);
      this.cross.forget();
      const X = this.xs[this.xs.length - 1];
      if (X && X.to === Ws) this.cross.after({ partner: X.partner, held: X.held });
    }
    this.replaying = true;
    const later = [...this.hist.values()].sort((a, b) => a.x.seq - b.x.seq);
    for (const r of later) this.predict(r.x, r.at, r);
    this.replaying = false;
    this.stats.replayed += later.length;
    if (this.follow) return;
    this.stats.corrections++;
    const d: V3 = [before[0] - c.root[0], before[1] - c.root[1], before[2] - c.root[2]];
    if (Math.hypot(d[0], d[1], d[2]) > CLIENT.CUT) { this.offset = [0, 0, 0]; this.stats.cuts++; }
    else for (let a = 0; a < 3; a++) this.offset[a] += d[a];
  }

  /** the prediction for input `h` carried on by `n` ticks the server stepped without a new input (ending at tick
   *  `sTick`): the body is left in that state (reconcile then puts it back and steps the inputs since) */
  private repeated(h: Hist, n: number, sTick: number): Hist {
    const c = this.pred!;
    loadChar(c, h.save);
    c.root = [...h.root]; c.v = [...h.v];
    this.cross.load(h.judge);
    this.setPredWorld(h.world);
    this.replaying = true;
    let r: Hist = h;
    for (let i = 1; i <= n; i++) r = this.predict(h.x, 0, null, { n: i, T: sTick - n + i });
    this.replaying = false;
    return r;
  }

  private ease(dt: number) {
    const k = Math.exp(-dt / CLIENT.EASE);
    for (let a = 0; a < 3; a++) { this.offset[a] *= k; if (Math.abs(this.offset[a]) < 1e-4) this.offset[a] = 0; }
    // (shown from the server while joined or carried: eased in and out, so the body doesn't jump between the two)
    const want = this.follow ? 1 : 0;
    this.followW += (want - this.followW) * (1 - Math.exp(-dt / 0.12));
    if (this.follow) this.stats.followTicks++;
  }

  // ---------------------------------------------------------------- what is shown
  private fromBuffer(k: number, now: number): ShownBody | null {
    const r = this.bufs[k].sample(this.sampled, now);
    const N = this.newest[k];
    if (!r.ok || !N) return null;
    const S = this.sampled, F = this.toF.get(this.shownWorld), Fi = F ? F.inverse() : IDENTITY, Mv = this.move(this.newestW[k], this.shownWorld) ?? IDENTITY;
    return {
      root: Fi.pt([S[0], S[1], S[2]]), yaw: S[YAW] + yawOfMove(Fi), p: S.slice(LOCAL, LOCAL + 39), v: Mv.dir(N.v), flags: r.flags ?? N.flags,
      move: r.move?.[0] ?? null, moveT: r.move?.[1] ?? 0, lgy: N.lgy, style: N.style, energy: (r.energy ?? 0) / 255,
    };
  }

  /** both bodies as this page shows them now, posed onto `shownChars` (and returned) */
  show(dtMs: number): [Character, Character] {
    const now = this.o.link.now(), dt = dtMs / 1000;
    // the world shown: this seat's predicted one; a watcher's (or a seat shown from the server) where the playback is
    if (!this.lost) {
      // (a seat shows its own predicted world even while its body is shown from the server, joined or carried: the
      // playback, a little behind, is seen through the disc a moment; switching with the follow went back and forth)
      const fromServer = this.seat == null || !this.pred;
      const want = fromServer ? this.worldAt(now - this.delay) : this.predWorld;
      // (a prediction going straight back to the world just left, within FLIP_MS: shown only once it has stood for
      // BACK_HOLD_MS. A crossing judged near the end of its hold can come and go in the prediction for a frame or two
      // as a correction's replay moves it by a tick; meanwhile the body is seen through the disc)
      const t = this.o.link.now();
      let back = false;
      if (want === this.shownWorld) this.pendingBack = null;
      else if (!fromServer && this.shownAt?.from === want && t - this.shownAt.t < CLIENT.FLIP_MS) {
        if (this.pendingBack?.to !== want) this.pendingBack = { to: want, since: t };
        back = t - this.pendingBack.since < CLIENT.BACK_HOLD_MS;
      }
      if (want !== this.shownWorld && !back) this.showIn(want, fromServer || this.predWorld === this.world ? (this.shownAt?.from === want ? 'corrected' : 'server') : 'predicted');
    }
    for (let k = 0; k < 2; k++) {
      let b: ShownBody | null = null;
      if (k === this.seat && this.pred) {
        const c = this.pred, f = this.flags, Mp = this.move(this.predWorld, this.shownWorld) ?? IDENTITY;
        const pr = Mp.pt(c.root), dyw = yawOfMove(Mp);
        const own: ShownBody = {
          root: [pr[0] + this.offset[0], pr[1] + this.offset[1], pr[2] + this.offset[2]], v: Mp.dir(c.v), yaw: c.yaw + dyw,
          p: localOfChar(c), flags: (c.grounded ? 0 : DUEL_FLAG.AIRBORNE) | (c.dir < 0 ? DUEL_FLAG.FACING_LEFT : 0) | (c.onWall ? DUEL_FLAG.ON_WALL : 0) | (c.reforming ? DUEL_FLAG.REFORMING : 0) | (c.dashing ? DUEL_FLAG.DASHING : 0) | (f & (DUEL_FLAG.HELD | DUEL_FLAG.HOLDING)),
          move: c.move?.name ?? null, moveT: c.move?.t ?? 0, lgy: c.lastGroundY, style: styleByte(c), energy: c.energy,
        };
        // (its own buffer is played every frame, so it is ready the moment the body is shown from it)
        const s = this.fromBuffer(k, now);
        b = s && this.followW > 0.001 ? mixShown(own, s, this.followW) : own;
        puppet(this.shownChars[k], b, dt);
        continue;
      }
      b = this.fromBuffer(k, now);
      if (b) puppet(this.shownChars[k], b, dt);
    }
    return this.shownChars;
  }

  /** the measurements (the tests and bend.duel.net read them) */
  report() {
    const e = [...this.stats.err].sort((a, b) => a - b), q = (p: number) => e[Math.min(e.length - 1, Math.floor(p * e.length))] ?? 0;
    const s = (performance.now() - this.stats.since) / 1000;
    return {
      seat: this.seat, snaps: this.stats.snaps, seconds: +s.toFixed(1),
      inKBs: +(this.stats.bytesIn / 1024 / s).toFixed(2), outKBs: +(this.stats.bytesOut / 1024 / s).toFixed(2), devKBs: +(this.stats.devBytes / 1024 / s).toFixed(2),
      errAfter: { n: this.stats.errAfter.length, maxMm: +(1000 * Math.max(0, ...this.stats.errAfter)).toFixed(0) },
      err: { n: e.length, rmsMm: +(1000 * Math.sqrt(e.reduce((a, b) => a + b * b, 0) / Math.max(1, e.length))).toFixed(1), p50Mm: +(1000 * q(0.5)).toFixed(1), p95Mm: +(1000 * q(0.95)).toFixed(1), maxMm: +(1000 * (e[e.length - 1] ?? 0)).toFixed(1) },
      corrections: this.stats.corrections, perSecond: +(this.stats.corrections / s).toFixed(2), cuts: this.stats.cuts, replayed: this.stats.replayed,
      catches: { felt: this.stats.caught, confirmed: this.stats.confirmed, mutual: this.stats.mutual, denied: this.stats.denied },
      crossings: (() => {
        const x = [...this.stats.errX].sort((a, b) => a - b), qx = (p: number) => x[Math.min(x.length - 1, Math.floor(p * x.length))] ?? 0;
        return {
          server: this.xs.length, predicted: this.stats.crossPred, agreed: this.stats.crossOk, brought: this.stats.crossBrought, putBack: this.stats.crossBack,
          shown: this.stats.shown, flips: this.stats.flips, worst: this.worstX, putBacks: this.putBacks.slice(-4), world: this.world, predWorld: this.predWorld, shownWorld: this.shownWorld, lost: this.lost ? this.lostWhy || true : false,
          err: { n: x.length, rmsMm: +(1000 * Math.sqrt(x.reduce((a, b) => a + b * b, 0) / Math.max(1, x.length))).toFixed(1), p50Mm: +(1000 * qx(0.5)).toFixed(1), p95Mm: +(1000 * qx(0.95)).toFixed(1), maxMm: +(1000 * (x[x.length - 1] ?? 0)).toFixed(1) },
        };
      })(),
      worst: this.worst.slice(0, 6),
      delay: +this.delay.toFixed(0), queue: this.last?.x.q ?? null, events: this.log.length,
    };
  }
  resetStats() {
    const S = this.stats;
    this.worst = [];
    Object.assign(S, { snaps: 0, bytesIn: 0, bytesOut: 0, devBytes: 0, ticks: 0, err: [], errAfter: [], corrections: 0, cuts: 0, replayed: 0, caught: 0, confirmed: 0, denied: 0, mutual: 0, followTicks: 0, crossPred: 0, crossOk: 0, crossBrought: 0, crossBack: 0, shown: 0, flips: 0, errX: [], since: performance.now() });
  }
}

const IDENTITY = new Rigid();

function localOfChar(c: Character) {
  const out = new Float64Array(39), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), r = c.root;
  for (let j = 0; j < 13; j++) {
    const dx = c.pose[3 * j] - r[0], dy = c.pose[3 * j + 1] - r[1], dz = c.pose[3 * j + 2] - r[2];
    out[3 * j] = dx * cy - dz * sy; out[3 * j + 1] = dy; out[3 * j + 2] = dx * sy + dz * cy;
  }
  return out;
}
/** two ways of showing a body, mixed (w toward b): root and landmarks blended, yaw the short way */
function mixShown(a: ShownBody, b: ShownBody, w: number): ShownBody {
  if (w >= 0.999) return b;
  const L = (x: number, y: number) => x + (y - x) * w;
  const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  const p = new Float64Array(39);
  for (let i = 0; i < 39; i++) p[i] = L(a.p[i], b.p[i]);
  return { ...b, root: [L(a.root[0], b.root[0]), L(a.root[1], b.root[1]), L(a.root[2], b.root[2])], v: [L(a.v[0], b.v[0]), L(a.v[1], b.v[1]), L(a.v[2], b.v[2])], yaw: a.yaw + dy * w, p };
}
export { kitOf };

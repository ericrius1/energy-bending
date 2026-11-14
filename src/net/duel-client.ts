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
import { Character, type Terrain } from '../dancer/character';
import { makeIntent, EDGES, type Intent } from '../input/intent';
import { Contact, splitIntent, type ContactEvent, type Link } from '../duel/contact';
import type { StagePlane } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import type { Live, PowerFx } from '../duel/powers';
import { onBeat, type DuelEvent, type DuelState } from '../../shared/duel.ts';
import type { PowerEvent } from '../../shared/powers.ts';
import { beatAt } from '../../shared/rules.ts';
import {
  DUEL_NET, DUEL_FLAG, encodeDuelInputs, decodeDuelSnap,
  type DuelBodySnap, type DuelInput, type DuelSnap, type DuelTickEvents, type DuelWelcome, type DuelSlowState, type V3,
} from '../../shared/protocol.ts';
import { PoseBuffer, DIM, YAW, LOCAL, type BufferParams } from './net';
import { inputOf, intentOf, kitOf, kitField, setKit, saveChar, loadChar, puppet, styleByte, type CharSave, type Kit, type ShownBody } from './duel-body';

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
};

/** a tick's events as the page plays them (`local`: this page's own catch, felt before the server says so) */
export interface DuelFrameEvents { n: number; ev: DuelEvent[]; tc: ContactEvent[]; pe: PowerEvent[]; fx: PowerFx[]; local?: boolean }

interface Hist { x: DuelInput; save: CharSave; root: V3; v: V3; beat: number; grounded: boolean }
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface DuelClientOptions {
  welcome: DuelWelcome;
  /** this page's seat (0, 1), or null watching */
  seat: number | null;
  link: DuelLink;
  /** the world as this page's body stands in it (its floor, its solids with the powers' temporary ones, its fall-out) */
  terrain: Terrain;
  /** the arena's plane when the room is locked to it */
  plane: StagePlane | null;
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
  private replaying = false;
  private yaw = 0;
  /** what a correction moved on screen, easing out */
  private offset: V3 = [0, 0, 0];
  private follow = false;
  private followW = 0;
  private queue: DuelFrameEvents[] = [];
  private tent: { seq: number; until: number; kind: 'catch' | 'aerial' } | null = null;
  private look: V3 = [0, 0, 0];
  /** the server tick before which each seat can't catch again (a fling, a counter or a lift just ended its hold) */
  private noGrab = [0, 0];
  private judge: Contact | null = null;
  private lastSnapTick = -1;
  /** every server event, in order, as a line each (the tests compare two pages' logs) */
  readonly log: string[] = [];
  readonly stats = {
    snaps: 0, bytesIn: 0, bytesOut: 0, devBytes: 0, ticks: 0,
    /** the prediction's error at each acknowledged input (m), before any correction */
    err: [] as number[],
    /** the same, at the first snapshot after a hold or a carry let this body go (the other's fling: not this page's to
     *  predict) */
    errAfter: [] as number[],
    corrections: 0, cuts: 0, replayed: 0,
    /** this page's catches: felt here, confirmed by the server, denied */
    caught: 0, confirmed: 0, denied: 0, mutual: 0,
    /** ticks shown from the server (joined, carried) */
    followTicks: 0,
    since: 0,
  };

  constructor(readonly o: DuelClientOptions) {
    this.seat = o.seat;
    this.w = o.welcome;
    this.bufs = [0, 1].map(() => new PoseBuffer(o.buffer));
    this.shownChars = [0, 1].map((k) => { const c = new Character({ seat: k, plane: null, terrain: o.terrain }); c.setProfile('duel'); return c; }) as [Character, Character];
    if (o.seat != null) {
      const c = new Character({ seat: o.seat, plane: o.plane, terrain: o.terrain });
      c.setProfile('duel');
      c.yaw = o.seat ? -Math.PI / 2 : Math.PI / 2;
      this.pred = c;
    } else this.pred = null;
    this.stats.since = performance.now();
  }

  get tickMs() { return this.w.tickMs; }
  /** the duel's clock now (ms): the server's present, which DuelState's times are on */
  now() { return this.o.link.now() - this.w.t0; }
  /** the server's tick now (fractional) */
  serverTick() { return this.now() / this.tickMs; }
  beat(t = this.o.link.now()) { return beatAt(this.w.music, t); }
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
    const beat = this.beat(this.o.link.now() + this.o.link.rtt / 2);
    this.predict(x, beat, null);
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

  /** one tick of this seat's body, as the server will step it */
  private predict(x: DuelInput, beat: number, h: Hist | null) {
    const c = this.pred!, k = this.seat!;
    let it = intentOf(x, true);
    const frozen = this.running && !!(this.flags & DUEL_FLAG.FROZEN);
    if (frozen) it = makeIntent();
    // (only the server's link: a catch felt here and not yet confirmed changes nothing of the body, so a denied one
    // costs no correction)
    const L = this.link;
    const ci = frozen ? null : splitIntent(c, it, L?.holder === k, L?.held === k);
    c.inputYaw = x.yaw; c.bpm = this.w.music.bpm;
    // (it faces the other where the other is now, as the server's body does: the newest snapshot carried on by its
    // velocity, not the other as shown, a little in the past)
    const N = this.newest[1 - k];
    if (N) {
      const a = Math.min(0.3, Math.max(0, (this.o.link.now() - N.ts) / 1000));
      this.look[0] = N.root[0] + N.v[0] * a; this.look[1] = N.root[1]; this.look[2] = N.root[2] + N.v[2] * a;
      c.lookAt = this.look;
    } else c.lookAt = this.shownChars[1 - k].root;
    c.update(this.tickMs / 1000, it, { beats: beat, bpm: this.w.music.bpm });
    c.events.length = 0;
    if (ci?.grabEdge && !this.replaying) this.tryCatch(x.seq);
    const rec: Hist = h ?? { x, save: {}, root: [0, 0, 0], v: [0, 0, 0], beat, grounded: false };
    rec.save = saveChar(c); rec.root = [c.root[0], c.root[1], c.root[2]]; rec.v = [c.v[0], c.v[1], c.v[2]]; rec.grounded = c.grounded;
    if (!h) this.hist.set(x.seq, rec);
  }

  /** a grab pressed: within reach of the other as shown? Then it is felt now (the server's word follows) */
  private tryCatch(seq: number) {
    const k = this.seat!, s = this.state;
    if (!this.running || s?.phase !== 'play' || this.link || this.tent) return;
    // (just let go of a hold: not yet, as the server would say; its tick about when this input reaches it)
    if (this.serverTick() + this.o.link.rtt / 2 / this.tickMs < this.noGrab[k]) return;
    const me = this.pred!, them = this.shownChars[1 - k];
    if (me.reforming || them.reforming) return;
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
    const beat = this.beat(), bpm = this.w.music.bpm, perfect = onBeat(beat, bpm);
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
    this.flown = x.fl ?? null;
    this.pclock = x.pc ?? 0;
    this.finale = x.fin ?? null;
    this.mirrorLive((x.lv ?? []) as Live[]);
    const now = this.o.link.now();
    for (const B of s.bodies) {
      if (B.seat > 1) continue;
      this.newest[B.seat] = B;
      const v = new Float64Array(DIM);
      v[0] = B.root[0]; v[1] = B.root[1]; v[2] = B.root[2]; v[YAW] = B.yaw;
      v.set(B.p, LOCAL);
      this.bufs[B.seat].push(B.ts, v, { flags: B.flags, energy: B.energy * 255, world: '', move: B.move }, now);
    }
    if (this.seat != null && this.pred) {
      const B = s.bodies.find((b) => b.seat === this.seat);
      if (B && s.ack >= 0) this.reconcile(s.ack, B, x.k as Kit | undefined);
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
    const e: DuelFrameEvents = { n: m.n, ev: (m.ev ?? []) as DuelEvent[], tc: (m.tc ?? []) as ContactEvent[], pe: (m.pe ?? []) as PowerEvent[], fx: (m.fx ?? []) as PowerFx[] };
    this.log.push(`${m.n} ${JSON.stringify([m.ev ?? [], m.tc ?? [], m.pe ?? []])}`);
    if (this.log.length > 20000) this.log.splice(0, 10000);
    // (the holder of a hold that just ended can't catch again for a moment: the server's rule, kept here too)
    for (const t of e.tc) {
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
  private reconcile(ack: number, B: DuelBodySnap, K: Kit | undefined) {
    if (ack <= this.ack) return;
    this.ack = ack;
    const c = this.pred!;
    const wasFollow = this.follow;
    this.follow = !!(B.flags & (DUEL_FLAG.CARRIED | DUEL_FLAG.HELD | DUEL_FLAG.HOLDING));
    const h = this.hist.get(ack);
    for (const s of [...this.hist.keys()]) if (s < ack) this.hist.delete(s);
    if (!h) {
      // (nothing predicted for it: the first snapshot, or a gap) the server's state as it is
      if (K) setKit(c, K); else { c.root = [...B.root]; c.v = [...B.v]; }
      this.hist.delete(ack);
      return;
    }
    const e = dist(h.root, B.root), ev = dist(h.v, B.v);
    const kitOff = K ? ['grounded', 'airJumps', 'dashes', 'wallSide'].some((f) => kitField(K, f) !== h.save[f]) : h.grounded !== !(B.flags & DUEL_FLAG.AIRBORNE);
    if (!this.follow && !(B.flags & DUEL_FLAG.FROZEN)) (wasFollow ? this.stats.errAfter : this.stats.err).push(e);
    if (this.stats.err.length > 20000) this.stats.err.splice(0, 10000);
    this.hist.delete(ack);
    if (e <= CLIENT.EPS && ev <= CLIENT.EPS_V && !kitOff && !this.follow) return;
    // corrected: back to the server's state at that input, the inputs since stepped again
    const before: V3 = [c.root[0], c.root[1], c.root[2]];
    loadChar(c, h.save);
    if (K) setKit(c, K); else { c.root = [...B.root]; c.v = [...B.v]; }
    this.replaying = true;
    const later = [...this.hist.values()].sort((a, b) => a.x.seq - b.x.seq);
    for (const r of later) this.predict(r.x, r.beat, r);
    this.replaying = false;
    this.stats.replayed += later.length;
    if (this.follow) return;
    this.stats.corrections++;
    const d: V3 = [before[0] - c.root[0], before[1] - c.root[1], before[2] - c.root[2]];
    if (Math.hypot(d[0], d[1], d[2]) > CLIENT.CUT) { this.offset = [0, 0, 0]; this.stats.cuts++; }
    else for (let a = 0; a < 3; a++) this.offset[a] += d[a];
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
    const S = this.sampled;
    return {
      root: [S[0], S[1], S[2]], yaw: S[YAW], p: S.slice(LOCAL, LOCAL + 39), v: [...N.v] as V3, flags: r.flags ?? N.flags,
      move: r.move?.[0] ?? null, moveT: r.move?.[1] ?? 0, lgy: N.lgy, style: N.style, energy: (r.energy ?? 0) / 255,
    };
  }

  /** both bodies as this page shows them now, posed onto `shownChars` (and returned) */
  show(dtMs: number): [Character, Character] {
    const now = this.o.link.now(), dt = dtMs / 1000;
    for (let k = 0; k < 2; k++) {
      let b: ShownBody | null = null;
      if (k === this.seat && this.pred) {
        const c = this.pred, f = this.flags;
        const own: ShownBody = {
          root: [c.root[0] + this.offset[0], c.root[1] + this.offset[1], c.root[2] + this.offset[2]], v: [...c.v] as V3, yaw: c.yaw,
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
      delay: +this.delay.toFixed(0), queue: this.last?.x.q ?? null, events: this.log.length,
    };
  }
  resetStats() {
    const S = this.stats;
    Object.assign(S, { snaps: 0, bytesIn: 0, bytesOut: 0, devBytes: 0, ticks: 0, err: [], errAfter: [], corrections: 0, cuts: 0, replayed: 0, caught: 0, confirmed: 0, denied: 0, mutual: 0, followTicks: 0, since: performance.now() });
  }
}

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

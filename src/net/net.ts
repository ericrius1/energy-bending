// The room server's client, and the same surface without a server. Protocol: shared/protocol.ts.
//   Net         talks to server/ over a WebSocket at /ws: hello, reconnects with its token, the clock, poses, events.
//   LocalNet    the same surface with no socket: runs shared/rules.ts in the page (same-screen play, a partner bot).
//   PoseBuffer  the other dancers' poses, played back smoothly from a jitter buffer (one per slot).
//   Link        the network conditioner, for testing: ?lag=200&jitter=80&loss=10 in the URL, or the same options.
// Pure: it imports only shared/ (so Node runs it in the tests as it is). The game's side, which knows skeletons, is
// session.ts and controller.ts.
//
// Ported from the 2D prototype (sketches/dance-first-2d/js/net.js). What changed: poses are binary (13 landmarks in
// millimetres, the root, the yaw), one buffer per slot because a room holds up to eight dancers, each frame repeats
// the previous snapshot (so one lost frame costs nothing), yaw is interpolated the short way round, a dancer that
// changes world (or jumps) starts its buffer again instead of sliding across, and tangents and extrapolation use
// the snapshots' velocities more carefully (see PoseBuffer, and docs/reports/1-net.md for what each change bought).
import {
  PROTOCOL, SEATS, SLOTS, NLM, POSE, MAX_PREV, encodePose, decodePose,
  type ClientMsg, type ServerMsg, type ServerType, type MsgOf, type PublicState, type PoseLike, type PoseFrame, type Role, type DuelHello, type DuelWelcome,
} from '../../shared/protocol.ts';
import { createSession, tick, setPresent, route, publicState, piecesOf, type Session, type To } from '../../shared/rules.ts';

/** how the pose stream is paced and how much is kept (the client's tunables) */
export const NET_PARAMS = {
  /** 20 Hz poses */
  SEND_MS: 50,
  /** about 12 Hz while the socket is backed up */
  SLOW_SEND_MS: 83,
  /** ws.bufferedAmount (bytes) that counts as backed up */
  BACKED_UP: 4096,
  /** reliable messages kept while disconnected */
  QUEUE_CAP: 32,
  /** how many earlier snapshots each pose frame repeats (0..MAX_PREV): a burst of that many lost frames costs nothing */
  REDUNDANT: 2,
};

const perf = () => performance.now();
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export interface Conditions { lag: number; jitter: number; loss: number }

/** ?lag=&jitter=&loss= from the page's URL (empty outside a browser) */
export function urlConditioner(): Partial<Conditions> {
  if (typeof location === 'undefined' || !location.search) return {};
  const q = new URLSearchParams(location.search), o: Partial<Conditions> = {};
  for (const k of ['lag', 'jitter', 'loss'] as const) if (q.has(k) && Number.isFinite(+q.get(k)!)) o[k] = +q.get(k)!;
  return o;
}

// ---------------------------------------------------------------- the conditioner: one direction of a link
/**
 * Per direction: delay = lag/2 + uniform(-jitter/2, +jitter/2), so a round trip adds about `lag` and one pose path
 * (the sender's up leg and the receiver's down leg, both conditioned) varies by up to ±jitter. Reliable messages stay
 * in order (as on TCP); poses are delayed independently (they may reorder) and `loss` percent are dropped. Real
 * WebSockets never lose a frame (TCP resends it, late); dropping poses models the worst of that and a future
 * unreliable channel.
 */
export class Link {
  lag: number; jitter: number; loss: number;
  private q: { at: number; fn: () => void }[] = [];
  private lastAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rnd: () => number;
  constructor({ lag = 0, jitter = 0, loss = 0 }: Partial<Conditions> = {}, rnd: () => number = Math.random) {
    this.rnd = rnd;
    this.lag = Math.max(0, lag); this.jitter = Math.max(0, jitter); this.loss = clamp(loss, 0, 100);
  }
  get active() { return this.lag > 0 || this.jitter > 0 || this.loss > 0; }
  push(fn: () => void, pose = false) {
    if (pose && this.rnd() * 100 < this.loss) return;
    let at = perf() + Math.max(0, this.lag / 2 + ((this.rnd() * 2 - 1) * this.jitter) / 2);
    if (!pose) at = this.lastAt = Math.max(this.lastAt, at);
    let i = this.q.length;
    while (i > 0 && this.q[i - 1].at > at) i--;
    this.q.splice(i, 0, { at, fn });
    this.schedule();
  }
  drain() {
    const t = perf();
    while (this.q.length && this.q[0].at <= t) this.q.shift()!.fn();
    this.schedule();
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.q.length) this.timer = setTimeout(() => this.drain(), Math.max(0, this.q[0].at - perf()));
  }
  clear() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.q.length = 0; }
}

// ---------------------------------------------------------------- clock sync
/**
 * Offset = server - local, from the lowest-RTT sample of the last 8. Changes are slewed (5 % of elapsed time) so
 * now() never jumps, except during the first five samples or for errors over a second.
 */
export class Clock {
  private samples: { rtt: number; off: number }[] = [];
  offset = 0;
  private target = 0;
  private count = 0;
  private last = perf();
  rtt = 0;
  jitter = 0;
  coarse(serverNow: number) { if (!this.count) this.offset = this.target = serverNow - perf(); }
  add(c: unknown, s: unknown, recv: number) {
    if (!fin(c) || !fin(s)) return;
    const rtt = recv - c;
    this.samples.push({ rtt, off: s + rtt / 2 - recv });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.target = best.off;
    this.count++;
    this.now();
    if (this.count <= 5 || Math.abs(this.target - this.offset) > 1000) this.offset = this.target;
    const rs = this.samples.map((x) => x.rtt), mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    this.rtt = mean;
    this.jitter = rs.reduce((a, b) => a + Math.abs(b - mean), 0) / rs.length;
  }
  now() {
    const p = perf(), step = (p - this.last) * 0.05;
    this.last = p;
    this.offset += clamp(this.target - this.offset, -step, step);
    return p + this.offset;
  }
}

// ---------------------------------------------------------------- the jitter buffer
/** a pose as the buffer holds it: root xyz, yaw, then the 39 landmark floats (metres, radians) */
export const ROOT = 0, YAW = 3, LOCAL = 4, DIM = LOCAL + NLM * 3;

export interface PoseMeta { flags: number; energy: number; world: string; move: [string, number] | null }

export interface BufferParams {
  /** extrapolate past the newest snapshot for this long (ms), slowing to rest, then hold */
  EXTRAP_MS: number;
  /** snapshots further apart than this (ms) are a gap (the sender was away): hold, then ease into the next */
  GAP_MS: number;
  EASE_MS: number;
  /** playback delay target = transit + LEAD × interval + JIT × jitter, clamped to MIN..MAX ms */
  LEAD: number;
  JIT: number;
  MIN_DELAY: number;
  MAX_DELAY: number;
  /** speed caps on a tangent (per ms): root (m), yaw (rad), landmarks (m), so a glitch can't fling a limb */
  MAX_V_ROOT: number;
  MAX_V_YAW: number;
  MAX_V_LOCAL: number;
  /** a root that moves further than this between two snapshots jumped (a portal, a respawn): start again (m) */
  JUMP_M: number;
  /** tangents: 'span' is the prototype's (the chord across both neighbours), 'fd' weighs each side by its length
   *  (exact for a quadratic even when a neighbour is missing, which is what a lost frame leaves) */
  TANGENT: 'span' | 'fd';
  /** while extrapolating, also follow the curve's bend (its acceleration) for the first BEND_MS */
  BEND_MS: number;
}

export const BUFFER_PARAMS: BufferParams = {
  EXTRAP_MS: 80, GAP_MS: 300, EASE_MS: 200,
  LEAD: 2, JIT: 2.5, MIN_DELAY: 80, MAX_DELAY: 350,
  MAX_V_ROOT: 0.012, MAX_V_YAW: 0.04, MAX_V_LOCAL: 0.02,
  JUMP_M: 3,
  TANGENT: 'fd',
  BEND_MS: 60,
};

/** the prototype's buffer, for comparison (test/smoothness.test.ts runs both) */
export const PROTOTYPE_BUFFER: BufferParams = { ...BUFFER_PARAMS, TANGENT: 'span', BEND_MS: 0, EXTRAP_MS: 120, MAX_V_ROOT: 0.008, MAX_V_YAW: 0.008, MAX_V_LOCAL: 0.008 };

const H = (s: number) => [2 * s * s * s - 3 * s * s + 1, s * s * s - 2 * s * s + s, -2 * s * s * s + 3 * s * s, s * s * s - s * s];
const dH = (s: number) => [6 * s * s - 6 * s, 3 * s * s - 4 * s + 1, -6 * s * s + 6 * s, 3 * s * s - 2 * s];
const wrapPi = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

interface Snap extends PoseMeta { ts: number; v: Float64Array }

export interface RemoteInfo extends Partial<PoseMeta> { ok: boolean; age?: number; slot?: number }

/**
 * One remote dancer's poses, played back at T = now - delay. The delay slews toward transit + LEAD send intervals
 * + JIT × jitter (clamped). Between snapshots: a cubic Hermite (C1). Past the newest: extrapolate along the last
 * velocity, slowing to rest over EXTRAP_MS, then hold. Snapshot gaps over GAP_MS (the sender away) hold, then ease
 * into the next over EASE_MS. Whenever new data changes the curve, the difference (position and velocity) at the
 * last shown time is blended out over 100..300 ms, so the output is continuous in position and velocity in every
 * case. Yaw is unwrapped as it comes in (each snapshot within half a turn of its neighbour), so it turns the short
 * way. A new world, a TELEPORT flag or a root jump starts the buffer again: that one is a cut, on purpose.
 */
export class PoseBuffer {
  readonly P: BufferParams;
  newest = -Infinity;
  n = 0;
  mean = 0;
  dev = 0;
  interval: number = NET_PARAMS.SEND_MS;
  delay = 150;
  private started = false;
  private prevNow: number | null = null;
  private s: Snap[] = [];
  private prevT: number | null = null;
  private changed = false;
  private blend: { start: number; dur: number } | null = null;
  private floor = -Infinity;                         // after a cut, nothing older than this is used
  private out = new Float64Array(DIM);
  private vel = new Float64Array(DIM);
  private Pv = new Float64Array(DIM);
  private Vv = new Float64Array(DIM);
  private tP = new Float64Array(DIM);
  private tV = new Float64Array(DIM);
  private M0 = new Float64Array(DIM);
  private M1 = new Float64Array(DIM);
  private A0 = new Float64Array(DIM);
  private err = new Float64Array(DIM);
  private errV = new Float64Array(DIM);
  private eP = new Float64Array(DIM);
  private eV = new Float64Array(DIM);
  private cap = new Float64Array(DIM);
  /** cuts so far (world changes, teleports, jumps) */
  cuts = 0;
  /** what the last sample did: between two snapshots ('interp'), across a missing one ('hole'), past the newest
   *  ('extrap'), across the sender's absence ('gap'), before the first ('hold'); and whether a correction was blending */
  mode: 'interp' | 'hole' | 'extrap' | 'gap' | 'hold' = 'hold';
  blending = false;

  constructor(params: Partial<BufferParams> = {}) {
    this.P = { ...BUFFER_PARAMS, ...params };
    for (let j = 0; j < DIM; j++) this.cap[j] = j < YAW ? this.P.MAX_V_ROOT : j === YAW ? this.P.MAX_V_YAW : this.P.MAX_V_LOCAL;
  }
  get jitter() { return 1.25 * this.dev; }
  get target() { return clamp(this.mean + this.P.LEAD * this.interval + this.P.JIT * this.jitter, this.P.MIN_DELAY, this.P.MAX_DELAY); }
  get size() { return this.s.length; }

  private cut(ts: number) {
    this.s.length = 0; this.prevT = null; this.blend = null; this.changed = false; this.floor = ts - 1e-6; this.cuts++;
  }

  /**
   * A snapshot (v: DIM floats) taken at server time ts, arriving at `now`. `fresh` is false for a repeated earlier
   * snapshot: it fills a hole but says nothing about transit time (it was always one interval late).
   */
  push(ts: number, v: ArrayLike<number>, meta: PoseMeta, now: number, fresh = true) {
    if (!fin(ts) || ts > now + 1000 || ts <= this.floor) return;
    if (fresh) {
      const tr = now - ts;
      if (this.n++ === 0) this.mean = tr;
      else { this.mean += (tr - this.mean) * 0.1; this.dev += (Math.abs(tr - this.mean) - this.dev) * 0.1; }
    }
    if (ts > this.newest) {
      const iv = ts - this.newest;
      if (iv < this.P.GAP_MS) this.interval += (clamp(iv, 20, 200) - this.interval) * 0.1;
      // a cut: a new world, the sender says it teleported, or the root moved further than anyone can dance
      const last = this.s[this.s.length - 1];
      if (last && (meta.world !== last.world || meta.flags & POSE.TELEPORT
        || Math.hypot(v[0] - last.v[0], v[1] - last.v[1], v[2] - last.v[2]) > this.P.JUMP_M)) this.cut(ts);
      this.newest = ts;
    }
    if (this.prevT != null && ts <= this.prevT) return;            // too late to use
    const s = this.s;
    let i = s.length;
    while (i > 0 && s[i - 1].ts > ts) i--;
    if (i > 0 && s[i - 1].ts === ts) return;
    const q = new Float64Array(DIM);
    for (let j = 0; j < DIM; j++) q[j] = fin(v[j]) ? v[j] : 0;
    // yaw the short way round: within half a turn of the snapshot before it (or after it, if it's the first)
    const ref = i > 0 ? s[i - 1] : s[i];
    if (ref) q[YAW] = ref.v[YAW] + wrapPi(q[YAW] - ref.v[YAW]);
    s.splice(i, 0, { ts, v: q, flags: meta.flags | 0, energy: meta.energy | 0, world: meta.world, move: meta.move });
    for (let k = i + 1; k < s.length; k++) s[k].v[YAW] = s[k - 1].v[YAW] + wrapPi(s[k].v[YAW] - s[k - 1].v[YAW]);
    if (s.length > 64) s.shift();
    this.changed = true;
  }

  /**
   * The slope at knot k (per ms). 'span' (the prototype): the chord across its neighbours, or to the one neighbour it
   * has. 'fd': the slope at k of the parabola through k and two neighbours, which is exact for a quadratic and stays
   * right at the newest knot, where a chord to the one neighbour lags by half an interval of curvature (after a lost
   * frame, that lag is what was on screen).
   */
  private tangent(k: number, M: Float64Array) {
    const s = this.s, a = s[k], G = this.P.GAP_MS, cap = this.cap;
    const pv = k > 0 && a.ts - s[k - 1].ts <= G ? s[k - 1] : null;
    const nx = k < s.length - 1 && s[k + 1].ts - a.ts <= G ? s[k + 1] : null;
    if (this.P.TANGENT === 'fd') {
      // the three knots: around k if it has both neighbours, else the two behind it (or ahead of it)
      const pp = !nx && pv && k > 1 && pv.ts - s[k - 2].ts <= G ? s[k - 2] : null;
      const nn = !pv && nx && k < s.length - 2 && s[k + 2].ts - nx.ts <= G ? s[k + 2] : null;
      const [x0, x1, x2] = pv && nx ? [pv, a, nx] : pp ? [pp, pv!, a] : nn ? [a, nx!, nn] : [null, null, null];
      if (x0) {
        const h0 = x1!.ts - x0.ts, h1 = x2!.ts - x1!.ts, H2 = h0 + h1;
        // weights of the three values in the parabola's slope at a (a is x1, x2 or x0)
        const [w0, w1, w2] = a === x1 ? [-h1 / (h0 * H2), (h1 - h0) / (h0 * h1), h0 / (h1 * H2)]
          : a === x2 ? [h1 / (h0 * H2), -H2 / (h0 * h1), (2 * h1 + h0) / (h1 * H2)]
            : [-(2 * h0 + h1) / (h0 * H2), H2 / (h0 * h1), -h0 / (h1 * H2)];
        for (let j = 0; j < DIM; j++) M[j] = clamp(w0 * x0.v[j] + w1 * x1!.v[j] + w2 * x2!.v[j], -cap[j], cap[j]);
        return;
      }
    }
    const lo = pv || a, hi = nx || a, dt = hi.ts - lo.ts;
    for (let j = 0; j < DIM; j++) M[j] = dt > 0 ? clamp((hi.v[j] - lo.v[j]) / dt, -cap[j], cap[j]) : 0;
  }

  /**
   * From knot k, tau ms on: carry on along the motion at k, slowing to rest over EXTRAP_MS, then hold. With 'fd' the
   * motion is the knot's own tangent (so the curve stays C1 where interpolation hands over); with BEND_MS it also
   * follows the curve's bend for that long, fading.
   */
  private extrap(k: number, tau: number, P: Float64Array, V: Float64Array) {
    const s = this.s, a = s[k], M = this.M0, A = this.A0, G = this.P.GAP_MS, E = this.P.EXTRAP_MS, Bm = this.P.BEND_MS, fd = this.P.TANGENT === 'fd';
    const pv = k > 0 && a.ts - s[k - 1].ts <= G ? s[k - 1] : null;
    const pp = pv && k > 1 && pv.ts - s[k - 2].ts <= G ? s[k - 2] : null;
    const dt = pv ? a.ts - pv.ts : 0;
    if (fd) this.tangent(k, M);
    const t = Math.min(tau, E), x = t - (t * t) / (2 * E), w = 1 - t / E;
    // the bend's own velocity is A·t·(1 - t/Bm): it starts at the curve's acceleration and is back to zero at Bm, so
    // when it stops the position stops with it (a velocity left over would be integrated by the next correction)
    const tb = Math.min(tau, Bm), xb = Bm > 0 ? (tb * tb) / 2 - (tb * tb * tb) / (3 * Bm) : 0, wb = Bm > 0 ? tb - (tb * tb) / Bm : 0;
    for (let j = 0; j < DIM; j++) {
      if (!fd) M[j] = dt > 0 ? clamp((a.v[j] - pv!.v[j]) / dt, -this.cap[j], this.cap[j]) : 0;
      // the parabola's second derivative across the last three knots (per ms²)
      A[j] = pp && Bm > 0 ? (2 * ((a.v[j] - pv!.v[j]) / dt - (pv!.v[j] - pp.v[j]) / (pv!.ts - pp.ts))) / (a.ts - pp.ts) : 0;
      P[j] = a.v[j] + M[j] * x + A[j] * xb; V[j] = M[j] * w + A[j] * wb;
    }
  }

  private hermite(p0: Float64Array, m0: Float64Array, p1: Float64Array, m1: Float64Array, h: number, u: number, P: Float64Array, V: Float64Array) {
    const [a, b, c, d] = H(u), [da, db, dc, dd] = dH(u);
    for (let j = 0; j < DIM; j++) {
      P[j] = a * p0[j] + b * h * m0[j] + c * p1[j] + d * h * m1[j];
      V[j] = (da * p0[j] + dc * p1[j]) / h + db * m0[j] + dd * m1[j];
    }
  }

  private index(T: number) { const s = this.s; let k = s.length - 1; while (k > 0 && s[k].ts > T) k--; return k; }

  private evalAt(T: number, P: Float64Array, V: Float64Array) {
    const s = this.s;
    if (T <= s[0].ts) { this.mode = 'hold'; P.set(s[0].v); V.fill(0); return; }
    const k = this.index(T);
    if (k === s.length - 1) { this.mode = 'extrap'; return this.extrap(k, T - s[k].ts, P, V); }
    const a = s[k], b = s[k + 1], h = b.ts - a.ts;
    this.mode = h > 1.5 * this.interval ? 'hole' : 'interp';
    if (h > this.P.GAP_MS) {
      const tb = b.ts - this.P.EASE_MS;
      this.mode = 'gap';
      if (T <= tb) return this.extrap(k, T - a.ts, P, V);
      this.extrap(k, tb - a.ts, this.eP, this.eV);
      this.tangent(k + 1, this.M1);
      return this.hermite(this.eP, this.eV, b.v, this.M1, this.P.EASE_MS, (T - tb) / this.P.EASE_MS, P, V);
    }
    this.tangent(k, this.M0); this.tangent(k + 1, this.M1);
    this.hermite(a.v, this.M0, b.v, this.M1, h, (T - a.ts) / h, P, V);
  }

  /** the playback time last shown (server ms), or null */
  get shownAt() { return this.prevT; }

  /** write the pose at now - delay into out (DIM floats; yaw wrapped to ±π) */
  sample(out: Float64Array, now: number): RemoteInfo {
    const s = this.s;
    if (!s.length) return { ok: false };
    const dt = this.prevNow == null ? 0 : Math.max(0, now - this.prevNow);
    this.prevNow = now;
    const tgt = this.target;
    if (!this.started) { this.delay = tgt; this.started = true; }
    else { const step = dt * (tgt > this.delay ? 0.1 : 0.04); this.delay += clamp(tgt - this.delay, -step, step); }
    let T = now - this.delay;
    if (this.prevT != null && T < this.prevT) T = this.prevT;

    const { Pv: P, Vv: V } = this;
    if (this.changed && this.prevT != null) {     // new data: absorb the curve's change at the last shown time
      this.evalAt(this.prevT, this.tP, this.tV);
      let e = 0, ev = 0;
      for (let j = 0; j < DIM; j++) {
        this.err[j] = this.out[j] - this.tP[j]; this.errV[j] = this.vel[j] - this.tV[j];
        e = Math.max(e, Math.abs(this.err[j])); ev = Math.max(ev, Math.abs(this.errV[j]));
      }
      if (e > 1e-6 || ev > 1e-7) this.blend = { start: this.prevT, dur: clamp(100 + 400 * e, 100, 300) };
    }
    this.changed = false;
    this.evalAt(T, P, V);
    this.blending = !!this.blend;
    if (this.blend) {
      const { start, dur } = this.blend, u = (T - start) / dur;
      if (u >= 1) this.blend = null;
      else {
        const [a, b] = H(u), [da, db] = dH(u);
        for (let j = 0; j < DIM; j++) {
          P[j] += a * this.err[j] + b * dur * this.errV[j];
          V[j] += (da * this.err[j]) / dur + db * this.errV[j];
        }
      }
    }
    this.out.set(P); this.vel.set(V); this.prevT = T;
    out.set(P);
    out[YAW] = wrapPi(P[YAW]);
    // keep two knots behind the one playing: the parabola tangents and the bend reach that far back
    while (s.length > 4 && s[3].ts <= T) s.shift();
    const kn = s[Math.max(0, this.index(T))];
    return { ok: true, age: now - this.newest, flags: kn.flags, energy: kn.energy, world: kn.world, move: kn.move };
  }
}

/** a pose (landmarks, root, yaw) into the buffer's layout */
export function packPose(p: PoseLike, out = new Float64Array(DIM)) {
  out[0] = p.root[0]; out[1] = p.root[1]; out[2] = p.root[2]; out[YAW] = p.yaw;
  for (let j = 0; j < NLM * 3; j++) out[LOCAL + j] = p.p[j];
  return out;
}

/** where remotePose writes: anything shaped like a LandmarkPose (src/skeleton/landmarks.ts) */
export interface PoseSink { p: { [i: number]: number }; root: { [i: number]: number }; yaw: number }

export function unpackPose(v: ArrayLike<number>, out: PoseSink) {
  out.root[0] = v[0]; out.root[1] = v[1]; out.root[2] = v[2]; out.yaw = v[YAW];
  for (let j = 0; j < NLM * 3; j++) out.p[j] = v[LOCAL + j];
  return out;
}

// ---------------------------------------------------------------- the shared client surface
export interface PoseSend {
  /** game flags (POSE.DODGING …, bits 0..11) */
  flags?: number;
  /** 0..255 */
  energy?: number;
  /** the world this dancer is in */
  world?: string;
  /** the move in progress: [move id, its start time] */
  move?: [string, number] | null;
  /** it jumped (a portal): the others cut rather than slide */
  teleport?: boolean;
}

export type NetEvent = ServerType | 'open' | 'close';
/** what a sender remembers: when it last sent, and its last few snapshots (newest first) to repeat */
interface Sent { last: number; sent: { ts: number; pose: PoseLike }[] }
type Handler = (msg: any) => void;
export interface OpenInfo { room: string; slot: number; seat: number; player: boolean; stage: string; world: string | null }
export interface NetOptions extends Partial<Conditions> { buffer?: Partial<BufferParams>; redundant?: number }

export interface NetLike {
  readonly slot: number | null;
  readonly room: string | null;
  readonly state: PublicState | null;
  readonly connected: boolean;
  readonly rtt: number;
  readonly jitter: number;
  now(): number;
  on<T extends ServerType>(type: T, fn: (msg: MsgOf<T>) => void): () => void;
  on(type: 'open', fn: (info: OpenInfo) => void): () => void;
  on(type: 'close', fn: (info: { code: number; reconnecting: boolean }) => void): () => void;
  send(msg: ClientMsg): unknown;
  sendPose(pose: PoseLike, o?: PoseSend): void;
  remotePose(out: PoseSink, slot?: number): RemoteInfo;
  peers(): number[];
  buffer(slot: number): PoseBuffer | null;
  close(): void;
}

abstract class Base implements NetLike {
  readonly cond: Conditions;
  protected up: Link;
  protected down: Link;
  protected handlers: Record<string, Handler[]> = {};
  protected bufs: (PoseBuffer | null)[] = new Array(SLOTS).fill(null);
  protected bufParams: Partial<BufferParams>;
  protected redundant: number;
  connected = false;
  slot: number | null = null;
  room: string | null = null;
  stage: string | null = null;
  world: string | null = null;
  state: PublicState | null = null;
  /** slots present besides this one */
  protected present = new Set<number>();


  private tmp = new Float64Array(DIM);
  /** every pose frame decoded here, for probes (src/net/demo.ts measures pose error with it) */
  onPose: ((f: PoseFrame, now: number) => void) | null = null;
  /** any other binary frame from the server (an online duel's snapshots: src/net/duel-client.ts) */
  onFrame: ((b: Uint8Array) => void) | null = null;

  constructor(opts: NetOptions) {
    const c = { ...urlConditioner(), ...opts };
    this.cond = { lag: c.lag || 0, jitter: c.jitter || 0, loss: c.loss || 0 };
    this.up = new Link(this.cond); this.down = new Link(this.cond);
    this.bufParams = opts.buffer ?? {};
    this.redundant = opts.redundant ?? NET_PARAMS.REDUNDANT;
  }
  abstract now(): number;
  abstract get rtt(): number;
  abstract get jitter(): number;
  abstract send(msg: ClientMsg): unknown;
  abstract sendPose(pose: PoseLike, o?: PoseSend): void;
  abstract close(): void;
  protected abstract pump(): void;

  /** the jogo's seat (0 or 1), or null for a guest */
  get seat() { return this.slot != null && this.slot < SEATS ? this.slot : null; }
  /** the slot remotePose plays by default: the other seat for a player, else the first seat present */
  get partnerSlot(): number {
    if (this.slot != null && this.slot < SEATS) return 1 - this.slot;
    for (const s of this.present) if (s < SEATS) return s;
    return [...this.present][0] ?? 0;
  }
  /** current playback delay of the default remote dancer (ms) */
  get delay() { return this.bufs[this.partnerSlot]?.delay ?? 0; }
  peers() { return [...this.present].sort((a, b) => a - b); }
  buffer(slot: number) { return this.bufs[slot]; }

  on(type: NetEvent, fn: Handler) {
    (this.handlers[type] ||= []).push(fn);
    return () => { this.handlers[type] = this.handlers[type].filter((f) => f !== fn); };
  }
  protected emit(type: NetEvent, msg: unknown) {
    for (const fn of this.handlers[type] || []) { try { fn(msg); } catch (e) { console.error('net handler', type, e); } }
  }

  /** the interpolated pose of `slot` (default: the partner) into out -> { ok, age, flags, energy, world, move } */
  remotePose(out: PoseSink, slot = this.partnerSlot): RemoteInfo {
    this.pump();
    const b = this.bufs[slot];
    if (!b) return { ok: false, slot };
    const r = b.sample(this.tmp, this.now());
    if (r.ok) unpackPose(this.tmp, out);
    r.slot = slot;
    return r;
  }

  /** the binary frame for this pose if one is due (rate-limited to `interval`), else null */
  protected poseFrame(pose: PoseLike, o: PoseSend, interval: number, which: Sent) {
    const t = perf();
    if (t - which.last < interval) return null;
    which.last = t - which.last < 2 * interval ? which.last + interval : t;
    const ts = Math.round(this.now() * 10) / 10;
    const copy: PoseLike = { p: Float64Array.from(pose.p as ArrayLike<number>), root: [pose.root[0], pose.root[1], pose.root[2]], yaw: pose.yaw };
    const frame = encodePose({
      ts, pose: copy, flags: (o.flags ?? 0) | (o.teleport ? POSE.TELEPORT : 0), energy: o.energy, world: o.world ?? this.world ?? '',
      prev: o.teleport ? null : which.sent.slice(0, this.redundant), move: o.move ?? null,
    });
    // after a teleport the earlier snapshots are from somewhere else: never repeat them
    which.sent = o.teleport ? [{ ts, pose: copy }] : [{ ts, pose: copy }, ...which.sent].slice(0, MAX_PREV);
    return frame;
  }

  /** a pose frame arrived (binary) */
  protected recvPose(b: Uint8Array) {
    if (b[0] !== 0x50) { this.onFrame?.(b); return; }
    const f = decodePose(b);
    if (!f || f.slot >= SLOTS || f.slot === this.slot) return;
    const buf = (this.bufs[f.slot] ??= new PoseBuffer(this.bufParams));
    const now = this.now(), meta: PoseMeta = { flags: f.flags, energy: f.energy, world: f.world, move: f.move };
    // the repeated snapshots first (oldest first), so frames lost just before this one are filled in
    for (let i = f.prev.length - 1; i >= 0; i--) buf.push(f.prev[i].ts, packPose(f.prev[i], this.tmp), { ...meta, flags: meta.flags & ~POSE.TELEPORT }, now, false);
    buf.push(f.ts, packPose(f, this.tmp), meta, now);
    this.onPose?.(f, now);
  }

  protected recv(msg: ServerMsg) {
    switch (msg.t) {
      case 'state': this.state = msg; if (msg.world !== undefined && this.slot != null) this.world = msg.slots[this.slot]?.world ?? msg.world; break;
      case 'peer':
        if (msg.present) this.present.add(msg.slot);
        else this.present.delete(msg.slot);
        break;
      case 'ev': if (msg.k === 'travel' && msg.by === this.slot) this.world = msg.world; break;
    }
    this.emit(msg.t, msg);
  }
}

// ---------------------------------------------------------------- Net: the real server
export class Net extends Base {
  readonly url: string;
  readonly clock = new Clock();
  token: string | null = null;
  ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private closed = false;
  private attempt = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pend: { resolve: (i: OpenInfo) => void; reject: (e: Error) => void } | null = null;
  private want: { room: string | null; create: boolean; stage: string; world: string | null; role: Role; duel?: DuelHello } = { room: null, create: false, stage: 'void', world: null, role: 'any' };
  /** an online duel's room as the server described it on joining (null in a jogo's) */
  duel: DuelWelcome | null = null;
  private mine: Sent = { last: -Infinity, sent: [] };

  /** url: ws(s)://host:port/ws; in a browser it defaults to the page's own host */
  constructor(url?: string, opts: NetOptions = {}) {
    super(opts);
    if (!url) {
      if (typeof location === 'undefined') throw new Error('Net: url required outside the browser');
      url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }
    this.url = url;
  }
  get rtt() { return this.clock.rtt; }
  get jitter() { const b = this.bufs[this.partnerSlot]; return b && b.n > 8 ? b.jitter : this.clock.jitter; }
  now() { return this.clock.now(); }

  /** join (or with create, make) a room; room null makes one with a fresh code. Reconnects with its token after */
  connect({ room = null, create = false, stage = 'void', world = null, role = 'any', duel }: { room?: string | null; create?: boolean; stage?: string; world?: string | null; role?: Role; duel?: DuelHello } = {}) {
    this.want = { room, create, stage, world, role, duel };
    return new Promise<OpenInfo>((resolve, reject) => { this.pend = { resolve, reject }; this.open(); });
  }

  private open() {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const w = this.world ?? this.want.world;
      this.raw({
        t: 'hello', v: PROTOCOL, room: this.room ?? this.want.room, create: this.want.create, stage: this.stage ?? this.want.stage,
        role: this.want.role, ...(w != null ? { world: w } : {}), ...(this.token ? { token: this.token } : {}), ...(this.want.duel ? { duel: this.want.duel } : {}),
      });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (ev.data instanceof ArrayBuffer) {
        const b = new Uint8Array(ev.data);
        if (this.down.active) this.down.push(() => this.recvPose(b), true); else this.recvPose(b);
        return;
      }
      if (typeof ev.data !== 'string') return;
      const s = ev.data, handle = () => { let m: ServerMsg; try { m = JSON.parse(s); } catch { return; } this.msg(m); };
      if (this.down.active) this.down.push(handle); else handle();
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      const was = this.connected;
      this.connected = false;
      const retry = !this.closed && !!this.token && ev.code !== 4000;
      if (was || this.token) this.emit('close', { code: ev.code, reconnecting: retry });
      if (this.pend) { this.pend.reject(new Error('connect failed')); this.pend = null; return; }
      if (retry) this.later(() => this.open(), Math.min(5000, 250 * 2 ** this.attempt++) * (0.75 + Math.random() * 0.5));
    };
    ws.onerror = () => {};
  }

  private later(fn: () => void, ms: number) { const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }

  private msg(m: ServerMsg) {
    switch (m.t) {
      case 'joined': {
        Object.assign(this, { room: m.room, slot: m.slot, stage: m.stage, world: m.world, token: m.token, connected: true, duel: m.duel ?? null });
        this.attempt = 0;
        this.present.clear();
        this.clock.coarse(m.now);
        for (let i = 0; i < 5; i++) this.later(() => this.ping(), 40 * i);
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.ping(), 2000);
        const q = this.queue; this.queue = [];
        for (const msg of q) this.raw(msg);
        const info: OpenInfo = { room: m.room, slot: m.slot, seat: m.seat, player: m.player, stage: m.stage, world: m.world };
        if (this.pend) { this.pend.resolve(info); this.pend = null; }
        this.emit('open', info);
        return;
      }
      case 'error':
        if (this.pend) { const e = Object.assign(new Error(m.why ?? m.code), { code: m.code }); this.pend.reject(e); this.pend = null; this.closed = true; this.ws?.close(); }
        else if (m.code === 'gone' || m.code === 'full') { this.closed = true; this.ws?.close(); }   // the slot is lost for good
        this.emit('error', m);
        return;
      case 'pong': this.clock.add(m.c, m.s, perf()); return;
    }
    this.recv(m);
  }

  private ping() { if (this.connected) this.raw({ t: 'ping', c: perf() }); }
  private raw(obj: ClientMsg) {
    const s = JSON.stringify(obj);
    const go = () => { if (this.ws && this.ws.readyState === 1) this.ws.send(s); };
    if (this.up.active) this.up.push(go); else go();
  }

  protected pump() { this.up.drain(); this.down.drain(); }

  /** call every frame with this dancer's landmarks; it sends at 20 Hz (12 Hz when the socket is backed up) */
  sendPose(pose: PoseLike, o: PoseSend = {}) {
    this.pump();
    const backed = !!this.ws && this.ws.bufferedAmount > NET_PARAMS.BACKED_UP;
    const fr = this.poseFrame(pose, o, backed ? NET_PARAMS.SLOW_SEND_MS : NET_PARAMS.SEND_MS, this.mine);
    if (!fr || !this.connected) return;
    const go = () => { if (this.ws && this.ws.readyState === 1) this.ws.send(fr); };
    if (this.up.active) this.up.push(go, true); else go();
  }

  /** a binary frame through the conditioner as a pose goes (it may be lost there): an online duel's inputs */
  sendBinary(b: Uint8Array) {
    this.pump();
    if (!this.connected) return;
    const go = () => { if (this.ws && this.ws.readyState === 1) this.ws.send(b); };
    if (this.up.active) this.up.push(go, true); else go();
  }

  /** a reliable message (move, xch, form, merge, fx, ready, travel, build, melt, shatter); queued while down */
  send(msg: ClientMsg) {
    if (msg.t === 'move' && !fin(msg.ts)) msg = { ...msg, ts: this.now() };
    if (this.connected) this.raw(msg);
    else { this.queue.push(msg); if (this.queue.length > NET_PARAMS.QUEUE_CAP) this.queue.shift(); }
    return msg;
  }

  close() {
    this.closed = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.up.clear(); this.down.clear();
    const ws = this.ws;
    this.ws = null;
    const was = this.connected;
    this.connected = false;
    if (ws) ws.close(1000);
    if (was) this.emit('close', { code: 1000, reconnecting: false });
  }
}

// ---------------------------------------------------------------- LocalNet: same-screen and partner-bot play
/**
 * The local player is seat 0. LocalNet acts as the server: it runs shared/rules.ts, ticks at 20 Hz, sends 'state' on
 * change and at least once a second (4 Hz while a form drains or a fusion runs), and every message between the
 * "server" and either seat goes through the conditioner, as with Net. Both seats are present from connect(), so the
 * session starts (intro) at once.
 *
 * Partner contract (seat 1), optional:
 *   partner.attach(api)     once, from connect(). api.seat (1), api.now(), api.state (the last state it received),
 *                           api.send(msg) (any client message as seat 1; a move's id and ts are filled in),
 *                           api.on(type, fn) (seat 1's own view: 'state', 'move' from seat 0, 'no', 'xch', 'ev', 'fx'),
 *                           api.peerPose(out) (seat 0's latest pose as received -> { ok, flags, energy, world, move }).
 *   partner.pose(out)       every frame (and from a 20 Hz timer when the game isn't calling): write seat 1's pose into
 *                           out (a PoseSink) and return { flags, energy, world, move }. It is encoded and sent at 20 Hz
 *                           like a real client's and reaches seat 0 through the same buffer (net.remotePose).
 * With no partner (same screen) the game drives seat 1 itself with net.sendAs(1, msg); messages meant for seat 1 only
 * arrive through net.on() too, with to: 1 added.
 */
export interface PartnerApi {
  seat: 1;
  now(): number;
  readonly state: PublicState | null;
  send(msg: ClientMsg): ClientMsg | null;
  on<T extends ServerType>(type: T, fn: (msg: MsgOf<T>) => void): () => void;
  peerPose(out: PoseSink): RemoteInfo;
}
export interface Partner { attach?(api: PartnerApi): void; pose?(out: PoseSink): PoseSend | void }

export class LocalNet extends Base {
  /** the partner bot playing seat 1, if any */
  bot: Partner | null;
  session: Session | null = null;
  private pUp: Link;
  private pDown: Link;
  private pHandlers: Record<string, Handler[]> = {};
  private pState: PublicState | null = null;
  private pPeer: PoseFrame | null = null;
  private pPose = { p: new Float64Array(NLM * 3), root: [0, 0, 0], yaw: 0 };
  private n = [0, 0];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = -Infinity;
  private lastState = -Infinity;
  private pCall = -Infinity;
  private mine: Sent = { last: -Infinity, sent: [] };
  private theirs: Sent = { last: -Infinity, sent: [] };

  constructor({ stage = 'void', world = null, partner = null, ...opts }: NetOptions & { stage?: string; world?: string | null; partner?: Partner | null } = {}) {
    super(opts);
    this.stage = stage; this.world = world; this.bot = partner;
    this.pUp = new Link(this.cond); this.pDown = new Link(this.cond);
  }
  get rtt() { return this.cond.lag; }
  get jitter() { return this.bufs[1]?.jitter ?? 0; }
  now() { return performance.timeOrigin + perf(); }

  connect({ stage, world }: { stage?: string; world?: string | null } = {}) {
    if (stage) this.stage = stage;
    if (world != null) this.world = world;
    const t = this.now();
    this.session = createSession(this.stage, t, this.world);
    this.stage = this.session.stage; this.world = this.session.world ?? this.session.stage;
    Object.assign(this, { connected: true, slot: 0, room: 'LOCAL' });
    if (this.bot) this.bot.attach?.(this.partnerApi());
    setPresent(this.session, 0, true, t);
    this.evs(setPresent(this.session, 1, true, t));
    this.timer = setInterval(() => this.pumpAll(true), NET_PARAMS.SEND_MS);
    const info: OpenInfo = { room: 'LOCAL', slot: 0, seat: 0, player: true, stage: this.stage!, world: this.world };
    this.to(0, { t: 'peer', slot: 1, present: true, player: true });
    this.to(1, { t: 'peer', slot: 0, present: true, player: true });
    this.to('all', { t: 'pieces', list: piecesOf(this.session) });
    this.broadcastState();
    queueMicrotask(() => this.emit('open', info));
    return Promise.resolve(info);
  }

  private partnerApi(): PartnerApi {
    const self = this;
    return {
      seat: 1,
      now: () => this.now(),
      get state() { return self.pState; },
      send: (msg) => this.sendAs(1, msg),
      on: (type, fn) => { (this.pHandlers[type] ||= []).push(fn as Handler); return () => { this.pHandlers[type] = this.pHandlers[type].filter((f) => f !== fn); }; },
      peerPose: (out) => {
        const b = this.pPeer;
        if (!b) return { ok: false };
        unpackPose(packPose(b), out);
        return { ok: true, flags: b.flags, energy: b.energy, world: b.world, move: b.move };
      },
    };
  }

  /** send as either seat; sendAs(0, msg) is send(msg). A move without id or ts gets them */
  sendAs(seat: 0 | 1, msg: ClientMsg): ClientMsg | null {
    if (!this.connected) return null;
    if (msg.t === 'move') msg = { ...msg, id: msg.id || `${seat}-L${++this.n[seat]}`, ts: fin(msg.ts) ? msg.ts : this.now() };
    const m = msg;
    (seat === 0 ? this.up : this.pUp).push(() => this.server(seat, m));
    return msg;
  }
  send(msg: ClientMsg) { return this.sendAs(0, msg); }

  // ---- the "server" side
  private server(seat: number, msg: ClientMsg) {
    if (!this.session) return;
    for (const [to, m] of route(this.session, seat, msg, this.now()).out) this.to(to === 'others' ? 1 - seat : to, m);
    if (this.session.changed) this.broadcastState();
  }
  private serverPose(seat: number, frame: Uint8Array) {
    frame[1] = seat;
    const to = 1 - seat;
    if (to === 0) this.down.push(() => this.recvPose(frame), true);
    else if (this.bot) this.pDown.push(() => { this.pPeer = decodePose(frame); }, true);
  }
  private evs(events: object[]) { for (const e of events) this.to('all', { t: 'ev', ...e } as ServerMsg); }
  private to(to: To, msg: ServerMsg) {
    if (to === 0 || to === 'all') this.down.push(() => this.recv(msg));
    if (to === 1 || to === 'all') {
      if (this.bot) this.pDown.push(() => this.partnerRecv(msg));
      else if (to === 1) this.down.push(() => this.recv({ ...msg, to: 1 } as ServerMsg));
    }
  }
  private partnerRecv(msg: ServerMsg) {
    if (msg.t === 'state') this.pState = msg;
    for (const fn of this.pHandlers[msg.t] || []) { try { fn(msg); } catch (e) { console.error('partner handler', msg.t, e); } }
  }
  private broadcastState() {
    this.lastState = this.now();
    this.session!.changed = false;
    this.to('all', { t: 'state', ...publicState(this.session!) });
  }

  protected pump() { this.pumpAll(false); }
  private pumpAll(fromTimer: boolean) {
    for (const l of [this.up, this.down, this.pUp, this.pDown]) l.drain();
    const s = this.session;
    if (!s) return;
    const t = this.now();
    if (t - this.lastTick >= NET_PARAMS.SEND_MS) {
      this.lastTick = t;
      this.evs(tick(s, t));
      const every = s.form.some(Boolean) || s.phase === 'fusion' ? 250 : 1000;
      if (s.changed || t - this.lastState >= every) this.broadcastState();
    }
    // the partner's pose: every frame while the game is calling, else from the 20 Hz timer
    if (this.bot?.pose && (fromTimer ? t - this.pCall >= 2 * NET_PARAMS.SEND_MS : t - this.pCall >= 8)) {
      this.pCall = t;
      const r = this.bot.pose(this.pPose) || {};
      const fr = this.poseFrame(this.pPose, { ...r, world: r.world ?? this.world ?? '' }, NET_PARAMS.SEND_MS, this.theirs);
      if (fr) this.pUp.push(() => this.serverPose(1, fr), true);
    }
  }

  sendPose(pose: PoseLike, o: PoseSend = {}) {
    this.pumpAll(false);
    const fr = this.poseFrame(pose, o, NET_PARAMS.SEND_MS, this.mine);
    if (fr && this.connected) this.up.push(() => this.serverPose(0, fr), true);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const l of [this.up, this.down, this.pUp, this.pDown]) l.clear();
    const was = this.connected;
    this.connected = false; this.session = null;
    if (was) this.emit('close', { code: 1000, reconnecting: false });
  }
}

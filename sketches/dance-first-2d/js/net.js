// net.js — Dance First networking client. Protocol v2 and interfaces: DESIGN.md.
//   Net       talks to server.js over WebSocket /ws.
//   LocalNet  same surface, no socket: runs shared/rules.js in the page (same-screen or partner bot).
// Runs in the browser and imports cleanly in Node 22 (global WebSocket, performance).
//
// Network conditioner (testing): URL ?lag=150&jitter=60&loss=5, or the same keys in the constructor
// options. Applied to every message in both directions. Per direction: delay = lag/2 + uniform
// (-jitter/2..+jitter/2), so a round trip adds about `lag` and one pose path (sender up + receiver down,
// both conditioned) varies by up to +-jitter. Reliable messages stay in order (like TCP); poses are
// delayed independently (may reorder) and `loss` percent of them are dropped per direction.
import { createSession, tick, setPresent, route, publicState } from '../shared/rules.js';

const MAX_POSE = 96;          // pose components per frame (e.g. 13 joints x 3)
const SEND_MS = 50;           // 20 Hz pose rate
const SLOW_SEND_MS = 83;      // ~12 Hz while the socket is backed up
const BACKED_UP = 4096;       // ws.bufferedAmount bytes
const QUEUE_CAP = 32;         // reliable events kept while disconnected
const perf = () => performance.now();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fin = x => typeof x === 'number' && Number.isFinite(x);

function urlConditioner() {
  if (typeof location === 'undefined' || !location.search) return {};
  const q = new URLSearchParams(location.search), o = {};
  for (const k of ['lag', 'jitter', 'loss']) if (q.has(k) && Number.isFinite(+q.get(k))) o[k] = +q.get(k);
  return o;
}

// ---------- conditioner: one direction of a link ----------
class Link {
  constructor({ lag = 0, jitter = 0, loss = 0 } = {}) {
    this.lag = Math.max(0, lag); this.jitter = Math.max(0, jitter); this.loss = clamp(loss, 0, 100);
    this.q = []; this.lastAt = 0; this.timer = null;
  }
  get active() { return this.lag > 0 || this.jitter > 0 || this.loss > 0; }
  push(fn, pose = false) {
    if (pose && Math.random() * 100 < this.loss) return;
    let at = perf() + Math.max(0, this.lag / 2 + (Math.random() * 2 - 1) * this.jitter / 2);
    if (!pose) at = this.lastAt = Math.max(this.lastAt, at);
    let i = this.q.length;
    while (i > 0 && this.q[i - 1].at > at) i--;
    this.q.splice(i, 0, { at, fn });
    this.schedule();
  }
  drain() {
    const t = perf();
    while (this.q.length && this.q[0].at <= t) this.q.shift().fn();
    this.schedule();
  }
  schedule() {
    clearTimeout(this.timer); this.timer = null;
    if (this.q.length) this.timer = setTimeout(() => this.drain(), Math.max(0, this.q[0].at - perf()));
  }
  clear() { clearTimeout(this.timer); this.timer = null; this.q.length = 0; }
}

// ---------- clock sync ----------
// Offset = server - local, from the lowest-RTT sample of the last 8. Changes are slewed (5% of elapsed
// time) so now() never jumps, except during the first five samples or for errors over a second.
class Clock {
  constructor() { this.samples = []; this.offset = 0; this.target = 0; this.count = 0; this.last = perf(); this.rtt = 0; this.jitter = 0; }
  coarse(serverNow) { if (!this.count) this.offset = this.target = serverNow - perf(); }
  add(c, s, recv) {
    if (!fin(c) || !fin(s)) return;
    const rtt = recv - c;
    this.samples.push({ rtt, off: s + rtt / 2 - recv });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.target = best.off;
    this.count++;
    this.now();
    if (this.count <= 5 || Math.abs(this.target - this.offset) > 1000) this.offset = this.target;
    const rs = this.samples.map(x => x.rtt), mean = rs.reduce((a, b) => a + b, 0) / rs.length;
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

// ---------- remote pose jitter buffer ----------
// Snapshots keyed by sender ts (server time). Playback at T = now - delay, delay slewing toward
// transit + 2 send intervals + 2.5 x jitter (clamped 80..350 ms). Between snapshots: cubic Hermite with
// Catmull-Rom tangents (C1). Past the newest: extrapolate along the last velocity with constant
// deceleration to rest over 120 ms, then hold. Snapshot gaps over 300 ms (peer away) hold, then ease into
// the next snapshot over 200 ms. Whenever new data changes the curve, the difference (position and
// velocity) at the last shown time is blended out with a Hermite offset over 100..300 ms, so the output
// is continuous in position and velocity in every case. Poses are flat arrays of any length up to 96,
// interpolated component-wise; if the sender's length changes the buffer resets (a new shape cannot blend).
const EXTRAP_MS = 120, GAP_MS = 300, EASE_MS = 200, MAX_V = 0.008; // MAX_V: world units per ms
const H = s => [2 * s * s * s - 3 * s * s + 1, s * s * s - 2 * s * s + s, -2 * s * s * s + 3 * s * s, s * s * s - s * s];
const dH = s => [6 * s * s - 6 * s, 3 * s * s - 4 * s + 1, -6 * s * s + 6 * s, 3 * s * s - 2 * s];

export class PoseBuffer {     // exported for test/smoothness.test.mjs; the game uses Net.remotePose
  constructor(scale = 1000) {
    this.scale = scale;             // wire units per world unit
    this.newest = -Infinity; this.n = 0;
    this.mean = 0; this.dev = 0; this.interval = SEND_MS;
    this.delay = 150; this.started = false;
    this.prevNow = null;
    this.reset(0);
  }
  // Drop all snapshots and playback state; used at start and when the sender's pose length changes.
  reset(dim) {
    this.dim = dim;
    this.s = [];                    // [{ ts, p: Float64Array(dim), f, e, m }], sorted by ts
    this.prevT = null; this.changed = false; this.blend = null;   // blend: { start, dur }
    for (const k of ['out', 'vel', 'P', 'V', 'tP', 'tV', 'M0', 'M1', 'err', 'errV']) this[k] = new Float64Array(dim);
  }
  get jitter() { return 1.25 * this.dev; }
  get target() { return clamp(this.mean + 2 * this.interval + 2.5 * this.jitter, 80, 350); }

  push(ts, p, f, e, m, now) {
    if (!fin(ts) || !Array.isArray(p) || !p.length || p.length > MAX_POSE || ts > now + 1000) return;
    if (p.length !== this.dim) {
      if (this.dim && ts <= this.newest) return;                    // a late frame of the old shape
      this.reset(p.length);
    }
    const tr = now - ts;
    if (this.n++ === 0) this.mean = tr;
    else { this.mean += (tr - this.mean) * 0.1; this.dev += (Math.abs(tr - this.mean) - this.dev) * 0.1; }
    if (ts > this.newest) {
      const iv = ts - this.newest;
      if (iv < GAP_MS) this.interval += (clamp(iv, 20, 200) - this.interval) * 0.1;
      this.newest = ts;
    }
    if (this.prevT != null && ts <= this.prevT) return;            // too late to use
    const s = this.s;
    let i = s.length;
    while (i > 0 && s[i - 1].ts > ts) i--;
    if (i > 0 && s[i - 1].ts === ts) return;
    const q = new Float64Array(this.dim);
    for (let j = 0; j < this.dim; j++) q[j] = fin(p[j]) ? p[j] / this.scale : 0;
    s.splice(i, 0, { ts, p: q, f: f | 0, e: e | 0, m: Array.isArray(m) ? m : null });
    if (s.length > 64) s.shift();
    this.changed = true;
  }

  tangent(k, M) {
    const s = this.s, a = s[k];
    const pv = k > 0 && a.ts - s[k - 1].ts <= GAP_MS ? s[k - 1] : null;
    const nx = k < s.length - 1 && s[k + 1].ts - a.ts <= GAP_MS ? s[k + 1] : null;
    const lo = pv || a, hi = nx || a, dt = hi.ts - lo.ts;
    for (let j = 0; j < this.dim; j++) M[j] = dt > 0 ? clamp((hi.p[j] - lo.p[j]) / dt, -MAX_V, MAX_V) : 0;
  }
  // From knot k, tau ms on: decelerate the backward tangent to rest over EXTRAP_MS, then hold.
  extrap(k, tau, P, V) {
    const s = this.s, a = s[k], M = this.M0;
    const pv = k > 0 && a.ts - s[k - 1].ts <= GAP_MS ? s[k - 1] : null;
    const dt = pv ? a.ts - pv.ts : 0;
    const t = Math.min(tau, EXTRAP_MS), x = t - t * t / (2 * EXTRAP_MS), w = 1 - t / EXTRAP_MS;
    for (let j = 0; j < this.dim; j++) {
      M[j] = dt > 0 ? clamp((a.p[j] - pv.p[j]) / dt, -MAX_V, MAX_V) : 0;
      P[j] = a.p[j] + M[j] * x; V[j] = M[j] * w;
    }
  }
  hermite(p0, m0, p1, m1, h, s, P, V) {
    const [a, b, c, d] = H(s), [da, db, dc, dd] = dH(s);
    for (let j = 0; j < this.dim; j++) {
      P[j] = a * p0[j] + b * h * m0[j] + c * p1[j] + d * h * m1[j];
      V[j] = (da * p0[j] + dc * p1[j]) / h + db * m0[j] + dd * m1[j];
    }
  }
  index(T) { const s = this.s; let k = s.length - 1; while (k > 0 && s[k].ts > T) k--; return k; }
  evalAt(T, P, V) {
    const s = this.s;
    if (T <= s[0].ts) { P.set(s[0].p); V.fill(0); return; }
    const k = this.index(T);
    if (k === s.length - 1) return this.extrap(k, T - s[k].ts, P, V);
    const a = s[k], b = s[k + 1], h = b.ts - a.ts;
    if (h > GAP_MS) {
      const tb = b.ts - EASE_MS;
      if (T <= tb) return this.extrap(k, T - a.ts, P, V);
      const P0 = new Float64Array(this.dim), V0 = new Float64Array(this.dim);
      this.extrap(k, tb - a.ts, P0, V0);
      this.tangent(k + 1, this.M1);
      return this.hermite(P0, V0, b.p, this.M1, EASE_MS, (T - tb) / EASE_MS, P, V);
    }
    this.tangent(k, this.M0); this.tangent(k + 1, this.M1);
    this.hermite(a.p, this.M0, b.p, this.M1, h, (T - a.ts) / h, P, V);
  }

  sample(out, now) {
    const s = this.s;
    if (!s.length) return { ok: false };
    const dt = this.prevNow == null ? 0 : Math.max(0, now - this.prevNow);
    this.prevNow = now;
    const tgt = this.target;
    if (!this.started) { this.delay = tgt; this.started = true; }
    else { const up = tgt > this.delay, step = dt * (up ? 0.1 : 0.04); this.delay += clamp(tgt - this.delay, -step, step); }
    let T = now - this.delay;
    if (this.prevT != null && T < this.prevT) T = this.prevT;

    const { P, V } = this;
    if (this.changed && this.prevT != null) {     // new data: absorb the curve change at the last shown time
      this.evalAt(this.prevT, this.tP, this.tV);
      let e = 0;
      for (let j = 0; j < this.dim; j++) {
        this.err[j] = this.out[j] - this.tP[j]; this.errV[j] = this.vel[j] - this.tV[j];
        e = Math.max(e, Math.abs(this.err[j]));
      }
      if (e > 1e-6 || this.errV.some(x => Math.abs(x) > 1e-7)) this.blend = { start: this.prevT, dur: clamp(100 + 400 * e, 100, 300) };
    }
    this.changed = false;
    this.evalAt(T, P, V);
    if (this.blend) {
      const { start, dur } = this.blend, u = (T - start) / dur;
      if (u >= 1) this.blend = null;
      else {
        const [a, b] = H(u), [da, db] = dH(u);
        for (let j = 0; j < this.dim; j++) {
          P[j] += a * this.err[j] + b * dur * this.errV[j];
          V[j] += da * this.err[j] / dur + db * this.errV[j];
        }
      }
    }
    this.out.set(P); this.vel.set(V); this.prevT = T;
    const n = Math.min(this.dim, out.length);
    for (let j = 0; j < n; j++) out[j] = P[j];
    while (s.length > 3 && s[2].ts <= T) s.shift();
    const kn = s[Math.max(0, this.index(T))];
    return { ok: true, age: now - this.newest, flags: kn.f, energy: kn.e, move: kn.m, n: this.dim };
  }
}

// ---------- shared client surface ----------
class Base {
  constructor(opts) {
    const c = { ...urlConditioner(), ...opts };
    this.cond = { lag: c.lag || 0, jitter: c.jitter || 0, loss: c.loss || 0 };
    this.up = new Link(this.cond); this.down = new Link(this.cond);
    this.poseScale = c.poseScale > 0 ? c.poseScale : 1000;     // wire units per world unit
    this.buf = new PoseBuffer(this.poseScale);
    this.handlers = {};
    this.connected = false; this.seat = null; this.room = null; this.stage = null; this.world = null; this.state = null; this.peer = false;
    this._lastPose = -Infinity;
  }
  get delay() { return this.buf.delay; }       // current playback delay of the remote pose, ms
  on(type, fn) { (this.handlers[type] ||= []).push(fn); return () => { this.handlers[type] = this.handlers[type].filter(f => f !== fn); }; }
  emit(type, msg) {
    for (const fn of this.handlers[type] || []) { try { fn(msg); } catch (e) { console.error('net handler', type, e); } }
  }
  // Writes the interpolated remote pose into out (as many components as the sender uses, up to out.length).
  // -> { ok, age, flags, energy, move, n } where n is the sender's pose length.
  remotePose(out) { this._pump(); return this.buf.sample(out, this.now()); }
  // Returns the quantised pose frame if one is due, else null. move: [moveId, startTs] or null.
  _poseFrame(pose, flags, energy, move, interval) {
    const t = perf();
    if (t - this._lastPose < interval) return null;
    this._lastPose = t - this._lastPose < 2 * interval ? this._lastPose + interval : t;
    const n = Math.min(pose.length, MAX_POSE), p = new Array(n);
    for (let j = 0; j < n; j++) p[j] = Math.round((pose[j] || 0) * this.poseScale);
    const fr = { t: 'pose', ts: Math.round(this.now() * 10) / 10, p, f: flags | 0, e: clamp(Math.round(energy) || 0, 0, 255) };
    if (Array.isArray(move) && move.length === 2) fr.m = [String(move[0]), +move[1]];
    return fr;
  }
  // Incoming message handling common to Net and LocalNet.
  _recv(msg) {
    switch (msg.t) {
      case 'pose': this.buf.push(msg.ts, msg.p, msg.f, msg.e, msg.m, this.now()); return;
      case 'state': this.state = msg; if (msg.world !== undefined) this.world = msg.world; break;
      case 'peer': this.peer = !!msg.present; break;
    }
    this.emit(msg.t, msg);
  }
  _pump() { this.up.drain(); this.down.drain(); }
}

// ---------- Net: the real server ----------
export class Net extends Base {
  constructor(url, opts = {}) {
    super(opts);
    if (!url) {
      if (typeof location === 'undefined') throw new Error('Net: url required outside the browser');
      url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }
    this.url = url;
    this.clock = new Clock();
    this.token = null; this.queue = []; this.ws = null;
    this._closed = false; this._attempt = 0; this._timers = new Set(); this._pingTimer = null; this._pend = null;
  }
  get rtt() { return this.clock.rtt; }
  get jitter() { return this.buf.n > 8 ? this.buf.jitter : this.clock.jitter; }
  now() { return this.clock.now(); }

  connect({ room = null, stage = 'void', world = null } = {}) {
    this._want = { room, stage, world };
    return new Promise((resolve, reject) => { this._pend = { resolve, reject }; this._open(); });
  }

  _open() {
    if (this._closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this._raw({ t: 'hello', v: 2, room: this.room ?? this._want.room, stage: this.stage ?? this._want.stage, ...(this._want.world != null || this.world != null ? { world: this.world ?? this._want.world } : {}), ...(this.token ? { token: this.token } : {}) });
    };
    ws.onmessage = ev => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      const s = ev.data, handle = () => { let m; try { m = JSON.parse(s); } catch { return; } this._msg(m); };
      if (this.down.active) this.down.push(handle, s.startsWith('{"t":"pose"')); else handle();
    };
    ws.onclose = ev => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this._pingTimer); this._pingTimer = null;
      const wasConnected = this.connected;
      this.connected = false;
      const retry = !this._closed && !!this.token && ev.code !== 4000;
      if (wasConnected || this.token) this.emit('close', { code: ev.code, reconnecting: retry });
      if (this._pend) { this._pend.reject(new Error('connect failed')); this._pend = null; return; }
      if (retry) this._later(() => this._open(), Math.min(5000, 250 * 2 ** this._attempt++) * (0.75 + Math.random() * 0.5));
    };
    ws.onerror = () => {};
  }

  _later(fn, ms) { const id = setTimeout(() => { this._timers.delete(id); fn(); }, ms); this._timers.add(id); }

  _msg(m) {
    switch (m.t) {
      case 'joined': {
        Object.assign(this, { room: m.room, seat: m.seat, stage: m.stage, world: m.world, token: m.token, connected: true });
        this._attempt = 0;
        this.clock.coarse(m.now);
        for (let i = 0; i < 5; i++) this._later(() => this._ping(), 40 * i);
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => this._ping(), 2000);
        const q = this.queue; this.queue = [];
        for (const msg of q) this._raw(msg);
        const info = { room: m.room, seat: m.seat, stage: m.stage, world: m.world };
        if (this._pend) { this._pend.resolve(info); this._pend = null; }
        this.emit('open', info);
        return;
      }
      case 'error':
        if (this._pend) { const e = new Error(m.code); e.code = m.code; this._pend.reject(e); this._pend = null; this._closed = true; this.ws?.close(); }
        else if (m.code === 'gone' || m.code === 'full') { this._closed = true; this.ws?.close(); }   // seat lost for good
        this.emit('error', m);
        return;
      case 'pong': this.clock.add(m.c, m.s, perf()); return;
    }
    this._recv(m);
  }

  _ping() { if (this.connected) this._raw({ t: 'ping', c: perf() }); }
  _raw(obj, pose = false) {
    const s = JSON.stringify(obj);
    const go = () => { if (this.ws && this.ws.readyState === 1) this.ws.send(s); };
    if (this.up.active) this.up.push(go, pose); else go();
  }

  sendPose(pose, flags = 0, energy = 0, move = null) {   // pose: flat array, any length up to 96, world units
    this._pump();
    const backed = this.ws && this.ws.bufferedAmount > BACKED_UP;
    const fr = this._poseFrame(pose, flags, energy, move, backed ? SLOW_SEND_MS : SEND_MS);
    if (fr && this.connected) this._raw(fr, true);
  }

  send(msg) {
    if (msg.t === 'move' && !fin(msg.ts)) msg = { ...msg, ts: this.now() };
    if (this.connected) this._raw(msg);
    else { this.queue.push(msg); if (this.queue.length > QUEUE_CAP) this.queue.shift(); }
  }

  close() {
    this._closed = true;
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    clearInterval(this._pingTimer);
    this.up.clear(); this.down.clear();
    const ws = this.ws;
    this.ws = null;
    const was = this.connected;
    this.connected = false;
    if (ws) ws.close(1000);
    if (was) this.emit('close', { code: 1000, reconnecting: false });
  }
}


// ---------- LocalNet: same-screen and partner-bot play, rules in the page ----------
/*
  new LocalNet({ stage = 'void', world = null, partner = null, lag, jitter, loss, poseScale })
    The local player is seat 0 (fire). LocalNet acts as the server: it runs shared/rules.js, ticks at
    20 Hz, sends 'state' on change and at least once a second (4 Hz while a form drains or a fusion runs),
    and every message between the "server" and either seat goes through the conditioner, as with Net.
    Both seats count as present from connect(), so the session starts (intro) straight away.

  Partner contract (seat 1, water), optional:
    partner.attach(api)        called once from connect(). api:
      api.seat                 1
      api.now()                server time, ms (same clock as net.now())
      api.state                last 'state' the partner received
      api.send(msg)            any client message as seat 1 (move, xch, form, merge, fx, ready); for a
                               'move', id and ts are filled in when missing. Returns the message sent.
      api.on(type, fn)         the partner's own events, as a seat-1 client sees them: 'state', 'move'
                               (seat 0's moves, from: 0), 'no', 'xch', 'ev', 'fx', 'peer'. Returns an
                               unsubscribe function.
      api.peerPose(out)        copies seat 0's latest received pose (world units) into out;
                               -> { ok, flags, energy, move, n }  (n = seat 0's pose length)
    partner.pose(out)          called every frame (from the game's sendPose/remotePose, and by a 20 Hz
                               timer when the game is not calling). out is a Float64Array(96). Either
                               write the pose (world units) into out and return { flags, energy, move, n }
                               with n the number of components written (default: the length seat 0
                               sends, else 39), or return { pose, flags, energy, move } with pose an
                               array of any length up to 96. It is quantised and
                               sent at 20 Hz like a real client's pose and reaches seat 0 through the same
                               jitter buffer (net.remotePose).
    After 'over' the partner should api.send({ t:'ready' }) (or the game calls net.sendAs(1, { t:'ready' })).

  No partner (same-screen play): the game drives seat 1 itself with net.sendAs(1, msg). Messages for
  both seats arrive once through net.on(); messages meant for seat 1 only ('no' for its rejected moves,
  seat 0's 'move' relayed to it, 'fx' to it) also arrive through net.on(), with to: 1 added.
*/
export class LocalNet extends Base {
  constructor({ stage = 'void', world = null, partner = null, ...cond } = {}) {
    super(cond);
    this.stage = stage; this.world = world; this.partner = partner;
    this.pUp = new Link(this.cond); this.pDown = new Link(this.cond);
    this.pHandlers = {}; this.pState = null; this.pPeer = null;
    this.pPose = new Float64Array(MAX_POSE); this._myLen = 39;
    this._n = [0, 0]; this._timer = null; this._lastTick = -Infinity; this._lastState = -Infinity;
    this._pCall = -Infinity; this._pLastPose = -Infinity;
  }
  get rtt() { return this.cond.lag; }
  get jitter() { return this.buf.jitter; }
  now() { return performance.timeOrigin + perf(); }

  connect({ stage, world } = {}) {
    if (stage) this.stage = stage;
    if (world != null) this.world = world;
    const t = this.now();
    this.session = createSession(this.stage, t, this.world);
    this.stage = this.session.stage; this.world = this.session.world;
    Object.assign(this, { connected: true, seat: 0, room: 'LOCAL' });
    if (this.partner) this.partner.attach?.(this._partnerApi());
    setPresent(this.session, 0, true, t);
    this._evs(setPresent(this.session, 1, true, t));
    this._timer = setInterval(() => this._pump(true), SEND_MS);
    const info = { room: this.room, seat: 0, stage: this.stage, world: this.world };
    this._to(0, { t: 'peer', present: true });
    this._to(1, { t: 'peer', present: true });
    this._broadcastState();
    queueMicrotask(() => this.emit('open', info));
    return Promise.resolve(info);
  }

  _partnerApi() {
    const self = this;
    return {
      seat: 1,
      now: () => this.now(),
      get state() { return self.pState; },
      send: msg => this.sendAs(1, msg),
      on: (type, fn) => { (this.pHandlers[type] ||= []).push(fn); return () => { this.pHandlers[type] = this.pHandlers[type].filter(f => f !== fn); }; },
      peerPose: out => {
        const b = this.pPeer;
        if (!b) return { ok: false };
        const n = Math.min(b.p.length, out.length);
        for (let j = 0; j < n; j++) out[j] = (b.p[j] || 0) / this.poseScale;
        return { ok: true, flags: b.f, energy: b.e, move: b.m || null, n: b.p.length };
      },
    };
  }

  // Send as either seat; sendAs(0, msg) is send(msg). A 'move' without id/ts gets them filled in.
  sendAs(seat, msg) {
    if (!this.connected) return null;
    if (msg.t === 'move') msg = { ...msg, id: msg.id || seat + '-L' + ++this._n[seat], ts: fin(msg.ts) ? msg.ts : this.now() };
    (seat === 0 ? this.up : this.pUp).push(() => this._server(seat, msg), msg.t === 'pose');
    return msg;
  }
  send(msg) { return this.sendAs(0, msg); }

  // ---- "server" side ----
  _server(seat, msg) {
    if (!this.session) return;
    if (msg.t === 'pose') return this._to(1 - seat, msg);
    for (const [to, m] of route(this.session, seat, msg, this.now()).out) this._to(to, m);
    if (this.session.changed) this._broadcastState();
  }
  _evs(events) { for (const e of events) this._to('all', { t: 'ev', ...e }); }
  _to(to, msg) {
    const pose = msg.t === 'pose';
    if (to === 0 || to === 'all') this.down.push(() => this._recv(msg), pose);
    if (to === 1 || to === 'all') {
      if (this.partner) this.pDown.push(() => this._partnerRecv(msg), pose);
      else if (to === 1 && !pose) this.down.push(() => this._recv({ ...msg, to: 1 }));
    }
  }
  _partnerRecv(msg) {
    if (msg.t === 'pose') { this.pPeer = msg; return; }
    if (msg.t === 'state') this.pState = msg;
    for (const fn of this.pHandlers[msg.t] || []) { try { fn(msg); } catch (e) { console.error('partner handler', msg.t, e); } }
  }
  _broadcastState() {
    this._lastState = this.now();
    this.session.changed = false;
    this._to('all', { t: 'state', ...publicState(this.session) });
  }

  _pump(fromTimer = false) {
    for (const l of [this.up, this.down, this.pUp, this.pDown]) l.drain();
    const s = this.session;
    if (!s) return;
    const t = this.now();
    if (t - this._lastTick >= SEND_MS) {
      this._lastTick = t;
      this._evs(tick(s, t));
      const every = s.form.some(Boolean) || s.phase === 'fusion' ? 250 : 1000;
      if (s.changed || t - this._lastState >= every) this._broadcastState();
    }
    // partner pose: every frame while the game is calling us, else from the 20 Hz timer
    if (this.partner?.pose && (fromTimer ? t - this._pCall >= 2 * SEND_MS : t - this._pCall >= 8)) {
      this._pCall = t;
      const r = this.partner.pose(this.pPose) || {};
      const pose = r.pose || this.pPose.subarray(0, clamp(r.n ?? this._myLen, 1, MAX_POSE));
      const saved = this._lastPose;
      this._lastPose = this._pLastPose;
      const fr = this._poseFrame(pose, r.flags ?? 0, r.energy ?? 0, r.move ?? null, SEND_MS);
      this._pLastPose = this._lastPose; this._lastPose = saved;
      if (fr) this.pUp.push(() => this._server(1, fr), true);
    }
  }

  sendPose(pose, flags = 0, energy = 0, move = null) {
    this._myLen = Math.min(pose.length, MAX_POSE);
    this._pump();
    const fr = this._poseFrame(pose, flags, energy, move, SEND_MS);
    if (fr && this.connected) this.up.push(() => this._server(0, fr), true);
  }

  close() {
    clearInterval(this._timer); this._timer = null;
    for (const l of [this.up, this.down, this.pUp, this.pDown]) l.clear();
    const was = this.connected;
    this.connected = false; this.session = null;
    if (was) this.emit('close', { code: 1000, reconnecting: false });
  }
}

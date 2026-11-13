// A dancer that travels on motion matching (from Gem Dancers' Lead mode, play/mover.ts, without its UI). It goes
// where it's asked (goalX, goalZ, face) by finding, a few times a second, the move in its repertoire that goes
// there from where its body is (moves.ts), and easing into it: a transition leaves an offset on every joint that dies
// away on a spring (inertialisation), so nothing pops. The move's own travel carries it across the floor, nudged
// toward where it was asked to be (a spring "lead" it follows, after Holden). On top of the dance: it leans into its
// turns, looks at whatever interests it, reaches for the pointer when it comes close, and can be picked up, carried
// through the water and thrown. `update(dt, out)` poses a Skeleton (skeleton/rig.ts) like any controller does; a
// controller (dancer/wander.ts, later the brains) sets what it's asked each frame.
import { quat, vec3, type Quat, type Vec3 } from 'math';
import { MAXJ, type Rig, type Skeleton } from '../rig';
import { Moves, NF, AHEAD, TAIL, legOf, type Clip } from './moves';

/** how often it looks for a better move (s, dance time), and how long after a change it waits before another */
const SEARCH_EVERY = 0.12;
const DWELL = 0.3;
/** halflife of a transition's offsets (s) */
const BLEND = 0.12;
const LN2 = Math.log(2);
const damping = (halflife: number) => (4 * LN2) / (halflife + 1e-5);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// scratch (pmndrs/math, allocated once; movers update one after another)
const _mover_pos: Vec3[] = Array.from({ length: MAXJ }, () => vec3.create());
const _mover_rot: Quat[] = Array.from({ length: MAXJ }, () => quat.create());
const _mover_q = new Float32Array(MAXJ * 4);
const _mover_q2 = new Float32Array(MAXJ * 4);
const _mover_h: Vec3 = vec3.create();
const _mover_h2: Vec3 = vec3.create();
const _mover_a: Quat = quat.create();
const _mover_b: Quat = quat.create();
const _mover_c: Quat = quat.create();
const _mover_v: Vec3 = vec3.create();
const _mover_w: Vec3 = vec3.create();
const _mover_u: Vec3 = vec3.create();
const _mover_t: Vec3 = vec3.create();
const _mover_pivot: Vec3 = vec3.create();
const _mover_arm: Vec3 = vec3.create();
const _mover_goal: Vec3 = vec3.create();
const _mover_foot: Quat = quat.create();
const _mover_tilt: Quat = quat.create();
const _mover_query = new Float32Array(NF);
const _mover_found = { row: 0, cost: 0 };
const _mover_recentCost = new Float32Array(6);
/** what a move near one made in the last few seconds costs extra (it fades over about three) */
const NOVELTY = 1.5;
const _mover_ahead = new Float32Array(AHEAD.length * 3);
const _mover_up: Vec3 = [0, 1, 0];
const _mover_down: Vec3 = [0, -1, 0];
const _mover_ahead3: Vec3 = vec3.create();
const _mover_fwd: Vec3 = [0, 0, 1];

/** a rotation as one vector: its axis times its angle (the shorter way round) */
function toScaled(out: Float32Array | Vec3, o: number, q: ArrayLike<number>, qo: number) {
  let x = q[qo], y = q[qo + 1], z = q[qo + 2], w = q[qo + 3];
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  const k = s < 1e-8 ? 2 : (2 * Math.atan2(s, w)) / s;
  out[o] = x * k; out[o + 1] = y * k; out[o + 2] = z * k;
}
/** and back */
function fromScaled(out: Quat, v: ArrayLike<number>, o: number) {
  const x = v[o], y = v[o + 1], z = v[o + 2], a = Math.hypot(x, y, z);
  if (a < 1e-8) return quat.set(out, x * 0.5, y * 0.5, z * 0.5, 1);
  const s = Math.sin(a / 2) / a;
  return quat.set(out, x * s, y * s, z * s, Math.cos(a / 2));
}
/** q[o] = a[ao] · b[bo]⁻¹ (unit quaternions in flat arrays) */
function mulInv(out: Quat, a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) {
  quat.set(_mover_c, -b[bo], -b[bo + 1], -b[bo + 2], b[bo + 3]);
  quat.set(_mover_b, a[ao], a[ao + 1], a[ao + 2], a[ao + 3]);
  return quat.multiply(out, _mover_b, _mover_c);
}
/** a spring that takes x (and its velocity v) to zero: Holden's decay_spring_damper_exact, critically damped */
function decay(x: Float32Array | Vec3, v: Float32Array | Vec3, o: number, halflife: number, dt: number) {
  const y = damping(halflife) / 2, e = Math.exp(-y * dt);
  for (let k = o; k < o + 3; k++) {
    const j1 = v[k] + x[k] * y;
    x[k] = e * (x[k] + j1 * dt);
    v[k] = e * (v[k] - j1 * y * dt);
  }
}

export type Mode = 'dance' | 'held' | 'flying';
/** the spring lead: position, velocity and acceleration on the floor; facing and how fast it turns; a spin's angle */
interface Lead { x: number; z: number; vx: number; vz: number; ax: number; az: number; yaw: number; w: number; spun: number }

export class Mover {
  readonly rig: Rig;
  readonly leg: number;
  /** the dance's root on the floor: where it stands and which way it faces */
  x = 0;
  z = 0;
  yaw = 0;
  /** how high the whole body is off the floor (carried or thrown) */
  lift = 0;

  // ---- what it's asked (set every frame by the troupe)
  /** where to go, how close is there, how fast it may travel (m/s, dance time) */
  goalX = 0;
  goalZ = 0;
  arrive = 0.3;
  maxSpeed = 0.85;
  /** which way to face once there; how much to face the way it travels while travelling (0 … 1) */
  face = 0;
  faceTravel = 0.8;
  /** turn on the spot (rad/s): a pirouette asked for */
  spin = 0;
  /** how lively, 0 … 1 */
  energy = 0.3;
  /** which repertoires it draws on (bits of STYLES) */
  mask = 0xffff;
  /** something to look at (and how much), something to reach for (and how much) */
  readonly lookAt: Vec3 = vec3.create();
  look = 0;
  readonly reachFor: Vec3 = vec3.create();
  reach = 0;
  /** how far it leans into a turn (rad per m/s²) */
  leanBy = 0.07;
  /** thrown, it keeps within this far of the middle (m): it bounces off the edge of the stage */
  bound = 6;
  /** keep planted feet where they're put */
  plants = true;

  // ---- what it's doing
  mode: Mode = 'dance';
  clip = 0;
  frame = 0;
  /** clip frames per second of dance time (30: as captured) */
  rate = 30;
  /** the move it last chose, and when; how many changes so far; the last search's best cost and the playing move's */
  lastChange = 0;
  changes = 0;
  bestCost = 0;
  nowCost = 0;
  private recent = new Int32Array(6).fill(-1);
  private recentAt = new Float32Array(6);

  // the lead it follows: Holden's spring character (position, velocity, acceleration on the floor; facing, its rate)
  sx = 0; sz = 0; svx = 0; svz = 0; sax = 0; saz = 0; syaw = 0; sw = 0;
  /** carried: where the chest is pulled to; flying: the body's velocity and its tumble */
  readonly holdAt: Vec3 = vec3.create();
  readonly vel: Vec3 = vec3.create();
  readonly tumble: Vec3 = vec3.create();
  private tumbleQ: Quat = quat.create();

  private moves: Moves;
  private sigma = 1;
  private clock = 0;
  private searchIn = 0;
  private nrot: number;
  private rotIx: Int8Array;
  private desc: number[][];
  private J: Record<string, number>;
  // the pose that went out last (local rotations; the hips in the dance's frame) and how fast it was changing
  private outQ = new Float32Array(MAXJ * 4);
  private outW = new Float32Array(MAXJ * 3);
  private outH: Vec3 = vec3.create();
  private outHV: Vec3 = vec3.create();
  // a transition's offsets, dying away
  private offX = new Float32Array(MAXJ * 3);
  private offV = new Float32Array(MAXJ * 3);
  private offH: Vec3 = vec3.create();
  private offHV: Vec3 = vec3.create();
  // planted feet: whether each is held where it landed, where, and how much (easing in and out)
  private planted = [false, false];
  private plantAt: Vec3[] = [vec3.create(), vec3.create()];
  private plantHold = new Float32Array(2);
  private animSpeed = 0;
  private animTurn = 0;

  constructor(moves: Moves, rig: Rig, startClip = 0, startFrame = 0) {
    this.moves = moves;
    this.rig = rig;
    this.leg = legOf(rig);
    this.J = moves.J;
    const joints = rig.joints;
    this.nrot = joints.filter((j) => j.rotates).length;
    this.rotIx = new Int8Array(joints.length);
    let r = 0;
    joints.forEach((j, k) => { this.rotIx[k] = j.rotates ? r++ : -1; });
    // each joint and everything hanging from it
    this.desc = joints.map(() => [] as number[]);
    for (let k = joints.length - 1; k >= 0; k--) {
      this.desc[k].unshift(k);
      const p = joints[k].parent;
      if (p >= 0) this.desc[p].push(...this.desc[k]);
    }
    this.play(startClip, startFrame, false);
  }

  /** stand somewhere at once (no travel between) */
  place(x: number, z: number, yaw: number) {
    this.x = this.sx = this.goalX = x;
    this.z = this.sz = this.goalZ = z;
    this.yaw = this.syaw = this.face = yaw;
    this.svx = this.svz = this.sax = this.saz = this.sw = 0;
  }

  /** how fast the dance carries it (m/s), and turns it (rad/s) */
  get speed() { return this.animSpeed; }
  get turning() { return this.animTurn; }
  get clipKey() { return this.moves.clips[this.clip].key; }

  /** the simulated lead: a velocity and a facing springing toward the ones wanted, a step at a time */
  private wantVel(px: number, pz: number, out: Vec3) {
    const dx = this.goalX - px, dz = this.goalZ - pz, d = Math.hypot(dx, dz);
    const s = d < 1e-4 ? 0 : (this.maxSpeed * smooth(this.arrive, this.arrive + 0.9, d)) / d;
    return vec3.set(out, dx * s, 0, dz * s);
  }
  private wantYaw(vx: number, vz: number, spun: number) {
    if (this.spin !== 0) return spun;
    const s = Math.hypot(vx, vz);
    if (s < 1e-3) return this.face;
    const w = this.faceTravel * smooth(0.15, 0.5, s);
    return this.face + wrap(Math.atan2(vx, vz) - this.face) * w;
  }
  private stepLead(dt: number, s: Lead) {
    const want = this.wantVel(s.x, s.z, _mover_v), wx = want[0], wz = want[2];
    // (Holden's simulation_positions_update: velocity springs to the one wanted, position follows exactly)
    const y = damping(0.3) / 2, e = Math.exp(-y * dt), yy = y * y;
    let j0 = s.vx - wx, j1 = s.ax + j0 * y;
    s.x = e * (-j1 / yy + (-j0 - j1 * dt) / y) + j1 / yy + j0 / y + wx * dt + s.x;
    s.vx = e * (j0 + j1 * dt) + wx;
    s.ax = e * (s.ax - j1 * y * dt);
    j0 = s.vz - wz; j1 = s.az + j0 * y;
    s.z = e * (-j1 / yy + (-j0 - j1 * dt) / y) + j1 / yy + j0 / y + wz * dt + s.z;
    s.vz = e * (j0 + j1 * dt) + wz;
    s.az = e * (s.az - j1 * y * dt);
    s.spun += this.spin * dt;
    const goal = this.wantYaw(wx, wz, s.spun);
    const yr = damping(this.spin !== 0 ? 0.12 : 0.22) / 2, er = Math.exp(-yr * dt);
    j0 = wrap(s.yaw - goal); j1 = s.w + j0 * yr;
    s.yaw = goal + er * (j0 + j1 * dt);
    s.w = er * (s.w - j1 * yr * dt);
  }
  private lead: Lead = { x: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0, yaw: 0, w: 0, spun: 0 };
  private ghost: Lead = { x: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0, yaw: 0, w: 0, spun: 0 };

  // ---------------------------------------------------------------- the clip
  /** the clip's pose at a (fractional) frame: local rotations (the root's relative to the way the dance faces) and
   *  the hips in the dance's frame (m, this body's size) */
  private sample(c: Clip, frame: number, q: Float32Array, h: Vec3) {
    const n = c.frames, W = 3 + 4 * c.nrot, P = c.path, A = c.pose;
    const x = Math.max(0, Math.min(n - 1.001, frame)), f = Math.floor(x), u = x - f;
    const a = f * W, b = a + W;
    const px = P[f * 3] + (P[f * 3 + 3] - P[f * 3]) * u, pz = P[f * 3 + 1] + (P[f * 3 + 4] - P[f * 3 + 1]) * u;
    const yaw = P[f * 3 + 2] + (P[f * 3 + 5] - P[f * 3 + 2]) * u;
    const rx = A[a] + (A[b] - A[a]) * u - px, ry = A[a + 1] + (A[b + 1] - A[a + 1]) * u, rz = A[a + 2] + (A[b + 2] - A[a + 2]) * u - pz;
    const cs = Math.cos(yaw), sn = Math.sin(yaw), s = this.sigma;
    vec3.set(h, (rx * cs - rz * sn) * s, ry * s, (rx * sn + rz * cs) * s);
    for (let r = 0; r < c.nrot; r++) {
      const i = a + 3 + r * 4, j = b + 3 + r * 4;
      const sgn = A[i] * A[j] + A[i + 1] * A[j + 1] + A[i + 2] * A[j + 2] + A[i + 3] * A[j + 3] < 0 ? -1 : 1;
      let l = 0;
      for (let k = 0; k < 4; k++) { const v = A[i + k] + (A[j + k] * sgn - A[i + k]) * u; q[r * 4 + k] = v; l += v * v; }
      l = 1 / Math.sqrt(l);
      for (let k = 0; k < 4; k++) q[r * 4 + k] *= l;
    }
    // the root, turned out of the dance's facing
    quat.setAxisAngle(_mover_a, _mover_up, -yaw);
    quat.fromBuffer(_mover_b, q, 0);
    quat.toBuffer(q, quat.multiply(_mover_b, _mover_a, _mover_b), 0);
  }

  /** start a clip at a frame; with `blend`, the pose eases from wherever it was */
  play(clip: number, frame: number, blend = true) {
    const c = this.moves.clips[clip];
    this.sigma = this.leg / c.leg;
    if (blend) {
      // where the new move starts and how it's moving there…
      const step = 1, perSec = this.rate / step;
      this.clip = clip;
      this.sample(c, frame, _mover_q, _mover_h);
      this.sample(c, frame + step, _mover_q2, _mover_h2);
      for (let r = 0; r < this.nrot; r++) {
        // …and the offset from it to the pose that went out last, which the spring then takes away
        toScaled(this.offX, r * 3, mulInv(_mover_a, this.outQ, r * 4, _mover_q, r * 4), 0);
        toScaled(_mover_w, 0, mulInv(_mover_a, _mover_q2, r * 4, _mover_q, r * 4), 0);
        for (let k = 0; k < 3; k++) this.offV[r * 3 + k] = this.outW[r * 3 + k] - _mover_w[k] * perSec;
      }
      for (let k = 0; k < 3; k++) {
        this.offH[k] = this.outH[k] - _mover_h[k];
        this.offHV[k] = this.outHV[k] - (_mover_h2[k] - _mover_h[k]) * perSec;
      }
    } else {
      this.offX.fill(0); this.offV.fill(0); vec3.zero(this.offH); vec3.zero(this.offHV);
      this.sample(c, frame, this.outQ, this.outH);
      this.outW.fill(0); vec3.zero(this.outHV);
    }
    this.clip = clip;
    this.frame = frame;
    this.lastChange = this.clock;
    this.changes++;
    // remembered for a while, so it doesn't come straight back here
    const k = this.changes % this.recent.length;
    this.recent[k] = this.moves.clips[clip].row + Math.round(frame);
    this.recentAt[k] = this.clock;
  }

  /** look for the move that best goes where it's asked from where it is; change to it if it's clearly better */
  private match(force: boolean) {
    const M = this.moves, c = M.clips[this.clip], q = _mover_query, F = Moves.F;
    const row = M.row(this.clip, this.frame);
    // the body now: the feet, how they move, the hips (as the database has them for the frame playing)
    for (let d = 0; d < F.TRAJ; d++) q[d] = M.feat[row * NF + d];
    // where the lead goes over the next second, in the dance's frame and in legs
    const g = this.ghost;
    Object.assign(g, this.lead);
    let t = 0, k = 0;
    const step = 1 / 30;
    while (k < AHEAD.length) {
      const until = AHEAD[k] / this.rate;
      while (t + 1e-6 < until) { const h = Math.min(step, until - t); this.stepLead(h, g); t += h; }
      _mover_ahead[k * 3] = g.x; _mover_ahead[k * 3 + 1] = g.z; _mover_ahead[k * 3 + 2] = g.yaw;
      k++;
    }
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw), inv = 1 / this.leg;
    for (let a = 0; a < AHEAD.length; a++) {
      const x = _mover_ahead[a * 3] - this.x, z = _mover_ahead[a * 3 + 1] - this.z, turn = _mover_ahead[a * 3 + 2] - this.yaw;
      M.normalise(q, F.TRAJ + a * 2, (x * cs - z * sn) * inv);
      M.normalise(q, F.TRAJ + a * 2 + 1, (x * sn + z * cs) * inv);
      M.normalise(q, F.DIR + a * 2, Math.sin(turn));
      M.normalise(q, F.DIR + a * 2 + 1, Math.cos(turn));
    }
    M.normalise(q, F.ENERGY, M.calm + (M.lively - M.calm) * this.energy);
    for (let k = 0; k < this.recent.length; k++) _mover_recentCost[k] = NOVELTY * Math.exp(-(this.clock - this.recentAt[k]) / 3);
    const found = M.search(q, this.mask, this.clip, this.recent, _mover_recentCost, _mover_found);
    if (found.row < 0) return;
    this.bestCost = found.cost;
    this.nowCost = M.cost(q, Math.min(row + 1, c.row + c.frames - 1));
    const clip = M.rowClip[found.row], frame = found.row - M.clips[clip].row;
    const ending = this.frame > c.frames - TAIL;
    // the move playing now carries on unless another is clearly better (or this one's ending)
    if (!ending && clip === this.clip && Math.abs(frame - this.frame) < 12) return;
    if (!force && !ending && (found.cost > this.nowCost * 0.82 - 0.05 || this.clock - this.lastChange < DWELL)) return;
    this.play(clip, frame);
  }

  /** ask for a better move at the next frame */
  rethink() { this.searchIn = 0; }

  // ---------------------------------------------------------------- the frame
  /** pose `out` (its pos and rot; the caller commits it) after `dt` seconds of dance time; allocation-free */
  update(dt: number, out: Skeleton) {
    if (dt <= 0) { this.write(out); return; }
    dt = Math.min(dt, 1 / 20);
    this.clock += dt;
    const M = this.moves;
    let c = M.clips[this.clip];

    // the lead springs toward what's asked (carried or flying, it's wherever the body is)
    const L = this.lead;
    L.x = this.sx; L.z = this.sz; L.vx = this.svx; L.vz = this.svz; L.ax = this.sax; L.az = this.saz; L.yaw = this.syaw; L.w = this.sw;
    if (this.spin === 0) L.spun = this.syaw;
    if (this.mode === 'dance') this.stepLead(dt, L);
    this.sx = L.x; this.sz = L.z; this.svx = L.vx; this.svz = L.vz; this.sax = L.ax; this.saz = L.az; this.syaw = L.yaw; this.sw = L.w;
    this.searchIn -= dt;
    if (this.searchIn <= 0 || this.frame > c.frames - TAIL) {
      this.match(this.frame > c.frames - 4);
      this.searchIn = SEARCH_EVERY;
      c = M.clips[this.clip];
    }

    // the clip moves on, and carries the body with it
    const f0 = this.frame, f1 = Math.min(c.frames - 1.001, f0 + dt * this.rate);
    this.frame = f1;
    const P = c.path;
    const i0 = Math.floor(f0), u0 = f0 - i0, i1 = Math.floor(f1), u1 = f1 - i1;
    const p = (i: number, u: number, a: number) => P[i * 3 + a] + (P[Math.min(i + 1, c.frames - 1) * 3 + a] - P[i * 3 + a]) * u;
    const dx = p(i1, u1, 0) - p(i0, u0, 0), dz = p(i1, u1, 1) - p(i0, u0, 1), psi = p(i0, u0, 2), dpsi = p(i1, u1, 2) - psi;
    const lc = Math.cos(psi), ls = Math.sin(psi), s = this.sigma;
    const along = (dx * lc - dz * ls) * s, ahead = (dx * ls + dz * lc) * s;
    this.animSpeed += (Math.hypot(along, ahead) / dt - this.animSpeed) * Math.min(1, dt * 8);
    this.animTurn += (dpsi / dt - this.animTurn) * Math.min(1, dt * 8);
    if (this.mode === 'dance') {
      const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      this.x += along * cs + ahead * sn;
      this.z += -along * sn + ahead * cs;
      this.yaw += dpsi;
      this.adjust(dt);
    }

    // the pose: the clip's, plus whatever a transition left, dying away
    this.sample(c, this.frame, _mover_q, _mover_h);
    for (let r = 0; r < this.nrot; r++) {
      decay(this.offX, this.offV, r * 3, BLEND, dt);
      fromScaled(_mover_a, this.offX, r * 3);
      quat.fromBuffer(_mover_b, _mover_q, r * 4);
      quat.multiply(_mover_a, _mover_a, _mover_b);
      // how fast each joint turns (for the next transition)
      quat.set(_mover_c, -this.outQ[r * 4], -this.outQ[r * 4 + 1], -this.outQ[r * 4 + 2], this.outQ[r * 4 + 3]);
      quat.multiply(_mover_c, _mover_a, _mover_c);
      toScaled(this.outW, r * 3, _mover_c, 0);
      for (let k = 0; k < 3; k++) this.outW[r * 3 + k] /= dt;
      quat.toBuffer(this.outQ, _mover_a, r * 4);
    }
    decay(this.offH, this.offHV, 0, BLEND, dt);
    for (let k = 0; k < 3; k++) {
      const h = _mover_h[k] + this.offH[k];
      this.outHV[k] = (h - this.outH[k]) / dt;
      this.outH[k] = h;
    }
    if (this.mode !== 'dance') this.airborne(dt);
    this.fk();
    this.layers(dt);
    this.write(out);
  }

  /** the dance's body is pulled toward the lead, gently and mostly while it moves anyway (so the feet barely slide);
   *  and the lead is never let get far ahead of the body */
  private adjust(dt: number) {
    const ex = this.sx - this.x, ez = this.sz - this.z, e = Math.hypot(ex, ez);
    if (e > 1e-5) {
      const want = e * (1 - Math.exp(-dt * (LN2 / 0.18)));
      const cap = (this.animSpeed * 0.6 + 0.12) * dt;
      const k = Math.min(want, cap) / e;
      this.x += ex * k; this.z += ez * k;
    }
    const ey = wrap(this.syaw - this.yaw);
    const wantY = ey * (1 - Math.exp(-dt * (LN2 / 0.15)));
    const capY = (Math.abs(this.animTurn) * 0.6 + 0.9) * dt;
    this.yaw += Math.max(-capY, Math.min(capY, wantY));
    // the lead stays within reach of the body
    const fx = this.sx - this.x, fz = this.sz - this.z, f = Math.hypot(fx, fz), R = 0.3;
    if (f > R) { this.sx = this.x + (fx / f) * R; this.sz = this.z + (fz / f) * R; }
    const fy = wrap(this.syaw - this.yaw), RY = 0.9;
    if (Math.abs(fy) > RY) this.syaw = this.yaw + Math.sign(fy) * RY;
  }

  // ---------------------------------------------------------------- carried and thrown
  /** pick it up (it hangs from its chest, which follows `holdAt`) */
  hold() {
    if (this.mode === 'dance') vec3.zero(this.vel);
    this.mode = 'held';
  }
  /** let it go with a velocity (m/s, dance time) */
  throw(vx: number, vy: number, vz: number) {
    this.mode = 'flying';
    vec3.set(this.vel, vx, vy, vz);
    // it tumbles about the axis across its flight, faster the harder it's thrown
    const s = Math.hypot(vx, vz);
    vec3.set(this.tumble, s > 1e-3 ? vz / s : 0, 0, s > 1e-3 ? -vx / s : 0);
    vec3.scale(this.tumble, this.tumble, Math.min(9, Math.hypot(vx, vy, vz) * 1.6));
  }
  /** landed: how hard (m/s down) and where (called once) */
  onLand: ((speed: number, x: number, z: number) => void) | null = null;

  private airborne(dt: number) {
    const v = this.vel;
    if (this.mode === 'held') {
      // a spring to the hand that holds it: the chest (about 0.45 legs above the hips) goes where it's held
      const chest = this.outH[1] + this.leg * 0.55;
      const tx = this.holdAt[0], ty = this.holdAt[1] - chest, tz = this.holdAt[2];
      const k = 120, c = 2 * Math.sqrt(k) * 0.75;
      v[0] += ((tx - this.x) * k - v[0] * c) * dt;
      v[1] += ((ty - this.lift) * k - v[1] * c) * dt;
      v[2] += ((tz - this.z) * k - v[2] * c) * dt;
      this.x += v[0] * dt; this.lift += v[1] * dt; this.z += v[2] * dt;
      this.lift = Math.max(this.lift, 0);
      // it turns slowly to face the way it's carried, and settles upright
      vec3.scale(this.tumble, this.tumble, Math.exp(-dt * 4));
    } else {
      // falling through water: a little gravity (it's nearly as light as the water), a lot of drag
      v[1] -= 4.2 * dt;
      const drag = Math.exp(-dt * 0.9);
      vec3.scale(v, v, drag);
      this.x += v[0] * dt; this.lift += v[1] * dt; this.z += v[2] * dt;
      const r = Math.hypot(this.x, this.z);
      if (r > this.bound) {
        const nx = this.x / r, nz = this.z / r, out = v[0] * nx + v[2] * nz;
        this.x = nx * this.bound; this.z = nz * this.bound;
        if (out > 0) { v[0] -= 1.6 * out * nx; v[2] -= 1.6 * out * nz; }
      }
      // the tumble slows, and near the floor it rights itself
      vec3.scale(this.tumble, this.tumble, Math.exp(-dt * (this.lift < 0.9 ? 6 : 0.8)));
      if (this.lift <= 0 && v[1] <= 0) {
        this.lift = 0;
        const hit = -v[1];
        this.mode = 'dance';
        this.place(this.x, this.z, this.yaw);
        this.svx = v[0] * 0.3; this.svz = v[2] * 0.3;
        this.onLand?.(hit + Math.hypot(v[0], v[2]) * 0.3, this.x, this.z);
        vec3.zero(v);
        this.rethink();
      }
    }
    // the tumble turns the body about its middle; uprighting brings it back
    const a = vec3.length(this.tumble) * dt;
    if (a > 1e-6) {
      quat.setAxisAngle(_mover_tilt, vec3.normalize(_mover_u, this.tumble), a);
      quat.multiply(this.tumbleQ, _mover_tilt, this.tumbleQ);
    }
    const right = this.mode === 'held' ? 2.5 : this.lift < 0.9 ? 5 : 0.4;
    quat.slerp(this.tumbleQ, this.tumbleQ, quat.identity(_mover_tilt), Math.min(1, dt * right));
    this.sx = this.x; this.sz = this.z; this.syaw = this.yaw;
  }

  // ---------------------------------------------------------------- forward kinematics and the layers on top
  private fk() {
    const joints = this.rig.joints, n = Math.min(joints.length, MAXJ);
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw), h = this.outH;
    quat.setAxisAngle(_mover_a, _mover_up, this.yaw);
    for (let k = 0; k < n; k++) {
      const j = joints[k], pos = _mover_pos[k], rot = _mover_rot[k], r = this.rotIx[k];
      if (r >= 0) quat.fromBuffer(_mover_b, this.outQ, r * 4);
      else quat.identity(_mover_b);
      if (j.parent < 0) {
        vec3.set(pos, this.x + h[0] * cs + h[2] * sn, h[1] + this.lift, this.z - h[0] * sn + h[2] * cs);
        quat.multiply(rot, _mover_a, _mover_b);
      } else {
        vec3.transformQuat(_mover_v, j.offset as unknown as Vec3, _mover_rot[j.parent]);
        vec3.add(pos, _mover_pos[j.parent], _mover_v);
        quat.multiply(rot, _mover_rot[j.parent], _mover_b);
      }
    }
  }

  /** turn joint k and everything hanging from it by q about `pivot` */
  private turn(k: number, q: Quat, pivot: Vec3) {
    const d = this.desc[k];
    for (let n = 0; n < d.length; n++) {
      const p = _mover_pos[d[n]];
      vec3.subtract(_mover_arm, p, pivot);
      vec3.transformQuat(_mover_arm, _mover_arm, q);
      vec3.add(p, pivot, _mover_arm);
      quat.multiply(_mover_rot[d[n]], q, _mover_rot[d[n]]);
    }
  }

  private layers(dt: number) {
    const J = this.J;
    // carried or thrown: the tumble, about the chest
    if (this.mode !== 'dance' || quat.getAngle(this.tumbleQ, quat.identity(_mover_tilt)) > 1e-3) {
      vec3.copy(_mover_pivot, _mover_pos[J.Spine1]);
      this.turn(0, this.tumbleQ, _mover_pivot);
    }
    // leaning into its turns (and, carried, trailing in the water): the body tips toward its acceleration, from the
    // floor (from the chest when it's held, so the legs swing behind)
    const held = this.mode === 'held';
    const ax = held ? this.vel[0] : this.sax, az = held ? this.vel[2] : this.saz;
    const by = held ? 0.12 : this.leanBy;
    vec3.set(_mover_u, ax * by, 1, az * by);
    const tip = Math.hypot(_mover_u[0], _mover_u[2]), most = held ? 0.8 : 0.28;
    if (tip > most) { _mover_u[0] *= most / tip; _mover_u[2] *= most / tip; }
    vec3.normalize(_mover_u, _mover_u);
    if (tip > 1e-4) {
      quat.rotationTo(_mover_tilt, _mover_up, _mover_u);
      if (held) vec3.copy(_mover_pivot, _mover_pos[J.Spine1]);
      else vec3.set(_mover_pivot, this.x, 0, this.z);
      this.turn(0, _mover_tilt, _mover_pivot);
    }
    // looking: the head (and half as much the neck) turns toward something, within what a neck can do
    if (this.look > 0.01) {
      const head = J.Head;
      vec3.transformQuat(_mover_v, _mover_fwd, _mover_rot[head]);
      vec3.subtract(_mover_w, this.lookAt, _mover_pos[head]);
      const d = vec3.length(_mover_w);
      if (d > 0.05) {
        vec3.scale(_mover_w, _mover_w, 1 / d);
        quat.rotationTo(_mover_tilt, _mover_v, _mover_w);
        const angle = quat.getAngle(_mover_tilt, quat.identity(_mover_c));
        const most = 1.1, k = (Math.min(angle, most) / Math.max(angle, 1e-4)) * this.look;
        quat.slerp(_mover_tilt, _mover_c, _mover_tilt, k * 0.45);
        this.turn(J.Neck1, _mover_tilt, vec3.copy(_mover_pivot, _mover_pos[J.Neck1]));
        this.turn(head, _mover_tilt, vec3.copy(_mover_pivot, _mover_pos[head]));
      }
    }
    // reaching: the nearer hand goes toward something (two bones, the elbow bending the way it already does)
    if (this.reach > 0.01) {
      const left = vec3.squaredDistance(_mover_pos[J.LeftHand], this.reachFor) < vec3.squaredDistance(_mover_pos[J.RightHand], this.reachFor);
      const hand = left ? J.LeftHand : J.RightHand;
      vec3.lerp(_mover_goal, _mover_pos[hand], this.reachFor, this.reach);
      this.twoBone(left ? J.LeftArm : J.RightArm, left ? J.LeftForeArm : J.RightForeArm, hand, _mover_goal, _mover_down);
    }
    this.plant(dt);
  }

  /** a foot the dance puts down stays where it was put (the body's nudges toward the lead would slide it), until the
   *  dance lifts it or the body has gone too far from it; then it eases back to where the dance has it */
  private plant(dt: number) {
    const J = this.J, bits = this.plants && this.mode === 'dance' && this.lift < 0.01 ? this.moves.contact[this.moves.row(this.clip, this.frame)] : 0;
    for (let side = 0; side < 2; side++) {
      const ankle = side ? J.RightFoot : J.LeftFoot, A = _mover_pos[ankle], at = this.plantAt[side];
      const down = ((bits >> side) & 1) === 1;
      if (down && !this.planted[side]) {
        // planted where it is now (or, still easing off the last plant, where it's shown)
        const h = this.plantHold[side];
        vec3.set(at, A[0] + (at[0] - A[0]) * h, 0, A[2] + (at[2] - A[2]) * h);
        this.planted[side] = true;
      }
      if (this.planted[side] && (!down || Math.hypot(A[0] - at[0], A[2] - at[2]) > this.leg * 0.3)) this.planted[side] = false;
      const want = this.planted[side] ? 1 : 0;
      this.plantHold[side] += (want - this.plantHold[side]) * (1 - Math.exp(-dt / (want ? 0.03 : 0.07)));
      const h = this.plantHold[side];
      if (h < 1e-3) continue;
      // the leg reaches for it; the foot keeps the way the dance turns it
      vec3.set(_mover_goal, A[0] + (at[0] - A[0]) * h, A[1], A[2] + (at[2] - A[2]) * h);
      quat.copy(_mover_foot, _mover_rot[ankle]);
      this.twoBone(side ? J.RightUpLeg : J.LeftUpLeg, side ? J.RightLeg : J.LeftLeg, ankle, _mover_goal, vec3.set(_mover_ahead3, Math.sin(this.yaw), 0, Math.cos(this.yaw)));
      quat.invert(_mover_tilt, _mover_rot[ankle]);
      quat.multiply(_mover_tilt, _mover_foot, _mover_tilt);
      this.turn(ankle, _mover_tilt, vec3.copy(_mover_pivot, _mover_pos[ankle]));
    }
  }

  /** two bones a → b → c bent so that c reaches `goal` (as near as they can), the middle joint bending the way it does
   *  (or, held nearly straight, toward `bend`) */
  private twoBone(a: number, b: number, c: number, goal: Vec3, bend: Vec3) {
    const A = _mover_pos[a], B = _mover_pos[b], C = _mover_pos[c];
    const la = vec3.distance(A, B), lb = vec3.distance(B, C);
    vec3.copy(_mover_t, goal);
    vec3.subtract(_mover_v, _mover_t, A);
    const d = Math.max(1e-3, Math.min(vec3.length(_mover_v), (la + lb) * 0.985));
    vec3.normalize(_mover_v, _mover_v);
    // the elbow bends the way it bends now: its offset from the shoulder-to-target line
    vec3.subtract(_mover_w, B, A);
    vec3.scaleAndAdd(_mover_w, _mover_w, bend, la * 0.02);
    vec3.scaleAndAdd(_mover_w, _mover_w, _mover_v, -vec3.dot(_mover_w, _mover_v));
    if (vec3.length(_mover_w) < 1e-6) vec3.set(_mover_w, 0, -1, 0);
    vec3.normalize(_mover_w, _mover_w);
    const cosA = Math.max(-1, Math.min(1, (la * la + d * d - lb * lb) / (2 * la * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    // where the elbow goes; turn the upper arm onto it
    vec3.scale(_mover_u, _mover_v, la * cosA);
    vec3.scaleAndAdd(_mover_u, _mover_u, _mover_w, la * sinA);
    vec3.subtract(_mover_t, B, A);
    quat.rotationTo(_mover_tilt, vec3.normalize(_mover_t, _mover_t), vec3.normalize(_mover_w, _mover_u));
    vec3.copy(_mover_pivot, A);
    this.turn(a, _mover_tilt, _mover_pivot);
    // then the forearm onto the target
    vec3.scaleAndAdd(_mover_t, A, _mover_v, d);
    vec3.subtract(_mover_u, C, B);
    vec3.subtract(_mover_w, _mover_t, B);
    quat.rotationTo(_mover_tilt, vec3.normalize(_mover_u, _mover_u), vec3.normalize(_mover_w, _mover_w));
    vec3.copy(_mover_pivot, B);
    this.turn(b, _mover_tilt, _mover_pivot);
  }

  /** the posed joints out (the skeleton works out the velocities when it's committed) */
  private write(out: Skeleton) {
    const n = Math.min(this.rig.joints.length, MAXJ);
    for (let k = 0; k < n; k++) { vec3.copy(out.pos[k], _mover_pos[k]); quat.copy(out.rot[k], _mover_rot[k]); }
  }
}

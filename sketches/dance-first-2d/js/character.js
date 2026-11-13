// character.js — a dancer with a body in the world: root physics (locked 2-D plane or free 3-D), moves,
// the bending hand, camera limb override, combat geometry. Pure ES module, no DOM (runs in Node).
//
// WORLD: units as js/stages.js (y up, the 16:9 view is x in +-0.89, y in 0..1). 3-D: z toward the camera of
// the default locked view. Poses are Float32Array(39) = 13 joints x (x,y,z), joint order J (moves.js).
//
// const c = new Character({ seat = 0, stage, scale = 0.36, aimHand = 'R', plane = DEFAULT_PLANE })
//   c.plane        { origin:[x,y,z], right:[x,y,z] } locks movement to that vertical plane (the 2-D view);
//                  stage x is the coordinate along `right`. null = free 3-D movement on stage.heightAt(x, z)
//                  (if the stage has it) else flat ground at stage.ground (or the spawn height on a pit stage).
//                  Ledges collide only in the locked plane. Set it any time; the dancer is projected onto it.
//   c.env          { updraft 0..1, slick 0..1, carryX, blink } set by the game each frame (element perks).
//   c.lookAt       null | [x,y,z]: the partner. The dancer faces it when not running away from it.
//   c.inputYaw     free mode: yaw of the camera, so moveX/moveZ are camera-relative (0 = camera at +z).
//   c.bpm          optional: overrides the tempo estimated from successive beat values.
//   c.update(dt, intent, stage, beat)   beat = beat position (number) or { pos, bpm }.
//     writes c.pose (world, 39), c.vel (39, per-joint velocity), c.root [x,y,z], c.yaw, and pushes events
//     into c.events (the game drains it):
//       { type:'move', move, serial, perfect, offMs, x, y, z, dir, yaw, aim:[ax,ay], aim3, fdir:[fx,fz],
//         vx, vy, vz, air, bpm, hand, camera?, limb? }            when a move starts (all Character.shapesAt needs)
//       { type:'jump', x, y, z, air }   { type:'land', x, y, z, impact }   { type:'respawn', x, y, z }
//       { type:'step', x, y, z, foot:'L'|'R', wet }   { type:'blink', from:[x,y,z], to:[x,y,z] }
//   c.startMove(name | def, opts?) -> bool   start a move directly (bots, the dev viewer); opts { dir, aim:[ax,ay] }
//   c.hitShapes()   -> [{ ax,ay,az, bx,by,bz, r, move, id }]  dangerous capsules this frame (active window only)
//   c.hurtShapes()  -> body capsules.   c.standShape() -> where the standing body would be (for 'dodge').
//   c.invulnerable, c.dodging, c.blocking, c.blockAge (s), c.airborne, c.staggered, c.reforming, c.grounded
//   c.applyKnock(vx, vy, staggerSeconds [, vz])   knocked back (world velocity) and staggering.
//   c.setPoseFromCamera(pose, { hasLegs, pose3 })  the player's real body: pose = BodyTracker.pose (26, 2-D)
//                  and/or opts.pose3 = BodyTracker.pose3 (39, figure units, hip-centred, facing the viewer).
//                  Call every frame while tracking; it fades out 0.3 s after the last call.
//   c.serialize()  -> { p:number[26] (plane-projected, x1000), p3:number[39] (x1000), f, e, move:{ name, serial, t } | null }
//   c.flags        bits: 1 dodging, 2 airborne, 4 blocking, 8 facing left (-x along the plane), 16 staggered
//   c.pose2D(out26) the pose projected on the plane: x = coordinate along plane.right, y = y.
//   c.center()     -> [x,y,z] middle of the body.   c.spawn()  re-form at the seat's spawn now.
// Static / pure:
//   Character.shapesAt(moveEvent, tSeconds, scale = 0.36) -> hit capsules of a move from its start event alone
//   Character.shapesFromPose(pose39, limb, r, move, id)   capsule riding a limb ('LW','RW','LA','RA') of a pose
//   resolveExchange(attackerShapes, defender, opts?) -> 'hit'|'near'|'dodge'|'clash'|'parry'|null
//   foldExchange(prev, res) -> { res, final }: accumulate one move's per-frame results (see below)
//   capsuleDistance(a, b), configure({ PARRY_MS, PERFECT_MS }), PHYS, COMBAT, DEFAULT_PLANE
import { MOVES, LOCO, J, NJ, NP, BONE, tempoScale, travelAt, asMove, gingaSteps } from './moves.js';
import { ledgeY, tideY, VIEW } from './stages.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const sgn = x => (x < 0 ? -1 : 1);
const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// Tuning. Times in seconds, distances in world units (body about 0.26 tall), speeds per second.
export const PHYS = {
  scale: 0.36,          // figure units -> world units (the old figure was 2.8x larger)
  bodyH: 0.24,          // collision box height above the root (head top is ~0.25)
  halfW: 0.03,          // collision box half width
  runSpeed: 0.62,       // the 16:9 view (1.78 wide) in about 2.9 s: unhurried, a dancer not a sprinter
  groundAccel: 3.4,     // reaches full speed in ~0.18 s
  groundDecel: 4.5,     // stops in ~0.14 s
  turnAccel: 7,         // reversing direction is snappier than starting
  airAccel: 2.0, airDrag: 0.8,
  gravity: 3.4,         // with jumpV: apex 0.30 in 0.42 s (floaty); the log/bough/pillars are one jump,
  jumpV: 1.43,          //   the high bough / altar / crown need the air jump (0.30 + 0.23)
  airJumpV: 1.25,       // air jump apex 0.23
  fallMul: 1.18,        // a little heavier on the way down, still graceful
  cutMul: 2.6,          // jump released while rising: the short hop (~0.12)
  maxFall: 1.5, fastFall: 2.3, fastFallMul: 1.6,
  coyote: 0.09, jumpBuffer: 0.12, moveBuffer: 0.12,
  dropTime: 0.22,       // a one-way ledge is ignored this long after dropping through it
  landSquash: 0.16,
  ledgeMargin: 0.012,   // the root may hang this far past a ledge's end and still stand on it
  solidThick: 0.06,     // solid ledges are boxes this thick unless the ledge says `thick`
  walls: true, wallMargin: 0.04,
  updraftGravity: 0.25, updraftJump: 0.08, slickGrip: 0.75,   // full updraft: jump 0.30 -> ~0.46
  blinkDist: 0.22, blinkIframes: 0.16,
  slideK: 8,            // momentum carried into a ground move decays at this rate (deterministic)
  substep: 1 / 240,     // physics substep: frame-rate independent to within millimetres
  reformTime: 0.9,
  turnRate: 16,         // rad/s of visible body turn
  faceRunDelay: 0.22,   // moving away from the partner: back-step this long before turning to run
  tideSlow: 0.72,
  viewOpen: 0.45,       // locked view: the body turns this far (rad) toward the camera so it reads
  aimReach: 0.225,      // bending hand reach from the shoulder, figure units
  camHold: 0.3,
};
export const COMBAT = { PARRY_MS: 150, PERFECT_MS: 90, NEAR: 0.022 };
export function configure(r = {}) { if (r.PARRY_MS) COMBAT.PARRY_MS = r.PARRY_MS; if (r.PERFECT_MS) COMBAT.PERFECT_MS = r.PERFECT_MS; if (r.NEAR) COMBAT.NEAR = r.NEAR; }
export const DEFAULT_PLANE = Object.freeze({ origin: [0, 0, 0], right: [1, 0, 0] });

const UP = [0, 1, 0];
const normal = pl => [-pl.right[2], 0, pl.right[0]];   // toward the locked view's camera
const yawOf = (fx, fz) => Math.atan2(fx, fz);
const fwdOf = yaw => [Math.sin(yaw), Math.cos(yaw)];
const neutral = () => ({ moveX: 0, moveY: 0, moveZ: 0, jump: false, jumpHeld: false, punch: false, kick: false, spin: false, dodge: false, form: false, merge: false, aimX: 0, aimY: 0, aimActive: false });

// local (figure) -> world for one joint
function toWorld(out, local, root, yaw, scale) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let j = 0; j < NJ; j++) {
    const x = local[3 * j], y = local[3 * j + 1], z = local[3 * j + 2];
    out[3 * j] = root[0] + (x * c + z * s) * scale;
    out[3 * j + 1] = root[1] + y * scale;
    out[3 * j + 2] = root[2] + (-x * s + z * c) * scale;
  }
  return out;
}
const jointOf = (name, hand) => name === 'HAND' ? (hand > 0 ? J.RW : J.LW) : name === 'ELBOW' ? (hand > 0 ? J.RE : J.LE) : J[name];
// the hit capsule of a move from a world pose; the throw's stream grows along the (unit) world aim
function capsFromPose(pose, def, mt, dur, bpm, aimN, hand, id, scale) {
  const h = def.hit;
  const a = jointOf(h.a, hand), b = jointOf(h.b, hand);
  const cap = { ax: pose[3 * a], ay: pose[3 * a + 1], az: pose[3 * a + 2], bx: pose[3 * b], by: pose[3 * b + 1], bz: pose[3 * b + 2], r: h.r * scale, move: def.name, id };
  if (h.stream) {
    const L = Math.min(h.stream.len, h.stream.speed * Math.max(0, (mt - def.active[0] * dur) / tempoScale(bpm))) * scale;
    cap.bx += aimN[0] * L; cap.by += aimN[1] * L; cap.bz += aimN[2] * L;
  }
  return cap;
}

export class Character {
  constructor(o = {}) {
    this.seat = o.seat || 0;
    this.scale = o.scale || PHYS.scale;
    this.aimHand = (o.aimHand || 'R') === 'L' ? -1 : 1;
    this.plane = o.plane === undefined ? DEFAULT_PLANE : o.plane;
    this.stage = o.stage || null;
    this.env = { updraft: 0, slick: 0, carryX: 0, blink: false };
    this.lookAt = null; this.inputYaw = 0; this.bpm = null;
    this.pose = new Float32Array(NP); this.vel = new Float32Array(NP);
    this.events = [];
    this._local = new Float32Array(NP); this._tmp = new Float32Array(NP); this._tmp2 = new Float32Array(NP);
    this._prev = new Float32Array(NP); this._fade = new Float32Array(NP);
    this.serial = 0; this.time = 0; this._beat = 0;
    this._bpmEst = 112; this._lastBeat = null;
    this.reset(o.x, o.y);
  }

  reset(x, y, z) {
    const st = this.stage;
    const sp = st ? st.spawns[this.seat % st.spawns.length] : [0, 0.14];
    this.root = this._planePoint(x ?? sp[0], y ?? sp[1], z);
    this.v = [0, 0, 0];
    this.dir = this.seat ? -1 : 1;
    this.yaw = this._yawForDir(this.dir);
    this.grounded = false; this.support = null; this.coyote = 0; this.airJumps = 1; this.fastFalling = false;
    this.jumpBuf = 0; this.btnBuf = null; this.dropT = 0; this.dropId = null;
    this.move = null; this.stagger = 0; this.staggerDur = 0; this.reformT = -1; this.blinkT = 0;
    this.landK = 0; this.airW = 0; this.runW = 0; this.crouchW = 0; this.runPhase = 0; this.awayT = 0;
    this.blockStart = -1; this.aimW = 0; this.aimPos = null; this.aimVel = [0, 0, 0];
    this.cam = null; this.camW = 0; this.camLegW = 0;
    this.fadeT = 1; this.fadeDur = 0.1; this._srcKey = 'loco';
    this.energy = 0; this.lastGroundY = this.root[1]; this.inWater = false;
    this._snapToSupport(0);
    this._animate(0, neutral(), 0);
    this._prev.set(this.pose); this.vel.fill(0);
  }

  // ------------------------------------------------------------ coordinates
  _planePoint(s, y, z) {
    const pl = this.plane;
    if (!pl) return [s, y, z ?? 0];
    return [pl.origin[0] + pl.right[0] * s, y, pl.origin[2] + pl.right[2] * s];
  }
  get s() { const pl = this.plane; return pl ? (this.root[0] - pl.origin[0]) * pl.right[0] + (this.root[2] - pl.origin[2]) * pl.right[2] : this.root[0]; }
  _yawForDir(dir) {
    const pl = this.plane || DEFAULT_PLANE, n = normal(pl), o = this.plane ? PHYS.viewOpen : 0;
    return yawOf(pl.right[0] * dir * Math.cos(o) + n[0] * Math.sin(o), pl.right[2] * dir * Math.cos(o) + n[2] * Math.sin(o));
  }
  get x() { return this.root[0]; } get y() { return this.root[1]; } get z() { return this.root[2]; }
  get facing() { return this.dir; }
  center() { const p = this.pose; return [(p[3 * J.LH] + p[3 * J.RH] + p[3 * J.LS] + p[3 * J.RS]) / 4, (p[3 * J.LH + 1] + p[3 * J.RH + 1] + p[3 * J.LS + 1] + p[3 * J.RS + 1]) / 4, (p[3 * J.LH + 2] + p[3 * J.RH + 2] + p[3 * J.LS + 2] + p[3 * J.RS + 2]) / 4]; }
  pose2D(out = new Float32Array(NJ * 2)) {
    const pl = this.plane || DEFAULT_PLANE, p = this.pose;
    for (let j = 0; j < NJ; j++) { out[2 * j] = (p[3 * j] - pl.origin[0]) * pl.right[0] + (p[3 * j + 2] - pl.origin[2]) * pl.right[2]; out[2 * j + 1] = p[3 * j + 1]; }
    return out;
  }

  // ------------------------------------------------------------ state flags
  get airborne() { return !this.grounded; }
  get reforming() { return this.reformT >= 0; }
  get staggered() { return this.stagger > 0; }
  _u() { const m = this.move; return m ? clamp(m.t / m.dur, 0, 1) : 0; }
  get invulnerable() {
    if (this.reformT >= 0 || this.blinkT > 0) return true;
    const m = this.move; if (!m || !m.def.iframes) return false;
    const u = this._u(); return u >= m.def.iframes[0] && u <= m.def.iframes[1];
  }
  get dodging() { return !!(this.move && this.move.def.evade) || this.blinkT > 0; }
  get blocking() { return !!(this.move && this.move.name === 'block' && this._u() < 0.45 && this._u() > 0.04); }
  get blockAge() { return this.blocking ? this.time - this.blockStart : Infinity; }
  get flags() { return (this.dodging ? 1 : 0) | (this.airborne ? 2 : 0) | (this.blocking ? 4 : 0) | (this.dir < 0 ? 8 : 0) | (this.staggered ? 16 : 0); }
  static flagsToState(f) { return { dodging: !!(f & 1), airborne: !!(f & 2), blocking: !!(f & 4), facingLeft: !!(f & 8), staggered: !!(f & 16) }; }

  // ------------------------------------------------------------ stage queries (plane mode)
  _surfaces(stage, beat) {
    const out = [];
    if (stage && stage.ground != null) out.push({ id: '_ground', y: stage.ground, x0: -Infinity, x1: Infinity, solid: true, vy: 0 });
    for (const L of (stage && stage.ledges) || []) out.push({ id: L.id, L, y: ledgeY(L, beat), x0: L.x0, x1: L.x1, solid: !!L.solid, thick: L.thick ?? PHYS.solidThick });
    return out;
  }
  _freeGround(stage, x, z) {
    if (!stage) return 0;
    if (typeof stage.heightAt === 'function') { const h = stage.heightAt(x, z); if (h != null && Number.isFinite(h)) return h; }
    if (stage.ground != null) return stage.ground;
    return stage.spawns ? stage.spawns[this.seat % stage.spawns.length][1] : 0;
  }
  _snapToSupport(beat) {
    const st = this.stage;
    if (!this.plane) { const h = this._freeGround(st, this.root[0], this.root[2]); if (Math.abs(this.root[1] - h) < 0.01) { this.root[1] = h; this.grounded = true; this.support = { id: '_free' }; } return; }
    const s = this.s;
    for (const S of this._surfaces(st, beat)) {
      if (s >= S.x0 - PHYS.ledgeMargin && s <= S.x1 + PHYS.ledgeMargin && Math.abs(this.root[1] - S.y) < 0.01) { this.root[1] = S.y; this.grounded = true; this.support = S.L || S; return; }
    }
  }

  // ------------------------------------------------------------ public actions
  applyKnock(vx, vy, stag = 0.5, vz = 0) {
    if (this.reformT >= 0) return;
    this.v = [vx, vy, vz];
    if (this.plane) { const r = this.plane.right, vs = vx * r[0] + vz * r[2]; this.v = [r[0] * vs, vy, r[2] * vs]; }
    if (vy > 0) { this.grounded = false; this.support = null; }
    this.stagger = this.staggerDur = Math.max(0.05, stag);
    this._endMove(); this._crossfade('stagger', 0.06);
  }
  setPoseFromCamera(pose, opts = {}) {
    if (!this.cam) this.cam = { p2: new Float32Array(NJ * 2), p3: new Float32Array(NP) };
    const c = this.cam;
    c.has2 = !!pose; if (pose) c.p2.set(pose.subarray ? pose.subarray(0, NJ * 2) : pose.slice(0, NJ * 2));
    c.has3 = !!opts.pose3; if (opts.pose3) c.p3.set(opts.pose3);
    c.hasLegs = !!opts.hasLegs; c.t = this.time;
  }
  spawn() { this._reform(); }

  startMove(nameOrDef, opts = {}) {
    const def = typeof nameOrDef === 'string' ? MOVES[nameOrDef] : (nameOrDef.windup === undefined ? asMove(nameOrDef) : nameOrDef);
    if (!def || this.reformT >= 0 || this.stagger > 0) return false;
    if (!this.grounded && !def.airOk) return false;
    if (opts.dir) {
      if (this.plane) this.dir = sgn(opts.dir);
    }
    let yaw;
    if (this.plane) yaw = this._yawForDir(this.dir);
    else yaw = opts.yaw ?? this.yaw;
    if (!this.plane && opts.dirVec) yaw = yawOf(opts.dirVec[0], opts.dirVec[1]);
    // travel direction (unit, world x/z): along the plane, or the body's facing when free
    let f;
    if (this.plane) f = [this.plane.right[0] * this.dir, this.plane.right[2] * this.dir];
    else f = fwdOf(yaw);
    const aimW = this._aimWorld(opts.aim);
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    const aim3 = [aimW[0] * c + aimW[2] * s, aimW[1], -aimW[0] * s + aimW[2] * c];
    const bpm = this._bpm();
    const air = !this.grounded;
    const m = {
      def, name: def.name, t: 0, dur: def.dur * tempoScale(bpm), serial: ++this.serial, yaw, f,
      p0: this.root.slice(), v0: air ? this.v.slice() : [this.v[0], 0, this.v[2]], air, aim3, aimW: aimW.slice(), hand: this.aimHand, bpm,
      startTime: this.time, limb: opts.limb || null, camera: !!opts.camera, ground: !air,
    };
    { const l = Math.hypot(m.aimW[0], m.aimW[1], m.aimW[2]) || 1; m.aimN = [m.aimW[0] / l, m.aimW[1] / l, m.aimW[2] / l]; }
    if (opts.camera && def.active) { m.t = def.active[0] * m.dur; m.off = true; }   // the real limb already wound up; the root stays the player's
    this.move = m;
    this.yaw = yaw;
    if (def.name === 'block') this.blockStart = this.time;
    // the 16th-note grid
    const b = this._beat;
    const s16 = b * 4, offBeats = (s16 - Math.round(s16)) / 4, offMs = offBeats * 60000 / bpm;
    const perfect = Math.abs(offMs) <= COMBAT.PERFECT_MS;
    m.perfect = perfect;
    const aimScreen = this._aimScreen(aimW);
    this.events.push({ type: 'move', move: def.name, serial: m.serial, perfect, offMs: Math.round(offMs), x: this.root[0], y: this.root[1], z: this.root[2],
      dir: this.dir, yaw, aim: aimScreen, aim3: aim3.slice(), fdir: f.slice(), vx: m.v0[0], vy: m.v0[1], vz: m.v0[2], air, bpm, hand: this.aimHand > 0 ? 'R' : 'L',
      scale: this.scale, camera: m.camera || undefined, limb: m.limb || undefined });
    this._crossfade('move' + m.serial, 0.08);
    return true;
  }

  // ------------------------------------------------------------ aim
  _aimBasisRight() {
    if (this.plane) return this.plane.right;
    return [Math.cos(this.inputYaw), 0, -Math.sin(this.inputYaw)];
  }
  // world aim vector (length 0..1) from the intent's screen-plane aim
  _aimWorld(aimOverride) {
    const it = this._intent || neutral();
    let ax, ay;
    if (aimOverride) [ax, ay] = aimOverride;
    else if (it.aimActive && Math.hypot(it.aimX, it.aimY) > 0.15) { ax = it.aimX; ay = it.aimY; }
    else {
      // along the facing, a little up
      const f = this.plane ? null : fwdOf(this.yaw);
      if (f) return [f[0] * 0.9, 0.06, f[1] * 0.9];
      ax = this.dir * 0.9; ay = 0.06;
    }
    const r = this._aimBasisRight();
    const l = Math.hypot(ax, ay); if (l > 1) { ax /= l; ay /= l; }
    return [r[0] * ax, ay, r[2] * ax];
  }
  _aimScreen(w) { const r = this._aimBasisRight(); return [w[0] * r[0] + w[2] * r[2], w[1]]; }

  // ------------------------------------------------------------ the frame
  _bpm() { return clamp(this.bpm || this._bpmEst || 112, 60, 200); }

  update(dt, intent, stage, beat) {
    dt = clamp(+dt || 0, 0, 0.1);
    intent = Object.assign(neutral(), intent || {});
    if (stage) this.stage = stage;
    stage = this.stage;
    let bp = beat, bpmIn = null;
    if (beat && typeof beat === 'object') { bp = beat.pos ?? beat.beat; bpmIn = beat.bpm; }
    bp = Number.isFinite(bp) ? bp : (this._lastBeat ?? 0) + dt * this._bpm() / 60;
    if (bpmIn) this._bpmEst = bpmIn;
    else if (this._lastBeat != null && dt > 0) {
      const inst = (bp - this._lastBeat) / dt * 60;
      if (inst > 40 && inst < 240) this._bpmEst += (inst - this._bpmEst) * (1 - Math.exp(-dt / 0.6));
    }
    const beat0 = this._lastBeat ?? bp;
    this._lastBeat = bp;
    this._intent = intent;
    // project onto the plane if it was just set
    if (this.plane) {
      const p = this._planePoint(this.s, this.root[1]);
      this.root[0] = p[0]; this.root[2] = p[2];
      const r = this.plane.right, vs = this.v[0] * r[0] + this.v[2] * r[2]; this.v[0] = r[0] * vs; this.v[2] = r[2] * vs;
    }
    // edges into buffers
    if (intent.jump) this.jumpBuf = PHYS.jumpBuffer;
    for (const b of ['punch', 'kick', 'spin', 'dodge']) if (intent[b]) this.btnBuf = { b, t: PHYS.moveBuffer, auDir: intent.auDir, flick: intent.flick };
    if (intent.limb && (intent.punch || intent.kick) && this.cam) this.btnBuf.limb = intent.limb;
    const n = Math.max(1, Math.ceil(dt / PHYS.substep - 1e-9)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const b = beat0 + (bp - beat0) * (i + 1) / n, bPrev = beat0 + (bp - beat0) * i / n;
      this._beat = b;
      this._step(h, intent, stage, b, bPrev);
    }
    this._beat = bp;
    this._animate(dt, intent, bp, beat0);
  }

  _step(h, it, stage, beat, beatPrev) {
    this.time += h;
    this.jumpBuf = Math.max(0, this.jumpBuf - h);
    if (this.btnBuf) { this.btnBuf.t -= h; if (this.btnBuf.t <= 0) this.btnBuf = null; }
    this.coyote = Math.max(0, this.coyote - h);
    this.dropT = Math.max(0, this.dropT - h);
    this.blinkT = Math.max(0, this.blinkT - h);
    this.landK = Math.max(0, this.landK - h / PHYS.landSquash);
    // re-forming
    if (this.reformT >= 0) {
      this.reformT += h;
      if (this.reformT >= PHYS.reformTime) { this.reformT = -1; this._crossfade('loco', 0.1); }
      return;
    }
    if (this.stagger > 0) { this.stagger = Math.max(0, this.stagger - h); if (this.stagger === 0) this._crossfade('loco', 0.12); }
    const env = this.env || {};
    // ----- decisions
    const free = this.stagger <= 0;
    const m = this.move;
    if (m) {
      const u = m.t / m.dur;
      // strike held -> becomes the throw
      if (m.name === 'strike' && it.punchHeld && m.t > 0.75 * m.def.windup * tempoScale(m.bpm) && u < m.def.active[0]) { this.move = null; this.startMove('throw'); }
    }
    if (free) this._tryActions(it, beat);
    // ----- move time
    const mv = this.move;
    if (mv) {
      const hold = mv.def.hold, u = mv.t / mv.dur;
      const held = it.dodgeHeld ?? false;
      if (!(hold && held && u >= hold.u)) mv.t += h;
      if (mv.t >= mv.dur) this._endMove();
    }
    // ----- physics
    if (this.plane) this._physPlane(h, it, stage, beat, beatPrev, env);
    else this._physFree(h, it, stage, env);
    // tide
    this.inWater = !!(stage && stage.tide && this.root[1] < tideY(stage, beat) - 0.005);
    // ----- facing
    if (!this.move && this.stagger <= 0) this._face(h, it);
    // ----- the pit / blast zone
    const blast = (stage && stage.blast) || 0.25;
    const s = this.s;
    if (this.root[1] < -blast || this.root[1] > VIEW.top + 2 || (this.plane && !PHYS.walls && Math.abs(s) > VIEW.halfW + blast)) this._reform();
  }

  _tryActions(it, beat) {
    const m = this.move;
    const u = m ? m.t / m.dur : 0;
    const inRecovery = m && (m.def.active ? u > m.def.active[1] : u > 0.55);
    const canCancel = name => !m || (m.def.loop) || (m.name === 'block' && !(it.dodgeHeld)) ||
      (inRecovery && (m.def.cancelInto.includes('*') || m.def.cancelInto.includes(name)));
    // jump
    if (this.jumpBuf > 0 && canCancel('jump')) {
      if (this.grounded || this.coyote > 0) {
        const sup = this.support;
        const supVy = sup && sup.bob ? (ledgeY(sup, beat + 0.01) - ledgeY(sup, beat - 0.01)) / (0.02 * 60 / this._bpm()) : 0;
        this.v[1] = PHYS.jumpV * (1 + PHYS.updraftJump * (this.env.updraft || 0)) + Math.max(0, supVy);
        this.grounded = false; this.support = null; this.coyote = 0; this.jumpBuf = 0; this.fastFalling = false;
        if (m) this._endMove();
        this.events.push({ type: 'jump', x: this.root[0], y: this.root[1], z: this.root[2], air: false });
      } else if (this.airJumps > 0) {
        this.v[1] = PHYS.airJumpV; this.airJumps--; this.jumpBuf = 0; this.fastFalling = false;
        if (m) this._endMove();
        this.events.push({ type: 'jump', x: this.root[0], y: this.root[1], z: this.root[2], air: true });
      }
    }
    const bb = this.btnBuf;
    if (!bb) return;
    const choice = this._choose(bb, it);
    if (!choice) { this.btnBuf = null; return; }
    if (!canCancel(choice.name)) return;          // stays buffered
    if (choice.blink) { this._blink(choice); this.btnBuf = null; return; }
    if (m) this._endMove();
    if (this.startMove(choice.name, choice)) this.btnBuf = null;
  }

  // which move a button means, from the stick and the state
  _choose(bb, it) {
    const air = !this.grounded;
    let fwd, lat;
    const mv = this._moveVec(it);
    if (this.plane) { const r = this.plane.right; fwd = (mv[0] * r[0] + mv[1] * r[2]) * this.dir; lat = fwd; }
    else { const f = fwdOf(this.yaw); fwd = mv[0] * f[0] + mv[1] * f[1]; lat = 0; }
    const horiz = this.plane ? Math.abs(it.moveX) : Math.hypot(it.moveX, it.moveZ || 0);
    const down = it.moveY < -0.5, upw = it.moveY > 0.5;
    const dirOpts = () => {
      if (this.plane) return { dir: sgn(it.auDir || it.moveX || this.dir) };
      const l = Math.hypot(mv[0], mv[1]);
      return l > 0.3 ? { dirVec: [mv[0] / l, mv[1] / l] } : {};
    };
    const o = { limb: bb.limb, camera: !!bb.limb };
    switch (bb.b) {
      case 'punch': {
        const reach = Math.hypot(it.aimX, it.aimY);
        if (it.aimActive && reach >= 0.55 && !bb.flick && !bb.limb) return { name: 'throw', ...o };
        return { name: 'strike', ...o };
      }
      case 'kick':
        if (bb.limb) return { name: 'martelo', ...o };
        if (air) return { name: 'martelo' };
        if (down) return { name: 'rasteira' };
        if (upw) return { name: 'martelo' };
        if (fwd > 0.5) return { name: 'bencao' };
        if (fwd < -0.5) return { name: 'armada' };
        return { name: 'meia-lua' };
      case 'spin':
        if (air) return { name: 'spin' };
        if (bb.auDir || horiz > 0.5) return { name: 'au', ...dirOpts(), dir: this.plane ? sgn(bb.auDir || it.moveX) : undefined };
        if (down) return { name: 'macaco' };
        return { name: 'spin' };
      case 'dodge':
        if (this.env.blink && (air || horiz > 0.5)) return { name: air ? 'esquiva' : 'role', blink: true, ...dirOpts() };
        if (air) return { name: 'esquiva' };
        if (horiz > 0.5) return { name: 'role', ...dirOpts() };
        if (down) return { name: 'esquiva' };
        return { name: 'block' };
    }
    void lat;
    return null;
  }
  _moveVec(it) {
    // world x/z of the stick
    if (this.plane) { const r = this.plane.right; return [r[0] * it.moveX, r[2] * it.moveX]; }
    const c = Math.cos(this.inputYaw), s = Math.sin(this.inputYaw);
    const x = it.moveX, z = -(it.moveZ || 0);           // moveZ + = into the screen = away from the camera
    return [x * c + z * s, -x * s + z * c];
  }

  _blink(ch) {
    const from = this.root.slice();
    let d;
    if (this.plane) d = [this.plane.right[0] * (ch.dir || this.dir), this.plane.right[2] * (ch.dir || this.dir)];
    else d = ch.dirVec || fwdOf(this.yaw);
    const steps = 12, st = PHYS.blinkDist / steps;
    for (let i = 0; i < steps; i++) {
      const nx = this.root[0] + d[0] * st, nz = this.root[2] + d[1] * st;
      if (this.plane && this._solidAt(this.s + (d[0] * this.plane.right[0] + d[1] * this.plane.right[2]) * st, this.root[1])) break;
      this.root[0] = nx; this.root[2] = nz;
    }
    if (this.plane && PHYS.walls) this._clampWalls();
    this.blinkT = PHYS.blinkIframes;
    this.events.push({ type: 'blink', from, to: this.root.slice() });
    // the dodge still counts as a move for the rules
    const name = ch.name;
    this.startMove(name, { dir: ch.dir });
    if (this.move) { this.move.t = this.move.dur * 0.6; this.move.off = true; }   // the blink replaces most of the roll
    if (this.grounded) this._snapToSupport(this._beat);
  }
  _solidAt(s, y) {
    for (const S of this._surfaces(this.stage, this._beat)) {
      if (!S.L || !S.solid) continue;
      if (s + PHYS.halfW > S.x0 && s - PHYS.halfW < S.x1 && y < S.y - 1e-4 && y + PHYS.bodyH > S.y - S.thick) return true;
    }
    return false;
  }
  _clampWalls() {
    const lim = VIEW.halfW - PHYS.wallMargin, s = this.s;
    if (Math.abs(s) > lim) { const p = this._planePoint(clamp(s, -lim, lim), this.root[1]); this.root[0] = p[0]; this.root[2] = p[2]; return true; }
    return false;
  }

  _endMove() {
    if (!this.move) return;
    this.move = null;
    this._crossfade('loco', 0.1);
  }

  // kinematic root for a move from its start state (identical to Character.shapesAt)
  static _moveRoot(m, t, scale) {
    const k = PHYS.slideK;
    const tr = travelAt(m.def, clamp(t / m.dur, 0, 1));
    if (!m.air) {
      const sl = (1 - Math.exp(-k * t)) / k;
      return [m.p0[0] + m.v0[0] * sl + m.f[0] * tr[0] * scale, m.p0[1] + tr[1] * scale, m.p0[2] + m.v0[2] * sl + m.f[1] * tr[0] * scale];
    }
    return [m.p0[0] + m.v0[0] * t + m.f[0] * tr[0] * scale, m.p0[1] + m.v0[1] * t - 0.5 * PHYS.gravity * t * t, m.p0[2] + m.v0[2] * t + m.f[1] * tr[0] * scale];
  }

  _physPlane(h, it, stage, beat, beatPrev, env) {
    const r = this.plane.right;
    let s = this.s, y = this.root[1];
    let vs = this.v[0] * r[0] + this.v[2] * r[2], vy = this.v[1];
    const s0 = s, y0 = y;
    const m = this.move;
    const kin = m && !m.off;               // the move drives the root
    if (kin) {
      const p = Character._moveRoot(m, m.t, this.scale);
      const st = (p[0] - this.plane.origin[0]) * r[0] + (p[2] - this.plane.origin[2]) * r[2];
      vs = (st - s) / h;
      if (m.air) vy = (p[1] - y) / h;
    } else if (this.stagger > 0) {
      if (this.grounded) vs -= sgn(vs) * Math.min(Math.abs(vs), 3 * h); else vs *= Math.exp(-PHYS.airDrag * 0.5 * h);
    } else if (m) {
      // a move that left its ledge coasts
    } else {
      const crouch = this.grounded && it.moveY < -0.5;
      const slow = this.inWater ? PHYS.tideSlow : 1;
      const target = crouch ? 0 : clamp(it.moveX, -1, 1) * PHYS.runSpeed * slow;
      if (this.grounded) {
        const grip = 1 - PHYS.slickGrip * (env.slick || 0);
        const a = (Math.abs(target) > Math.abs(vs) && sgn(target) === sgn(vs)) || Math.abs(vs) < 1e-4 ? PHYS.groundAccel : sgn(target) !== sgn(vs) && Math.abs(target) > 0.01 ? PHYS.turnAccel : PHYS.groundDecel;
        vs += clamp(target - vs, -a * grip * h, a * grip * h);
      } else {
        if (Math.abs(it.moveX) > 0.1) vs += clamp(target - vs, -PHYS.airAccel * h, PHYS.airAccel * h);
        else vs -= sgn(vs) * Math.min(Math.abs(vs), PHYS.airDrag * h);
      }
    }
    // gravity
    if (!this.grounded && !(kin && m.air)) {
      const up = env.updraft || 0;
      let g = PHYS.gravity * (vy < 0 ? PHYS.fallMul : 1) * (1 - PHYS.updraftGravity * up);
      if (vy > 0 && !it.jumpHeld && !m && this.stagger <= 0) g *= PHYS.cutMul;
      if (!m && this.stagger <= 0 && vy < 0.25 && it.moveY < -0.6) this.fastFalling = true;
      if (this.fastFalling) g *= PHYS.fastFallMul;
      vy -= g * h;
      const mf = this.fastFalling ? PHYS.fastFall : PHYS.maxFall * (1 - 0.3 * up);
      if (vy < -mf) vy = -mf;
    }
    // horizontal
    s += vs * h;
    if (this.grounded && env.carryX && !kin) s += env.carryX * h;
    const surf = this._surfaces(stage, beat), surfPrev = this._surfaces(stage, beatPrev);
    for (const S of surf) {
      if (!S.L || !S.solid) continue;
      const bot = S.y - S.thick;
      if (y < S.y - 1e-4 && y + PHYS.bodyH > bot && s + PHYS.halfW > S.x0 && s - PHYS.halfW < S.x1) {
        if (s0 <= (S.x0 + S.x1) / 2) s = S.x0 - PHYS.halfW; else s = S.x1 + PHYS.halfW;
        vs = 0;
      }
    }
    if (PHYS.walls) { const lim = VIEW.halfW - PHYS.wallMargin; if (Math.abs(s) > lim) { s = clamp(s, -lim, lim); vs = 0; } }
    // vertical
    let landed = null;
    if (this.grounded) {
      const S = surf.find(q => this.support && q.id === this.support.id);
      if (S && s >= S.x0 - PHYS.ledgeMargin && s <= S.x1 + PHYS.ledgeMargin) { y = S.y; vy = 0; }
      else {
        this.grounded = false; this.support = null; this.coyote = PHYS.coyote; vy = 0;
        if (m) m.off = true;
      }
      // drop through a one-way ledge
      if (this.grounded && S && S.L && !S.solid && it.moveY < -0.6 && !kin) {
        this.grounded = false; this.dropId = S.id; this.dropT = PHYS.dropTime; this.support = null; vy = -0.3; this.coyote = 0;
      }
    }
    if (!this.grounded) {
      y += vy * h;
      let best = null;
      for (let i = 0; i < surf.length; i++) {
        const S = surf[i], Sp = surfPrev[i];
        if (s < S.x0 - PHYS.ledgeMargin || s > S.x1 + PHYS.ledgeMargin) continue;
        if (S.id === this.dropId && this.dropT > 0) continue;
        const relV = vy - (S.y - Sp.y) / h;
        if (S.id === '_ground') { if (y <= S.y && relV <= 0.001) best = !best || S.y > best.y ? S : best; continue; }
        if (relV <= 0.001 && y0 >= Sp.y - 0.003 && y <= S.y) best = !best || S.y > best.y ? S : best;
      }
      if (best) { landed = vy; y = best.y; vy = 0; this.grounded = true; this.support = best.L || best; }
      else {
        // ceilings: the underside of solid ledges
        for (const S of surf) {
          if (!S.L || !S.solid) continue;
          const bot = S.y - S.thick;
          if (vy > 0 && y0 + PHYS.bodyH <= bot + 1e-3 && y + PHYS.bodyH > bot && s + PHYS.halfW > S.x0 && s - PHYS.halfW < S.x1) { y = bot - PHYS.bodyH; vy = 0; }
        }
      }
    }
    const p = this._planePoint(s, y);
    this.root[0] = p[0]; this.root[1] = y; this.root[2] = p[2];
    if (!kin) vs = clamp(vs, -3, 3);
    this.v = [r[0] * vs, vy, r[2] * vs];
    if (landed != null) this._onLand(landed);
    if (this.grounded) this.lastGroundY = y;
  }

  _physFree(h, it, stage, env) {
    let [x, y, z] = this.root, [vx, vy, vz] = this.v;
    const m = this.move, kin = m && !m.off;
    if (kin) {
      const p = Character._moveRoot(m, m.t, this.scale);
      vx = (p[0] - x) / h; vz = (p[2] - z) / h; if (m.air) vy = (p[1] - y) / h;
    } else if (this.stagger > 0) {
      const sp = Math.hypot(vx, vz), d = this.grounded ? 3 * h : 0;
      if (sp > 0) { const k = Math.max(0, sp - d) / sp; vx *= k; vz *= k; }
    } else if (m) {
      // coasting
    } else {
      const mv = this._moveVec(it);
      const crouch = this.grounded && it.moveY < -0.5;
      let tx = mv[0], tz = mv[1]; const l = Math.hypot(tx, tz); if (l > 1) { tx /= l; tz /= l; }
      const sp = crouch ? 0 : PHYS.runSpeed * (this.inWater ? PHYS.tideSlow : 1);
      tx *= sp; tz *= sp;
      const a = (this.grounded ? PHYS.groundAccel * (1 - PHYS.slickGrip * (env.slick || 0)) : PHYS.airAccel) * h * (l > 0.05 ? 1 : 1.3);
      const dx = tx - vx, dz = tz - vz, dl = Math.hypot(dx, dz);
      if (dl > a) { vx += dx / dl * a; vz += dz / dl * a; } else { vx = tx; vz = tz; }
    }
    if (!this.grounded && !(kin && m.air)) {
      const up = env.updraft || 0;
      let g = PHYS.gravity * (vy < 0 ? PHYS.fallMul : 1) * (1 - PHYS.updraftGravity * up);
      if (vy > 0 && !it.jumpHeld && !m && this.stagger <= 0) g *= PHYS.cutMul;
      if (!m && this.stagger <= 0 && vy < 0.25 && it.moveY < -0.6) this.fastFalling = true;
      if (this.fastFalling) g *= PHYS.fastFallMul;
      vy -= g * h;
      vy = Math.max(vy, -(this.fastFalling ? PHYS.fastFall : PHYS.maxFall));
    }
    x += vx * h; z += vz * h;
    const g0 = this._freeGround(stage, x, z);
    let landed = null;
    if (this.grounded) {
      if (y - g0 > 0.04) { this.grounded = false; this.coyote = PHYS.coyote; vy = 0; if (m) m.off = true; }
      else { y = g0; vy = 0; }
    }
    if (!this.grounded) {
      y += vy * h;
      if (y <= g0 && vy <= 0.001) { landed = vy; y = g0; vy = 0; this.grounded = true; this.support = { id: '_free' }; }
    }
    this.root = [x, y, z];
    if (!kin) { const sp = Math.hypot(vx, vz); if (sp > 3) { vx *= 3 / sp; vz *= 3 / sp; } }
    this.v = [vx, vy, vz];
    if (landed != null) this._onLand(landed);
    if (this.grounded) this.lastGroundY = y;
  }

  _onLand(vy) {
    this.airJumps = 1; this.fastFalling = false;
    this.landK = clamp(-vy / 1.4, 0.25, 1);
    if (this.move && this.move.air) this._endMove();
    if (this.move) this.move.off = true;
    this.events.push({ type: 'land', x: this.root[0], y: this.root[1], z: this.root[2], impact: -vy });
  }

  _face(h, it) {
    if (this.plane) {
      const s = this.s;
      const look = this.lookAt ? (this.lookAt[0] - this.plane.origin[0]) * this.plane.right[0] + (this.lookAt[2] - this.plane.origin[2]) * this.plane.right[2] : null;
      if (this.grounded && Math.abs(it.moveX) > 0.3) {
        const md = sgn(it.moveX);
        if (look != null && md !== sgn(look - s)) { this.awayT += h; if (this.awayT > PHYS.faceRunDelay) this.dir = md; }
        else { this.awayT = 0; this.dir = md; }
      } else {
        this.awayT = 0;
        if (this.grounded && look != null && Math.abs(look - s) > 0.02) this.dir = sgn(look - s);
      }
      this._turnToward(this._yawForDir(this.dir), h);
    } else {
      const sp = Math.hypot(this.v[0], this.v[2]);
      let target = this.yaw;
      if (sp > 0.12) target = yawOf(this.v[0], this.v[2]);
      else if (this.lookAt) { const dx = this.lookAt[0] - this.root[0], dz = this.lookAt[2] - this.root[2]; if (Math.hypot(dx, dz) > 0.02) target = yawOf(dx, dz); }
      this._turnToward(target, h);
      this.dir = Math.sin(this.yaw) < 0 ? -1 : 1;
    }
  }
  _turnToward(target, h) {
    const d = wrapPi(target - this.yaw), stp = PHYS.turnRate * h;
    this.yaw = Math.abs(d) <= stp ? target : this.yaw + sgn(d) * stp;
    this.yaw = wrapPi(this.yaw);
  }

  _reform() {
    const st = this.stage;
    const sp = st ? st.spawns[this.seat % st.spawns.length] : [0, 0.14];
    this.root = this._planePoint(sp[0], sp[1], this.plane ? undefined : 0);
    this.v = [0, 0, 0]; this.move = null; this.stagger = 0; this.grounded = false; this.support = null;
    this.reformT = 0; this.airJumps = 1; this.fastFalling = false; this.btnBuf = null; this.jumpBuf = 0;
    this.dir = this.seat ? -1 : 1; this.yaw = this._yawForDir(this.dir);
    this._snapToSupport(this._beat || 0);
    if (!this.grounded && this.plane && st && st.ground != null && Math.abs(sp[1] - st.ground) < 0.01) { this.grounded = true; this.support = { id: '_ground' }; }
    this.events.push({ type: 'respawn', x: this.root[0], y: this.root[1], z: this.root[2] });
    this._crossfade('reform', 0);
    this._respawned = true;
  }

  _crossfade(key, dur) {
    if (key === this._srcKey) return;
    this._srcKey = key;
    for (let i = 0; i < NP; i += 3) { this._fade[i] = this.pose[i] - this.root[0]; this._fade[i + 1] = this.pose[i + 1] - this.root[1]; this._fade[i + 2] = this.pose[i + 2] - this.root[2]; }
    this.fadeT = 0; this.fadeDur = dur;
  }

  // ------------------------------------------------------------ animation
  _animate(dt, it, beat, beat0) {
    const L = this._local, T = this._tmp, T2 = this._tmp2, sc = this.scale;
    const speed = this.plane ? Math.abs(this.v[0] * this.plane.right[0] + this.v[2] * this.plane.right[2]) : Math.hypot(this.v[0], this.v[2]);
    const a = k => 1 - Math.exp(-dt * k);
    const runK = clamp(speed / PHYS.runSpeed, 0, 1);
    this.runW += (smooth(runK * 1.6) * (this.grounded ? 1 : 0) - this.runW) * a(10);
    this.crouchW += ((this.grounded && !this.move && this.stagger <= 0 && it.moveY < -0.5 ? 1 : 0) - this.crouchW) * a(14);
    this.airW += ((this.grounded ? 0 : 1) - this.airW) * a(this.grounded ? 22 : 12);
    const prevPhase = this.runPhase;
    this.runPhase += speed * dt / 0.075;                      // ~0.47 world units per stride
    let src, yaw = this.yaw, ctxAir = false;
    const m = this.move;
    if (this.reformT >= 0) { LOCO.reform(L, this.reformT / PHYS.reformTime); src = 'reform'; }
    else if (this.stagger > 0) { LOCO.stagger(L, 1 - this.stagger / this.staggerDur); src = 'stagger'; }
    else if (m) {
      ctxAir = m.air;
      m.def.pose(clamp(m.t / m.dur, 0, 1), { hand: m.hand, aim: m.aim3, air: m.air, beat, groove: 1, t: m.t }, L);
      yaw = m.yaw; src = 'move' + m.serial;
    } else {
      LOCO.ginga(L, beat, 1);
      if (this.runW > 0.01) { LOCO.run(T, this.runPhase, runK); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.runW; }
      if (this.crouchW > 0.01) { LOCO.crouch(T, beat); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.crouchW; }
      if (this.landK > 0 && this.grounded) { LOCO.land(T, this.landK); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.landK * 0.8; }
      if (this.airW > 0.01) {
        const vy = this.v[1];
        if (vy > 0) LOCO.rise(T, clamp(vy / PHYS.jumpV, 0.3, 1)); else LOCO.fall(T, clamp(-vy / 1.2, 0, 1));
        LOCO.rise(T2, 0.4);
        const w = smooth((vy + 0.3) / 0.6);
        if (vy <= 0.3 && vy >= -0.3) for (let i = 0; i < NP; i++) T[i] = T[i] * (1 - w) + T2[i] * w;
        for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.airW;
      }
      src = 'loco';
      // footfalls
      if (this.grounded && dt > 0) {
        if (this.runW > 0.5) {
          const k0 = Math.floor(prevPhase / Math.PI), k1 = Math.floor(this.runPhase / Math.PI);
          if (k1 > k0) this._step2(k1 & 1 ? 'L' : 'R');
        } else for (const st of (beat0 != null ? gingaStepsSafe(beat0, beat) : [])) this._step2(st.foot);
      }
    }
    if (src !== this._srcKey && !src.startsWith('move')) this._crossfade(src, src === 'loco' ? 0.1 : 0.06);
    toWorld(this.pose, L, this.root, yaw, sc);
    // squash on landing
    if (this.landK > 0 && !m && this.grounded) {
      const q = this.landK * 0.1;
      for (let j = 0; j < NJ; j++) this.pose[3 * j + 1] = this.root[1] + (this.pose[3 * j + 1] - this.root[1]) * (1 - q);
    }
    // crossfade from the previous source
    if (this.fadeT < this.fadeDur) {
      this.fadeT += dt;
      const w = 1 - smooth(this.fadeT / Math.max(1e-4, this.fadeDur));
      for (let i = 0; i < NP; i += 3) {
        this.pose[i] += (this._fade[i] + this.root[0] - this.pose[i]) * w;
        this.pose[i + 1] += (this._fade[i + 1] + this.root[1] - this.pose[i + 1]) * w;
        this.pose[i + 2] += (this._fade[i + 2] + this.root[2] - this.pose[i + 2]) * w;
      }
    }
    this._applyCamera(dt);
    this._applyAim(dt, it, m, ctxAir);
    // velocities
    if (this._respawned || dt <= 0) { this.vel.fill(0); this._respawned = false; }
    else {
      const k = a(30);
      for (let i = 0; i < NP; i++) this.vel[i] += (clamp((this.pose[i] - this._prev[i]) / dt, -12, 12) - this.vel[i]) * k;
    }
    this._prev.set(this.pose);
    let e = 0; for (let j = 0; j < NJ; j++) e += Math.hypot(this.vel[3 * j], this.vel[3 * j + 1], this.vel[3 * j + 2]);
    this.energy += (clamp(e / NJ / 0.6, 0, 1) - this.energy) * a(4);
  }
  _step2(foot) {
    const j = foot === 'L' ? J.LA : J.RA, p = this.pose;
    this.events.push({ type: 'step', x: p[3 * j], y: this.root[1], z: p[3 * j + 2], foot, wet: this.inWater });
  }

  _applyCamera(dt) {
    const c = this.cam;
    const live = c && this.time - c.t < PHYS.camHold && (c.has2 || c.has3);
    this.camW += ((live ? 1 : 0) - this.camW) * (1 - Math.exp(-dt * 8));
    const legs = live && c.hasLegs && this.grounded && this.reformT < 0;
    this.camLegW += ((legs ? 1 : 0) - this.camLegW) * (1 - Math.exp(-dt * 6));
    if (this.camW < 0.005 || !c) return;
    const pl = this.plane || null;
    const R = pl ? pl.right : [Math.cos(this.inputYaw), 0, -Math.sin(this.inputYaw)];
    const N = pl ? normal(pl) : [Math.sin(this.inputYaw), 0, Math.cos(this.inputYaw)];
    const sc = this.scale, P = this.pose;
    const hip = [(P[3 * J.LH] + P[3 * J.RH]) / 2, (P[3 * J.LH + 1] + P[3 * J.RH + 1]) / 2, (P[3 * J.LH + 2] + P[3 * J.RH + 2]) / 2];
    const T = this._tmp;
    if (c.has3) {
      const q = c.p3;
      const hx = (q[3 * J.LH] + q[3 * J.RH]) / 2, hy = (q[3 * J.LH + 1] + q[3 * J.RH + 1]) / 2, hz = (q[3 * J.LH + 2] + q[3 * J.RH + 2]) / 2;
      let base = hip.slice();
      if (this.camLegW > 0.01) { const minA = Math.min(q[3 * J.LA + 1], q[3 * J.RA + 1]); const want = this.root[1] + (hy - minA) * sc; base[1] += (want - base[1]) * this.camLegW; }
      for (let j = 0; j < NJ; j++) {
        const x = q[3 * j] - hx, y = q[3 * j + 1] - hy, z = q[3 * j + 2] - hz;
        T[3 * j] = base[0] + (R[0] * x + N[0] * z) * sc; T[3 * j + 1] = base[1] + y * sc; T[3 * j + 2] = base[2] + (R[2] * x + N[2] * z) * sc;
      }
    } else {
      const q = c.p2;
      const hx = (q[2 * J.LH] + q[2 * J.RH]) / 2, hy = (q[2 * J.LH + 1] + q[2 * J.RH + 1]) / 2;
      for (let j = 0; j < NJ; j++) {
        const x = (q[2 * j] - hx) * sc;
        const yUp = hip[1] + (q[2 * j + 1] - hy) * sc, yFl = this.root[1] + q[2 * j + 1] * sc;
        T[3 * j] = hip[0] + R[0] * x; T[3 * j + 1] = yUp + (yFl - yUp) * this.camLegW; T[3 * j + 2] = hip[2] + R[2] * x;
      }
    }
    const legsJ = [J.LK, J.RK, J.LA, J.RA];
    for (let j = 0; j < NJ; j++) {
      const w = this.camW * (legsJ.includes(j) ? this.camLegW : 1);
      for (let k = 0; k < 3; k++) P[3 * j + k] += (T[3 * j + k] - P[3 * j + k]) * w;
    }
  }

  _applyAim(dt, it, m, air) {
    let want = 0;
    if (it.aimActive && this.camW < 0.5 && this.reformT < 0 && this.stagger <= 0) want = m ? m.def.aimW : this.crouchW > 0.5 ? 0.7 : 1;
    const own = m && m.def.usesHand && m.hand === this.aimHand;
    if (own) want = 0;
    void air;
    const a = 1 - Math.exp(-dt * (own ? 40 : want < this.aimW ? 18 : 9));
    this.aimW += (want - this.aimW) * a;
    // the striking hand belongs to the move from its active window on (keeps live == replayed shapes)
    if (own && m.def.active && m.t >= m.def.active[0] * m.dur) this.aimW = 0;
    const P = this.pose, sj = this.aimHand > 0 ? J.RS : J.LS, ej = this.aimHand > 0 ? J.RE : J.LE, wj = this.aimHand > 0 ? J.RW : J.LW;
    const S = [P[3 * sj], P[3 * sj + 1], P[3 * sj + 2]];
    const aw = this._aimWorld();
    const reach = PHYS.aimReach * this.scale;
    const tgt = [S[0] + aw[0] * reach, S[1] + aw[1] * reach, S[2] + aw[2] * reach];
    const W = [P[3 * wj], P[3 * wj + 1], P[3 * wj + 2]];
    if (!this.aimPos || this.aimW < 0.01) { this.aimPos = W.slice(); this.aimVel = [0, 0, 0]; if (this.aimW < 0.01) return; }
    // critically damped spring: the instrument hand never jumps
    const w0 = 26, h = Math.min(dt, 0.05);
    for (let k = 0; k < 3; k++) {
      const acc = w0 * w0 * (tgt[k] - this.aimPos[k]) - 2 * w0 * this.aimVel[k];
      this.aimVel[k] += acc * h; this.aimPos[k] += this.aimVel[k] * h;
    }
    const w = this.aimW;
    const H = [W[0] + (this.aimPos[0] - W[0]) * w, W[1] + (this.aimPos[1] - W[1]) * w, W[2] + (this.aimPos[2] - W[2]) * w];
    // elbow: two-bone IK from the shoulder, bending the way the elbow already points
    const E = [P[3 * ej], P[3 * ej + 1], P[3 * ej + 2]];
    const a1 = BONE.UA * this.scale, b1 = BONE.FA * this.scale;
    let d = [H[0] - S[0], H[1] - S[1], H[2] - S[2]], dist = Math.hypot(...d);
    if (dist > (a1 + b1) * 1.02) { const k = (a1 + b1) * 1.02 / dist; d = d.map(v => v * k); dist = (a1 + b1) * 1.02; H[0] = S[0] + d[0]; H[1] = S[1] + d[1]; H[2] = S[2] + d[2]; }
    const n = d.map(v => v / (dist || 1));
    let pole = [E[0] - S[0], E[1] - S[1] - 0.3 * a1, E[2] - S[2]];
    const pd = pole[0] * n[0] + pole[1] * n[1] + pole[2] * n[2];
    pole = [pole[0] - n[0] * pd, pole[1] - n[1] * pd, pole[2] - n[2] * pd];
    const pl = Math.hypot(...pole) || 1;
    const cosA = clamp((a1 * a1 + dist * dist - b1 * b1) / (2 * a1 * Math.max(dist, 1e-4)), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const NE = [S[0] + n[0] * a1 * cosA + pole[0] / pl * a1 * sinA, S[1] + n[1] * a1 * cosA + pole[1] / pl * a1 * sinA, S[2] + n[2] * a1 * cosA + pole[2] / pl * a1 * sinA];
    for (let k = 0; k < 3; k++) { P[3 * wj + k] = H[k]; P[3 * ej + k] = E[k] + (NE[k] - E[k]) * w; }
  }

  // ------------------------------------------------------------ combat geometry
  hitShapes() {
    const m = this.move;
    if (!m || !m.def.attack || !m.def.active || !m.def.hit) return [];
    const u = m.t / m.dur;
    if (u < m.def.active[0] || u > m.def.active[1]) return [];
    if (m.limb && this.camW > 0.5) return [Character.shapesFromPose(this.pose, m.limb, m.def.hit.r * this.scale, m.name, m.serial)];
    return [capsFromPose(this.pose, m.def, m.t, m.dur, m.bpm, m.aimN, m.hand, m.serial, this.scale)];
  }
  hurtShapes() {
    if (this.reformT >= 0) return [];
    const P = this.pose, sc = this.scale, out = [];
    const c = (a, b, r, part) => out.push({ ax: P[3 * a], ay: P[3 * a + 1], az: P[3 * a + 2], bx: P[3 * b], by: P[3 * b + 1], bz: P[3 * b + 2], r: r * sc, part });
    const mid = (a, b) => [(P[3 * a] + P[3 * b]) / 2, (P[3 * a + 1] + P[3 * b + 1]) / 2, (P[3 * a + 2] + P[3 * b + 2]) / 2];
    const sh = mid(J.LS, J.RS), hp = mid(J.LH, J.RH);
    out.push({ ax: sh[0], ay: sh[1], az: sh[2], bx: hp[0], by: hp[1], bz: hp[2], r: 0.065 * sc, part: 'torso' });
    c(J.HEAD, J.HEAD, 0.055, 'head');
    c(J.LS, J.LE, 0.03, 'arm'); c(J.LE, J.LW, 0.028, 'arm'); c(J.RS, J.RE, 0.03, 'arm'); c(J.RE, J.RW, 0.028, 'arm');
    c(J.LH, J.LK, 0.04, 'leg'); c(J.LK, J.LA, 0.035, 'leg'); c(J.RH, J.RK, 0.04, 'leg'); c(J.RK, J.RA, 0.035, 'leg');
    return out;
  }
  standShape() {
    const y = this.grounded ? this.root[1] : this.lastGroundY;
    return { ax: this.root[0], ay: y + 0.03, az: this.root[2], bx: this.root[0], by: y + PHYS.bodyH - 0.03, bz: this.root[2], r: 0.035 * this.scale / 0.36 };
  }

  serialize() {
    const p3 = Array.from(this.pose, v => Math.round(v * 1000));
    const p = Array.from(this.pose2D(), v => Math.round(v * 1000));
    const m = this.move;
    return { p, p3, f: this.flags, e: Math.round(clamp(this.energy, 0, 1) * 255), move: m ? { name: m.name, serial: m.serial, t: m.t } : null };
  }

  // ------------------------------------------------------------ deterministic replay
  // ev: a 'move' event (this file's, or the protocol's { move, x, y, dir, aim } plus optional z, yaw, aim3,
  // fdir, vx, vy, vz, air, bpm, hand). t: seconds since the move started. -> hit capsules (world).
  static shapesAt(ev, t, scale = PHYS.scale) {
    const def = MOVES[ev.move];
    if (!def || !def.attack || !def.active || !def.hit) return [];
    const bpm = ev.bpm || 112, dur = def.dur * tempoScale(bpm), u = t / dur;
    if (u < def.active[0] || u > def.active[1]) return [];
    const dir = ev.dir < 0 ? -1 : 1;
    const yaw = ev.yaw ?? (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const f = ev.fdir || [dir, 0];
    const hand = ev.hand === 'L' ? -1 : 1;
    let aim3 = ev.aim3;
    if (!aim3) {
      const a = ev.aim || [dir * 0.9, 0.06];
      const w = [a[0], a[1], 0], c = Math.cos(-yaw), s = Math.sin(-yaw);
      aim3 = [w[0] * c + w[2] * s, w[1], -w[0] * s + w[2] * c];
    }
    const m = { def, dur, p0: [ev.x, ev.y, ev.z || 0], v0: [ev.vx || 0, ev.air ? ev.vy || 0 : 0, ev.vz || 0], air: !!ev.air, f };
    const root = Character._moveRoot(m, t, scale);
    const L = new Float32Array(NP), W = new Float32Array(NP);
    def.pose(u, { hand, aim: aim3, air: !!ev.air, beat: 0 }, L);
    toWorld(W, L, root, yaw, scale);
    // world aim, normalised
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let aw = [aim3[0] * c + aim3[2] * s, aim3[1], -aim3[0] * s + aim3[2] * c];
    const l = Math.hypot(...aw) || 1; aw = aw.map(v => v / l);
    return [capsFromPose(W, def, t, dur, bpm, aw, hand, ev.serial ?? ev.id, scale)];
  }
  static shapesFromPose(pose, limb, r, move, id) {
    const pairs = { LW: [J.LE, J.LW], RW: [J.RE, J.RW], LA: [J.LK, J.LA], RA: [J.RK, J.RA] };
    const [a, b] = pairs[limb] || pairs.RW;
    return { ax: pose[3 * a], ay: pose[3 * a + 1], az: pose[3 * a + 2], bx: pose[3 * b], by: pose[3 * b + 1], bz: pose[3 * b + 2], r, move, id };
  }
}

function gingaStepsSafe(b0, b1) { return b1 > b0 && b1 - b0 < 2 ? gingaSteps(b0, b1) : []; }

// ------------------------------------------------------------ exchanges
// Closest distance between two capsules' core segments, minus both radii (negative = overlapping).
export function capsuleDistance(A, B, plane) {
  let p = [A.ax, A.ay, A.az || 0], q = [A.bx, A.by, A.bz || 0], r = [B.ax, B.ay, B.az || 0], s = [B.bx, B.by, B.bz || 0];
  if (plane) { const fl = v => { const n = normal(plane), d = (v[0] - plane.origin[0]) * n[0] + (v[2] - plane.origin[2]) * n[2]; return [v[0] - n[0] * d, v[1], v[2] - n[2] * d]; }; p = fl(p); q = fl(q); r = fl(r); s = fl(s); }
  return segSegDist(p, q, r, s) - A.r - B.r;
}
function segSegDist(p1, q1, p2, q2) {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]], r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2], f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
}

// defender: a Character, or { hurt:[caps], hit:[caps], stand:cap, invulnerable, dodging, airborne, blocking,
// blockAge (s), reforming }. opts.plane (or the defender's plane) flattens everything onto the locked plane,
// so a locked game is exactly 2-D.
// Rules (DESIGN.md "Jogo rules"): clash = the two dancers' active hit capsules overlap; touching the body:
// i-frames / mid-dodge -> dodge, a block begun within PARRY_MS -> parry, a later block -> near, else hit;
// not touching but crossing where the standing body would be while airborne or dodging -> dodge;
// within COMBAT.NEAR (about a hand's width) of the body -> near.
export function resolveExchange(attackerShapes, defender, opts = {}) {
  if (!attackerShapes || !attackerShapes.length || !defender) return null;
  const isChar = typeof defender.hurtShapes === 'function';
  const d = isChar ? {
    hurt: defender.hurtShapes(), hit: defender.hitShapes(), stand: defender.standShape(), invulnerable: defender.invulnerable,
    dodging: defender.dodging, airborne: defender.airborne, blocking: defender.blocking, blockAge: defender.blockAge, reforming: defender.reforming, plane: defender.plane,
  } : defender;
  if (d.reforming) return null;
  const plane = opts.plane !== undefined ? opts.plane : (d.plane || null);
  const minDist = (caps) => { let m = Infinity; for (const A of attackerShapes) for (const B of caps || []) m = Math.min(m, capsuleDistance(A, B, plane)); return m; };
  if (minDist(d.hit) <= 0) return 'clash';
  const body = minDist(d.hurt);
  if (body <= 0) {
    if (d.invulnerable || d.dodging) return 'dodge';
    if (d.blocking) return (d.blockAge ?? Infinity) * 1000 <= COMBAT.PARRY_MS ? 'parry' : 'near';
    return 'hit';
  }
  if ((d.airborne || d.dodging || d.invulnerable) && d.stand && minDist([d.stand]) <= 0) return 'dodge';
  if (body <= COMBAT.NEAR) return 'near';
  return null;
}

// Folding one attack's per-frame results into the one report the rules want:
//   hit / clash / parry are decisive the moment they happen (final = true: report now);
//   otherwise keep the best of dodge > near and report it when the active window ends.
const RANK = { null: 0, near: 1, dodge: 2 };
export function foldExchange(prev, res) {
  if (prev && prev.final) return prev;
  if (res === 'hit' || res === 'clash' || res === 'parry') return { res, final: true };
  const p = prev ? prev.res : null;
  return { res: (RANK[res] || 0) > (RANK[p] || 0) ? res : p, final: false };
}

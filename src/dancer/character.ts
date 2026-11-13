// A dancer with a body in the world: root physics (locked to a StagePlane, the 2D jogo, or free in 3D), the move
// being danced, the bending hand, the camera body's limbs, and the geometry the jogo's rules read (hit and hurt
// capsules). Ported from the 2D prototype (sketches/dance-first-2d/js/character.js) into metres. Pure: no DOM, no
// GPU; it runs in Node for the tests. An IntentController (dancer/intent-controller.ts) feeds it Intents and fits the
// 38-joint rig to the 13 landmarks it writes.
//
// World: metres, y up. `pose` is 13 landmarks in the world (39 floats, order LM), `root` the ground point under the
// hips, `yaw` the facing (forward is (sin yaw, 0, cos yaw)).
//
//   const c = new Character({ seat, plane, terrain })
//   c.plane         a StagePlane locks movement to it (s along plane.right) with its ground and ledges (plus
//                   `extraLedges()`, e.g. set ice); null = free 3D movement on terrain.groundAt(x, z). setPlane()
//                   eases a dancer onto a new plane rather than snapping.
//   c.env           { updraft 0..1, slick 0..1, carryX (m/s), blink, still? } set by the game each frame (element
//                   perks; `still`: a fusion holds the pair as one body, so moves play where they start and the stick
//                   turns the body without walking it).
//   c.lookAt        null | [x,y,z]: the partner. The dancer faces it when not running away from it.
//   c.inputYaw      free mode: the camera's yaw, so moveX/moveZ are camera-relative (0 = the camera at +z).
//   c.update(dt, intent, beat)   beat = a beat position or { pos, bpm }. Writes pose, vel, root, yaw; pushes events:
//     { type:'move', move, serial, perfect, offMs, x, y, z, dir, yaw, aim:[ax,ay], aim3, fdir:[fx,fz], vx, vy, vz,
//       air, bpm, hand, camera?, limb? }   (all Character.shapesAt needs to replay it)
//     { type:'jump', x, y, z, air }  { type:'land', x, y, z, impact }  { type:'respawn', x, y, z }
//     { type:'step', x, y, z, foot }  { type:'blink', from, to }
//   c.startMove(name | def, opts?) → bool    c.hitShapes() / hurtShapes() / standShape()    c.applyKnock(vx, vy, s, vz)
//   c.setPoseFromCamera(limbs, hasLegs)       the player's real body (Intent.limbs); fades out 0.3 s after the last.
// Static / pure: Character.shapesAt(moveEvent, t), shapesFromPose, resolveExchange, foldExchange, capsuleDistance.
import { MOVES, LOCO, J, NJ, NP, BONE, FU, ANKLE_H, tempoScale, travelAt, asMove, gingaSteps, type MoveDef, type MoveInput, type MoveStyle } from './moves';
import { ledgeY as defaultLedgeY, planeNormal, type Ledge, type StagePlane } from '../engine/camera';
import { makeIntent, type Intent, type Limb } from '../input/intent';
import { defineParams } from '../engine/params';

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const sgn = (x: number) => (x < 0 ? -1 : 1);
const wrapPi = (a: number) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
type V3 = [number, number, number];

/** the body's physics: times in seconds, distances in metres (a dancer about 1.6 m), speeds per second. The
 *  prototype's numbers times 6.38 (its world unit in metres), then tuned: a full jump 2 m, the air jump 1.5 m more,
 *  a run 4 m/s */
export const PHYS = defineParams('dancer', {
  /** collision height above the root, and half the body's width (for walls and solid ledges) */
  bodyH: 1.55,
  halfW: 0.2,
  runSpeed: 4.0,
  /** the keyboard's walk (free mode, a modifier): a walk the motion capture can match */
  walkSpeed: 1.3,
  /** reaches full speed in about 0.18 s, stops in about 0.14 s; reversing is snappier than starting */
  groundAccel: 22,
  groundDecel: 29,
  turnAccel: 45,
  airAccel: 13,
  airDrag: 5.1,
  /** with jumpV: apex 2.0 m in 0.42 s (floaty, like the prototype's); airJumpV adds 1.5 m */
  gravity: 22.7,
  jumpV: 9.53,
  airJumpV: 8.25,
  fallMul: 1.18,
  /** jump released while rising: the short hop */
  cutMul: 2.6,
  maxFall: 10, fastFall: 15, fastFallMul: 1.6,
  coyote: 0.09, jumpBuffer: 0.12, moveBuffer: 0.12,
  /** a one-way ledge is ignored this long after dropping through it */
  dropTime: 0.22,
  landSquash: 0.16,
  /** the root may hang this far past a ledge's end and still stand on it */
  ledgeMargin: 0.08,
  /** solid ledges are boxes this thick unless the ledge says `thick` */
  solidThick: 0.4,
  walls: true, wallMargin: 0.25,
  updraftGravity: 0.25, updraftJump: 0.08, slickGrip: 0.75,
  blinkDist: 1.4, blinkIframes: 0.16,
  /** momentum carried into a ground move decays at this rate (deterministic) */
  slideK: 8,
  /** physics substep: frame-rate independent to within millimetres */
  substep: 1 / 240,
  reformTime: 0.9,
  /** rad/s of visible body turn */
  turnRate: 16,
  /** moving away from the partner: back-step this long before turning to run */
  faceRunDelay: 0.22,
  /** locked view: the body turns this far (rad) toward the camera so it reads */
  viewOpen: 0.45,
  /** the bending hand's reach from the shoulder (m) */
  aimReach: 0.47,
  camHold: 0.3,
  /** below the lowest floor this far (m), a dancer has fallen out and re-forms */
  blast: 3,
  /** how fast a dancer eases onto a newly locked plane (s, a time constant) */
  lockEase: 0.22,
}, {
  runSpeed: { min: 1, max: 8, label: 'run (m/s)' },
  jumpV: { min: 4, max: 14, label: 'jump speed' },
  airJumpV: { min: 2, max: 12, label: 'air jump speed' },
  gravity: { min: 8, max: 40 },
  turnRate: { min: 2, max: 30 },
});
/** the jogo's timing windows (ms) and how close counts as near (m) */
export const COMBAT = defineParams('combat', { PARRY_MS: 150, PERFECT_MS: 90, NEAR: 0.14 });

/** where a free dancer stands: the floor's height under (x, z) (a World's groundAt) */
/** the ground for free movement: its height under (x, z), and (where it can be fallen off: the forge) the height below
 *  which a body has fallen out and re-forms at its spawn */
export interface Terrain { groundAt(x: number, z: number): number; fallY?: number }
export const FLAT: Terrain = { groundAt: () => 0 };

export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number; move?: string; id?: number; part?: string }
export interface CharEvent { type: string; [k: string]: unknown }
interface Surface { id: string; L: Ledge | null; y: number; x0: number; x1: number; solid: boolean; thick: number }
interface MoveState {
  def: MoveDef; name: string; t: number; dur: number; serial: number; yaw: number; f: [number, number];
  p0: V3; v0: V3; air: boolean; aim3: V3; aimW: V3; aimN: V3; hand: number; bpm: number; startTime: number;
  limb: Limb | null; camera: boolean; ground: boolean; perfect: boolean; off?: boolean;
}
interface MoveOpts { dir?: number; dirVec?: [number, number]; yaw?: number; aim?: [number, number]; limb?: Limb | null; camera?: boolean }
interface Choice extends MoveOpts { name: string; blink?: boolean }

const yawOf = (fx: number, fz: number) => Math.atan2(fx, fz);
const fwdOf = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];

/** the dancer's frame (landmarks, metres) into the world at root, turned by yaw */
function toWorld(out: Float32Array, local: ArrayLike<number>, root: ArrayLike<number>, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let j = 0; j < NJ; j++) {
    const x = local[3 * j], y = local[3 * j + 1], z = local[3 * j + 2];
    out[3 * j] = root[0] + x * c + z * s;
    out[3 * j + 1] = root[1] + y;
    out[3 * j + 2] = root[2] - x * s + z * c;
  }
  return out;
}
const JN = J as unknown as Record<string, number>;
const jointOf = (name: string, hand: number) => (name === 'HAND' ? (hand > 0 ? J.RW : J.LW) : name === 'ELBOW' ? (hand > 0 ? J.RE : J.LE) : JN[name]);
/** a move's hit capsule from a world pose; the throw's stream grows along the (unit) world aim */
function capsFromPose(pose: Float32Array, def: MoveDef, mt: number, dur: number, bpm: number, aimN: V3, hand: number, id: number): Capsule {
  const h = def.hit!;
  const a = jointOf(h.a, hand), b = jointOf(h.b, hand);
  const cap: Capsule = { ax: pose[3 * a], ay: pose[3 * a + 1], az: pose[3 * a + 2], bx: pose[3 * b], by: pose[3 * b + 1], bz: pose[3 * b + 2], r: h.r, move: def.name, id };
  if (h.stream) {
    const L = Math.min(h.stream.len, h.stream.speed * Math.max(0, (mt - def.active![0] * dur) / tempoScale(bpm)));
    cap.bx += aimN[0] * L; cap.by += aimN[1] * L; cap.bz += aimN[2] * L;
  }
  return cap;
}

export class Character {
  seat: number;
  aimHand: number;
  plane: StagePlane | null;
  terrain: Terrain;
  /** more ledges for the locked plane, asked each step (set ice, a partner's building) */
  extraLedges: (() => readonly Ledge[]) | null = null;
  /** what the game lays on the body each frame: the elements' perks, and `still` while a fusion holds the pair as one
   *  body (play/fusion.ts): a move started then plays where it starts (its travel and the slide it starts with
   *  absorbed: the start event carries fdir [0, 0] and no ground velocity, so Character.shapesAt replays it the same),
   *  and the stick turns the body but does not walk it */
  env: { updraft: number; slick: number; carryX: number; blink: boolean; still?: boolean } = { updraft: 0, slick: 0, carryX: 0, blink: false };
  lookAt: ArrayLike<number> | null = null;
  inputYaw = 0;
  bpm: number | null = null;
  readonly pose = new Float32Array(NP);
  readonly vel = new Float32Array(NP);
  events: CharEvent[] = [];
  /** what the retargeter should know about this frame's pose (fists, pointed feet), from the move */
  style: MoveStyle = {};
  /** the move spin-with-the-stick-up means (a flourish, e.g. a clip: dancer/clip-move.ts), or null: the plain spin */
  flourish: string | null = null;
  /** the idle, instead of the procedural ginga (a sampled clip, say): pose `out` (39 floats, metres) at a beat */
  idle: ((out: Float32Array, beat: number) => void) | null = null;
  serial = 0;
  time = 0;

  root: V3 = [0, 0, 0];
  v: V3 = [0, 0, 0];
  dir = 1;
  yaw = 0;
  grounded = false;
  support: { id: string; L?: Ledge | null } | null = null;
  move: MoveState | null = null;
  stagger = 0;
  staggerDur = 0;
  reformT = -1;
  blinkT = 0;
  landK = 0; airW = 0; runW = 0; crouchW = 0; runPhase = 0;
  energy = 0;
  lastGroundY = 0;
  camW = 0;
  camLegW = 0;
  /** the free floor's height under the dancer (or the plane's support) last step */
  groundY = 0;

  private _local = new Float32Array(NP);
  private _tmp = new Float32Array(NP);
  private _tmp2 = new Float32Array(NP);
  private _prev = new Float32Array(NP);
  private _fade = new Float32Array(NP);
  private _beat = 0;
  private _bpmEst = 112;
  private _lastBeat: number | null = null;
  private _intent: Intent = makeIntent();
  private coyote = 0; private airJumps = 1; private fastFalling = false;
  private jumpBuf = 0; private btnBuf: { b: string; t: number; auDir?: number; flick?: boolean; limb?: Limb } | null = null;
  private dropT = 0; private dropId: string | null = null;
  private awayT = 0;
  private blockStart = -1;
  private aimW = 0; private aimPos: V3 | null = null; private aimVel: V3 = [0, 0, 0];
  private cam: { limbs: Float32Array; hasLegs: boolean; t: number } | null = null;
  private fadeT = 1; private fadeDur = 0.1; private _srcKey = 'loco';
  private _respawned = false;
  /** easing onto a newly locked plane: offsets along it and off it, dying away */
  private easeS = 0;
  private easeN = 0;
  /** where a free dancer re-forms */
  home: V3 = [0, 0, 0];

  constructor(o: { seat?: number; plane?: StagePlane | null; terrain?: Terrain; aimHand?: 'L' | 'R'; x?: number; y?: number; z?: number } = {}) {
    this.seat = o.seat || 0;
    this.aimHand = (o.aimHand || 'R') === 'L' ? -1 : 1;
    this.plane = o.plane ?? null;
    this.terrain = o.terrain ?? FLAT;
    this.reset(o.x, o.y, o.z);
  }

  /** stand somewhere now (on the plane: at s = x and height y; free: at (x, y, z)); defaults to the seat's spawn */
  reset(x?: number, y?: number, z?: number) {
    const sp = this.spawnPoint();
    if (this.plane) this.root = this._planePoint(x ?? sp[0], y ?? sp[1]);
    else {
      const px = x ?? this.home[0], pz = z ?? this.home[2];
      this.root = [px, y ?? this.terrain.groundAt(px, pz), pz];
      this.home = [px, this.root[1], pz];
    }
    this.easeS = this.easeN = 0;
    this.v = [0, 0, 0];
    this.dir = this.seat ? -1 : 1;
    this.yaw = this.plane ? this._yawForDir(this.dir) : this.yaw;
    this.grounded = false; this.support = null; this.coyote = 0; this.airJumps = 1; this.fastFalling = false;
    this.jumpBuf = 0; this.btnBuf = null; this.dropT = 0; this.dropId = null;
    this.move = null; this.stagger = 0; this.staggerDur = 0; this.reformT = -1; this.blinkT = 0;
    this.landK = 0; this.airW = 0; this.runW = 0; this.crouchW = 0; this.runPhase = 0; this.awayT = 0;
    this.blockStart = -1; this.aimW = 0; this.aimPos = null; this.aimVel = [0, 0, 0];
    this.cam = null; this.camW = 0; this.camLegW = 0;
    this.fadeT = 1; this.fadeDur = 0.1; this._srcKey = 'loco';
    this.energy = 0; this.lastGroundY = this.root[1];
    this._snapToSupport(0);
    this._animate(0, makeIntent(), 0, null);
    this._prev.set(this.pose); this.vel.fill(0);
  }

  /** lock to a plane (or free with null), easing the dancer onto it from where it stands */
  setPlane(p: StagePlane | null) {
    if (p === this.plane) return;
    if (!p) {
      this.plane = null;
      this.easeS = this.easeN = 0;
      this.grounded = false; this.support = null;
      return;
    }
    this.plane = p;
    const n = planeNormal(p);
    const s = (this.root[0] - p.origin[0]) * p.right[0] + (this.root[2] - p.origin[2]) * p.right[2];
    const lim = p.halfWidth - PHYS.wallMargin;
    this.easeS = s - clamp(s, -lim, lim);
    this.easeN = (this.root[0] - p.origin[0]) * n[0] + (this.root[2] - p.origin[2]) * n[2];
    const vs = this.v[0] * p.right[0] + this.v[2] * p.right[2];
    this.v = [p.right[0] * vs, this.v[1], p.right[2] * vs];
    // the floor may be at another height on the plane: let the physics find it
    this.grounded = false; this.support = null;
    if (this.move && !this.move.air) this.move.off = true;
    const dx = this.lookAt ? (this.lookAt[0] - this.root[0]) * p.right[0] + (this.lookAt[2] - this.root[2]) * p.right[2] : Math.sin(this.yaw) * p.right[0] + Math.cos(this.yaw) * p.right[2];
    this.dir = sgn(dx);
  }

  // ------------------------------------------------------------ coordinates
  private _planePoint(s: number, y: number): V3 {
    const pl = this.plane!;
    const n = planeNormal(pl);
    return [pl.origin[0] + pl.right[0] * (s + this.easeS) + n[0] * this.easeN, pl.origin[1] + y, pl.origin[2] + pl.right[2] * (s + this.easeS) + n[2] * this.easeN];
  }
  /** the coordinate along the locked plane (the physics' own, without the ease onto it) */
  get s() { const pl = this.plane; return pl ? (this.root[0] - pl.origin[0]) * pl.right[0] + (this.root[2] - pl.origin[2]) * pl.right[2] - this.easeS : this.root[0]; }
  /** height above the plane's origin (locked) or the world's (free) */
  private get py() { return this.root[1] - (this.plane ? this.plane.origin[1] : 0); }
  private _yawForDir(dir: number) {
    const pl = this.plane, r = pl ? pl.right : [1, 0, 0], n = pl ? planeNormal(pl) : [0, 0, 1], o = pl ? PHYS.viewOpen : 0;
    return yawOf(r[0] * dir * Math.cos(o) + n[0] * Math.sin(o), r[2] * dir * Math.cos(o) + n[2] * Math.sin(o));
  }
  private spawnPoint(): [number, number] {
    const sp = this.plane?.spawns;
    return sp && sp.length ? sp[this.seat % sp.length] : [this.seat ? 1.2 : -1.2, this.plane?.ground ?? 0];
  }
  get x() { return this.root[0]; } get y() { return this.root[1]; } get z() { return this.root[2]; }
  center(): V3 {
    const p = this.pose;
    return [(p[3 * J.LH] + p[3 * J.RH] + p[3 * J.LS] + p[3 * J.RS]) / 4, (p[3 * J.LH + 1] + p[3 * J.RH + 1] + p[3 * J.LS + 1] + p[3 * J.RS + 1]) / 4, (p[3 * J.LH + 2] + p[3 * J.RH + 2] + p[3 * J.LS + 2] + p[3 * J.RS + 2]) / 4];
  }
  /** the pose on the locked plane: x along plane.right (from its origin), y up */
  pose2D(out = new Float32Array(NJ * 2)) {
    const pl = this.plane, p = this.pose, o = pl ? pl.origin : [0, 0, 0], r = pl ? pl.right : [1, 0, 0];
    for (let j = 0; j < NJ; j++) { out[2 * j] = (p[3 * j] - o[0]) * r[0] + (p[3 * j + 2] - o[2]) * r[2]; out[2 * j + 1] = p[3 * j + 1]; }
    return out;
  }

  // ------------------------------------------------------------ state flags
  get airborne() { return !this.grounded; }
  get reforming() { return this.reformT >= 0; }
  get staggered() { return this.stagger > 0; }
  private _u() { const m = this.move; return m ? clamp(m.t / m.dur, 0, 1) : 0; }
  get invulnerable() {
    if (this.reformT >= 0 || this.blinkT > 0) return true;
    const m = this.move; if (!m || !m.def.iframes) return false;
    const u = this._u(); return u >= m.def.iframes[0] && u <= m.def.iframes[1];
  }
  get dodging() { return !!(this.move && this.move.def.evade) || this.blinkT > 0; }
  get blocking() { return !!(this.move && this.move.name === 'block' && this._u() < 0.45 && this._u() > 0.04); }
  get blockAge() { return this.blocking ? this.time - this.blockStart : Infinity; }
  get flags() { return (this.dodging ? 1 : 0) | (this.airborne ? 2 : 0) | (this.blocking ? 4 : 0) | (this.dir < 0 ? 8 : 0) | (this.staggered ? 16 : 0); }
  static flagsToState(f: number) { return { dodging: !!(f & 1), airborne: !!(f & 2), blocking: !!(f & 4), facingLeft: !!(f & 8), staggered: !!(f & 16) }; }

  // ------------------------------------------------------------ stage queries (plane mode)
  private _ledgeY(L: Ledge, beat: number) { return (this.plane?.ledgeY ?? defaultLedgeY)(L, beat); }
  private _surfaces(beat: number): Surface[] {
    const out: Surface[] = [], pl = this.plane;
    if (!pl) return out;
    if (pl.ground != null) out.push({ id: '_ground', L: null, y: pl.ground, x0: -Infinity, x1: Infinity, solid: true, thick: 0 });
    const add = (L: Ledge) => out.push({ id: L.id, L, y: this._ledgeY(L, beat), x0: L.x0, x1: L.x1, solid: !!L.solid, thick: L.thick ?? PHYS.solidThick });
    for (const L of pl.ledges) add(L);
    if (this.extraLedges) for (const L of this.extraLedges()) add(L);
    return out;
  }
  private _snapToSupport(beat: number) {
    if (!this.plane) {
      const h = this.terrain.groundAt(this.root[0], this.root[2]);
      if (Math.abs(this.root[1] - h) < 0.06) { this.root[1] = h; this.grounded = true; this.support = { id: '_free' }; }
      return;
    }
    const s = this.s, y = this.py;
    for (const S of this._surfaces(beat)) {
      if (s >= S.x0 - PHYS.ledgeMargin && s <= S.x1 + PHYS.ledgeMargin && Math.abs(y - S.y) < 0.06) {
        this.root[1] = this.plane.origin[1] + S.y; this.grounded = true; this.support = { id: S.id, L: S.L }; return;
      }
    }
  }

  // ------------------------------------------------------------ public actions
  applyKnock(vx: number, vy: number, stag = 0.5, vz = 0) {
    if (this.reformT >= 0) return;
    this.v = [vx, vy, vz];
    if (this.plane) { const r = this.plane.right, vs = vx * r[0] + vz * r[2]; this.v = [r[0] * vs, vy, r[2] * vs]; }
    if (vy > 0) { this.grounded = false; this.support = null; }
    this.stagger = this.staggerDur = Math.max(0.05, stag);
    this._endMove(); this._crossfade('stagger', 0.06);
  }
  /** the player's real body this frame: 13 landmarks about the hips (metres, the dancer's own frame) */
  setPoseFromCamera(limbs: ArrayLike<number> | null, hasLegs = false) {
    if (!limbs) return;
    if (!this.cam) this.cam = { limbs: new Float32Array(NP), hasLegs: false, t: 0 };
    this.cam.limbs.set(limbs); this.cam.hasLegs = hasLegs; this.cam.t = this.time;
  }
  spawn() { this._reform(); }

  startMove(nameOrDef: string | MoveDef | MoveInput, opts: MoveOpts = {}) {
    const def = typeof nameOrDef === 'string' ? MOVES[nameOrDef] : ((nameOrDef as MoveDef).windup === undefined ? asMove(nameOrDef) : (nameOrDef as MoveDef));
    if (!def || this.reformT >= 0 || this.stagger > 0) return false;
    if (!this.grounded && !def.airOk) return false;
    if (opts.dir && this.plane) this.dir = sgn(opts.dir);
    let yaw: number;
    if (this.plane) yaw = this._yawForDir(this.dir);
    else yaw = opts.yaw ?? this.yaw;
    if (!this.plane && opts.dirVec) yaw = yawOf(opts.dirVec[0], opts.dirVec[1]);
    // travel direction (unit, world x/z): along the plane, or the body's facing when free
    // (held still by a fusion: no travel direction, so the move plays where it starts)
    const still = !!this.env.still;
    const f: [number, number] = still ? [0, 0] : this.plane ? [this.plane.right[0] * this.dir, this.plane.right[2] * this.dir] : fwdOf(yaw);
    const aimW = this._aimWorld(opts.aim);
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    const aim3: V3 = [aimW[0] * c + aimW[2] * s, aimW[1], -aimW[0] * s + aimW[2] * c];
    const bpm = this._bpm();
    const air = !this.grounded;
    const l = Math.hypot(aimW[0], aimW[1], aimW[2]) || 1;
    const m: MoveState = {
      def, name: def.name, t: 0, dur: def.dur * tempoScale(bpm), serial: ++this.serial, yaw, f,
      p0: [this.root[0], this.root[1], this.root[2]], v0: still ? [0, air ? this.v[1] : 0, 0] : air ? [this.v[0], this.v[1], this.v[2]] : [this.v[0], 0, this.v[2]], air, aim3, aimW,
      aimN: [aimW[0] / l, aimW[1] / l, aimW[2] / l], hand: this.aimHand, bpm, startTime: this.time, limb: opts.limb || null, camera: !!opts.camera,
      ground: !air, perfect: false,
    };
    // the real limb already wound up: the move starts at its active window, and the root stays the player's
    if (opts.camera && def.active) { m.t = def.active[0] * m.dur; m.off = true; }
    this.move = m;
    this.yaw = yaw;
    if (def.name === 'block') this.blockStart = this.time;
    // the 16th-note grid
    const b = this._beat;
    const s16 = b * 4, offBeats = (s16 - Math.round(s16)) / 4, offMs = (offBeats * 60000) / bpm;
    m.perfect = Math.abs(offMs) <= COMBAT.PERFECT_MS;
    this.events.push({ type: 'move', move: def.name, serial: m.serial, perfect: m.perfect, offMs: Math.round(offMs), x: this.root[0], y: this.root[1], z: this.root[2],
      dir: this.dir, yaw, aim: this._aimScreen(aimW), aim3: aim3.slice(), fdir: f.slice(), vx: m.v0[0], vy: m.v0[1], vz: m.v0[2], air, bpm, hand: this.aimHand > 0 ? 'R' : 'L',
      camera: m.camera || undefined, limb: m.limb || undefined });
    this._crossfade('move' + m.serial, def.sampled ? 0.2 : 0.08);
    return true;
  }

  // ------------------------------------------------------------ aim
  private _aimBasisRight(): V3 {
    if (this.plane) return this.plane.right;
    return [Math.cos(this.inputYaw), 0, -Math.sin(this.inputYaw)];
  }
  /** world aim vector (length 0..1) from the intent's screen-plane aim */
  private _aimWorld(aimOverride?: [number, number]): V3 {
    const it = this._intent;
    let ax: number, ay: number;
    if (aimOverride) [ax, ay] = aimOverride;
    else if (it.aimActive && Math.hypot(it.aimX, it.aimY) > 0.15) { ax = it.aimX; ay = it.aimY; }
    else {
      // along the facing, a little up
      if (!this.plane) { const f = fwdOf(this.yaw); return [f[0] * 0.9, 0.06, f[1] * 0.9]; }
      ax = this.dir * 0.9; ay = 0.06;
    }
    const r = this._aimBasisRight();
    const l = Math.hypot(ax, ay); if (l > 1) { ax /= l; ay /= l; }
    return [r[0] * ax, ay, r[2] * ax];
  }
  private _aimScreen(w: V3): [number, number] { const r = this._aimBasisRight(); return [w[0] * r[0] + w[2] * r[2], w[1]]; }

  // ------------------------------------------------------------ the frame
  private _bpm() { return clamp(this.bpm || this._bpmEst || 112, 60, 200); }

  update(dt: number, intent?: Partial<Intent> | null, beat?: number | { pos?: number; beats?: number; bpm?: number } | null) {
    dt = clamp(+dt || 0, 0, 0.1);
    const it = Object.assign(makeIntent(), intent || {});
    let bp: number | undefined, bpmIn: number | null = null;
    if (beat && typeof beat === 'object') { bp = beat.pos ?? beat.beats; bpmIn = beat.bpm ?? null; }
    else if (typeof beat === 'number') bp = beat;
    bp = Number.isFinite(bp) ? bp! : (this._lastBeat ?? 0) + (dt * this._bpm()) / 60;
    if (bpmIn) this._bpmEst = bpmIn;
    else if (this._lastBeat != null && dt > 0) {
      const inst = ((bp - this._lastBeat) / dt) * 60;
      if (inst > 40 && inst < 240) this._bpmEst += (inst - this._bpmEst) * (1 - Math.exp(-dt / 0.6));
    }
    const beat0 = this._lastBeat ?? bp;
    this._lastBeat = bp;
    this._intent = it;
    // edges into buffers
    if (it.jump) this.jumpBuf = PHYS.jumpBuffer;
    for (const b of ['punch', 'kick', 'spin', 'dodge'] as const) if (it[b]) this.btnBuf = { b, t: PHYS.moveBuffer, auDir: it.auDir, flick: it.flick };
    if (it.limb && (it.punch || it.kick) && this.cam && this.btnBuf) this.btnBuf.limb = it.limb;
    if (it.limbs) this.setPoseFromCamera(it.limbs, !!it.hasLegs);
    const n = Math.max(1, Math.ceil(dt / PHYS.substep - 1e-9)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const b = beat0 + ((bp - beat0) * (i + 1)) / n, bPrev = beat0 + ((bp - beat0) * i) / n;
      this._beat = b;
      this._step(h, it, b, bPrev);
    }
    this._beat = bp;
    this._animate(dt, it, bp, beat0);
  }

  private _step(h: number, it: Intent, beat: number, beatPrev: number) {
    this.time += h;
    this.jumpBuf = Math.max(0, this.jumpBuf - h);
    if (this.btnBuf) { this.btnBuf.t -= h; if (this.btnBuf.t <= 0) this.btnBuf = null; }
    this.coyote = Math.max(0, this.coyote - h);
    this.dropT = Math.max(0, this.dropT - h);
    this.blinkT = Math.max(0, this.blinkT - h);
    this.landK = Math.max(0, this.landK - h / PHYS.landSquash);
    if (this.easeS || this.easeN) {
      const k = Math.exp(-h / PHYS.lockEase);
      this.easeS = Math.abs(this.easeS * k) < 1e-4 ? 0 : this.easeS * k;
      this.easeN = Math.abs(this.easeN * k) < 1e-4 ? 0 : this.easeN * k;
    }
    if (this.reformT >= 0) {
      this.reformT += h;
      if (this.reformT >= PHYS.reformTime) { this.reformT = -1; this._crossfade('loco', 0.1); }
      return;
    }
    if (this.stagger > 0) { this.stagger = Math.max(0, this.stagger - h); if (this.stagger === 0) this._crossfade('loco', 0.12); }
    const env = this.env;
    // ----- decisions
    const free = this.stagger <= 0;
    const m = this.move;
    if (m) {
      const u = m.t / m.dur;
      // strike held → becomes the throw
      if (m.name === 'strike' && it.punchHeld && m.t > 0.75 * m.def.windup * tempoScale(m.bpm) && u < m.def.active![0]) { this.move = null; this.startMove('throw'); }
    }
    if (free) this._tryActions(it, beat);
    // ----- move time
    const mv = this.move;
    if (mv) {
      const hold = mv.def.hold, u = mv.t / mv.dur;
      if (!(hold && it.dodgeHeld && u >= hold.u)) mv.t += h;
      if (mv.t >= mv.dur) this._endMove();
    }
    // ----- physics
    if (this.plane) this._physPlane(h, it, beat, beatPrev, env);
    else this._physFree(h, it, env);
    // ----- facing
    if (!this.move && this.stagger <= 0) this._face(h, it);
    // ----- fallen out
    const floor = this.plane ? this.plane.origin[1] + Math.min(this.plane.ground ?? Infinity, ...this._surfaces(beat).map((S) => S.y), 0) : this.groundY;
    if (this.root[1] < floor - PHYS.blast || this.root[1] > floor + 60) this._reform();
    // (free, off the edge of a world with no ground: re-form at the spawn before landing on the catch floor far below)
    else if (!this.plane && this.terrain.fallY !== undefined && this.root[1] < this.terrain.fallY) this._reform();
  }

  private _tryActions(it: Intent, beat: number) {
    const m = this.move;
    const u = m ? m.t / m.dur : 0;
    const inRecovery = m && (m.def.active ? u > m.def.active[1] : u > 0.55);
    const canCancel = (name: string) => !m || m.def.loop || (m.name === 'block' && !it.dodgeHeld) ||
      (inRecovery && (m.def.cancelInto.includes('*') || m.def.cancelInto.includes(name)));
    // jump
    if (this.jumpBuf > 0 && canCancel('jump')) {
      if (this.grounded || this.coyote > 0) {
        const sup = this.support?.L;
        const supVy = sup && sup.bob ? (this._ledgeY(sup, beat + 0.01) - this._ledgeY(sup, beat - 0.01)) / ((0.02 * 60) / this._bpm()) : 0;
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
    if (this.move) this._endMove();
    if (this.startMove(choice.name, choice)) this.btnBuf = null;
  }

  /** which move a button means, from the stick and the state (the table in docs/extending/move.md) */
  private _choose(bb: { b: string; auDir?: number; flick?: boolean; limb?: Limb }, it: Intent): Choice | null {
    const air = !this.grounded;
    let fwd: number;
    const mv = this._moveVec(it);
    if (this.plane) { const r = this.plane.right; fwd = (mv[0] * r[0] + mv[1] * r[2]) * this.dir; }
    else { const f = fwdOf(this.yaw); fwd = mv[0] * f[0] + mv[1] * f[1]; }
    const horiz = this.plane ? Math.abs(it.moveX) : Math.hypot(it.moveX, it.moveZ || 0);
    const down = it.moveY < -0.5, upw = it.moveY > 0.5;
    const dirOpts = (): MoveOpts => {
      if (this.plane) return { dir: sgn(it.auDir || it.moveX || this.dir) };
      const l = Math.hypot(mv[0], mv[1]);
      return l > 0.3 ? { dirVec: [mv[0] / l, mv[1] / l] } : {};
    };
    const o: MoveOpts = { limb: bb.limb, camera: !!bb.limb };
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
        if (upw && this.flourish && MOVES[this.flourish]) return { name: this.flourish };
        return { name: 'spin' };
      case 'dodge':
        if (this.env.blink && (air || horiz > 0.5)) return { name: air ? 'esquiva' : 'role', blink: true, ...dirOpts() };
        if (air) return { name: 'esquiva' };
        if (horiz > 0.5) return { name: 'role', ...dirOpts() };
        if (down) return { name: 'esquiva' };
        return { name: 'block' };
    }
    return null;
  }
  /** the stick in the world's x/z (camera-relative when free) */
  private _moveVec(it: Intent): [number, number] {
    if (this.plane) { const r = this.plane.right; return [r[0] * it.moveX, r[2] * it.moveX]; }
    const c = Math.cos(this.inputYaw), s = Math.sin(this.inputYaw);
    const x = it.moveX, z = -(it.moveZ || 0);           // moveZ + = into the screen = away from the camera
    return [x * c + z * s, -x * s + z * c];
  }

  private _blink(ch: Choice) {
    const from = this.root.slice();
    let d: [number, number];
    if (this.plane) d = [this.plane.right[0] * (ch.dir || this.dir), this.plane.right[2] * (ch.dir || this.dir)];
    else d = ch.dirVec || fwdOf(this.yaw);
    const steps = 12, st = PHYS.blinkDist / steps;
    for (let i = 0; i < steps; i++) {
      if (this.plane && this._solidAt(this.s + (d[0] * this.plane.right[0] + d[1] * this.plane.right[2]) * st, this.py)) break;
      this.root[0] += d[0] * st; this.root[2] += d[1] * st;
    }
    if (this.plane && PHYS.walls) this._clampWalls();
    this.blinkT = PHYS.blinkIframes;
    this.events.push({ type: 'blink', from, to: this.root.slice() });
    // the dodge still counts as a move for the rules; the blink replaces most of it
    this.startMove(ch.name, { dir: ch.dir });
    if (this.move) { this.move.t = this.move.dur * 0.6; this.move.off = true; }
    if (this.grounded) this._snapToSupport(this._beat);
  }
  private _solidAt(s: number, y: number) {
    for (const S of this._surfaces(this._beat)) {
      if (!S.L || !S.solid) continue;
      if (s + PHYS.halfW > S.x0 && s - PHYS.halfW < S.x1 && y < S.y - 1e-4 && y + PHYS.bodyH > S.y - S.thick) return true;
    }
    return false;
  }
  private _clampWalls() {
    const lim = this.plane!.halfWidth - PHYS.wallMargin, s = this.s;
    if (Math.abs(s) > lim) { const p = this._planePoint(clamp(s, -lim, lim), this.py); this.root[0] = p[0]; this.root[2] = p[2]; return true; }
    return false;
  }

  private _endMove() {
    if (!this.move) return;
    const sampled = this.move.def.sampled;
    this.move = null;
    this._crossfade('loco', sampled ? 0.25 : 0.1);
  }

  /** the kinematic root of a move from its start state (identical to Character.shapesAt) */
  static _moveRoot(m: Pick<MoveState, 'def' | 'dur' | 'p0' | 'v0' | 'air' | 'f'>, t: number): V3 {
    const k = PHYS.slideK;
    const tr = travelAt(m.def, clamp(t / m.dur, 0, 1));
    if (!m.air) {
      const sl = (1 - Math.exp(-k * t)) / k;
      return [m.p0[0] + m.v0[0] * sl + m.f[0] * tr[0], m.p0[1] + tr[1], m.p0[2] + m.v0[2] * sl + m.f[1] * tr[0]];
    }
    return [m.p0[0] + m.v0[0] * t + m.f[0] * tr[0], m.p0[1] + m.v0[1] * t - 0.5 * PHYS.gravity * t * t, m.p0[2] + m.v0[2] * t + m.f[1] * tr[0]];
  }

  private _physPlane(h: number, it: Intent, beat: number, beatPrev: number, env: Character['env']) {
    const pl = this.plane!, r = pl.right, oy = pl.origin[1];
    let s = this.s, y = this.py;
    let vs = this.v[0] * r[0] + this.v[2] * r[2], vy = this.v[1];
    const s0 = s, y0 = y;
    const m = this.move;
    const kin = !!(m && !m.off);               // the move drives the root
    if (kin) {
      const p = Character._moveRoot(m!, m!.t);
      // (the move's root is planned in the world from where it started; read it along the plane)
      const st = (p[0] - pl.origin[0]) * r[0] + (p[2] - pl.origin[2]) * r[2] - this.easeS;
      vs = (st - s) / h;
      if (m!.air) vy = (p[1] - oy - y) / h;
    } else if (this.stagger > 0) {
      if (this.grounded) vs -= sgn(vs) * Math.min(Math.abs(vs), 3 * 6.38 * h); else vs *= Math.exp(-PHYS.airDrag * 0.5 * h);
    } else if (m) {
      // a move that left its ledge coasts
    } else {
      const crouch = this.grounded && it.moveY < -0.5;
      const target = crouch || env.still ? 0 : clamp(it.moveX, -1, 1) * PHYS.runSpeed;
      if (this.grounded) {
        const grip = 1 - PHYS.slickGrip * (env.slick || 0);
        const a = (Math.abs(target) > Math.abs(vs) && sgn(target) === sgn(vs)) || Math.abs(vs) < 1e-4 ? PHYS.groundAccel : sgn(target) !== sgn(vs) && Math.abs(target) > 0.01 ? PHYS.turnAccel : PHYS.groundDecel;
        vs += clamp(target - vs, -a * grip * h, a * grip * h);
      } else {
        if (Math.abs(it.moveX) > 0.1 && !env.still) vs += clamp(target - vs, -PHYS.airAccel * h, PHYS.airAccel * h);
        else vs -= sgn(vs) * Math.min(Math.abs(vs), PHYS.airDrag * h);
      }
    }
    // gravity
    if (!this.grounded && !(kin && m!.air)) vy = this._gravity(h, vy, it, m);
    // horizontal
    s += vs * h;
    if (this.grounded && env.carryX && !kin && !env.still) s += env.carryX * h;
    const surf = this._surfaces(beat), surfPrev = this._surfaces(beatPrev);
    for (const S of surf) {
      if (!S.L || !S.solid) continue;
      const bot = S.y - S.thick;
      if (y < S.y - 1e-4 && y + PHYS.bodyH > bot && s + PHYS.halfW > S.x0 && s - PHYS.halfW < S.x1) {
        if (s0 <= (S.x0 + S.x1) / 2) s = S.x0 - PHYS.halfW; else s = S.x1 + PHYS.halfW;
        vs = 0;
      }
    }
    if (PHYS.walls) { const lim = pl.halfWidth - PHYS.wallMargin; if (Math.abs(s) > lim) { s = clamp(s, -lim, lim); vs = 0; } }
    // vertical
    let landed: number | null = null;
    if (this.grounded) {
      const S = surf.find((q) => this.support && q.id === this.support.id);
      if (S && s >= S.x0 - PHYS.ledgeMargin && s <= S.x1 + PHYS.ledgeMargin) { y = S.y; vy = 0; }
      else {
        this.grounded = false; this.support = null; this.coyote = PHYS.coyote; vy = 0;
        if (m) m.off = true;
      }
      // drop through a one-way ledge
      if (this.grounded && S && S.L && !S.solid && it.moveY < -0.6 && !kin) {
        this.grounded = false; this.dropId = S.id; this.dropT = PHYS.dropTime; this.support = null; vy = -0.3 * 6.38; this.coyote = 0;
      }
    }
    if (!this.grounded) {
      y += vy * h;
      let best: Surface | null = null;
      for (let i = 0; i < surf.length; i++) {
        const S = surf[i], Sp = surfPrev[i];
        if (s < S.x0 - PHYS.ledgeMargin || s > S.x1 + PHYS.ledgeMargin) continue;
        if (S.id === this.dropId && this.dropT > 0) continue;
        const relV = vy - (S.y - Sp.y) / h;
        if (S.id === '_ground') { if (y <= S.y && relV <= 0.006) best = !best || S.y > best.y ? S : best; continue; }
        if (relV <= 0.006 && y0 >= Sp.y - 0.02 && y <= S.y) best = !best || S.y > best.y ? S : best;
      }
      if (best) { landed = vy; y = best.y; vy = 0; this.grounded = true; this.support = { id: best.id, L: best.L }; }
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
    this.root[0] = p[0]; this.root[1] = p[1]; this.root[2] = p[2];
    if (!kin) vs = clamp(vs, -3 * PHYS.runSpeed, 3 * PHYS.runSpeed);
    this.v = [r[0] * vs, vy, r[2] * vs];
    this.groundY = oy + (this.grounded ? y : this.lastGroundY - oy);
    if (landed != null) this._onLand(landed);
    if (this.grounded) this.lastGroundY = this.root[1];
  }

  private _gravity(h: number, vy: number, it: Intent, m: MoveState | null) {
    const up = this.env.updraft || 0;
    let g = PHYS.gravity * (vy < 0 ? PHYS.fallMul : 1) * (1 - PHYS.updraftGravity * up);
    if (vy > 0 && !it.jumpHeld && !m && this.stagger <= 0) g *= PHYS.cutMul;
    if (!m && this.stagger <= 0 && vy < 1.6 && it.moveY < -0.6) this.fastFalling = true;
    if (this.fastFalling) g *= PHYS.fastFallMul;
    vy -= g * h;
    const mf = this.fastFalling ? PHYS.fastFall : PHYS.maxFall * (1 - 0.3 * up);
    return Math.max(vy, -mf);
  }

  private _physFree(h: number, it: Intent, env: Character['env']) {
    let [x, y, z] = this.root, [vx, vy, vz] = this.v;
    const m = this.move, kin = !!(m && !m.off);
    if (kin) {
      const p = Character._moveRoot(m!, m!.t);
      vx = (p[0] - x) / h; vz = (p[2] - z) / h; if (m!.air) vy = (p[1] - y) / h;
    } else if (this.stagger > 0) {
      const sp = Math.hypot(vx, vz), d = this.grounded ? 3 * 6.38 * h : 0;
      if (sp > 0) { const k = Math.max(0, sp - d) / sp; vx *= k; vz *= k; }
    } else if (m) {
      // coasting
    } else {
      const mv = this._moveVec(it);
      const crouch = this.grounded && it.moveY < -0.5;
      let tx = mv[0], tz = mv[1]; const l = Math.hypot(tx, tz); if (l > 1) { tx /= l; tz /= l; }
      const sp = crouch || env.still ? 0 : it.walk ? PHYS.walkSpeed : PHYS.runSpeed;
      tx *= sp; tz *= sp;
      const a = (this.grounded ? PHYS.groundAccel * (1 - PHYS.slickGrip * (env.slick || 0)) : PHYS.airAccel) * h * (l > 0.05 ? 1 : 1.3);
      const dx = tx - vx, dz = tz - vz, dl = Math.hypot(dx, dz);
      if (dl > a) { vx += (dx / dl) * a; vz += (dz / dl) * a; } else { vx = tx; vz = tz; }
    }
    if (!this.grounded && !(kin && m!.air)) vy = this._gravity(h, vy, it, m);
    x += vx * h; z += vz * h;
    const g0 = this.terrain.groundAt(x, z);
    this.groundY = g0;
    let landed: number | null = null;
    if (this.grounded) {
      if (y - g0 > 0.25) { this.grounded = false; this.coyote = PHYS.coyote; vy = 0; if (m) m.off = true; }
      else { y = g0; vy = 0; }
    }
    if (!this.grounded) {
      y += vy * h;
      if (y <= g0 && vy <= 0.006) { landed = vy; y = g0; vy = 0; this.grounded = true; this.support = { id: '_free' }; }
    }
    this.root = [x, y, z];
    if (!kin) { const sp = Math.hypot(vx, vz), most = 3 * PHYS.runSpeed; if (sp > most) { vx *= most / sp; vz *= most / sp; } }
    this.v = [vx, vy, vz];
    if (landed != null) this._onLand(landed);
    if (this.grounded) this.lastGroundY = y;
  }

  private _onLand(vy: number) {
    this.airJumps = 1; this.fastFalling = false;
    this.landK = clamp(-vy / (1.4 * 6.38), 0.25, 1);
    if (this.move && this.move.air) this._endMove();
    if (this.move) this.move.off = true;
    this.events.push({ type: 'land', x: this.root[0], y: this.root[1], z: this.root[2], impact: -vy });
  }

  private _face(h: number, it: Intent) {
    if (this.plane) {
      const pl = this.plane, s = this.s;
      const look = this.lookAt ? (this.lookAt[0] - pl.origin[0]) * pl.right[0] + (this.lookAt[2] - pl.origin[2]) * pl.right[2] - this.easeS : null;
      if (this.grounded && Math.abs(it.moveX) > 0.3) {
        const md = sgn(it.moveX);
        if (look != null && md !== sgn(look - s)) { this.awayT += h; if (this.awayT > PHYS.faceRunDelay) this.dir = md; }
        else { this.awayT = 0; this.dir = md; }
      } else {
        this.awayT = 0;
        if (this.grounded && look != null && Math.abs(look - s) > 0.12) this.dir = sgn(look - s);
      }
      this._turnToward(this._yawForDir(this.dir), h);
    } else {
      const sp = Math.hypot(this.v[0], this.v[2]);
      let target = this.yaw;
      if (sp > 0.7) target = yawOf(this.v[0], this.v[2]);
      else if (this.lookAt) { const dx = this.lookAt[0] - this.root[0], dz = this.lookAt[2] - this.root[2]; if (Math.hypot(dx, dz) > 0.12) target = yawOf(dx, dz); }
      this._turnToward(target, h);
      this.dir = Math.sin(this.yaw) < 0 ? -1 : 1;
    }
  }
  private _turnToward(target: number, h: number) {
    const d = wrapPi(target - this.yaw), stp = PHYS.turnRate * h;
    this.yaw = Math.abs(d) <= stp ? target : this.yaw + sgn(d) * stp;
    this.yaw = wrapPi(this.yaw);
  }

  private _reform() {
    const sp = this.spawnPoint();
    if (this.plane) { this.easeS = this.easeN = 0; this.root = this._planePoint(sp[0], sp[1]); }
    else this.root = [this.home[0], this.terrain.groundAt(this.home[0], this.home[2]), this.home[2]];
    this.v = [0, 0, 0]; this.move = null; this.stagger = 0; this.grounded = false; this.support = null;
    this.reformT = 0; this.airJumps = 1; this.fastFalling = false; this.btnBuf = null; this.jumpBuf = 0;
    this.dir = this.seat ? -1 : 1; this.yaw = this.plane ? this._yawForDir(this.dir) : this.yaw;
    this._snapToSupport(this._beat || 0);
    if (!this.grounded && this.plane && this.plane.ground != null && Math.abs(sp[1] - this.plane.ground) < 0.06) { this.grounded = true; this.support = { id: '_ground' }; }
    this.events.push({ type: 'respawn', x: this.root[0], y: this.root[1], z: this.root[2] });
    this._crossfade('reform', 0);
    this._respawned = true;
  }

  private _crossfade(key: string, dur: number) {
    if (key === this._srcKey) return;
    this._srcKey = key;
    for (let i = 0; i < NP; i += 3) { this._fade[i] = this.pose[i] - this.root[0]; this._fade[i + 1] = this.pose[i + 1] - this.root[1]; this._fade[i + 2] = this.pose[i + 2] - this.root[2]; }
    this.fadeT = 0; this.fadeDur = dur;
  }

  // ------------------------------------------------------------ animation
  private _animate(dt: number, it: Intent, beat: number, beat0: number | null) {
    const L = this._local, T = this._tmp, T2 = this._tmp2;
    const speed = this.plane ? Math.abs(this.v[0] * this.plane.right[0] + this.v[2] * this.plane.right[2]) : Math.hypot(this.v[0], this.v[2]);
    const a = (k: number) => 1 - Math.exp(-dt * k);
    const runK = clamp(speed / PHYS.runSpeed, 0, 1);
    this.runW += (smooth(runK * 1.6) * (this.grounded ? 1 : 0) - this.runW) * a(10);
    this.crouchW += ((this.grounded && !this.move && this.stagger <= 0 && it.moveY < -0.5 ? 1 : 0) - this.crouchW) * a(14);
    this.airW += ((this.grounded ? 0 : 1) - this.airW) * a(this.grounded ? 22 : 12);
    const prevPhase = this.runPhase;
    // a stride is about 3 m at a run (the prototype's 0.47 world units)
    this.runPhase += (speed * dt) / 0.48;
    let src: string, yaw = this.yaw;
    const m = this.move;
    this.style = {};
    if (this.reformT >= 0) { LOCO.reform(L, this.reformT / PHYS.reformTime); src = 'reform'; }
    else if (this.stagger > 0) { LOCO.stagger(L, 1 - this.stagger / this.staggerDur); src = 'stagger'; }
    else if (m) {
      const u = clamp(m.t / m.dur, 0, 1), ctx = { hand: m.hand, aim: m.aim3, air: m.air, beat, groove: 1, t: m.t };
      m.def.pose(u, ctx, L);
      if (m.def.style) this.style = m.def.style(u, ctx);
      yaw = m.yaw; src = 'move' + m.serial;
    } else {
      if (this.idle) this.idle(L, beat); else LOCO.ginga(L, beat, 1);
      if (this.runW > 0.01) { LOCO.run(T, this.runPhase, runK); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.runW; }
      if (this.crouchW > 0.01) { LOCO.crouch(T, beat); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.crouchW; }
      if (this.landK > 0 && this.grounded) { LOCO.land(T, this.landK); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.landK * 0.8; }
      if (this.airW > 0.01) {
        const vy = this.v[1] / 6.38;
        if (vy > 0) LOCO.rise(T, clamp(vy / (PHYS.jumpV / 6.38), 0.3, 1)); else LOCO.fall(T, clamp(-vy / 1.2, 0, 1));
        LOCO.rise(T2, 0.4);
        const w = smooth((vy + 0.3) / 0.6);
        if (vy <= 0.3 && vy >= -0.3) for (let i = 0; i < NP; i++) T[i] = T[i] * (1 - w) + T2[i] * w;
        for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.airW;
      }
      src = 'loco';
      if (this.airW > 0.3) this.style = { feet: ['point', 'point'] };
      // footfalls
      if (this.grounded && dt > 0) {
        if (this.runW > 0.5) {
          const k0 = Math.floor(prevPhase / Math.PI), k1 = Math.floor(this.runPhase / Math.PI);
          if (k1 > k0) this._footfall(k1 & 1 ? 'L' : 'R');
        } else for (const st of beat0 != null && beat > beat0 && beat - beat0 < 2 ? gingaSteps(beat0, beat) : []) this._footfall(st.foot);
      }
    }
    if (src !== this._srcKey && !src.startsWith('move')) this._crossfade(src, src === 'loco' ? 0.1 : 0.06);
    toWorld(this.pose, L, this.root, yaw);
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
    this._applyAim(dt, it, m);
    // velocities
    if (this._respawned || dt <= 0) { this.vel.fill(0); this._respawned = false; }
    else {
      const k = a(30);
      for (let i = 0; i < NP; i++) this.vel[i] += (clamp((this.pose[i] - this._prev[i]) / dt, -80, 80) - this.vel[i]) * k;
    }
    this._prev.set(this.pose);
    let e = 0; for (let j = 0; j < NJ; j++) e += Math.hypot(this.vel[3 * j], this.vel[3 * j + 1], this.vel[3 * j + 2]);
    this.energy += (clamp(e / NJ / 3.8, 0, 1) - this.energy) * a(4);
  }
  private _footfall(foot: 'L' | 'R') {
    const j = foot === 'L' ? J.LA : J.RA, p = this.pose;
    this.events.push({ type: 'step', x: p[3 * j], y: this.root[1], z: p[3 * j + 2], foot });
  }

  /** the camera body: its landmarks (about the hips, the dancer's frame) turned with the dancer and laid over the
   *  pose; the arms always, the legs only while it stands and its legs are seen */
  private _applyCamera(dt: number) {
    const c = this.cam;
    const live = !!c && this.time - c.t < PHYS.camHold;
    this.camW += ((live ? 1 : 0) - this.camW) * (1 - Math.exp(-dt * 8));
    const legs = live && c!.hasLegs && this.grounded && this.reformT < 0;
    this.camLegW += ((legs ? 1 : 0) - this.camLegW) * (1 - Math.exp(-dt * 6));
    if (this.camW < 0.005 || !c) return;
    const P = this.pose, q = c.limbs, T = this._tmp;
    const hip = [(P[3 * J.LH] + P[3 * J.RH]) / 2, (P[3 * J.LH + 1] + P[3 * J.RH + 1]) / 2, (P[3 * J.LH + 2] + P[3 * J.RH + 2]) / 2];
    const hx = (q[3 * J.LH] + q[3 * J.RH]) / 2, hy = (q[3 * J.LH + 1] + q[3 * J.RH + 1]) / 2, hz = (q[3 * J.LH + 2] + q[3 * J.RH + 2]) / 2;
    // with the legs seen, the hips stand as high above the floor as the player's are above their feet
    if (this.camLegW > 0.01) {
      const minA = Math.min(q[3 * J.LA + 1], q[3 * J.RA + 1]);
      hip[1] += (this.root[1] + ANKLE_H + (hy - minA) - hip[1]) * this.camLegW;
    }
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    for (let j = 0; j < NJ; j++) {
      const x = q[3 * j] - hx, y = q[3 * j + 1] - hy, z = q[3 * j + 2] - hz;
      T[3 * j] = hip[0] + x * cy + z * sy; T[3 * j + 1] = hip[1] + y; T[3 * j + 2] = hip[2] - x * sy + z * cy;
    }
    for (let j = 0; j < NJ; j++) {
      const isLeg = j === J.LK || j === J.RK || j === J.LA || j === J.RA;
      const w = this.camW * (isLeg ? this.camLegW : 1);
      for (let k = 0; k < 3; k++) P[3 * j + k] += (T[3 * j + k] - P[3 * j + k]) * w;
    }
  }

  /** the bending hand follows the aim on a critically damped spring, the elbow bending the way it already points */
  private _applyAim(dt: number, it: Intent, m: MoveState | null) {
    let want = 0;
    if (it.aimActive && this.camW < 0.5 && this.reformT < 0 && this.stagger <= 0) want = m ? m.def.aimW : this.crouchW > 0.5 ? 0.7 : 1;
    const own = !!(m && m.def.usesHand && m.hand === this.aimHand);
    if (own) want = 0;
    const a = 1 - Math.exp(-dt * (own ? 40 : want < this.aimW ? 18 : 9));
    this.aimW += (want - this.aimW) * a;
    // the striking hand belongs to the move from its active window on (keeps live == replayed shapes)
    if (own && m!.def.active && m!.t >= m!.def.active[0] * m!.dur) this.aimW = 0;
    const P = this.pose, sj = this.aimHand > 0 ? J.RS : J.LS, ej = this.aimHand > 0 ? J.RE : J.LE, wj = this.aimHand > 0 ? J.RW : J.LW;
    const S = [P[3 * sj], P[3 * sj + 1], P[3 * sj + 2]];
    const aw = this._aimWorld();
    const reach = PHYS.aimReach;
    const tgt = [S[0] + aw[0] * reach, S[1] + aw[1] * reach, S[2] + aw[2] * reach];
    const W: V3 = [P[3 * wj], P[3 * wj + 1], P[3 * wj + 2]];
    if (!this.aimPos || this.aimW < 0.01) { this.aimPos = W.slice() as V3; this.aimVel = [0, 0, 0]; if (this.aimW < 0.01) return; }
    const w0 = 26, h = Math.min(dt, 0.05);
    for (let k = 0; k < 3; k++) {
      const acc = w0 * w0 * (tgt[k] - this.aimPos[k]) - 2 * w0 * this.aimVel[k];
      this.aimVel[k] += acc * h; this.aimPos[k] += this.aimVel[k] * h;
    }
    const w = this.aimW;
    const H = [W[0] + (this.aimPos[0] - W[0]) * w, W[1] + (this.aimPos[1] - W[1]) * w, W[2] + (this.aimPos[2] - W[2]) * w];
    // elbow: two-bone IK from the shoulder, bending the way the elbow already points
    const E = [P[3 * ej], P[3 * ej + 1], P[3 * ej + 2]];
    const a1 = BONE.UA * FU, b1 = BONE.FA * FU;
    let d = [H[0] - S[0], H[1] - S[1], H[2] - S[2]], dist = Math.hypot(d[0], d[1], d[2]);
    if (dist > (a1 + b1) * 1.02) { const k = ((a1 + b1) * 1.02) / dist; d = d.map((v) => v * k); dist = (a1 + b1) * 1.02; H[0] = S[0] + d[0]; H[1] = S[1] + d[1]; H[2] = S[2] + d[2]; }
    const n = d.map((v) => v / (dist || 1));
    let pole = [E[0] - S[0], E[1] - S[1] - 0.3 * a1, E[2] - S[2]];
    const pd = pole[0] * n[0] + pole[1] * n[1] + pole[2] * n[2];
    pole = [pole[0] - n[0] * pd, pole[1] - n[1] * pd, pole[2] - n[2] * pd];
    const pl = Math.hypot(pole[0], pole[1], pole[2]) || 1;
    const cosA = clamp((a1 * a1 + dist * dist - b1 * b1) / (2 * a1 * Math.max(dist, 1e-4)), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const NE = [S[0] + n[0] * a1 * cosA + (pole[0] / pl) * a1 * sinA, S[1] + n[1] * a1 * cosA + (pole[1] / pl) * a1 * sinA, S[2] + n[2] * a1 * cosA + (pole[2] / pl) * a1 * sinA];
    for (let k = 0; k < 3; k++) { P[3 * wj + k] = H[k]; P[3 * ej + k] = E[k] + (NE[k] - E[k]) * w; }
  }

  // ------------------------------------------------------------ combat geometry
  hitShapes(): Capsule[] {
    const m = this.move;
    if (!m || !m.def.attack || !m.def.active || !m.def.hit) return [];
    const u = m.t / m.dur;
    if (u < m.def.active[0] || u > m.def.active[1]) return [];
    if (m.limb && this.camW > 0.5) return [Character.shapesFromPose(this.pose, m.limb, m.def.hit.r, m.name, m.serial)];
    return [capsFromPose(this.pose, m.def, m.t, m.dur, m.bpm, m.aimN, m.hand, m.serial)];
  }
  hurtShapes(): Capsule[] {
    if (this.reformT >= 0) return [];
    const P = this.pose, out: Capsule[] = [];
    const c = (a: number, b: number, r: number, part: string) => out.push({ ax: P[3 * a], ay: P[3 * a + 1], az: P[3 * a + 2], bx: P[3 * b], by: P[3 * b + 1], bz: P[3 * b + 2], r: r * FU, part });
    const mid = (a: number, b: number) => [(P[3 * a] + P[3 * b]) / 2, (P[3 * a + 1] + P[3 * b + 1]) / 2, (P[3 * a + 2] + P[3 * b + 2]) / 2];
    const sh = mid(J.LS, J.RS), hp = mid(J.LH, J.RH);
    out.push({ ax: sh[0], ay: sh[1], az: sh[2], bx: hp[0], by: hp[1], bz: hp[2], r: 0.065 * FU, part: 'torso' });
    c(J.HEAD, J.HEAD, 0.055, 'head');
    c(J.LS, J.LE, 0.03, 'arm'); c(J.LE, J.LW, 0.028, 'arm'); c(J.RS, J.RE, 0.03, 'arm'); c(J.RE, J.RW, 0.028, 'arm');
    c(J.LH, J.LK, 0.04, 'leg'); c(J.LK, J.LA, 0.035, 'leg'); c(J.RH, J.RK, 0.04, 'leg'); c(J.RK, J.RA, 0.035, 'leg');
    return out;
  }
  /** where the standing body would be (a dancer in the air or mid-dodge that a strike passes through there dodged) */
  standShape(): Capsule {
    const y = this.grounded ? this.root[1] : this.lastGroundY;
    return { ax: this.root[0], ay: y + 0.2, az: this.root[2], bx: this.root[0], by: y + PHYS.bodyH - 0.2, bz: this.root[2], r: 0.22 };
  }

  /** the pose for the network: 2D on the plane and 3D, in millimetres */
  serialize() {
    const p3 = Array.from(this.pose, (v) => Math.round(v * 1000));
    const p = Array.from(this.pose2D(), (v) => Math.round(v * 1000));
    const m = this.move;
    return { p, p3, f: this.flags, e: Math.round(clamp(this.energy, 0, 1) * 255), move: m ? { name: m.name, serial: m.serial, t: m.t } : null };
  }

  // ------------------------------------------------------------ deterministic replay
  /** a move's hit capsules (world) t seconds after it started, from its 'move' event alone (this file's, or the
   *  protocol's { move, x, y, dir, aim } plus optional z, yaw, aim3, fdir, vx, vy, vz, air, bpm, hand) */
  static shapesAt(ev: Record<string, any>, t: number): Capsule[] {
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
      const c = Math.cos(-yaw), s = Math.sin(-yaw);
      aim3 = [a[0] * c, a[1], -a[0] * s];
    }
    const m = { def, dur, p0: [ev.x, ev.y, ev.z || 0] as V3, v0: [ev.vx || 0, ev.air ? ev.vy || 0 : 0, ev.vz || 0] as V3, air: !!ev.air, f };
    const root = Character._moveRoot(m, t);
    const L = new Float32Array(NP), W = new Float32Array(NP);
    def.pose(u, { hand, aim: aim3, air: !!ev.air, beat: 0, groove: 1, t }, L);
    toWorld(W, L, root, yaw);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const aw = [aim3[0] * c + aim3[2] * s, aim3[1], -aim3[0] * s + aim3[2] * c];
    const l = Math.hypot(aw[0], aw[1], aw[2]) || 1;
    return [capsFromPose(W, def, t, dur, bpm, [aw[0] / l, aw[1] / l, aw[2] / l], hand, ev.serial ?? ev.id)];
  }
  static shapesFromPose(pose: ArrayLike<number>, limb: Limb, r: number, move: string, id: number): Capsule {
    const pairs: Record<Limb, [number, number]> = { LW: [J.LE, J.LW], RW: [J.RE, J.RW], LA: [J.LK, J.LA], RA: [J.RK, J.RA] };
    const [a, b] = pairs[limb] || pairs.RW;
    return { ax: pose[3 * a], ay: pose[3 * a + 1], az: pose[3 * a + 2], bx: pose[3 * b], by: pose[3 * b + 1], bz: pose[3 * b + 2], r, move, id };
  }
}

// ------------------------------------------------------------ exchanges
/** the closest distance between two capsules' core segments, minus both radii (negative: overlapping). With a plane,
 *  depth across it is flattened away first, so a locked jogo is exactly 2D. */
export function capsuleDistance(A: Capsule, B: Capsule, plane?: { origin: ArrayLike<number>; right: [number, number, number] } | null) {
  let p = [A.ax, A.ay, A.az || 0], q = [A.bx, A.by, A.bz || 0], r = [B.ax, B.ay, B.az || 0], s = [B.bx, B.by, B.bz || 0];
  if (plane) {
    const n = planeNormal(plane);
    const fl = (v: number[]) => { const d = (v[0] - plane.origin[0]) * n[0] + (v[2] - plane.origin[2]) * n[2]; return [v[0] - n[0] * d, v[1], v[2] - n[2] * d]; };
    p = fl(p); q = fl(q); r = fl(r); s = fl(s);
  }
  return segSegDist(p, q, r, s) - A.r - B.r;
}
function segSegDist(p1: number[], q1: number[], p2: number[], q2: number[]) {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]], r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2], f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s: number, t: number;
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

export type Exchange = 'hit' | 'near' | 'dodge' | 'clash' | 'parry' | null;
export interface Defender {
  hurt: Capsule[]; hit: Capsule[]; stand: Capsule | null; invulnerable: boolean; dodging: boolean; airborne: boolean;
  blocking: boolean; blockAge: number; reforming?: boolean; plane?: StagePlane | null;
}
/** the jogo's rules for one frame of an attack (the prototype's DESIGN.md "Jogo rules"): clash = both dancers' hit
 *  capsules overlap; touching the body: i-frames or mid-dodge → dodge, a block begun within PARRY_MS → parry, a later
 *  block → near, else hit; not touching but crossing where the standing body would be while airborne or dodging →
 *  dodge; within NEAR of the body → near */
export function resolveExchange(attackerShapes: Capsule[], defender: Character | Defender, opts: { plane?: StagePlane | { origin: ArrayLike<number>; right: [number, number, number] } | null } = {}): Exchange {
  if (!attackerShapes || !attackerShapes.length || !defender) return null;
  const d: Defender = defender instanceof Character ? {
    hurt: defender.hurtShapes(), hit: defender.hitShapes(), stand: defender.standShape(), invulnerable: defender.invulnerable,
    dodging: defender.dodging, airborne: defender.airborne, blocking: defender.blocking, blockAge: defender.blockAge, reforming: defender.reforming, plane: defender.plane,
  } : defender;
  if (d.reforming) return null;
  const plane = opts.plane !== undefined ? opts.plane : d.plane || null;
  const minDist = (caps: Capsule[]) => { let m = Infinity; for (const A of attackerShapes) for (const B of caps || []) m = Math.min(m, capsuleDistance(A, B, plane)); return m; };
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

/** one attack's per-frame results folded into the one report the rules want: hit / clash / parry are decisive the
 *  moment they happen (final: report now); otherwise the best of dodge > near, reported when the window ends */
const RANK: Record<string, number> = { null: 0, near: 1, dodge: 2 };
export function foldExchange(prev: { res: Exchange; final: boolean } | null, res: Exchange) {
  if (prev && prev.final) return prev;
  if (res === 'hit' || res === 'clash' || res === 'parry') return { res, final: true };
  const p = prev ? prev.res : null;
  return { res: (RANK[String(res)] || 0) > (RANK[String(p)] || 0) ? res : p, final: false };
}

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
//   c.env           { updraft 0..1, slick 0..1, carryX (m/s), blink, still?, held? } set by the game each frame
//                   (element perks; `still`: a fusion holds the pair as one body, so moves play where they start and
//                   the stick turns the body without walking it; `held`: the duel's contact carries the body, so it
//                   starts no wall slide or run of its own).
//   c.lookAt        null | [x,y,z]: the partner. The dancer faces it when not running away from it.
//   c.inputYaw      free mode: the camera's yaw, so moveX/moveZ are camera-relative (0 = the camera at +z).
//   c.update(dt, intent, beat)   beat = a beat position or { pos, bpm }. Writes pose, vel, root, yaw; pushes events:
//     { type:'move', move, serial, perfect, offMs, x, y, z, dir, yaw, aim:[ax,ay], aim3, fdir:[fx,fz], vx, vy, vz,
//       air, bpm, hand, camera?, limb? }   (all Character.shapesAt needs to replay it)
//     { type:'jump', x, y, z, air }  { type:'land', x, y, z, impact }  { type:'respawn', x, y, z }
//     { type:'step', x, y, z, foot }  { type:'blink', from, to }
//     the duel's kit (phys = DUEL_PHYS): { type:'dash', x, y, z, dir:[x,y,z], air, s? }
//     { type:'wall', x, y, z, n:[x,z], wall, run, side? }  { type:'wallJump', x, y, z, n, wall, dir? }; 'jump' with dash
//   c.phys          PHYS (the jogo's) or DUEL_PHYS (setProfile('duel')): the duel's run and jump, wall slides, kicks and
//                   runs (plane.walls locked; terrain.solids free), the 8-way / camera-relative dash, moves that flow.
//                   State: dashing, dashReady, onWall, wallNormal, wallKick, invulnerable (+ the dash's first frames)
//   c.startMove(name | def, opts?) → bool    c.hitShapes() / hurtShapes() / standShape()    c.applyKnock(vx, vy, s, vz)
//   c.setPoseFromCamera(limbs, hasLegs)       the player's real body (Intent.limbs); fades out 0.3 s after the last.
// Static / pure: Character.shapesAt(moveEvent, t), shapesFromPose, resolveExchange, foldExchange, capsuleDistance.
import { MOVES, LOCO, J, NJ, NP, BONE, FU, ANKLE_H, tempoScale, travelAt, asMove, gingaSteps, type MoveDef, type MoveInput, type MoveStyle } from './moves';
import { ledgeY as defaultLedgeY, planeNormal, type Ledge, type StagePlane } from '../engine/camera';
import { makeIntent, type Intent, type Limb } from '../input/intent';
import { wallPose, dashPose } from './kit-poses';
import { solidContact, solidTop, solidBound, type Solid } from './solid-contact';
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
  // ---- the duel's movement kit (docs/design/duel.md): off in the jogo, on in DUEL_PHYS. Locked to a plane only.
  /** over top speed with the stick held the same way, it bleeds off this fast (m/s²): on the ground and in the air
   *  (0: as fast as groundDecel / airAccel, the jogo's, as before: momentum doesn't carry there) */
  groundOver: 0,
  airOver: 0,
  /** a landing faster than this (m/s) skids for landLag (s) with no grip (the jogo: never) */
  landHuge: Infinity,
  landLag: 0,
  /** wall slide and wall jump, against StagePlane.walls and the plane's ends */
  wallSlide: false,
  /** the slide's top speed down a wall (m/s), and how hard a faster fall is braked to it (m/s²) */
  wallSlideSpeed: 2.6,
  wallFriction: 110,
  /** a slide begins only below this upward speed (m/s): pushing in while still rising fast just rises */
  wallStartVy: 1.5,
  /** a wall jump reaches a wall this far off (m), and still works this long after leaving one (s) */
  wallReach: 0.14,
  wallCoyote: 0.1,
  /** sliding, the stick let go or pushed away holds the body on the wall this long (s), so jump-away is reliable */
  wallStick: 0.14,
  /** the kick off a wall: away (m/s) and up (m/s); the stick can't pull the body back toward that wall this long (s) */
  wallJumpX: 7.5,
  wallJumpY: 12.5,
  wallLock: 0.16,
  /** the dash: 8-way (the stick; none = the facing), this fast (m/s) for this long (s), the first dashIframes (s)
   *  hard to hit; it leaves at dashEndMul of its speed, can't be repeated for dashCool (s), and a press counts for
   *  dashBuffer (s). One per airtime: refreshed on landing and on a wall */
  /** the stick turns the body in the air too (the jogo: only on the ground) */
  airTurn: false,
  dash: false,
  dashSpeed: 20,
  dashTime: 0.15,
  dashIframes: 0.08,
  dashEndMul: 0.45,
  dashCool: 0.18,
  dashBuffer: 0.1,
  /** a jump during a dash keeps this much of the dash's speed along the plane */
  dashJumpKeep: 0.75,
  // ---- free 3D (the duel is 3D native: docs/design/duel.md's correction)
  /** free, the body is a cylinder this wide (m) against the world's solids (Terrain.solids: World.solids, columns,
   *  trunks, blades, slabs): their faces stop it and are its walls, their tops are floors it can stand on, a top at most
   *  stepUp above its feet stepped onto (the jogo: solids are the brains' business, the body passes them) */
  solidsCollide: false,
  bodyR: 0.25,
  stepUp: 0.35,
  /** the stick's run in free 3D as in the lock (accelerate, stop, turn, over top speed and the air each their own rate);
   *  off: the jogo's one rate toward the stick */
  snappy: false,
  /** a kick off a wall keeps this much of the speed along the face (free 3D) */
  wallKeep: 0.7,
  /** a wall run: meeting a face this fast along it (m/s) while pushing in runs along it for wallRunTime (s), gravity at
   *  wallRunGravity, before it slides */
  wallRunSpeed: 3.5,
  wallRunTime: 0.45,
  wallRunGravity: 0.3,
  /** and starts it rising at least this fast (m/s): a few steps up the face */
  wallRunLift: 3.5,
  /** moves flow: a move's recovery cancels into anything, a jump or a dash cuts it once its active window opens
   *  (an attack thrown is committed until then), kick or spin on a wall kicks off it into a martelo or an aú; ground
   *  moves carry their momentum (slideK) */
  flow: false,
}, {
  runSpeed: { min: 1, max: 8, label: 'run (m/s)' },
  jumpV: { min: 4, max: 14, label: 'jump speed' },
  airJumpV: { min: 2, max: 12, label: 'air jump speed' },
  gravity: { min: 8, max: 40 },
  turnRate: { min: 2, max: 30 },
});
/** a body's physics profile: the jogo's (PHYS) or the duel's (DUEL_PHYS); `Character.phys` */
export type Phys = typeof PHYS;

/** the duel's feel (docs/design/duel.md "The feel, in numbers"): a run at top speed in 0.1 s and stopped in 0.08 s, a
 *  snappier, heavier jump (2.2 m in a third of a second, falling faster than it rose, a tap a 0.75 m hop), fast fall,
 *  momentum that carries, wall slides and kicks, the dash. Measured by src/dancer/test/feel.test.ts (the table in
 *  docs/reports/11-move.md). The jogo's PHYS is untouched: `character.phys = DUEL_PHYS` (or setProfile('duel')) */
export const DUEL_PHYS: Phys = defineParams('duel.move', {
  ...PHYS,
  runSpeed: 6.5,
  groundAccel: 65, groundDecel: 82, turnAccel: 140, groundOver: 30,
  airAccel: 34, airDrag: 10, airOver: 6,
  gravity: 40, jumpV: 13.3, airJumpV: 11.5, fallMul: 1.45, cutMul: 3.2,
  maxFall: 15, fastFall: 24, fastFallMul: 2.4,
  coyote: 0.1, jumpBuffer: 0.12,
  landSquash: 0.12, landHuge: 26, landLag: 0.1,
  wallJumpX: 7.5, wallJumpY: 12,
  wallSlide: true, dash: true, airTurn: true,
  solidsCollide: true, snappy: true, flow: true,
  /** a move started at a run slides on with it (the jogo's 8 stops it in about 0.15 s) */
  slideK: 3,
  moveBuffer: 0.2,
  /** the body faces where the stick points at once (the jogo back-steps from its partner first) */
  faceRunDelay: 0,
  turnRate: 22,
}, {
  runSpeed: { min: 2, max: 12, label: 'run (m/s)' },
  jumpV: { min: 6, max: 20, label: 'jump speed' },
  gravity: { min: 15, max: 80 },
  wallSlideSpeed: { min: 0.5, max: 6, label: 'wall slide (m/s)' },
  wallJumpX: { min: 2, max: 14, label: 'wall kick out' },
  wallJumpY: { min: 4, max: 20, label: 'wall kick up' },
  dashSpeed: { min: 8, max: 40, label: 'dash (m/s)' },
  dashTime: { min: 0.05, max: 0.4, label: 'dash (s)' },
});
export const PROFILES: Record<'jogo' | 'duel', Phys> = { jogo: PHYS, duel: DUEL_PHYS };
/** the jogo's timing windows (ms) and how close counts as near (m) */
export const COMBAT = defineParams('combat', { PARRY_MS: 150, PERFECT_MS: 90, NEAR: 0.14 });

/** where a free dancer stands: the floor's height under (x, z) (a World's groundAt) */
/** the ground for free movement: its height under (x, z), and (where it can be fallen off: World.fallY) the height below
 *  which a body has fallen out and re-forms at its spawn */
export interface Terrain {
  groundAt(x: number, z: number): number; fallY?: number;
  /** the world's big solid things (World.solids): walls and floors for a body whose profile has solidsCollide */
  solids?: readonly Solid[];
}
export const FLAT: Terrain = { groundAt: () => 0 };

export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number; move?: string; id?: number; part?: string }
export interface CharEvent { type: string; [k: string]: unknown }
interface Surface { id: string; L: Ledge | null; y: number; x0: number; x1: number; solid: boolean; thick: number }
interface MoveState {
  def: MoveDef; name: string; t: number; dur: number; serial: number; yaw: number; f: [number, number];
  p0: V3; v0: V3; air: boolean; aim3: V3; aimW: V3; aimN: V3; hand: number; bpm: number; startTime: number;
  limb: Limb | null; camera: boolean; ground: boolean; perfect: boolean; off?: boolean;
  /** the gravity an air move falls by (the body's profile's) */
  g: number;
  /** how fast the momentum it started with dies on the ground (the profile's slideK) */
  k: number;
}
interface MoveOpts { dir?: number; dirVec?: [number, number]; yaw?: number; aim?: [number, number]; limb?: Limb | null; camera?: boolean; /** may start in the air though the move is a ground one (an aú kicked off a wall) */ air?: boolean }
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
   *  and the stick turns the body but does not walk it; `held` while another body carries it (the duel's contact): a
   *  held body dragged along a face is not running on it, so no wall slide or run begins (or lasts) */
  env: { updraft: number; slick: number; carryX: number; blink: boolean; still?: boolean; held?: boolean } = { updraft: 0, slick: 0, carryX: 0, blink: false };
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
  /** the body's physics profile: the jogo's PHYS, or the duel's DUEL_PHYS (wall slides and kicks, the dash, its feel) */
  phys: Phys = PHYS;
  /** sliding down a wall now: locked, which way the wall is along the plane (+1 at +s); free, 1; else 0. The wall's id
   *  (a plane wall's, '_left' / '_right' for the plane's ends, 'solid.<i>' for World.solids[i]) */
  wallSide = 0;
  wallId: string | null = null;
  /** the wall slid on (or last in reach): its face's normal, world x and z, pointing out of it toward the body */
  wallN: [number, number] = [0, 0];
  /** running along the wall's face (s left of the wall run), free 3D */
  wallRunT = 0;
  /** the dash: time left in it (s, 0 when not dashing), its velocity (world, m/s), dashes left this airtime, and the
   *  time since it began */
  dashT = 0;
  dashV: V3 = [0, 0, 0];
  dashes = 1;
  dashAge = 0;
  /** the dash's way up (-1..1: the lunge's pose) */
  dashUp = 0;
  /** how much the wall's lean and the dash's lunge show (0..1, eased) */
  wallW = 0; dashW = 0;

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
  /** the kit's timers: the wall in reach (way, id; 0 none), its coyote, the stick's pull off it, the kick's lockout and
   *  its way, the dash's buffer and cooldown, a huge landing's skid */
  private wallNear = 0; private wallNearId: string | null = null; private wallCoyoteT = 0; private wallLast = 0; private wallLastId: string | null = null;
  private wallStickT = 0; private lockT = 0; private lockDir = 0;
  /** free 3D: the normals of the wall in reach, the last one in reach, and the one kicked off (the lockout's) */
  private wallNearN: [number, number] = [0, 0]; private wallLastN: [number, number] = [0, 0]; private lockN: [number, number] = [0, 0];
  private _ct: { d: number; n: V3 } = { d: 0, n: [0, 0, 0] };
  private dashBuf = 0; private dashCoolT = 0; private landLagT = 0;
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

  constructor(o: { seat?: number; plane?: StagePlane | null; terrain?: Terrain; aimHand?: 'L' | 'R'; x?: number; y?: number; z?: number; phys?: Phys | 'jogo' | 'duel' } = {}) {
    this.seat = o.seat || 0;
    if (o.phys) this.phys = typeof o.phys === 'string' ? PROFILES[o.phys] : o.phys;
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
    this._resetKit();
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

  /** the duel's feel or the jogo's (PROFILES), or a profile of one's own */
  setProfile(p: Phys | 'jogo' | 'duel') { this.phys = typeof p === 'string' ? PROFILES[p] : p; }
  private _resetKit() {
    this.wallSide = 0; this.wallId = null; this.wallNear = 0; this.wallNearId = null; this.wallCoyoteT = 0; this.wallLast = 0; this.wallLastId = null;
    this.wallStickT = 0; this.lockT = 0; this.lockDir = 0; this.wallRunT = 0;
    this.wallN = [0, 0]; this.wallNearN = [0, 0]; this.wallLastN = [0, 0]; this.lockN = [0, 0];
    this.dashT = 0; this.dashV = [0, 0, 0]; this.dashes = 1; this.dashAge = 0; this.dashBuf = 0; this.dashCoolT = 0; this.landLagT = 0;
    this.wallW = 0; this.dashW = 0;
  }

  /** lock to a plane (or free with null), easing the dancer onto it from where it stands */
  setPlane(p: StagePlane | null) {
    if (p === this.plane) return;
    this.dashT = 0; this.wallSide = 0; this.wallId = null; this.wallNear = 0; this.wallCoyoteT = 0;
    if (!p) {
      this.plane = null;
      this.easeS = this.easeN = 0;
      this.grounded = false; this.support = null;
      return;
    }
    this.plane = p;
    const n = planeNormal(p);
    const s = (this.root[0] - p.origin[0]) * p.right[0] + (this.root[2] - p.origin[2]) * p.right[2];
    const lim = p.halfWidth - this.phys.wallMargin;
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
    const pl = this.plane, r = pl ? pl.right : [1, 0, 0], n = pl ? planeNormal(pl) : [0, 0, 1], o = pl ? this.phys.viewOpen : 0;
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
  /** hard to hit: re-forming, a blink, a move's i-frames, or the first `phys.dashIframes` of a dash */
  get invulnerable() {
    if (this.reformT >= 0 || this.blinkT > 0) return true;
    if (this.dashT > 0 && this.dashAge < this.phys.dashIframes) return true;
    const m = this.move; if (!m || !m.def.iframes) return false;
    const u = this._u(); return u >= m.def.iframes[0] && u <= m.def.iframes[1];
  }
  get dodging() { return !!(this.move && this.move.def.evade) || this.blinkT > 0; }
  /** in a dash now */
  get dashing() { return this.dashT > 0; }
  /** sliding down a wall now */
  get onWall() { return this.wallSide !== 0; }
  /** which way a wall a jump would kick off now lies along the plane (+1 at +s, -1, or 0 none): in reach, or left
   *  less than wallCoyote ago. For the virtual players: what a jump means now */
  get wallKick() {
    if (!this.phys.wallSlide || this.grounded || this.coyote > 0) return 0;
    return this.wallNear || (this.wallCoyoteT > 0 ? this.wallLast : 0);
  }
  /** the normal (world x, z: out of the face toward the body) of the wall slid on, or the one a jump would kick off
   *  now; null when there is none */
  get wallNormal(): [number, number] | null {
    if (this.wallSide) return this.wallN.slice() as [number, number];
    if (!this.wallKick) return null;
    return (this.wallNear ? this.wallNearN : this.wallLastN).slice() as [number, number];
  }
  /** the dash for a HUD: 1 ready, 0 spent (in a dash, or used this airtime), between while it cools down */
  get dashReady() {
    const P = this.phys;
    if (!P.dash || this.dashT > 0 || this.reformT >= 0) return 0;
    if (!this.grounded && this.dashes <= 0) return 0;
    return 1 - clamp(this.dashCoolT / Math.max(1e-6, P.dashCool), 0, 1);
  }
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
    const add = (L: Ledge) => out.push({ id: L.id, L, y: this._ledgeY(L, beat), x0: L.x0, x1: L.x1, solid: !!L.solid, thick: L.thick ?? this.phys.solidThick });
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
      if (s >= S.x0 - this.phys.ledgeMargin && s <= S.x1 + this.phys.ledgeMargin && Math.abs(y - S.y) < 0.06) {
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
    this.dashT = 0; this.wallSide = 0; this.wallId = null;
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
    if (!this.grounded && !def.airOk && !opts.air) return false;
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
      ground: !air, perfect: false, g: this.phys.gravity, k: this.phys.slideK,
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
      camera: m.camera || undefined, limb: m.limb || undefined, ...(m.g !== PHYS.gravity ? { g: m.g } : {}), ...(m.k !== PHYS.slideK ? { k: m.k } : {}) });
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
    if (it.jump) this.jumpBuf = this.phys.jumpBuffer;
    if (it.dash && this.phys.dash) this.dashBuf = this.phys.dashBuffer;
    for (const b of ['punch', 'kick', 'spin', 'dodge'] as const) if (it[b]) this.btnBuf = { b, t: this.phys.moveBuffer, auDir: it.auDir, flick: it.flick };
    if (it.limb && (it.punch || it.kick) && this.cam && this.btnBuf) this.btnBuf.limb = it.limb;
    if (it.limbs) this.setPoseFromCamera(it.limbs, !!it.hasLegs);
    const n = Math.max(1, Math.ceil(dt / this.phys.substep - 1e-9)), h = dt / n;
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
    this.dashBuf = Math.max(0, this.dashBuf - h); this.dashCoolT = Math.max(0, this.dashCoolT - h);
    this.wallCoyoteT = Math.max(0, this.wallCoyoteT - h); this.lockT = Math.max(0, this.lockT - h); this.landLagT = Math.max(0, this.landLagT - h);
    this.landK = Math.max(0, this.landK - h / this.phys.landSquash);
    if (this.easeS || this.easeN) {
      const k = Math.exp(-h / this.phys.lockEase);
      this.easeS = Math.abs(this.easeS * k) < 1e-4 ? 0 : this.easeS * k;
      this.easeN = Math.abs(this.easeN * k) < 1e-4 ? 0 : this.easeN * k;
    }
    if (this.reformT >= 0) {
      this.reformT += h;
      if (this.reformT >= this.phys.reformTime) { this.reformT = -1; this._crossfade('loco', 0.1); }
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
    if (this.root[1] < floor - this.phys.blast || this.root[1] > floor + 60) this._reform();
    // (free, off the edge of a world with no ground: re-form at the spawn before landing on the catch floor far below)
    else if (!this.plane && this.terrain.fallY !== undefined && this.root[1] < this.terrain.fallY) this._reform();
  }

  private _tryActions(it: Intent, beat: number) {
    const m = this.move;
    const u = m ? m.t / m.dur : 0;
    const inRecovery = m && (m.def.active ? u > m.def.active[1] : u > 0.55);
    const P = this.phys;
    // (flow: the duel's moves chain: any move from another's recovery, a jump or a dash once its active window
    // opens, whatever its own list says)
    const flowAt = m ? (m.def.active ? m.def.active[0] : 0.25) : 0;
    const canCancel = (name: string) => !m || m.def.loop || (m.name === 'block' && !it.dodgeHeld) ||
      (inRecovery && (m.def.cancelInto.includes('*') || m.def.cancelInto.includes(name))) ||
      (P.flow && (!!inRecovery || ((name === 'jump' || name === 'dash') && u >= flowAt)));
    // jump (from the ground, off a wall, in the air; during a dash, keeping its speed)
    if (this.jumpBuf > 0 && canCancel('jump')) {
      const dash = this.dashT > 0;
      const wall = this.wallKick;
      if (this.grounded || this.coyote > 0) {
        const sup = this.support?.L;
        const supVy = sup && sup.bob ? (this._ledgeY(sup, beat + 0.01) - this._ledgeY(sup, beat - 0.01)) / ((0.02 * 60) / this._bpm()) : 0;
        if (dash) this._dashJump();
        this.v[1] = P.jumpV * (1 + P.updraftJump * (this.env.updraft || 0)) + Math.max(0, supVy);
        this.grounded = false; this.support = null; this.coyote = 0; this.jumpBuf = 0; this.fastFalling = false;
        if (m) this._endMove();
        this.events.push({ type: 'jump', x: this.root[0], y: this.root[1], z: this.root[2], air: false, ...(dash ? { dash: true } : {}) });
      } else if (wall) {
        if (m) this._endMove();
        this._wallJump();
      } else if (this.airJumps > 0) {
        if (dash) this._dashJump();
        this.v[1] = P.airJumpV; this.airJumps--; this.jumpBuf = 0; this.fastFalling = false;
        if (m) this._endMove();
        this.events.push({ type: 'jump', x: this.root[0], y: this.root[1], z: this.root[2], air: true, ...(dash ? { dash: true } : {}) });
      }
    }
    // the dash: whenever a jump could start, and the dash is ready (one per airtime, cooled down)
    if (P.dash && this.dashBuf > 0 && this.dashT <= 0 && this.dashCoolT <= 0 && (this.grounded || this.dashes > 0) && (canCancel('jump') || canCancel('dash'))) {
      if (this.move) this._endMove();
      this._dash(it);
    }
    const bb = this.btnBuf;
    if (!bb) return;
    // flow: kick or spin on a wall (sliding, or one in reach in the air) kicks off it into a martelo or an aú
    if (P.flow && P.wallSlide && (bb.b === 'kick' || bb.b === 'spin') && !this.grounded && this.wallKick && canCancel(bb.b === 'kick' ? 'martelo' : 'au')) {
      if (this.move) this._endMove();
      this._wallJump();
      const away = this.plane ? { dir: this.dir } : { dirVec: [this.wallLastN[0], this.wallLastN[1]] as [number, number] };
      this.startMove(bb.b === 'kick' ? 'martelo' : 'au', { ...away, air: true });
      this.btnBuf = null;
      return;
    }
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
    const steps = 12, st = this.phys.blinkDist / steps;
    for (let i = 0; i < steps; i++) {
      if (this.plane && this._solidAt(this.s + (d[0] * this.plane.right[0] + d[1] * this.plane.right[2]) * st, this.py)) break;
      this.root[0] += d[0] * st; this.root[2] += d[1] * st;
    }
    if (this.plane && this.phys.walls) this._clampWalls();
    this.blinkT = this.phys.blinkIframes;
    this.events.push({ type: 'blink', from, to: this.root.slice() });
    // the dodge still counts as a move for the rules; the blink replaces most of it
    this.startMove(ch.name, { dir: ch.dir });
    if (this.move) { this.move.t = this.move.dur * 0.6; this.move.off = true; }
    if (this.grounded) this._snapToSupport(this._beat);
  }
  // ------------------------------------------------------------ the duel's kit: the dash, the wall jump
  /** a dash. Locked: 8-way, the stick snapped to the nearest 45° (too little stick: the facing). Free 3D: along the
   *  stick (camera-relative; none: the facing), up with jump held, down with the stick down (crouch), 45° with both, or
   *  straight up or down alone. On the ground, down is along it; up leaves it. Spends the airtime's dash in the air
   *  (refreshed on landing and on a wall) */
  private _dash(it: Intent) {
    const P = this.phys;
    let dir: V3, ds = 0;
    if (this.plane) {
      let dx = 0, dy = 0;
      const mx = clamp(it.moveX, -1, 1), my = clamp(it.moveY, -1, 1);
      if (Math.hypot(mx, my) >= 0.35) {
        const a = Math.round(Math.atan2(my, mx) / (Math.PI / 4)) * (Math.PI / 4);
        dx = Math.abs(Math.cos(a)) < 1e-6 ? 0 : Math.cos(a); dy = Math.abs(Math.sin(a)) < 1e-6 ? 0 : Math.sin(a);
      } else dx = this.dir;
      if (this.grounded && dy < 0) { dy = 0; dx = dx ? sgn(dx) : this.dir; }
      if (dx) this.dir = sgn(dx);
      const r = this.plane.right;
      dir = [r[0] * dx, dy, r[2] * dx]; ds = dx;
    } else {
      const mv = this._moveVec(it), l = Math.hypot(mv[0], mv[1]);
      let up = it.jumpHeld ? 1 : !this.grounded && it.moveY < -0.5 ? -1 : 0;
      let hx = 0, hz = 0;
      if (l >= 0.35) { hx = mv[0] / l; hz = mv[1] / l; } else if (!up) { const f = fwdOf(this.yaw); hx = f[0]; hz = f[1]; }
      if (this.grounded && up < 0) up = 0;
      const k = hx || hz ? Math.SQRT1_2 : 1;
      dir = up ? [hx * k, up * k, hz * k] : [hx, 0, hz];
      if (hx || hz) this.yaw = yawOf(hx, hz);
    }
    if (dir[1] > 0) { this.grounded = false; this.support = null; this.coyote = 0; }
    if (!this.grounded) this.dashes = Math.max(0, this.dashes - 1);
    this.dashV = [dir[0] * P.dashSpeed, dir[1] * P.dashSpeed, dir[2] * P.dashSpeed];
    this.dashT = P.dashTime; this.dashAge = 0; this.dashBuf = 0; this.dashUp = dir[1];
    this.fastFalling = false; this.wallSide = 0; this.wallId = null; this.wallRunT = 0; this.lockT = 0;
    this.events.push({ type: 'dash', x: this.root[0], y: this.root[1], z: this.root[2], dir, air: !this.grounded, ...(this.plane ? { s: ds } : {}) });
  }
  /** a jump out of a dash keeps dashJumpKeep of its speed across the ground (the jump itself sets the rise) */
  private _dashJump() {
    const k = this.phys.dashJumpKeep;
    this.v[0] = this.dashV[0] * k; this.v[2] = this.dashV[2] * k;
    this.dashT = 0; this.dashCoolT = this.phys.dashCool;
  }
  /** kick off the wall slid on (or in reach, or just left): up and out along its normal, keeping wallKeep of the speed
   *  along its face (free 3D: a wall run carries on), the air jump and the dash back, and for wallLock the stick can't
   *  pull the body back toward it */
  private _wallJump() {
    const P = this.phys;
    const n = (this.wallSide ? this.wallN : this.wallNear ? this.wallNearN : this.wallLastN).slice() as [number, number];
    const id = this.wallSide ? this.wallId : this.wallNear ? this.wallNearId : this.wallLastId;
    const vn = this.v[0] * n[0] + this.v[2] * n[1];
    const tx = (this.v[0] - n[0] * vn) * P.wallKeep, tz = (this.v[2] - n[1] * vn) * P.wallKeep;
    this.v = [n[0] * P.wallJumpX + tx, P.wallJumpY, n[1] * P.wallJumpX + tz];
    this.grounded = false; this.support = null; this.coyote = 0; this.jumpBuf = 0; this.fastFalling = false;
    this.airJumps = 1; this.dashes = 1; this.dashT = 0;
    this.lockT = P.wallLock; this.lockN = n; this.wallLastN = n.slice() as [number, number];
    let away = 0;
    if (this.plane) { const r = this.plane.right; away = sgn(n[0] * r[0] + n[1] * r[2]); this.lockDir = -away; this.dir = away; }
    this.wallSide = 0; this.wallId = null; this.wallNear = 0; this.wallCoyoteT = 0; this.wallStickT = 0; this.wallRunT = 0;
    this.events.push({ type: 'wallJump', x: this.root[0], y: this.root[1], z: this.root[2], n, wall: id, ...(this.plane ? { dir: away } : {}) });
  }
  /** the plane's walls in its own coordinates (plane y from its origin), its ends among them: a face at s looking
   *  toward `side`, spanning y0..y1 */
  private _walls(): { id: string; s: number; side: number; y0: number; y1: number; climb: boolean }[] {
    const pl = this.plane!, P = this.phys, oy = pl.origin[1], lim = pl.halfWidth - P.wallMargin;
    const out = [
      { id: '_left', s: -lim - P.halfW, side: 1, y0: -Infinity, y1: Infinity, climb: true },
      { id: '_right', s: lim + P.halfW, side: -1, y0: -Infinity, y1: Infinity, climb: true },
    ];
    for (const w of pl.walls ?? []) out.push({ id: w.id, s: w.s, side: w.side < 0 ? -1 : 1, y0: w.y0 - oy, y1: w.y1 - oy, climb: w.climb !== false });
    return out;
  }

  private _solidAt(s: number, y: number) {
    for (const S of this._surfaces(this._beat)) {
      if (!S.L || !S.solid) continue;
      if (s + this.phys.halfW > S.x0 && s - this.phys.halfW < S.x1 && y < S.y - 1e-4 && y + this.phys.bodyH > S.y - S.thick) return true;
    }
    return false;
  }
  private _clampWalls() {
    const lim = this.plane!.halfWidth - this.phys.wallMargin, s = this.s;
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
  static _moveRoot(m: Pick<MoveState, 'def' | 'dur' | 'p0' | 'v0' | 'air' | 'f'> & { g?: number; k?: number }, t: number): V3 {
    const k = m.k ?? PHYS.slideK;
    const tr = travelAt(m.def, clamp(t / m.dur, 0, 1));
    if (!m.air) {
      const sl = (1 - Math.exp(-k * t)) / k;
      return [m.p0[0] + m.v0[0] * sl + m.f[0] * tr[0], m.p0[1] + tr[1], m.p0[2] + m.v0[2] * sl + m.f[1] * tr[0]];
    }
    return [m.p0[0] + m.v0[0] * t + m.f[0] * tr[0], m.p0[1] + m.v0[1] * t - 0.5 * (m.g ?? PHYS.gravity) * t * t, m.p0[2] + m.v0[2] * t + m.f[1] * tr[0]];
  }

  private _physPlane(h: number, it: Intent, beat: number, beatPrev: number, env: Character['env']) {
    const pl = this.plane!, r = pl.right, oy = pl.origin[1], P = this.phys;
    let s = this.s, y = this.py;
    let vs = this.v[0] * r[0] + this.v[2] * r[2], vy = this.v[1];
    const s0 = s, y0 = y;
    const m = this.move;
    const kin = !!(m && !m.off);               // the move drives the root
    const dashing = this.dashT > 0;
    if (dashing) {
      // the dash drives the body: straight, no gravity; it leaves at dashEndMul of its speed
      vs = this.dashV[0] * r[0] + this.dashV[2] * r[2]; vy = this.dashV[1];
      this.dashT -= h; this.dashAge += h;
      if (this.dashT <= 0) { this.dashT = 0; this.dashCoolT = P.dashCool; vs *= P.dashEndMul; vy *= P.dashEndMul; }
    } else if (kin) {
      const p = Character._moveRoot(m!, m!.t);
      // (the move's root is planned in the world from where it started; read it along the plane)
      const st = (p[0] - pl.origin[0]) * r[0] + (p[2] - pl.origin[2]) * r[2] - this.easeS;
      vs = (st - s) / h;
      if (m!.air) vy = (p[1] - oy - y) / h;
    } else if (this.stagger > 0) {
      if (this.grounded) vs -= sgn(vs) * Math.min(Math.abs(vs), 3 * 6.38 * h); else vs *= Math.exp(-this.phys.airDrag * 0.5 * h);
    } else if (m) {
      // a move that left its ledge coasts
    } else {
      const crouch = this.grounded && it.moveY < -0.5;
      const target = crouch || env.still ? 0 : clamp(it.moveX, -1, 1) * P.runSpeed;
      if (this.grounded && this.landLagT > 0) {
        // a huge landing skids, no grip
        vs -= sgn(vs) * Math.min(Math.abs(vs), (P.groundOver || P.groundDecel) * h);
      } else if (this.grounded) {
        const grip = 1 - P.slickGrip * (env.slick || 0);
        // speeding up, turning round, past top speed with the stick held (momentum carries: groundOver), stopping
        const a = (Math.abs(target) > Math.abs(vs) && sgn(target) === sgn(vs)) || Math.abs(vs) < 1e-4 ? P.groundAccel
          : sgn(target) !== sgn(vs) && Math.abs(target) > 0.01 ? P.turnAccel
          : sgn(target) === sgn(vs) && Math.abs(target) > 0.01 ? P.groundOver || P.groundDecel : P.groundDecel;
        vs += clamp(target - vs, -a * grip * h, a * grip * h);
      } else if (this.lockT > 0 && (Math.abs(it.moveX) <= 0.1 || sgn(it.moveX) === this.lockDir)) {
        // just kicked off a wall: the stick can't pull the body back toward it, and the kick keeps its speed
      } else if (Math.abs(it.moveX) > 0.1 && !env.still) {
        const a = sgn(target) === sgn(vs) && Math.abs(vs) > Math.abs(target) ? P.airOver || P.airAccel : P.airAccel;
        vs += clamp(target - vs, -a * h, a * h);
      } else vs -= sgn(vs) * Math.min(Math.abs(vs), P.airDrag * h);
    }
    // gravity; on a wall, the slide (held against it)
    if (this.wallSide && !this.grounded && !dashing) {
      if (vy < -P.wallSlideSpeed) vy = Math.min(-P.wallSlideSpeed, vy + P.wallFriction * h);
      else vy = Math.max(vy - P.gravity * P.fallMul * h, -P.wallSlideSpeed);
      vs = this.wallSide * 0.5;
    } else if (!this.grounded && !(kin && m!.air) && !dashing) vy = this._gravity(h, vy, it, m);
    // horizontal
    s += vs * h;
    if (this.grounded && env.carryX && !kin && !env.still) s += env.carryX * h;
    const surf = this._surfaces(beat), surfPrev = this._surfaces(beatPrev);
    for (const S of surf) {
      if (!S.L || !S.solid) continue;
      const bot = S.y - S.thick;
      if (y < S.y - 1e-4 && y + this.phys.bodyH > bot && s + this.phys.halfW > S.x0 && s - this.phys.halfW < S.x1) {
        if (s0 <= (S.x0 + S.x1) / 2) s = S.x0 - this.phys.halfW; else s = S.x1 + this.phys.halfW;
        vs = 0;
      }
    }
    if (this.phys.walls) { const lim = pl.halfWidth - this.phys.wallMargin; if (Math.abs(s) > lim) { s = clamp(s, -lim, lim); vs = 0; } }
    // the plane's walls: a body on a face's side can't pass it while their heights overlap
    if (pl.walls) for (const w of pl.walls) {
      const side = w.side < 0 ? -1 : 1;
      if (!(y < w.y1 - oy && y + P.bodyH > w.y0 - oy)) continue;
      const face = w.s + side * P.halfW;
      if (side * (s0 - face) >= -1e-3 && side * (s - face) < 0) { s = face; if (vs * side < 0) vs = 0; }
    }
    // a dash into a wall loses its way along the plane (and ends, if that was all of it)
    if (dashing && this.dashT > 0 && (this.dashV[0] !== 0 || this.dashV[2] !== 0) && vs === 0) {
      this.dashV[0] = 0; this.dashV[2] = 0;
      if (!this.dashV[1]) { this.dashT = 0; this.dashCoolT = P.dashCool; }
    }
    // vertical
    let landed: number | null = null;
    if (this.grounded) {
      const S = surf.find((q) => this.support && q.id === this.support.id);
      if (S && s >= S.x0 - this.phys.ledgeMargin && s <= S.x1 + this.phys.ledgeMargin) { y = S.y; vy = 0; }
      else {
        this.grounded = false; this.support = null; this.coyote = this.phys.coyote; vy = 0;
        if (m) m.off = true;
      }
      // drop through a one-way ledge
      if (this.grounded && S && S.L && !S.solid && it.moveY < -0.6 && !kin) {
        this.grounded = false; this.dropId = S.id; this.dropT = this.phys.dropTime; this.support = null; vy = -0.3 * 6.38; this.coyote = 0;
      }
    }
    if (!this.grounded) {
      y += vy * h;
      let best: Surface | null = null;
      for (let i = 0; i < surf.length; i++) {
        const S = surf[i], Sp = surfPrev[i];
        if (s < S.x0 - this.phys.ledgeMargin || s > S.x1 + this.phys.ledgeMargin) continue;
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
          if (vy > 0 && y0 + this.phys.bodyH <= bot + 1e-3 && y + this.phys.bodyH > bot && s + this.phys.halfW > S.x0 && s - this.phys.halfW < S.x1) { y = bot - this.phys.bodyH; vy = 0; }
        }
      }
    }
    const p = this._planePoint(s, y);
    this.root[0] = p[0]; this.root[1] = p[1]; this.root[2] = p[2];
    if (!kin) { const most = Math.max(3 * P.runSpeed, P.dash ? P.dashSpeed : 0); vs = clamp(vs, -most, most); }
    this.v = [r[0] * vs, vy, r[2] * vs];
    this.groundY = oy + (this.grounded ? y : this.lastGroundY - oy);
    if (landed != null) this._onLand(landed);
    if (this.grounded) this.lastGroundY = this.root[1];
    if (P.wallSlide) this._wallContact(s, y, vy, it, h);
  }

  /** which wall is in reach (for a wall jump, and its coyote), and the slide: it begins pushing into a climbable wall
   *  while falling (or nearly), refreshing the air jump and the dash; it holds while the body touches that wall, isn't
   *  pulled down off it, and the stick has been off it less than wallStick */
  private _wallContact(s: number, y: number, vy: number, it: Intent, h: number) {
    const P = this.phys;
    let near = 0, nearId: string | null = null, best = Infinity;
    if (!this.grounded && this.reformT < 0) {
      const mid = y + P.bodyH * 0.5;
      for (const w of this._walls()) {
        if (!w.climb || mid < w.y0 || mid > w.y1 - 0.1) continue;
        const d = w.side * (s - w.s) - P.halfW;       // the gap between the body's side and the face
        if (d < -0.05 || d > P.wallReach || d >= best) continue;
        best = d; near = -w.side; nearId = w.id;
      }
    }
    const r = this.plane!.right;
    this._wallState(near, nearId, [-near * r[0], -near * r[2]], near !== 0 && best <= 0.02, it.moveX * near > 0.3, vy, 0, it, h);
  }

  /** the wall slide's state, both views. `near`: a wall in reach (locked: its way along the plane; free: 1), its id and
   *  normal (out of it, world x z), whether the body touches it and pushes into it, the speed along its face. A slide
   *  begins pushing into a touched climbable wall while falling (or nearly), or meeting it fast along its face (free:
   *  a wall run first), refreshing the air jump and the dash; it holds while the body touches a wall, isn't pulled down
   *  off it, and the stick has been off it less than wallStick. Events: 'wall' as it begins */
  private _wallState(near: number, nearId: string | null, n: [number, number], touch: boolean, push: boolean, vy: number, along: number, it: Intent, h: number) {
    const P = this.phys;
    // the wall just kicked off isn't in reach again until the lockout is over (no second kick off it from afar)
    if (near && this.lockT > 0 && n[0] * this.lockN[0] + n[1] * this.lockN[1] > 0.7) { near = 0; nearId = null; touch = false; push = false; }
    this.wallNear = near; this.wallNearId = nearId;
    if (near) { this.wallNearN = n; this.wallCoyoteT = P.wallCoyote; this.wallLast = near; this.wallLastId = nearId; this.wallLastN = n; }
    const down = it.moveY < -0.6;
    const busy = this.grounded || this.dashT > 0 || !!this.move || this.stagger > 0 || !!this.env.held;
    if (this.wallSide) {
      if (!touch || down || busy || (this.plane && near !== this.wallSide)) { this.wallSide = 0; this.wallId = null; this.wallRunT = 0; }
      else {
        this.wallId = nearId; this.wallN = n;
        if (!push) { this.wallStickT += h; if (this.wallStickT > P.wallStick) { this.wallSide = 0; this.wallId = null; this.wallRunT = 0; } }
        else this.wallStickT = 0;
      }
    } else if (touch && push && !down && !busy && (vy <= P.wallStartVy || (!this.plane && Math.abs(along) >= P.wallRunSpeed))) {
      this.wallSide = near; this.wallId = nearId; this.wallN = n; this.wallStickT = 0;
      this.wallRunT = !this.plane && Math.abs(along) >= P.wallRunSpeed ? P.wallRunTime : 0;
      if (this.wallRunT > 0) this.v[1] = Math.max(this.v[1], P.wallRunLift);
      this.airJumps = 1; this.dashes = 1; this.fastFalling = false;
      this.events.push({ type: 'wall', x: this.root[0], y: this.root[1], z: this.root[2], n, wall: nearId, run: this.wallRunT > 0, ...(this.plane ? { side: near } : {}) });
    }
  }

  private _gravity(h: number, vy: number, it: Intent, m: MoveState | null) {
    const up = this.env.updraft || 0;
    let g = this.phys.gravity * (vy < 0 ? this.phys.fallMul : 1) * (1 - this.phys.updraftGravity * up);
    if (vy > 0 && !it.jumpHeld && !m && this.stagger <= 0) g *= this.phys.cutMul;
    if (!m && this.stagger <= 0 && vy < 1.6 && it.moveY < -0.6) this.fastFalling = true;
    if (this.fastFalling) g *= this.phys.fastFallMul;
    vy -= g * h;
    const mf = this.fastFalling ? this.phys.fastFall : this.phys.maxFall * (1 - 0.3 * up);
    return Math.max(vy, -mf);
  }

  private _physFree(h: number, it: Intent, env: Character['env']) {
    const P = this.phys;
    let [x, y, z] = this.root, [vx, vy, vz] = this.v;
    const m = this.move, kin = !!(m && !m.off);
    const dashing = this.dashT > 0;
    if (dashing) {
      // the dash drives the body: straight, no gravity; it leaves at dashEndMul of its speed
      [vx, vy, vz] = this.dashV;
      this.dashT -= h; this.dashAge += h;
      if (this.dashT <= 0) { this.dashT = 0; this.dashCoolT = P.dashCool; vx *= P.dashEndMul; vy *= P.dashEndMul; vz *= P.dashEndMul; }
    } else if (kin) {
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
      // just kicked off a wall: the stick can't pull the body back toward it
      if (this.lockT > 0) { const d = tx * this.lockN[0] + tz * this.lockN[1]; if (d < 0) { tx -= this.lockN[0] * d; tz -= this.lockN[1] * d; } }
      const sp = crouch || env.still ? 0 : it.walk ? P.walkSpeed : P.runSpeed;
      tx *= sp; tz *= sp;
      // (what's left of the stick after the lockout must be a real push, not the sliver along the face)
      if (P.snappy) [vx, vz] = this._steer(vx, vz, tx, tz, Math.hypot(tx, tz) > 0.3 * sp && l > 0.1, h, env);
      else {
        const a = (this.grounded ? P.groundAccel * (1 - P.slickGrip * (env.slick || 0)) : P.airAccel) * h * (l > 0.05 ? 1 : 1.3);
        const dx = tx - vx, dz = tz - vz, dl = Math.hypot(dx, dz);
        if (dl > a) { vx += (dx / dl) * a; vz += (dz / dl) * a; } else { vx = tx; vz = tz; }
      }
    }
    // gravity; on a wall, the run along it or the slide down it (held against it, its speed along the face kept)
    if (this.wallSide && !this.grounded && !dashing) {
      const n = this.wallN, vn = vx * n[0] + vz * n[1];
      if (vn > -0.5) { vx -= n[0] * (vn + 0.5); vz -= n[1] * (vn + 0.5); }
      if (this.wallRunT > 0) {
        this.wallRunT = Math.max(0, this.wallRunT - h);
        vy -= P.gravity * P.wallRunGravity * h;
      } else {
        if (vy < -P.wallSlideSpeed) vy = Math.min(-P.wallSlideSpeed, vy + P.wallFriction * h);
        else vy = Math.max(vy - P.gravity * P.fallMul * h, -P.wallSlideSpeed);
        // the speed along the face dies away as it slides
        const k = Math.exp(-3 * h), vn2 = vx * n[0] + vz * n[1];
        vx = n[0] * vn2 + (vx - n[0] * vn2) * k; vz = n[1] * vn2 + (vz - n[1] * vn2) * k;
      }
    } else if (!this.grounded && !(kin && m!.air) && !dashing) vy = this._gravity(h, vy, it, m);
    x += vx * h; z += vz * h;
    // the world's solids: their faces stop the body (and are its walls), their tops are floors
    const solids = P.solidsCollide ? this.terrain.solids : undefined;
    let wall: { near: number; id: string | null; n: [number, number]; gap: number } | null = null;
    if (solids && solids.length) {
      const r = this._solidsPush(solids, x, y, z);
      x = r.x; z = r.z;
      for (const n of r.pushed) {
        const vn = vx * n[0] + vz * n[1];
        if (vn < 0) { vx -= n[0] * vn; vz -= n[1] * vn; }
        if (dashing && this.dashT > 0) {
          const dn = this.dashV[0] * n[0] + this.dashV[2] * n[1];
          if (dn < 0) { this.dashV[0] -= n[0] * dn; this.dashV[2] -= n[1] * dn; }
          if (Math.hypot(this.dashV[0], this.dashV[2]) < 1 && !this.dashV[1]) { this.dashT = 0; this.dashCoolT = P.dashCool; }
        }
      }
      wall = r.wall;
    }
    const g0 = this._floorAt(solids, x, z, this.grounded ? y + P.stepUp : y + 0.02);
    this.groundY = g0;
    let landed: number | null = null;
    if (this.grounded) {
      if (y - g0 > 0.25) { this.grounded = false; this.coyote = P.coyote; vy = 0; if (m) m.off = true; }
      else { y = g0; vy = 0; }
    }
    if (!this.grounded) {
      y += vy * h;
      if (y <= g0 && vy <= 0.006) { landed = vy; y = g0; vy = 0; this.grounded = true; this.support = { id: '_free' }; }
      // a solid's underside (a lintel, a bough) stops the head
      else if (solids && vy > 0) {
        const ct = this._ct;
        for (const s of solids) {
          const b = solidBound(s);
          if (b.y0 > y + P.bodyH + 0.1 || b.y1 < y || Math.hypot(x - b.c[0], z - b.c[2]) > b.R + P.bodyR) continue;
          solidContact(s, x, y + P.bodyH, z, ct);
          if (ct.d < 0 && ct.n[1] < -0.6) { y -= -ct.d; vy = 0; if (this.dashT > 0) this.dashV[1] = Math.min(0, this.dashV[1]); }
        }
      }
    }
    this.root = [x, y, z];
    if (!kin) { const sp = Math.hypot(vx, vz), most = Math.max(3 * P.runSpeed, P.dash ? P.dashSpeed : 0); if (sp > most) { vx *= most / sp; vz *= most / sp; } }
    this.v = [vx, vy, vz];
    if (landed != null) this._onLand(landed);
    if (this.grounded) this.lastGroundY = y;
    if (P.wallSlide && solids) {
      // the wall: touched and pushed into by the stick (camera-relative), its speed along the face for a wall run
      const mv = this._moveVec(it);
      const w = !this.grounded && this.reformT < 0 ? wall : null;
      const n = w ? w.n : [0, 0] as [number, number];
      const push = !!w && -(mv[0] * n[0] + mv[1] * n[1]) > 0.3;
      const along = w ? Math.hypot(vx - n[0] * (vx * n[0] + vz * n[1]), vz - n[1] * (vx * n[0] + vz * n[1])) : 0;
      this._wallState(w ? 1 : 0, w ? w.id : null, n, !!w && w.gap <= 0.03, push, vy, along, it, h);
    }
  }

  /** the duel's run in free 3D (P.snappy): along the stick's way the speed rises at groundAccel (from a reversal at
   *  turnAccel), bleeds off over top speed at groundOver, and across it the old way dies at turnAccel (near-instant); in
   *  the air at airAccel, over top speed airOver; no stick: stopped at groundDecel, or airDrag in the air; just kicked off
   *  a wall, momentum kept */
  private _steer(vx: number, vz: number, tx: number, tz: number, stick: boolean, h: number, env: Character['env']): [number, number] {
    const P = this.phys, ground = this.grounded, grip = ground ? 1 - P.slickGrip * (env.slick || 0) : 1;
    if (ground && this.landLagT > 0) stick = false;
    if (!stick) {
      if (!ground && this.lockT > 0) return [vx, vz];
      const sp = Math.hypot(vx, vz), d = (ground ? (this.landLagT > 0 ? P.groundOver || P.groundDecel : P.groundDecel) * grip : P.airDrag) * h;
      if (sp <= d) return [0, 0];
      return [vx * (sp - d) / sp, vz * (sp - d) / sp];
    }
    const T = Math.hypot(tx, tz), ux = tx / T, uz = tz / T;
    let par = vx * ux + vz * uz, px = vx - ux * par, pz = vz - uz * par;
    const acc = (ground ? (par < 0 ? P.turnAccel : P.groundAccel) : P.airAccel) * grip * h;
    const over = (ground ? P.groundOver || P.groundDecel : P.airOver || P.airAccel) * grip * h;
    if (par > T) par = Math.max(T, par - over); else par = Math.min(T, par + acc);
    const cross = (ground ? P.turnAccel : P.airAccel) * grip * h, pl = Math.hypot(px, pz);
    if (pl <= cross) { px = 0; pz = 0; } else { px *= (pl - cross) / pl; pz *= (pl - cross) / pl; }
    return [ux * par + px, uz * par + pz];
  }

  /** the body (a cylinder bodyR wide, stepUp up to bodyH) pushed out of the solids' sides, sampled at three heights;
   *  the faces it was pushed off (their normals, world x z), and the nearest climbable face in reach at the body's
   *  middle: a wall (its gap, normal and id 'solid.<i>') */
  private _solidsPush(solids: readonly Solid[], x: number, y: number, z: number) {
    const P = this.phys, R = P.bodyR, ct = this._ct, pushed: [number, number][] = [];
    let wall: { near: number; id: string | null; n: [number, number]; gap: number } | null = null;
    const hs = [y + P.stepUp + 0.1, y + P.bodyH * 0.55, y + P.bodyH - 0.1], reach = R + P.wallReach + 0.05;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i], b = solidBound(s);
        if (b.y1 < hs[0] || b.y0 > hs[2] || Math.hypot(x - b.c[0], z - b.c[2]) > b.R + reach) continue;
        let pen = 0, nx = 0, nz = 0;
        for (let k = 0; k < 3; k++) {
          solidContact(s, x, hs[k], z, ct);
          const hl = Math.hypot(ct.n[0], ct.n[2]);
          if (hl < 0.6) continue;                       // over or under it: a floor or a ceiling, not a face
          const ux = ct.n[0] / hl, uz = ct.n[2] / hl, gap = ct.d - R;
          if (-gap > pen) { pen = -gap; nx = ux; nz = uz; }
          if (k === 1 && pass === 1 && gap <= P.wallReach && (!wall || gap < wall.gap)) wall = { near: 1, id: `solid.${i}`, n: [ux, uz], gap: Math.max(0, gap) };
        }
        if (pen > 0) { x += nx * pen; z += nz * pen; pushed.push([nx, nz]); }
      }
    }
    return { x, z, pushed, wall };
  }

  /** the floor under (x, z): the world's ground, or a solid's top no higher than `maxTop` (what the feet can reach) */
  private _floorAt(solids: readonly Solid[] | undefined, x: number, z: number, maxTop: number) {
    let g = this.terrain.groundAt(x, z);
    if (solids) for (const s of solids) {
      const b = solidBound(s);
      if (b.y1 <= g || b.y0 > maxTop || Math.hypot(x - b.c[0], z - b.c[2]) > b.R + 0.2) continue;
      const t = solidTop(s, x, z, this.phys.bodyR * 0.4);
      if (t > g && t <= maxTop) g = t;
    }
    return g;
  }

  private _onLand(vy: number) {
    this.airJumps = 1; this.fastFalling = false;
    // the kit: the dash back; a dash down into the floor ends there; a huge landing skids
    const P = this.phys;
    this.dashes = 1; this.wallSide = 0; this.wallId = null; this.lockT = 0; this.wallRunT = 0;
    if (this.dashT > 0 && this.dashV[1] < 0) {
      this.dashT = 0; this.dashCoolT = P.dashCool;
      this.v[0] *= P.dashEndMul; this.v[2] *= P.dashEndMul;
    }
    if (-vy > P.landHuge) this.landLagT = P.landLag;
    this.landK = clamp(-vy / (1.4 * 6.38), 0.25, 1);
    if (this.move && this.move.air) this._endMove();
    if (this.move) this.move.off = true;
    this.events.push({ type: 'land', x: this.root[0], y: this.root[1], z: this.root[2], impact: -vy });
  }

  private _face(h: number, it: Intent) {
    if (this.plane) {
      const pl = this.plane, s = this.s;
      const look = this.lookAt ? (this.lookAt[0] - pl.origin[0]) * pl.right[0] + (this.lookAt[2] - pl.origin[2]) * pl.right[2] - this.easeS : null;
      if (this.wallSide) { this.awayT = 0; this.dir = this.wallSide; }
      else if (this.dashT > 0) { this.awayT = 0; }
      else if ((this.grounded || this.phys.airTurn) && Math.abs(it.moveX) > 0.3) {
        const md = sgn(it.moveX);
        if (look != null && md !== sgn(look - s)) { this.awayT += h; if (this.awayT > this.phys.faceRunDelay) this.dir = md; }
        else { this.awayT = 0; this.dir = md; }
      } else {
        this.awayT = 0;
        if (this.grounded && look != null && Math.abs(look - s) > 0.12) this.dir = sgn(look - s);
      }
      this._turnToward(this._yawForDir(this.dir), h);
    } else {
      const sp = Math.hypot(this.v[0], this.v[2]);
      let target = this.yaw;
      // on a wall: turned to it (running along it, half toward the way it runs)
      if (this.wallSide) {
        const n = this.wallN, t = [this.v[0] - n[0] * (this.v[0] * n[0] + this.v[2] * n[1]), this.v[2] - n[1] * (this.v[0] * n[0] + this.v[2] * n[1])];
        const run = this.wallRunT > 0 ? 1 : 0, tl = Math.hypot(t[0], t[1]) || 1;
        target = yawOf(-n[0] + run * t[0] / tl, -n[1] + run * t[1] / tl);
      } else if (this.dashT > 0 && Math.hypot(this.dashV[0], this.dashV[2]) > 0.5) target = yawOf(this.dashV[0], this.dashV[2]);
      else if (sp > 0.7) target = yawOf(this.v[0], this.v[2]);
      else if (this.lookAt) { const dx = this.lookAt[0] - this.root[0], dz = this.lookAt[2] - this.root[2]; if (Math.hypot(dx, dz) > 0.12) target = yawOf(dx, dz); }
      this._turnToward(target, h);
      this.dir = Math.sin(this.yaw) < 0 ? -1 : 1;
    }
  }
  private _turnToward(target: number, h: number) {
    const d = wrapPi(target - this.yaw), stp = this.phys.turnRate * h;
    this.yaw = Math.abs(d) <= stp ? target : this.yaw + sgn(d) * stp;
    this.yaw = wrapPi(this.yaw);
  }

  private _reform() {
    const sp = this.spawnPoint();
    if (this.plane) { this.easeS = this.easeN = 0; this.root = this._planePoint(sp[0], sp[1]); }
    else this.root = [this.home[0], this.terrain.groundAt(this.home[0], this.home[2]), this.home[2]];
    this.v = [0, 0, 0]; this.move = null; this.stagger = 0; this.grounded = false; this.support = null;
    this.reformT = 0; this.airJumps = 1; this.fastFalling = false; this.btnBuf = null; this.jumpBuf = 0;
    this._resetKit();
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
    const runK = clamp(speed / this.phys.runSpeed, 0, 1);
    this.runW += (smooth(runK * 1.6) * (this.grounded ? 1 : 0) - this.runW) * a(10);
    this.crouchW += ((this.grounded && !this.move && this.stagger <= 0 && it.moveY < -0.5 ? 1 : 0) - this.crouchW) * a(14);
    this.airW += ((this.grounded ? 0 : 1) - this.airW) * a(this.grounded ? 22 : 12);
    this.wallW += ((this.wallSide ? 1 : 0) - this.wallW) * a(this.wallSide ? 18 : 10);
    this.dashW += ((this.dashT > 0 ? 1 : 0) - this.dashW) * a(this.dashT > 0 ? 45 : 10);
    const prevPhase = this.runPhase;
    // a stride is about 3 m at a run (the prototype's 0.47 world units)
    this.runPhase += (speed * dt) / 0.48;
    let src: string, yaw = this.yaw;
    const m = this.move;
    this.style = {};
    if (this.reformT >= 0) { LOCO.reform(L, this.reformT / this.phys.reformTime); src = 'reform'; }
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
        if (vy > 0) LOCO.rise(T, clamp(vy / (this.phys.jumpV / 6.38), 0.3, 1)); else LOCO.fall(T, clamp(-vy / 1.2, 0, 1));
        LOCO.rise(T2, 0.4);
        const w = smooth((vy + 0.3) / 0.6);
        if (vy <= 0.3 && vy >= -0.3) for (let i = 0; i < NP; i++) T[i] = T[i] * (1 - w) + T2[i] * w;
        for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.airW;
      }
      // the duel's kit: leaning into the wall it slides down (the hand toward the camera on it), the dash's lunge
      if (this.wallW > 0.01) { wallPose(T, this.dir > 0 ? 1 : -1); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.wallW; }
      if (this.dashW > 0.01) { dashPose(T, this.dashUp); for (let i = 0; i < NP; i++) L[i] += (T[i] - L[i]) * this.dashW; }
      src = 'loco';
      if (this.airW > 0.3) this.style = { feet: ['point', 'point'] };
      if (this.wallW > 0.5) this.style = { feet: ['flex', 'flex'], hands: this.dir > 0 ? ['relaxed', 'open'] : ['open', 'relaxed'] };
      if (this.dashW > 0.5) this.style = { feet: ['point', 'point'], hands: ['open', 'open'] };
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
    const live = !!c && this.time - c.t < this.phys.camHold;
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
    const reach = this.phys.aimReach;
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
    return { ax: this.root[0], ay: y + 0.2, az: this.root[2], bx: this.root[0], by: y + this.phys.bodyH - 0.2, bz: this.root[2], r: 0.22 };
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
    const m = { def, dur, p0: [ev.x, ev.y, ev.z || 0] as V3, v0: [ev.vx || 0, ev.air ? ev.vy || 0 : 0, ev.vz || 0] as V3, air: !!ev.air, f, g: ev.g ?? PHYS.gravity, k: ev.k ?? PHYS.slideK };
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

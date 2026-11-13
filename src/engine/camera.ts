// The camera rig. Three ways to look:
//   free:   Gem Dancers' orbit round the dancers (drag to turn, wheel or pinch to move in and out), following their
//           middle. When nobody has touched it for a few seconds it eases to the director's current shot
//           (engine/shots.ts), its optional idle behaviour. On a tall screen it stands back (or widens the lens) far
//           enough to keep every dancer in frame.
//   follow: (free, with `follow` set) a third-person camera behind or beside a player: the right stick or the mouse
//           turns it (`lookBy`), and when the player runs and leaves it alone it swings round behind them. It leads
//           the way they travel, holds a partner who is near, lines up with a gate the player is heading for, and its
//           boom shortens (fast) and grows back (slowly) to stay inside the world's room, above its ground and in
//           front of anything `clearance` says is in the way (a gate's disc; a world's trunks when one says so).
//   locked: it eases round to face a StagePlane, a little off square (the plane's `yaw` and `pitch`), with a long lens,
//           framing the dancers on that plane: the 2D side view a jogo locks into. The framing is a game screen: both
//           dancers inside a safe area, led by their velocity so a leap or a cartwheel is never cropped, widening
//           quickly and settling back slowly.
// Switching eases between the poses, so the camera is never cut. `apply(camera)` writes the result into weft's
// Camera; the rig itself is plain numbers and can be stepped without a GPU.
//
// Gates (src/portals) move the rig's whole state by a rigid move (`carry`) when the player it follows crosses, in the
// same frame as the player, so the rig always works in the coordinates of the world its player is in. Until the eye
// itself has come through the disc (it is still on the near side, the portals drawing the view from there), `through`
// names that disc: the eye is kept on lines through it and dollied through it within about a second, one move.
//
// A StagePlane is a vertical plane in a world, with a stage in its own 2D coordinates: s along `right` from `origin`,
// y up from the origin's height. Ledges are spans of it (one-way unless solid, bobbing with the music when they say so,
// at the height `ledgeY(ledge, beat)` gives); the ground is a floor at y (or null: a pit). The dancers' physics
// (dancer/character.ts) collides with it when locked; the camera stands on the side `planeNormal` points to.
import { spring } from 'math/time';
import type { Camera } from '@ericrius1/weft';
import { SHOTS, fitSetOf, type Shot } from './shots';
import { defineParams } from './params';

type V3 = [number, number, number];

/** a span of a stage plane a dancer can stand on: s from x0 to x1, its top at y (plane coordinates, m). One-way (jump
 *  up through it, drop down with crouch) unless `solid` (a box `thick` deep you can't pass); `bob` is how far it rises
 *  and falls with the music (m), once a bar: `ledgeY` (here, re-exported by worlds/stage.ts) gives its
 *  height at a beat, for physics and drawing alike */
export interface Ledge { id: string; x0: number; x1: number; y: number; solid?: boolean; thick?: number; bob?: number }

/** a vertical plane in a world that the view can lock to (see the file's opening note) */
export interface StagePlane {
  id: string;
  /** a point on the plane at the floor: s = 0, y = 0 */
  origin: [number, number, number];
  /** unit, horizontal: the plane's +s */
  right: [number, number, number];
  /** how much of the plane is stage (m, either side of the origin): the walls the dancers stop at */
  halfWidth: number;
  /** the floor's height (plane y, m), or null for a pit (fall out and re-form at a spawn) */
  ground: number | null;
  ledges: Ledge[];
  /** where the players appear: [s, y] per seat */
  spawns: [number, number][];
  /** the height of a ledge at a beat, when the stage moves its ledges its own way (default: `ledgeY`) */
  ledgeY?: (ledge: Ledge, beat: number) => number;
  /** how much of the plane above its floor to frame when nobody is on it (m; default 3) */
  height?: number;
  /** the lens the locked camera prefers on this stage (degrees, top to bottom; default `camera.lockLens`) */
  lens?: number;
  /** the locked camera's turn off square-on (rad about up, positive toward +right; default `camera.lockYaw`) and how
   *  far it looks down onto the stage (rad; default `camera.lockPitch`): a little of both reads better than dead flat */
  yaw?: number;
  pitch?: number;
}

/** a ledge's height at a beat: a bobbing ledge rides a sine over four beats (shared by physics and drawing) */
export function ledgeY(ledge: Ledge, beat: number) {
  return ledge.bob ? ledge.y + ledge.bob * Math.sin(beat * Math.PI * 0.5) : ledge.y;
}

/** the horizontal unit normal toward the side the locked camera stands on (right x up) */
export function planeNormal(p: { right: V3 }): V3 { return [-p.right[2], 0, p.right[0]]; }

/** a stage plane's point (s, y) in the world */
export function planePoint(p: StagePlane, s: number, y: number, out: V3 = [0, 0, 0]): V3 {
  out[0] = p.origin[0] + p.right[0] * s; out[1] = p.origin[1] + y; out[2] = p.origin[2] + p.right[2] * s;
  return out;
}

/** what a follow camera follows: a point (the player's chest, or the middle of two), the way the player faces, how
 *  fast they travel (m/s), and how far apart the players are (0 for one). The player is `RigInput.dancers[0]` */
export interface FollowTarget { x: number; y: number; z: number; yaw: number; speed: number; spread: number }

/** a gate's disc as the rig sees it (in the rig's coordinates): its centre, unit normal, in-plane axes and open radius */
export interface Disc { at: V3; n: V3; right: V3; up: V3; reach: number }

/** the disc the eye still has to come through after its player crossed (the rig was carried, the eye is behind the
 *  disc); `side` is the side the player is on (+1 in front of the disc), `t` seconds since the carry */
export interface Through extends Disc { side: number; t: number; depth: number }

/** a gate the followed player is heading for: its disc, the side the player is on, and how near (0 … 1) */
export interface Approach extends Disc { side: number; w: number }

export const cameraParams = defineParams('camera', {
  autoOrbit: true,
  orbitSpeed: 0.07,
  /** the director's shots while nobody moves the camera */
  shots: true,
  /** seconds a locked camera takes to get there (and back) */
  lockEase: 1.1,
  /** the locked view's lens (degrees, top to bottom): long, so the side view is nearly flat */
  lockLens: 18,
  /** the follow camera: how far behind (m), how high it looks down (rad), its lens, how fast it swings behind a
   *  running player when left alone (rad/s), and how long it waits first (s) */
  followDist: 4.6,
  followPitch: 0.22,
  followFov: 48,
  followSwing: 1.6,
  followWait: 1.2,
  /** how far ahead of a travelling player the follow camera aims (seconds of their speed) */
  followLead: 0.3,
  /** how hard the follow camera lines up behind a player heading for a gate (rad/s at the face) */
  gateAlign: 2.4,
  /** the locked view's default turn off square-on and look down (rad; a stage plane may say its own) */
  lockYaw: 0.1,
  lockPitch: 0.07,
  /** seconds of a dancer's velocity the locked framing looks ahead by (a leap is framed before it peaks) */
  lockLead: 0.35,
}, {
  autoOrbit: { label: 'orbit when idle' },
  orbitSpeed: { min: -0.5, max: 0.5 },
  shots: { label: "director's shots" },
  lockEase: { min: 0.2, max: 4, label: 'lock ease (s)' },
  lockLens: { min: 8, max: 40, label: 'lock lens (deg)' },
  followDist: { min: 2, max: 10, label: 'follow distance' },
  followSwing: { min: 0, max: 5, label: 'follow swing' },
  followLead: { min: 0, max: 1 },
  gateAlign: { min: 0, max: 6, label: 'line up with gates' },
  lockYaw: { min: -0.5, max: 0.5, label: 'lock turn (rad)' },
  lockPitch: { min: -0.2, max: 0.4, label: 'lock look down (rad)' },
  lockLead: { min: 0, max: 1 },
});

/** what the rig needs to know about the frame */
export interface RigInput {
  /** render width over height */
  aspect: number;
  /** each dancer's joints (pos, speed | rot | vel per joint: Skeleton.world) */
  dancers: readonly Float32Array[];
  /** where it aims on the floor (usually the dancers' middle) */
  aimX: number;
  aimZ: number;
  /** stand back this much further for a crowd (1 for a solo) */
  crowd: number;
  /** a ring of dancers (stands further back on a tall screen) */
  ring: boolean;
  /** whether the dance has started (the heap before it is framed differently) */
  awake: boolean;
  /** how far from the middle the camera may stand (the world's room) */
  room: number;
  /** the furthest it may dolly out */
  maxDist: number;
  /** the floor's height under (x, z) in the world the rig is in (the follow camera stays above it) */
  groundAt?: (x: number, z: number) => number;
}

/** the widest the lens goes on a tall screen (degrees, top to bottom) */
const WIDEST = 90;
const clampPitch = (p: number) => Math.max(-0.15, Math.min(1.5, p));
const smooth01 = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** what the locked view frames of each body: hips, knees, feet, toes, head (and its top), elbows, hands, fingertips */
const LOCK_JOINTS = [0, 3, 4, 6, 9, 10, 12, 18, 19, 22, 23, 26, 31, 32, 35];

export class CameraRig {
  mode: 'free' | 'locked' = 'free';
  // ---- free: the orbit
  yaw = 0.35;
  pitch = 0.3;
  dist = 3.7;
  height = 0.62;
  fov = 36;
  readonly target: V3 = [0, 1, 0];
  /** seconds since someone last moved the camera */
  idle = 99;
  /** the director's shot (eased to while idle) and how far it was dollied from that */
  shot: Shot = 'heap';
  zoom = 1;
  /** while the dancers are coming down between dances it stands a little further back */
  falling = false;
  // ---- follow (free, with a player to follow)
  follow: FollowTarget | null = null;
  /** seconds since the look input last moved the follow camera */
  lookIdle = 99;
  // ---- locked
  plane: StagePlane | null = null;
  /** points (x, y, z triples) to frame on the plane; when empty, the plane's stage is framed */
  framing: Float32Array = new Float32Array(0);
  framingCount = 0;
  /** the pose this frame (world): eye, the point looked at, field of view (degrees) */
  readonly eye: V3 = [0, 0, 0];
  readonly look: V3 = [0, 0, 0];
  fovNow = 36;

  private sDist = spring.create(SHOTS.heap.dist);
  private sPitch = spring.create(SHOTS.heap.pitch);
  private sHeight = spring.create(SHOTS.heap.height);
  private sFov = spring.create(SHOTS.heap.fov);
  private fitBack = 0;
  private fitWiden = 0;
  private lockW = 0;
  private lockC: V3 = [0, 1, 0];
  private lockD = 6;
  private lockFov = 20;
  private lockFresh = true;
  private freeEye: V3 = [0, 0, 0];
  private freeLook: V3 = [0, 0, 0];
  private freeFov = 36;
  private lockEye: V3 = [0, 0, 0];
  /** the locked framing's extent on the plane (u0, u1, v0, v1), eased: out quickly, back slowly */
  private lockExt = [0, 0, 0, 0];
  /** the boom's share of its length (1: all of it), eased: in quickly, out slowly */
  private pull = 1;

  /** how much of the segment from the point looked at to the eye is clear (0 … 1): the portals answer with the gates'
   *  discs (a camera must not stand behind one), a world may add its trunks and pillars. Rig coordinates */
  clearance: ((from: V3, to: V3) => number) | null = null;
  /** the disc the eye must still come through after a carry (see the file's note), or null */
  through: Through | null = null;
  /** the gate the followed player is heading for, or null (the portals set it each frame) */
  approach: Approach | null = null;

  /** the distance in focus: from the eye to what it looks at (the stage plane, locked) */
  get focus() { return Math.hypot(this.look[0] - this.eye[0], this.look[1] - this.eye[1], this.look[2] - this.eye[2]); }

  /** turn the orbit by a drag (pixels) */
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = clampPitch(this.pitch + dy * 0.004);
    this.idle = 0;
  }
  /** carried through a gate (src/portals) by a rigid move (column-major 4×4): the target and every eased point move
   *  with it, the orbit turns by the move's turn about up and rises with it, so whatever it was doing (its springs, its
   *  swing, its ease toward a lock) goes on in the new coordinates. The rig is an orbit and holds no roll or tilt: what
   *  of the move it can't hold (a floor gate to a wall gate) the portals keep as a residual over its pose and ease
   *  out. A locked plane stays the old world's (the portals don't carry a locked rig); `through` and `approach` are
   *  the portals' to set again */
  carry(m: Float32Array) {
    const pt = (p: V3) => {
      const x = p[0], y = p[1], z = p[2];
      p[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; p[1] = m[1] * x + m[5] * y + m[9] * z + m[13]; p[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    };
    const y0 = this.target[1];
    for (const p of [this.target, this.freeEye, this.freeLook, this.lockC, this.lockEye, this.eye, this.look]) pt(p);
    this.height += this.target[1] - y0;
    this.yaw += Math.atan2(m[8], m[10]);
    this.approach = null;
  }

  /** the follow camera turned by a look rate (a stick's -1..1, a mouse's more) over dt seconds */
  lookBy(x: number, y: number, dt: number) {
    if (Math.abs(x) + Math.abs(y) < 1e-3) return;
    this.yaw -= x * 2.6 * dt;
    this.pitch = Math.max(-0.1, Math.min(1.1, this.pitch - y * 1.6 * dt));
    this.lookIdle = 0;
    this.idle = 0;
  }
  /** a pinch's turn (pixels) */
  turn(dx: number, dy: number) {
    this.yaw -= dx * 0.008;
    this.pitch = clampPitch(this.pitch + dy * 0.005);
    this.idle = 0;
  }
  /** move in (k < 1) or out; the shots that follow keep it */
  dolly(k: number, maxDist = 14) {
    const was = this.dist;
    this.dist = Math.max(1.6, Math.min(maxDist, this.dist * k));
    this.zoom = Math.max(0.3, Math.min(3, this.zoom * (this.dist / was)));
    this.idle = 0;
  }
  /** frame a shot now (it eases there) */
  shoot(s: Shot) { this.shot = s; }

  /** lock to a plane (null: free again) */
  lock(plane: StagePlane | null) {
    if (plane) { this.plane = plane; this.mode = 'locked'; if (this.lockW < 0.01) this.lockFresh = true; }
    else this.mode = 'free';
  }

  update(dt: number, f: RigInput) {
    this.idle += dt;
    this.updateFree(dt, f);
    this.settleEye(dt, f);
    const want = this.mode === 'locked' && this.plane ? 1 : 0;
    // a critically damped ease of the lock's weight (lockEase seconds to get most of the way)
    const k = 1 - Math.exp(-dt * 4.6 / Math.max(0.05, cameraParams.lockEase));
    this.lockW += (want - this.lockW) * k;
    if (Math.abs(want - this.lockW) < 1e-4) this.lockW = want;
    if (this.plane && this.lockW > 0) this.updateLocked(dt, f);
    const e = smooth01(this.lockW);
    if (e <= 0) {
      this.eye[0] = this.freeEye[0]; this.eye[1] = this.freeEye[1]; this.eye[2] = this.freeEye[2];
      this.look[0] = this.freeLook[0]; this.look[1] = this.freeLook[1]; this.look[2] = this.freeLook[2];
      this.fovNow = this.freeFov;
      return;
    }
    for (let a = 0; a < 3; a++) {
      this.eye[a] = this.freeEye[a] + (this.lockEye[a] - this.freeEye[a]) * e;
      this.look[a] = this.freeLook[a] + (this.lockC[a] - this.freeLook[a]) * e;
    }
    this.fovNow = this.freeFov + (this.lockFov - this.freeFov) * e;
  }

  /** the pose into weft's camera (and its matrices for this render size) */
  apply(c: Camera, width: number, height: number) {
    const dx = this.look[0] - this.eye[0], dy = this.look[1] - this.eye[1], dz = this.look[2] - this.eye[2];
    c.position[0] = this.eye[0]; c.position[1] = this.eye[1]; c.position[2] = this.eye[2];
    // weft: yaw 0 looks down -z, positive yaw turns left; pitch up is positive
    c.yaw = Math.atan2(-dx, -dz);
    c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    c.fovY = (this.fovNow * Math.PI) / 180;
    c.update(width, height);
  }

  /** how locked it is (0 free … 1 locked), for anything that should follow the lock (wave 1: constraining dancers) */
  get locked() { return smooth01(this.lockW); }

  // ---------------------------------------------------------------- free
  private updateFree(dt: number, f: RigInput) {
    if (this.follow) { this.updateFollow(dt, this.follow, f); return; }
    this.followInit = false;
    // the director's shot while idle: each value on a spring, the yaw drifting round
    if (cameraParams.shots && this.idle >= 4) {
      const s = SHOTS[this.shot];
      const smooth = 3.4 * (this.falling ? 1.3 : 1);
      const back = this.falling ? 1.18 : 1;
      spring.damp(this.sDist, s.dist * back * this.zoom, smooth, dt);
      spring.damp(this.sPitch, s.pitch, smooth, dt);
      spring.damp(this.sHeight, s.height, smooth, dt);
      spring.damp(this.sFov, s.fov, smooth, dt);
      this.dist = this.sDist.value; this.pitch = this.sPitch.value; this.height = this.sHeight.value; this.fov = this.sFov.value;
      this.yaw += s.drift * dt * Math.min(1, (this.idle - 4) / 3);
    } else {
      // someone has the camera: the shot carries on from wherever they leave it
      for (const [sp, v] of [[this.sDist, this.dist], [this.sPitch, this.pitch], [this.sHeight, this.height], [this.sFov, this.fov]] as const) { sp.value = v; sp.velocity = 0; }
      if (!cameraParams.shots && cameraParams.autoOrbit && this.idle > 3) this.yaw += dt * cameraParams.orbitSpeed * Math.min(1, (this.idle - 3) / 2);
    }
    const aspect = f.aspect, tall = aspect < 1, D = f.dancers.length;
    // (a narrow frame keeps up with them sooner)
    const follow = 1 - Math.exp(-dt * (tall ? 2.6 : 1.5));
    this.target[0] += (f.aimX - this.target[0]) * follow;
    this.target[2] += (f.aimZ - this.target[2]) * follow;
    // on a tall screen stand back a touch so arms and partners stay in frame, and aim a little low
    const scale = f.crowd * (tall ? Math.pow(1 / aspect, f.ring || !f.awake ? 0.6 : 0.15) : 1);
    this.target[1] = this.height - (tall ? 0.2 : 0);
    // then as far back again as it takes to hold them all (what that adds is kept when someone takes the camera)
    let back = 0;
    if (tall && f.awake && this.idle >= 4) {
      const ty = Math.tan((this.fov * Math.PI) / 360);
      back = Math.max(0, this.fitDistance(f, D, ty * aspect, ty) - this.dist * scale);
    } else if (this.fitBack > 0 && this.idle < 4) { this.dist = Math.max(1.6, Math.min(f.maxDist, this.dist + this.fitBack / scale)); this.fitBack = 0; }
    this.fitBack += (back - this.fitBack) * (1 - Math.exp(-dt * (back > this.fitBack ? 2.5 : 0.5)));
    const want = this.dist * scale + this.fitBack;
    // but only as far as the world's wall: from there the lens widens instead
    const dist = tall ? Math.min(want, this.fitRoom(f)) : want;
    let widen = 0;
    if (tall) {
      let lens = Math.tan((this.fov * Math.PI) / 360) * Math.max(1, (this.dist * scale) / dist);
      if (f.awake && this.idle >= 4 && want > dist) lens = this.fitLens(f, D, aspect, dist, lens);
      widen = Math.max(0, Math.min(WIDEST, (Math.atan(lens) * 360) / Math.PI) - this.fov);
    }
    this.fitWiden = tall ? this.fitWiden + (widen - this.fitWiden) * (1 - Math.exp(-dt * (this.idle < 4 ? 8 : widen > this.fitWiden ? 2.5 : 0.5))) : 0;
    this.freeFov = Math.min(this.fov + this.fitWiden, Math.max(this.fov, WIDEST));
    const t = this.target;
    this.freeEye[0] = t[0] + Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
    this.freeEye[1] = t[1] + Math.sin(this.pitch) * dist;
    this.freeEye[2] = t[2] + Math.cos(this.yaw) * Math.cos(this.pitch) * dist;
    this.freeLook[0] = t[0]; this.freeLook[1] = t[1]; this.freeLook[2] = t[2];
  }

  /** the third-person camera: the target springs to the player (and a little ahead of where they run), the yaw is the
   *  player's to turn, and swings round behind them while they run and leave it alone, or lines up with a gate they
   *  are heading for; a partner near enough is kept in frame (the boom grows), one far off is let go */
  private followInit = false;
  private updateFollow(dt: number, F: FollowTarget, f: RigInput) {
    const P = cameraParams;
    this.lookIdle += dt;
    // the player alone (dancers[0]'s chest) once the partner is far: the middle of two is nowhere useful
    const me = f.dancers[0], o = 15 * 12;
    const alone = me ? smooth01((F.spread - 5) / 3) : 0;
    const fx = F.x + (alone ? (me[o] - F.x) * alone : 0), fy = F.y + (alone ? (me[o + 1] - 0.15 - F.y) * alone : 0), fz = F.z + (alone ? (me[o + 2] - F.z) * alone : 0);
    // a little ahead of where they travel
    const lead = Math.min(F.speed, 5) * P.followLead;
    const ax = fx + Math.sin(F.yaw) * lead, az = fz + Math.cos(F.yaw) * lead;
    if (!this.followInit) {
      this.followInit = true;
      this.target[0] = ax; this.target[1] = fy; this.target[2] = az;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.target[0] += (ax - this.target[0]) * k;
    // (quick enough upward to keep a 2 m jump in frame)
    this.target[1] += (fy - this.target[1]) * (1 - Math.exp(-dt * (fy > this.target[1] ? 7 : 4)));
    this.target[2] += (az - this.target[2]) * k;
    if (this.lookIdle > P.followWait) {
      // left alone: the pitch settles, and while they run the eye swings round behind them
      this.pitch += (P.followPitch - this.pitch) * (1 - Math.exp(-dt * 1.2));
      if (F.speed > 0.6) {
        const want = F.yaw + Math.PI, d = wrap(want - this.yaw);
        const most = P.followSwing * dt * Math.min(1, (this.lookIdle - P.followWait) / 0.8) * Math.min(1, F.speed / 2.5);
        this.yaw += Math.max(-most, Math.min(most, d));
      }
    }
    // heading for a gate: line up so the eye will pass through the disc right behind them (the eye on the line from the
    // disc's middle through the player), and look a little flatter. The player's own look input wins
    const A = this.approach;
    if (A && A.w > 0 && P.gateAlign > 0) {
      const give = A.w * Math.min(1, this.lookIdle / Math.max(0.1, P.followWait));
      const want = Math.atan2(fx - A.at[0], fz - A.at[2]), d = wrap(want - this.yaw), most = P.gateAlign * give * dt;
      this.yaw += Math.max(-most, Math.min(most, d));
      this.pitch += (Math.min(this.pitch, 0.14) - this.pitch) * (1 - Math.exp(-dt * 2 * give));
    }
    let dist = P.followDist + Math.min(F.spread, 5) * 0.45 * (1 - alone);
    this.fov = P.followFov;
    // a partner near enough is kept in frame: stand back as far as it takes (to a limit) to hold both, hips and head
    if (f.dancers.length > 1 && alone < 1) {
      const t = Math.tan((this.fov * Math.PI) / 360), tx = t * Math.max(f.aspect, 0.5);
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      for (let d = 0; d < Math.min(2, f.dancers.length); d++) {
        const w = f.dancers[d];
        for (const j of [0, 18]) {
          const x = w[j * 12] - this.target[0], y = w[j * 12 + 1] - this.target[1], z = w[j * 12 + 2] - this.target[2];
          const across = Math.abs(x * cy - z * sy), toward = (x * sy + z * cy) * cp + y * sp;
          dist = Math.max(dist, Math.min(P.followDist + 4, toward + (across + 0.5) / (0.8 * tx)));
        }
      }
    }
    this.dist = dist;
    this.freeFov = this.fov;
    const t = this.target;
    this.freeEye[0] = t[0] + Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
    this.freeEye[1] = t[1] + Math.sin(this.pitch) * dist;
    this.freeEye[2] = t[2] + Math.cos(this.yaw) * Math.cos(this.pitch) * dist;
    this.freeLook[0] = t[0]; this.freeLook[1] = t[1]; this.freeLook[2] = t[2];
  }

  /** the boom (look point to eye) shortened to what is clear: the world's room and ground for a follow camera, and
   *  `clearance` (gates' discs, trunks) for any free camera. It comes in quickly and goes back out slowly, so a trunk
   *  passing is a short dolly, not a jump. Then, after a carry, the way through the disc (`passThrough`) */
  private settleEye(dt: number, f: RigInput) {
    const T = this.freeLook, E = this.freeEye;
    const dx = E[0] - T[0], dy = E[1] - T[1], dz = E[2] - T[2], len = Math.hypot(dx, dy, dz);
    let want = 1;
    if (!this.through) {
      if (this.follow) {
        // the room: a circle about the world's middle, as far as the eye may stand
        const a = dx * dx + dz * dz, b = T[0] * dx + T[2] * dz, c = T[0] * T[0] + T[2] * T[2] - f.room * f.room;
        if (a > 1e-9 && c < 0) want = Math.min(want, (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a);
      }
      if (this.clearance) want = Math.min(want, this.clearance(T, E));
      // (never closer than a body's width: a camera inside the player is worse than one behind a leaf)
      want = Math.max(want, Math.min(1, 0.9 / Math.max(len, 1e-3)));
    }
    this.pull += (want - this.pull) * (1 - Math.exp(-dt * (want < this.pull ? 16 : 1.6)));
    E[0] = T[0] + dx * this.pull; E[1] = T[1] + dy * this.pull; E[2] = T[2] + dz * this.pull;
    if (this.through) this.passThrough(dt, T, E, len);
    else if (this.follow && f.groundAt) E[1] = Math.max(E[1], f.groundAt(E[0], E[2]) + 0.25);
  }

  /** after a carry the eye is still behind the disc its player came out of. Keep it on lines through the disc (the
   *  line from the look point to the eye meets the plane inside it, so seen from the old world it never passes beside
   *  the gate), and shorten the boom so the eye comes through within about a second: one continuous push through the
   *  door behind the player, then the boom grows back */
  private passThrough(dt: number, T: V3, E: V3, full: number) {
    const g = this.through!;
    g.t += dt;
    const side = (p: V3) => ((p[0] - g.at[0]) * g.n[0] + (p[1] - g.at[1]) * g.n[1] + (p[2] - g.at[2]) * g.n[2]) * g.side;
    const zT = side(T);
    let zE = side(E);
    if (zT <= 0 || zE >= 0) return;
    // where the line meets the plane, kept well inside the disc
    const k = zT / (zT - zE), L = Math.hypot(E[0] - T[0], E[1] - T[1], E[2] - T[2]);
    const X: V3 = [T[0] + (E[0] - T[0]) * k - g.at[0], T[1] + (E[1] - T[1]) * k - g.at[1], T[2] + (E[2] - T[2]) * k - g.at[2]];
    const lx = X[0] * g.right[0] + X[1] * g.right[1] + X[2] * g.right[2], ly = X[0] * g.up[0] + X[1] * g.up[1] + X[2] * g.up[2];
    const r = Math.hypot(lx, ly), lim = g.reach * 0.75;
    if (r > lim) {
      const s = lim / r;
      const Y: V3 = [g.at[0] + (g.right[0] * lx + g.up[0] * ly) * s, g.at[1] + (g.right[1] * lx + g.up[1] * ly) * s, g.at[2] + (g.right[2] * lx + g.up[2] * ly) * s];
      const d: V3 = [Y[0] - T[0], Y[1] - T[1], Y[2] - T[2]], dl = Math.hypot(...d) || 1;
      for (let a = 0; a < 3; a++) E[a] = T[a] + (d[a] / dl) * L;
      zE = side(E);
    }
    // how far behind the plane the eye may still be: from where it was at the carry down past the plane
    if (g.depth < 0) g.depth = -zE;
    // (slow enough that the player has walked on a couple of metres when the eye comes through, and never nearer to
    // the look point than 1.5 m: standing still at the face, the player is seen through the door until they move on)
    const e = Math.exp(-g.t / 0.8), most = g.depth * e - 0.6 * (1 - e);
    if (-zE > most) {
      const f = Math.max(Math.min(1, 1.5 / Math.max(L, 1e-3)), (zT + most) / (zT - zE));
      for (let a = 0; a < 3; a++) E[a] = T[a] + (E[a] - T[a]) * f;
    }
    // (the boom grows back from here once the eye is through)
    this.pull = Math.min(this.pull, Math.hypot(E[0] - T[0], E[1] - T[1], E[2] - T[2]) / Math.max(full, 1e-3));
  }

  /** how far from the target (along the camera's yaw and pitch) it can stand and stay inside the world's room */
  private fitRoom(f: RigInput) {
    const cp = Math.cos(this.pitch), ux = Math.sin(this.yaw) * cp, uy = Math.sin(this.pitch), uz = Math.cos(this.yaw) * cp;
    const tg = this.target, r = f.room, b = tg[0] * ux + tg[1] * uy + tg[2] * uz;
    return Math.max(1.6, Math.sqrt(Math.max(0, b * b + r * r - tg[0] * tg[0] - tg[1] * tg[1] - tg[2] * tg[2])) - b);
  }

  /** how far from the target the camera must be to hold the first D dancers */
  private fitDistance(f: RigInput, D: number, tanX: number, tanY: number) {
    const set = fitSetOf(this.shot);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    const tg = this.target;
    let need = 0;
    for (let d = 0; d < D; d++) {
      const w = f.dancers[d];
      for (let k = 0; k < set.length; k++) {
        const o = set[k] * 12, x = w[o] - tg[0], y = w[o + 1] - tg[1], z = w[o + 2] - tg[2];
        const flat = x * sy + z * cy, toward = flat * cp + y * sp;
        need = Math.max(need, toward + (Math.abs(x * cy - z * sy) + 0.12) / (0.86 * tanX));
        if (this.shot !== 'feet') need = Math.max(need, toward + (y * cp - flat * sp + 0.14) / (0.9 * tanY));
      }
    }
    return need;
  }

  /** the narrowest lens from `lo` up to WIDEST that holds them from `dist` away (a few halvings) */
  private fitLens(f: RigInput, D: number, aspect: number, dist: number, lo: number) {
    let hi = Math.tan((WIDEST * Math.PI) / 360);
    if (lo >= hi || this.fitDistance(f, D, lo * aspect, lo) <= dist) return lo;
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2;
      if (this.fitDistance(f, D, m * aspect, m) > dist) lo = m;
      else hi = m;
    }
    return hi;
  }

  // ---------------------------------------------------------------- locked
  /** the locked view: the dancers' bodies (and where their velocity takes them in `lockLead` seconds) in the plane's
   *  2D coordinates, with the floor, inside a safe area of the frame; the camera a little off square-on (the plane's
   *  `yaw` and `pitch`), far enough back with the plane's lens to hold that, or as far as the room and the gates allow
   *  with a wider lens. The extent widens quickly and settles slowly, so a leap or a cartwheel is never cropped and the
   *  camera does not breathe with every kick */
  private updateLocked(dt: number, f: RigInput) {
    const P = this.plane!, C = cameraParams, N = planeNormal(P);
    const ox = P.origin[0], oy = P.origin[1], oz = P.origin[2];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const add = (x: number, y: number, z: number) => {
      const u = (x - ox) * P.right[0] + (z - oz) * P.right[2], v = y - oy;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    };
    if (f.dancers.length) {
      for (const w of f.dancers) for (const j of LOCK_JOINTS) {
        const o = j * 12, x = w[o], y = w[o + 1], z = w[o + 2];
        add(x, y, z);
        // where it is heading (a fast limb's lead capped at a metre)
        const vx = w[o + 8] * C.lockLead, vy = w[o + 9] * C.lockLead, vz = w[o + 10] * C.lockLead, vl = Math.hypot(vx, vy, vz), s = vl > 1 ? 1 / vl : 1;
        add(x + vx * s, y + vy * s, z + vz * s);
      }
    } else for (let i = 0; i < this.framingCount; i++) add(this.framing[i * 3], this.framing[i * 3 + 1], this.framing[i * 3 + 2]);
    if (!(u1 >= u0)) { u0 = -P.halfWidth; u1 = P.halfWidth; v0 = 0; v1 = P.height ?? 3; }
    // a margin round them (hands and hair beyond the joints), the floor under them, never less than a body of stage
    u0 -= 0.4; u1 += 0.4; v0 = Math.min(v0, P.ground ?? 0) - 0.25; v1 = Math.max(v1 + 0.3, v0 + 2.4);
    const X = this.lockExt;
    if (this.lockFresh) { X[0] = u0; X[1] = u1; X[2] = v0; X[3] = v1; }
    else {
      const out = 1 - Math.exp(-dt * 9), back = 1 - Math.exp(-dt * 0.9);
      X[0] += (u0 - X[0]) * (u0 < X[0] ? out : back); X[1] += (u1 - X[1]) * (u1 > X[1] ? out : back);
      X[2] += (v0 - X[2]) * (v0 < X[2] ? out : back); X[3] += (v1 - X[3]) * (v1 > X[3] ? out : back);
    }
    const uc = (X[0] + X[1]) / 2, vc = (X[2] + X[3]) / 2;
    // the composed angle: turned a little about up from square-on, and looking a little down
    const ya = P.yaw ?? C.lockYaw, pa = P.pitch ?? C.lockPitch, cyw = Math.cos(ya), syw = Math.sin(ya);
    const hx = N[0] * cyw + P.right[0] * syw, hz = N[2] * cyw + P.right[2] * syw;   // toward the eye, level
    const cp = Math.cos(pa), sp = Math.sin(pa);
    const back: V3 = [hx * cp, sp, hz * cp];                                        // toward the eye
    const rt: V3 = [hz, 0, -hx];                                                    // the screen's right
    const up: V3 = [-sp * hx, cp, -sp * hz];                                        // the screen's up
    const c: V3 = [ox + P.right[0] * uc, oy + vc, oz + P.right[2] * uc];
    // how far back to hold the four corners inside the safe area (90 % across, 86 % up and down)
    const lens = P.lens ?? C.lockLens, tanP = Math.tan((lens * Math.PI) / 360), asp = Math.max(f.aspect, 0.2);
    const corners: V3[] = [];
    for (const u of [X[0], X[1]]) for (const v of [X[2], X[3]]) {
      const qx = ox + P.right[0] * u - c[0], qy = oy + v - c[1], qz = oz + P.right[2] * u - c[2];
      corners.push([qx * rt[0] + qz * rt[2], qx * up[0] + qy * up[1] + qz * up[2], qx * back[0] + qy * back[1] + qz * back[2]]);
    }
    const SX = 0.9, SY = 0.86;
    let D = 0;
    for (const [x, y, z] of corners) D = Math.max(D, Math.abs(x) / (SX * tanP * asp) + z, Math.abs(y) / (SY * tanP) + z);
    let fov = lens;
    // the furthest it may stand: inside the world's room (along `back` from the middle of what it frames), and in
    // front of any gate's disc between it and the stage
    const hb2 = back[0] * back[0] + back[2] * back[2] || 1, b = c[0] * back[0] + c[2] * back[2], room = Math.max(1, f.room - 0.3);
    const cc = c[0] * c[0] + c[2] * c[2] - room * room;
    let maxD = Math.max(2, (-b + Math.sqrt(Math.max(0, b * b - hb2 * cc))) / hb2);
    if (this.clearance) {
      const far: V3 = [c[0] + back[0] * maxD, c[1] + back[1] * maxD, c[2] + back[2] * maxD];
      maxD = Math.max(2, maxD * this.clearance(c, far));
    }
    if (D > maxD) {
      D = maxD;
      let t = 0;
      for (const [x, y, z] of corners) t = Math.max(t, Math.abs(x) / (SX * asp * Math.max(0.5, D - z)), Math.abs(y) / (SY * Math.max(0.5, D - z)));
      fov = Math.min(WIDEST, (Math.atan(t) * 360) / Math.PI);
    }
    // a light ease on top (the extent already eases), so nothing jitters
    const k = this.lockFresh ? 1 : 1 - Math.exp(-dt * 6);
    this.lockFresh = false;
    for (let a = 0; a < 3; a++) {
      this.lockC[a] += (c[a] - this.lockC[a]) * k;
      this.lockBack[a] += (back[a] - this.lockBack[a]) * k;
    }
    this.lockD += (D - this.lockD) * k;
    this.lockFov += (fov - this.lockFov) * k;
    for (let a = 0; a < 3; a++) this.lockEye[a] = this.lockC[a] + this.lockBack[a] * this.lockD;
    // (kept from drifting when unlocked: the free yaw takes over from wherever the lock left it facing)
    if (this.mode === 'locked' && this.lockW > 0.98) this.yaw += wrap(Math.atan2(N[0], N[2]) - this.yaw) * Math.min(1, dt * 2);
  }
  private lockBack: V3 = [0, 0, 1];

}

// The camera rig. Three ways to look:
//   free:   Gem Dancers' orbit round the dancers (drag to turn, wheel or pinch to move in and out), following their
//           middle. When nobody has touched it for a few seconds it eases to the director's current shot
//           (engine/shots.ts), its optional idle behaviour. On a tall screen it stands back (or widens the lens) far
//           enough to keep every dancer in frame.
//   follow: (free, with `follow` set) a third-person camera behind or beside a player: the right stick or the mouse
//           turns it (`lookBy`), and when the player runs and leaves it alone it swings round behind them.
//   locked: it eases round to face a StagePlane square on, with a long lens, framing a set of points (the dancers'
//           joints) on that plane: the 2D side view a jogo locks into.
// Switching eases between the poses, so the camera is never cut. `apply(camera)` writes the result into weft's
// Camera; the rig itself is plain numbers and can be stepped without a GPU.
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
 *  fast they travel (m/s), and how far apart the players are (0 for one) */
export interface FollowTarget { x: number; y: number; z: number; yaw: number; speed: number; spread: number }

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
}, {
  autoOrbit: { label: 'orbit when idle' },
  orbitSpeed: { min: -0.5, max: 0.5 },
  shots: { label: "director's shots" },
  lockEase: { min: 0.2, max: 4, label: 'lock ease (s)' },
  lockLens: { min: 8, max: 40, label: 'lock lens (deg)' },
  followDist: { min: 2, max: 10, label: 'follow distance' },
  followSwing: { min: 0, max: 5, label: 'follow swing' },
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
}

/** the widest the lens goes on a tall screen (degrees, top to bottom) */
const WIDEST = 90;
const clampPitch = (p: number) => Math.max(-0.15, Math.min(1.5, p));
const smooth01 = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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
  /** more margin (m) round what a locked view frames: the jogo stands back for a fusion */
  framePad = 0;
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

  /** turn the orbit by a drag (pixels) */
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = clampPitch(this.pitch + dy * 0.004);
    this.idle = 0;
  }
  /** carried through a gate (src/portals) by a rigid move (column-major 4×4): the target and every eased point move
   *  with it, the orbit turns by the move's turn about up and rises with it. The rig is an orbit and holds no roll or
   *  tilt: what of the move it can't hold (a floor gate to a wall gate) the portals keep as a residual over its pose
   *  and ease out. A locked plane stays the old world's: the caller locks to the new world's stage */
  carry(m: Float32Array) {
    const pt = (p: V3) => {
      const x = p[0], y = p[1], z = p[2];
      p[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; p[1] = m[1] * x + m[5] * y + m[9] * z + m[13]; p[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    };
    const y0 = this.target[1];
    for (const p of [this.target, this.freeEye, this.freeLook, this.lockC, this.lockEye, this.eye, this.look]) pt(p);
    this.height += this.target[1] - y0;
    this.yaw += Math.atan2(m[8], m[10]);
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
    if (this.follow) { this.updateFollow(dt, this.follow); return; }
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

  /** the third-person camera: the target springs to the player, the yaw is the player's to turn, and swings round
   *  behind them while they run and leave it alone */
  private followInit = false;
  private updateFollow(dt: number, F: FollowTarget) {
    const P = cameraParams;
    this.lookIdle += dt;
    if (!this.followInit) {
      this.followInit = true;
      this.target[0] = F.x; this.target[1] = F.y; this.target[2] = F.z;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.target[0] += (F.x - this.target[0]) * k;
    // (quick enough upward to keep a 2 m jump in frame)
    this.target[1] += (F.y - this.target[1]) * (1 - Math.exp(-dt * (F.y > this.target[1] ? 7 : 4)));
    this.target[2] += (F.z - this.target[2]) * k;
    if (this.lookIdle > P.followWait) {
      // left alone: the pitch settles, and while they run the eye swings round behind them
      this.pitch += (P.followPitch - this.pitch) * (1 - Math.exp(-dt * 1.2));
      if (F.speed > 0.6) {
        const want = F.yaw + Math.PI, d = wrap(want - this.yaw);
        const most = P.followSwing * dt * Math.min(1, (this.lookIdle - P.followWait) / 0.8) * Math.min(1, F.speed / 2.5);
        this.yaw += Math.max(-most, Math.min(most, d));
      }
    }
    const dist = P.followDist + F.spread * 0.7;
    this.dist = dist;
    this.freeFov = this.fov = P.followFov;
    const t = this.target;
    this.freeEye[0] = t[0] + Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
    this.freeEye[1] = Math.max(t[1] + Math.sin(this.pitch) * dist, 0.25);
    this.freeEye[2] = t[2] + Math.cos(this.yaw) * Math.cos(this.pitch) * dist;
    this.freeLook[0] = t[0]; this.freeLook[1] = t[1]; this.freeLook[2] = t[2];
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
  private updateLocked(dt: number, f: RigInput) {
    const P = this.plane!, up: V3 = [0, 1, 0];
    // the points' extent in the plane's 2D coordinates (or the whole stage when there are none)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < this.framingCount; i++) {
      const x = this.framing[i * 3] - P.origin[0], y = this.framing[i * 3 + 1] - P.origin[1], z = this.framing[i * 3 + 2] - P.origin[2];
      const u = x * P.right[0] + z * P.right[2];
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, y); v1 = Math.max(v1, y);
    }
    if (!(u1 >= u0)) { u0 = -P.halfWidth; u1 = P.halfWidth; v0 = 0; v1 = P.height ?? 3; }
    // a margin round them, and never less than a body's height of stage
    const mu = 0.6 + this.framePad, mv = 0.35 + this.framePad * 0.6;
    u0 -= mu; u1 += mu; v0 = Math.min(v0, 0) - mv; v1 = Math.max(v1, v0 + 2.2) + mv;
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
    // far enough back with the plane's lens to hold that; past the plane's limit, the lens widens instead
    const lens = P.lens ?? cameraParams.lockLens, tanP = Math.tan((lens * Math.PI) / 360);
    let D = Math.max(hv / tanP, hu / (tanP * Math.max(f.aspect, 0.2)));
    let fov = lens;
    // the furthest it may stand: inside the world's room (from the middle of what it frames, along the normal)
    const N = planeNormal(P), cx = P.origin[0] + P.right[0] * uc, cz = P.origin[2] + P.right[2] * uc;
    const b = cx * N[0] + cz * N[2], room = Math.max(1, f.room - 0.3);
    const maxD = Math.max(2, -b + Math.sqrt(Math.max(0, b * b - (cx * cx + cz * cz - room * room))));
    if (D > maxD) {
      D = maxD;
      fov = (Math.atan(Math.max(hv / D, hu / (D * Math.max(f.aspect, 0.2)))) * 360) / Math.PI;
    }
    const c: V3 = [cx, P.origin[1] + vc * up[1], cz];
    // the framing eases too, so a kick that reaches out doesn't jolt the camera
    const k = this.lockFresh ? 1 : 1 - Math.exp(-dt * 2.2);
    this.lockFresh = false;
    for (let a = 0; a < 3; a++) this.lockC[a] += (c[a] - this.lockC[a]) * k;
    this.lockD += (D - this.lockD) * k;
    this.lockFov += (fov - this.lockFov) * k;
    for (let a = 0; a < 3; a++) this.lockEye[a] = this.lockC[a] + N[a] * this.lockD;
    // (kept from drifting when unlocked: the free yaw takes over from wherever the lock left it facing)
    if (this.mode === 'locked' && this.lockW > 0.98) this.yaw += wrap(Math.atan2(N[0], N[2]) - this.yaw) * Math.min(1, dt * 2);
  }
}

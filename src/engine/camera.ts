// The camera rig. Two modes:
//   free:   Gem Dancers' orbit round the dancers (drag to turn, wheel or pinch to move in and out), following their
//           middle. When nobody has touched it for a few seconds it eases to the director's current shot
//           (engine/shots.ts), its optional idle behaviour. On a tall screen it stands back (or widens the lens) far
//           enough to keep every dancer in frame.
//   locked: it eases round to face a StagePlane square on, with a long lens, framing a set of points (the dancers'
//           joints) on that plane: the 2D side view a jogo locks into.
// Switching eases between the two poses, so the camera is never cut. `apply(camera)` writes the result into weft's
// Camera; the rig itself is plain numbers and can be stepped without a GPU.
import { spring } from 'math/time';
import type { Camera } from '@ericrius1/weft';
import { SHOTS, fitSetOf, type Shot } from './shots';
import { defineParams } from './params';

type V3 = [number, number, number];

/** a vertical plane in a world that the view can lock to. Its 2D coordinates are (along `right`, up) from `origin`;
 *  `normal` points to the side the camera stands on. Ledges are in those 2D coordinates (wave 1 adds collision). */
export interface StagePlane {
  id: string;
  origin: V3;
  /** unit, horizontal */
  right: V3;
  /** unit, horizontal, right × up turned toward the audience: where the camera stands */
  normal: V3;
  /** how much of the plane is stage (m, either side of the origin and up from it) */
  halfWidth: number;
  height: number;
  ledges: { x0: number; x1: number; y: number }[];
  /** the lens it prefers (degrees, top to bottom) and the furthest the camera may stand from the plane (m): a lens
   *  widens past it instead (inside the geode the wall is 7.4 m out) */
  lens: number;
  maxDistance: number;
}

export const cameraParams = defineParams('camera', {
  autoOrbit: true,
  orbitSpeed: 0.07,
  /** the director's shots while nobody moves the camera */
  shots: true,
  /** seconds a locked camera takes to get there (and back) */
  lockEase: 1.1,
}, {
  autoOrbit: { label: 'orbit when idle' },
  orbitSpeed: { min: -0.5, max: 0.5 },
  shots: { label: "director's shots" },
  lockEase: { min: 0.2, max: 4, label: 'lock ease (s)' },
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

  /** turn the orbit by a drag (pixels) */
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = clampPitch(this.pitch + dy * 0.004);
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
    if (!(u1 >= u0)) { u0 = -P.halfWidth; u1 = P.halfWidth; v0 = 0; v1 = P.height; }
    // a margin round them, and never less than a body's height of stage
    const mu = 0.6, mv = 0.35;
    u0 -= mu; u1 += mu; v0 = Math.min(v0, 0) - mv; v1 = Math.max(v1, v0 + 2.2) + mv;
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
    // far enough back with the plane's lens to hold that; past the plane's limit, the lens widens instead
    const tanP = Math.tan((P.lens * Math.PI) / 360);
    let D = Math.max(hv / tanP, hu / (tanP * Math.max(f.aspect, 0.2)));
    let fov = P.lens;
    if (D > P.maxDistance) {
      D = P.maxDistance;
      fov = (Math.atan(Math.max(hv / D, hu / (D * Math.max(f.aspect, 0.2)))) * 360) / Math.PI;
    }
    const c: V3 = [P.origin[0] + P.right[0] * uc, P.origin[1] + vc * up[1], P.origin[2] + P.right[2] * uc];
    // the framing eases too, so a kick that reaches out doesn't jolt the camera
    const k = this.lockFresh ? 1 : 1 - Math.exp(-dt * 2.2);
    this.lockFresh = false;
    for (let a = 0; a < 3; a++) this.lockC[a] += (c[a] - this.lockC[a]) * k;
    this.lockD += (D - this.lockD) * k;
    this.lockFov += (fov - this.lockFov) * k;
    for (let a = 0; a < 3; a++) this.lockEye[a] = this.lockC[a] + P.normal[a] * this.lockD;
    // (kept from drifting when unlocked: the free yaw takes over from wherever the lock left it facing)
    if (this.mode === 'locked' && this.lockW > 0.98) this.yaw += wrap(Math.atan2(P.normal[0], P.normal[2]) - this.yaw) * Math.min(1, dt * 2);
  }
}

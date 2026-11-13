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
import { boxOn, type Solid } from '../worlds/solids';
import { spring } from 'math/time';
import type { Camera } from '@ericrius1/weft';
import { SHOTS, fitSetOf, samplePath, type Shot, type CameraPath, type PathSpace } from './shots';
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

// ---------------------------------------------------------------- solids (what the eye keeps out of)

/** a solid thing in a world as the camera sees it (src/worlds/solids.ts, World.solids: one description for the camera,
 *  World.clear and the brains), in the rig's coordinates: a capsule or a box */
export type { Solid };
export { boxOn };

/** a world's solids, with a bounding sphere each (x, y, z, r) so a segment far from one costs four multiplies */
export class Solids {
  readonly bounds: Float32Array;
  constructor(readonly list: readonly Solid[]) {
    this.bounds = new Float32Array(list.length * 4);
    list.forEach((s, i) => {
      if (s.kind === 'capsule') {
        const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
        this.bounds.set([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2, L / 2 + s.r], i * 4);
      } else this.bounds.set([...s.c, Math.hypot(...s.h)], i * 4);
    });
  }
  /** how much of the way from a to b (0 … 1) a sphere of radius r moves before it touches a solid (see below for a
   *  start that is already near one) */
  sweep(a: V3, b: V3, r: number, hit?: (i: number) => void): number {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-10) return 1;
    const B = this.bounds, near: number[] = [];
    // the solids the segment comes within r of (their bounding spheres), and how near a is to the nearest of them: a
    // start nearer a solid than r (a dancer standing on a slab of columns, against a column) makes the sphere small
    // enough to start clear of all of them, so it is caught by moving into one, not by where it began; one a is inside
    // (or touching) is passed over
    let r0 = r;
    for (let i = 0; i < this.list.length; i++) {
      const o = i * 4, px = B[o] - a[0], py = B[o + 1] - a[1], pz = B[o + 2] - a[2];
      const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / L2));
      const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t, R = B[o + 3] + r;
      if (qx * qx + qy * qy + qz * qz > R * R) continue;
      const d0 = distTo(this.list[i], a);
      if (d0 <= 0.02) continue;
      near.push(i);
      r0 = Math.min(r0, d0 * 0.9);
    }
    let best = 1;
    for (const i of near) {
      const s = this.list[i], k = s.kind === 'capsule' ? sweepCapsule(s, a, dx, dy, dz, r0) : sweepBox(s, a, dx, dy, dz, r0);
      if (k < best) { best = k; hit?.(i); }
    }
    return best;
  }
  /** whether the point p is within r of a solid (the eye inside one) */
  inside(p: V3, r: number) {
    for (let i = 0; i < this.list.length; i++) {
      const o = i * 4, R = this.bounds[o + 3] + r;
      if ((p[0] - this.bounds[o]) ** 2 + (p[1] - this.bounds[o + 1]) ** 2 + (p[2] - this.bounds[o + 2]) ** 2 > R * R) continue;
      if (distTo(this.list[i], p) < r) return true;
    }
    return false;
  }
}

/** how far p is from a solid's surface (negative inside) */
export function distTo(s: Solid, p: V3) {
  if (s.kind === 'capsule') {
    const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2], L2 = bx * bx + by * by + bz * bz;
    const px = p[0] - s.a[0], py = p[1] - s.a[1], pz = p[2] - s.a[2];
    const t = L2 > 1e-12 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / L2)) : 0;
    return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - s.r;
  }
  const px = p[0] - s.c[0], py = p[1] - s.c[1], pz = p[2] - s.c[2];
  const qx = Math.abs(px * s.x[0] + py * s.x[1] + pz * s.x[2]) - s.h[0];
  const qy = Math.abs(px * s.y[0] + py * s.y[1] + pz * s.y[2]) - s.h[1];
  const qz = Math.abs(px * s.z[0] + py * s.z[1] + pz * s.z[2]) - s.h[2];
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}

/** a sphere of radius r moving from a by (dx, dy, dz) against a capsule: the first touch (0 … 1), 1 for none or for a
 *  start already inside (Quílez's ray-capsule with the radii summed) */
function sweepCapsule(s: Extract<Solid, { kind: 'capsule' }>, a: V3, dx: number, dy: number, dz: number, r: number) {
  const R = s.r + r;
  if (distTo(s, a) < r) return 1;
  const L = Math.hypot(dx, dy, dz), rx = dx / L, ry = dy / L, rz = dz / L;
  const bax = s.b[0] - s.a[0], bay = s.b[1] - s.a[1], baz = s.b[2] - s.a[2];
  const oax = a[0] - s.a[0], oay = a[1] - s.a[1], oaz = a[2] - s.a[2];
  const baba = bax * bax + bay * bay + baz * baz, bard = bax * rx + bay * ry + baz * rz, baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rx * oax + ry * oay + rz * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
  let t = -1;
  const A = baba - bard * bard;
  if (A > 1e-9) {
    const b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - R * R * baba, h = b * b - A * c;
    if (h >= 0) {
      const tt = (-b - Math.sqrt(h)) / A, y = baoa + tt * bard;
      if (y > 0 && y < baba) t = tt;
    }
  }
  if (t < 0) {
    // the ends: a sphere at each
    for (const e of [s.a, s.b]) {
      const ox = a[0] - e[0], oy = a[1] - e[1], oz = a[2] - e[2], b = rx * ox + ry * oy + rz * oz, h = b * b - (ox * ox + oy * oy + oz * oz - R * R);
      if (h > 0) { const tt = -b - Math.sqrt(h); if (tt >= 0 && (t < 0 || tt < t)) t = tt; }
    }
  }
  return t >= 0 && t < L ? t / L : 1;
}

/** the same against a box (grown by r on every side: a little generous at its edges and corners) */
function sweepBox(s: Extract<Solid, { kind: 'box' }>, a: V3, dx: number, dy: number, dz: number, r: number) {
  if (distTo(s, a) < r) return 1;
  const px = a[0] - s.c[0], py = a[1] - s.c[1], pz = a[2] - s.c[2];
  let t0 = 0, t1 = 1;
  for (const [ax, h] of [[s.x, s.h[0]], [s.y, s.h[1]], [s.z, s.h[2]]] as const) {
    const o = px * ax[0] + py * ax[1] + pz * ax[2], d = dx * ax[0] + dy * ax[1] + dz * ax[2], H = h + r;
    if (Math.abs(d) < 1e-12) { if (Math.abs(o) > H) return 1; continue; }
    let ta = (-H - o) / d, tb = (H - o) / d;
    if (ta > tb) { const k = ta; ta = tb; tb = k; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return 1;
  }
  // (the box grown by r is a box, square at its edges and corners where the true shape is round: from where the
  // segment enters it, step on by the true distance until the sphere touches, or the segment leaves)
  const L = Math.hypot(dx, dy, dz), p: V3 = [0, 0, 0];
  for (let i = 0, t = t0; i < 32 && t <= t1; i++) {
    p[0] = a[0] + dx * t; p[1] = a[1] + dy * t; p[2] = a[2] + dz * t;
    const d = distTo(s, p) - r;
    if (d < 1e-3) return t;
    t += d / L;
  }
  return 1;
}

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
  gateAlign: 0.9,
  /** the locked view's default turn off square-on and look down (rad; a stage plane may say its own) */
  lockYaw: 0.1,
  lockPitch: 0.07,
  /** seconds of a dancer's velocity the locked framing looks ahead by (a leap is framed before it peaks) */
  lockLead: 0.35,
  /** how far the eye keeps from a world's solids (m): the boom eases in to keep this much clear (with a look ahead along
   *  the way it is turning), and is stopped hard at `clearHard` if the ease is not quick enough */
  clearSoft: 0.5,
  clearHard: 0.22,
  /** how far ahead (s) of where the eye is turning the boom looks for solids, so it comes in before one reaches it */
  clearAhead: 0.35,
  /** how far the locked view may turn off its stage's own angle (rad, either way) to see past a column or a trunk */
  lockDodge: 0.4,
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
  clearSoft: { min: 0, max: 1.5, label: 'keep off solids (m)' },
  clearHard: { min: 0, max: 0.6 },
  clearAhead: { min: 0, max: 1 },
  lockDodge: { min: 0, max: 0.8, label: 'lock turns past occluders (rad)' },
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
/** the fastest the boom comes in for a solid (m/s), and the times ahead (s, at clearAhead 0.35) it looks along its turn */
const PULL_SPEED = 5;
const AHEAD = [0.12, 0.25, 0.4, 0.6, 0.8];
/** how far the free boom may tilt (rad) to see over something low (or under a bough) */
const LIFTS = [0.15, 0.3, 0.45, 0.6, -0.12, -0.24];
/** what the locked view must see past solids: hips, knees, chest, head */
const SIGHT_JOINTS = [0, 3, 9, 15, 18];

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
  /** the solid things of the world the rig is in (the portals set them each frame, from World.solids or their own
   *  reading of the world's layout), or null: the eye keeps out of them, the lock looks past them */
  solids: Solids | null = null;
  /** the height of that world's water, if it has any (the eye stays above it, as above the ground) */
  waterY: number | null = null;
  /** what the world may fade so nothing solid stands in the way (a request to the worlds and the post chain: see
   *  docs/extending/camera.md, "The near fade"): the eye, the middle of what is framed, and the solids that stood
   *  across the sight lines this frame (indices into `solids.list`) after the rig did what it could */
  readonly sight = { eye: [0, 0, 0] as V3, at: [0, 0, 0] as V3, near: 0.6, blocking: [] as number[] };
  /** the turn the lock has taken off its stage's angle to see past a solid (rad, eased), and its wish */
  dodge = 0;
  private dodgeWant = 0;
  private dodgeWait = 0;
  /** the boom's turn about up last frame and how fast it turns (rad/s): the clearance looks ahead along it */
  private boomYaw = 0;
  private boomRate = 0;
  /** per player: the turn their camera-relative stick is read in, while held (see `stickYaw`) */
  private sticks: { yaw: number; held: boolean }[] = [];
  /** a camera path playing (see `play`): its pose this frame, its weight, its own boom */
  private run: PathRun | null = null;
  private roll = 0;
  private focusAt: number | null = null;

  /** the distance in focus: from the eye to what it looks at (the stage plane, locked), or a path's own */
  get focus() {
    const d = Math.hypot(this.look[0] - this.eye[0], this.look[1] - this.eye[1], this.look[2] - this.eye[2]);
    return this.focusAt === null ? d : this.focusAt;
  }

  /** the turn player `p`'s camera-relative stick (moveX, moveZ) is read in. While the stick is held it keeps the turn
   *  it had when the push began: the camera's own swings (behind a runner, onto a gate, the director's drift) don't
   *  steer the player, so a stick held one way walks a straight line. The player's own look input (`lookBy`) and a
   *  gate's carry turn it with the camera. Let go, and it is the camera's again */
  stickYaw(p: number, moveX: number, moveZ: number) {
    const s = (this.sticks[p] ??= { yaw: this.yaw, held: false });
    const held = Math.hypot(moveX, moveZ) > 0.2;
    if (!held || !s.held) s.yaw = this.yaw;
    s.held = held;
    return s.yaw;
  }

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
    const turn = Math.atan2(m[8], m[10]);
    this.yaw += turn;
    this.boomYaw += turn;
    for (const s of this.sticks) if (s) s.yaw += turn;
    if (this.run) this.run.carry(m);
    this.approach = null;
  }

  /** the follow camera turned by a look rate (a stick's -1..1, a mouse's more) over dt seconds */
  lookBy(x: number, y: number, dt: number) {
    if (Math.abs(x) + Math.abs(y) < 1e-3) return;
    this.yaw -= x * 2.6 * dt;
    for (const s of this.sticks) if (s?.held) s.yaw -= x * 2.6 * dt;
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
    for (let a = 0; a < 3; a++) {
      this.eye[a] = this.freeEye[a] + (this.lockEye[a] - this.freeEye[a]) * e;
      this.look[a] = this.freeLook[a] + (this.lockC[a] - this.freeLook[a]) * e;
    }
    this.fovNow = this.freeFov + (this.lockFov - this.freeFov) * e;
    this.roll = 0;
    this.focusAt = null;
    // a camera path over all that, by its weight (blending in and out of whatever the rig was doing)
    if (this.run) this.playPath(dt, f);
    this.sight.eye[0] = this.eye[0]; this.sight.eye[1] = this.eye[1]; this.sight.eye[2] = this.eye[2];
    this.sight.at[0] = this.look[0]; this.sight.at[1] = this.look[1]; this.sight.at[2] = this.look[2];
    if (e <= 0 && !this.run) this.sight.blocking.length = 0;
  }

  /** the pose into weft's camera (and its matrices for this render size) */
  apply(c: Camera, width: number, height: number) {
    const dx = this.look[0] - this.eye[0], dy = this.look[1] - this.eye[1], dz = this.look[2] - this.eye[2];
    c.position[0] = this.eye[0]; c.position[1] = this.eye[1]; c.position[2] = this.eye[2];
    // weft: yaw 0 looks down -z, positive yaw turns left; pitch up is positive
    c.yaw = Math.atan2(-dx, -dz);
    c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    c.roll = this.roll;
    c.fovY = (this.fovNow * Math.PI) / 180;
    c.update(width, height);
  }

  // ---------------------------------------------------------------- camera paths (engine/shots.ts: CameraPath)
  /** play a camera path (docs/extending/camera.md): from `at` seconds into it, blending in over its `blendIn` from
   *  whatever the rig is doing (free, follow, locked). Its keys are in its `space` (the world, a dancer, the pair, a
   *  stage), resolved every frame, so a path relative to a dancer goes where they go. Another play replaces it,
   *  blending from where the camera is */
  play(path: CameraPath, at = 0) {
    if (!path.keys.length) throw new Error('camera path: no keys');
    const was = this.run && this.run.w > 0 ? { eye: [...this.eye] as V3, look: [...this.look] as V3, fov: this.fovNow, roll: this.roll } : null;
    this.run = new PathRun(path, at, was);
  }
  /** let go of the path: blend back to the rig over `blend` seconds (default: the path's `blendOut`) */
  release(blend?: number) { if (this.run) this.run.release(blend ?? this.run.path.blendOut ?? 1); }
  /** the path playing: its time (s), its weight (0 … 1), whether it has reached its last key; null when none */
  get path() { const r = this.run; return r ? { t: r.t, w: r.w, done: r.t >= r.end, path: r.path } : null; }

  private playPath(dt: number, f: RigInput) {
    const r = this.run!;
    r.step(dt);
    if (r.gone) { this.run = null; return; }
    const pose = r.pose(dt, f, this.plane, this.fovNow);
    // its own boom kept off the solids, when it asks
    if (r.path.avoid && this.solids) {
      const C = cameraParams, S = this.solids, T = pose.look, E = pose.eye;
      const want = Math.max(Math.min(1, 0.6 / Math.max(1e-3, Math.hypot(E[0] - T[0], E[1] - T[1], E[2] - T[2]))), S.sweep(T, E, C.clearSoft));
      r.pull += (want - r.pull) * (r.fresh ? 1 : 1 - Math.exp(-dt * (want < r.pull ? 8 : 1.6)));
      for (let a = 0; a < 3; a++) E[a] = T[a] + (E[a] - T[a]) * r.pull;
      const h = S.sweep(T, E, C.clearHard);
      if (h < 1) { for (let a = 0; a < 3; a++) E[a] = T[a] + (E[a] - T[a]) * h; r.pull *= h; }
      this.keepAbove(E, f);
    }
    r.fresh = false;
    const w = smooth01(r.w), from = r.from;
    for (let a = 0; a < 3; a++) {
      const e0 = from ? from.eye[a] : this.eye[a], l0 = from ? from.look[a] : this.look[a];
      this.eye[a] = e0 + (pose.eye[a] - e0) * w;
      this.look[a] = l0 + (pose.look[a] - l0) * w;
    }
    const f0 = from ? from.fov : this.fovNow, r0 = from ? from.roll : 0;
    this.fovNow = f0 + (pose.fov - f0) * w;
    this.roll = r0 + (pose.roll - r0) * w;
    if (pose.focus !== null) {
      const d = Math.hypot(this.look[0] - this.eye[0], this.look[1] - this.eye[1], this.look[2] - this.eye[2]);
      this.focusAt = d + (pose.focus - d) * w;
    }
    // (blending in from another path: once it is all this one, the rig's own pose is what it leaves to)
    if (r.w >= 1) r.from = null;
  }

  /** the eye above the ground and the water (25 cm) */
  private keepAbove(E: V3, f: RigInput) {
    let floor = this.waterY ?? -Infinity;
    if (f.groundAt) floor = Math.max(floor, f.groundAt(E[0], E[2]));
    if (E[1] < floor + 0.25) E[1] = floor + 0.25;
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

  /** the boom (look point to eye) shortened to what is clear: the world's room for a follow camera; for any free
   *  camera `clearance` (gates' discs, World.clear) and the world's `solids`, swept as a sphere (`clearSoft`) along the
   *  boom where it is now and where it is turning to (`clearAhead` seconds on), so it comes in before a column reaches
   *  it. It comes in quickly and goes back out slowly, so a trunk passing is a short dolly, not a jump; if the ease is
   *  ever too slow, a hard stop (`clearHard`) keeps the eye out of the solid. Above the ground and the water. Then,
   *  after a carry, the way through the disc (`passThrough`) */
  private settleEye(dt: number, f: RigInput) {
    const T = this.freeLook, E = this.freeEye, C = cameraParams, S = this.solids;
    // (while the eye is still behind the disc it came after its player through, the disc rules it; once it is on the
    // player's side, or was turned there, the world's solids do again)
    const behind = this.behindThrough(E);
    if (S && !behind) this.liftOver(dt, T, E, f);
    const dx = E[0] - T[0], dy = E[1] - T[1], dz = E[2] - T[2], len = Math.hypot(dx, dy, dz);
    // how fast the boom turns about up (smoothed; a carry turns boomYaw with the rig)
    const yawNow = Math.atan2(dx, dz);
    if (dt > 0) {
      const rate = Math.max(-3, Math.min(3, wrap(yawNow - this.boomYaw) / dt));
      this.boomRate += (rate - this.boomRate) * (1 - Math.exp(-dt * 8));
    }
    this.boomYaw = yawNow;
    let want = 1;
    if (!behind) {
      if (this.follow) {
        // the room: a circle about the world's middle, as far as the eye may stand
        const a = dx * dx + dz * dz, b = T[0] * dx + T[2] * dz, c = T[0] * T[0] + T[2] * T[2] - f.room * f.room;
        if (a > 1e-9 && c < 0) want = Math.min(want, (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a);
      }
      if (this.clearance) want = Math.min(want, this.clearance(T, E));
      if (S && C.clearSoft > 0) {
        // where the boom is and where it will be as it turns: the boom must be in to what is clear there by then, and
        // comes in no faster than PULL_SPEED, so it starts early enough for a column it will meet (a plan, not a jump)
        const v = PULL_SPEED / Math.max(len, 1e-3);
        want = Math.min(want, S.sweep(T, E, C.clearSoft));
        for (const h of AHEAD) {
          const turn = this.boomRate * h * C.clearAhead / 0.35;
          if (Math.abs(turn) < 0.01) break;
          const c = Math.cos(turn), s = Math.sin(turn);
          want = Math.min(want, S.sweep(T, [T[0] + dx * c + dz * s, E[1], T[2] - dx * s + dz * c], C.clearSoft) + v * h);
        }
      }
      // (never closer than a body's width: a camera inside the player is worse than one behind a leaf)
      want = Math.max(want, Math.min(1, 0.9 / Math.max(len, 1e-3)));
    }
    // in quickly (but no faster than PULL_SPEED along the boom), out slowly
    const step = (want - this.pull) * (1 - Math.exp(-dt * (want < this.pull ? 10 : 1.6))), most = (PULL_SPEED * dt) / Math.max(len, 1e-3);
    this.pull += behind ? step : Math.max(-most, step);
    E[0] = T[0] + dx * this.pull; E[1] = T[1] + dy * this.pull; E[2] = T[2] + dz * this.pull;
    if (this.through) this.passThrough(dt, T, E, len);
    if (this.behindThrough(E)) return;
    this.keepAbove(E, f);
    if (S && C.clearHard > 0) {
      const h = S.sweep(T, E, C.clearHard);
      if (h < 1) {
        for (let a = 0; a < 3; a++) E[a] = T[a] + (E[a] - T[a]) * h;
        this.pull *= h;
      }
      // (what the sweep can't see: the look point itself inside a solid, a dancer falling through a slab. Then the eye
      // still must not be: along the boom in toward the look point, or else out past where it was, the first point clear)
      if (S.inside(E, 0.05)) {
        const D: V3 = [E[0] - T[0], E[1] - T[1], E[2] - T[2]], p: V3 = [0, 0, 0];
        for (const k of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 1.2, 1.4, 1.7, 2]) {
          p[0] = T[0] + D[0] * k; p[1] = T[1] + D[1] * k; p[2] = T[2] + D[2] * k;
          if (!S.inside(p, 0.15)) { E[0] = p[0]; E[1] = p[1]; E[2] = p[2]; break; }
        }
      }
    }
  }

  /** a boom blocked by something low (a fallen log, a bough, a shelf at knee height) would come right in to the
   *  dancers; tilted up a little it may clear it. Try a few tilts up to `LIFTS` and take the one that leaves the boom
   *  longest (each step up must win half a metre, so it doesn't hunt), easing there and back slowly */
  private lift = 0;
  private liftOver(dt: number, T: V3, E: V3, f: RigInput) {
    const S = this.solids!, C = cameraParams;
    const dx = E[0] - T[0], dy = E[1] - T[1], dz = E[2] - T[2], h = Math.hypot(dx, dz), len = Math.hypot(dx, dy, dz);
    if (h < 1e-4 || len < 1e-3) return;
    const up = Math.atan2(dy, h);
    const at = (l: number): V3 => {
      const e = Math.min(1.3, up + l), k = (len * Math.cos(e)) / h;
      return [T[0] + dx * k, T[1] + len * Math.sin(e), T[2] + dz * k];
    };
    // (what is clear of the solids and of the gates' discs alike: a tilt can see over either)
    const clear = (p: V3) => Math.min(S.sweep(T, p, C.clearSoft), this.clearance ? this.clearance(T, p) : 1) * len;
    let best = 0, bestLen = clear(at(0));
    if (bestLen < len - 0.05) {
      for (const l of LIFTS) {
        // (a tilt down only where it keeps the eye 40 cm over the floor: under a bough, never into the ground)
        const p = at(l);
        if (l < 0) {
          // (and only over ground as high as what it looks at stands on: never down past a floating slab's edge)
          const gp = f.groundAt ? f.groundAt(p[0], p[2]) : 0, gt = f.groundAt ? f.groundAt(T[0], T[2]) : 0;
          if (gp < gt - 0.5 || p[1] < Math.max(this.waterY ?? -Infinity, gp, gt) + 0.4) continue;
        }
        const L = clear(p);
        if (L > bestLen + 0.5) { best = l; bestLen = L; }
      }
    }
    this.lift += (best - this.lift) * (1 - Math.exp(-dt * (Math.abs(best) > Math.abs(this.lift) ? 2.5 : 0.8)));
    if (Math.abs(this.lift) > 1e-3) { const p = at(this.lift); E[0] = p[0]; E[1] = p[1]; E[2] = p[2]; }
  }

  /** whether p is behind the disc the eye has still to come through (on the far side from its player) */
  private behindThrough(p: V3) {
    const g = this.through;
    return !!g && ((p[0] - g.at[0]) * g.n[0] + (p[1] - g.at[1]) * g.n[1] + (p[2] - g.at[2]) * g.n[2]) * g.side < 0;
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
    // a margin round them (hands and hair beyond the joints), the floor under them, never less than a body of stage;
    // framePad (the jogo: a fusion, the results) stands back further
    const pu = this.framePad, pv = this.framePad * 0.6;
    u0 -= 0.3 + pu; u1 += 0.3 + pu; v0 = Math.min(v0, P.ground ?? 0) - 0.25 - pv; v1 = Math.max(v1 + 0.3, v0 + 2.4) + pv;
    const X = this.lockExt;
    // (fresh, or a dancer put somewhere else in one go, a respawn: the extent jumps out with them)
    if (this.lockFresh) { X[0] = u0; X[1] = u1; X[2] = v0; X[3] = v1; }
    else if (X[0] - u0 > 1.5 || u1 - X[1] > 1.5 || X[2] - v0 > 1.5 || v1 - X[3] > 1.5) {
      X[0] = Math.min(X[0], u0); X[1] = Math.max(X[1], u1); X[2] = Math.min(X[2], v0); X[3] = Math.max(X[3], v1);
    }
    else {
      const out = 1 - Math.exp(-dt * 9), back = 1 - Math.exp(-dt * 0.9);
      X[0] += (u0 - X[0]) * (u0 < X[0] ? out : back); X[1] += (u1 - X[1]) * (u1 > X[1] ? out : back);
      X[2] += (v0 - X[2]) * (v0 < X[2] ? out : back); X[3] += (v1 - X[3]) * (v1 > X[3] ? out : back);
    }
    const uc = (X[0] + X[1]) / 2, vc = (X[2] + X[3]) / 2;
    const c: V3 = [ox + P.right[0] * uc, oy + vc, oz + P.right[2] * uc];
    // the composed angle (the plane's own), turned further when a solid stands between the eye and the dancers
    const base = P.yaw ?? C.lockYaw;
    this.dodgeFor(dt, f, c, base);
    const { back, D, fov } = this.lockPose(f, c, base + this.dodge);
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

  /** where the locked eye stands for the framed extent about `c`, turned `ya` about up off square-on: the direction
   *  toward the eye, how far back it holds the four corners in the safe area, and the lens it needs to */
  private lockPose(f: RigInput, c: V3, ya: number) {
    const P = this.plane!, C = cameraParams, N = planeNormal(P), X = this.lockExt;
    const ox = P.origin[0], oy = P.origin[1], oz = P.origin[2];
    // turned a little about up from square-on, and looking a little down
    const pa = P.pitch ?? C.lockPitch, cyw = Math.cos(ya), syw = Math.sin(ya);
    const hx = N[0] * cyw + P.right[0] * syw, hz = N[2] * cyw + P.right[2] * syw;   // toward the eye, level
    const cp = Math.cos(pa), sp = Math.sin(pa);
    const back: V3 = [hx * cp, sp, hz * cp];                                        // toward the eye
    const rt: V3 = [hz, 0, -hx];                                                    // the screen's right
    const up: V3 = [-sp * hx, cp, -sp * hz];                                        // the screen's up
    // how far back to hold the four corners inside the safe area (93 % across, 86 % up and down)
    const lens = P.lens ?? C.lockLens, tanP = Math.tan((lens * Math.PI) / 360), asp = Math.max(f.aspect, 0.2);
    const corners: V3[] = [];
    for (const u of [X[0], X[1]]) for (const v of [X[2], X[3]]) {
      const qx = ox + P.right[0] * u - c[0], qy = oy + v - c[1], qz = oz + P.right[2] * u - c[2];
      corners.push([qx * rt[0] + qz * rt[2], qx * up[0] + qy * up[1] + qz * up[2], qx * back[0] + qy * back[1] + qz * back[2]]);
    }
    const SX = 0.93, SY = 0.86;
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
    return { back, D, fov, eye: [c[0] + back[0] * D, c[1] + back[1] * D, c[2] + back[2] * D] as V3 };
  }

  /** the lock's dodge: while a solid (a column, a trunk, a shelf) stands across the sight lines from the eye to the
   *  dancers, look for the turn within `lockDodge` of the stage's angle that sees them best (fewest lines blocked, the
   *  eye in no solid, the smallest turn), at most twice a second, and ease there; when the stage's own angle is clear
   *  again, ease back. What still stands across is left in `sight.blocking` for a world that can fade it */
  private dodgeFor(dt: number, f: RigInput, c: V3, base: number) {
    const S = this.solids, C = cameraParams, B = this.sight.blocking;
    B.length = 0;
    if (!S || !f.dancers.length || C.lockDodge <= 0) { this.dodge += (0 - this.dodge) * (1 - Math.exp(-dt * 2)); return; }
    this.dodgeWait -= dt;
    const score = (off: number, hits?: number[]) => {
      const eye = this.lockPose(f, c, base + off).eye;
      return this.blocked(eye, f, hits) + (S.inside(eye, 0.4) ? 2 : 0) + (Math.abs(off) / Math.max(1e-3, C.lockDodge)) * 0.15;
    };
    const now = score(this.dodgeWant);
    if (this.dodgeWait <= 0 && (now > 0.15 || this.dodgeWant !== 0) || this.lockFresh) {
      this.dodgeWait = 0.5;
      // (the stage's own angle first, then the turns nearest it: a tie keeps the smaller turn)
      let best = this.dodgeWant, bestS = now - 0.05;
      for (let k = 0; k <= 16; k++) {
        const off = (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) / 8) * C.lockDodge, s = score(off);
        if (s < bestS - 1e-3) { best = off; bestS = s; }
      }
      this.dodgeWant = best;
    }
    this.dodge += (this.dodgeWant - this.dodge) * (this.lockFresh ? 1 : 1 - Math.exp(-dt * 2.2));
    this.blocked(this.lockPose(f, c, base + this.dodge).eye, f, B);
  }

  /** the share of the sight lines from `eye` to the framed dancers (hips, chest, head, knees) that a solid crosses;
   *  `hits` collects which solids */
  private blocked(eye: V3, f: RigInput, hits?: number[]) {
    const S = this.solids!;
    let n = 0, m = 0;
    for (let d = 0; d < Math.min(2, f.dancers.length); d++) {
      const w = f.dancers[d];
      for (const j of SIGHT_JOINTS) {
        const o = j * 12;
        m++;
        if (S.sweep([w[o], w[o + 1], w[o + 2]], eye, 0.12, hits ? (i) => { if (!hits.includes(i)) hits.push(i); } : undefined) < 0.98) n++;
      }
    }
    return m ? n / m : 0;
  }
}

/** a camera path being played: its clock and weight, its space resolved and eased, the gates it was carried through */
class PathRun {
  t: number;
  readonly end: number;
  /** the weight before easing (0 … 1), rising over blendIn, falling over a release */
  w: number;
  gone = false;
  /** its own boom (when it avoids solids), and whether this is its first frame */
  pull = 1;
  fresh = true;
  private out = 0;
  private M: Float32Array | null = null;
  private O: V3 = [0, 0, 0];
  private th = 0;
  private placed = false;

  constructor(readonly path: CameraPath, at: number, public from: { eye: V3; look: V3; fov: number; roll: number } | null) {
    this.t = at;
    this.end = path.keys[path.keys.length - 1].t;
    this.w = (path.blendIn ?? 1) > 0 ? 0 : 1;
  }

  release(blend: number) { this.out = Math.max(1e-3, blend); if (blend <= 0) this.gone = true; }

  step(dt: number) {
    this.t += dt;
    const P = this.path;
    if (P.end === 'loop' && this.end > 0 && this.t > this.end) this.t -= this.end;
    if (this.out > 0) { this.w -= dt / this.out; if (this.w <= 0) this.gone = true; return; }
    const bi = P.blendIn ?? 1;
    this.w = bi > 0 ? Math.min(1, this.w + dt / bi) : 1;
    if (P.end === 'release' && this.t >= this.end) this.release(P.blendOut ?? 1);
  }

  /** a gate carried the rig: a path in world space goes with it (one in a dancer's space goes with the dancer) */
  carry(m: Float32Array) {
    if (this.path.space && this.path.space !== 'world') return;
    if (!this.M) { this.M = new Float32Array(m); return; }
    const a = this.M, o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = m[r] * a[c * 4] + m[4 + r] * a[c * 4 + 1] + m[8 + r] * a[c * 4 + 2] + m[12 + r] * a[c * 4 + 3];
    this.M = o;
  }

  /** the pose now in the rig's coordinates */
  pose(dt: number, f: RigInput, plane: StagePlane | null, fov: number) {
    const P = this.path, local = samplePath(P, this.t);
    // the space: an origin and a turn about up (local x → (cos, 0, −sin), local z → (sin, 0, cos))
    let O: V3 | null = [0, 0, 0], th = 0;
    const S: PathSpace = P.space ?? 'world';
    // (a dancer's place: under their hips, on the ground there, so a jump doesn't lift the shot)
    const hips = (i: number) => { const w = f.dancers[i]; return w ? ([w[0], f.groundAt ? f.groundAt(w[0], w[2]) : 0, w[2]] as V3) : null; };
    if (S === 'world') { /* the origin */ }
    else if ('dancer' in S) {
      O = hips(S.dancer);
      const w = f.dancers[S.dancer];
      if (w && S.turn) {
        // the hips' forward (+z turned by their rotation, x y z w at 4 … 7)
        const x = w[4], y = w[5], z = w[6], q = w[7];
        th = Math.atan2(2 * (x * z + q * y), 1 - 2 * (x * x + y * y));
      }
    } else if ('pair' in S) {
      const a = hips(0), b = hips(1) ?? a;
      O = a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null;
      if (a && b && Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.05) th = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
      else th = this.th;
    } else {
      const pl = S.stage === true ? plane : S.stage;
      if (pl) { O = [...pl.origin] as V3; th = Math.atan2(-pl.right[2], pl.right[0]); }
    }
    // (a dancer that isn't there: the space stays where it was)
    if (O) {
      const lag = P.lag ?? 0.25, k = !this.placed || lag <= 0 || S === 'world' ? 1 : 1 - Math.exp(-dt / lag);
      for (let a = 0; a < 3; a++) this.O[a] += (O[a] - this.O[a]) * k;
      this.th += wrap(th - this.th) * k;
      this.placed = true;
    }
    const c = Math.cos(this.th), s = Math.sin(this.th), Og = this.O, M = this.M;
    const put = (p: V3): V3 => {
      const x = Og[0] + p[0] * c + p[2] * s, y = Og[1] + p[1], z = Og[2] - p[0] * s + p[2] * c;
      if (!M) return [x, y, z];
      return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    };
    return { eye: put(local.eye), look: put(local.look), fov: local.fov ?? fov, roll: local.roll, focus: local.focus };
  }
}

// The duel's free camera (docs/design/duel.md, phase 2's first fix; report 12, "The free camera loses the dance"): side
// on to the pair, framing both bodies whole with head room above the higher one, its eye standing clear of the arena's
// pieces. Pure: plain numbers in, a pose out (eye, look point, lens), so it runs in Node (camera.test.ts) and the page
// hands the pose to the rig (CameraRig.pose), which only keeps it above the ground.
//
// What it frames: every point the page gives per body (hips, head, hands, feet) and, while a body rises in the air,
// where its head will peak (a ballistic apex at the body's gravity: a 16 m/s launch is framed at the top of its flight
// the frame it leaves, so the player sees it rise and come back down to the catch). `fit` solves, for a camera turned
// (yaw, pitch) with a lens, the nearest eye that holds every point inside the frame's margins, exactly: per screen
// axis the points' bounds against the lens's slopes give the boom's length and the look point's offset. The top margin
// is the largest (the head room). Past the furthest boom it widens the lens instead.
//
// Where it stands: side on to the line between the two (either side, a little behind seat 1), or turned off it, or
// higher and looking down, whichever eye stands clear of the world's solids by more than the near fade's distance
// and sees both bodies past them (the temple's lintels and drums, the redwoods' trunks), scored a few times a second
// with a margin to beat (no hunting), and the yaw and pitch eased toward it at a bounded rate (no snaps, no swing back
// and forth). Where nothing is in the way it is the plain side view.
//
// A clean eye (phase 3, report 13 issue 4; report 14-camera): every solid counts (World.solids: the world's, the arena's
// pieces, the powers' steps and pillars). A choice also pays for a piece standing in the near part of the frame (rays
// through the lens meeting a solid nearer than halfway to the bodies: a drum, a log, a slab across the lens). Each
// frame the fallback judges the eye clean (clear of solids by the near fade's distance and a margin, nothing across the
// near frame, both bodies seen past the solids), where it is and where the pair carries it a moment on; where it is
// not, it rises over the pieces first (held a while, so it does not bob), dips under an overhang only where no rise is
// clean, and only then comes in along the boom, never past what still holds the frame.
//
// Easing: the look point and boom chase the fit (out quickly, in slowly; up quickly, down gently), then a hard pass
// lengthens the boom to whatever keeps every point inside the hard margins from where the look point is now, so the
// ease never lets a body out of frame; the pass moves only as fast as the bodies do, so it never cuts.
//
// Juice (phase 3): `impulse` (the feel's catches, flings, tiers, lifts and merges) leans the look point toward the
// contact and eases the boom in or out for a moment, with a soft settle or sway, shaped u³(1 − u)⁴ (no step in speed or
// acceleration), bounded, and faded wherever it would make the eye less clean; a moment that holds the bodies (phase 4:
// weight.ts) rises over its hold and settles after it, so the camera arrives as the bodies let go (`hold`, smootherstep
// both ways, still no step in speed or acceleration). Time: the camera runs on real time (the
// page's f.dt, not the game's danceDt), so in a hit-stop or a slow motion it keeps easing toward the slowed bodies.
export type V3 = [number, number, number];

/** the world as the camera needs it: how far a point is from the nearest solid, whether a solid crosses the segment a → b
 *  (a sight line), and the ground's height */
export interface CamSpace {
  clear(p: V3): number;
  blocked(a: V3, b: V3): boolean;
  ground(x: number, z: number): number;
  /** the share of a → b a sphere of radius r moves before it touches a solid (1: clear) */
  sweep?(a: V3, b: V3, r: number): number;
  /** the share of the rays (unit directions) from the eye that meet a solid within `reach` m: a piece standing in the
   *  near part of the frame (without it only the eye and the sight lines are judged); `skip`: solids counted as clear
   *  (the near fade's dissolved pieces, for the judge) */
  fg?(eye: V3, rays: readonly V3[], reach: number, r?: number, weights?: readonly number[], skip?: ReadonlySet<object>): number;
  /** the same space over only the solids within r of p (null: all of them are) */
  local?(p: V3, r: number): CamSpace | null;
}

/** what the feel asks of the camera at a moment of contact (DuelCamera.impulse): where it happened, what it was, and
 *  how big (0 … 1) */
export type CamImpulseKind = 'catch' | 'fling' | 'tier' | 'lift' | 'merge';
export interface CamImpulse { at: [number, number, number]; kind: CamImpulseKind; k: number;
  /** the bodies' hold (s, weight.ts): the ease arrives as the hold lets go (its rise over the hold and half the ease
   *  back after it), then settles over the rest of the kind's length; none: the kind's own shape */
  hold?: number }

/** a body as the camera frames it */
export interface CamBody {
  /** the points to hold in frame (hips, chest, hands, feet), and those the eye must see past solids (hips, chest:
   *  the near fade's; feet hidden by a stepping stone in front are no loss) */
  pts: readonly V3[];
  sight: readonly V3[];
  /** the head (its top) and the body's root and velocity */
  head: V3;
  root: V3;
  vel: V3;
  /** in the air (not standing, not on a wall) */
  air: boolean;
  /** fallen and reforming (the duel's reform): not framed, the camera stays with the other a moment */
  away?: boolean;
}

export interface CamInput {
  bodies: readonly CamBody[];
  /** render width over height */
  aspect: number;
  /** the bodies' gravity (m/s², the duel's 40) */
  gravity: number;
  /** what is in the world (null: nothing solid) */
  space: CamSpace | null;
  /** the near fade's distance (m): the eye should stand clear of solids by more than this */
  near: number;
  /** the middle of the arena and how far from it the eye may stand (m); the longest boom the arena allows */
  center: V3;
  room: number;
  maxDist?: number;
  /** more margin all round (0 … 1: the finale stands back) */
  pad?: number;
  /** the arena's world (ARENA_CAM: what the camera does differently there) */
  arena?: string;
}

/** what the camera does differently in an arena (by its world): over water, the plain view comes down by `waterLow`
 *  rad while the bodies float (both: all of it, one: half), so from a lower eye a body afloat reads as afloat and the
 *  water shows the sky (report 16-pool); `water` the surface's height, a body afloat with its root 0.6 m under it.
 *  Only the plain view moves: the higher views the clean eye rises to are as they were */
export const ARENA_CAM: Record<string, { water: number; waterLow: number }> = { pool: { water: 0, waterLow: 0.1 } };

/** the pose this frame */
export interface CamPose { eye: V3; look: V3; fov: number; yaw: number; pitch: number; dist: number }

export const DUEL_CAM = {
  /** the lens (degrees, top to bottom) and the widest it goes when the boom is at its longest */
  fov: 46, widest: 70,
  /** the boom's shortest and longest (m) */
  minDist: 5, maxDist: 15,
  /** the frame's margins to aim for (share of the frame): top (head room), bottom, sides */
  top: 0.16, bottom: 0.1, side: 0.1,
  /** the margins never crossed (the hard pass) */
  hardTop: 0.1, hardBottom: 0.04, hardSide: 0.04,
  /** the pitches it may look down at (rad): the plain view first, then rising over the pieces */
  pitches: [0.2, 0.38, 0.55],
  /** the fallback's dips under what hangs over the pair where no tilt up is clean (rad, added to the pitch), and the
   *  lowest it looks (a little up) */
  dips: [-0.12, -0.22], minPitch: -0.08,
  /** the fallback's tilts up over what the eye would stand in (rad, added to the pitch), and the steepest look down */
  rises: [0.1, 0.2, 0.3, 0.42, 0.55],
  /** the fallback's boom never shorter than this (m) */
  minPull: 4,
  maxPitch: 0.75,
  /** the look down it keeps under (rad, 35°): a players' view, not a security camera's. Past it (to maxPitch, 43°) only
   *  where neither a turn nor the boom coming in made the eye clean */
  softPitch: 0.61,
  /** how often an unclean eye asks the choice again (s): a turn to a clear side comes before a steep rise */
  swingEvery: 0.15,
  /** the lenses it may choose (degrees): the plain one, and a wider one from closer in where the long boom stands
   *  among the pieces (the geode's shelves, the redwoods' trunks) */
  lenses: [46, 62],
  /** the turns off side on it tries (rad, either way) */
  offsets: [0, 0.3, 0.6, 0.9],
  /** the turn toward behind seat 1 (rad) */
  behind: 0.25,
  /** the eye clear of solids by the near fade's distance plus this (m) */
  clearExtra: 0.8,
  /** how often it reconsiders (s), and how much better another choice must score to take it */
  every: 0.25, beat: 0.3,
  /** the turn's top rate (rad/s) and its acceleration (rad/s²); the pitch's top rate */
  yawRate: 1.8, yawAccel: 6, pitchRate: 0.9,
  /** an apex is framed this far ahead at most (s), from at most this speed up (m/s: a launch is 16) */
  apexAhead: 0.8, apexMaxV: 20,
  /** what a choice costs: any sight line crossed by a solid, and more by the share crossed; the eye within the near
   *  distance of a solid, and less while within its margin; per radian off side on, of look down, of turn from the
   *  choice it has; the other side */
  /** side on matters from this far apart (m), fully this much further */
  sideFrom: 1.2, sideOver: 2.5,
  /** the sight lines also go to where each body will be this far on (s) */
  lookAhead: 0.3,
  /** a sight line stops this short of the body (m) */
  shortOf: 0.4,
  costs: { blocked: 1.2, blockedShare: 3, inside: 4, margin: 1.5, side: 0.4, pitch: 2.0, turn: 1.0, otherSide: 0.8, near: 0.8, nearShare: 6 },
  /** the frame's near part (a piece across the lens): rays through a cols × rows grid, looking for a solid nearer than
   *  `fgNear` of the way to the nearer body and at most `fgMax` m; the eye is clean while under `fgOk` of them meet one */
  fgCols: 7, fgRows: 4, fgNear: 0.6, fgMax: 5, fgOk: 0.03,
  /** a ray through a corner of the frame (the two outer columns of the top and bottom rows) counts this many times: a
   *  drum filling a near corner is nearly as bad as one over a body */
  fgCorner: 2.5,
  /** the fallback's rise is held this long (s) before it eases down to a lower one that is clean */
  riseHold: 0.6,
  /** the eye never stands further than this past the room from the arena's middle (m, any direction) */
  roomOver: 1.2,
};

/** the near grid's weights: DUEL_CAM.fgCorner in its corners, 1 elsewhere */
const FG_W: number[] = (() => {
  const P = DUEL_CAM, w: number[] = [];
  for (let j = 0; j < P.fgRows; j++) for (let i = 0; i < P.fgCols; i++) w.push((i < 2 || i >= P.fgCols - 2) && (j === 0 || j === P.fgRows - 1) ? P.fgCorner : 1);
  return w;
})();

/** each impulse's shape (DuelCamera.impulse), at k = 1: how far the look point leans toward the contact (a share of the
 *  way, at most `reach` m), how much of the boom it eases in (negative: out), its length (s), a soft settle of the look
 *  point (m down, the weight arriving; negative: up) and a sway across (m) at a period (s). Every one starts and ends
 *  at rest with no step in its speed or its acceleration (u³(1 − u)⁴): an ease and a settle, never a jolt */
export const IMPULSE: Record<CamImpulseKind, { lean: number; push: number; len: number; settle: number; sway: number; period: number }> = {
  catch: { lean: 0.22, push: 0.07, len: 1.2, settle: 0.05, sway: 0, period: 0.8 },
  fling: { lean: 0.12, push: -0.04, len: 1.2, settle: 0, sway: 0.06, period: 1.1 },
  tier: { lean: 0.1, push: 0.05, len: 1.5, settle: 0.03, sway: 0, period: 1.5 },
  lift: { lean: 0.15, push: 0.03, len: 1.3, settle: -0.06, sway: 0, period: 1.3 },
  merge: { lean: 0.3, push: 0.1, len: 1.9, settle: 0.03, sway: 0.03, period: 1.7 },
};
/** all impulses at once never lean further than this (m), nor ease the boom in or out past these shares */
const IMP_REACH = 0.8, IMP_IN = 0.14, IMP_OUT = 0.08;
/** u³(1 − u)⁴, its peak 1 (at u = 3/7) */
const bump = (u: number) => (u <= 0 || u >= 1 ? 0 : (u * u * u * (1 - u) ** 4) / 0.008393);
/** a held moment's shape: up over `rise` s and down over the rest of `len`, each a smootherstep (no step in speed or
 *  acceleration at either end) */
const held = (age: number, rise: number, len: number) => {
  const s = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * k * (k * (k * 6 - 15) + 10); };
  return age <= 0 || age >= len ? 0 : age < rise ? s(age / rise) : 1 - s((age - rise) / Math.max(1e-3, len - rise));
};

/** the unit directions through a cols × rows grid on the screen of a camera turned (yaw, pitch) with a lens */
export function raysAt(yaw: number, pitch: number, fov: number, aspect: number, cols: number, rows: number): V3[] {
  const { back, right, up } = axes(yaw, pitch), t = Math.tan((fov * Math.PI) / 360);
  const out: V3[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (((i + 0.5) / cols) * 2 - 1) * t * aspect, y = (1 - ((j + 0.5) / rows) * 2) * t;
    const d: V3 = [-back[0] + right[0] * x + up[0] * y, -back[1] + up[1] * y, -back[2] + right[2] * x + up[2] * y], l = Math.hypot(...d);
    out.push([d[0] / l, d[1] / l, d[2] / l]);
  }
  return out;
}

/** how far the frame's near part reaches from an eye: `fgNear` of the way to the nearer body's hips, at most `fgMax` */
export function nearReach(eye: V3, bodies: readonly CamBody[]) {
  let d = Infinity;
  for (const b of bodies) d = Math.min(d, Math.hypot(b.pts[0][0] - eye[0], b.pts[0][1] - eye[1], b.pts[0][2] - eye[2]));
  return Math.min(DUEL_CAM.fgMax, d * DUEL_CAM.fgNear);
}

/** the point `by` metres short of b on the way from a */
export const short = (a: V3, b: V3, by: number): V3 => {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), k = L > by ? (L - by) / L : 0;
  return [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth01 = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

/** the camera's axes for a yaw and pitch (the rig's convention: the eye stands at look + back · dist, back =
 *  (sin yaw cos pitch, sin pitch, cos yaw cos pitch)) */
export function axes(yaw: number, pitch: number) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const back: V3 = [sy * cp, sp, cy * cp];
  const right: V3 = [cy, 0, -sy];
  const up: V3 = [-sp * sy, cp, -sp * cy];
  return { back, right, up };
}

/** where a body's head will peak while it rises (null when it isn't rising): the ballistic apex at gravity g, its
 *  horizontal drift on the way, looked ahead at most `ahead` seconds */
export function apexOf(head: V3, vel: V3, g: number, ahead = DUEL_CAM.apexAhead): V3 | null {
  // (the speed up taken at most a launch's and the drift at most a metre and a half: a body's velocity spikes for a
  // frame when the contact moves it, and a spike is not a flight)
  const vy = Math.min(vel[1], DUEL_CAM.apexMaxV);
  if (vy <= 0.5 || g <= 0) return null;
  const t = Math.min(vy / g, ahead), dx = vel[0] * t, dz = vel[2] * t, dl = Math.hypot(dx, dz), k = dl > 1.5 ? 1.5 / dl : 1;
  return [head[0] + dx * k, head[1] + vy * t - 0.5 * g * t * t, head[2] + dz * k];
}

/** the screen position (0 … 1 across, 0 … 1 down) of p seen from a pose, or null behind the eye */
export function screenOf(p: V3, eye: V3, look: V3, fov: number, aspect: number): [number, number] | null {
  const f: V3 = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], L = Math.hypot(...f) || 1;
  const yaw = Math.atan2(-f[0], -f[2]), pitch = Math.asin(Math.max(-1, Math.min(1, -f[1] / L)));
  const { back, right, up } = axes(yaw, pitch);
  const d: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const z = -(d[0] * back[0] + d[1] * back[1] + d[2] * back[2]);
  if (z <= 1e-3) return null;
  const t = Math.tan((fov * Math.PI) / 360);
  const x = (d[0] * right[0] + d[2] * right[2]) / (z * t * aspect), y = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (z * t);
  return [0.5 + 0.5 * x, 0.5 - 0.5 * y];
}

export interface Margins { top: number; bottom: number; side: number }

/** the nearest pose turned (yaw, pitch) that holds every point inside the margins (shares of the frame), with the lens
 *  `fov` (degrees, top to bottom), the boom at least `minDist`; past `maxDist` the lens widens (up to `widest`) instead.
 *  Exact: with the look point free to move across and up, each screen axis gives the boom it needs from the points'
 *  extremes against the lens's slopes, and the look point sits in the middle of what then fits */
export function fit(pts: readonly V3[], yaw: number, pitch: number, fov: number, aspect: number, m: Margins,
  minDist = DUEL_CAM.minDist, maxDist = DUEL_CAM.maxDist, widest = DUEL_CAM.widest) {
  const { back, right, up } = axes(yaw, pitch);
  // (relative to the points' middle, for numbers of a sensible size)
  const C: V3 = [0, 0, 0];
  for (const p of pts) { C[0] += p[0]; C[1] += p[1]; C[2] += p[2]; }
  const n = Math.max(1, pts.length);
  C[0] /= n; C[1] /= n; C[2] /= n;
  const solve = (tanY: number) => {
    const kx = (1 - 2 * m.side) * tanY * aspect, kt = (1 - 2 * m.top) * tanY, kb = (1 - 2 * m.bottom) * tanY;
    let Hx = -Infinity, Lx = -Infinity, Hy = -Infinity, Ly = -Infinity, Hz = -Infinity;
    for (const p of pts) {
      const d0 = p[0] - C[0], d1 = p[1] - C[1], d2 = p[2] - C[2];
      const a = d0 * right[0] + d2 * right[2], b = d0 * up[0] + d1 * up[1] + d2 * up[2];
      const c = -(d0 * back[0] + d1 * back[1] + d2 * back[2]);   // depth beyond the middle, along the view
      Hx = Math.max(Hx, a - kx * c); Lx = Math.max(Lx, -a - kx * c);
      Hy = Math.max(Hy, b - kt * c); Ly = Math.max(Ly, -b - kb * c);
      Hz = Math.max(Hz, 1.2 - c);
    }
    const D = Math.max((Hx + Lx) / (2 * kx), (Hy + Ly) / (kt + kb), Hz, minDist);
    // the look point: the middle of the span that fits, across and up
    const ex = ((Hx - kx * D) + (kx * D - Lx)) / 2, ey = ((Hy - kt * D) + (kb * D - Ly)) / 2;
    return { D, ex, ey };
  };
  const t0 = Math.tan((fov * Math.PI) / 360);
  let tanY = t0, s = solve(t0);
  if (s.D > maxDist) {
    // the boom at its longest: the narrowest lens that holds them from there (a few halvings)
    let lo = t0, hi = Math.tan((widest * Math.PI) / 360);
    if (solve(hi).D <= maxDist) {
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (solve(mid).D > maxDist) lo = mid; else hi = mid; }
      tanY = hi;
    } else tanY = hi;
    s = solve(tanY);
  }
  const look: V3 = [C[0] + right[0] * s.ex + up[0] * s.ey, C[1] + up[1] * s.ey, C[2] + right[2] * s.ex + up[2] * s.ey];
  const eye: V3 = [look[0] + back[0] * s.D, look[1] + back[1] * s.D, look[2] + back[2] * s.D];
  return { look, eye, dist: s.D, fov: (Math.atan(tanY) * 360) / Math.PI };
}

/** the boom (from a fixed look point) that keeps every point inside the margins, for a yaw, pitch and lens */
export function boomFor(pts: readonly V3[], look: V3, yaw: number, pitch: number, fov: number, aspect: number, m: Margins) {
  const { back, right, up } = axes(yaw, pitch);
  const tanY = Math.tan((fov * Math.PI) / 360);
  const kx = (1 - 2 * m.side) * tanY * aspect, kt = (1 - 2 * m.top) * tanY, kb = (1 - 2 * m.bottom) * tanY;
  let D = 0;
  for (const p of pts) {
    const d0 = p[0] - look[0], d1 = p[1] - look[1], d2 = p[2] - look[2];
    const a = d0 * right[0] + d2 * right[2], b = d0 * up[0] + d1 * up[1] + d2 * up[2];
    const c = -(d0 * back[0] + d1 * back[1] + d2 * back[2]);
    D = Math.max(D, Math.abs(a) / kx - c, b / kt - c, -b / kb - c, 1.2 - c);
  }
  return D;
}

/** a choice of where to stand: a yaw and a pitch, and what it costs */
interface Choice { yaw: number; pitch: number; lens: number; side: number; score: number }

export class DuelCamera {
  /** the turn and look down now, and what they head for */
  yaw = 0;
  pitch: number = DUEL_CAM.pitches[0];
  private yawV = 0;
  want: Choice | null = null;
  /** the eased pose */
  readonly look: V3 = [0, 1, 0];
  dist = 8;
  fov: number = DUEL_CAM.fov;
  /** the side-on direction (rad), eased while the pair is far enough apart to have one */
  private side: number | null = null;
  private wait = 0;
  private fresh = true;
  /** the fallback's tilt up over the pieces (rad) and the boom's share it keeps (1: all of it) */
  private rise = 0;
  private pull = 1;
  /** the rise the fallback holds, and how long a lower one has been enough */
  private riseKeep = 0;
  /** the eye was cluttered and nothing modest cleaned it (the steep tilts are allowed), and when it may ask the choice
   *  again */
  private steep = false;
  private swingT = 0;
  private riseLow = 0;
  /** the impulses under way (their age in seconds of real time), and how much of them the clean eye lets through */
  private imps: (CamImpulse & { age: number; rise: number })[] = [];
  /** how far the plain view has come down over water now (rad: ARENA_CAM) */
  private low = 0;
  private impGain = 1;
  /** the probe's: also judge the eye it gives (last.eyeBad) */
  debug = false;
  /** what the last update framed, and what the choice saw (for the page's probes and the tests): the eye's clearance,
   *  how unclean the fallback found it (0: clean), the impulses' lean (m) and push (share of the boom) */
  framed: V3[] = [];
  last = { clear: Infinity, blocked: 0, choices: 0, bad: 0, found: true, lag: 0, pull: 1, lean: 0, push: 0, eyeBad: 0, wantFg: 0, wantScore: 0 };

  /** start again from the next update (snapped there, as on a duel's first frame) */
  reset() { this.fresh = true; this.want = null; this.side = null; this.yawV = 0; this.imps.length = 0; this.riseKeep = 0; this.riseLow = 0; this.low = 0; }

  /** a moment of contact for the camera to feel (phase 3's juice: the feel calls `camera.impulse?.(…)`): for a moment
   *  the look point leans toward `at` and the boom eases in (or, for a fling, out), with a soft settle or sway, sized
   *  by `k` (0 … 1) and the kind's shape (IMPULSE). It eases in and out with no step in speed or acceleration, never
   *  a jolt; several at once are summed and bounded; it fades where it would take the eye into a piece, and the frame's
   *  hard margins still hold every body. Its time is the camera's: real seconds (update's dt), so a hit-stop or a slow
   *  motion that scales the game's dt leaves the camera moving at its own pace */
  impulse(e: CamImpulse) {
    const k = Math.max(0, Math.min(1, Number.isFinite(e.k) ? e.k : 0));
    if (k <= 0 || !IMPULSE[e.kind] || !e.at.every(Number.isFinite)) return;
    // (held: the rise over the hold and half its ease back, 0.25 s at the least, at most half the kind's length)
    const h = Number.isFinite(e.hold) && e.hold! > 0 ? e.hold! : 0, len = IMPULSE[e.kind].len;
    const rise = h > 0 ? Math.min(len * 0.5, Math.max(0.25, h + 0.5 * (0.12 + 0.8 * h))) : 0;
    this.imps.push({ at: [e.at[0], e.at[1], e.at[2]], kind: e.kind, k, age: 0, rise });
    if (this.imps.length > 6) this.imps.shift();
  }

  /** the impulses' sum now: the look point's offset (m) and the boom's share eased in (negative: out) */
  private impulses(dt: number) {
    const lean: V3 = [0, 0, 0];
    let push = 0;
    const right = axes(this.yaw, this.pitch).right;
    this.imps = this.imps.filter((m) => {
      const S = IMPULSE[m.kind];
      m.age += dt;
      const u = m.age / S.len;
      if (u >= 1) return false;
      const b = (m.rise > 0 ? held(m.age, m.rise, S.len) : bump(u)) * m.k;
      const to: V3 = [m.at[0] - this.look[0], m.at[1] - this.look[1], m.at[2] - this.look[2]], L = Math.hypot(...to);
      const w = L > 1e-6 ? (Math.min(L * S.lean, IMP_REACH) / L) * b : 0;
      const sway = S.sway * m.k * Math.sin((2 * Math.PI * m.age) / S.period) * Math.sin(Math.PI * u) ** 2;
      lean[0] += to[0] * w + right[0] * sway;
      lean[1] += to[1] * w - S.settle * b;
      lean[2] += to[2] * w + right[2] * sway;
      push += S.push * b;
      return true;
    });
    // (bounded softly: two catches at once lean a little further than one, never twice as far)
    const L = Math.hypot(...lean);
    if (L > 1e-6) { const k = (IMP_REACH * Math.tanh(L / IMP_REACH)) / L; lean[0] *= k; lean[1] *= k; lean[2] *= k; }
    push = push > 0 ? IMP_IN * Math.tanh(push / IMP_IN) : -IMP_OUT * Math.tanh(-push / IMP_OUT);
    return { lean, push, on: this.imps.length > 0 };
  }

  /** the player turned the camera by hand: take that yaw, and hold it a moment */
  hold(yaw: number) {
    this.yaw = yaw; this.yawV = 0; this.wait = 1;
    if (this.want) this.want.yaw = yaw;
  }

  /** the points framed: every body's, and where a rising body's head will peak */
  pointsOf(I: CamInput) {
    const pts: V3[] = [];
    for (const b of I.bodies) {
      for (const p of b.pts) pts.push(p);
      pts.push([b.head[0], b.head[1] + 0.12, b.head[2]]);
      if (b.air) {
        const A = apexOf(b.head, b.vel, I.gravity);
        if (A) pts.push([A[0], A[1] + 0.12, A[2]]);
      }
    }
    return pts;
  }

  update(dt: number, I: CamInput): CamPose {
    const P = DUEL_CAM, pad = I.pad ?? 0;
    // (the plain view over water, eased: ARENA_CAM)
    const AC = I.arena ? ARENA_CAM[I.arena] : undefined;
    const afloat = AC ? I.bodies.filter((b) => !b.away && b.root[1] < AC.water - 0.6).length / Math.max(1, I.bodies.length) : 0;
    this.low += ((AC ? AC.waterLow * afloat : 0) - this.low) * Math.min(1, dt * 1.5);
    const plain = P.pitches[0] - this.low, pitches = [plain, ...P.pitches.slice(1)];
    // (a body fallen and reforming is not followed down: the other is framed alone till it is back)
    if (I.bodies.length === 2 && I.bodies.some((b) => b.away) && !I.bodies.every((b) => b.away)) {
      const here = I.bodies.find((b) => !b.away)!;
      I = { ...I, bodies: [here, here] };
    }
    // (only the solids round the pair matter: the eye stands at most the longest boom from them)
    if (I.space?.local) {
      const c: V3 = [0, 0, 0];
      for (const b of I.bodies) { c[0] += b.root[0] / I.bodies.length; c[1] += b.root[1] / I.bodies.length; c[2] += b.root[2] / I.bodies.length; }
      I = { ...I, space: I.space.local(c, Math.min(P.maxDist, I.maxDist ?? Infinity, I.room + P.roomOver) * 1.25 + 3) ?? I.space };
    }
    const pts = this.pointsOf(I);
    this.framed = pts;
    const soft: Margins = { top: P.top + pad * 0.08, bottom: P.bottom + pad * 0.06, side: P.side + pad * 0.06 };
    const hard: Margins = { top: P.hardTop, bottom: P.hardBottom, side: P.hardSide };
    // the side-on direction: square to the line between the two (eased; held while they stand on top of each other)
    const [A, B] = I.bodies;
    const dx = B.root[0] - A.root[0], dz = B.root[2] - A.root[2], l = Math.hypot(dx, dz);
    // (close together, any side shows both: side on matters as they part, and turning with a pair that circles at arm's
    // length is what made the old camera swing)
    const sep = smooth01((l - P.sideFrom) / P.sideOver);
    if (l > 0.3) {
      const s = Math.atan2(-dz / l, dx / l);
      if (this.side == null) this.side = s;
      // (side on is a line, not a direction: the nearer of s and s + π)
      const t = Math.abs(wrap(s - this.side)) > Math.PI / 2 ? s + Math.PI : s;
      this.side = wrap(this.side + wrap(t - this.side) * Math.min(1, dt * 2 * sep + (this.fresh ? 1 : 0)));
    }
    if (this.side == null) this.side = this.yaw;
    // which way is behind seat 1 (a little turn toward it)
    const behind = Math.atan2(-dx, -dz);

    const K = P.costs;
    const ahead: V3[] = [];
    for (const b of I.bodies) {
      const t = P.lookAhead, g = b.air ? I.gravity : 0;
      const dy = b.vel[1] * t - 0.5 * g * t * t;
      for (const p of [b.pts[0], b.head]) ahead.push([p[0] + b.vel[0] * t, Math.max(b.root[1], p[1] + dy), p[2] + b.vel[2] * t]);
    }
    const maxD = Math.min(P.maxDist, I.maxDist ?? Infinity);
    let lastFg = 0;
    const score = (yaw: number, pitch: number, base: number, lens: number): number => {
      lastFg = 0;
      const f = fit(pts, yaw, pitch, lens, I.aspect, soft, P.minDist, maxD);
      let s = 0;
      if (I.space) {
        // (the eye where the fit puts it, and back along the boom to where the boom is now: it eases in from there)
        let clear = I.space.clear(f.eye);
        const far = Math.min(this.dist, P.maxDist) - f.dist;
        if (!this.fresh && far > 0.3) {
          const b = axes(yaw, pitch).back;
          for (const k of [0.5, 1]) clear = Math.min(clear, I.space.clear([f.eye[0] + b[0] * far * k, f.eye[1] + b[1] * far * k, f.eye[2] + b[2] * far * k]));
        }
        const want = I.near + P.clearExtra;
        if (clear < I.near) s += K.inside + (I.near - clear) * 4;
        else if (clear < want) s += K.margin * (want - clear) / (want - I.near);
        // the sight lines to each body (hips, chest, head: its first, middle and head points)
        // (each line stops short of its point: a wall the body hangs on or a slab it stands on is not in the way)
        let n = 0, m = 0;
        const line = (p: V3) => { m++; if (I.space!.blocked(f.eye, short(f.eye, p, P.shortOf))) n++; };
        for (const b of I.bodies) { for (const p of b.sight) line(p); line(b.head); }
        // (and where the body will be a moment on: its hips and head, ballistic in the air, so a choice holds a while)
        for (const q of ahead) line(q);
        if (n) s += K.blocked + K.blockedShare * (n / m);
        // a piece across the near part of the frame (a drum, a log, a slab between the lens and the pair)
        if (I.space.fg) {
          // (from the fit's eye, and from back along the boom where it eases in from)
          const rays = raysAt(yaw, pitch, f.fov, I.aspect, P.fgCols, P.fgRows);
          let fg = I.space.fg(f.eye, rays, nearReach(f.eye, I.bodies), 0.04, FG_W);
          const far = Math.min(this.dist, P.maxDist) - f.dist;
          if (!this.fresh && far > 0.3) {
            const b = axes(yaw, pitch).back, e: V3 = [f.eye[0] + b[0] * far, f.eye[1] + b[1] * far, f.eye[2] + b[2] * far];
            fg = Math.max(fg, I.space.fg(e, rays, nearReach(e, I.bodies), 0.04, FG_W));
          }
          if (fg > 0) s += K.near + K.nearShare * fg;
          lastFg = fg;
        }
        // the eye under the ground, or past the arena's room
        if (f.eye[1] < I.space.ground(f.eye[0], f.eye[2]) + 0.4) s += 3;
      }
      const out = Math.hypot(f.eye[0] - I.center[0], f.eye[2] - I.center[2]) - I.room;
      if (out > 0) s += Math.min(2, out * 0.5);
      // (and never out through the world's shell: past the room by more than roomOver, in any direction)
      const out3 = Math.hypot(f.eye[0] - I.center[0], f.eye[1] - I.center[1], f.eye[2] - I.center[2]) - (I.room + P.roomOver);
      if (out3 > 0) s += K.inside + out3 * 2;
      // side on (with the turn toward behind seat 1) unless the pair is on top of each other; the lower view; the
      // lens unwidened; little turn from what it is heading for; the other side only for a real gain
      const ideal = base + P.behind * Math.sign(wrap(behind - base));
      s += Math.abs(wrap(yaw - ideal)) * K.side * sep;
      s += Math.abs(pitch - plain) * K.pitch;
      s += Math.max(0, f.fov - P.fov) / 25;
      if (this.want) {
        s += Math.abs(wrap(yaw - this.yaw)) * K.turn;
        if (Math.abs(wrap(base - this.want.side)) > 1) s += K.otherSide;
      }
      return s;
    };

    this.wait -= dt;
    if (this.fresh || this.wait <= 0) {
      this.wait = P.every;
      let best: Choice | null = null, n = 0;
      for (const base of [this.side, wrap(this.side + Math.PI)]) {
        for (const o of P.offsets) for (const sg of o ? [1, -1] : [1]) for (const pitch of pitches) for (const lens of P.lenses) {
          const yaw = wrap(base + o * sg), sc = score(yaw, pitch, base, lens);
          n++;
          if (!best || sc < best.score) best = { yaw, pitch, lens, side: base, score: sc };
        }
      }
      // (what it heads for now, scored the same way: kept unless the best is clearly better)
      if (this.want) {
        // (the current choice keeps its place relative to the side-on direction as the pair turns)
        const nowSide = Math.abs(wrap(this.want.side - this.side)) < Math.PI / 2 ? this.side : wrap(this.side + Math.PI);
        const off = wrap(this.want.yaw - this.want.side);
        const y = wrap(nowSide + off), sc = score(y, this.want.pitch, nowSide, this.want.lens);
        this.want = { yaw: y, pitch: this.want.pitch, lens: this.want.lens, side: nowSide, score: sc };
        if (best && best.score < sc - P.beat) this.want = best;
      } else this.want = best;
      this.last.choices = n;
      if (this.debug && this.want) { score(this.want.yaw, this.want.pitch, this.want.side, this.want.lens); this.last.wantFg = lastFg; this.last.wantScore = this.want.score; }
    }
    const W = this.want!;
    // the yaw and pitch eased toward the choice at a bounded rate and acceleration (no snaps, no overshoot)
    if (this.fresh) { this.yaw = W.yaw; this.pitch = W.pitch; this.yawV = 0; }
    else {
      const d = wrap(W.yaw - this.yaw);
      // (its speed capped, and never more than it can stop from in the turn left: it arrives without passing it)
      const vWant = Math.sign(d) * Math.min(P.yawRate, Math.abs(d) * 2.5, Math.sqrt(2 * P.yawAccel * Math.abs(d)) * 0.8);
      const dv = Math.max(-P.yawAccel * dt, Math.min(P.yawAccel * dt, vWant - this.yawV));
      this.yawV += dv;
      this.yaw = wrap(this.yaw + this.yawV * dt);
      const dp = W.pitch - this.pitch;
      this.pitch += Math.max(-P.pitchRate * dt, Math.min(P.pitchRate * dt, dp * (1 - Math.exp(-dt * 3))));
    }
    // the fit from where it is turned now, chased: out and up quickly, in and down gently
    const F = fit(pts, this.yaw, this.pitch, W.lens, I.aspect, soft, P.minDist, maxD);
    if (this.fresh) { this.look[0] = F.look[0]; this.look[1] = F.look[1]; this.look[2] = F.look[2]; this.dist = F.dist; this.fov = F.fov; }
    else {
      const k = 1 - Math.exp(-dt * 5);
      this.look[0] += (F.look[0] - this.look[0]) * k;
      this.look[2] += (F.look[2] - this.look[2]) * k;
      this.look[1] += (F.look[1] - this.look[1]) * (1 - Math.exp(-dt * (F.look[1] > this.look[1] ? 9 : 3)));
      // (in faster while the eye it gave last frame stood in the pieces)
      this.dist += (F.dist - this.dist) * (1 - Math.exp(-dt * (F.dist > this.dist ? 8 : this.last.eyeBad > 0 ? 10 : 4)));
      this.fov += (F.fov - this.fov) * (1 - Math.exp(-dt * (F.fov > this.fov ? 8 : 1.2)));
    }
    // the impulses (the feel's moments of contact): the look point leaning toward each, the boom easing in or out, a
    // soft settle or sway; summed and bounded, and only as much as the clean eye lets through (impGain)
    const imp = this.impulses(dt), g = this.impGain;
    const look: V3 = [this.look[0] + imp.lean[0] * g, this.look[1] + imp.lean[1] * g, this.look[2] + imp.lean[2] * g];
    // the fallback, for what the choice could not avoid (a turn under way past a column, the pair backed into the ruin):
    // first the eye rises over the pieces (the boom tilted up, eased up quickly, held, and back down slowly), and only
    // where no tilt clears them does the boom come in along itself (in quickly, out slowly; at once where the eye would
    // stand inside the near fade's distance), the lens widening to hold the frame from there. Clean is: clear of every
    // solid by the near fade's distance and a margin, no piece across the near part of the frame, and each body seen
    // past the solids (two of its hips, chest and head). The choice keeps this rare
    const sp = I.space;
    /** how far past the room the eye stands (m; the world's shell beyond it, the geode's hollow, is no solid) */
    const outOf = (p: V3) => Math.hypot(p[0] - I.center[0], p[1] - I.center[1], p[2] - I.center[2]) - (I.room + P.roomOver);
    const eyeAt = (pitch: number, d: number, at: V3 = look): V3 => {
      const b = axes(this.yaw, pitch).back;
      return [at[0] + b[0] * d, at[1] + b[1] * d, at[2] + b[2] * d];
    };
    /** how unclean an eye is (0: clean), for a camera at this pitch */
    const bad = (e: V3, pitch: number): number => {
      if (!sp) return 0;
      let b = 0;
      const c = sp.clear(e), want = I.near + 0.35, o = outOf(e);
      if (o > 0) b += 1 + o * 2;
      if (c < want) b += 1 + (want - c) * 2;
      if (sp.fg) {
        const fg = sp.fg(e, raysAt(this.yaw, pitch, this.fov, I.aspect, P.fgCols, P.fgRows), nearReach(e, I.bodies), 0.04, FG_W);
        if (fg > P.fgOk) b += 0.5 + fg * 3;
      }
      for (const B of I.bodies) {
        let n = 0;
        for (const p of [B.sight[0], B.sight[1] ?? B.sight[0], B.head]) if (sp.blocked(e, short(e, p, P.shortOf))) n++;
        // (one of them hidden is already unclean: a slab partly over the pair)
        if (n) b += 0.2 + 0.3 * n;
      }
      return b;
    };
    // (judged where the eye is and where it will be a moment on, the look point carried with the pair: the tilt starts
    // before the drum is in the lens, not once it fills it)
    const vel: V3 = [0, 0, 0];
    for (const b of I.bodies) for (let j = 0; j < 3; j++) vel[j] += b.vel[j] / I.bodies.length;
    const vl = Math.hypot(...vel), vk = vl > 6 ? 6 / vl : 1, ta = P.lookAhead;
    const lookOn: V3 = [look[0] + vel[0] * vk * ta, look[1] + Math.max(-1, Math.min(1, vel[1] * vk * ta)), look[2] + vel[2] * vk * ta];
    // (where it is already unclean, a moment on is not asked: the least unclean is judged on now alone)
    const badBoth = (p: number) => { const b = bad(eyeAt(p, this.dist), p); return b > 0 || vl <= 0.5 ? b : bad(eyeAt(p, this.dist, lookOn), p); };
    let riseWant = 0, found = false;
    const bad0 = sp ? badBoth(this.pitch) : 0;
    // (an unclean eye asks the choice again at once: a turn to a clear side first, a modest rise meanwhile)
    this.swingT -= dt;
    if (bad0 > 0 && this.swingT <= 0) { this.wait = 0; this.swingT = P.swingEvery; }
    if (bad0 > 0) {
      // (the first tilt that is clean, under the soft ceiling unless last frame neither a turn nor the boom made it clean;
      // where none is, the least unclean, if it is clearly better)
      const cap = this.steep ? P.maxPitch : P.softPitch;
      let best = bad0;
      for (const r of P.rises) {
        const p = Math.min(cap, this.pitch + r), b = badBoth(p);
        if (b === 0) { riseWant = r; best = 0; found = true; break; }
        if (b < best - 0.1) { best = b; riseWant = r; }
      }
      // (where no tilt up is clean, a dip under what hangs over the pair: the geode's high shelves)
      if (!found) for (const r of P.dips) {
        const p = Math.max(P.minPitch, this.pitch + r), b = badBoth(p);
        if (b === 0) { riseWant = p - this.pitch; found = true; break; }
      }
    }
    // (held: a higher tilt is taken at once, a lower one only once it has been enough for a while, so the eye does not
    // bob over a row of drums)
    // (and dropped at once where the tilt it holds is no longer clean itself)
    const keptBad = () => { const p = Math.min(this.steep ? P.maxPitch : P.softPitch, this.pitch + this.riseKeep); return bad(eyeAt(p, this.dist), p) > 0; };
    const away = Math.abs(riseWant) >= Math.abs(this.riseKeep) && riseWant * this.riseKeep >= 0;
    if (this.fresh || away || (riseWant !== this.riseKeep && keptBad())) { this.riseKeep = riseWant; this.riseLow = 0; }
    else if ((this.riseLow += dt) >= P.riseHold) { this.riseKeep = riseWant; this.riseLow = 0; }
    // (eased up quickly and down slowly; while the eye it gave last frame was unclean, quickly either way)
    // (away from the plain view quickly, back to it slowly; while the eye it gave last frame was unclean, quickly)
    const dr = this.riseKeep - this.rise, quick = this.last.eyeBad > 0 || Math.abs(this.riseKeep) > Math.abs(this.rise) + 1e-4;
    const rate = quick ? 1.6 : 0.5, kr = quick ? 8 : 1.5;
    this.rise = this.fresh ? this.riseKeep : this.rise + Math.max(-rate * dt, Math.min(rate * dt, dr * (1 - Math.exp(-dt * kr))));
    const pitch = Math.max(P.minPitch, Math.min(this.steep ? P.maxPitch : Math.max(P.softPitch, Math.min(P.maxPitch, this.pitch)), this.pitch + this.rise));
    // the hard pass: whatever the ease left out, the boom (then the lens) takes in from where the look point is now
    const need = boomFor(pts, look, this.yaw, pitch, this.fov, I.aspect, hard);
    if (need > this.dist) this.dist = Math.min(need, maxD * 1.25);
    // (an impulse eases the boom in or out, never in past what holds every body inside the hard margins)
    const D0 = Math.max(Math.min(need, maxD * 1.25), this.dist * (1 - imp.push * g));
    // (never in closer than P.minPull metres: an eye a metre from the dancers, its lens at the widest, is worse than a
    // stone dissolved by the near fade; where nothing down to there is clean, the clearest of them)
    const clearOk = (p: V3) => (!sp || sp.clear(p) > I.near + 0.35) && outOf(p) <= 0;
    // (in along the boom also past a piece across the near part of the frame where no tilt cleared it, only as far as
    // an eye that is clean)
    let pullWant = 1;
    const e0 = eyeAt(pitch, D0), inSolid = !!sp && !clearOk(e0), cluttered = !!sp && !inSolid && !found && bad0 > 0 && bad(e0, pitch) > 0;
    if (sp && (inSolid || cluttered)) {
      // (and never in past what holds every body inside the hard margins with the lens a little short of its widest)
      const lo = Math.min(1, Math.max(P.minPull, boomFor(pts, look, this.yaw, pitch, P.widest - 4, I.aspect, hard)) / Math.max(1e-3, D0));
      let best = sp.clear(e0), ok = -1;
      for (let k = 0.95; k >= lo - 1e-6; k -= 0.05) {
        const e = eyeAt(pitch, D0 * k), c = sp.clear(e), b = c > I.near + 0.35 ? bad(e, pitch) : Infinity;
        if (b === 0) { pullWant = k; ok = -1; break; }
        if (inSolid && ok < 0 && b < 1) ok = k;
        if (inSolid && c > best + 0.1) { best = c; pullWant = k; }
      }
      if (ok > 0) pullWant = ok;
    }
    // (cluttered with no clean tilt, turn or boom: next frame the tilt may go steeper, up to maxPitch)
    this.steep = cluttered && pullWant === 1 && !found;
    this.pull = this.fresh ? pullWant : this.pull + (pullWant - this.pull) * (1 - Math.exp(-dt * (pullWant < this.pull ? 14 : 1.5)));
    if (sp && pullWant < this.pull && sp.clear(eyeAt(pitch, D0 * this.pull)) < I.near + 0.15) this.pull = pullWant;
    let D = D0 * this.pull;
    // (and never out through the shell: the boom shortened to stay inside the room, the lens widening from there)
    if (outOf(eyeAt(pitch, D)) > 0 && outOf(look) < 0) {
      let lo = 0, hi = D;
      for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (outOf(eyeAt(pitch, m)) > 0) hi = m; else lo = m; }
      // (never in past what the widest lens needs to hold every body: the flyer in frame wins over the shell)
      D = Math.max(lo, Math.min(D, Math.max(2.5, boomFor(pts, look, this.yaw, pitch, P.widest, I.aspect, hard))));
    }
    let fov = this.fov;
    if (boomFor(pts, look, this.yaw, pitch, fov, I.aspect, hard) > D) {
      let lo = fov, hi = P.widest;
      for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (boomFor(pts, look, this.yaw, pitch, mid, I.aspect, hard) > D) lo = mid; else hi = mid; }
      fov = hi;
    }
    const eye = eyeAt(pitch, D);
    if (sp) {
      const gr = sp.ground(eye[0], eye[2]);
      if (Number.isFinite(gr) && eye[1] < gr + 0.4) eye[1] = gr + 0.4;
      this.last.clear = sp.clear(eye);
    }
    // (the impulses let through only while they keep the eye as clean as it would be without them: faded out within a
    // fifth of a second where they would not, back in as gently)
    let gainWant = 1;
    if (imp.on && sp && g > 0.01) {
      const plain = eyeAt(pitch, this.dist * this.pull, this.look);
      if (bad(eye, pitch) > bad(plain, pitch) + 1e-6) gainWant = 0;
    }
    this.impGain += (gainWant - this.impGain) * (1 - Math.exp(-dt * (gainWant < this.impGain ? 12 : 3)));
    this.last.bad = bad0; this.last.found = found || bad0 === 0; this.last.lag = Math.abs(this.rise - this.riseKeep); this.last.pull = this.pull; this.last.eyeBad = sp ? bad(eye, pitch) : 0; this.last.lean = Math.hypot(...imp.lean) * g; this.last.push = imp.push * g;
    this.fresh = false;
    return { eye, look, fov, yaw: this.yaw, pitch, dist: D };
  }
}

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
// Easing: the look point and boom chase the fit (out quickly, in slowly; up quickly, down gently), then a hard pass
// lengthens the boom to whatever keeps every point inside the hard margins from where the look point is now, so the
// ease never lets a body out of frame; the pass moves only as fast as the bodies do, so it never cuts.
export type V3 = [number, number, number];

/** the world as the camera needs it: how far a point is from the nearest solid, whether a solid crosses the segment a → b
 *  (a sight line), and the ground's height */
export interface CamSpace {
  clear(p: V3): number;
  blocked(a: V3, b: V3): boolean;
  ground(x: number, z: number): number;
}

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
}

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
  pitches: [0.2, 0.42, 0.66],
  /** the fallback's tilts up over what the eye would stand in (rad, added to the pitch), and the steepest look down */
  rises: [0.12, 0.25, 0.4, 0.55, 0.7],
  /** the fallback's boom never shorter than this (m) */
  minPull: 4,
  maxPitch: 1.15,
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
  costs: { blocked: 1.2, blockedShare: 3, inside: 4, margin: 1.5, side: 0.4, pitch: 1.4, turn: 1.0, otherSide: 0.8 },
};

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
  /** what the last update framed, and what the choice saw (for the page's probes and the tests) */
  framed: V3[] = [];
  last = { clear: Infinity, blocked: 0, choices: 0 };

  /** start again from the next update (snapped there, as on a duel's first frame) */
  reset() { this.fresh = true; this.want = null; this.side = null; this.yawV = 0; }

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
    const P = DUEL_CAM, pts = this.pointsOf(I), pad = I.pad ?? 0;
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
    const score = (yaw: number, pitch: number, base: number, lens: number): number => {
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
        // the eye under the ground, or past the arena's room
        if (f.eye[1] < I.space.ground(f.eye[0], f.eye[2]) + 0.4) s += 3;
      }
      const out = Math.hypot(f.eye[0] - I.center[0], f.eye[2] - I.center[2]) - I.room;
      if (out > 0) s += Math.min(2, out * 0.5);
      // side on (with the turn toward behind seat 1) unless the pair is on top of each other; the lower view; the
      // lens unwidened; little turn from what it is heading for; the other side only for a real gain
      const ideal = base + P.behind * Math.sign(wrap(behind - base));
      s += Math.abs(wrap(yaw - ideal)) * K.side * sep;
      s += (pitch - P.pitches[0]) * K.pitch;
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
        for (const o of P.offsets) for (const sg of o ? [1, -1] : [1]) for (const pitch of P.pitches) for (const lens of P.lenses) {
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
      this.dist += (F.dist - this.dist) * (1 - Math.exp(-dt * (F.dist > this.dist ? 8 : 4)));
      this.fov += (F.fov - this.fov) * (1 - Math.exp(-dt * (F.fov > this.fov ? 8 : 1.2)));
    }
    // the fallback, for what the choice could not avoid (a turn under way past a column, the pair backed into the ruin):
    // first the eye rises over the pieces (the boom tilted up, eased up quickly and back down slowly), and only where
    // no tilt clears them does the boom come in along itself (in quickly, out slowly; at once where the eye would stand
    // inside the near fade's distance), the lens widening to hold the frame from there. The choice keeps this rare
    const sp = I.space, clearOk = (p: V3) => !sp || sp.clear(p) > I.near + 0.35;
    const eyeAt = (pitch: number, d: number): V3 => {
      const b = axes(this.yaw, pitch).back;
      return [this.look[0] + b[0] * d, this.look[1] + b[1] * d, this.look[2] + b[2] * d];
    };
    let riseWant = 0;
    if (sp && !clearOk(eyeAt(this.pitch, this.dist))) {
      riseWant = P.rises[P.rises.length - 1];
      for (const r of P.rises) if (clearOk(eyeAt(Math.min(P.maxPitch, this.pitch + r), this.dist))) { riseWant = r; break; }
    }
    const dr = riseWant - this.rise;
    this.rise = this.fresh ? riseWant : this.rise + Math.max(-0.5 * dt, Math.min(1.6 * dt, dr * (1 - Math.exp(-dt * (dr > 0 ? 8 : 1.5)))));
    const pitch = Math.min(P.maxPitch, this.pitch + this.rise);
    // the hard pass: whatever the ease left out, the boom (then the lens) takes in from where the look point is now
    const need = boomFor(pts, this.look, this.yaw, pitch, this.fov, I.aspect, hard);
    if (need > this.dist) this.dist = Math.min(need, maxD * 1.25);
    // (never in closer than P.minPull metres: an eye a metre from the dancers, its lens at the widest, is worse than a
    // stone dissolved by the near fade; where nothing down to there clears, the clearest of them)
    let pullWant = 1;
    if (sp && !clearOk(eyeAt(pitch, this.dist))) {
      const lo = Math.min(1, P.minPull / Math.max(1e-3, this.dist));
      let best = sp.clear(eyeAt(pitch, this.dist));
      for (let k = 0.95; k >= lo - 1e-6; k -= 0.05) {
        const c = sp.clear(eyeAt(pitch, this.dist * k));
        if (c > I.near + 0.35) { pullWant = k; break; }
        if (c > best + 0.1) { best = c; pullWant = k; }
      }
    }
    this.pull = this.fresh ? pullWant : this.pull + (pullWant - this.pull) * (1 - Math.exp(-dt * (pullWant < this.pull ? 14 : 1.5)));
    if (sp && pullWant < this.pull && sp.clear(eyeAt(pitch, this.dist * this.pull)) < I.near + 0.15) this.pull = pullWant;
    const D = this.dist * this.pull;
    let fov = this.fov;
    if (boomFor(pts, this.look, this.yaw, pitch, fov, I.aspect, hard) > D) {
      let lo = fov, hi = P.widest;
      for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (boomFor(pts, this.look, this.yaw, pitch, mid, I.aspect, hard) > D) lo = mid; else hi = mid; }
      fov = hi;
    }
    this.fresh = false;
    const eye = eyeAt(pitch, D);
    if (sp) {
      const g = sp.ground(eye[0], eye[2]);
      if (Number.isFinite(g) && eye[1] < g + 0.4) eye[1] = g + 0.4;
      this.last.clear = sp.clear(eye);
    }
    return { eye, look: [this.look[0], this.look[1], this.look[2]], fov, yaw: this.yaw, pitch, dist: D };
  }
}

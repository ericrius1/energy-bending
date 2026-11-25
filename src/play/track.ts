// The runner's track (src/play/runner.ts): one closed loop round a world, so the run never ends and never meets a wall.
// A loop is a middle and its radius at even angles round it (loops.ts: worked out offline per world, clear of the
// world's solids and mirrors), drawn smooth between them. Bodies on it are told apart by where along it they are (s,
// metres, unwrapped: it goes on growing lap after lap) and how far off its middle line (l, metres, + to the runner's
// right). Pure: no GPU, no DOM.
import { LOOPS } from './loops';

const TAU = Math.PI * 2;

export interface TrackFrame {
  /** the point on the middle line (x, z) */
  p: [number, number];
  /** along the track (unit, x z) */
  f: [number, number];
  /** to the runner's right (unit, x z) */
  r: [number, number];
  /** the facing along the track (world yaw: atan2(fx, fz)) */
  yaw: number;
}

/** samples round the loop for its table (a point every third of a degree) */
const M = 1080;

export class Track {
  /** the length of one lap (m) */
  readonly length: number;
  /** the mean radius (m) */
  readonly R: number;
  /** the dense loop, anticlockwise from +x: radius, and the length along it from +x */
  private readonly rr = new Float64Array(M + 1);
  private readonly cum = new Float64Array(M + 1);
  constructor(
    readonly cx: number,
    readonly cz: number,
    /** the radius at even angles round the middle, anticlockwise from +x (one number: a circle) */
    radii: readonly number[] | number,
    /** +1 runs anticlockwise seen from above (the angle rising), -1 clockwise */
    readonly dir: 1 | -1,
    /** how far either side of the middle line a body may run (m) */
    readonly half: number,
  ) {
    const rs = typeof radii === 'number' ? [radii] : radii, n = rs.length;
    // (periodic Catmull-Rom through the samples)
    for (let i = 0; i <= M; i++) {
      const u = (i / M) * n, k = Math.floor(u) % n, t = u - Math.floor(u);
      const p0 = rs[(k + n - 1) % n], p1 = rs[k], p2 = rs[(k + 1) % n], p3 = rs[(k + 2) % n];
      this.rr[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }
    let L = 0, sumR = 0;
    for (let i = 1; i <= M; i++) {
      const a0 = ((i - 1) / M) * TAU, a1 = (i / M) * TAU;
      L += Math.hypot(this.rr[i] * Math.cos(a1) - this.rr[i - 1] * Math.cos(a0), this.rr[i] * Math.sin(a1) - this.rr[i - 1] * Math.sin(a0));
      this.cum[i] = L;
      sumR += this.rr[i];
    }
    this.length = L;
    this.R = sumR / M;
  }

  /** the radius at an angle (anticlockwise from +x) */
  radiusAt(th: number) {
    let u = (((th % TAU) + TAU) % TAU / TAU) * M;
    const i = Math.min(M - 1, Math.floor(u)); u -= i;
    return this.rr[i] + (this.rr[i + 1] - this.rr[i]) * u;
  }
  /** the angle at a length along the loop from +x, anticlockwise */
  private angleOfArc(a: number) {
    a = ((a % this.length) + this.length) % this.length;
    let lo = 0, hi = M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= a) lo = mid; else hi = mid; }
    const u = (a - this.cum[lo]) / Math.max(1e-9, this.cum[lo + 1] - this.cum[lo]);
    return ((lo + u) / M) * TAU;
  }
  /** the length along the loop from +x, anticlockwise, at an angle */
  private arcOfAngle(th: number) {
    let u = (((th % TAU) + TAU) % TAU / TAU) * M;
    const i = Math.min(M - 1, Math.floor(u)); u -= i;
    return this.cum[i] + (this.cum[i + 1] - this.cum[i]) * u;
  }
  /** the frame at an angle */
  private frameAt(th: number, out?: TrackFrame): TrackFrame {
    const r = this.radiusAt(th), e = 2e-3, dr = (this.radiusAt(th + e) - this.radiusAt(th - e)) / (2 * e);
    const c = Math.cos(th), s = Math.sin(th);
    // (dP/dθ, anticlockwise; then the way of travel)
    let tx = dr * c - r * s, tz = dr * s + r * c;
    const tl = Math.hypot(tx, tz) || 1;
    tx = (tx / tl) * this.dir; tz = (tz / tl) * this.dir;
    const o = out ?? { p: [0, 0], f: [0, 0], r: [0, 0], yaw: 0 };
    o.p[0] = this.cx + c * r; o.p[1] = this.cz + s * r;
    o.f[0] = tx; o.f[1] = tz;
    // (the right of a facing (fx, fz) is (fz, -fx), as the character's aim basis has it)
    o.r[0] = tz; o.r[1] = -tx;
    o.yaw = Math.atan2(tx, tz);
    return o;
  }
  /** the frame at s along the track */
  frame(s: number, out?: TrackFrame): TrackFrame {
    return this.frameAt(this.angleOfArc(this.dir > 0 ? s : -s), out);
  }
  /** the point s along, l to the right */
  point(s: number, l = 0): [number, number] {
    const F = this.frame(s);
    return [F.p[0] + F.r[0] * l, F.p[1] + F.r[1] * l];
  }
  /** where a point is: s along (unwrapped to the lap nearest `near`), l to the right */
  project(x: number, z: number, near = 0): { s: number; l: number } {
    const th = Math.atan2(z - this.cz, x - this.cx), F = this.frameAt(th);
    let s = this.arcOfAngle(th) * this.dir;
    s += Math.round((near - s) / this.length) * this.length;
    return { s, l: (x - F.p[0]) * F.r[0] + (z - F.p[1]) * F.r[1] };
  }
  /** the frame at a point anywhere (the one through its own angle), and its l */
  at(x: number, z: number, out?: TrackFrame): TrackFrame & { l: number } {
    const th = Math.atan2(z - this.cz, x - this.cx);
    const F = this.frameAt(th, out) as TrackFrame & { l: number };
    F.l = (x - F.p[0]) * F.r[0] + (z - F.p[1]) * F.r[1];
    return F;
  }
}

/** the loop for a world, if it has room for one (loops.ts) */
export function trackFor(world: string, half = 1.8, dir: 1 | -1 = 1): Track | null {
  const L = LOOPS[world];
  return L ? new Track(L.c[0], L.c[1], L.r, dir, half) : null;
}

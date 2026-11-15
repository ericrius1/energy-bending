// A crossing through a mirror, as one move (phase 6, report 20-crossing; report 19's issues 3, 4 and 5). Pure: plain
// numbers in, plain numbers out, so it runs in Node (test/crossing.test.ts) and on the room server, which will judge the
// crossing online (p6-online: `crossedDisc` is the judgement, `Voyage` the pair's wish, `CrossEvent` what it sends).
//
// Three parts:
//   - the voyage: now and then, mid-flow, the pair sets out for a mirror together (a virtual player's wish, seeded, so a
//     set plays the same every time): the brains dance toward it and the lead flings or swings its partner through,
//     the pair going on together. After any crossing a grace: no new voyage for a while, and the pair dance on away
//     from the disc they came out of rather than straight back through it;
//   - the approach: which disc the pair is heading for and how soon, for the camera to swing in behind them before
//     they reach it (`approachOf`);
//   - the way through (`ThroughCam`): from the frame the pair is through, the camera's eye is taken round onto the
//     disc's axis behind them (if it stood beside the disc), through the disc on their line, and on round onto the
//     duel camera's own view of them in the new world, one smooth curve, never stopping inside the far mirror's ring.
export type V3 = [number, number, number];

/** a mirror (or any gate) as the crossing needs it: its middle, its face (unit, horizontal for a mirror), its right and
 *  up in the disc, its radius, and the world it opens on */
export interface Disc { id: string; at: V3; n: V3; right: V3; up: V3; r: number; to?: string }

/** what a crossing is, for the rules and the network: the seat that crossed, the mirror, the world it led to, whether
 *  it went in at the front, whether the pair meant it (a voyage), and when (duel ms) */
export interface CrossEvent { k: 'cross'; seat: number; gate: string; to: string; front: boolean; meant: boolean; t: number }

export const CROSS = {
  /** no voyage in a set's first seconds, nor its last (the finale is the set's world's) (s) */
  quietStart: 12, quietEnd: 12,
  /** after a crossing: no new voyage for this long (s), and the pair keep away from the disc they came out of for
   *  `settle` s (the brains' goals at least `settleDist` m in front of it) */
  grace: 18, settle: 3.5, settleDist: 3.2,
  /** a voyage's chance a second while the pair is in flow (the shared energy at least `flow`), and its longest (s) */
  rate: 1 / 22, flow: 0.3, longest: 11,
  /** a voyage is set for a mirror within this far of the pair (m) */
  reach: 13,
  /** each seat crosses back no sooner than this after its crossing (s): free, held */
  holdBack: [1.1, 1.6] as const,
};

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const smoother = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * k * (k * (k * 6 - 15) + 10); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: ArrayLike<number>, b: ArrayLike<number>, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** the disc the segment a → b passes through (its plane crossed inside its radius), and where: the room server's
 *  judgement of a crossing (the page's is Portals.crossed, the same test) */
export function crossedDisc(a: ArrayLike<number>, b: ArrayLike<number>, discs: readonly Disc[]): { disc: Disc; front: boolean } | null {
  for (const d of discs) {
    const sa = dot([a[0] - d.at[0], a[1] - d.at[1], a[2] - d.at[2]], d.n), sb = dot([b[0] - d.at[0], b[1] - d.at[1], b[2] - d.at[2]], d.n);
    if ((sa > 0) === (sb > 0) || sa === sb) continue;
    const k = sa / (sa - sb), p: V3 = [a[0] + (b[0] - a[0]) * k - d.at[0], a[1] + (b[1] - a[1]) * k - d.at[1], a[2] + (b[2] - a[2]) * k - d.at[2]];
    if (Math.hypot(dot(p, d.right), dot(p, d.up)) <= d.r) return { disc: d, front: sa > 0 };
  }
  return null;
}

// ---------------------------------------------------------------- the voyage
/** a tiny seeded generator (mulberry32), so a set's voyages are the same each time it is played */
function rng(seed: number) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface VoyageInput {
  /** seconds of play in this set, and how many it has left */
  playT: number; left: number;
  /** the set is in play (not its count-in, finale or banner) */
  play: boolean;
  /** the shared energy (0 … 1), and whether the pair is joined now */
  energy: number; joined: boolean;
  /** the pair's middle (world) */
  mid: V3;
  /** the mirrors of the world the pair is in */
  discs: readonly Disc[];
}

/** where the pair is going: the mirror, since when (s of play) and until */
export interface VoyagePlan { disc: Disc; since: number; until: number }

/** the pair's wish to go through a mirror together, mid-flow, now and then; and the grace after any crossing */
export class Voyage {
  plan: VoyagePlan | null = null;
  /** the disc the pair came out of, until when (s of play): the brains keep away from it */
  cameOut: { disc: Disc; until: number } | null = null;
  /** no new voyage before this (s of play) */
  private calm = 0;
  private next: () => number;
  /** voyages set, and those that ended in a crossing */
  readonly counts = { set: 0, made: 0, lapsed: 0 };
  constructor(seed = 1) { this.next = rng(seed * 977 + 13); }

  /** each frame: a voyage begins (mid-flow, a mirror near), lapses (too long, the set ending), or stands */
  step(dt: number, I: VoyageInput) {
    if (this.cameOut && I.playT > this.cameOut.until) this.cameOut = null;
    if (this.plan) {
      const P = this.plan;
      if (!I.play || I.playT > P.until || I.left < CROSS.quietEnd * 0.5 || !I.discs.some((d) => d.id === P.disc.id)) { this.plan = null; this.counts.lapsed++; this.calm = I.playT + 6; }
      return this.plan;
    }
    if (!I.play || I.playT < Math.max(CROSS.quietStart, this.calm) || I.left < CROSS.quietEnd || !I.discs.length) return null;
    if (I.energy < CROSS.flow && !I.joined) return null;
    if (this.next() >= CROSS.rate * dt) return null;
    // the nearest mirror the pair can see from where they are (in front of it, within reach)
    let best: Disc | null = null, bd = CROSS.reach;
    for (const d of I.discs) {
      const rel: V3 = [I.mid[0] - d.at[0], 0, I.mid[2] - d.at[2]], dist = Math.hypot(rel[0], rel[2]);
      if (dist < bd && dot(rel, d.n) > 0.5) { bd = dist; best = d; }
    }
    if (!best) return null;
    this.plan = { disc: best, since: I.playT, until: I.playT + CROSS.longest };
    this.counts.set++;
    return this.plan;
  }

  /** the pair went through `out` (in the new world: the disc they came out of) at `playT`: whether they meant it, and
   *  the grace begins */
  crossed(playT: number, through: string, out: Disc | null) {
    const meant = !!this.plan && this.plan.disc.id === through;
    if (meant) this.counts.made++;
    this.plan = null;
    this.calm = playT + CROSS.grace;
    this.cameOut = out ? { disc: out, until: playT + CROSS.settle } : null;
    return meant;
  }

  /** a new set (the count-in): nothing planned */
  reset() { this.plan = null; this.cameOut = null; this.calm = 0; }
}

/** a goal (x, z) kept at least `CROSS.settleDist` in front of the disc the pair came out of, pushed out along its face */
export function awayFrom(d: Disc, x: number, z: number): [number, number] {
  const rx = x - d.at[0], rz = z - d.at[2], s = rx * d.n[0] + rz * d.n[2], across = rx * d.right[0] + rz * d.right[2];
  if (s >= CROSS.settleDist || Math.abs(across) > d.r + 2) return [x, z];
  const k = CROSS.settleDist - s;
  return [x + d.n[0] * k, z + d.n[2] * k];
}

// ---------------------------------------------------------------- the approach
export interface Approach { disc: Disc; /** which side the pair is on (1: its face) */ side: number; /** s to the plane */ eta: number; /** 0 … 1 how sure */ w: number }

/** the disc the pair is heading for: within `ahead` s of its plane at the speed they go, passing inside its radius
 *  (and a margin); or, on a voyage, the voyage's disc once they are within 7 m of it */
export function approachOf(mid: ArrayLike<number>, vel: ArrayLike<number>, discs: readonly Disc[], voyage: Disc | null, ahead = 1.4): Approach | null {
  let best: Approach | null = null;
  for (const d of discs) {
    const rel: V3 = [mid[0] - d.at[0], mid[1] - d.at[1], mid[2] - d.at[2]], s = dot(rel, d.n), side = s >= 0 ? 1 : -1;
    const toward = -dot(vel, d.n) * side, across = Math.abs(dot(rel, d.right));
    let w = 0, eta = Infinity;
    if (toward > 0.6) {
      eta = Math.abs(s) / toward;
      const at = across + dot(vel, d.right) * eta * Math.sign(dot(rel, d.right) || 1);
      if (eta < ahead && Math.abs(at) < d.r + 1.2) w = smooth((ahead - eta) / (ahead * 0.6)) * (Math.abs(at) < d.r + 0.3 ? 1 : 1 - (Math.abs(at) - d.r - 0.3) / 0.9);
    }
    if (voyage && voyage.id === d.id && side > 0) {
      const dist = Math.hypot(rel[0], rel[2]);
      w = Math.max(w, smooth((7 - dist) / 3.5) * (across < d.r + 2.5 ? 1 : 0.4));
      if (!Number.isFinite(eta)) eta = dist / 2.5;
    }
    if (w > 0.02 && (!best || w > best.w)) best = { disc: d, side, eta, w };
  }
  return best;
}

/** the camera behind the pair on the disc's axis: the eye on the line from the disc's middle through the pair, `dist`
 *  m behind them and a little over, looking at the pair with the mirror beyond */
export function behindPose(d: Disc, side: number, look: V3, dist: number): { eye: V3; look: V3 } {
  let ux = look[0] - d.at[0], uz = look[2] - d.at[2];
  const l = Math.hypot(ux, uz);
  // (right at the disc: straight out of its face)
  if (l < 0.6) { ux = d.n[0] * side; uz = d.n[2] * side; } else { ux /= l; uz /= l; }
  const eye: V3 = [look[0] + ux * dist, look[1] + 0.25 + dist * 0.16, look[2] + uz * dist];
  return { eye, look: lerp3(look, d.at, 0.2) };
}

/** a pose blended toward another about its look point: yaw by the shorter way, pitch and the boom's length eased (no
 *  cut through the middle) */
export function blendPose(a: { eye: V3; look: V3 }, b: { eye: V3; look: V3 }, k: number): { eye: V3; look: V3 } {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const L = lerp3(a.look, b.look, k);
  const sph = (p: { eye: V3; look: V3 }) => { const dx = p.eye[0] - p.look[0], dy = p.eye[1] - p.look[1], dz = p.eye[2] - p.look[2], r = Math.max(1e-3, Math.hypot(dx, dy, dz)); return { yaw: Math.atan2(dx, dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / r))), r }; };
  const A = sph(a), B = sph(b);
  let dy = B.yaw - A.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const yaw = A.yaw + dy * k, pitch = lerp(A.pitch, B.pitch, k), r = lerp(A.r, B.r, k);
  return { eye: [L[0] + Math.sin(yaw) * Math.cos(pitch) * r, L[1] + Math.sin(pitch) * r, L[2] + Math.cos(yaw) * Math.cos(pitch) * r], look: L };
}

// ---------------------------------------------------------------- the way through
/** the camera's way through the disc after the pair (in the new world's coordinates: the rig was carried with them, and
 *  the view is drawn from the old world until the eye comes through the far disc). Two moves, each eased with no step
 *  in speed:
 *    1. round: an eye beside the disc (it stood past the old mirror's plane, beside it) swings round the disc's rim,
 *       outside its frame, onto its axis behind it, looking at the disc (the pair seen through it); an eye already
 *       behind the disc and near its axis only settles onto it;
 *    2. through: from there one curve (a quadratic Bézier) through the disc near its middle and on round onto the
 *       duel camera's own pose of the pair, the look point eased from the disc to the duel camera's. The duel camera
 *       keeps framing the pair the whole time, so the curve ends exactly where it is (no `from`, no snap).
 *  `update` returns the pose, and `done` once the eye is the duel camera's again */
export class ThroughCam {
  t = 0;
  done = false;
  /** the eye crossed the disc's plane inside it (the main view went over) */
  through = false;
  private T1: number;
  private T2 = -1;
  private phi0: number; private phi1: number; private rho0: number; private y0: number;
  private S: V3 = [0, 0, 0];
  /** where the eye looked as the way began (the look eases from it over the first 0.4 s: no snap of the view) */
  private look0: V3;
  /** the disc's own frame: x right, y up, z out of its face on the pair's side */
  private X: V3; private Y: V3; private Z: V3;
  /** how the swing round went: 'aligned' (the eye was behind the disc already), or round by `turn` rad */
  readonly how: { aligned: boolean; turn: number };

  constructor(readonly disc: Disc, side: number, eye0: ArrayLike<number>, look0: ArrayLike<number>) {
    const d = disc;
    this.X = [d.right[0] * side, d.right[1] * side, d.right[2] * side];
    this.Y = [...d.up] as V3;
    this.Z = [d.n[0] * side, d.n[1] * side, d.n[2] * side];
    const e = this.local(eye0), lk = this.local(look0);
    this.look0 = [look0[0], look0[1], look0[2]];
    this.rho0 = Math.hypot(e[0], e[2]);
    this.phi0 = Math.atan2(e[0], e[2]);
    // behind the disc (its far side from the pair: z < 0) on its axis: |φ| = π; round by the nearer way
    this.phi1 = this.phi0 >= 0 ? Math.PI : -Math.PI;
    const turn = Math.abs(this.phi1 - this.phi0);
    // (behind it already, and the line to the pair passes well inside the disc: just settle)
    const z0 = e[2], k = z0 < -0.2 && lk[2] > 0 ? -z0 / (lk[2] - z0) : 1, hx = e[0] + (lk[0] - e[0]) * k, hy = e[1] + (lk[1] - e[1]) * k;
    const aligned = z0 < -0.2 && Math.hypot(hx, hy) < d.r * 0.6;
    this.how = { aligned, turn };
    this.y0 = e[1];
    // the staging point: on the axis behind the disc, 1.5 … 2.6 m back (an eye already behind it keeps its distance, to
    // 3.2 m), at the disc's middle or a little over
    this.S = [0, Math.max(-0.35, Math.min(0.45, lk[1] * 0.5 + 0.15)), -Math.max(1.5, Math.min(aligned ? 3.2 : 2.6, aligned ? -z0 : this.rho0 * 0.6))];
    // (the swing's length by how far round it goes and how far in: about 8 m/s at the fastest)
    const arc = Math.hypot(((this.rho0 - this.S[2]) / 2) * (aligned ? 0 : turn), this.rho0 + this.S[2], this.y0 - this.S[1]);
    this.T1 = Math.max(aligned ? 0.25 : 0.5 + 0.5 * Math.min(1, turn / Math.PI), arc / 5.5);
  }

  private local(p: ArrayLike<number>): V3 { const r: V3 = [p[0] - this.disc.at[0], p[1] - this.disc.at[1], p[2] - this.disc.at[2]]; return [dot(r, this.X), dot(r, this.Y), dot(r, this.Z)]; }
  private world(l: ArrayLike<number>): V3 { const a = this.disc.at, X = this.X, Y = this.Y, Z = this.Z; return [a[0] + X[0] * l[0] + Y[0] * l[1] + Z[0] * l[2], a[1] + X[1] * l[0] + Y[1] * l[1] + Z[1] * l[2], a[2] + X[2] * l[0] + Y[2] * l[1] + Z[2] * l[2]]; }

  /** the pose this frame, given the duel camera's own pose of the pair now (`cam`) and the pair's middle */
  update(dt: number, cam: { eye: V3; look: V3 }, pair: V3): { eye: V3; look: V3 } {
    this.t += dt;
    const S = this.S, R = this.disc.r;
    const discLook = this.world([0, S[1] * 0.4, 0.8]);
    // 1. round onto the axis behind the disc (or settle there)
    if (this.t < this.T1) {
      const u = smoother(this.t / this.T1);
      const phi = lerp(this.phi0, this.phi1, u);
      let rho = lerp(this.rho0, -S[2], u);
      // (outside the frame while beside the plane: the rim and its brass, with a margin)
      const beside = 1 - smooth((Math.abs(Math.cos(phi)) - 0.25) / 0.45);
      rho = Math.max(rho, (R + 0.9) * beside);
      const l: V3 = [Math.sin(phi) * rho, lerp(this.y0, S[1], u), Math.cos(phi) * rho];
      // (looking at the disc: the pair is seen through it, live)
      return { eye: this.world(l), look: this.eased(lerp3(discLook, pair, 0.35 * u)) };
    }
    // 2. through the disc and round onto the duel camera's pose (its length set once, by how far there is to go: about
    // 8 m/s at the fastest). A cubic Bézier whose two inner points lie on the disc's axis, one in its plane: the curve
    // crosses the plane within a few centimetres of the middle wherever it ends. Its end is the duel camera's eye, kept
    // out in front of the disc (`clamped`: a pose the duel camera chose behind the disc or beside its back would take
    // the curve back across the plane outside the disc; the camera then goes on from where the way ends, `from`)
    const Er = this.local(cam.eye), E: V3 = [Er[0], Er[1], Math.max(1.6, Er[2])];
    this.clamped = Er[2] < 1.6 - 1e-6;
    if (this.T2 < 0) this.T2 = Math.max(1.3, Math.min(2.6, 0.5 + (Math.hypot(E[0] - S[0], E[1] - S[1], E[2] - S[2]) + 1.2) / 5));
    const u = smoother((this.t - this.T1) / this.T2);
    const P1: V3 = [0, S[1], 0], P2: V3 = [0, S[1], Math.max(1.4, -0.8 * S[2])];
    const a = (1 - u) ** 3, b = 3 * u * (1 - u) ** 2, c = 3 * u * u * (1 - u), d = u ** 3;
    const l: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) l[i] = a * S[i] + b * P1[i] + c * P2[i] + d * E[i];
    if (!this.through && l[2] > 0) this.through = true;
    // (the look point runs on ahead of the eye along the axis, never behind it: an eye past a fixed point in front of the
    // disc turned round and looked back at the disc it had just come through)
    const ahead = this.world([0, S[1] * 0.4, Math.max(0.8, l[2] + 2.5)]);
    const look = lerp3(lerp3(ahead, pair, 0.35), cam.look, smooth(u * 1.4));
    if (u >= 1) this.done = true;
    return { eye: this.world(l), look: this.eased(look) };
  }

  /** the way's end was held out in front of the disc (the duel camera goes on from the way's last pose, not its own) */
  clamped = false;

  /** the look point eased from where the eye looked as the way began */
  private eased(p: V3): V3 { return lerp3(this.look0, p, smooth(this.t / 0.4)); }
}

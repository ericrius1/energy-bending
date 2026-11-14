// The set's finale as the two bodies doing one thing on the music's last bar (docs/design/duel.md, phase 2's fix 4),
// in place of five seconds of the pair drifting in steam. For its length the two seats' brains and devices are held
// (index.ts's seat gate asks `holds`) and the bodies are moved and posed here:
//   fused    a lift into one body: the flyer (the one further from the ground, else the set's loser) is drawn through
//            the air to the base, taken at the waist and raised overhead, turns there with its arms open while the
//            field's fusion winds the two matters into one column round them (fx.ts reads `look()`), and floats down
//            to stand beside the base. One bar of the music (4 beats, 1.6 to 2.6 s), then the banner
//   not      a bow: the two turn to each other and bow (the move library's `bow`), and stand
// The bodies stay held through the banner (they stand together) and are let go when the next set counts in.
// How: a pose pass wrapped round each Character's update (as the contact's, match.ts): after the body stepped and posed
// itself, the flyer's root is put on its scripted path (its landmarks carried with it, so the frame's pose is where
// the body is, no frame late) and its velocity set to the path's; the base's wrists reach for the flyer's hips and the
// flyer's arms open. Pure (no DOM, no GPU).
import type { Character } from '../dancer/character';
import { J } from '../dancer/moves';

type V3 = [number, number, number];

export const FINALE = {
  /** the duet's length: this many beats, within these seconds */
  BEATS: 4,
  MIN_S: 1.6,
  MAX_S: 2.6,
  /** the flyer's feet over the base's at the top of the lift (m), and how far in front of the base it is taken (m) */
  TOP: 1.2,
  TAKE: 0.55,
  /** where it lands, in front of the base (m) */
  LAND: 0.85,
  /** the base's reach from the shoulder (m) */
  REACH: 0.62,
};

/** what the effects read each frame of a finale (fx.ts) */
export interface FinaleLook {
  fused: boolean;
  /** 0 … 1 through the duet (1 after it, while the bodies stand) */
  u: number;
  /** seconds since it began, and the duet's length */
  t: number;
  len: number;
  base: number;
  flyer: number;
  /** the fusion's amount now (0 … 1) */
  fuse: number;
  /** the bloom at the top of the lift (0 … 1, a swell and a fade) */
  bloom: number;
}

const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const seg = (u: number, a: number, b: number) => Math.max(0, Math.min(1, (u - a) / (b - a)));
const lerp = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

export class Finale {
  active = false;
  fused = false;
  /** seconds since it began, and the duet's length */
  t = 0;
  len = 2.2;
  base = 0;
  flyer = 1;
  private from: V3 = [0, 0, 0];
  private dir: [number, number] = [0, 1];
  private bowed = [false, false];
  /** the flyer's root last frame (its velocity) */
  private last: V3 | null = null;

  constructor(readonly chars: readonly [Character, Character]) {
    chars.forEach((c, k) => {
      const up = c.update.bind(c);
      c.update = (...a: Parameters<Character['update']>) => { up(...a); this.pose(k, a[0]); };
    });
  }

  /** whether seat k's own input is held (the finale moves it) */
  holds(_k: number) { return this.active; }

  /** the finale begins (the rules' 'finale' event): fused or not, at this tempo; `style` decides the base on a tie */
  start(fused: boolean, bpm: number, style: readonly [number, number] = [0, 0]) {
    const C = this.chars;
    this.active = true; this.fused = fused; this.t = 0; this.last = null; this.bowed = [false, false];
    this.len = Math.max(FINALE.MIN_S, Math.min(FINALE.MAX_S, (FINALE.BEATS * 60) / Math.max(40, bpm || 112)));
    // the base: the one on the ground (lower), else the set's winner so far
    const g0 = C[0].grounded ? 0 : 1, g1 = C[1].grounded ? 0 : 1;
    if (g0 !== g1) this.base = g0 < g1 ? 0 : 1;
    else if (Math.abs(C[0].root[1] - C[1].root[1]) > 0.4) this.base = C[0].root[1] < C[1].root[1] ? 0 : 1;
    else this.base = style[0] >= style[1] ? 0 : 1;
    this.flyer = 1 - this.base;
    // (whatever either was doing stops: a kick or a dash in flight would play on under the lift)
    for (const c of C) { c.move = null; c.dashT = 0; }
    const B = C[this.base].root, F = C[this.flyer].root;
    this.from = [F[0], F[1], F[2]];
    let dx = F[0] - B[0], dz = F[2] - B[2];
    const l = Math.hypot(dx, dz);
    if (l < 0.2) { const y = C[this.base].yaw; dx = Math.sin(y); dz = Math.cos(y); } else { dx /= l; dz /= l; }
    // (locked: the flyer stays in the stage's plane, the base's other side along it)
    const P = C[this.base].plane;
    if (P) { const s = dx * P.right[0] + dz * P.right[2] >= 0 ? 1 : -1; dx = P.right[0] * s; dz = P.right[2] * s; }
    this.dir = [dx, dz];
  }
  /** the next set counts in: the bodies are let go */
  stop() { this.active = false; }

  /** each frame (the duel's clock) */
  update(dt: number) { if (this.active) this.t += dt; }

  /** what fx.ts draws from */
  look(): FinaleLook | null {
    if (!this.active) return null;
    const u = Math.min(1, this.t / this.len);
    // (in, full through the lift, settling as the flyer comes down, then fading out under the banner)
    const after = Math.max(0, this.t - this.len);
    const fuse = this.fused ? smooth(u / 0.45) * (1 - 0.45 * smooth(seg(u, 0.85, 1))) * Math.max(0, 1 - after / 3) : 0;
    const b = seg(u, 0.5, 0.95), bloom = this.fused ? Math.sin(Math.PI * b) * (b > 0 ? 1 : 0) : 0;
    return { fused: this.fused, u, t: this.t, len: this.len, base: this.base, flyer: this.flyer, fuse, bloom };
  }

  /** where the flyer's root is at u (0 … 1 of the duet) */
  private path(u: number): V3 {
    const B = this.chars[this.base].root, [dx, dz] = this.dir;
    const take: V3 = [B[0] + dx * FINALE.TAKE, B[1] + 0.45, B[2] + dz * FINALE.TAKE];
    const top: V3 = [B[0] + dx * 0.06, B[1] + FINALE.TOP, B[2] + dz * 0.06];
    const land: V3 = [B[0] + dx * FINALE.LAND, B[1], B[2] + dz * FINALE.LAND];
    if (u < 0.3) {
      // drawn through the air to the base: an arc over whatever lies between
      const q = smooth(u / 0.3), A = this.from;
      const d = Math.hypot(take[0] - A[0], take[2] - A[2]);
      const mid: V3 = [(A[0] + take[0]) / 2, Math.max(A[1], take[1]) + 0.4 + d * 0.22, (A[2] + take[2]) / 2];
      const a = lerp(A, mid, q), b = lerp(mid, take, q);
      return lerp(a, b, q);
    }
    if (u < 0.55) return lerp(take, top, smooth(seg(u, 0.3, 0.55)));
    if (u < 0.8) { const f = smooth(seg(u, 0.55, 0.8)); return [top[0], top[1] + 0.15 * Math.sin(Math.PI * f), top[2]]; }
    return lerp(top, land, smooth(seg(u, 0.8, 1)));
  }

  /** the pass after body k stepped and posed itself */
  private pose(k: number, dt: number) {
    if (!this.active) return;
    const c = this.chars[k], P = c.pose;
    if (!this.fused) {
      // a bow, turned to the other (once each, as soon as it stands)
      if (!this.bowed[k] && c.grounded && this.t < this.len * 0.6) {
        const o = this.chars[1 - k].root, dx = o[0] - c.root[0], dz = o[2] - c.root[2];
        this.bowed[k] = c.startMove('bow', c.plane ? { dir: Math.sign(dx * c.plane.right[0] + dz * c.plane.right[2]) || 1 } : { yaw: Math.atan2(dx, dz) });
      }
      return;
    }
    const u = Math.min(1, this.t / this.len);
    if (k === this.flyer) {
      if (u >= 1) { this.last = null; return; }
      // on its path: the root moved there, the landmarks with it
      const q = this.path(u), d: V3 = [q[0] - c.root[0], q[1] - c.root[1], q[2] - c.root[2]];
      for (let i = 0; i < P.length; i += 3) { P[i] += d[0]; P[i + 1] += d[1]; P[i + 2] += d[2]; }
      c.root[0] = q[0]; c.root[1] = q[1]; c.root[2] = q[2];
      const L = this.last, s = dt > 1e-4 && L ? 1 / dt : 0;
      c.v = L ? [(q[0] - L[0]) * s, (q[1] - L[1]) * s, (q[2] - L[2]) * s] : [0, 0, 0];
      this.last = q;
      if (u < 0.92) { c.grounded = false; c.support = null; }
      // at the top: a slow half turn round its own axis, the arms opening up and out
      const open = smooth(seg(u, 0.35, 0.55)) * (1 - smooth(seg(u, 0.82, 0.97)));
      const turn = Math.PI * smooth(seg(u, 0.5, 0.85));
      if (turn > 1e-3) {
        const cs = Math.cos(turn), sn = Math.sin(turn), x0 = c.root[0], z0 = c.root[2];
        for (let i = 0; i < P.length; i += 3) {
          const x = P[i] - x0, z = P[i + 2] - z0;
          P[i] = x0 + x * cs + z * sn; P[i + 2] = z0 - x * sn + z * cs;
        }
      }
      if (open > 0.01) {
        const sx = P[3 * J.RS] - P[3 * J.LS], sz = P[3 * J.RS + 2] - P[3 * J.LS + 2], sl = Math.hypot(sx, sz) || 1;
        for (const [w, e, s, side] of [[J.LW, J.LE, J.LS, -1], [J.RW, J.RE, J.RS, 1]] as const) {
          const S: V3 = [P[3 * s], P[3 * s + 1], P[3 * s + 2]];
          const W: V3 = [S[0] + (sx / sl) * side * 0.42, S[1] + 0.42, S[2] + (sz / sl) * side * 0.42];
          for (let a = 0; a < 3; a++) {
            P[3 * w + a] += (W[a] - P[3 * w + a]) * open;
            P[3 * e + a] += ((S[a] + W[a]) / 2 + (a === 1 ? 0.03 : 0) - P[3 * e + a]) * open;
          }
        }
      }
    } else if (u > 0.25 && u < 0.92) {
      // the base: both hands up to the flyer's hips, as far as its arms reach
      const F = this.chars[this.flyer].pose, w = smooth(seg(u, 0.25, 0.4)) * (1 - smooth(seg(u, 0.8, 0.92)));
      const hip: V3 = [(F[3 * J.LH] + F[3 * J.RH]) / 2, (F[3 * J.LH + 1] + F[3 * J.RH + 1]) / 2, (F[3 * J.LH + 2] + F[3 * J.RH + 2]) / 2];
      for (const [wj, ej, sj, side] of [[J.LW, J.LE, J.LS, -1], [J.RW, J.RE, J.RS, 1]] as const) {
        const S: V3 = [P[3 * sj], P[3 * sj + 1], P[3 * sj + 2]];
        const sx = P[3 * J.RS] - P[3 * J.LS], sz = P[3 * J.RS + 2] - P[3 * J.LS + 2], sl = Math.hypot(sx, sz) || 1;
        const T: V3 = [hip[0] + (sx / sl) * side * 0.12, hip[1] - 0.05, hip[2] + (sz / sl) * side * 0.12];
        let tx = T[0] - S[0], ty = T[1] - S[1], tz = T[2] - S[2];
        const tl = Math.hypot(tx, ty, tz) || 1, r = Math.min(tl, FINALE.REACH) / tl;
        tx *= r; ty *= r; tz *= r;
        const W: V3 = [S[0] + tx, S[1] + ty, S[2] + tz];
        for (let a = 0; a < 3; a++) {
          P[3 * wj + a] += (W[a] - P[3 * wj + a]) * w;
          P[3 * ej + a] += ((S[a] + W[a]) / 2 + (a === 1 ? 0 : 0) - P[3 * ej + a]) * w;
        }
        // (the elbow out a little, an arm, not a stick)
        P[3 * ej] += (sx / sl) * side * 0.06 * w; P[3 * ej + 2] += (sz / sl) * side * 0.06 * w;
      }
    }
  }
}

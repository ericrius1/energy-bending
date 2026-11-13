// Rigid moves: a rotation and a translation, in doubles. A gate is one of these (from its own world into its
// partner's), a dancer that has travelled carries the product of the gates it passed, and every helper the game uses
// to see or move something through a gate (`pt`, `dir`, `quat`) is one of the three applications below. Pure numbers:
// no GPU, no weft, so the gate's algebra can be checked in Node (scripts/check-portals.mjs).

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

/** p ↦ R p + t, with R row-major */
export class Rigid {
  readonly r = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  readonly t = new Float64Array(3);

  static identity() { return new Rigid(); }

  /** the frame whose axes (columns) are x, y, z, at `o`: local ↦ world */
  static frame(x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>, o: ArrayLike<number>) {
    const m = new Rigid(), r = m.r;
    r[0] = x[0]; r[1] = y[0]; r[2] = z[0];
    r[3] = x[1]; r[4] = y[1]; r[5] = z[1];
    r[6] = x[2]; r[7] = y[2]; r[8] = z[2];
    m.t[0] = o[0]; m.t[1] = o[1]; m.t[2] = o[2];
    return m;
  }

  copy(o: Rigid) { this.r.set(o.r); this.t.set(o.t); return this; }
  clone() { return new Rigid().copy(this); }
  isIdentity(eps = 1e-9) {
    const r = this.r;
    return Math.abs(r[0] - 1) < eps && Math.abs(r[4] - 1) < eps && Math.abs(r[8] - 1) < eps && Math.abs(r[1]) < eps && Math.abs(r[2]) < eps &&
      Math.abs(r[3]) < eps && Math.abs(r[5]) < eps && Math.abs(r[6]) < eps && Math.abs(r[7]) < eps && Math.hypot(this.t[0], this.t[1], this.t[2]) < eps;
  }

  /** a point through the move */
  pt(p: ArrayLike<number>, out: V3 = [0, 0, 0]): V3 {
    const r = this.r, x = p[0], y = p[1], z = p[2];
    out[0] = r[0] * x + r[1] * y + r[2] * z + this.t[0];
    out[1] = r[3] * x + r[4] * y + r[5] * z + this.t[1];
    out[2] = r[6] * x + r[7] * y + r[8] * z + this.t[2];
    return out;
  }
  /** a direction (or a velocity) through the move */
  dir(v: ArrayLike<number>, out: V3 = [0, 0, 0]): V3 {
    const r = this.r, x = v[0], y = v[1], z = v[2];
    out[0] = r[0] * x + r[1] * y + r[2] * z;
    out[1] = r[3] * x + r[4] * y + r[5] * z;
    out[2] = r[6] * x + r[7] * y + r[8] * z;
    return out;
  }
  /** an orientation through the move: the move's rotation times q (x, y, z, w) */
  quat(q: ArrayLike<number>, out: Q4 = [0, 0, 0, 1]): Q4 { return qmul(this.rotation(), q, out); }

  /** the rotation as a quaternion (x, y, z, w) */
  rotation(out: Q4 = [0, 0, 0, 1]): Q4 {
    const m = this.r, tr = m[0] + m[4] + m[8];
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      out[3] = 0.25 * s; out[0] = (m[7] - m[5]) / s; out[1] = (m[2] - m[6]) / s; out[2] = (m[3] - m[1]) / s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
      out[3] = (m[7] - m[5]) / s; out[0] = 0.25 * s; out[1] = (m[1] + m[3]) / s; out[2] = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
      const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
      out[3] = (m[2] - m[6]) / s; out[0] = (m[1] + m[3]) / s; out[1] = 0.25 * s; out[2] = (m[5] + m[7]) / s;
    } else {
      const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
      out[3] = (m[3] - m[1]) / s; out[0] = (m[2] + m[6]) / s; out[1] = (m[5] + m[7]) / s; out[2] = 0.25 * s;
    }
    const n = Math.hypot(out[0], out[1], out[2], out[3]);
    for (let i = 0; i < 4; i++) out[i] /= n;
    return out;
  }

  /** this ∘ b: first b, then this (into `out`, which may be either) */
  mul(b: Rigid, out = new Rigid()) {
    const a = this.r, c = b.r, r = new Float64Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * c[j] + a[i * 3 + 1] * c[3 + j] + a[i * 3 + 2] * c[6 + j];
    const t = this.pt(b.t);
    out.r.set(r); out.t[0] = t[0]; out.t[1] = t[1]; out.t[2] = t[2];
    return out;
  }

  inverse(out = new Rigid()) {
    const r = this.r, t = this.t;
    const ri = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
    out.r.set(ri);
    out.t[0] = -(ri[0] * t[0] + ri[1] * t[1] + ri[2] * t[2]);
    out.t[1] = -(ri[3] * t[0] + ri[4] * t[1] + ri[5] * t[2]);
    out.t[2] = -(ri[6] * t[0] + ri[7] * t[1] + ri[8] * t[2]);
    return out;
  }

  /** the turn about world up this move makes (radians, weft's yaw sense: positive turns left), and how far from a
   *  pure turn about up it is (0: up stays up) */
  yawTurn() {
    const r = this.r;
    // where −z (weft's yaw-0 forward) goes
    const fx = -r[2], fz = -r[8];
    return { yaw: Math.atan2(-fx, -fz), tilt: Math.acos(Math.max(-1, Math.min(1, r[4]))) };
  }

  /** the rows of the 3×4 matrix, as engine/seen.wgsl `Seen` holds them */
  rows(): { x: number[]; y: number[]; z: number[] } {
    const r = this.r, t = this.t;
    return { x: [r[0], r[1], r[2], t[0]], y: [r[3], r[4], r[5], t[1]], z: [r[6], r[7], r[8], t[2]] };
  }

  /** column-major 4×4 (for a GPU uniform or weft's matrices) */
  mat4(out: Float32Array = new Float32Array(16)) {
    const r = this.r, t = this.t;
    out[0] = r[0]; out[1] = r[3]; out[2] = r[6]; out[3] = 0;
    out[4] = r[1]; out[5] = r[4]; out[6] = r[7]; out[7] = 0;
    out[8] = r[2]; out[9] = r[5]; out[10] = r[8]; out[11] = 0;
    out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
    return out;
  }

  /** part of the way from identity to this move (the rotation slerped, the translation scaled): a residual eased out */
  partial(k: number, out = new Rigid()) {
    const q = this.rotation(), w = Math.max(-1, Math.min(1, q[3]));
    const flip = w < 0 ? -1 : 1, ang = 2 * Math.acos(Math.abs(w)), s = Math.sqrt(Math.max(0, 1 - w * w));
    const ax: V3 = s > 1e-9 ? [(q[0] * flip) / s, (q[1] * flip) / s, (q[2] * flip) / s] : [0, 1, 0];
    fromAxisAngle(ax, ang * k, out);
    out.t[0] = this.t[0] * k; out.t[1] = this.t[1] * k; out.t[2] = this.t[2] * k;
    return out;
  }
}

export function fromAxisAngle(a: ArrayLike<number>, ang: number, out = new Rigid()) {
  const c = Math.cos(ang), s = Math.sin(ang), C = 1 - c, x = a[0], y = a[1], z = a[2];
  out.r.set([c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C]);
  out.t.fill(0);
  return out;
}

export function qmul(a: ArrayLike<number>, b: ArrayLike<number>, out: Q4 = [0, 0, 0, 1]): Q4 {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: ArrayLike<number>): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

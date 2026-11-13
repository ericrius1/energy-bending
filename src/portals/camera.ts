// The camera behind a live gate: the view's own camera carried through the gate (so it stands behind the partner
// disc, looking through it), with its near plane laid on that disc's plane (an oblique near plane, Lengyel's): nothing
// between it and the disc is drawn, in every shader, without any of them knowing. weft fills each view's Frame from
// `camera.update(w, h)`, so this subclass bends the projection there and recomputes what depends on it.
//
// Reversed-Z with an infinite far plane: depth = z/w is 1 on the near plane and falls toward 0 far away. The near
// plane's row becomes row_w − a·C (C the clip plane in view space), so w − z = a·(C·v) ≥ 0 exactly where C·v ≥ 0;
// `a` is chosen so that z ≥ 0 still holds along every edge of the frustum out to infinity (no far plane comes back).
// Only the projection's z row changes, so viewRay(), the culls' `proj[1][1]` and the x, y of every vertex are as
// before; the depth values are a regular (not reversed) spread, which in float32 over a few tens of metres is
// still finer than a millimetre.
import { Camera, frustumPlanes, mat4Invert, mat4Mul } from '@ericrius1/weft';
import { dot, type V3 } from './rigid';

export class GateCamera extends Camera {
  /** the world plane (n, d) kept: points with n·p + d ≥ 0 are drawn. null: an ordinary camera */
  clip: [number, number, number, number] | null = null;

  override update(width: number, height: number) {
    super.update(width, height);
    const P = this.clip;
    if (!P || this.ortho) return;
    // the plane in view space: (V⁻¹)ᵀ · P
    const iv = this.invView, C = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) C[j] = iv[j * 4] * P[0] + iv[j * 4 + 1] * P[1] + iv[j * 4 + 2] * P[2] + iv[j * 4 + 3] * P[3];
    // (the eye must be on the side that is cut away; if it isn't, the disc is behind it and nothing is shown anyway)
    if (C[3] >= -1e-6) return;
    const p = this.proj, tx = 1 / p[0], ty = 1 / p[5], sx = p[8] / p[0], sy = p[9] / p[5];
    let a = 1;
    for (const cx of [-1, 1]) for (const cy of [-1, 1]) {
      const d = (cx * tx + sx) * C[0] + (cy * ty + sy) * C[1] - C[2];
      if (d > 1e-9) a = Math.min(a, 1 / d);
    }
    a *= 0.98;
    p[2] = p[3] - a * C[0]; p[6] = p[7] - a * C[1]; p[10] = p[11] - a * C[2]; p[14] = p[15] - a * C[3];
    mat4Mul(this.proj, this.view, this.viewProj);
    mat4Invert(this.viewProj, this.invViewProj);
    mat4Invert(this.proj, this.invProj);
    frustumPlanes(this.viewProj, this.planes);
    mat4Mul(this.proj, this.viewRel, this.viewProjRel);
    mat4Invert(this.viewProjRel, this.invViewProjRel);
  }
}

/** point a weft camera from `eye` along `fwd` with `up` as its up (full orientation: yaw, pitch and the roll left) */
export function setPose(c: Camera, eye: ArrayLike<number>, fwd: ArrayLike<number>, up: ArrayLike<number>) {
  c.position = [eye[0], eye[1], eye[2]];
  const fy = Math.max(-1, Math.min(1, fwd[1]));
  c.yaw = Math.atan2(-fwd[0], -fwd[2]);
  c.pitch = Math.asin(fy);
  // weft: r0 = (cos yaw, 0, −sin yaw), u0 = r0 × f, and a roll turns u to u0 cos − r0 sin
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const r0: V3 = [cy, 0, -sy];
  const u0: V3 = [r0[1] * fwd[2] - r0[2] * fwd[1], r0[2] * fwd[0] - r0[0] * fwd[2], r0[0] * fwd[1] - r0[1] * fwd[0]];
  c.roll = Math.atan2(-dot(up, r0), dot(up, u0));
}

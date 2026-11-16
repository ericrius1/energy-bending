// Where the lens places the sun worlds' far world (report 24-sun-built): the vista (vista.wgsl) is painted detail a few
// pixels wide at 300 m, and the duel's depth of field gives anything that far its whole blur (about 5 px at 720p), so in
// play it read as a soft band. The temple and the Pool each hand the main view's air a "lens" (their light's `lens`
// member): the distance the lens focuses at, estimated here the way the post chain chooses it (the framed dancers'
// nearest and farthest, held equally sharp, eased), and how much of its blur a pixel past `from` m keeps. The air
// (worldFocus in worlds/light.wgsl, vistaFocus in vista.wgsl) places such a pixel nearer the focus so its blur is that
// share; its haze, its reflections and everything else still read the true distance. One frame behind the post
// chain's own focus (the worlds update before it), which moves the kept share by a percent or two.
import type { FrameCtx } from '../engine/frame';
import { JOINT } from '../skeleton/rig';
import { defineParams } from '../engine/params';

export const vistaFocusParams = defineParams('vistaFocus', {
  /** how much of the lens's blur the far world keeps (1: all of it, as before report 24) */
  keep: 0.22,
  /** from where (m, view distance) it is brought in, and where it is whole (the vista's nearest layer is at 110 m) */
  from: 60,
  to: 110,
}, {
  keep: { min: 0, max: 1 },
  from: { min: 10, max: 400 },
  to: { min: 10, max: 600 },
});

type V4 = [number, number, number, number];

export class VistaFocus {
  private now = -1;
  private lastEye: [number, number, number] = [0, 0, 0];
  readonly lens: V4 = [0, 1, 60, 110];

  /** the lens for this frame, for the world `world` (only its dancers count) */
  update(f: FrameCtx, world: string): V4 {
    const cam = f.kit.camera, eye = cam.position, fwd = cam.forward, m = cam.viewProj;
    let near = Infinity, far = 0;
    for (const d of f.dancers) {
      if (d.world && d.world !== world) continue;
      const w = d.skeleton.world;
      for (const j of [JOINT.Hips, JOINT.Head]) {
        const o = j * 12, x = w[o], y = w[o + 1], z = w[o + 2];
        const dist = (x - eye[0]) * fwd[0] + (y - eye[1]) * fwd[1] + (z - eye[2]) * fwd[2];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (dist < 0.3 || cw <= 1e-3) continue;
        const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw, py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
        if (Math.abs(px) > 1.1 || Math.abs(py) > 1.1) continue;
        near = Math.min(near, dist); far = Math.max(far, dist);
      }
    }
    const jump = Math.hypot(eye[0] - this.lastEye[0], eye[1] - this.lastEye[1], eye[2] - this.lastEye[2]) > 1.5;
    this.lastEye = [eye[0], eye[1], eye[2]];
    const P = vistaFocusParams;
    if (far <= 0) { this.lens[0] = 0; return this.lens; }
    const target = (2 * near * far) / (near + far);
    this.now = this.now < 0 || jump ? target : this.now + (target - this.now) * (1 - Math.exp(-Math.max(f.dt, 0) / 0.2));
    this.lens[0] = this.now; this.lens[1] = P.keep; this.lens[2] = P.from; this.lens[3] = Math.max(P.to, P.from + 1);
    return this.lens;
  }
}

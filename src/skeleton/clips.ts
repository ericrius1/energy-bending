// Clips: CMU motion capture packed by scripts/mocap.mjs. A motion file (public/motion/<name>.json + .bin) holds
// rigs and pieces; a piece is one or more dancers recorded together, each a clip of frames (root position as three
// f32, then every rotating joint's local rotation as four i16). A Track samples one dancer of a piece at any time,
// looping by cross-fading its last half second into its first.
import type { Rig } from './rig';
import { MAXJ } from './rig';

export interface PieceDancer { clip: string; skeleton: number; offset: number; stride: number }
export interface Piece { id: string; title: string; note: string; frames: number; fps: number; dancers: PieceDancer[] }
export interface Motion { source: string; skeletons: Rig[]; pieces: Piece[]; bin: ArrayBuffer }

/** a set of clips: 'motion' (the dances) or 'travel' (dances that travel across the floor, for locomotion) */
export async function loadMotion(base: string, name = 'motion'): Promise<Motion> {
  const [meta, bin] = await Promise.all([
    fetch(`${base}motion/${name}.json`).then((r) => { if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`); return r.json(); }),
    fetch(`${base}motion/${name}.bin`).then((r) => r.arrayBuffer()),
  ]);
  return { ...meta, bin };
}

const FADE = 0.6; // seconds of loop cross-fade

function nlerp(a: Float32Array, ai: number, b: Float32Array, bi: number, t: number, out: Float32Array, oi: number) {
  const s = a[ai] * b[bi] + a[ai + 1] * b[bi + 1] + a[ai + 2] * b[bi + 2] + a[ai + 3] * b[bi + 3] < 0 ? -1 : 1;
  let x = 0;
  for (let k = 0; k < 4; k++) { out[oi + k] = a[ai + k] + (b[bi + k] * s - a[ai + k]) * t; x += out[oi + k] * out[oi + k]; }
  x = 1 / Math.sqrt(x);
  for (let k = 0; k < 4; k++) out[oi + k] *= x;
}

/** one dancer of one piece, sampled at any time: `sample(t)` returns [root xyz, then a quaternion per rotating joint] */
export class Track {
  readonly rig: Rig;
  readonly nrot: number;
  readonly duration: number;
  private i16: Int16Array;
  private f32: DataView;
  private base: number;
  private stride: number;
  private a = new Float32Array(3 + 4 * MAXJ);
  private b = new Float32Array(3 + 4 * MAXJ);
  private c = new Float32Array(3 + 4 * MAXJ);
  private d = new Float32Array(3 + 4 * MAXJ);
  readonly pose = new Float32Array(3 + 4 * MAXJ);

  constructor(motion: Motion, readonly piece: Piece, dancer: number) {
    const pd = piece.dancers[dancer];
    this.rig = motion.skeletons[pd.skeleton];
    this.nrot = this.rig.joints.filter((j) => j.rotates).length;
    this.i16 = new Int16Array(motion.bin);
    this.f32 = new DataView(motion.bin);
    this.base = pd.offset;
    this.stride = pd.stride;
    this.duration = piece.frames / piece.fps;
  }

  private frame(f: number, out: Float32Array) {
    const o = this.base + f * this.stride;
    out[0] = this.f32.getFloat32(o, true);
    out[1] = this.f32.getFloat32(o + 4, true);
    out[2] = this.f32.getFloat32(o + 8, true);
    const q = (o + 12) >> 1;
    for (let k = 0; k < this.nrot * 4; k++) out[3 + k] = this.i16[q + k] / 32767;
  }

  /** an exact (fractional) time inside the clip */
  private at(t: number, out: Float32Array) {
    const x = Math.max(0, Math.min(this.piece.frames - 1.001, t * this.piece.fps));
    const f = Math.floor(x), u = x - f;
    this.frame(f, this.a);
    this.frame(f + 1, this.b);
    for (let k = 0; k < 3; k++) out[k] = this.a[k] + (this.b[k] - this.a[k]) * u;
    for (let r = 0; r < this.nrot; r++) nlerp(this.a, 3 + r * 4, this.b, 3 + r * 4, u, out, 3 + r * 4);
  }

  /** the pose at any time: loops over (duration − FADE), the tail fading into the head */
  sample(t: number) {
    const L = this.duration - FADE;
    const tau = ((t % L) + L) % L;
    if (tau >= FADE) { this.at(tau, this.pose); return this.pose; }
    const w = tau / FADE;
    this.at(tau + L, this.c);
    this.at(tau, this.d);
    for (let k = 0; k < 3; k++) this.pose[k] = this.c[k] + (this.d[k] - this.c[k]) * w;
    for (let r = 0; r < this.nrot; r++) nlerp(this.c, 3 + r * 4, this.d, 3 + r * 4, w, this.pose, 3 + r * 4);
    return this.pose;
  }
}

// Plasma arcs: jagged, forking lightning between two points, built on the CPU each frame and drawn as additive
// capsules (arcs.wgsl) before bloom. An arc lives one frame: whoever wants one (the plasma kind between a dancer's
// hands, the game toward a target) calls `add(from, to, intensity)` every frame it should be there. Being rebuilt
// each frame with new random offsets is the flicker, as in the 2D original (docs/element-looks.md, "Lightning arcs"):
// midpoint displacement, 16 segments (8 if short), pinned at both ends, roughness a fraction of the length halving
// each level; one or two forks on a long arc, from a random vertex, turned 0.4 … 1 rad, a fifth to two fifths of its
// length (8 segments), free at the end, thinner and dimmer.
//
// Deterministic when stepped: the random numbers come from the frame number.
import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import { mulberry32 } from 'math/random';
import arcShader, { type ArcLook } from './arcs.wgsl';
import type { ScenePass } from '../../engine/scene';
import { LIMITS } from '../../engine/limits';
import { arcParams } from './params';

export type V3 = readonly [number, number, number] | Float32Array | number[];

interface Queued { from: [number, number, number]; to: [number, number, number]; intensity: number; frames: number }

const SEG_FLOATS = 8;
const MAX = LIMITS.arcSegments;

export class Arcs {
  readonly segs: StorageBuffer;
  readonly look: UniformBuffer<ArcLook>;
  private data = new Float32Array(MAX * SEG_FLOATS);
  private queue: Queued[] = [];
  /** segments drawn this frame */
  count = 0;
  /** arcs drawn this frame */
  arcs = 0;
  private rng = mulberry32.create(1);
  private r = () => mulberry32.sample(this.rng);

  constructor(kit: Kit) {
    this.segs = kit.storage({ label: 'plasma.arcs', size: MAX * SEG_FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.look = kit.uniforms(arcShader.structs.ArcLook, 'plasma.arcs.look');
  }

  /** an arc from `from` to `to` this frame (world, m); intensity 0 … 2 (1: a plasma dancer's own). `frames`: keep it
   *  that many frames (re-forked each one) without calling again; the default is this frame only */
  add(from: V3, to: V3, intensity = 1, frames = 1) {
    if (intensity <= 0) return;
    this.queue.push({ from: [from[0], from[1], from[2]], to: [to[0], to[1], to[2]], intensity, frames });
  }

  declareView(s: ScenePass) {
    if (s.phase !== 'glow') return;
    s.pass.draw(arcShader, {
      label: `plasma.arcs.${s.world.id}`, bind: { look: this.look, segs: this.segs }, count: 6, instances: () => this.count,
      blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' } },
      depthWrite: false, cull: 'none', enabled: () => s.on() && this.count > 0,
    });
  }

  /** build this frame's arcs into the buffer (and forget them: an arc lives one frame) */
  update(frame: number) {
    this.rng = mulberry32.create(0x5a17 + frame * 7919);
    this.count = 0;
    this.arcs = 0;
    for (const q of this.queue) {
      if (this.count > MAX - 40) break;
      this.bolt(q.from, q.to, q.intensity);
      this.arcs++;
    }
    // an arc asked for several frames stays in the queue until they're used
    this.queue = this.queue.filter((q) => --q.frames > 0);
    if (this.count) this.segs.write(this.data.subarray(0, this.count * SEG_FLOATS));
    this.look.set({ glow: arcParams.glow, minPx: arcParams.minPx, count: this.count });
  }

  private bolt(a: number[], b: number[], I: number) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (L < 1e-3) return;
    const width = (arcParams.width + 0.0006 * Math.min(I, 2)) * Math.min(1, 0.4 + 3 * L);
    const pts = this.jag(a, b, L < 0.15 ? 8 : 16, arcParams.roughness * L, true);
    this.emit(pts, width, I, 1);
    const forks = L > 0.2 ? Math.min(arcParams.forks, 1 + Math.floor(this.r() * 2)) : 0;
    for (let k = 0; k < forks; k++) {
      const v = 2 + Math.floor(this.r() * (pts.length / 3 - 4));
      const s = pts.slice(v * 3, v * 3 + 3);
      const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
      const fl = L * (0.18 + 0.25 * this.r());
      const dir = turn(d, 0.4 + 0.6 * this.r(), this.r() * Math.PI * 2);
      const e = [s[0] + dir[0] * fl, s[1] + dir[1] * fl, s[2] + dir[2] * fl];
      const fp = this.jag(s, e, 8, 0.3 * fl, false);
      this.emit(fp, width * 0.6, I * 0.6, 0.4);
    }
  }

  /** a jagged line by midpoint displacement: n segments (a power of two: anything else leaves holes), roughness `amp` (m) halving each level;
   *  pinned at both ends, or with a free end that wanders too */
  private jag(a: number[], b: number[], n: number, amp: number, pinned: boolean): number[] {
    const p = new Array((n + 1) * 3).fill(0);
    p[0] = a[0]; p[1] = a[1]; p[2] = a[2];
    p[n * 3] = b[0]; p[n * 3 + 1] = b[1]; p[n * 3 + 2] = b[2];
    if (!pinned) for (let c = 0; c < 3; c++) p[n * 3 + c] += (this.r() - 0.5) * amp;
    for (let step = n, h = amp; step > 1; step >>= 1, h *= 0.5) {
      for (let i = 0; i < n; i += step) {
        const m = i + step / 2;
        for (let c = 0; c < 3; c++) p[m * 3 + c] = (p[i * 3 + c] + p[(i + step) * 3 + c]) / 2 + (this.r() - 0.5) * 2 * h;
      }
    }
    return p;
  }

  /** the line's segments into the buffer, the width tapering by `taper` towards its end */
  private emit(p: number[], width: number, I: number, taper: number) {
    const n = p.length / 3 - 1, D = this.data;
    for (let i = 0; i < n && this.count < MAX; i++) {
      const w = width * (1 - (1 - taper) * (i / n));
      D.set([p[i * 3], p[i * 3 + 1], p[i * 3 + 2], w, p[i * 3 + 3], p[i * 3 + 4], p[i * 3 + 5], I], this.count * SEG_FLOATS);
      this.count++;
    }
  }
}

/** d turned by `angle` towards a direction round it picked by `around` (radians) */
function turn(d: number[], angle: number, around: number): number[] {
  const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = u.map((x) => x / ul);
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const ca = Math.cos(around), sa = Math.sin(around), c = Math.cos(angle), s = Math.sin(angle);
  return [0, 1, 2].map((k) => d[k] * c + (u[k] * ca + v[k] * sa) * s);
}

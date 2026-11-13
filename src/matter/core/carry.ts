// The carry step a kind adds for the portals (MatterPasses.carry, docs/extending/portal.md): one compute, enabled only on
// the frame a dancer crosses a gate, that moves that dancer's particles by the gate's rigid move before the kind's own
// step. Give it the kind's carry shader (core/carry.wgsl for the core Particle, or the kind's own with the same `Carry`
// uniform and `homes` binding), the storage to move under the shader's binding name, and how many particles there are;
// add it to 'sim' before the kind's step (so declare it first).
import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import type { FrameBuilder } from '../../engine/frame';
import { LIMITS } from '../../engine/limits';
import type { Carry } from './kind';

/** the shader's `Carry` struct, filled from the moves */
interface CarryData { m: Float32Array[]; q: number[][]; mask: number; count: number }

export class CarryStep {
  private u: UniformBuffer<any>;
  private on = false;
  private data: CarryData = { m: Array.from({ length: LIMITS.dancers }, () => new Float32Array(16)), q: Array.from({ length: LIMITS.dancers }, () => [0, 0, 0, 1]), mask: 0, count: 0 };

  constructor(kit: Kit, frame: FrameBuilder, o: { label: string; owner: string; shader: any; homes: StorageBuffer; bind: Record<string, StorageBuffer>; count: () => number }) {
    this.u = kit.uniforms(o.shader.structs.Carry, `${o.label}.u`);
    const step = kit.compute(o.shader, {
      label: o.label, threads: () => [Math.max(1, o.count())], enabled: () => this.on && o.count() > 0,
      bind: { carry: this.u, homes: o.homes, ...o.bind },
    });
    frame.add('sim', step, o.owner);
    frame.after(() => { this.on = false; }, `${o.owner}: the carry is done`);
    this.count = o.count;
  }
  private count: () => number;

  /** dancers carried this frame: their particles move before this frame's step */
  carry(moves: readonly Carry[]) {
    const c = this.data;
    if (!this.on) c.mask = 0;
    for (const { dancer, move } of moves) {
      if (dancer < 0 || dancer >= LIMITS.dancers) continue;
      c.m[dancer].set(move);
      c.q[dancer] = quatOf(move);
      c.mask |= 1 << dancer;
    }
    c.count = this.count();
    this.u.set(c);
    this.on = true;
  }
}

/** a rigid move's rotation (column-major 4×4) as a quaternion (x, y, z, w) */
export function quatOf(m: Float32Array): number[] {
  const m00 = m[0], m01 = m[4], m02 = m[8], m10 = m[1], m11 = m[5], m12 = m[9], m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let q: number[];
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((x) => x / n);
}

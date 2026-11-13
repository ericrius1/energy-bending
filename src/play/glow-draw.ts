// The jogo's glows drawn (glow.wgsl): the list (glow.ts) into a storage buffer each frame, one instanced draw added to
// the main view's scene pass after everything already declared there (the glow phase is the last), additive.
import type { Kit, RenderPass, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import glowShader, { type GlowLook } from './glow.wgsl';
import { LIMITS } from '../engine/limits';
import { GLOW_FLOATS as FLOATS, type Glows } from './glow';

const MAX = LIMITS.glows;

/** the draw: the list into a storage buffer each frame, one instanced draw in the main view's scene pass */
export class GlowDraw {
  readonly buf: StorageBuffer;
  readonly look: UniformBuffer<GlowLook>;
  constructor(kit: Kit, readonly glows: Glows) {
    this.buf = kit.storage({ label: 'jogo.glows', size: MAX * FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.look = kit.uniforms(glowShader.structs.GlowLook, 'jogo.glows.look');
    this.look.set({ count: 0, minPx: 1.2, pad0: 0, pad1: 0 });
  }
  /** once, at setup: added to the main view's scene pass after everything already declared (the glow phase is last) */
  declare(pass: RenderPass, on: () => boolean) {
    pass.draw(glowShader, {
      label: 'jogo.glows', bind: { look: this.look, glows: this.buf }, count: 6, instances: () => this.glows.count,
      blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' } },
      depthWrite: false, cull: 'none', enabled: () => on() && this.glows.count > 0,
    });
  }
  /** each frame, after everything has asked for its glows: up to the GPU (the list is cleared by the next frame's first) */
  upload() {
    const g = this.glows;
    if (g.gain !== 1) for (let i = 0; i < g.count; i++) g.data[i * FLOATS + 7] *= g.gain;
    if (g.count) this.buf.write(g.data.subarray(0, g.count * FLOATS));
    this.look.set({ count: g.count, minPx: 1.2, pad0: 0, pad1: 0 });
  }
}

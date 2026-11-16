// The jogo's glows drawn (glow.wgsl): the list (glow.ts) into a storage buffer each frame, one instanced draw added to
// the main view's scene pass after everything already declared there (the glow phase is the last), additive.
// Phase 7 (report 24): a range of the list may be drawn instead into the view's glow pass (`layer`): the duel's fused
// finale's bloom, a light standing in the air in front of the world, which the air then lays over the world at its own
// distance (post/air.wgsl): not fogged as far as the sky behind it, not lifted by the moment's lamp, its petals hiding
// what is behind them, the sun's beams behind them.
import type { Kit, RenderPass, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import glowShader, { type GlowLook } from './glow.wgsl';
import { LIMITS } from '../engine/limits';
import { GLOW_FLOATS as FLOATS, type Glows } from './glow';

const MAX = LIMITS.glows;

/** the draw: the list into a storage buffer each frame, one instanced draw in the main view's scene pass */
export class GlowDraw {
  readonly buf: StorageBuffer;
  readonly look: UniformBuffer<GlowLook>;
  /** the layer's draw: only the range `layer()` gives (the scene's skips it) */
  private lookLayer: UniformBuffer<GlowLook> | null = null;
  /** the layer's instances this frame (its range's end; 0: none) */
  private layerN = 0;
  /** the range of the list drawn in the glow pass instead of the scene (declareLayer), or null */
  layer: () => readonly [number, number] | null = () => null;
  constructor(private kit: Kit, readonly glows: Glows) {
    this.buf = kit.storage({ label: 'jogo.glows', size: MAX * FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.look = kit.uniforms(glowShader.structs.GlowLook, 'jogo.glows.look');
    this.look.set({ count: 0, minPx: 1.2, skipLo: 0, skipHi: 0 });
  }
  /** once, at setup: added to the main view's scene pass after everything already declared (the glow phase is last) */
  declare(pass: RenderPass, on: () => boolean) {
    pass.draw(glowShader, {
      label: 'jogo.glows', bind: { look: this.look, glows: this.buf }, count: 6, instances: () => this.glows.count,
      // (added; the scene's alpha, the opaque distance, kept as it was)
      blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
      depthWrite: false, cull: 'none', enabled: () => on() && this.glows.count > 0,
    });
  }
  /** once, at setup: the `layer` range drawn into a view's glow pass (its alpha, the nearest light's distance, min-blended:
   *  a laid-over petal writes its own, glow.wgsl kind 10) */
  declareLayer(pass: RenderPass, on: () => boolean) {
    this.lookLayer = this.kit.uniforms(glowShader.structs.GlowLook, 'jogo.glows.layer');
    this.lookLayer.set({ count: 0, minPx: 1.2, skipLo: 0, skipHi: 0 });
    pass.draw(glowShader, {
      label: 'jogo.glows.layer', bind: { look: this.lookLayer, glows: this.buf }, count: 6, instances: () => this.layerN,
      blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' } },
      depthWrite: false, cull: 'none', enabled: () => on() && this.layerN > 0,
    });
  }
  /** each frame, after everything has asked for its glows: up to the GPU (the list is cleared by the next frame's first) */
  upload() {
    const g = this.glows;
    if (g.gain !== 1) for (let i = 0; i < g.count; i++) g.data[i * FLOATS + 7] *= g.gain;
    if (g.count) this.buf.write(g.data.subarray(0, g.count * FLOATS));
    const L0 = this.lookLayer ? this.layer() : null, L = L0 && L0[1] <= g.count && L0[0] < L0[1] ? L0 : null;
    // (the scene skips the layer's range; the layer's draw skips all before it)
    this.look.set({ count: g.count, minPx: 1.2, skipLo: L ? L[0] : 0, skipHi: L ? L[1] : 0 });
    this.layerN = L ? L[1] : 0;
    this.lookLayer?.set({ count: this.layerN, minPx: 1.2, skipLo: 0, skipHi: L ? L[0] : 0 });
  }
}

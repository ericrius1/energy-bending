// Steam: the first reaction, a matter kind with no homes on any body. It is born wherever the field makes it (heat
// meeting wet, flame melting ice: fieldSteam), whoever brought the heat and the wet, then rises on the field's wind,
// billows and fades. One compute step in 'sim' (after the field's), one draw per world in the glow phase.
import type { StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import simShader, { type Steam } from './steam_sim.wgsl';
import drawShader from './steam_draw.wgsl';
import type { MatterCtx, MatterPasses } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import { CAPSULES } from '../core/capsules';
import { LIMITS } from '../../engine/limits';
import { steamParams } from './params';

/** premultiplied "over" for the colour; the scene's alpha (its view distance) is kept */
const OVER: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };

export class SteamPasses implements MatterPasses {
  readonly id = 'steam';
  readonly count: number;
  private sim: UniformBuffer<Steam>;
  private puffs: StorageBuffer;
  private near = new Float32Array(LIMITS.fieldDeposits * 4);

  constructor(private ctx: MatterCtx) {
    const kit = ctx.kit;
    this.count = Math.min(LIMITS.steam, Math.round(steamParams.pool / (ctx.coarse ? 3 : 1)));
    this.sim = kit.uniforms(simShader.structs.Steam, 'steam.sim');
    // zeros: every puff starts dead (age 0, life 0)
    this.puffs = kit.storage({ label: 'steam.puffs', size: this.count * 32 });
    const step = kit.compute(simShader, { label: 'steam.sim', threads: [this.count], bind: { steam: this.sim, puffs: this.puffs } });
    ctx.frame.add('sim', step, 'steam');
  }

  declareView(s: ScenePass) {
    if (s.phase !== 'glow') return;
    s.pass.draw(drawShader, {
      label: `steam.${s.world.id}`, bind: { steam: this.sim, puffs: this.puffs }, constants: { WORLD: s.world.light },
      count: 6, instances: this.count, blend: OVER, depthWrite: false, cull: 'none', enabled: s.on,
    });
  }

  layout() { /* steam lives in the air, on no body */ }

  update(f: FrameCtx) {
    const P = steamParams, near = this.near;
    const deps = this.ctx.field.recentDeposits();
    deps.forEach((d, k) => near.set([d.p[0], d.p[1], d.p[2], d.r * 1.5], k * 4));
    this.sim.set({
      count: this.count, frameNo: f.frame, dt: Math.min(Math.max(f.danceDt, 0), 1 / 20), time: f.t,
      birth: P.birth, rise: P.rise, follow: P.follow, turbulence: P.turbulence, lifeMin: P.lifeMin, lifeMax: P.lifeMax,
      sizeBirth: P.sizeBirth, sizeEnd: P.sizeEnd, density: P.density, glow: P.glow, warmth: P.warmth, floorY: 0,
      capsules: CAPSULES.length, deposits: deps.length, near,
    });
  }

  stats() { return { puffs: this.count }; }
}

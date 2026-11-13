// Steam: the first reaction, a matter kind with no homes on any body. It is born wherever the field makes it (heat
// meeting wet, flame melting ice: fieldSteam), whoever brought the heat and the wet, then rises on the field's wind,
// billows and fades. One compute step in 'sim' (after the field's), one draw per world over the focused image (after
// the depth of field, in the post chain's lens pass: see steam_draw.wgsl for why).
import type { StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import simShader, { type Steam } from './steam_sim.wgsl';
import drawShader from './steam_draw.wgsl';
import type { MatterCtx, MatterPasses } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { PostChain } from '../../post/post';
import type { FrameCtx } from '../../engine/frame';
import { CAPSULES } from '../core/capsules';
import { LIMITS } from '../../engine/limits';
import { steamParams } from './params';
import type { MatterEars } from '../../audio/matter';
import { Trigger } from '../core/sounding';

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

  /** nothing in the scene: steam is drawn over the focused image (declarePost) */
  declareView(_s: ScenePass) { /* see declarePost */ }

  /** the puffs over the focused image, in the post chain's lens pass, one pipeline per world (its light), the main
   *  view's world on. Main view only: steam is born of the field, which follows the main view's world, so a gate's
   *  view or the ?pip inset shows none (docs/extending/reactions.md) */
  declarePost(post: PostChain) {
    for (const w of this.ctx.worlds) {
      post.lens.draw(drawShader, {
        label: `steam.${w.id}`, bind: { steam: this.sim, puffs: this.puffs, sceneTex: post.sceneTex }, constants: { WORLD: w.light },
        count: 6, instances: this.count, blend: OVER, depthWrite: false, cull: 'none', enabled: () => this.mainWorld === w.id,
      });
    }
  }
  /** the main view's world, as of the last update */
  private mainWorld = '';

  layout() { /* steam lives in the air, on no body */ }

  update(f: FrameCtx) {
    this.mainWorld = f.views[0]?.world ?? '';
    this.voice(f);
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

  // ---------------------------------------------------------------- its voice (audio/matter/steam.ts)
  private ears: MatterEars | null = null;
  private puff = new Trigger(0.35, 0.15, 0.4);
  hear(ears: MatterEars) { this.ears = ears; }
  /** steam hisses as much as the field is making where the dancers are (a probe a little above their middle, read
   *  back one to three frames late), and puffs when a burst of it starts */
  private voice(f: FrameCtx) {
    if (!this.ears) return;
    const c = this.ctx.field.centre, p: [number, number, number] = [c[0], c[1] + 0.4, c[2]];
    const r = this.ctx.field.probe('steam.voice', p);
    if (!r) return;
    const amount = Math.min(1.2, r.steam * 1.5);
    if (amount > 0.03) this.ears.hold({ kind: 'steam', type: 'hiss', key: 'field', x: p[0], y: p[1], z: p[2], amount, speed: r.up });
    if (this.puff.test(r.steam, f.t)) this.ears.event({ kind: 'steam', type: 'puff', x: p[0], y: p[1] + 0.3, z: p[2], strength: Math.min(1, r.steam) });
  }

  stats() { return { puffs: this.count }; }
}

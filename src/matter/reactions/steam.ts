// Steam: what happens where two elements meet, a matter kind with no homes on any body. Where a hot body touches a wet
// or cold one, a thin white-hot front burns on the contact surface (fronts: short streaks born every frame on the
// contact, so the line follows it and is gone when the bodies part) and wisps boil up from it and are gone within
// about a second; flame on ice also drips, plasma on water sparks. Which pair it is comes from the field at the
// contact (heat's sign and size, wet, plasma's dryness), never from knowing the dancers. A fusion staged in the field
// (field.fuse) gives it its look: steam, prism, storm, aurora.
//
// One compute step in 'sim' (after the field's). The wisps are drawn at reduced resolution into a target of their own
// (in 'air', after the main view's air), then composited over the focused image in the post chain's lens pass with a
// soft blur and a per-pixel cap on density and brightness; the fronts, drips and sparks go on top at full resolution.
// The main view only (docs/extending/reactions.md).
import type { StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import simShader, { type Steam } from './steam_sim.wgsl';
import drawShader from './steam_draw.wgsl';
import frontShader from './steam_front.wgsl';
import compShader from './steam_comp.wgsl';
import type { MatterCtx, MatterPasses } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { PostChain } from '../../post/post';
import type { FrameCtx } from '../../engine/frame';
import { CAPSULES } from '../core/capsules';
import { LIMITS } from '../../engine/limits';
import { FUSION_KINDS } from '../field/field';
import { steamParams } from './params';
import type { MatterEars } from '../../audio/matter';
import { Trigger } from '../core/sounding';
import { budget, BUDGETS } from '../../engine/perf';
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';

/** premultiplied "over" for the colour; the scene's alpha (its view distance) is kept */
const OVER: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
/** added colour; the alpha kept */
const ADD: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
/** the wisps' sum: colour and optical depth both added */
const SUM: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const PUFF_BYTES = 48;

export class SteamPasses implements MatterPasses {
  readonly id = 'steam';
  readonly count: number;
  /** the pool's split: wisps [0, wispEnd), fronts [wispEnd, frontEnd), drips [frontEnd, dripEnd), sparks after */
  private ends: [number, number, number];
  private sim: UniformBuffer<Steam>;
  private puffs: StorageBuffer;
  private near = new Float32Array(LIMITS.fieldDeposits * 4);
  private low: Texture | null = null;
  private scene: Texture | null = null;

  constructor(private ctx: MatterCtx) {
    const kit = ctx.kit, P = steamParams;
    // the device's budget (engine/perf.ts) scales the pool (a phone's third, as `coarse` gave), and the wisps' size
    const b = budget();
    this.count = Math.min(LIMITS.steam, Math.round(P.pool * b.steam / BUDGETS.desktop.steam));
    P.sizeBirth *= b.spriteScale; P.sizeEnd *= b.spriteScale;
    const w = Math.round(this.count * P.wispShare), f = w + Math.round(this.count * P.frontShare);
    this.ends = [w, f, Math.min(this.count, f + Math.round(this.count * P.dripShare))];
    this.sim = kit.uniforms(simShader.structs.Steam, 'steam.sim');
    // zeros: every particle starts dead (age 0, life 0)
    this.puffs = kit.storage({ label: 'steam.puffs', size: this.count * PUFF_BYTES });
    const step = kit.compute(simShader, { label: 'steam.sim', threads: [this.count], bind: { steam: this.sim, puffs: this.puffs } });
    ctx.frame.add('sim', step, 'steam');
  }

  /** nothing in the scene: steam is drawn over the focused image (declarePost) */
  declareView(_s: ScenePass) { /* see declarePost */ }

  /** the wisps into their own reduced target (in 'air', after the main view's air, so the scene's distance is there to
   *  test against), one pipeline per world (its light), the main view's world on; then in the lens pass, after the
   *  depth of field: the composite, and the fronts, drips and sparks. Main view only: steam is born of the field,
   *  which follows the main view's world, so a gate's view or the ?pip inset shows none (docs/extending/reactions.md) */
  declarePost(post: PostChain) {
    const kit = this.ctx.kit;
    const scale = this.ctx.coarse ? Math.min(steamParams.lowRes, 0.35) : steamParams.lowRes;
    const low = kit.texture({ label: 'steam.low', format: 'rgba16float', size: 'render', scale });
    this.low = low;
    this.scene = post.sceneTex;
    const pass = kit.pass({ label: 'steam.low', color: [{ target: low, clear: [0, 0, 0, 0] }] });
    for (const w of this.ctx.worlds) {
      pass.draw(drawShader, {
        label: `steam.${w.id}`, bind: { steam: this.sim, puffs: this.puffs, sceneTex: post.sceneTex }, constants: { WORLD: w.light },
        count: 6, instances: this.ends[0], blend: SUM, depthWrite: false, cull: 'none', enabled: () => this.mainWorld === w.id,
      });
    }
    this.ctx.frame.add('air', pass, 'steam');
    post.lens.fullscreen(compShader, { label: 'steam.comp', bind: { steam: this.sim, steamLow: low, sceneTex: post.sceneTex }, blend: OVER });
    post.lens.draw(frontShader, {
      label: 'steam.front', bind: { steam: this.sim, puffs: this.puffs, sceneTex: post.sceneTex },
      count: 6, instances: this.count - this.ends[0], firstInstance: this.ends[0], blend: ADD, depthWrite: false, cull: 'none',
    });
  }

  /** the main view's world, as of the last update */
  private mainWorld = '';
  /** 0 … 1: a catch's frames (the duel sets it: fx.ts DuelFx.quiet): the veil keeps off the bodies all the more */
  quiet = 0;
  /** a column of mist over a geyser (the duel sets it each frame, null when none): its foot, radius, height, how much
   *  of it stands (0 … 1) and the dusk (0 … 1); drawn in the composite (steam_comp.wgsl columnMist) */
  column: { at: ArrayLike<number>; r: number; h: number; amount: number; dusk: number } | null = null;
  private keep = new Float32Array(16);
  private keepR = [0, 0, 0, 0];

  /** each dancer in the main view's world as a capsule on screen from its hips to the top of its head (uv), its radius
   *  a torso's half width and a little (uv of the screen's height), and the nearest one's view distance: steam's veil
   *  thins over them (steam_comp.wgsl) and no wisp stands nearer the lens than they do (steam_draw.wgsl) */
  private keepOff(f: FrameCtx) {
    const m = f.kit.camera.viewProj, K = this.keep, R = this.keepR, P1 = f.kit.camera.proj[5];
    K.fill(0); R.fill(0);
    let n = 0, near = Infinity;
    const at = (W: ArrayLike<number>, j: number, out: number[]) => {
      const o = j * JOINT_FLOATS, x = W[o], y = W[o + 1], z = W[o + 2], w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (!(w > 0.05)) return false;
      out[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) * 0.5 + 0.5; out[1] = 0.5 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5; out[2] = w;
      return true;
    };
    const a = [0, 0, 0], b = [0, 0, 0];
    for (const d of f.dancers) {
      if (n >= 4) break;
      if ((d as { world?: string }).world && (d as { world?: string }).world !== this.mainWorld) continue;
      const W = d.skeleton.world;
      if (!at(W, JOINT.Hips, a) || !at(W, JOINT.HeadEnd, b)) continue;
      K.set([a[0], a[1], b[0], b[1]], n * 4);
      // (0.3 m about the spine, at the nearer end's distance)
      R[n] = (0.3 * P1 * 0.5) / Math.min(a[2], b[2]);
      near = Math.min(near, a[2], b[2]);
      n++;
    }
    return { n, near: n ? near : 0 };
  }

  layout() { /* steam lives in the air, on no body */ }

  update(f: FrameCtx) {
    this.mainWorld = f.views[0]?.world ?? '';
    this.voice(f);
    const P = steamParams, near = this.near, field = this.ctx.field;
    const deps = field.recentDeposits();
    deps.forEach((d, k) => near.set([d.p[0], d.p[1], d.p[2], d.r * 1.5], k * 4));
    const fu = field.fusionFront, hx = field.helix;
    const kept = this.keepOff(f), aspect = f.kit.camera.aspect, col = this.column && this.column.amount > 0.003 ? this.column : null;
    this.sim.set({
      count: this.count, frameNo: f.frame, dt: Math.min(Math.max(f.danceDt, 0), 1 / 20), time: f.t,
      wispEnd: this.ends[0], frontEnd: this.ends[1], dripEnd: this.ends[2], capsules: CAPSULES.length,
      birth: P.birth, rise: P.rise, follow: P.follow, turbulence: P.turbulence, lifeMin: P.lifeMin, lifeMax: P.lifeMax,
      sizeBirth: P.sizeBirth, sizeEnd: P.sizeEnd, density: P.density, glow: P.glow, warmth: P.warmth, floorY: 0,
      deposits: deps.length, gap: P.gap, frontRate: P.frontRate, frontLife: P.frontLife,
      frontGlow: P.frontGlow, cap: P.cap, maxBright: P.maxBright, jet: P.jet,
      sink: P.sink, lowScale: this.low && this.scene ? this.scene.width / Math.max(1, this.low.width) : 2, blur: P.blur, sparkRate: P.sparkRate,
      // amount 0: kind 0 at weight 0, a strict no-op in every shader (fusionIs is the amount)
      fusion: [FUSION_KINDS.indexOf(fu.kind), fu.amount, 0, 0],
      hAt: hx.at, hAxis: hx.axis, hShape: hx.shape, near,
      keep: this.keep, keepR: this.keepR,
      keepK: [P.keepOff + (P.keepOffCatch - P.keepOff) * this.quiet, kept.near, aspect, kept.n],
      look: [P.shafts, P.scatter, P.dusk, P.warm],
      column: col ? [col.at[0], col.at[1], col.at[2], col.r] : [0, 0, 0, 0],
      columnB: col ? [col.h, col.amount * P.column, col.dusk, Math.max(0, kept.near - 0.5)] : [0, 0, 0, 0],
      columnCol: [1.0, 0.8, 0.52, P.columnDensity],
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

  stats() { return { particles: this.count, wisps: this.ends[0], fronts: this.ends[1] - this.ends[0] }; }
}

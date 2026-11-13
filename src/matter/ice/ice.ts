// Ice's drawing, for the water pool (matter/water/pool.ts): the shards that grow on frozen particles, the set ice
// the game builds with (ice/setice.ts), and the mist and dust that frozen matter breathes out. The pool owns the
// particles and their motion; this owns how ice looks. Draws go in the scene's opaque phase (shards, one pipeline per
// world for its light) and its glow phase (the motes); the motes' step runs in the 'sim' stage after the pool's.
import type { StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import shardShader, { type IceLook } from './shards.wgsl';
import mistSimShader, { type Mist } from './mist_sim.wgsl';
import mistDrawShader from './mist_draw.wgsl';
import type { MatterCtx } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import { hex, onParams } from '../../engine/params';
import { iceParams, MOTES, SET_SHARDS_MAX } from './params';
import { SetIce, SHARD_FLOATS } from './setice';

/** what ice needs of the pool */
export interface IcePool {
  sim: UniformBuffer<any>;
  state: StorageBuffer;
  aux: StorageBuffer;
  homes: StorageBuffer;
  /** particles simulated now */
  count(): number;
  /** whether any of them may be frozen (an ice layer, a dancer's form, the field's cold) */
  maybeIce(): boolean;
}

export class IceDraws {
  /** the set ice the game builds with */
  readonly setIce = new SetIce();
  readonly look: UniformBuffer<IceLook>;
  private sets: StorageBuffer;
  private mist: UniformBuffer<Mist>;
  private motes: StorageBuffer;
  private _look = {} as IceLook;
  private _mist = {} as Mist;
  private declared = new Set<string>();

  constructor(ctx: MatterCtx, private pool: IcePool) {
    const kit = ctx.kit;
    this.look = kit.uniforms(shardShader.structs.IceLook, 'ice.look');
    this.sets = kit.storage({ label: 'ice.set', size: SET_SHARDS_MAX * SHARD_FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.mist = kit.uniforms(mistSimShader.structs.Mist, 'ice.mist');
    this.motes = kit.storage({ label: 'ice.motes', size: MOTES * 32 });
    const step = kit.compute(mistSimShader, {
      label: 'ice.mist', entry: 'step', threads: [MOTES], enabled: () => pool.count() > 0 && pool.maybeIce(),
      bind: { mist: this.mist, state: pool.state, aux: pool.aux, motes: this.motes },
    });
    ctx.frame.add('sim', step, 'ice');
    onParams(iceParams, (k) => { if (k === 'demo') this.demo(iceParams.demo); });
  }

  /** a named piece of set ice by the stage's middle (iceParams.demo), for captures */
  demo(name: string) {
    const S = this.setIce;
    if (name === 'clear') for (const p of [...S.pieces]) S.remove(p.id);
    if (name === 'bridge') S.add({ points: [[0.9, 0, -0.2], [1.4, 0.5, -0.2], [2.0, 0.85, -0.2], [2.7, 0.85, -0.2], [3.3, 0.5, -0.2], [3.8, 0, -0.2]], width: 0.55 });
    if (name === 'ramp') S.add({ points: [[-1.5, 0.05, 0.6], [0, 0.6, 0.6], [1.2, 0.6, 0.6]], width: 0.4, life: 20 });
  }

  /** the shards (opaque) and the motes (glow), once per view, world and phase */
  declareView(s: ScenePass) {
    const key = `${s.view.id}.${s.world.id}.${s.phase}`;
    if (this.declared.has(key)) return;
    this.declared.add(key);
    const { pass, world, on } = s, P = this.pool;
    const bind = { sim: P.sim, look: this.look, state: P.state, aux: P.aux, homes: P.homes, sets: this.sets, seen: s.view.seen };
    if (s.phase === 'opaque') {
      pass.draw(shardShader, {
        label: `ice.shards.${world.id}`, bind, constants: { SET: 0, WORLD: world.light }, cull: 'back', count: 72,
        instances: () => Math.ceil(P.count() / Math.max(1, Math.round(iceParams.shardEvery))),
        enabled: () => on() && P.count() > 0 && P.maybeIce(),
      });
      pass.draw(shardShader, {
        label: `ice.set.${world.id}`, bind, constants: { SET: 1, WORLD: world.light }, cull: 'back', count: 72,
        // (set ice is drawn only in the world it was laid in)
        instances: () => this.setIce.shardCount, enabled: () => on() && this.setIce.shardCount > 0 && (!this.setIce.world || this.setIce.world === s.view.world),
      });
    } else if (s.phase === 'glow') {
      pass.draw(mistDrawShader, {
        label: `ice.mist.${world.id}`, bind: { mist: this.mist, motes: this.motes }, count: 6, instances: MOTES,
        // (the motes belong to no dancer: drawn in the main view only, like steam)
        blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && s.view.id === 'main' && P.count() > 0 && P.maybeIce(),
      });
    }
  }

  /** each frame: the look, the motes' step, set ice's clock and its shards up to the GPU when they changed */
  update(f: FrameCtx, dt: number, floorY: number) {
    const P = iceParams, L = this._look, M = this._mist;
    L.size = P.size; L.frost = P.frost; L.glint = P.glint; L.edges = P.edges; L.inside = P.inside;
    L.tint = [...hex(P.thin), P.ior]; L.deep = [...hex(P.thick), P.dispersion];
    L.time = f.t;
    this.setIce.update(f.dt);
    L.setTime = this.setIce.now;
    this.look.set(L);
    M.count = this.pool.count(); M.motes = MOTES; M.frameNo = f.frame; M.dt = dt; M.time = f.t; M.floorY = floorY;
    M.birth = 1 - Math.exp(-P.breath * Math.max(f.dt, 0) * 0.25); M.mist = P.mist; M.dust = P.dust; M.mistSize = P.mistSize; M.dustSize = P.dustSize;
    this.mist.set(M);
    if (this.setIce.dirty) {
      this.setIce.dirty = false;
      if (this.setIce.shardCount) this.sets.write(this.setIce.shards.subarray(0, this.setIce.shardCount * SHARD_FLOATS));
    }
  }
}


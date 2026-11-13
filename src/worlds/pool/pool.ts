// The Pool: the prototype's void made real. An endless black mirror of shallow water under a dark sky, a glow along
// the horizon, a few stars; nothing else, so the dancers and their matter are the only light, doubled in the water.
// Its light is case 2 of worlds/light.wgsl (pool.wgsl). What it draws: the sky and the black floor (the backdrop). The
// water's surface is laid over the scene in the air pass (pool.wgsl poolScene): the dancers reflected, the reflection
// bent by a live ripple field (water/ripples.ts) that the dancers' feet and hands stir by themselves and that the game
// can push with `ripple(x, z, strength, radius)`. Flat, no ledges: the pure stage.
import type { Pool as PoolU } from '../light.wgsl';
import { lightSlot, type LightSlot } from '../shared';
import backdropShader from './backdrop.wgsl';
import type { PortalDef, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import { defineParams, hex, onParams } from '../../engine/params';
import { Ripples } from '../water/ripples';
import { stagePlane, spawnsOf, type StagePlane } from '../stage';

export const poolParams = defineParams('pool', {
  zenith: '#010207',
  horizon: '#0a0e2a',
  glow: '#ffb48c',
  glowAmt: 0.12,
  stars: 1,
  /** the light on the dancers from above, and the glow's rim on them from behind */
  keyLight: 1.1,
  keyCol: '#b9c6ff',
  rim: 3.0,
  /** the water: how much more than water it mirrors, how much the ripples bend it, the wind's small waves */
  mirror: 0.55,
  ripples: 1,
  wind: 0.02,
  deep: '#010103',
  haze: 0.0015,
  /** the ripples: how fast they run (m/s), how quickly they die (per s), how hard a foot pushes */
  waveSpeed: 0.9,
  waveFade: 0.55,
  feet: 0.0012,
}, {
  glowAmt: { min: 0, max: 1, label: 'horizon glow' },
  stars: { min: 0, max: 3 },
  keyLight: { min: 0, max: 3, label: 'light from above' },
  rim: { min: 0, max: 8 },
  mirror: { min: 0, max: 1 },
  ripples: { min: 0, max: 4 },
  wind: { min: 0, max: 0.1, step: 0.001 },
  haze: { min: 0, max: 0.05, step: 0.001 },
  glow: { color: true },
});

export class Pool implements World {
  readonly id = 'pool';
  readonly light = 2;
  readonly mood = -0.5;
  readonly shared;
  readonly stages: StagePlane[];
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly fixtures = [];
  readonly mirrorFloor = false;
  readonly room = 40;
  readonly maxDist = 16;
  private u: LightSlot<PoolU>;
  private waves: Ripples;
  private seen = -1;
  private live = { waves: [0, 0, 1, 1] as [number, number, number, number], march: [20, 14, 0, 0] as [number, number, number, number] };

  constructor(ctx: WorldCtx) {
    const { kit, frame, coarse } = ctx;
    this.u = lightSlot(kit, 'pool');
    this.waves = new Ripples(kit, frame, {
      label: 'pool', cells: coarse ? 192 : 320, cell: coarse ? 0.08 : 0.05,
      speed: poolParams.waveSpeed, fade: poolParams.waveFade, feet: poolParams.feet,
      enabled: () => this.seen === kit.frameIndex,
    });
    this.shared = { poolWaves: this.waves.tex };
    this.live.march[0] = coarse ? 12 : 22;
    // the pure stage: a flat floor 11.5 m wide, nothing on it
    this.stages = [stagePlane({ id: 'pool', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2.45, 0], [2.45, 0]], lens: 18 })];
    this.spawns = spawnsOf(this.stages[0]);
    // one gate, back to the geode: off to the side of the stage, facing it, with open water all round
    this.portals = [{ id: 'pool.geode', at: [-7.5, 1.35, 4.5], normal: [0.83, 0, -0.55], radius: 1.25, to: { world: 'geode', portal: 'geode.pool' } }];
    this.upload();
    onParams(poolParams, () => this.upload());
  }

  async load() { /* everything is made in the shaders */ }

  private upload() {
    const P = poolParams;
    const k = [0.25, 0.9, 0.35], kl = Math.hypot(...k);
    this.u.set({
      zenith: [...hex(P.zenith), P.stars], horizon: [...hex(P.horizon), 0.35], glow: [...hex(P.glow), P.glowAmt],
      glowDir: [0, 0, -1, 2.5], key: [k[0] / kl, k[1] / kl, k[2] / kl, P.keyLight], keyCol: [...hex(P.keyCol), P.rim],
      water: [0, P.mirror, P.ripples, P.wind], deep: [...hex(P.deep), P.haze],
    });
  }

  /** a push on the water: a footfall the feet didn't make, a landing, matter falling in */
  ripple(x: number, z: number, strength: number, radius: number) { this.waves.ripple(x, z, strength, radius); }

  update(f: FrameCtx, c: { x: number; z: number }) {
    this.seen = f.kit.frameIndex;
    this.waves.update(f, c.x, c.z, 0);
    this.live.waves = this.waves.window();
    this.live.march[2] = f.t;
    this.u.set(this.live);
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    if (s.phase === 'backdrop') s.pass.fullscreen(backdropShader, { label: 'pool.backdrop', enabled: s.on });
  }

  groundAt() { return 0; }
  exposure() { return 1.15; }
  tone() { return { water: 9000, cave: 0.35, hearth: 0, depth: 0.7, forest: 0 }; }
  ambience() { return null; }
}

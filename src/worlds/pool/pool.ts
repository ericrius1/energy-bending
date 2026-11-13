// The Pool: the prototype's void made real. An endless black mirror of shallow water under a dark sky, a glow along
// the horizon, a few stars; nothing else, so the dancers and their matter are the only light, doubled in the water.
// Its light is case 2 of worlds/light.wgsl (pool.wgsl). What it draws: the sky and the black floor (the backdrop). The
// water's surface is laid over the scene in the air pass (pool.wgsl poolScene): the dancers reflected, the reflection
// bent by a live ripple field (water/ripples.ts) that the dancers' feet and hands stir by themselves and that the game
// can push with `ripple(x, z, strength, radius)`. Flat, no ledges: the pure stage. One event in its sky: a great
// moon low behind the stage, climbing a few degrees over ten minutes and down again (`moonAt`), its road broken
// across the ripples, a mist on the far water lit on its bearing.
import type { Pool as PoolU } from '../light.wgsl';
import { lightSlot, type LightSlot } from '../shared';
import backdropShader from './backdrop.wgsl';
import type { Grade, PortalDef, World, WorldCtx } from '../world';
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
  wind: 0.025,
  deep: '#010103',
  haze: 0.0015,
  /** the ripples: how fast they run (m/s), how quickly they die (per s), how hard a foot pushes */
  waveSpeed: 0.9,
  waveFade: 0.55,
  feet: 0.0012,
  /** the moon: its colour, how bright its face, how big (degrees across), where it stands (degrees round from behind
   *  the stage, degrees up), how far it climbs in ten minutes (degrees), and hold it at a moment for stills (s, or < 0) */
  moonCol: '#ffe6c4',
  moon: 1.5,
  moonSize: 2.4,
  moonBearing: 4,
  moonUp: 4.2,
  moonClimb: 2.5,
  moonHold: -1,
  /** the mist lying on the far water (its colour where the moon doesn't light it) */
  mistCol: '#1a1c34',
  mist: 0.7,
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
  moon: { min: 0, max: 10, label: 'moon' },
  moonSize: { min: 0, max: 10, step: 0.1, label: 'moon size (°)' },
  moonUp: { min: -2, max: 30, step: 0.1, label: 'moon height (°)' },
  moonClimb: { min: 0, max: 20, step: 0.1 },
  moonHold: { min: -1, max: 600, step: 1 },
  mist: { min: 0, max: 1 },
  moonCol: { color: true },
  mistCol: { color: true },
});

export class Pool implements World {
  readonly id = 'pool';
  readonly light = 2;
  readonly mood = -0.5;
  /** the locked view's dim beyond the stage (World.stageDim; 9-stage.md): the backdrop is nearly black already, and
   *  the moon and its path on the water are what is there: dimmed little */
  readonly stageDim = 0.3;
  readonly shared;
  readonly stages: StagePlane[];
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly fixtures = [];
  readonly mirrorFloor = false;
  /** its colour (src/post/grade.ts): night blue in the shadows, the moon's warmth in the light, the water kept black
   *  (docs/reports/4-worlds-hub-pool-forge.md, in the hook's terms; its vignette 0.35 is not per world yet) */
  readonly grade: Grade = { lift: [0.002, 0.003, 0.008], shadows: [0.94, 0.96, 1.12], highlights: [1.03, 0.98, 0.9], saturation: 0.9, contrast: 1.15 };
  readonly room = 40;
  readonly maxDist = 16;
  private u: LightSlot<PoolU>;
  private waves: Ripples;
  private seen = -1;
  private live = { waves: [0, 0, 1, 1] as [number, number, number, number], march: [20, 14, 0, 0] as [number, number, number, number], moon: [0, 0.07, -1, 0.03] as [number, number, number, number] };

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
      moonCol: [...hex(P.moonCol), P.moon], mist: [...hex(P.mistCol), P.mist],
    });
  }

  /** the moon at t seconds: low behind the stage, climbing a few degrees over ten minutes, then down again */
  private moonAt(t: number) {
    const P = poolParams, rad = Math.PI / 180;
    const s = P.moonHold >= 0 ? P.moonHold : t;
    const up = (P.moonUp + P.moonClimb * (0.5 - 0.5 * Math.cos((s / 600) * Math.PI))) * rad, b = P.moonBearing * rad;
    const m = this.live.moon;
    m[0] = Math.sin(b) * Math.cos(up); m[1] = Math.sin(up); m[2] = -Math.cos(b) * Math.cos(up); m[3] = P.moonSize * 0.5 * rad;
  }

  /** a push on the water: a footfall the feet didn't make, a landing, matter falling in */
  ripple(x: number, z: number, strength: number, radius: number) { this.waves.ripple(x, z, strength, radius); }

  update(f: FrameCtx, c: { x: number; z: number }) {
    this.seen = f.kit.frameIndex;
    this.waves.update(f, c.x, c.z, 0);
    this.live.waves = this.waves.window();
    this.live.march[2] = f.t;
    this.moonAt(f.t);
    this.u.set(this.live);
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    if (s.phase === 'backdrop') s.pass.fullscreen(backdropShader, { label: 'pool.backdrop', enabled: s.on });
  }

  groundAt() { return 0; }
  /** the water is the floor: fire's mirror copy reflects about it */
  waterY() { return 0; }
  exposure() { return 1.15; }
  tone() { return { water: 9000, cave: 0.35, hearth: 0, depth: 0.7, forest: 0 }; }
  ambience() { return null; }
}

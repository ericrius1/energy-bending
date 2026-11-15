// The Pool: a water garden in the hour before sunset (phase 4's first solarpunk pass, report 16-pool; before it the
// prototype's black void under a moon). An endless sheet of clean deep water under a sky going from teal overhead to
// gold on the horizon, the sun low behind the stage, and round the horizon a far shore of gardens: trees, and glass-and-
// brass pavilions whose domes catch the sun. Its light is case 2 of worlds/light.wgsl (pool.wgsl). What it draws: the
// sky and the open water (the backdrop) and, in the duel, the arena's stones and rafts and the garden on the water
// round them (garden.ts; the planting on the pieces' rims, beds.wgsl) and the built garden at the rim, at the bodies'
// height (edge.ts: the pavilion, sails, trellis arches, fountains; report 18). The water's surface is laid over the scene in the air pass (pool.wgsl poolScene): what stands
// in the water fades into its teal with depth, the sky and the dancers are mirrored, bent by a live ripple field
// (water/ripples.ts) that the dancers' feet and hands stir by themselves and that the game can push with
// `ripple(x, z, strength, radius)`, the sun glitters on the ripples, foam gathers where a body or a stone breaks the
// surface, and the duel's swell (hazards.ts) is lit through as it rolls. The sun sinks a few degrees over ten minutes
// and back (`sunAt`). Why late gold and not noon or night: the low warm light gives the water a sky to mirror and a
// road of glitter, rims every body in gold, and leaves the water a deep clear teal, darker than the pale water and ice
// bodies, so they stand out on it; the night's black mirror is what report 15 found unreadable.
import type { Pool as PoolU } from '../light.wgsl';
import { lightSlot, type LightSlot } from '../shared';
import backdropShader from './backdrop.wgsl';
import type { Grade, PortalDef, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import { defineParams, hex, onParams } from '../../engine/params';
import { Ripples } from '../water/ripples';
import { stagePlane, spawnsOf, type StagePlane } from '../stage';
import stoneShader from './stones.wgsl';
import type { Solid } from '../solids';
import { arenaShown } from '../../duel/arena';
import { swellAt, swellNow } from '../../duel/hazards';
import { poolDuel, poolGround, poolStonesNow } from './arena';
import { PoolGarden } from './garden';
import { PoolEdge } from './edge';

type V4 = [number, number, number, number];

export const poolParams = defineParams('pool', {
  // (report 20, the third coat: the golden hour made to glow: the sun lower, in the duel's frame, its glow wider and
  // warmer, the sky deeper overhead; the far world on the horizon: vista.wgsl)
  zenith: '#4a8ab8',
  horizon: '#f5b77a',
  glow: '#ff9d52',
  glowAmt: 1.05,
  stars: 0,
  /** the sun: the key light on the dancers and the stones, its colour, and the glow's rim on them from behind */
  keyLight: 2.4,
  keyCol: '#ffd6a6',
  rim: 1.6,
  /** the water: how much more than water it mirrors, how much the ripples bend it, the wind's small waves */
  mirror: 0.1,
  ripples: 1.4,
  wind: 0.03,
  /** the water's own colour seen deep, and how fast it takes red, green and blue from what is under it (per m) */
  deep: '#0d4d50',
  absorbR: 1.5,
  absorbG: 0.32,
  absorbB: 0.42,
  haze: 0.0015,
  /** foam (where the ripples are steep, round what stands in the water, on the swell's crest); the sun's glints on the
   *  ripples; the caustics under the surface; the swell's crest on the surface (× its real slope) and lit through */
  foam: 1,
  glints: 1,
  caustics: 1,
  swellShow: 2.5,
  swellLight: 1,
  /** the ripples: how fast they run (m/s), how quickly they die (per s), how hard a foot pushes */
  waveSpeed: 0.9,
  waveFade: 0.55,
  feet: 0.0012,
  /** the sun: its colour, how bright its face, how big (degrees across), where it stands (degrees round from behind
   *  the stage, degrees up), how far it sinks in ten minutes (degrees), and hold it at a moment for stills (s, or < 0) */
  sunCol: '#ffd29a',
  sun: 10,
  sunSize: 2.2,
  sunBearing: 18,
  sunUp: 7.5,
  sunSink: 1.5,
  sunHold: -1,
  /** the haze lying on the far water, and the far shore's leaves and height (degrees) */
  mistCol: '#f0bf8a',
  mist: 0.35,
  shoreCol: '#3b6a33',
  shore: 3.2,
}, {
  glowAmt: { min: 0, max: 2, label: 'horizon glow' },
  stars: { min: 0, max: 3 },
  keyLight: { min: 0, max: 6, label: 'sunlight' },
  rim: { min: 0, max: 8 },
  mirror: { min: 0, max: 1 },
  ripples: { min: 0, max: 4 },
  wind: { min: 0, max: 0.1, step: 0.001 },
  haze: { min: 0, max: 0.05, step: 0.001 },
  absorbR: { min: 0, max: 4 }, absorbG: { min: 0, max: 4 }, absorbB: { min: 0, max: 4 },
  foam: { min: 0, max: 1 }, glints: { min: 0, max: 4 }, caustics: { min: 0, max: 4 },
  swellShow: { min: 0, max: 6 }, swellLight: { min: 0, max: 4 },
  glow: { color: true },
  sun: { min: 0, max: 100, label: 'sun' },
  sunSize: { min: 0, max: 10, step: 0.1, label: 'sun size (°)' },
  sunBearing: { min: -180, max: 180, step: 1 },
  sunUp: { min: -2, max: 60, step: 0.1, label: 'sun height (°)' },
  sunSink: { min: 0, max: 20, step: 0.1 },
  sunHold: { min: -1, max: 600, step: 1 },
  mist: { min: 0, max: 1 },
  shore: { min: 0, max: 8, step: 0.1, label: 'far shore (°)' },
  sunCol: { color: true },
  mistCol: { color: true },
  shoreCol: { color: true },
});

export class Pool implements World {
  readonly id = 'pool';
  readonly light = 2;
  readonly mood = -0.5;
  /** the locked view's dim beyond the stage (World.stageDim; 9-stage.md): the evening sky and the far shore, dimmed
   *  a little */
  readonly stageDim = 0.35;
  readonly shared;
  readonly stages: StagePlane[];
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly fixtures = [];
  readonly mirrorFloor = false;
  /** its colour (src/post/grade.ts): teal kept in the shadows (the water), the sun's gold in the light, a little more
   *  colour than the night had */
  readonly grade: Grade = { lift: [0.004, 0.005, 0.004], shadows: [0.95, 1.02, 1.04], highlights: [1.05, 1.0, 0.9], saturation: 1.06, contrast: 1.06 };
  /** nothing solid in the Pool, but the duel arena's stones and rafts while it is shown (arena.ts) */
  get solids(): readonly Solid[] { return arenaShown(this.id) ? poolDuel().arena.pieces! : []; }
  private duelBuf: ReturnType<WorldCtx['kit']['storage']>;
  private stonesNow = poolDuel().data.slice();
  private garden: PoolGarden;
  /** what stands round the duel's water at the bodies' height: the pavilion, arches, fountains, sails (edge.ts) */
  private edge: PoolEdge;
  readonly room = 40;
  readonly maxDist = 16;
  private u: LightSlot<PoolU>;
  private waves: Ripples;
  private seen = -1;
  private live = {
    waves: [0, 0, 1, 1] as V4, march: [20, 14, 0, 0] as V4, sun: [0, 0.3, -1, 0.015] as V4, key: [0, 0.3, -1, 1] as V4,
    swell: [1, 0, 0, 0] as V4, swellAt: [0, 0, 2, 0] as V4,
  };

  constructor(ctx: WorldCtx) {
    const { kit, frame, coarse } = ctx;
    this.u = lightSlot(kit, 'pool');
    this.waves = new Ripples(kit, frame, {
      label: 'pool', cells: coarse ? 192 : 320, cell: coarse ? 0.08 : 0.05,
      speed: poolParams.waveSpeed, fade: poolParams.waveFade, feet: poolParams.feet,
      enabled: () => this.seen === kit.frameIndex,
    });
    this.shared = { poolWaves: this.waves.tex };
    this.duelBuf = kit.storage({ label: 'pool.duel', data: poolDuel().data, usage: ['storage'] });
    this.garden = new PoolGarden(kit, coarse, this.duelBuf);
    this.edge = new PoolEdge(kit, coarse);
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
    const P = poolParams, rad = Math.PI / 180, b = P.sunBearing * rad;
    this.u.set({
      zenith: [...hex(P.zenith), P.stars], horizon: [...hex(P.horizon), 0.3], glow: [...hex(P.glow), P.glowAmt],
      glowDir: [Math.sin(b), 0, -Math.cos(b), 2.5], keyCol: [...hex(P.keyCol), P.rim],
      water: [0, P.mirror, P.ripples, P.wind], deep: [...hex(P.deep), P.haze],
      sunCol: [...hex(P.sunCol), P.sun], mist: [...hex(P.mistCol), P.mist], shore: [...hex(P.shoreCol), P.shore * rad],
      absorb: [P.absorbR, P.absorbG, P.absorbB, P.foam], look: [P.glints, P.caustics, P.swellShow, P.swellLight],
    });
  }

  /** the sun at t seconds: low behind the stage, sinking a few degrees over ten minutes, then back up. The key light
   *  comes from it, a little higher (the sky's light with it), so the stones' tops still take it */
  private sunAt(t: number) {
    const P = poolParams, rad = Math.PI / 180;
    const s = P.sunHold >= 0 ? P.sunHold : t;
    const up = (P.sunUp - P.sunSink * (0.5 - 0.5 * Math.cos((s / 600) * Math.PI))) * rad, b = P.sunBearing * rad;
    const m = this.live.sun, k = this.live.key;
    m[0] = Math.sin(b) * Math.cos(up); m[1] = Math.sin(up); m[2] = -Math.cos(b) * Math.cos(up); m[3] = P.sunSize * 0.5 * rad;
    const ku = up + 12 * rad;
    k[0] = Math.sin(b) * Math.cos(ku); k[1] = Math.sin(ku); k[2] = -Math.cos(b) * Math.cos(ku); k[3] = P.keyLight;
  }

  /** the duel's swell as the surface shows it (hazards.ts): its way, the crest's place, its height now */
  private swellNow() {
    const w = this.live.swell, a = this.live.swellAt;
    w[3] = 0;
    const H = poolDuel().arena.hazard;
    if (!arenaShown(this.id) || !H?.on || !H.swell) return;
    const S = H.swell, n = swellNow(H, H.beat);
    if (n.u >= 1.05) return;
    const cx = S.center[0] + n.dir[0] * n.crest, cz = S.center[1] + n.dir[1] * n.crest;
    w[0] = n.dir[0]; w[1] = n.dir[1]; w[2] = n.crest; w[3] = swellAt(H, cx, cz, H.beat);
    a[0] = S.center[0]; a[1] = S.center[1]; a[2] = S.width;
  }

  /** a push on the water: a footfall the feet didn't make, a landing, matter falling in */
  ripple(x: number, z: number, strength: number, radius: number) { this.waves.ripple(x, z, strength, radius); }

  update(f: FrameCtx, c: { x: number; z: number }) {
    this.seen = f.kit.frameIndex;
    // the duel's stones where the swell has them (hazards.ts moves their solids; the draw follows)
    if (arenaShown(this.id) && poolStonesNow(this.stonesNow)) this.duelBuf.write(this.stonesNow);
    this.waves.update(f, c.x, c.z, 0);
    this.live.waves = this.waves.window();
    this.live.march[2] = f.t;
    this.sunAt(f.t);
    this.swellNow();
    this.u.set(this.live);
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    if (s.phase === 'backdrop') s.pass.fullscreen(backdropShader, { label: 'pool.backdrop', enabled: s.on });
    else if (s.phase === 'opaque') {
      // the duel arena's stones and rafts (arena.ts), and the garden round them on the water, only while it is shown
      const duel = () => s.on() && arenaShown(this.id);
      // (eight quads a face each way: the low pieces' rounded corners need them)
      s.pass.draw(stoneShader, { label: 'pool.duel', bind: { stones: this.duelBuf }, count: 6 * 8 * 8 * 6, instances: poolDuel().count, constants: { N: 8 }, cull: 'none', enabled: duel });
      this.garden.declare(s, duel);
      this.edge.declare(s, duel);
    } else if (s.phase === 'glow') {
      this.edge.declare(s, () => s.on() && arenaShown(this.id));
    }
  }

  /** the shallow water's floor; in the duel the water is deep, a floor to float on (and the stones and rafts in it) */
  groundAt(x: number, z: number) { return arenaShown(this.id) ? poolGround(x, z) : 0; }
  /** the water is the floor: fire's mirror copy reflects about it */
  waterY() { return 0; }
  exposure() { return 0.85; }
  tone() { return { water: 9000, cave: 0.35, hearth: 0, depth: 0.7, forest: 0 }; }
  ambience() { return null; }
}

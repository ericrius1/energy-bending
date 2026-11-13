// The geode: dancers inside a hollow stone full of water (Gem Dancers' first scene). Its light is case 0 of
// worlds/light.wgsl: a studio of softbox and rims, and a shaft from a hole in the roof that comes down through
// water, netting the floor with caustics and following the dancers like a follow-spot. Its floor is polished
// agate (a mirror for the matter near it). Its wall is a dome of crystals: gems it is built of (a fixture, which the
// gems kind places and draws). What it draws itself: the backdrop (the dark and the floor) and dust in the light.
import type { UniformBuffer } from '@ericrius1/weft';
import lightShader, { type Geode as GeodeU } from '../light.wgsl';
import backdropShader from './backdrop.wgsl';
import moteShader from './motes.wgsl';
import type { Fixture, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import type { StagePlane } from '../../engine/camera';
import { defineParams, hex, onParams } from '../../engine/params';

export const geodeParams = defineParams('geode', {
  keyLight: 8,
  rimLight: 3,
  rimPower: 10,
  floorGloss: 1,
  fog: 0.07,
  bgTop: '#050409',
  bgBottom: '#0f0a14',
  floorCol: '#a0607e',
  rim: '#8f7bff',
  // the wall and the light
  cave: true,
  caveStones: 2600,
  caveRadius: 8.5,
  caveTint: '#9a82e0',
  caveBright: 0.3,
  floorBand: '#4a3d63',
  floorBandAmt: 0.55,
  shaft: 0.035,
  shaftRadius: 1.15,
  shaftTop: 8.2,
  shaftCol: '#f4ece2',
  // the light came down through water: a net of caustics on the floor and the stones, rays in the air
  caustics: 0.5,
  rays: 0.7,
  causticCells: 4.2,
  causticSpeed: 0.25,
  motes: 1400,
  moteSize: 0.008,
  haze: 0.035,
  hazeCol: '#06040a',
  // how it sounds: under water (Hz), the cave's echo, a fire somewhere, the depth under the bed
  water: 2600,
  echo: 0.8,
  hearth: 0.5,
  depth: 0.5,
}, {
  keyLight: { min: 0, max: 20, label: 'key light' },
  rimLight: { min: 0, max: 10, label: 'rim light' },
  cave: { label: 'crystal wall' },
  caveBright: { min: 0, max: 2, label: 'wall glow' },
  shaft: { min: 0, max: 0.2, label: 'light from above' },
  caustics: { min: 0, max: 2 },
  rays: { min: 0, max: 2 },
  haze: { min: 0, max: 0.2 },
  floorCol: { color: true, label: 'floor' },
  rim: { color: true },
});

export class Geode implements World {
  readonly id = 'geode';
  readonly light = 0;
  readonly mood = -0.2;
  readonly shared: Record<string, UniformBuffer<any>>;
  readonly stages: StagePlane[];
  readonly portals = [];
  readonly spawns: [number, number, number][] = [[-1.2, 0, 0], [1.2, 0, 0]];
  readonly fixtures: Fixture[];
  readonly mirrorFloor = true;
  readonly maxDist = 14;
  private u: UniformBuffer<GeodeU>;
  private pool = [0, 0, 2.2, 0];
  private shaft = [0, 0, 1.15, 0];
  private live = { pool: this.pool, shaft: this.shaft };

  constructor(ctx: WorldCtx) {
    const P = geodeParams;
    if (ctx.coarse) Object.assign(P, { caveStones: 700, motes: 700 });
    this.u = ctx.kit.uniforms(lightShader.structs.Geode, 'geode.light');
    this.shared = { geode: this.u };
    // a stage through the middle, seen from the front, with a lens long enough to flatten it but short enough to
    // stay inside the wall (7.4 m out)
    this.stages = [{ id: 'centre', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 4, ground: 0, ledges: [], spawns: [[-1.2, 0], [1.2, 0]] }];
    // the wall: crystal points and clusters pointing in at the stage, thicker and bigger where the dome meets the floor
    this.fixtures = [{ kind: 'gems', id: 'geode.wall', shape: 'dome', count: Math.min(P.caveStones, 4096), radius: P.caveRadius,
      specimens: ['quartz', 'citrine', 'amethyst', 'celestite'], seed: 4242, enabled: () => geodeParams.cave }];
    this.upload();
    onParams(P, () => this.upload());
  }

  get room() { return geodeParams.caveRadius - 1.1; }

  async load() { /* everything it needs is made in the shaders */ }

  /** the parameters into the uniform */
  private upload() {
    const P = geodeParams;
    this.u.set({
      bgTop: [...hex(P.bgTop), 1], bgBottom: [...hex(P.bgBottom), 1], floorCol: [...hex(P.floorCol), 1], rim: [...hex(P.rim), P.rimLight],
      key: [0.3, 0.88, 0.38, P.keyLight], cave: [...hex(P.caveTint), P.caveBright], floorBand: [...hex(P.floorBand), P.floorBandAmt],
      shaftCol: [...hex(P.shaftCol), P.shaftTop], caustic: [P.caustics, P.causticCells, P.causticSpeed, P.rays], hazeCol: [...hex(P.hazeCol), P.haze],
      rimPower: P.rimPower, floorGloss: P.floorGloss, fog: P.fog, moteSize: P.moteSize, floorY: 0,
    });
  }

  /** the light from above follows the dancers, like a follow-spot through a hole in the roof */
  update(_f: FrameCtx, c: { x: number; z: number; ring: boolean; dancers: number }) {
    const P = geodeParams, crowd = c.ring ? 'ring' : c.dancers > 1 ? 'many' : 'one';
    this.pool[0] = c.x; this.pool[1] = c.z; this.pool[2] = crowd === 'ring' ? 2.6 : crowd === 'many' ? 3.0 : 2.2;
    this.shaft[0] = c.x; this.shaft[1] = c.z;
    this.shaft[2] = P.shaftRadius * (crowd === 'ring' ? 1.4 : crowd === 'many' ? 1.35 : 1);
    this.shaft[3] = P.shaft * (crowd === 'ring' ? 0.55 : 1);
    this.u.set(this.live);
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    if (s.phase === 'backdrop') s.pass.fullscreen(backdropShader, { label: 'geode.backdrop', enabled: s.on });
    else if (s.phase === 'glow') {
      s.pass.draw(moteShader, { label: 'geode.motes', count: 6, instances: () => geodeParams.motes, blend: 'add', depthWrite: false, cull: 'none', enabled: s.on });
    }
  }

  groundAt() { return 0; }
  exposure() { return 1; }
  tone() { const P = geodeParams; return { water: P.water, cave: P.echo, hearth: P.hearth, depth: P.depth, forest: 0 }; }
  ambience() { return null; }
}

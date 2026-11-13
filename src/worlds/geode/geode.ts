// The geode: dancers inside a hollow stone full of water (Gem Dancers' first scene). Its light is case 0 of
// worlds/light.wgsl: a studio of softbox and rims, and a shaft from a hole in the roof that comes down through
// water, netting the floor with caustics and following the dancers like a follow-spot. Its floor is polished
// agate (a mirror for the matter near it). Its wall is a dome of crystals: gems it is built of (a fixture, which the
// gems kind places and draws). What it draws itself: the backdrop (the dark and the floor), dust in the light, and the
// stage's crystal shelves (shelves.ts: blades of selenite grown out of the back wall, their flat tops the ledges).
//
// It is the hub: a gate to every other world stands round its floor (portals), facing the middle.
import type { UniformBuffer } from '@ericrius1/weft';
import lightShader, { type Geode as GeodeU } from '../light.wgsl';
import backdropShader from './backdrop.wgsl';
import moteShader from './motes.wgsl';
import shelfShader from './shelves.wgsl';
import { layoutShelves, packBlades } from './shelves';
import { stagePlane, spawnsOf } from '../stage';
import type { Fixture, PortalDef, World, WorldCtx } from '../world';
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
  /** the stage's crystal shelves on the back wall */
  shelves: true,
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
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly fixtures: Fixture[];
  readonly mirrorFloor = true;
  readonly maxDist = 14;
  private u: UniformBuffer<GeodeU>;
  private pool = [0, 0, 2.2, 0];
  private shaft = [0, 0, 1.15, 0];
  private live = { pool: this.pool, shaft: this.shaft };
  private blades: ReturnType<typeof layoutShelves>['blades'];
  private bladeBuf: ReturnType<WorldCtx['kit']['storage']>;

  constructor(ctx: WorldCtx) {
    const P = geodeParams;
    if (ctx.coarse) Object.assign(P, { caveStones: 700, motes: 700 });
    this.u = ctx.kit.uniforms(lightShader.structs.Geode, 'geode.light');
    this.shared = { geode: this.u };
    // a stage through the middle, seen from the front, its ledges the crystal shelves grown out of the wall; the lens
    // long enough to flatten it but the camera inside the wall (7.1 m out at most)
    const shelves = layoutShelves({ caveRadius: P.caveRadius });
    this.blades = shelves.blades;
    this.bladeBuf = ctx.kit.storage({ label: 'geode.shelves', data: packBlades(this.blades), usage: ['storage'] });
    this.stages = [stagePlane({
      id: 'centre', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: shelves.ledges,
      spawns: [[-2.45, 0], [2.45, 0]], lens: 20,
    })];
    this.spawns = spawnsOf(this.stages[0]);
    // the hub's gates, one to each world, round the floor facing the middle (the stage's shelves behind, the
    // director's shots in front, the wall's crystals well clear of a 1.3 m disc)
    const gate = (id: string, world: string, x: number, z: number): PortalDef => {
      const l = Math.hypot(x, z);
      return { id: `geode.${id}`, at: [x, 1.35, z], normal: [-x / l, 0, -z / l], radius: 1.25, to: { world, portal: `${world}.geode` } };
    };
    this.portals = [gate('pool', 'pool', -6.0, 3.0), gate('temple', 'temple', 6.0, 3.0), gate('forge', 'forge', -2.9, 6.0), gate('redwoods', 'redwoods', 2.9, 6.0)];
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
    else if (s.phase === 'opaque') {
      s.pass.draw(shelfShader, { label: 'geode.shelves', bind: { blades: this.bladeBuf }, count: 8 * 6 * 6 + 48, instances: this.blades.length, cull: 'none', enabled: () => s.on() && geodeParams.shelves });
    } else if (s.phase === 'glow') {
      s.pass.draw(moteShader, { label: 'geode.motes', count: 6, instances: () => geodeParams.motes, blend: 'add', depthWrite: false, cull: 'none', enabled: s.on });
    }
  }

  groundAt() { return 0; }
  exposure() { return 1; }
  tone() { const P = geodeParams; return { water: P.water, cave: P.echo, hearth: P.hearth, depth: P.depth, forest: 0 }; }
  ambience() { return null; }
}

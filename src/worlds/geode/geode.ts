// The geode: dancers inside a hollow stone full of water (Gem Dancers' first scene). Its light is case 0 of
// worlds/light.wgsl: a studio of softbox and rims, and a shaft from a hole in the roof that comes down through
// water, netting the floor with caustics and following the dancers like a follow-spot. Its floor is polished
// agate (a mirror for the matter near it). Its wall is a great hollow, twelve metres round: a shell of crystal faces
// in veins of colour, glowing from within, with a dome of gem crystals in front of it (a fixture, which the gems kind
// places and draws). What it draws itself: the backdrop (the wall, the vault's opening and the floor), dust in the
// light, the stage's crystal shelves (shelves.ts: blades of selenite grown out of druses of crystal, their flat tops
// the ledges) and its crystal points (crystals.wgsl: the druses, great crystals by the wall, the gates' crowns).
//
// It is the hub: a gate to every other world stands round its floor (portals), facing the middle, each in a crown of
// crystals in its world's colour, a path worn across the agate to it.
import type { Texture } from '@ericrius1/weft';
import type { Geode as GeodeU } from '../light.wgsl';
import { lightSlot, type LightSlot } from '../shared';
import backdropShader from './backdrop.wgsl';
import moteShader from './motes.wgsl';
import shelfShader from './shelves.wgsl';
import crystalShader from './crystals.wgsl';
import { layoutShelves, packBlades, solidsOfShelves } from './shelves';
import { clearOf, type Solid } from '../solids';
import { hubGates, hubParams } from './gates';
import { stagePlane, spawnsOf } from '../stage';
import type { Grade, Fixture, PortalDef, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import type { StagePlane } from '../../engine/camera';
import { defineParams, hex, onParams } from '../../engine/params';
import { arenaShown, dropsUniform, inDrop } from '../../duel/arena';
import { geodeDuel } from './arena';

export const geodeParams = defineParams('geode', {
  keyLight: 8,
  rimLight: 3,
  rimPower: 10,
  floorGloss: 1,
  fog: 0.03,
  bgTop: '#050409',
  bgBottom: '#0f0a14',
  floorCol: '#a0607e',
  rim: '#8f7bff',
  // the wall and the light
  cave: true,
  /** the stage's crystal shelves on the back wall */
  shelves: true,
  caveStones: 3600,
  caveRadius: 12,
  caveTint: '#9a82e0',
  caveBright: 0.4,
  floorBand: '#4a3d63',
  floorBandAmt: 0.55,
  shaft: 0.035,
  shaftRadius: 1.15,
  shaftTop: 11.5,
  shaftCol: '#f4ece2',
  // the light came down through water: a net of caustics on the floor and the stones, rays in the air
  caustics: 0.5,
  rays: 0.7,
  causticCells: 4.2,
  causticSpeed: 0.25,
  motes: 1400,
  moteSize: 0.008,
  haze: 0.03,
  hazeCol: '#08060f',
  /** the hollow's wall: how much higher than wide its vault reaches, how strongly its crystals glow, their glints */
  vault: 1,
  wallGlow: 1,
  wallGlints: 1.2,
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
  /** the locked view's dim beyond the stage (World.stageDim; 9-stage.md): the gem dome's stars and bokeh are busy
   *  behind the pair, so a little more than the default */
  readonly stageDim = 0.65;
  readonly shared: Record<string, Texture>;
  readonly stages: StagePlane[];
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly fixtures: Fixture[];
  readonly mirrorFloor = true;
  /** its colour (src/post/grade.ts): violet in the shadows, a warm white in the light, blacks kept for the bokeh
   *  (the world agent's proposal, docs/reports/4-worlds-hub-pool-forge.md, in the hook's terms; its vignette 0.25 is
   *  not per world yet) */
  readonly grade: Grade = { lift: [0.004, 0.002, 0.008], shadows: [0.95, 0.92, 1.08], highlights: [1.02, 0.975, 0.92], saturation: 1.1, contrast: 1.05 };
  readonly maxDist = 14;
  private u: LightSlot<GeodeU>;
  private pool = [0, 0, 2.2, 0];
  private shaft = [0, 0, 1.15, 0];
  private live = { pool: this.pool, shaft: this.shaft };
  private blades: ReturnType<typeof layoutShelves>['blades'];
  private bladeBuf: ReturnType<WorldCtx['kit']['storage']>;
  private points: ReturnType<typeof layoutShelves>['points'];
  /** the first of the high blade's blades (the last in the list; the front of the game leaves it out) */
  private high = 0;
  private pointBuf: ReturnType<WorldCtx['kit']['storage']>;
  /** each gate's xz, its path's half width, its world's tint */
  private gates: number[];
  /** the blades and the bigger crystal points as simple shapes (World.solids), from the shelves' layout; with the duel
   *  arena's crystal while it is shown */
  get solids(): readonly Solid[] { return arenaShown(this.id) ? this.duelSolids : this.stageSolids; }
  private stageSolids: readonly Solid[];
  private duelSolids: readonly Solid[];
  private duelBlades: ReturnType<WorldCtx['kit']['storage']>;
  private duelPoints: ReturnType<WorldCtx['kit']['storage']>;

  constructor(ctx: WorldCtx) {
    const P = geodeParams;
    if (ctx.coarse) Object.assign(P, { caveStones: 1000, motes: 700 });
    this.u = lightSlot(ctx.kit, 'geode');
    this.shared = {};
    // the hub's gates (HUB_GATES), one to each world
    const sites = hubGates();
    this.portals = sites.map(({ world, at, normal, radius }): PortalDef => ({ id: `geode.${world}`, at, normal, radius, to: { world, portal: `${world}.geode` } }));
    // each gate's setting: a ring of crystals in its world's colour round the disc, a worn path to it across the floor
    this.gates = sites.flatMap((s) => [s.at[0], s.at[2], 0.55, s.tint]);
    // a stage through the middle, seen from the front, its ledges the crystal shelves grown out of the druses at its
    // ends and behind it; the lens long enough to flatten it, the camera inside the hollow
    const shelves = layoutShelves({ caveRadius: P.caveRadius, gates: sites });
    this.blades = shelves.blades;
    this.bladeBuf = ctx.kit.storage({ label: 'geode.shelves', data: packBlades(this.blades), usage: ['storage'] });
    this.points = shelves.points;
    this.stageSolids = solidsOfShelves(this.blades, this.points);
    // the duel arena's shelves, beams and crystals (arena.ts), drawn only while it is shown
    const duel = geodeDuel();
    this.duelSolids = [...this.stageSolids, ...duel.arena.pieces!];
    this.duelBlades = ctx.kit.storage({ label: 'geode.duel.shelves', data: duel.blades, usage: ['storage'] });
    this.duelPoints = ctx.kit.storage({ label: 'geode.duel.crystals', data: duel.points, usage: ['storage'] });
    this.high = shelves.high;
    this.pointBuf = ctx.kit.storage({ label: 'geode.crystals', data: packBlades(this.points), usage: ['storage'] });
    this.stages = [stagePlane({
      id: 'centre', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: shelves.ledges,
      spawns: [[-2.2, 0], [2.2, 0]], lens: 24,
    })];
    this.spawns = spawnsOf(this.stages[0]);
    // the wall: crystal points and clusters pointing in at the stage, thicker and bigger where the dome meets the floor
    this.fixtures = [{ kind: 'gems', id: 'geode.wall', shape: 'dome', count: Math.min(P.caveStones, 4096), radius: P.caveRadius,
      specimens: ['quartz', 'citrine', 'amethyst', 'celestite'], seed: 4242, enabled: () => geodeParams.cave }];
    this.upload();
    onParams(P, () => this.upload());
  }

  /** how far out the cameras may stand: well inside the hollow, and (for the locked view) in front of the gates, so
   *  the stage is framed between them rather than through their crowns */
  get room() { return Math.min(7.4, geodeParams.caveRadius - 1.1); }

  async load() { /* everything it needs is made in the shaders */ }

  /** the parameters into the uniform */
  private upload() {
    const P = geodeParams;
    this.u.set({
      bgTop: [...hex(P.bgTop), 1], bgBottom: [...hex(P.bgBottom), 1], floorCol: [...hex(P.floorCol), 1], rim: [...hex(P.rim), P.rimLight],
      key: [0.3, 0.88, 0.38, P.keyLight], cave: [...hex(P.caveTint), P.caveBright], floorBand: [...hex(P.floorBand), P.floorBandAmt],
      shaftCol: [...hex(P.shaftCol), P.shaftTop], caustic: [P.caustics, P.causticCells, P.causticSpeed, P.rays], hazeCol: [...hex(P.hazeCol), P.haze],
      wall: [P.caveRadius + 0.4, P.vault, P.wallGlow, P.wallGlints], gates: this.gates,
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
    // the duel arena's drops in the agate (empty unless it is shown)
    const duel = geodeDuel(), drops = dropsUniform(duel.arena.plane, duel.arena.drops!, arenaShown(this.id));
    this.u.set({ ...this.live, drops: drops.rects, dropFrame: drops.frame });
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    if (s.phase === 'backdrop') s.pass.fullscreen(backdropShader, { label: 'geode.backdrop', enabled: s.on });
    else if (s.phase === 'opaque') {
      s.pass.draw(shelfShader, { label: 'geode.shelves', bind: { blades: this.bladeBuf }, count: 8 * 6 * 6 + 48, instances: () => (hubParams.highBlade ? this.blades.length : this.high), cull: 'none', enabled: () => s.on() && geodeParams.shelves });
      s.pass.draw(crystalShader, { label: 'geode.crystals', bind: { points: this.pointBuf }, count: 54, instances: this.points.length, cull: 'none', enabled: () => s.on() && geodeParams.shelves });
      const duel = geodeDuel(), shown = () => s.on() && arenaShown(this.id);
      s.pass.draw(shelfShader, { label: 'geode.duel.shelves', bind: { blades: this.duelBlades }, count: 8 * 6 * 6 + 48, instances: duel.bladeCount, cull: 'none', enabled: shown });
      s.pass.draw(crystalShader, { label: 'geode.duel.crystals', bind: { points: this.duelPoints }, count: 54, instances: duel.pointCount, cull: 'none', enabled: shown });
    } else if (s.phase === 'glow') {
      s.pass.draw(moteShader, { label: 'geode.motes', count: 6, instances: () => geodeParams.motes, blend: 'add', depthWrite: false, cull: 'none', enabled: s.on });
    }
  }

  /** the agate, or (the duel arena's drops) far down */
  groundAt(x: number, z: number) {
    if (arenaShown(this.id)) { const a = geodeDuel().arena; if (inDrop(a.plane, a.drops!, x, z)) return -2.4; }
    return 0;
  }
  /** the camera's clearance (World.clear): the segment against the blades and the big crystal points (a 40 cm margin) */
  clear(a: [number, number, number], b: [number, number, number]) { return clearOf(this.solids, a, b); }
  exposure() { return 1; }
  tone() { const P = geodeParams; return { water: P.water, cave: P.echo, hearth: P.hearth, depth: P.depth, forest: 0 }; }
  ambience() { return null; }
}

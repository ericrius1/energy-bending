// The Sky Forge: slabs of basalt floating in an open night sky above a deep orange glow, an aurora overhead. Its light
// is case 4 of worlds/light.wgsl (forge.wgsl). What it draws: the sky, the aurora and the cloud sea lit from below (the
// backdrop), the slabs (slabs.wgsl: hexagonal columns, the stage's and far islands'), embers rising past them (its
// glow), and the heat shimmer over what's far (laid over the scene in the air pass). No ground: fall off and the game
// catches you (groundAt says how far down that is). The anvil is the floor; two floats and the crown bob with the bass:
// `ledgeY(ledge, beat)` (worlds/stage.ts) for physics and drawing alike.
import type { Kit } from '@ericrius1/weft';
import type { Forge as ForgeU } from '../light.wgsl';
import { lightSlot, type LightSlot } from '../shared';
import backdropShader from './backdrop.wgsl';
import slabShader from './slabs.wgsl';
import emberShader from './embers.wgsl';
import type { Grade, PortalDef, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import { defineParams, hex, onParams } from '../../engine/params';
import { ledgeY, stagePlane, spawnsOf, type StagePlane } from '../stage';
import { floorAt, layoutForge, solidsOfForge, STAGE_SLABS, type ForgeLayout } from './layout';
import { clearOf, type Solid } from '../solids';
import { JOINT } from '../../skeleton/rig';
import { arenaShown } from '../../duel/arena';
import { forgeDuel } from './arena';

export const forgeParams = defineParams('forge', {
  zenith: '#020209',
  horizon: '#120818',
  fire: '#ff6a1c',
  fireLight: 1.6,
  cloud: '#2a0d08',
  aurora: '#3de0a0',
  aurora2: '#a04dff',
  auroraAmt: 0.6,
  stars: 0.9,
  stone: '#1b1715',
  gloss: 0.3,
  seam: '#ff5a10',
  seamAmt: 1.6,
  heat: 1,
  haze: 0.0004,
  embers: 900,
  /** hold the bob at a beat (for stills), or follow the music (< 0) */
  bobHold: -1,
  /** the dancers' own light, for stills (the game sets each its own) */
  firelight: 0,
  fireCol: '#ff8a3a',
}, {
  fireLight: { min: 0, max: 5, label: 'glow from below' },
  auroraAmt: { min: 0, max: 3, label: 'aurora' },
  seamAmt: { min: 0, max: 6, label: 'molten seams' },
  heat: { min: 0, max: 3, label: 'heat shimmer' },
  haze: { min: 0, max: 0.05, step: 0.001 },
  embers: { min: 0, max: 3000, step: 50 },
  bobHold: { min: -1, max: 8, step: 0.05, label: 'hold the bob (beat)' },
  firelight: { min: 0, max: 4, label: "dancers' light" },
  fire: { color: true },
  aurora: { color: true },
});

/** where the game catches a dancer who fell (m) */
const CATCH = -12;

export class Forge implements World {
  readonly id = 'forge';
  readonly light = 4;
  readonly mood = 0.8;
  /** the locked view's dim beyond the stage (World.stageDim; 9-stage.md): the frame is mostly dark, and the red-lit
   *  rock hanging behind is all that gives it depth: dimmed little */
  readonly stageDim = 0.3;
  readonly shared;
  readonly stages: StagePlane[];
  /** off the slabs a body falls; below this it has fallen out and re-forms at a spawn (before the catch floor) */
  readonly fallY = -4;
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly fixtures = [];
  readonly mirrorFloor = false;
  /** its colour (src/post/grade.ts): maroon-violet shadows, orange-gold light (docs/reports/4-worlds-hub-pool-forge.md,
   *  in the hook's terms; its vignette 0.2 and the pull of greens toward cyan are not in the hook yet) */
  readonly grade: Grade = { lift: [0.004, 0.001, 0.004], shadows: [1.04, 0.92, 1.02], highlights: [1.04, 0.96, 0.85], saturation: 1.05, contrast: 1.1 };
  readonly room = 24;
  readonly maxDist = 22;
  readonly layout: ForgeLayout;
  /** the stage's columns as simple shapes (World.solids), and with the duel arena's stones while it is shown */
  get solids(): readonly Solid[] { return arenaShown(this.id) ? this.duelSolids : this.stageSolids; }
  private stageSolids: readonly Solid[];
  private duelSolids: readonly Solid[];
  private duelBuf: ReturnType<Kit['storage']>;
  private u: LightSlot<ForgeU>;
  private buf: ReturnType<Kit['storage']>;
  private beat = 0;
  private bob = new Float32Array(STAGE_SLABS);
  private lights = new Float32Array(8 * 4);
  private glows = new Float32Array(8 * 4);
  private own: (number[] | null)[] = [];
  private live = { heat: [1, 0, 0.01, 0] as [number, number, number, number], bob: this.bob, lights: this.lights, glow: this.glows };

  constructor(ctx: WorldCtx) {
    const { kit, coarse } = ctx;
    this.layout = layoutForge({ coarse });
    this.stageSolids = solidsOfForge(this.layout);
    this.buf = kit.storage({ label: 'forge.columns', data: this.layout.columns, usage: ['storage'] });
    // the duel's floating stones (arena.ts), drawn only while its arena is shown
    const duel = forgeDuel();
    this.duelSolids = [...this.stageSolids, ...duel.arena.pieces!];
    this.duelBuf = kit.storage({ label: 'forge.duel', data: duel.columns, usage: ['storage'] });
    this.u = lightSlot(kit, 'forge');
    this.shared = {};
    if (coarse) forgeParams.embers = 400;
    this.stages = [stagePlane({
      id: 'anvil', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: null, ledges: this.layout.ledges,
      spawns: [[-2.3, 0], [2.3, 0]], lens: 20,
    })];
    this.spawns = spawnsOf(this.stages[0]);
    // one gate, back to the geode: on the anvil's lobe behind the stage's left end, facing the stage's middle exactly
    // (it faced 0.17 rad further left, and the way in from it ran 0.9 m from the left float's lowest column: the
    // camera behind a player walking in, and in front of one walking back, came in to 0.9 m for that column: 9-stage.md)
    this.portals = [{ id: 'forge.geode', at: [-5.7, 1.35, -3.5], normal: [0.852, 0, 0.523], radius: 1.25, to: { world: 'geode', portal: 'geode.forge' } }];
    this.upload();
    onParams(forgeParams, () => this.upload());
  }

  async load() { /* everything is made in the shaders */ }

  private upload() {
    const P = forgeParams;
    const k = [0.25, -0.8, 0.55], kl = Math.hypot(...k);
    this.u.set({
      zenith: [...hex(P.zenith), P.stars], horizon: [...hex(P.horizon), 0], fire: [...hex(P.fire), P.fireLight], cloud: [...hex(P.cloud), -70],
      aurora: [...hex(P.aurora), P.auroraAmt], aurora2: [...hex(P.aurora2), 90], key: [k[0] / kl, k[1] / kl, k[2] / kl, 0],
      seam: [...hex(P.seam), P.seamAmt], stone: [...hex(P.stone), P.gloss],
    });
  }

  /** a dancer's own light (colour × strength, null for the panel's): it warms the basalt round it */
  dancerLight(d: number, rgb: [number, number, number] | null) { this.own[d] = rgb; }

  update(f: FrameCtx) {
    const P = forgeParams;
    this.beat = P.bobHold >= 0 ? P.bobHold : f.beat.beats;
    // each stage slab's lift now: its ledge's height at this beat over where it's laid
    this.layout.slabs.slice(0, STAGE_SLABS).forEach((s, i) => { this.bob[i] = s.ledge ? ledgeY(s.ledge, this.beat) - s.ledge.y : 0; });
    const v = this.live;
    v.heat[0] = P.heat; v.heat[1] = f.t; v.heat[2] = P.haze;
    const D = Math.min(8, f.dancers.length), fc = hex(P.fireCol);
    for (let d = 0; d < D; d++) {
      const w = f.dancers[d].skeleton.world, o = JOINT.Spine1 * 12;
      this.lights.set([w[o], w[o + 1], w[o + 2], 0], d * 4);
      const g = this.own[d] ?? [fc[0] * P.firelight, fc[1] * P.firelight, fc[2] * P.firelight];
      this.glows.set([g[0], g[1], g[2], 0], d * 4);
    }
    v.heat[3] = D;
    this.u.set(v);
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    const { pass, on } = s, L = this.layout;
    if (s.phase === 'backdrop') pass.fullscreen(backdropShader, { label: 'forge.backdrop', enabled: on });
    else if (s.phase === 'opaque') {
      pass.draw(slabShader, { label: 'forge.slabs', bind: { columns: this.buf }, count: 108, instances: L.stageColumns, constants: { FIRST: 0 }, cull: 'none', enabled: on });
      pass.draw(slabShader, { label: 'forge.islands', bind: { columns: this.buf }, count: 108, instances: L.count - L.stageColumns, constants: { FIRST: L.stageColumns }, cull: 'none', enabled: on });
      pass.draw(slabShader, { label: 'forge.duel', bind: { columns: this.duelBuf }, count: 108, instances: forgeDuel().count, constants: { FIRST: 0 }, cull: 'none', enabled: () => on() && arenaShown(this.id) });
    } else {
      pass.draw(emberShader, { label: 'forge.embers', count: 6, instances: () => forgeParams.embers, blend: 'add', depthWrite: false, cull: 'none', enabled: on });
    }
  }

  /** the camera's clearance (World.clear): the segment against the stage's columns (a 40 cm margin) */
  clear(a: [number, number, number], b: [number, number, number]) { return clearOf(this.solids, a, b); }
  /** the top of the slab under (x, z) (the bobbing ones where they are now), or far below where the game catches you */
  groundAt(x: number, z: number) {
    return floorAt(this.layout, x, z, (s, top) => (s.ledge ? ledgeY(s.ledge, this.beat) : top), CATCH);
  }
  exposure() { return 1.0; }
  tone() { return { water: 14000, cave: 0.15, hearth: 0.9, depth: 0.8, forest: 0 }; }
  ambience() { return null; }
}

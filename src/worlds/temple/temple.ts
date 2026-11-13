// The Tide Temple: a drowned stone court at dusk under a large moon. Its light is case 3 of worlds/light.wgsl
// (temple.wgsl). What it draws: the sky (the moon with its corona and a thin cloud across it), the flagstones and the
// sea bed (the backdrop), the stones (stones.wgsl: the altar, the broken pillars, the lintel, the gate, the colonnades,
// the walls, the fallen columns, and the drowned court going on out in the sea), and the water over all of it, laid over
// the scene in the air pass with the pool's water code, ripples and all, the moon's glitter path on it. The sea comes in over the court and goes out
// again over eight bars of the music: `tideY(beat)` is its height, for physics and drawing alike.
//
// Stage: the plane z = STAGE_Z (behind the middle) seen from the front (+z), the moon behind it in the gate. Ledges: two broken pillars, the
// altar, a lintel on two columns standing just behind the stage (all solid but the lintel). layout.ts builds the
// ledges and the stones that make them from one description.
import type { Kit } from '@ericrius1/weft';
import type { Temple as TempleU } from '../light.wgsl';
import { lightSlot, type LightSlot } from '../shared';
import backdropShader from './backdrop.wgsl';
import stoneShader from './stones.wgsl';
import type { Grade, PortalDef, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import { defineParams, hex, onParams } from '../../engine/params';
import { Ripples } from '../water/ripples';
import { stagePlane, spawnsOf, type StagePlane } from '../stage';
import { layoutTemple, packStones, STAGE_Z, type TempleLayout } from './layout';
import { JOINT } from '../../skeleton/rig';

export const templeParams = defineParams('temple', {
  /** the tide: its lowest and highest (m over the floor), and over how many bars it comes in and goes out */
  tideLow: -0.02,
  tideHigh: 0.45,
  tideBars: 8,
  /** hold the tide at a point of its cycle (0 low … 0.5 high … 1 low), or follow the music (< 0) */
  tideHold: -1,
  zenith: '#060b22',
  horizon: '#141a2e',
  dusk: '#ffa36b',
  duskAmt: 0.45,
  moonCol: '#c4d2f4',
  moonLight: 1.0,
  /** the moon's size (degrees across) and height over the sea (degrees) */
  moonSize: 3.6,
  moonHeight: 8,
  stars: 0.8,
  stone: '#a29e94',
  wetGloss: 1,
  /** the afterglow's low light on the stones' fronts (it rakes the carving) */
  afterglow: 0.16,
  /** the moonlit sky's cool fill on the stone */
  skyFill: 0.05,
  /** how quickly the stone dries once the tide has left it (per cycle of the tide) */
  dry: 4,
  /** the moon's path on the water: how bright, how wide (the facets' slope), how fine its sparkle (per m) */
  glitter: 1.2,
  glitterWidth: 0.11,
  sparkle: 7,
  /** the thin cloud across the moon (how thick) */
  veil: 0.75,
  sea: '#06141c',
  depthDim: 1.2,
  mirror: 0.05,
  ripples: 1,
  wind: 0.06,
  haze: 0.013,
  /** how far the dancers' own light reaches (m), and a light for every dancer (for stills; the game sets each its own) */
  fireReach: 6,
  firelight: 0,
  fireCol: '#ff8a3a',
  waveSpeed: 1.1,
  waveFade: 0.5,
  feet: 0.0011,
}, {
  tideHold: { min: -1, max: 1, step: 0.01, label: 'hold the tide' },
  tideHigh: { min: 0, max: 1 },
  duskAmt: { min: 0, max: 2, label: 'afterglow' },
  moonLight: { min: 0, max: 4 },
  moonSize: { min: 0.5, max: 12 },
  moonHeight: { min: 1, max: 40 },
  firelight: { min: 0, max: 4, label: "dancers' light" },
  afterglow: { min: 0, max: 2 },
  glitter: { min: 0, max: 4 },
  veil: { min: 0, max: 1 },
  wind: { min: 0, max: 0.2, step: 0.005 },
  haze: { min: 0, max: 0.05, step: 0.001 },
  stone: { color: true },
  dusk: { color: true },
});

/** the tide's height over the floor at a beat (FrameCtx.beat.beats): low, in over `tideBars` bars of four, out again */
export function tideY(beat: number, P = templeParams) {
  const k = P.tideHold >= 0 ? P.tideHold : beat / (P.tideBars * 4);
  return P.tideLow + (P.tideHigh - P.tideLow) * (0.5 - 0.5 * Math.cos(k * Math.PI * 2));
}

export class Temple implements World {
  readonly id = 'temple';
  readonly light = 3;
  readonly mood = 0.1;
  readonly shared;
  readonly stages: StagePlane[];
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly fixtures = [];
  readonly mirrorFloor = false;
  /** its colour (src/post/grade.ts): cool teal-blue shadows, warm highlights, a little less saturation so the stone
   *  stays stone (docs/reports/4-worlds-redwoods-temple.md; its vignette 0.3 is not per world yet) */
  readonly grade: Grade = { lift: [0, 0.006, 0.016], gamma: [1.0, 1.0, 1.02], gain: [1.03, 1.0, 0.95], saturation: 0.92, contrast: 1.1 };
  readonly room = 16;
  readonly maxDist = 18;
  readonly layout: TempleLayout;
  /** the tide now (m over the floor), as last set by update */
  tide = 0;
  private u: LightSlot<TempleU>;
  private waves: Ripples;
  private seen = -1;
  private packed: ReturnType<typeof packStones>;
  private buf: ReturnType<Kit['storage']>;
  private lights = new Float32Array(8 * 4);
  private glows = new Float32Array(8 * 4);
  private own: (number[] | null)[] = [];
  /** steps the reflection is marched in, how far, the haze, the pillars that throw shadows */
  private march: [number, number, number, number] = [22, 16, 0, 0];
  private live = {
    water: [0, 0, 1, 0] as [number, number, number, number], waves: [0, 0, 1, 1] as [number, number, number, number],
    fire: [6, 0, 0, 0.5] as [number, number, number, number],       lights: this.lights, glow: this.glows, tide: [0, 0, 0, 0] as [number, number, number, number],
  };

  constructor(private ctx: WorldCtx) {
    const { kit, frame, coarse } = ctx;
    this.layout = layoutTemple({ coarse });
    this.packed = packStones(this.layout.stones);
    this.buf = kit.storage({ label: 'temple.stones', data: this.packed.data, usage: ['storage'] });
    this.u = lightSlot(kit, 'temple');
    this.waves = new Ripples(kit, frame, {
      label: 'temple', cells: coarse ? 160 : 288, cell: coarse ? 0.09 : 0.055,
      speed: templeParams.waveSpeed, fade: templeParams.waveFade, feet: templeParams.feet,
      enabled: () => this.seen === kit.frameIndex,
    });
    this.shared = { templeWaves: this.waves.tex };
    const L = this.layout.ledges;
    this.stages = [stagePlane({
      id: 'court', origin: [0, 0, STAGE_Z], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: L,
      spawns: [[-4.2, L[0].y], [4.3, L[2].y]], lens: 19,
    })];
    this.spawns = spawnsOf(this.stages[0]);
    // one gate, back to the geode: on the court to the left of the stage, facing across it, the flagstones clear round it
    this.portals = [{ id: 'temple.geode', at: [-7.6, 1.4, 5.4], normal: [0.8, 0, -0.6], radius: 1.3, to: { world: 'geode', portal: 'geode.temple' } }];
    const cols = new Float32Array(24 * 4);
    // the pillars nearest the middle first (the loop over them stops at 24)
    [...this.layout.pillars].sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1])).slice(0, 24).forEach((c, i) => cols.set(c, i * 4));
    this.u.set({ cols });
    this.march = [coarse ? 12 : 22, 16, 0, Math.min(24, this.layout.pillars.length)];
    this.upload();
    onParams(templeParams, () => this.upload());
  }

  async load() { /* everything is made in the shaders */ }

  private upload() {
    const P = templeParams;
    const el = (P.moonHeight * Math.PI) / 180, az = 0.05;
    this.u.set({
      zenith: [...hex(P.zenith), P.stars], horizon: [...hex(P.horizon), 0], dusk: [...hex(P.dusk), P.duskAmt], duskDir: [0, 0, 1, 2.2],
      moon: [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el), (P.moonSize * Math.PI) / 360],
      moonCol: [...hex(P.moonCol), P.moonLight], sea: [...hex(P.sea), P.depthDim], stone: [...hex(P.stone), P.wetGloss],
      glitter: [P.glitter, P.glitterWidth, P.sparkle, P.veil], tide2: [P.afterglow, P.skyFill, 0, 0],
    });
    this.march[2] = P.haze;
    this.u.set({ march: this.march });
  }

  /** a dancer's own light (colour × strength, null to give it back to the panel's): it warms the stone round it */
  dancerLight(d: number, rgb: [number, number, number] | null) { this.own[d] = rgb; }

  /** a push on the water: a landing, matter falling in */
  ripple(x: number, z: number, strength: number, radius: number) { this.waves.ripple(x, z, strength, radius); }

  update(f: FrameCtx, c: { x: number; z: number }) {
    const P = templeParams;
    this.seen = f.kit.frameIndex;
    this.tide = tideY(f.beat.beats);
    this.waves.update(f, c.x, c.z, this.tide);
    const v = this.live;
    v.water[0] = this.tide; v.water[1] = P.mirror; v.water[2] = P.ripples; v.water[3] = P.wind;
    v.waves = this.waves.window();
    const D = Math.min(8, f.dancers.length), fc = hex(P.fireCol);
    for (let d = 0; d < D; d++) {
      const w = f.dancers[d].skeleton.world, o = JOINT.Spine1 * 12;
      this.lights.set([w[o], w[o + 1], w[o + 2], 0], d * 4);
      const g = this.own[d] ?? [fc[0] * P.firelight, fc[1] * P.firelight, fc[2] * P.firelight];
      this.glows.set([g[0], g[1], g[2], 0], d * 4);
    }
    v.fire[0] = P.fireReach; v.fire[1] = f.t; v.fire[2] = D; v.fire[3] = P.tideHigh + 0.04;
    // where the tide's cycle is (for how long the stone above the water has been drying)
    const ph = P.tideHold >= 0 ? P.tideHold : f.beat.beats / (P.tideBars * 4);
    v.tide[0] = P.tideLow; v.tide[1] = P.tideHigh; v.tide[2] = ph - Math.floor(ph); v.tide[3] = P.dry;
    this.u.set(v);
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    const { pass, on } = s, coarse = this.ctx.coarse, k = this.packed;
    if (s.phase === 'backdrop') {
      pass.fullscreen(backdropShader, { label: 'temple.backdrop', enabled: on });
    } else if (s.phase === 'opaque') {
      const N = 4;
      pass.draw(stoneShader, { label: 'temple.blocks', vertex: 'vs_block', bind: { stones: this.buf }, count: 6 * N * N * 6, instances: k.blocks, constants: { FIRST: 0, N }, cull: 'none', enabled: on });
      // the court's drums with their flutes in the mesh (six sides a flute; a phone has them in the light only), the far
      // ones out in the sea in less
      const SIDES = coarse ? 40 : 120, RINGS = coarse ? 6 : 10, CAPR = coarse ? 3 : 4;
      pass.draw(stoneShader, {
        label: 'temple.drums', vertex: 'vs_drum', bind: { stones: this.buf }, count: SIDES * (RINGS - 1 + CAPR * 2) * 6, instances: k.drums,
        constants: { FIRST: k.blocks, SIDES, RINGS, CAPR }, cull: 'none', enabled: on,
      });
      pass.draw(stoneShader, {
        label: 'temple.drums.far', vertex: 'vs_drum', bind: { stones: this.buf }, count: 32 * (6 - 1 + 2 * 2) * 6, instances: k.farDrums,
        constants: { FIRST: k.blocks + k.drums, SIDES: 32, RINGS: 6, CAPR: 2 }, cull: 'none', enabled: on,
      });
    }
  }

  /** the floor, or the top of a solid stone standing there (the altar, a stump) */
  /** the tide (fire's mirror copy reflects about it) */
  waterY() { return this.tide; }
  groundAt(x: number, z: number) {
    for (const [x0, x1, z0, z1, top] of this.layout.tops) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return top;
    return 0;
  }
  exposure() { return 1.1; }
  tone() { return { water: 7000, cave: 0.45, hearth: 0.15, depth: 0.55, forest: 0 }; }
  ambience() { return null; }
}

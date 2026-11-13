// The redwoods: a clearing in a fairy ring of coast redwoods, the day going by (Gem Dancers' second scene). Its light
// is case 1 of worlds/light.wgsl: the sun or the moon through the leaves and past the trunks, the soft light under
// the trees, the lanterns. What it draws: the forest floor and the sky (the backdrop), the trunks and limbs, the
// limbs' sprays, ferns, grass (pushed aside by the dancers' feet), flowers and spires, the lanterns and their cords;
// pollen in the light, the lanterns' halos, dust kicked up by a landing and, after dark, fireflies that gather round
// the dancers (its glows).
//
// Stage: a plane through the clearing aimed at the biggest tree of the ring, with a fallen giant lying along it on the
// left and two boughs from that tree reaching in along it, low and high (stage.ts: the ledges and the logs that make
// them, from one description, in the trunks' bark; ferns and shelf fungus growing on them). Its gate back to the geode
// stands between two trees of the ring on the camera's side, out of the locked view, a worn path leading from it.
import type { Kit, Texture } from '@ericrius1/weft';
import type { Forest } from '../light.wgsl';
import { lightSlot, type LightSlot } from '../shared';
import woodsShader from './woods.wgsl';
import trunkShader from './trunks.wgsl';
import grassShader from './grass.wgsl';
import flowerShader from './flowers.wgsl';
import fernShader from './ferns.wgsl';
import lanternShader from './lanterns.wgsl';
import pollenShader from './pollen.wgsl';
import type { Grade, PortalDef, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import type { StagePlane } from '../../engine/camera';
import { Woods } from './day';
import { fillTexture } from './textures';
import { defineParams } from '../../engine/params';
import { layoutStage, packPieces, type RedwoodsStage } from './stage';
import { stagePlane, spawnsOf, toPlane } from '../stage';
import { JOINT } from '../../skeleton/rig';

export const redwoodsParams = defineParams('redwoods', {
  /** the time of day (hours), and whether it goes by on its own (a whole day and night in dayMinutes) */
  hour: 8.2,
  dayGoes: true,
  dayMinutes: 8,
  sunlight: 1,
  godRays: 1,
  mist: 1,
  lanterns: 1,
  fireflies: 1,
  grassHeight: 1,
  flowerSize: 1,
  wind: 0.6,
  /** the rim light on matter (the light under the trees) */
  rim: 0.9,
  moteSize: 0.008,
}, {
  hour: { min: 0, max: 24, step: 0.05, label: 'time of day' },
  dayGoes: { label: 'the day goes by' },
  sunlight: { min: 0, max: 3 },
  mist: { min: 0, max: 3 },
  wind: { min: 0, max: 2 },
});

/** never out past the ring of trees */
const ROOM = 9.6;

const smooth = (e0: number, e1: number, x: number) => { const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

export class Redwoods implements World {
  readonly id = 'redwoods';
  readonly light = 1;
  readonly mood = 0.3;
  readonly shared: Record<string, Texture>;
  readonly stages: StagePlane[];
  readonly portals: PortalDef[];
  readonly spawns: [number, number, number][];
  readonly stage: RedwoodsStage;
  readonly fixtures = [];
  readonly mirrorFloor = false;
  /** its colour (src/post/grade.ts): warm, slightly lifted shadows (the mist's glow), highlights held back from yellow
   *  (docs/reports/4-worlds-redwoods-temple.md; its vignette 0.25 and the night's variant are not in the hook yet) */
  readonly grade: Grade = { lift: [0.010, 0.006, 0.004], gamma: [1.0, 0.98, 0.96], gain: [1.02, 1.0, 0.96], saturation: 1.05, contrast: 1.06 };
  readonly room = ROOM;
  readonly maxDist = ROOM;
  readonly woods: Woods;
  private forest: LightSlot<Forest>;
  private tex: { bark: Texture; barkH: Texture; ground: Texture };
  private loading: Promise<void> | null = null;
  private q: { grass: number; blades: number; flowers: number; spires: number; ferns: number; fronds: number; trunks: number; steps: number; flies: number };

  constructor(private ctx: WorldCtx) {
    const { kit, coarse, film } = ctx;
    // less detail on a phone: grass (tufts along the grid's side, blades a tuft), flowers and spires, fern rosettes
    // and fronds, the trunks the light is tested against, the steps through the air, fireflies (a film tests more
    // trunks and marches the air finer)
    this.q = coarse
      ? { grass: 120, blades: 6, flowers: 84, spires: 26, ferns: 24, fronds: 10, trunks: 9, steps: 10, flies: 140 }
      : { grass: 210, blades: 10, flowers: 150, spires: 44, ferns: 34, fronds: 14, trunks: film ? 24 : 13, steps: film ? 26 : 15, flies: 320 };
    this.woods = new Woods(this.q.trunks);
    this.woods.values.march[0] = this.q.steps;
    // the stage: the log and the boughs, and the plane they're ledges on (the camera stands on the clearing's side)
    this.stage = layoutStage(this.woods.layout.trunks);
    this.woods.values.stageLog = [...this.stage.log];
    this.woods.values.stagePlate = [...this.stage.plate];
    this.stages = [stagePlane({
      id: 'clearing', origin: [0, 0, 0], right: this.stage.right, halfWidth: 5.75, ground: 0, ledges: this.stage.ledges,
      spawns: [[-1.2, 0], [1.2, 0]], lens: 22,
    })];
    this.spawns = spawnsOf(this.stages[0]);
    // one gate, back to the geode: in the open meadow behind the stage's left end, clear of the log and the trees' feet
    // one gate, back to the geode: between two trees of the ring on the camera's side of the stage (out of the locked
    // view, which looks the other way), facing the clearing, a path worn from it into the meadow
    const gate: [number, number, number] = [-10.03, 1.35, 5.23], gn: [number, number, number] = [0.885, 0, -0.466];
    this.portals = [{ id: 'redwoods.geode', at: gate, normal: gn, radius: 1.3, to: { world: 'geode', portal: 'geode.redwoods' } }];
    this.woods.values.gate = [gate[0] + gn[0] * 0.2, gate[2] + gn[2] * 0.2, gate[0] + gn[0] * 7.5, gate[2] + gn[2] * 7.5];
    this.forest = lightSlot(kit, 'forest');
    this.forest.set(this.woods.values);
    this.shared = {};
    const t = (label: string, srgb: boolean) => kit.texture({ label, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', size: [1024, 1024], mips: 'full', usage: ['sample', 'copy-dst'] });
    this.tex = { bark: t('redwoods.bark', true), barkH: t('redwoods.bark.height', false), ground: t('redwoods.ground', true) };
  }

  load(ctx: WorldCtx) {
    const at = `${ctx.base}worlds/redwoods/`;
    return (this.loading ??= Promise.all([
      fillTexture(this.tex.bark, `${at}bark.jpg`), fillTexture(this.tex.barkH, `${at}bark-h.jpg`, true), fillTexture(this.tex.ground, `${at}ground.jpg`),
    ]).then(() => {}));
  }

  update(f: FrameCtx) {
    const P = redwoodsParams;
    // (a film moves the hour itself)
    if (P.dayGoes && !this.ctx.film) P.hour = (P.hour + (f.dt * 24) / (P.dayMinutes * 60)) % 24;
    this.woods.update(f.danceDt, P);
    this.watch(f);
    this.forest.set(this.woods.values);
  }

  /** the dancers here, for the fireflies to gather round, and their landings, for the dust they kick up: a landing is
   *  the hips coming down fast and stopping with a foot on the ground (or on the log) */
  private was: { y: number; vy: number }[] = [];
  private watch(f: FrameCtx) {
    const v = this.woods.values, dt = f.danceDt;
    let n = 0;
    for (let d = 0; d < f.dancers.length && n < 4; d++) {
      const dn = f.dancers[d];
      if (dn.world && dn.world !== this.id) continue;
      const w = dn.skeleton.world, c = JOINT.Spine1 * 12;
      v.dancers.set([w[c], w[c + 1], w[c + 2], dn.presence], n * 4);
      const hy = w[JOINT.Hips * 12 + 1];
      const lf = JOINT.LeftFoot * 12, rf = JOINT.RightFoot * 12;
      const fx = (w[lf] + w[rf]) / 2, fz = (w[lf + 2] + w[rf + 2]) / 2, fy = Math.min(w[lf + 1], w[rf + 1]);
      const was = (this.was[n] ??= { y: hy, vy: 0 });
      if (dt > 0) {
        const vy = (hy - was.y) / dt;
        const floor = this.groundAt(fx, fz);
        if (was.vy < -1.6 && vy > -0.4 && fy < floor + 0.25) v.kicks.set([fx, floor, fz, v.clock[0]], n * 4);
        was.vy = vy;
      }
      was.y = hy;
      n++;
    }
    v.near[3] = n;
  }

  declareScene(s: ScenePass) {
    if (s.world !== this) return;
    const { pass, on } = s, L = this.woods.layout, q = this.q, logs = this.logs();
    if (s.phase === 'backdrop') {
      pass.fullscreen(woodsShader, { label: 'redwoods.ground', bind: { groundTex: this.tex.ground }, enabled: on });
    } else if (s.phase === 'opaque') {
      pass.draw(trunkShader, {
        label: 'redwoods.trunks', bind: { logs, barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 47 * 44 * 6, instances: L.near,
        constants: { SIDES: 44, RINGS: 48, FIRST: 0 }, enabled: on,
      });
      // the stage's logs: the fallen giant, its root plate and roots in detail (its hollow end needs the rings), then the
      // boughs' many short pieces in less
      const st = this.stage, big = st.big, boughs = st.pieces.length - big;
      pass.draw(trunkShader, {
        label: 'redwoods.stage', vertex: 'vs_stage', fragment: 'fs_stage', bind: { stage: this.pieces(), barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 28 * (14 + 6 * 2 - 1) * 6,
        instances: big, constants: { SIDES: 28, RINGS: 14, CAPR: 6, SFIRST: 0 }, cull: 'none', enabled: on,
      });
      pass.draw(trunkShader, {
        label: 'redwoods.boughs', vertex: 'vs_stage', fragment: 'fs_stage', bind: { stage: this.pieces(), barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 20 * (2 + 2 * 2 - 1) * 6,
        instances: boughs, constants: { SIDES: 20, RINGS: 2, CAPR: 2, SFIRST: big }, cull: 'none', enabled: on,
      });
      // what grows on them: ferns and shelf fungus down the log's flanks, ferns along the boughs
      pass.draw(fernShader, {
        label: 'redwoods.epiphytes.log', vertex: 'vs_epi', bind: { stage: this.pieces() }, count: 60, instances: 2 * (q.ferns > 30 ? 18 : 10),
        constants: { EFIRST: 0, PER: q.ferns > 30 ? 18 : 10 }, cull: 'none', enabled: on,
      });
      pass.draw(fernShader, {
        label: 'redwoods.epiphytes.boughs', vertex: 'vs_epi', bind: { stage: this.pieces() }, count: 60, instances: boughs * 2,
        constants: { EFIRST: big, PER: 2 }, cull: 'none', enabled: on,
      });
      pass.draw(trunkShader, {
        label: 'redwoods.trunks.far', bind: { logs, barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 19 * 16 * 6, instances: L.far + L.limbs,
        constants: { SIDES: 16, RINGS: 20, FIRST: L.near }, enabled: on,
      });
      pass.draw(fernShader, {
        label: 'redwoods.sprays', vertex: 'vs_spray', fragment: 'fs_spray', bind: { logs }, count: 12, instances: (L.limbs + 9 * 2) * 28,
        constants: { LIMB0: L.near + L.far, LIMBS: L.limbs, SPRAYS: 28 }, cull: 'none', enabled: on,
      });
      pass.draw(fernShader, {
        label: 'redwoods.ferns', count: 36 + 16 * 12, instances: q.ferns * q.ferns * q.fronds,
        constants: { FRONDS: q.fronds, GRID: q.ferns }, cull: 'none', enabled: on,
      });
      pass.draw(grassShader, {
        label: 'redwoods.grass', topology: 'triangle-strip', count: 11, instances: q.grass * q.grass * q.blades,
        constants: { BLADES: q.blades, GRID: q.grass }, cull: 'none', enabled: on,
      });
      pass.draw(flowerShader, { label: 'redwoods.flowers', count: 174, instances: q.flowers * q.flowers, constants: { GRID: q.flowers }, cull: 'none', enabled: on });
      pass.draw(flowerShader, { label: 'redwoods.spires', vertex: 'vs_spire', count: 288, instances: q.spires * q.spires, constants: { SPIRES: q.spires }, cull: 'none', enabled: on });
      pass.draw(lanternShader, { label: 'redwoods.lanterns', count: 24 * (2 + 9 * 4 + 2) * 6, instances: L.lanterns.length, constants: { AROUND: 24, HOOPS: 9, BAY: 4 }, cull: 'none', enabled: on });
      pass.draw(lanternShader, { label: 'redwoods.cords', vertex: 'vs_cord', fragment: 'fs_cord', count: 6, instances: L.lanterns.length, cull: 'none', enabled: on });
    } else {
      pass.draw(pollenShader, { label: 'redwoods.pollen', count: 6, instances: () => (this.ctx.coarse ? 700 : 1400), blend: 'add', depthWrite: false, cull: 'none', enabled: on });
      pass.draw(pollenShader, { label: 'redwoods.kicks', vertex: 'vs_kick', count: 6, instances: 4 * 40, constants: { KICK: 40 }, blend: 'add', depthWrite: false, cull: 'none', enabled: on });
      // each lit lantern's halo in the mist
      pass.draw(lanternShader, {
        label: 'redwoods.halos', vertex: 'vs_halo', fragment: 'fs_halo', count: 6, instances: L.lanterns.length, blend: 'add', depthWrite: false, cull: 'none',
        enabled: () => on() && redwoodsParams.lanterns > 0,
      });
      // fireflies, once it's dark
      pass.draw(lanternShader, {
        label: 'redwoods.fireflies', vertex: 'vs_fly', fragment: 'fs_fly', count: 6, instances: () => Math.round(q.flies * redwoodsParams.fireflies),
        blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && this.woods.values.night > 0.01,
      });
    }
  }

  private logsBuf: ReturnType<Kit['storage']> | null = null;
  private logs() { return (this.logsBuf ??= this.ctx.kit.storage({ label: 'redwoods.logs', data: this.woods.layout.logs, usage: ['storage'] })); }
  private piecesBuf: ReturnType<Kit['storage']> | null = null;
  private pieces() { return (this.piecesBuf ??= this.ctx.kit.storage({ label: 'redwoods.stage', data: packPieces(this.stage.pieces), usage: ['storage'] })); }

  /** the meadow, or the fallen log's top where it lies */
  /** the camera's clearance (World.clear): the segment against the nearest trunks as upright cylinders (a 40 cm margin) */
  clear(a: [number, number, number], b: [number, number, number]) {
    const T = this.woods.layout.trunks, dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz;
    let best = 1;
    if (L2 < 1e-6) return best;
    for (let i = 0; i + 3 < T.length && i < 4 * 24; i += 4) {
      const x = T[i], z = T[i + 1], R = T[i + 2] + 0.4;
      if (R <= 0.4) continue;
      // where the segment first comes within R of the trunk's axis (a quadratic in t along it)
      const fx = a[0] - x, fz = a[2] - z, B = fx * dx + fz * dz, C = fx * fx + fz * fz - R * R;
      if (C <= 0) return 0;
      const disc = B * B - L2 * C;
      if (disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / L2;
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
  groundAt(x: number, z: number) {
    const [px, , across] = toPlane(this.stages[0], [x, 0, z]);
    const log = this.stage.ledges[0], R = this.stage.plate[0], cy = log.y - R;
    if (px >= log.x0 && px <= log.x1 && Math.abs(across) < R) return Math.max(0, cy + Math.sqrt(R * R - across * across));
    return 0;
  }
  exposure() { return this.woods.expo; }
  tone() { return { water: 16000, cave: 0.1, hearth: 0, depth: 0.45, forest: 1 }; }
  ambience(): [number, number, number, number] | null {
    const el = this.woods.sunEl;
    return [smooth(-4, 6, el), smooth(2, -8, el), smooth(-7, 1, el) * smooth(16, 5, el), redwoodsParams.wind];
  }
}

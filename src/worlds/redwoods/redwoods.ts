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
import { layoutStage, liftLanterns, packPieces, solidsOfStage, type RedwoodsStage } from './stage';
import { solidsOfWoods } from './layout';
import { arenaShown, dropsUniform, inDrop, onArena } from '../../duel/arena';
import { redwoodsDuel } from './arena';
import { clearOf, type Solid } from '../solids';
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
  /** the locked view's dim beyond the stage (World.stageDim; 9-stage.md): the most of any world, for the contrast a
   *  water dancer's pale head and shoulders lack against the bright fog behind */
  readonly stageDim = 0.75;
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
  /** the trees, the fallen log and the boughs as simple shapes for the camera (World.solids), from their layouts; with
   *  the duel arena's wood (and its lanterns hung higher) while it is shown */
  get solids(): readonly Solid[] { return arenaShown(this.id) ? this.duelSolids : this.stageSolids; }
  private stageSolids: readonly Solid[];
  private duelSolids: readonly Solid[];
  private duelBuf: ReturnType<Kit['storage']> | null = null;
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
    // (none hangs low between the stage and the locked camera)
    liftLanterns(this.woods.layout.lanterns, this.stage.right);
    this.woods.values.stageLog = [...this.stage.log];
    this.woods.values.stagePlate = [...this.stage.plate];
    this.stageSolids = [...solidsOfStage(this.stage.pieces), ...solidsOfWoods(this.woods.layout)];
    // the duel arena (arena.ts): its pieces, and the lanterns over its space hung as high on their limbs as they go (a
    // lantern at head height in the middle of it is in every jump's way); back again when it is hidden
    const lanterns = this.woods.layout.lanterns, cords = lanterns.map((l) => l.cord), space = redwoodsDuel().arena.space;
    const lift = (on: boolean) => lanterns.forEach((l, k) => {
      const inside = Math.hypot(l.anchor[0] - space.center[0], l.anchor[2] - space.center[2]) < space.radius + 1;
      l.cord = on && inside ? Math.min(cords[k], Math.max(0.6, l.anchor[1] - space.yTop)) : cords[k];
    });
    lift(true);
    this.duelSolids = [...solidsOfStage(this.stage.pieces), ...solidsOfWoods(this.woods.layout), ...redwoodsDuel().arena.pieces!];
    lift(false);
    onArena((w) => lift(w === this.id));
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
    // the duel arena's drops in the meadow (empty unless it is shown)
    const duel = redwoodsDuel(), drops = dropsUniform(duel.arena.plane, duel.arena.drops!, arenaShown(this.id));
    this.forest.set({ ...this.woods.values, drops: drops.rects, dropFrame: drops.frame });
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
        label: 'redwoods.stage', vertex: 'vs_stage', fragment: 'fs_stage', bind: { stage: this.pieces(), barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 48 * (14 + 14 * 2 - 1) * 6,
        instances: big, constants: { SIDES: 48, RINGS: 14, CAPR: 14, SFIRST: 0 }, cull: 'none', enabled: on,
      });
      pass.draw(trunkShader, {
        label: 'redwoods.boughs', vertex: 'vs_stage', fragment: 'fs_stage', bind: { stage: this.pieces(), barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 20 * (2 + 2 * 2 - 1) * 6,
        instances: boughs, constants: { SIDES: 20, RINGS: 2, CAPR: 2, SFIRST: big }, cull: 'none', enabled: on,
      });
      // the duel arena's wood (arena.ts), as the stage's: its stumps and log in detail, its boughs in less
      const duel = redwoodsDuel(), shown = () => on() && arenaShown(this.id), dbuf = (this.duelBuf ??= this.ctx.kit.storage({ label: 'redwoods.duel', data: duel.pieces, usage: ['storage'] }));
      pass.draw(trunkShader, {
        label: 'redwoods.duel.big', vertex: 'vs_stage', fragment: 'fs_stage', bind: { stage: dbuf, barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 48 * (14 + 14 * 2 - 1) * 6,
        instances: duel.big, constants: { SIDES: 48, RINGS: 14, CAPR: 14, SFIRST: 0 }, cull: 'none', enabled: shown,
      });
      pass.draw(trunkShader, {
        label: 'redwoods.duel.boughs', vertex: 'vs_stage', fragment: 'fs_stage', bind: { stage: dbuf, barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 20 * (2 + 2 * 2 - 1) * 6,
        instances: duel.count - duel.big, constants: { SIDES: 20, RINGS: 2, CAPR: 2, SFIRST: duel.big }, cull: 'none', enabled: shown,
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

  /** the camera's clearance (World.clear): the segment against the trunks, the limbs, the fallen log and the boughs
   *  (a 40 cm margin) */
  clear(a: [number, number, number], b: [number, number, number]) { return clearOf(this.solids, a, b); }
  /** the meadow, or the fallen log's top where it lies */
  groundAt(x: number, z: number) {
    // (the duel arena's drops fall away, past its kill floor)
    if (arenaShown(this.id)) { const a = redwoodsDuel().arena; if (inDrop(a.plane, a.drops!, x, z)) return -2.6; }
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

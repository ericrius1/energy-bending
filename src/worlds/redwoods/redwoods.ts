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
import gardenShader from './garden.wgsl';
import arbourShader from './arbour.wgsl';
import canopyShader from './canopy.wgsl';
import { layoutCanopy, layoutRoots, type Canopy } from './canopy';
import { MIRROR_SITES } from '../../portals/mirrors';
import { layoutArbour, type Arbour } from './arbour';
import { layoutGarden } from './garden';
import { gustNow } from '../../duel/hazards';
import type { Grade, PortalDef, World, WorldCtx } from '../world';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import type { StagePlane } from '../../engine/camera';
import { Woods } from './day';
import { fillTexture } from './textures';
import { defineParams } from '../../engine/params';
import { layoutStage, liftLanterns, packPieces, solidsOfStage, type RedwoodsStage } from './stage';
import { solidsOfWoods, RING } from './layout';
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
  godRays: 1.3,
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
/** a duel's light (phase 5): from golden hour (the sun 8° up) to the blue of dusk (2° under), an hour every DUSK_S s */
const DUSK: [number, number] = [18.5, 19.5];
const DUSK_S = 80;

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
  /** what hangs in the clearing (garden.ts): the strings between the ring's trees, then the duel's boughs' pennants */
  private garden: ReturnType<typeof layoutGarden>;
  private gardenBuf: ReturnType<Kit['storage']> | null = null;
  /** the arbour round the ring, its pods and the fungi (arbour.ts, phase 5) */
  private arbour: Arbour;
  private arbourBufs: { arches: ReturnType<Kit['storage']>; pods: ReturnType<Kit['storage']> } | null = null;
  /** the wood's living architecture (canopy.ts, phase 6): decks, houses, bridges, stairs and their lanterns */
  private canopy: Canopy;
  private roots: Float32Array;
  private rootsBuf: ReturnType<Kit['storage']> | null = null;
  private canopyBufs: { turns: ReturnType<Kit['storage']>; spans: ReturnType<Kit['storage']> } | null = null;
  private tex: { bark: Texture; barkH: Texture; ground: Texture };
  private loading: Promise<void> | null = null;
  private q: { grass: number; blades: number; flowers: number; spires: number; ferns: number; fronds: number; trunks: number; steps: number; flies: number; deepFlies: number };

  constructor(private ctx: WorldCtx) {
    const { kit, coarse, film } = ctx;
    // less detail on a phone: grass (tufts along the grid's side, blades a tuft), flowers and spires, fern rosettes
    // and fronds, the trunks the light is tested against, the steps through the air, fireflies (a film tests more
    // trunks and marches the air finer)
    this.q = coarse
      ? { grass: 120, blades: 6, flowers: 84, spires: 26, ferns: 24, fronds: 10, trunks: 9, steps: 10, flies: 140, deepFlies: 260 }
      : { grass: 210, blades: 10, flowers: 150, spires: 44, ferns: 34, fronds: 14, trunks: film ? 24 : 13, steps: film ? 26 : 15, flies: 320, deepFlies: 900 };
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
    this.garden = layoutGarden(this.woods.layout.trunks, 9, redwoodsDuel().runs, coarse);
    // the arbour round the ring (arbour.ts): its fungi off the duel's drops and the fallen log
    const da = redwoodsDuel().arena, lg = this.stage.log, pl = this.stage.plate;
    const offLog = (x: number, z: number) => {
      const bx = lg[2] - lg[0], bz = lg[3] - lg[1], h = Math.max(0, Math.min(1, ((x - lg[0]) * bx + (z - lg[1]) * bz) / Math.max(bx * bx + bz * bz, 1e-4)));
      return Math.hypot(x - lg[0] - bx * h, z - lg[1] - bz * h) > pl[0] + 0.2 && Math.hypot(x - pl[1], z - pl[2]) > pl[3] * 0.6;
    };
    this.arbour = layoutArbour(this.woods.layout.trunks, 9, redwoodsDuel().stumps, (x, z) => !inDrop(da.plane, da.drops!, x, z) && offLog(x, z), coarse);
    const Lw = this.woods.layout;
    this.canopy = layoutCanopy(Lw.logs, Lw.near + Lw.far, RING, () => true, coarse);
    // the ring's roots over the ground at the meadow's edge (canopy.ts, phase 6): outside the duel's space, off the
    // mirrors and the gate
    const sp = redwoodsDuel().arena.space;
    const avoid: [number, number, number][] = [[gate[0], gate[2], 3.2], ...MIRROR_SITES.filter((m) => m.world === this.id).map((m): [number, number, number] => [m.x, m.z, 3.2])];
    this.roots = packPieces(layoutRoots(Lw.trunks, 9, [sp.center[0], sp.center[2]], sp.radius, avoid, coarse));
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

  /** whether the duel's arena was shown last frame (its dusk begins when it is shown) */
  private duelDusk = false;

  update(f: FrameCtx) {
    const P = redwoodsParams;
    // (a film moves the hour itself.) A duel here is danced from golden hour into dusk (phase 5, report 18): it opens
    // at DUSK[0] and the light goes on at an hour every DUSK_S seconds, stopping in the blue of dusk at DUSK[1], where
    // the moss, the fungi, the fireflies and the lanterns glow under the last light
    const inDuel = arenaShown(this.id);
    if (inDuel && !this.duelDusk && P.dayGoes && !this.ctx.film) P.hour = DUSK[0];
    this.duelDusk = inDuel;
    if (P.dayGoes && !this.ctx.film) P.hour = inDuel ? Math.min(DUSK[1], P.hour + f.dt / DUSK_S) : (P.hour + (f.dt * 24) / (P.dayMinutes * 60)) % 24;
    this.woods.update(f.danceDt, P);
    this.watch(f);
    // the duel arena's drops in the meadow (empty unless it is shown)
    const duel = redwoodsDuel(), drops = dropsUniform(duel.arena.plane, duel.arena.drops!, arenaShown(this.id));
    // the duel's gust, for what hangs in the air to stream out along (forest.near.xyz: its way in xz, its strength)
    const H = duel.arena.hazard, near = this.woods.values.near;
    if (H?.on && arenaShown(this.id)) {
      const g = gustNow(H, H.beat);
      near[0] = g.dir[0]; near[1] = g.dir[1]; near[2] = Math.max(g.strength, g.warn * 0.25);
    } else near[2] = 0;
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
      // the ring's roots over the ground (phase 6), in the boughs' detail
      const rbuf = (this.rootsBuf ??= this.ctx.kit.storage({ label: 'redwoods.roots', data: this.roots, usage: ['storage'] }));
      pass.draw(trunkShader, {
        label: 'redwoods.roots', vertex: 'vs_stage', fragment: 'fs_stage', bind: { stage: rbuf, barkTex: this.tex.bark, barkH: this.tex.barkH }, count: 20 * (2 + 2 * 2 - 1) * 6,
        instances: this.roots.length / 16, constants: { SIDES: 20, RINGS: 2, CAPR: 2, SFIRST: 0 }, cull: 'none', enabled: on,
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
      // pennants, strings and chimes (garden.ts): the clearing's always, the duel's boughs' while its arena is shown
      const G = this.garden, gbuf = (this.gardenBuf ??= this.ctx.kit.storage({ label: 'redwoods.garden', data: G.data, usage: ['storage'] }));
      pass.draw(gardenShader, { label: 'redwoods.garden', bind: { hangs: gbuf }, count: 6 * 6, instances: G.clearing, constants: { FIRST: 0, SEG: 6 }, cull: 'none', enabled: on });
      pass.draw(gardenShader, { label: 'redwoods.garden.duel', bind: { hangs: gbuf }, count: 6 * 6, instances: G.duel, constants: { FIRST: G.clearing, SEG: 6 }, cull: 'none', enabled: () => on() && arenaShown(this.id) });
      // the arbour round the ring (arbour.wgsl): its arches, the vine on them, the pods and the fungi
      const A = this.arbour, ab = this.arbourBinds();
      pass.draw(arbourShader, { label: 'redwoods.arbour', vertex: 'vs_arch', fragment: 'fs_arch', bind: ab, count: 28 * 6 * 6, instances: A.archCount, cull: 'none', enabled: on });
      pass.draw(arbourShader, { label: 'redwoods.arbour.vine', vertex: 'vs_leaf', fragment: 'fs_leaf', bind: ab, count: 56 * 6, instances: A.archCount, cull: 'none', enabled: on });
      pass.draw(arbourShader, { label: 'redwoods.pods', vertex: 'vs_pod', fragment: 'fs_pod', bind: ab, count: 10 * 8 * 6 + 6, instances: A.always, constants: { FIRST: 0 }, cull: 'none', enabled: on });
      pass.draw(arbourShader, { label: 'redwoods.fungi.duel', vertex: 'vs_pod', fragment: 'fs_pod', bind: ab, count: 10 * 8 * 6 + 6, instances: A.duel, constants: { FIRST: A.always }, cull: 'none', enabled: () => on() && arenaShown(this.id) });
      // the wood's living architecture (canopy.wgsl): decks, rails, houses and lanterns, then the bridges and stairs
      const C = this.canopy, cb = this.canopyBinds();
      pass.draw(canopyShader, { label: 'redwoods.canopy', vertex: 'vs_turn', fragment: 'fs_turn', bind: cb, count: 28 * 7 * 6, instances: C.turnCount, constants: { FIRST: 0 }, cull: 'none', enabled: on });
      pass.draw(canopyShader, { label: 'redwoods.canopy.spans', vertex: 'vs_span', fragment: 'fs_span', bind: cb, count: 3 * 40 * 6, instances: C.spanCount, cull: 'none', enabled: on });
    } else {
      pass.draw(pollenShader, { label: 'redwoods.pollen', count: 6, instances: () => (this.ctx.coarse ? 700 : 1400), blend: 'add', depthWrite: false, cull: 'none', enabled: on });
      pass.draw(pollenShader, { label: 'redwoods.kicks', vertex: 'vs_kick', count: 6, instances: 4 * 40, constants: { KICK: 40 }, blend: 'add', depthWrite: false, cull: 'none', enabled: on });
      // each lit lantern's halo in the mist
      pass.draw(lanternShader, {
        label: 'redwoods.halos', vertex: 'vs_halo', fragment: 'fs_halo', count: 6, instances: L.lanterns.length, blend: 'add', depthWrite: false, cull: 'none',
        enabled: () => on() && redwoodsParams.lanterns > 0,
      });
      // fireflies, from dusk (forest.horizon.w: the sun under 10°) into the night
      pass.draw(lanternShader, {
        label: 'redwoods.fireflies', vertex: 'vs_fly', fragment: 'fs_fly', count: 6, instances: () => Math.round((q.flies + q.deepFlies) * redwoodsParams.fireflies), constants: { NEAR: q.flies },
        blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && this.woods.values.horizon[3] > 0.01,
      });
      // the arbour's pods and the fungi: their halos
      const A = this.arbour, ab = this.arbourBinds();
      pass.draw(arbourShader, { label: 'redwoods.pods.halos', vertex: 'vs_halo', fragment: 'fs_halo', bind: ab, count: 6, instances: A.always, constants: { FIRST: 0 }, blend: 'add', depthWrite: false, cull: 'none', enabled: on });
      const C = this.canopy, cb = this.canopyBinds();
      pass.draw(canopyShader, { label: 'redwoods.canopy.halos', vertex: 'vs_halo', fragment: 'fs_halo', bind: cb, count: 6, instances: C.lanterns, constants: { FIRST: C.firstLantern }, blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && this.woods.values.horizon[3] + this.woods.values.night > 0.01 });
      pass.draw(arbourShader, { label: 'redwoods.fungi.halos', vertex: 'vs_halo', fragment: 'fs_halo', bind: ab, count: 6, instances: A.duel, constants: { FIRST: A.always }, blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && arenaShown(this.id) && this.woods.values.horizon[3] > 0.01 });

    }
  }

  private arbourBinds() {
    const A = this.arbour;
    return (this.arbourBufs ??= {
      arches: this.ctx.kit.storage({ label: 'redwoods.arbour', data: A.arches, usage: ['storage'] }),
      pods: this.ctx.kit.storage({ label: 'redwoods.pods', data: A.pods, usage: ['storage'] }),
    });
  }
  private canopyBinds() {
    const C = this.canopy;
    return (this.canopyBufs ??= {
      turns: this.ctx.kit.storage({ label: 'redwoods.canopy', data: C.turns, usage: ['storage'] }),
      spans: this.ctx.kit.storage({ label: 'redwoods.canopy.spans', data: C.spans, usage: ['storage'] }),
    });
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

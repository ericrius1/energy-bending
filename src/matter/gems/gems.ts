// The gems: Gem Dancers' bodies of mineral specimens, as the first matter kind. One particle a stone. What is the
// gems' own here (the body's motion is matter/core): the specimens and their levels of detail, the suites a layer
// wears (its `params.suite`), the per-view LOD cull into indirect draw lists, the stones' shading, streaks and
// sparkles, the sound events the GPU reports, the heap they rest in and the crystal fixtures a world is built of.
// And the second scale of gem body, the large crystals (crystals.ts, shapes.ts, crystal.wgsl), how a gem body holds
// together in the game's fast moves (motion.ts), and the hearts of mixed bodies (hearts.ts: other kinds read them).
//
// Buffers, in particle order: the dancers' stones [0, count), spares fading into the floor up to `simCount`, then
// from LIMITS.stones the fixtures of every world (each world's run is its own; a view's cull takes its world's).
import type { Kit, RunEntry, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import simShader, { type Sim } from './sim.wgsl';
import cullShader from './cull.wgsl';
import drawShader from './draw.wgsl';
import streakShader from './streaks.wgsl';
import sparkSimShader from './sparks_sim.wgsl';
import sparkDrawShader from './sparks_draw.wgsl';
import carryShader, { type Carry as CarryU } from './carry.wgsl';
import type { Look } from './draw.wgsl';
import type { MatterCtx, MatterLayer, MatterPasses, Budget, MatterActs, Carry } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import type { ViewCtx } from '../../engine/views';
import type { World } from '../../worlds/world';
import { LIMITS } from '../../engine/limits';
import { onParams } from '../../engine/params';
import { layoutHomes } from '../core/layout';
import { matterParams } from '../core/params';
import { gemParams } from './params';
import { STONES, SUITES, kindsOf, glowOf } from './minerals';
import { withBorrowed, type SpecimenIndex } from './specimens';
import { buildShapes, SHAPES } from './shapes';
import { Crystals } from './crystals';
import { GemMotion } from './motion';
import { heartsOf } from './hearts';
import crystalShader, { type Crystals as CrystalsU } from './crystal.wgsl';
import haloShader, { type Halo } from './halo.wgsl';
import type { Motion } from './sim.wgsl';
import type { Hearts } from './hearts.wgsl';
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';
import { buildDome, heap, shower } from './fixtures';
import { SoundEvents } from './events';
import { touchParams } from '../core/touch';
import { CAPSULES } from '../core/capsules';
import { seatTints } from '../core/seats';

const MAXN = LIMITS.stones;
const TOTAL = MAXN + LIMITS.fixtures;

/** one world's gem fixture, placed: where its run starts and how many, how many of each specimen, whether it's on */
interface FixtureRun { world: string; base: number; count: number; kinds: number[]; enabled: () => boolean }

/** what a view needs for its cull and its draws */
interface ViewLists { cview: UniformBuffer<any>; args: StorageBuffer; list: StorageBuffer; argsR: StorageBuffer; listR: StorageBuffer; view: ViewCtx }

export class GemPasses implements MatterPasses {
  readonly id = 'gems';
  readonly ids: string[];
  readonly K: number;
  readonly L: number;
  readonly acts: MatterActs;
  /** called with the stones the GPU heard land, break off or click home (audio/score.ts rings them) */
  onStones: ((when: number, ev: Float32Array, n: number) => void) | null = null;
  readonly state: StorageBuffer;
  readonly sim: UniformBuffer<Sim>;
  readonly look: UniformBuffer<Look>;
  private kit: Kit;
  private verts: StorageBuffer;
  private argsTemplate: StorageBuffer;
  private template: Uint32Array;
  private homes: StorageBuffer;
  private homes2Prev: StorageBuffer;
  private sparks: StorageBuffer;
  private minerals: UniformBuffer<any>;
  private events: SoundEvents;
  private views = new Map<string, ViewLists>();
  private fixtures: FixtureRun[] = [];
  private homeData = new Float32Array(MAXN * 8);
  private looks = new Float32Array(MAXN * 4);
  private prevLooks = new Float32Array(MAXN * 4);
  private typeCount: number[];
  private types = new Float32Array(LIMITS.specimens * 4);
  // the dancers' stones (`active`, laid out on their bodies) and the stones simulated (those, and spares)
  private active: number;
  private simCount: number;
  private spareFade = 1;
  private prevLook = 0;
  private settling = true;
  private dancing = false;
  private awake = false;
  private wake = 0;
  private wakeSpread = 2.2;
  private shatterNow = false;
  private rainFrom = 0;
  private rainTo = 0;
  private rainAt = [0, 0];
  private transition = 0;
  private f: Sim & { body: Sim['body'] };
  private lastLayers: MatterLayer[] = [];

  constructor(private ctx: MatterCtx, fileIndex: SpecimenIndex, fileBin: ArrayBuffer) {
    const kit = (this.kit = ctx.kit);
    // the file's specimens, and the minerals that borrow one of their shapes (opal, iron)
    const { index, bin } = withBorrowed(fileIndex, fileBin);
    this.ids = index.specimens.map((s) => s.id);
    this.K = this.ids.length;
    this.L = index.lods;
    if (this.K > LIMITS.specimens) throw new Error(`gems: ${this.K} specimens, more than LIMITS.specimens (${LIMITS.specimens})`);
    if (this.L !== LIMITS.lods) throw new Error(`gems: ${this.L} levels of detail, LIMITS.lods is ${LIMITS.lods}`);
    const { K, L } = this;
    this.active = this.simCount = matterParams.count;

    // ---------------------------------------------------------------- buffers
    this.verts = kit.storage({ label: 'gems.verts', data: bin, usage: ['storage'] });
    // one indirect draw per specimen × detail: [vertices, instances (the cull counts them), first vertex, first instance]
    this.template = new Uint32Array(K * L * 4);
    index.specimens.forEach((s, k) => s.lods.forEach((l, d) => this.template.set([l.count, 0, l.first, 0], (k * L + d) * 4)));
    this.argsTemplate = kit.storage({ label: 'gems.args.template', data: this.template, usage: ['copy-src'] });
    this.homes = kit.storage({ label: 'gems.homes', size: TOTAL * 32, usage: ['storage', 'copy-dst'] });
    this.homes2Prev = kit.storage({ label: 'gems.homes.prev', size: MAXN * 16, usage: ['storage', 'copy-dst'] });
    // the dancers' stones start in a heap under the light; each world's fixtures come after them
    const init = new Float32Array(TOTAL * 12);
    heap(init, MAXN);
    this.typeCount = new Array(K).fill(0);
    this.placeFixtures(ctx.worlds, init);
    this.state = kit.storage({ label: 'gems.state', data: init, usage: ['storage', 'copy-dst'] });
    this.sparks = kit.storage({ label: 'gems.sparks', size: LIMITS.sparks * 48 });
    this.events = new SoundEvents(kit);

    this.sim = kit.uniforms(simShader.structs.Sim, 'gems.sim');
    this.motionU = kit.uniforms(simShader.structs.Motion, 'gems.motion');
    this.look = kit.uniforms(drawShader.structs.Look, 'gems.look');
    this.minerals = kit.uniforms(drawShader.structs.Minerals, 'gems.minerals');
    this.minerals.set({ k: kindsOf(this.ids) });
    this.updateLook();
    onParams(gemParams, () => this.updateLook());

    // ---------------------------------------------------------------- the simulation
    const step = kit.compute(simShader, {
      label: 'gems.sim', threads: () => [this.stoneCount],
      bind: { sim: this.sim, minerals: this.minerals, homes: this.homes, state: this.state, sparks: this.sparks, counter: this.events.counter, events: this.events.events, motion: this.motionU },
    });
    const sparkStep = kit.compute(sparkSimShader, { label: 'gems.sparks', threads: [LIMITS.sparks], bind: { sim: this.sim, sparks: this.sparks } });
    // a dancer carried through a gate this frame: its stones first, then the step (src/portals)
    this.carryU = kit.uniforms(carryShader.structs.Carry, 'gems.carry');
    const carryStep = kit.compute(carryShader, {
      label: 'gems.carry', threads: () => [this.stoneCount], enabled: () => this.carrying,
      bind: { carry: this.carryU, homes: this.homes, state: this.state },
    });
    ctx.frame.add('sim', carryStep, 'gems');
    ctx.frame.after(() => { this.carrying = false; }, 'gems: the carry is done');
    ctx.frame.add('sim', step, 'gems');
    ctx.frame.add('sim', this.events.copy, 'gems');
    ctx.frame.add('sim', sparkStep, 'gems');
    ctx.frame.after((f) => this.events.read(f.now, (when, ev, n) => this.onStones?.(when, ev, n)), 'gems: sound events');

    // ---------------------------------------------------------------- the large crystals, the motion, the hearts
    const shapes = buildShapes();
    this.shapeRanges = SHAPES.map((id) => shapes.ranges[id]);
    this.crystalVerts = kit.storage({ label: 'gems.crystals.verts', data: shapes.verts, usage: ['storage'] });
    this.crystalU = kit.uniforms(crystalShader.structs.Crystals, 'gems.crystals');
    this.haloU = kit.uniforms(haloShader.structs.Halo, 'gems.halo');
    this.hearts = heartsOf(kit);

    const z = { body: {} } as Sim;
    this.f = z as GemPasses['f'];
    this.acts = {
      rise: (at, spread) => { this.awake = true; this.wake = at; this.wakeSpread = spread; },
      shatter: (x, y, z2, strength) => {
        this.shatterNow = true;
        this.rainAt = [x, z2];
        ctx.hand.burst[0] = x; ctx.hand.burst[1] = y; ctx.hand.burst[2] = z2; ctx.hand.burst[3] = touchParams.burst * strength;
        this.wake = 0;
      },
      settle: (on) => { this.settling = on; },
      dancing: (on) => { this.dancing = on; },
    };
  }

  private shapeRanges: { first: number; count: number }[] = [];
  private crystalVerts!: StorageBuffer;
  private crystalU!: UniformBuffer<CrystalsU>;
  private motionU!: UniformBuffer<Motion>;
  private haloU!: UniformBuffer<Halo>;
  private hearts!: UniformBuffer<Hearts>;
  private crystals = new Crystals();
  private motion = new GemMotion();
  private caps = new Float32Array(LIMITS.dancers * LIMITS.capsules * 4);
  /** the capsules a clap lights, and how much: the hands whole, the forearms half */
  private clapCaps = CAPSULES.map((c, k) => [k, c.part === 'hands' ? 1 : c.joint.endsWith('ForeArm') ? 0.5 : 0]).filter((x) => x[1] > 0);
  /** per dancer: its heart (strength 0: none) and colour */
  private heartDefs = Array.from({ length: LIMITS.dancers }, () => ({ strength: 0, radius: 0.17, glow: [1, 1, 1] as number[] }));
  private heartRows = Array.from({ length: LIMITS.dancers }, () => ({ at: [0, 0, 0, 0], glow: [0, 0, 0, 0] }));
  private carryU: UniformBuffer<CarryU>;
  private carrying = false;
  private carryData = { m: Array.from({ length: LIMITS.dancers }, () => new Float32Array(16)), q: Array.from({ length: LIMITS.dancers }, () => [0, 0, 0, 1]), w: Array.from({ length: LIMITS.dancers }, () => [0, 0, 0, 0]), mask: 0, count: 0 };

  /** dancers carried through a gate this frame (src/portals): their stones go with them before the step */
  carry(moves: readonly Carry[]) {
    const c = this.carryData;
    if (!this.carrying) c.mask = 0;
    for (const { dancer, move, within } of moves) {
      if (dancer < 0 || dancer >= LIMITS.dancers) continue;
      c.m[dancer].set(move);
      c.q[dancer] = quatOf(move);
      c.w[dancer] = within ? [...within] : [0, 0, 0, 0];
      c.mask |= 1 << dancer;
    }
    c.count = this.stoneCount;
    this.carryU.set(c as unknown as Parameters<typeof this.carryU.set>[0]);
    this.carrying = true;
  }

  /** the sound events still being read back (a stepped capture waits for them) */
  get pending() { return this.events.pending; }

  get stoneCount() { return Math.min(this.simCount, MAXN); }
  get activeCount() { return Math.min(this.active, MAXN); }

  // ---------------------------------------------------------------- fixtures (the gems a world is built of)
  private placeFixtures(worlds: readonly World[], init: Float32Array) {
    let base = MAXN;
    const looks = new Float32Array(LIMITS.fixtures * 8);
    for (const w of worlds) for (const fx of w.fixtures) {
      if (fx.kind !== 'gems') continue;
      const count = Math.min(Number(fx.count ?? 0), MAXN + LIMITS.fixtures - base);
      if (count <= 0) continue;
      const kinds = ((fx.specimens as string[]) ?? []).map((id) => this.ids.indexOf(id)).filter((k) => k >= 0);
      const dome = buildDome(count, Number(fx.radius ?? 8.5), kinds, this.K, Number(fx.seed ?? 4242));
      init.set(dome.state, base * 12);
      for (let i = 0; i < count; i++) looks.set(dome.looks.subarray(i * 4, i * 4 + 4), (base - MAXN + i) * 8 + 4);
      this.fixtures.push({ world: w.id, base, count, kinds: dome.kinds, enabled: (fx.enabled as () => boolean) ?? (() => true) });
      base += count;
    }
    this.fixtureHomes = looks.subarray(0, (base - MAXN) * 8);
  }
  private fixtureHomes = new Float32Array(0);
  private fixturesOf(world: string) {
    const r = this.fixtures.find((x) => x.world === world);
    return r && r.enabled() ? r : null;
  }

  // ---------------------------------------------------------------- per view: its cull and its draws
  declareView(s: ScenePass) {
    const v = this.listsFor(s.view);
    const { pass, world, on } = s, { K, L } = this;
    const bind = { sim: this.sim, look: this.look, minerals: this.minerals, state: this.state, verts: this.verts, homes: this.homes, homes2Prev: this.homes2Prev, seen: s.view.seen, hearts: this.hearts };
    if (s.phase === 'opaque') {
      if (world.mirrorFloor) {
        pass.draw(drawShader, {
          label: `gems.reflection.${world.id}`, bind: { ...bind, list: v.listR }, constants: { MIRROR: 1, WORLD: world.light },
          cull: 'front', blend: 'add', enabled: () => on() && gemParams.reflection,
          encode: (pe) => { for (let d = L - 1; d < K * L; d += L) if (this.typeCount[Math.floor(d / L)] > 0) pe.drawIndirect(v.argsR.gpu, d * 16); },
        });
      }
      pass.draw(drawShader, {
        label: `gems.stones.${world.id}`, bind: { ...bind, list: v.list }, constants: { MIRROR: 0, WORLD: world.light },
        cull: 'back', enabled: on,
        encode: (pe) => { for (let d = 0; d < K * L; d++) if (this.typeCount[Math.floor(d / L)] > 0) pe.drawIndirect(v.args.gpu, d * 16); },
      });
      // the large crystals: one instanced draw per shape (crystals.ts keeps them sorted by shape)
      const cbind = { crystals: this.crystalU, look: this.look, minerals: this.minerals, verts: this.crystalVerts, seen: s.view.seen, hearts: this.hearts };
      const crystalDraw = (pe: GPURenderPassEncoder) => {
        this.crystals.runs.forEach((r, k) => { if (r.count) pe.draw(this.shapeRanges[k].count, r.count, this.shapeRanges[k].first, r.first); });
      };
      if (world.mirrorFloor) {
        pass.draw(crystalShader, {
          label: `gems.crystals.reflection.${world.id}`, bind: cbind, constants: { MIRROR: 1, WORLD: world.light },
          cull: 'front', blend: 'add', enabled: () => on() && gemParams.reflection && this.crystals.count > 0, encode: crystalDraw,
        });
      }
      pass.draw(crystalShader, {
        label: `gems.crystals.${world.id}`, bind: cbind, constants: { MIRROR: 0, WORLD: world.light },
        cull: 'back', enabled: () => on() && this.crystals.count > 0, encode: crystalDraw,
      });
    } else if (s.phase === 'glow') {
      pass.draw(haloShader, {
        label: `gems.hearts.${world.id}`, bind: { hearts: this.hearts, seen: s.view.seen, halo: this.haloU },
        count: 6, instances: LIMITS.dancers, blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && this.hasHearts && gemParams.heartHalo > 0,
      });
      pass.draw(streakShader, {
        label: `gems.streaks.${world.id}`, bind: { sim: this.sim, look: this.look, minerals: this.minerals, state: this.state, homes: this.homes, homes2Prev: this.homes2Prev, seen: s.view.seen },
        count: 6, instances: () => this.stoneCount, blend: 'add', depthWrite: false, cull: 'none', enabled: () => on() && gemParams.streakGlow > 0,
      });
      pass.draw(sparkDrawShader, { label: `gems.sparkles.${world.id}`, bind: { look: this.look, sparks: this.sparks }, count: 6, instances: LIMITS.sparks, blend: 'add', depthWrite: false, cull: 'none', enabled: on });
    }
  }

  /** a view's draw lists and cull, made the first time the view is declared */
  private listsFor(view: ViewCtx): ViewLists {
    let v = this.views.get(view.id);
    if (v) return v;
    const kit = this.kit, bytes = this.template.byteLength, id = view.id === 'main' ? '' : `.${view.id}`;
    const cview = kit.uniforms(cullShader.structs.CullView, `gems.cull${id}`);
    const args = kit.storage({ label: `gems.args${id}`, size: bytes, usage: ['storage', 'indirect', 'copy-dst', 'copy-src'] });
    const argsR = kit.storage({ label: `gems.argsR${id}`, size: bytes, usage: ['storage', 'indirect', 'copy-dst', 'copy-src'] });
    const list = kit.storage({ label: `gems.lists${id}`, size: LIMITS.lods * TOTAL * 4 });
    const listR = kit.storage({ label: `gems.reflection.list${id}`, size: TOTAL * 4 });
    v = { cview, args, argsR, list, listR, view };
    this.views.set(view.id, v);
    const reset = kit.raw((enc) => {
      enc.copyBufferToBuffer(this.argsTemplate.gpu, 0, args.gpu, 0, bytes);
      enc.copyBufferToBuffer(this.argsTemplate.gpu, 0, argsR.gpu, 0, bytes);
    }, `gems.lod.reset${id}`);
    const cull = kit.compute(cullShader, {
      label: `gems.cull${id}`, view: view.id === 'main' ? undefined : view.view,
      threads: () => [this.stoneCount + (this.fixturesOf(view.world)?.count ?? 0)],
      bind: { sim: this.sim, cview, state: this.state, args, list, argsR, listR, homes: this.homes, homes2Prev: this.homes2Prev, seen: view.seen },
    });
    const enabled = view.on;
    this.ctx.frame.add('cull', Object.assign(reset, { enabled }) as RunEntry, 'gems');
    this.ctx.frame.add('cull', Object.assign(cull, { enabled }) as RunEntry, 'gems');
    return v;
  }

  // ---------------------------------------------------------------- how many, and where
  /** a programme wanting more stones than the last: the new ones rain in from above; fewer: the rest become spares,
   *  fall where they are and fade into the floor */
  resize(budget: Budget) {
    this.budget = budget.count;
    this.resizeTo(this.lastLayers.length || !this.laidOut ? budget.count : 0);
  }
  /** the stones the programme asked for (resize), kept while no dancer wears gems */
  private budget = matterParams.count;
  private laidOut = false;

  private resizeTo(count: number) {
    const n = Math.min(count, MAXN), was = this.active;
    // between dances the stones keep the last dance's looks until each rises (a stone changes as it lifts)
    if (this.settling) this.keepLooks(0, this.stoneCount);
    this.active = n;
    this.rainFrom = this.rainTo = 0;
    if (n > was) {
      this.simCount = Math.max(this.simCount, n);
      if (this.awake) {
        const rows = new Float32Array(12 * 4096);
        for (let i = was; i < n; i += 4096) {
          const k = Math.min(4096, n - i);
          shower(rows, k, this.rainAt[0], this.rainAt[1], 7 + i, gemParams.rainHeight);
          this.state.write(rows.subarray(0, k * 12), i * 48);
        }
        this.rainFrom = was; this.rainTo = n;
      }
    } else if (n < was) {
      this.simCount = was;
      this.spareFade = 0;
    }
  }

  /** each layer's stones tiled over its body, in its suite of three; the stones re-home and fly to their new places */
  layout(layers: MatterLayer[]) {
    this.lastLayers = layers;
    this.laidOut = true;
    // no dancer wears gems (all fire, say): every stone becomes a spare and fades into the floor, and comes back
    // when a dancer wears them again (without this they stayed on their last homes, drawn inside the new matter)
    if (!layers.length && this.active > 0) this.resizeTo(0);
    else if (layers.length && this.active === 0 && this.budget > 0) this.resizeTo(this.budget);
    const count = this.activeCount;
    this.prevLook = this.settling ? 1 : 0;
    if (layers.length && count) {
      const ranges = layoutHomes(count, layers, this.homeData, { extremities: 1 + 3 * matterParams.trail });
      const h = this.homeData;
      layers.forEach((layer, k) => {
        const suite = this.suiteOf(layer);
        // a layer may grow its stones (params.size, ×; presets.ts's geode heart): the home's size is look.y
        const grow = Math.max(0.2, Number(layer.layer.params?.size ?? 1)) || 1;
        for (let i = ranges[k].from; i < ranges[k].to; i++) {
          // a mosaic (a suite of more than three) mixes all its minerals in, the first three still leading their roles
          const role = h[i * 8 + 6], r = h[i * 8 + 7];
          h[i * 8 + 4] = suite.length > 3 && r < 0.55 ? suite[Math.floor((r / 0.55) * suite.length) % suite.length] : suite[role];
          h[i * 8 + 5] *= grow;
        }
      });
      this.homes.write(h.subarray(0, count * 8));
      for (let i = 0; i < count; i++) for (let a = 0; a < 4; a++) this.looks[i * 4 + a] = h[i * 8 + 4 + a];
    }
    this.homes.write(this.fixtureHomes, MAXN * 32);
    this.layoutHearts(layers);
    this.crystals.layout(layers, (l) => this.suiteOf(l), (l) => this.heartDefs[l.dancer]?.strength ?? 0);
    // stones raining in had no last look: they wear the new one from the start
    if (this.settling && this.rainTo > this.rainFrom) this.keepLooks(this.rainFrom, this.rainTo);
    this.rainFrom = this.rainTo = 0;
    this.recount();
  }

  /** a layer's suite as specimen indices (a suite names minerals; an unknown name is Violet) */
  private suiteOf(layer: MatterLayer): number[] {
    const suite = (SUITES[String(layer.layer.params?.suite ?? 'Violet')] ?? SUITES.Violet).map((id) => Math.max(0, this.ids.indexOf(id)));
    // params.one: every stone (and crystal) the suite's first mineral
    return layer.layer.params?.one ? [suite[0], suite[0], suite[0]] : suite;
  }

  /** each dancer whose torso is gems has a heart: strong inside other matter (ember, gemwater, geodeheart), a quiet
   *  inner glow in an all-gem body; a layer's params.heart sets it */
  private layoutHearts(layers: MatterLayer[]) {
    for (const h of this.heartDefs) h.strength = 0;
    for (const l of layers) {
      if (l.parts && !l.parts.includes('torso')) continue;
      const def = this.heartDefs[l.dancer];
      if (!def) continue;
      const whole = !l.parts || (l.parts.includes('arms') && l.parts.includes('legs'));
      def.strength = Number(l.layer.params?.heart ?? (whole ? 0.3 : 1));
      def.radius = l.layer.params?.crystals ? 0.2 : 0.16;
      def.glow = glowOf(this.ids[this.suiteOf(l)[0]] ?? 'amethyst');
    }
    this.hasHearts = this.heartDefs.some((h) => h.strength > 0);
  }
  private hasHearts = false;

  /** the panel changed the count: take it, then lay out again */
  remix() { this.resize({ count: matterParams.count }); this.layout(this.lastLayers); }

  /** the stones' looks [from, to) kept as the last dance's (they wear them until they rise) */
  private keepLooks(from: number, to: number) {
    if (to <= from) return;
    this.prevLooks.set(this.looks.subarray(from * 4, to * 4), from * 4);
    this.homes2Prev.write(this.prevLooks.subarray(from * 4, to * 4), from * 16);
  }

  /** size each specimen's run of the draw lists: every stone in its look now, the last dance's while some still wear
   *  them, and every world's fixtures (a view sees at most its own world's) */
  private recount() {
    const n = this.stoneCount, K = this.K, per = new Array(K).fill(0);
    for (let i = 0; i < n; i++) per[this.looks[i * 4]]++;
    if (this.prevLook) for (let i = 0; i < n; i++) per[this.prevLooks[i * 4]]++;
    for (const fx of this.fixtures) fx.kinds.forEach((c, k) => { per[k] += c; });
    this.typeCount = per;
    // (with stones in the hundreds of thousands there's no room for both looks: they change at once instead)
    if (this.prevLook && per.reduce((a, b) => a + b, 0) > TOTAL) { this.prevLook = 0; this.recount(); return; }
    for (let k = 0, base = 0; k < K; base += per[k++]) this.types[k * 4] = base;
  }

  // ---------------------------------------------------------------- each frame
  private updateLook() {
    const P = gemParams;
    this.look.set({
      envIntensity: P.envIntensity, glint: P.glint, dispersion: P.dispersion, ior: 1.5, emissive: P.emissive, speedGlow: P.speedGlow,
      reflect: P.reflect, sparkle: P.sparkle, sparkSize: P.sparkSize, crystal: P.crystal, heart: P.heart, clap: P.clapGlow, streak: [P.streak, P.streakGlow, 0, 0],
      // (who each body is: matter/core/seats.ts)
      seat: seatTints(),
    });
  }

  update(f: FrameCtx) {
    this.updateLook();
    const P = gemParams, M = matterParams, s = this.f, b = s.body, K = this.K;
    const dt = Math.min(f.dt, 1 / 30) * (f.danceDt / Math.max(f.dt, 1e-6));
    this.transition *= Math.exp(-f.dt * 1.1);
    for (let k = 0; k < K; k++) { this.types[k * 4 + 1] = this.typeCount[k]; this.types[k * 4 + 2] = STONES[this.ids[k]]?.size ?? 1; }
    this.spareFade = Math.min(1, this.spareFade + f.dt / Math.max(0.1, P.spareFade));
    // the spares have faded: park them (no longer simulated, culled or drawn; a later dance takes them back)
    if (this.spareFade >= 1 && this.simCount > this.active) this.simCount = this.active;
    // once they're all up and dancing nobody wears the last dance's stones: the lists shrink back
    if (this.prevLook && this.wake > 0 && f.t > this.wake + Math.max(8, this.wakeSpread + 4)) { this.prevLook = 0; this.recount(); }
    s.count = this.stoneCount; s.inUse = this.activeCount; s.frameNo = f.frame; s.kinds = K;
    s.spareFade = this.spareFade; s.prevLook = this.prevLook; s.gemScale = P.scale; s.sizeVar = P.sizeVar;
    s.sparkRate = P.sparkRate; s.sparkSpeed = P.sparkSpeed; s.sparkLife = P.sparkLife; s.frictionSpark = P.frictionSpark;
    s.lod0 = P.lodNear; s.lod1 = P.lodFar; s.cullPx = 0.35; s.envBase = MAXN; s.types = this.types;
    const shatter = this.shatterNow || this.ctx.hand.shatterAll;
    b.dt = dt; b.time = f.t; b.floorY = 0; b.fill = P.fill;
    b.stiffness = P.stiffness; b.damping = P.damping; b.transition = this.transition; b.breathe = P.breathe;
    b.shedRate = shatter ? 1e4 : this.dancing ? P.shedRate : 0; b.speedShed = P.speedShed; b.fallTime = P.fallTime; b.gravity = P.gravity;
    b.bounce = P.bounce; b.friction = P.friction; b.drag = P.drag; b.current = P.current;
    b.returnMode = P.regrow ? 1 : 0; b.settle = this.settling ? 1 : 0; b.trail = this.dancing ? M.trail : 0; b.trailHold = M.trailHold;
    b.wake = this.wake; b.wakeSpread = this.wakeSpread; b.shatter = P.shatter; b.scatter = P.scatter;
    b.noiseAmp = P.noiseAmp + this.transition * 0.12; b.noiseFreq = P.noiseFreq; b.noiseSpeed = P.noiseSpeed; b.spin = P.spin; b.order = P.order;
    // fast motion: the hold, and most of the steady leak at speed traded for bursts at the peaks
    b.hold = P.hold; b.trailCap = P.trailCap; b.speedShed = P.speedShed * (1 - P.hold * (1 - P.leak));
    this.moveBodies(f, shatter);
    s.caps = this.caps;
    this.sim.set(s);
    this.shatterNow = false;
    for (const v of this.views.values()) {
      const w = v.view.world, fx = this.fixturesOf(w);
      const world = this.ctx.worlds.find((x) => x.id === w);
      v.cview.set({ fixBase: fx?.base ?? MAXN, fixCount: fx?.count ?? 0, reflectOn: P.reflection && world?.mirrorFloor ? 1 : 0 });
    }
    this.events.begin();
  }

  /** the fast motion (motion.ts), the crystals (crystals.ts), the bursts and the hearts, for this frame */
  private moveBodies(f: FrameCtx, shatter: boolean) {
    const P = gemParams, dt = Math.min(f.danceDt, 1 / 20);
    this.motion.update(f.dancers, dt, P);
    const standing = !this.settling && this.awake && f.t > this.wake + this.wakeSpread * 0.6;
    this.crystals.update(f.dancers, dt, this.motion.peaks, this.motion.squash, standing, shatter, P);
    const c = this.caps;
    c.fill(0);
    for (let k = 0; k < this.crystals.hide.length; k++) {
      c[k * 4] = this.crystals.hide[k];
      if (this.crystals.crack[k] > 0) { c[k * 4 + 1] = this.crystals.crack[k]; c[k * 4 + 2] = 1; }
    }
    // the peaks on limbs not under a standing crystal: a burst of their stones, onward with the limb
    if (this.dancing && !this.settling) {
      for (const pk of this.motion.peaks) {
        if (c[pk.slot * 4] > 0.5) continue;
        c[pk.slot * 4 + 1] = Math.max(c[pk.slot * 4 + 1], P.burst * pk.strength);
        c[pk.slot * 4 + 2] = Math.max(c[pk.slot * 4 + 2], pk.strength);
      }
    }
    // a clap (Dancer.clapAt, in FrameCtx.t): the hands flash at the meeting and fade (the draw reads caps' w)
    for (let d = 0; d < f.dancers.length && d < LIMITS.dancers; d++) {
      const since = f.t - (f.dancers[d]?.clapAt ?? -Infinity);
      if (!(since >= 0 && since < P.clapFade * 6)) continue;
      const k = Math.exp(-since / P.clapFade);
      for (const [s, w] of this.clapCaps) c[(d * LIMITS.capsules + s) * 4 + 3] = k * w;
    }
    this.crystalU.set({ c: this.crystals.rows } as unknown as CrystalsU);
    this.motionU.set({ spin: this.motion.spin, accel: this.motion.accel, squash: this.motion.squash } as unknown as Motion);
    this.haloU.set({ bright: P.heartHalo, size: P.haloSize, pad0: 0, pad1: 0 });
    // the hearts: at the chest, beating with the music (a soft swell on each beat)
    const beat = f.beat.beats % 1, pulse = 0.85 + 0.3 * Math.exp(-beat * 7);
    const lit = this.awake && !this.settling && f.t > this.wake + this.wakeSpread * 0.5;
    this.heartDefs.forEach((h, d) => {
      const row = this.heartRows[d], w = f.dancers[d]?.skeleton.world;
      if (!w || h.strength <= 0 || !lit) { row.at[3] = 0; row.glow[3] = 0; return; }
      const a = JOINT.Spine1 * JOINT_FLOATS, b2 = JOINT.Spine * JOINT_FLOATS;
      row.at = [w[a] * 0.7 + w[b2] * 0.3, w[a + 1] * 0.7 + w[b2 + 1] * 0.3, w[a + 2] * 0.7 + w[b2 + 2] * 0.3, h.radius];
      row.glow = [h.glow[0], h.glow[1], h.glow[2], h.strength * pulse];
    });
    this.hearts.set({ h: this.heartRows } as unknown as Hearts);
  }

  /** the stones drift to new homes (a jump between dances from the panel): loosen them for a moment */
  loosen() { this.transition = 1; }

  stats() {
    return {
      stones: this.activeCount, simulated: this.stoneCount, fixtures: this.fixtures.reduce((a, x) => a + x.count, 0), specimens: this.K,
      crystals: this.crystals.count, cracks: this.crystals.cracks, bursts: this.motion.bursts, landings: this.motion.landings,
      hearts: this.heartDefs.filter((h) => h.strength > 0).length,
    };
  }

  /** the main view's draw arguments (for a probe: how many of each specimen at each detail were drawn) */
  args(view = 'main') { return this.views.get(view)?.args; }
}

/** a rigid move's rotation (column-major 4×4) as a quaternion (x, y, z, w) */
function quatOf(m: Float32Array): number[] {
  const m00 = m[0], m01 = m[4], m02 = m[8], m10 = m[1], m11 = m[5], m12 = m[9], m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  let q: number[];
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((x) => x / n);
}

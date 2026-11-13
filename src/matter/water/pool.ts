// The water pool: one body of particles that is both kinds, 'water' and 'ice'. Each particle carries how frozen it
// is (water.wgsl `Aux`), so a dancer's water can freeze where it stands and melt back, ice touched by heat drips, and
// a dancer can wear water limbs on an ice torso. Both kinds' layers are laid out together over the bodies (an ice
// layer's particles start frozen and stay so unless melted); the 'water' and 'ice' MatterPasses the registry sees
// (water/index.ts, ice/index.ts) are two faces of this one pool, made by whichever is declared first.
//
// It owns: the particles (homes, state, aux), the simulation (sim.wgsl, 'sim' stage), the screen-space surface for
// each view (surface.ts), the glints on flying drops, each dancer's form (0 water … 1 ice, eased so the freeze climbs
// the body as a wave), and the acts of a show (rise from a puddle, shatter, settle). Ice's own drawing and set ice are
// ice/ice.ts, made here.
import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import simShader, { type WaterSim } from './sim.wgsl';
import surfaceShader, { type Surf } from './surface.wgsl';
import smoothShader from './smooth.wgsl';
import dropsShader from './drops.wgsl';
import type { MatterCtx, MatterLayer, Budget, MatterActs, MatterPasses, Carry } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import type { ViewCtx } from '../../engine/views';
import { layoutHomes } from '../core/layout';
import { hex, onParams } from '../../engine/params';
import { LIMITS } from '../../engine/limits';
import { touchParams } from '../core/touch';
import { waterParams, WATER_MAX } from './params';
import { WaterSurface } from './surface';
import { IceDraws } from '../ice/ice';
import { iceParams } from '../ice/params';
import carryShader from '../core/carry.wgsl';
import { CarryStep } from '../core/carry';
import type { MatterEars } from '../../audio/matter';
import { fastestLimb, jointAt, middleOf, seeded } from '../core/sounding';
import { JOINT } from '../../skeleton/rig';
import { budget } from '../../engine/perf';

const PARTICLE_FLOATS = 12;
/** gem count a programme asks for when it doesn't say (matter/core/params.ts): the budget is read relative to it */
const BASE_BUDGET = 15000;

export type WaterKindId = 'water' | 'ice';

export class WaterPool {
  readonly state: StorageBuffer;
  readonly aux: StorageBuffer;
  readonly homes: StorageBuffer;
  readonly sim: UniformBuffer<WaterSim>;
  readonly surf: UniformBuffer<Surf>;
  readonly smoothX: UniformBuffer<any>;
  readonly smoothY: UniformBuffer<any>;
  readonly drops: UniformBuffer<any>;
  readonly ice: IceDraws;
  /** the kind that was declared first: it runs the pool's frame and acts */
  primary: WaterKindId | null = null;
  private kit: Kit;
  private layers: Record<WaterKindId, MatterLayer[]> = { water: [], ice: [] };
  private dirty = false;
  private homeData = new Float32Array(WATER_MAX * 8);
  private _count = 0;
  private budgetScale = 1;
  private hasIceLayer = false;
  private coldUntil = 0;
  /** each dancer's form as the game set it, and as it is shown (eased toward it, so the freeze climbs the body) */
  private formTarget = new Float32Array(LIMITS.dancers);
  private formNow = new Float32Array(LIMITS.dancers);
  private surfaces = new Map<string, WaterSurface>();
  private mirrors = new Map<string, WaterSurface>();
  private declared = new Set<string>();
  private f = { body: {} } as WaterSim;
  // the show's moments
  private awake = false;
  private settling = true;
  private dancing = false;
  private wake = 0;
  private wakeSpread = 2.2;
  private shatterNow = false;
  private t = 0;

  constructor(private ctx: MatterCtx) {
    const kit = (this.kit = ctx.kit);
    // the device's budget (engine/perf.ts; a phone's is what `coarse` gave: 40k, half resolution, one smoothing pass)
    { const b = budget(); waterParams.perDancer = b.waterPerDancer; waterParams.resolution = b.waterResolution; waterParams.smoothPasses = b.waterSmooth; }
    this.state = kit.storage({ label: 'water.state', size: WATER_MAX * PARTICLE_FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.aux = kit.storage({ label: 'water.aux', size: WATER_MAX * 16, usage: ['storage', 'copy-dst'] });
    this.homes = kit.storage({ label: 'water.homes', size: WATER_MAX * 32, usage: ['storage', 'copy-dst'] });
    this.sim = kit.uniforms(simShader.structs.WaterSim, 'water.sim');
    this.surf = kit.uniforms(surfaceShader.structs.Surf, 'water.surf');
    this.smoothX = kit.uniforms(smoothShader.structs.Smooth, 'water.smooth.x');
    this.smoothY = kit.uniforms(smoothShader.structs.Smooth, 'water.smooth.y');
    this.drops = kit.uniforms(dropsShader.structs.Drops, 'water.drops');
    this.uploadLook();
    onParams(waterParams, (k) => {
      // the panel's form sets every dancer's (Dancer.form, the one place it lives) on the next frame
      if (k === 'form') this.panelForm = Math.max(0, Math.min(1, waterParams.form));
      if (k === 'perDancer') this.dirty = true;
      this.uploadLook();
    });
    // a dancer carried through a gate takes its water and ice with it (before the step: src/portals)
    this.carrier = new CarryStep(kit, ctx.frame, { label: 'water.carry', owner: 'water', shader: carryShader, homes: this.homes, bind: { state: this.state }, count: () => this._count });
    const step = kit.compute(simShader, { label: 'water.sim', threads: () => [this._count], enabled: () => this._count > 0, bind: { sim: this.sim, homes: this.homes, state: this.state, aux: this.aux } });
    ctx.frame.add('sim', step, 'water');
    this.ice = new IceDraws(ctx, {
      sim: this.sim, state: this.state, aux: this.aux, homes: this.homes,
      count: () => this._count, maybeIce: () => this.maybeIce(),
    });
  }

  get count() { return this._count; }

  // ---------------------------------------------------------------- the game's handles
  /** the panel's form waiting to be put on every dancer (null: none) */
  private panelForm: number | null = null;
  /** dancer d's form now (as shown, easing toward what was set) */
  formOf(d: number) { return this.formNow[d] ?? 0; }

  private maybeIce() {
    return this.hasIceLayer || this.t < this.coldUntil || this.ctx.field.live;
  }

  // ---------------------------------------------------------------- layout and budget
  setLayers(kind: WaterKindId, layers: MatterLayer[]) { this.layers[kind] = layers; this.dirty = true; }

  resize(budget: Budget) {
    const s = Math.max(0.3, Math.min(1, budget.count / BASE_BUDGET));
    if (s !== this.budgetScale) { this.budgetScale = s; this.dirty = true; }
  }

  /** both kinds' layers over the bodies, in dancer order; new particles start in a puddle (asleep) or rain in */
  private layout(f: FrameCtx) {
    this.dirty = false;
    const all = [...this.layers.water, ...this.layers.ice].sort((a, b) => a.dancer - b.dancer);
    this.hasIceLayer = this.layers.ice.length > 0;
    const weight = all.reduce((a, l) => a + l.weight, 0);
    const n = Math.min(WATER_MAX, Math.round(waterParams.perDancer * weight * this.budgetScale));
    const was = this._count;
    if (!all.length || n <= 0) { this._count = 0; return; }
    const h = this.homeData;
    const ranges = layoutHomes(n, all, h, { extremities: 1.5, spacing: [1, 1, 1], size: [1, 1, 1] });
    all.forEach((l, k) => {
      const frozen = l.layer.kind === 'ice' ? 1 : 0;
      for (let i = ranges[k].from; i < ranges[k].to; i++) h[i * 8 + 4] = frozen;
    });
    this.homes.write(h.subarray(0, n * 8));
    if (n > was) this.spawn(f, was, n);
    this._count = n;
  }

  /** particles [from, to) come into the world: a puddle round their dancer before the show wakes, rain after */
  private spawn(f: FrameCtx, from: number, to: number) {
    const k = to - from, st = new Float32Array(k * PARTICLE_FLOATS), ax = new Float32Array(k * 4), h = this.homeData;
    let seed = 0x9e3779b9 ^ from;
    const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < k; j++) {
      const i = from + j, d = Math.floor(h[i * 8] / LIMITS.capsules), w = f.dancers[d]?.skeleton.world;
      const cx = w ? w[0] : 0, cz = w ? w[2] : 0, a = r() * Math.PI * 2;
      const o = j * PARTICLE_FLOATS;
      if (!this.awake) {
        const rr = Math.sqrt(r()) * 0.9;
        st.set([cx + Math.cos(a) * rr, 0.008, cz + Math.sin(a) * rr, 0, 0, 0, 0, 4], o);   // RESTING
      } else {
        const rr = Math.sqrt(r()) * 0.7;
        st.set([cx + Math.cos(a) * rr, 2.6 + r() * 2.5, cz + Math.sin(a) * rr, 1.5 + r(), 0, -1, 0, 1], o);   // FLYING
      }
      st[o + 11] = 1;   // rotation w
      ax[j * 4] = h[i * 8 + 4];
    }
    this.state.write(st, from * PARTICLE_FLOATS * 4);
    this.aux.write(ax, from * 16);
  }

  // ---------------------------------------------------------------- draws
  /** idempotent: both faces of the pool are asked for every view, world and phase */
  declareView(s: ScenePass) {
    const key = `${s.view.id}.${s.world.id}.${s.phase}`;
    if (this.declared.has(key)) return;
    this.declared.add(key);
    const view = s.view;
    const pool = {
      sim: this.sim, state: this.state, aux: this.aux, homes: this.homes, surf: this.surf, smoothX: this.smoothX, smoothY: this.smoothY,
      count: () => this._count, liquid: () => this._count > 0,
      look: this.ice.look, sets: this.ice.sets, setCount: () => this.ice.setIce.shardCount, setWorld: () => this.ice.setIce.world,
    };
    const any = () => this._count > 0 || this.ice.setIce.shardCount > 0;
    // a gate's view (src/portals) draws its surface inside its own scene pass (its scene runs in the 'gates' stage,
    // before the 'air' stage where the main view's composite is), at a lower resolution
    let surface = this.surfaces.get(view.id);
    if (!surface) {
      const gate = view.id.startsWith('gate');
      surface = new WaterSurface(this.kit, this.ctx.frame, view, pool, gate ? 'scene' : 'air', () => view.on() && any(), gate ? 0.7 : 1);
      this.surfaces.set(view.id, surface);
    }
    surface.addWorld(s);
    // a mirroring floor (the geode's) shows the bodies reflected: the same splats flipped, at half resolution
    if (s.world.mirrorFloor) {
      let mirror = this.mirrors.get(view.id);
      if (!mirror) {
        const mirrorWorld = () => this.ctx.worlds.find((w) => w.id === view.world)?.mirrorFloor ?? false;
        mirror = new WaterSurface(this.kit, this.ctx.frame, view, pool, 'mirror', () => view.on() && any() && waterParams.mirror > 0 && mirrorWorld(), 0.5);
        this.mirrors.set(view.id, mirror);
      }
      mirror.addWorld(s);
    }
    this.ice.declareView(s);
    if (s.phase === 'glow') {
      s.pass.draw(dropsShader, {
        label: `water.drops.${s.world.id}`, bind: { sim: this.sim, drops: this.drops, state: this.state, aux: this.aux, homes: this.homes, seen: view.seen }, constants: { WORLD: s.world.light },
        count: 6, instances: () => this._count, blend: 'add', depthWrite: false, cull: 'none', enabled: () => s.on() && this._count > 0 && waterParams.drops > 0,
      });
    }
  }

  /** the surface's view distance in this view for the lens (MatterPasses.focus), or null */
  focus(view: ViewCtx) { return this.surfaces.get(view.id)?.focus ?? null; }
  /** how the water bends and dims light behind it in this view (WaterSurface.veil), or null */
  veil(view: ViewCtx) { return this.surfaces.get(view.id)?.veil ?? null; }

  // ---------------------------------------------------------------- the show's moments
  readonly acts: MatterActs = {
    rise: (at, spread) => { this.awake = true; this.wake = at; this.wakeSpread = spread; },
    shatter: (x, y, z, strength) => {
      this.shatterNow = true;
      const b = this.ctx.hand.burst;
      b[0] = x; b[1] = y; b[2] = z; b[3] = touchParams.burst * strength;
      this.wake = 0;
    },
    settle: (on) => { this.settling = on; },
    dancing: (on) => { this.dancing = on; },
  };

  // ---------------------------------------------------------------- each frame
  /** the surface's and the drops' look, from both kinds' parameters (each frame: it carries the clock and the floor) */
  private uploadLook(time = 0, floorY = 0) {
    const P = waterParams, I = iceParams;
    // what each channel loses per unit W: deep is what one unit lets through
    const absorb = hex(P.deep).map((c) => -Math.log(Math.max(1e-3, c)));
    this.surf.set({
      absorb: [...absorb, P.milk], tint: [...hex(P.tint), P.opacity], glow: [...hex(P.glowColor), P.glow], rim: [...hex(P.rim), P.rimStrength],
      iceThin: [...hex(I.thin), I.facets], iceThick: [...hex(I.thick), I.rim],
      cover: [P.coverLo, P.coverHi, P.thickness, P.amount],
      wisp: [P.wisp, P.curl, P.tear, P.wispScale],
      refract: P.refract, dispersion: P.dispersion, glint: P.glint, foam: P.foam, caustic: P.caustic, rise: P.rise,
      reflect: P.reflect, floorY, time, iceGlint: I.glint, edges: I.edges, mirror: P.mirror, distAlpha: P.distAlpha ? 1 : 0,
      iceOpacity: I.opacity, climb: P.climb, ripple: [P.ripples, P.rippleScale, P.rimSharp, P.depthNormal],
    });
    this.smoothX.set({ dir: [1, 0], radius: P.smooth, falloff: P.falloff, maxPx: 24 });
    this.smoothY.set({ dir: [0, 1], radius: P.smooth, falloff: P.falloff, maxPx: 24 });
    this.drops.set({ strength: P.drops, size: P.dropSize, glints: P.dropGlints, foam: P.foamDrops });
  }

  update(f: FrameCtx) {
    this.t = f.t;
    if (this.dirty) this.layout(f);
    const P = waterParams, s = this.f, b = s.body;
    const dt = Math.min(f.dt, 1 / 30) * (f.danceDt / Math.max(f.dt, 1e-6));
    // each dancer's form eases toward what was set, so the freeze climbs the body (about two seconds feet to head)
    const ease = 0.55 * Math.max(f.dt, 0);
    if (this.panelForm !== null) { for (const d of f.dancers) d.form = this.panelForm; this.panelForm = null; }
    // the target is the dancer's own form (Dancer.form: 0 water … 1 ice; bend.form sets it)
    for (let d = 0; d < LIMITS.dancers; d++) this.formTarget[d] = Math.max(0, Math.min(1, f.dancers[d]?.form ?? 0));
    for (let d = 0; d < LIMITS.dancers; d++) {
      const g = this.formTarget[d], c = this.formNow[d];
      this.formNow[d] = c + Math.max(-ease, Math.min(ease, g - c));
      if (this.formNow[d] > 0) this.coldUntil = f.t + 4;
    }
    const fm = this.formNow;
    const main = this.ctx.worlds.find((w) => w.id === f.views[0]?.world);
    let cx = 0, cz = 0;
    for (const d of f.dancers) { cx += d.skeleton.world[0]; cz += d.skeleton.world[2]; }
    const D = Math.max(1, f.dancers.length);
    const floorY = main?.groundAt(cx / D, cz / D) ?? 0;
    s.count = this._count; s.frameNo = f.frame; s.shardEvery = Math.max(1, Math.round(iceParams.shardEvery));
    s.radius = P.radius; s.iceStiff = P.iceStiffness; s.iceDamp = P.iceDamping; s.freezeRate = P.freezeRate;
    s.meltHeat = P.meltHeat; s.freezeCold = P.freezeCold; s.boilHeat = P.boilHeat; s.wind = P.wind;
    s.splash = P.splash; s.spray = P.spray; s.wobble = P.wobble; s.wobbleFreq = P.wobbleFreq;
    s.flow = [P.flowSpeed, P.bulge, P.bulgeSpacing, P.peel];
    s.edge = [P.shellCurl, P.shellScale, P.shellClimb, P.streamers];
    s.forms = [[fm[0], fm[1], fm[2], fm[3]], [fm[4], fm[5], fm[6], fm[7]]];
    const cold = (d: number) => this.layers.ice.reduce((a, l) => a + (l.dancer === d ? l.weight : 0), 0);
    s.colds = [[cold(0), cold(1), cold(2), cold(3)], [cold(4), cold(5), cold(6), cold(7)]];
    const shatter = this.shatterNow || this.ctx.hand.shatterAll;
    b.dt = dt; b.time = f.t; b.floorY = floorY; b.fill = P.fill;
    b.stiffness = P.stiffness; b.damping = P.damping; b.transition = 0; b.breathe = 0;
    b.shedRate = shatter ? 1e4 : this.dancing ? P.drip : 0; b.speedShed = this.dancing ? P.speedShed : 0; b.fallTime = P.fallTime; b.gravity = P.gravity;
    b.bounce = P.bounce; b.friction = P.friction; b.drag = P.drag; b.current = 0;
    b.returnMode = 0; b.settle = this.settling ? 1 : 0; b.trail = 0; b.trailHold = 0;
    b.wake = this.wake; b.wakeSpread = this.wakeSpread; b.shatter = 0.7; b.scatter = P.scatter;
    b.noiseAmp = P.noiseAmp; b.noiseFreq = P.noiseFreq; b.noiseSpeed = P.noiseSpeed; b.spin = 0; b.order = 1;
    this.sim.set(s);
    const shattered = this.shatterNow;
    this.shatterNow = false;
    this.uploadLook(f.t, floorY);
    this.ice.update(f, dt, floorY);
    this.footfalls(f, floorY);
    this.voice(f, floorY, shattered);
    // set ice belongs to the world it was laid in: the main view's when its first piece appeared
    const si = this.ice.setIce;
    if (si.stats().pieces === 0) si.world = '';
    else if (!si.world) si.world = f.views[0]?.world ?? '';
  }

  private carrier: CarryStep;
  /** dancers carried through a gate this frame (src/portals): their particles go with them */
  carry(moves: readonly Carry[]) { this.carrier.carry(moves); }

  // ---------------------------------------------------------------- its voices (audio/matter/water.ts, ice.ts)
  private ears: MatterEars | null = null;
  /** feet that came down on the floor this frame: x, z, dancer; and how hard (0 … ~1.2 before the body's share) */
  private landed: [number, number, number][] = [];
  private landedHow: number[] = [];

  /** a liquid foot coming down onto the floor: it was well above it last frame, now it's on it. Its splash is heard
   *  (voice) and, where the world has water of its own (the Pool's, the temple's: a world with `ripple`), rings out
   *  on it */
  private footfalls(f: FrameCtx, floorY: number) {
    this.landed.length = 0;
    this.landedHow.length = 0;
    f.dancers.forEach((dn, d) => {
      if (d >= LIMITS.dancers) return;
      const wet = this.layers.water.reduce((a, l) => a + (l.dancer === d ? l.weight : 0), 0) * (1 - this.formNow[d]) * dn.presence;
      [JOINT.LeftFoot, JOINT.RightFoot].forEach((j, k) => {
        const p = jointAt(dn, j), key = d * 2 + k, prev = this.feetY[key] ?? p[1];
        this.feetY[key] = p[1];
        if (wet < 0.02 || !(prev > floorY + 0.16 && p[1] <= floorY + 0.12)) return;
        const how = 0.4 + (prev - p[1]) * 8;
        this.landed.push([p[0], p[2], d]);
        this.landedHow.push(how);
        const w = this.ctx.worlds.find((x) => x.id === (dn.world || f.views[0]?.world)) as { ripple?: (x: number, z: number, s: number, r: number) => void } | undefined;
        w?.ripple?.(p[0], p[2], Math.min(1.5, how * wet), 0.25);
      });
    });
  }
  private lastForm = new Float32Array(LIMITS.dancers);
  private feetY: number[] = [];
  /** both faces forward here; the first call wins (docs/extending/sound.md) */
  hear(ears: MatterEars) { this.ears ??= ears; }
  /** water pours while a body is liquid (faster with its limbs), drips now and then, and splashes when a foot comes
   *  down; ice ticks while a body freezes or melts, cracks as the front passes the waist, and shatters with a blast
   *  (and when set ice breaks). Worked out on the CPU from the skeletons, the forms and set ice */
  private voice(f: FrameCtx, floorY: number, shattered: boolean) {
    const E = this.ears;
    if (!E) return;
    const share = (kind: WaterKindId, d: number) => this.layers[kind].reduce((a, l) => a + (l.dancer === d ? l.weight : 0), 0);
    const at: [number, number, number] = [0, 0, 0];
    f.dancers.forEach((dn, d) => {
      if (d >= LIMITS.dancers) return;
      const wet = share('water', d), born = share('ice', d), form = this.formNow[d];
      const liquid = wet * (1 - form) * dn.presence, frozen = Math.min(1, born + wet * form) * dn.presence;
      const was = this.lastForm[d];
      this.lastForm[d] = form;
      if (liquid < 0.02 && frozen < 0.02) return;
      middleOf(dn, at);
      const limb = fastestLimb(dn);
      if (liquid >= 0.02) {
        E.hold({ kind: 'water', type: 'pour', key: `dancer${d}`, x: at[0], y: at[1], z: at[2], amount: liquid, speed: limb.speed });
        if (seeded(f.frame, d, 11) < liquid * 1.5 * f.dt) E.event({ kind: 'water', type: 'drip', x: at[0], y: at[1] - 0.4, z: at[2], strength: 0.3 + 0.4 * seeded(f.frame, d, 12) });
        this.landed.forEach(([x, z, k], n) => {
          if (k === d) E.event({ kind: 'water', type: 'splash', x, y: floorY, z, strength: Math.min(1.2, liquid * this.landedHow[n]) });
        });
      }
      if (frozen >= 0.02) {
        // freezing or melting: ticks as the front climbs (a few a second at full speed), one crack as it passes 0.5
        const rate = Math.abs(form - was) / Math.max(f.dt, 1e-3);
        if (seeded(f.frame, d, 13) < (rate * 25 + frozen * 0.2) * f.dt) E.event({ kind: 'ice', type: 'tick', x: at[0], y: at[1], z: at[2], strength: 0.3 + 0.5 * seeded(f.frame, d, 14) });
        if ((was < 0.5) !== (form < 0.5) && wet > 0) E.event({ kind: 'ice', type: 'crack', x: at[0], y: at[1], z: at[2], strength: 0.8 });
        if (shattered) E.event({ kind: 'ice', type: 'shatter', x: at[0], y: at[1], z: at[2], strength: frozen });
      }
    });
    // set ice that broke since the last frame
    const broke = this.ice.setIce.broke;
    for (const [x, y, z, l] of broke) E.event({ kind: 'ice', type: 'shatter', x, y, z, strength: Math.min(1.2, 0.5 + l * 0.2) });
    broke.length = 0;
  }

  stats(): Record<string, number | string> {
    const st = this.ice.setIce.stats();
    return {
      particles: this._count, waterLayers: this.layers.water.length, iceLayers: this.layers.ice.length,
      forms: Array.from(this.formNow.slice(0, 2), (v) => v.toFixed(2)).join(','), setPieces: st.pieces, setShards: st.shards,
    };
  }

  /** a face of the pool for the registry: 'water' or 'ice' */
  passes(kind: WaterKindId): WaterPasses {
    this.primary ??= kind;
    return new WaterPasses(kind, this);
  }
}

/** what the registry holds for 'water' and for 'ice': one face each of the shared pool. The game reaches the pool's
 *  handles through either: `formOf(d)` (the form as shown; the dancer's own is `Dancer.form`), `setIce` (ice/setice.ts) */
export class WaterPasses implements MatterPasses {
  readonly acts?: MatterActs;
  constructor(readonly id: WaterKindId, readonly pool: WaterPool) {
    if (pool.primary === id) this.acts = pool.acts;
  }
  get setIce() { return this.pool.ice.setIce; }
  formOf(d: number) { return this.pool.formOf(d); }
  declareView(s: ScenePass) { this.pool.declareView(s); }
  /** (both faces answer: the one surface holds water and ice) */
  focus(view: ViewCtx) { return this.pool.primary === this.id ? this.pool.focus(view) : null; }
  /** how the water bends and dims light behind it (WaterSurface.veil): for the post chain's glow (fire behind water).
   *  Not on MatterPasses (only this pool has it): find it with `'veil' in passes` */
  veil(view: ViewCtx) { return this.pool.veil(view); }
  layout(layers: MatterLayer[]) { this.pool.setLayers(this.id, layers); }
  update(f: FrameCtx) { if (this.pool.primary === this.id) this.pool.update(f); }
  hear(ears: MatterEars) { this.pool.hear(ears); }
  /** (both faces forward; the pool's one step moves every particle of the dancer, water or ice) */
  carry(moves: readonly Carry[]) { if (this.pool.primary === this.id) this.pool.carry(moves); }
  resize(budget: Budget) { this.pool.resize(budget); }
  stats() { return this.pool.primary === this.id ? this.pool.stats() : { sharedWith: this.pool.primary ?? '' }; }
}

/** the one pool for a kit, made by whichever of 'water' and 'ice' is declared first (a cache by kit, not a global
 *  setting: two kits would get two pools) */
const pools = new WeakMap<Kit, WaterPool>();
export function waterPool(ctx: MatterCtx): WaterPool {
  let p = pools.get(ctx.kit);
  if (!p) { p = new WaterPool(ctx); pools.set(ctx.kit, p); }
  return p;
}


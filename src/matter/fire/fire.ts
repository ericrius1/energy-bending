// Fire (and plasma, its power form): bodies of flame. One pool of GPU particles is shared by every dancer wearing
// fire or plasma; each particle has a home on a capsule (laid out by matter/core/layout.ts, like the gems') and lives
// a fraction of a second at a time: born at its home with the limb's velocity, rising, stirred, cooling, then born
// again (sim.wgsl). Drawn as a field: per view the flames splat temperature, form, smoke, velocity and distance into a
// half-resolution target and one composite applies the colour ramp to the sum (field.ts, splat.wgsl, composite.wgsl);
// the embers are points added into the scene (draw.wgsl).
//
// Fire and plasma are one kind with a form per particle (0 fire … 1 plasma): a `plasma` loadout layer is form 1, a
// `fire` layer is its `params.form` (default 0), and the dancer's own form (`Dancer.form`, copied into `form[d]` each
// frame; the game animates it with bend.form) is added on top, so a dancer's flame morphs smoothly into plasma and back. The `plasma` kind (matter/plasma) hands its
// layers here and draws the arcs.
//
// What other code uses:
//   form[d]            per dancer slot, 0 … 1, added to each layer's own form (read-only: a copy of Dancer.form)
//   fireLights(kit)    the world light (lights.ts): the `fire` slot of the worlds' light uniform, a light per dancer
//   handForm(d)        the form of the flame on dancer d's hands (the plasma kind arcs between hands past 0.4)
//   resize(budget)     the show's stone count scales the flames (budget.count / 15000 × fireParams.perDancer)
//   focus(view)        the depth contract: the flames' view distance where they are dense (r16float), for the lens
import type { Kit, StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import simShader, { type FireSim } from './sim.wgsl';
import carryShader from './carry.wgsl';
import { CarryStep } from '../core/carry';
import drawShader from './draw.wgsl';
import compositeShader, { type FireField } from './composite.wgsl';
import { FlameField } from './field';
import { CurlGrids } from './curl';
import type { ViewCtx } from '../../engine/views';
import type { PostChain } from '../../post/post';
import type { MatterCtx, MatterLayer, MatterPasses, Budget, MatterActs, Carry } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { MatterEars } from '../../audio/matter';
import { fastestLimb, middleOf, seeded, Trigger } from '../core/sounding';
import type { FrameCtx } from '../../engine/frame';
import { LIMITS } from '../../engine/limits';
import { layoutHomes } from '../core/layout';
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';
import { fireParams } from './params';
import { fireLights, writeFireLights, type FlameLight } from './lights';
import type { LightSlot } from '../../worlds/shared';
import type { FireLights } from './light.wgsl';
import { budget } from '../../engine/perf';

const MAXN = LIMITS.flames;
/** the show's default stone count: a programme's count over this scales the flames */
const BASE_STONES = 15000;
const HOME_FLOATS = 8;

type FlameKind = 'fire' | 'plasma';

/** one dancer's flame: how much of the dancer it is, its layers' form, whether it covers the hands */
interface FlameDancer { dancer: number; weight: number; form: number; handForm: number }

const made = new WeakMap<Kit, FirePasses>();
/** the one flame pool of a kit: the fire kind and the plasma kind both declare through this */
export function flameFor(ctx: MatterCtx): FirePasses {
  let f = made.get(ctx.kit);
  if (!f) { f = new FirePasses(ctx); made.set(ctx.kit, f); }
  return f;
}

export class FirePasses implements MatterPasses {
  readonly id = 'fire';
  readonly acts: MatterActs;
  /** per dancer slot: the dancer's form, 0 fire … 1 plasma, added to each layer's own. A copy of `Dancer.form`, made
   *  each frame in update (set the form on the dancer: bend.form(d, v)) */
  readonly form = new Float32Array(LIMITS.dancers);
  readonly sim: UniformBuffer<FireSim>;
  readonly field: UniformBuffer<FireField>;
  readonly flames: StorageBuffer;
  readonly lights: LightSlot<FireLights>;
  private homes: StorageBuffer;
  private noise: Texture;
  private homeData = new Float32Array(MAXN * HOME_FLOATS);
  private layers: Record<FlameKind, MatterLayer[]> = { fire: [], plasma: [] };
  private dirty = false;
  private scale = 1;
  /** flames simulated now */
  count = 0;
  private dancers: FlameDancer[] = [];
  private burn = 1;
  private burnTarget = 1;
  private burnRate = 3;
  private wake = 0;
  private wakeSpread = 2.2;
  private blast: [number, number, number, number] = [0, 0, 0, 0];
  private s = { body: {} } as FireSim;
  /** each view's field (field.ts), by view id */
  private fields = new Map<string, FlameField>();
  /** flames a whole fire dancer has now (the splats are weighted by it) */
  private perNow = fireParams.perDancer;
  private lightList: FlameLight[] = [];
  private curl: CurlGrids;

  constructor(private ctx: MatterCtx) {
    const kit = ctx.kit;
    // the device's budget (engine/perf.ts): how many flames a dancer has (the panel can change it after)
    fireParams.perDancer = budget().flamesPerDancer;
    this.flames = kit.storage({ label: 'fire.flames', size: MAXN * 48, usage: ['storage', 'copy-dst'] });
    this.homes = kit.storage({ label: 'fire.homes', size: MAXN * HOME_FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.sim = kit.uniforms(simShader.structs.FireSim, 'fire.sim');
    this.field = kit.uniforms(compositeShader.structs.FireField, 'fire.field');
    this.lights = fireLights(kit);
    this.noise = noiseTexture(kit);
    // a dancer carried through a gate takes its flames in the air with it (before the step: src/portals)
    this.carrier = new CarryStep(kit, ctx.frame, { label: 'fire.carry', owner: 'fire', shader: carryShader, homes: this.homes, bind: { flames: this.flames }, count: () => this.count });
    // the tongues' curl: a velocity grid round each fire dancer (curl.ts), before the step that reads it
    this.curl = new CurlGrids(kit, ctx.frame, ctx.coarse, { flames: this.flames, homes: this.homes, count: () => this.count, on: () => fireParams.curl > 0 });
    const step = kit.compute(simShader, {
      label: 'fire.sim', threads: () => [Math.max(1, this.count)], enabled: () => this.count > 0,
      bind: { sim: this.sim, homes: this.homes, flames: this.flames, curl: this.curl.curl, curlForce: this.curl.force },
    });
    ctx.frame.add('sim', step, 'fire');
    this.acts = {
      rise: (at, spread) => { this.wake = at; this.wakeSpread = spread; this.burnTarget = 1; this.burnRate = 3; },
      shatter: (x, y, z, strength) => { this.blast = [x, y, z, Math.min(strength, 4) * 0.6]; this.burnTarget = 0; this.burnRate = 1.2; this.wake = 0; },
      settle: (on) => { if (on) { this.burnTarget = 0; this.burnRate = 1.2; } },
      dancing: () => {},
    };
  }

  // ---------------------------------------------------------------- draws
  declareView(s: ScenePass) {
    if (s.phase !== 'glow') return;
    // the embers: points added into the scene (seen: what this view sees of each dancer, src/portals; homes: whose
    // each flame is); light only, the scene's alpha (the opaque view distance) left alone
    s.pass.draw(drawShader, {
      label: `fire.embers.${s.world.id}`, bind: { sim: this.sim, flames: this.flames, homes: this.homes, seen: s.view.seen },
      count: 6, instances: () => this.count, depthWrite: false, cull: 'none', blend: 'add', writeMask: 0x7,
      enabled: () => s.on() && this.count > 0 && fireParams.embers > 0,
    });
    // the body: the view's field (once per view, whichever world it shows)
    if (!this.fields.has(s.view.id)) {
      const pool = { sim: this.sim, field: this.field, flames: this.flames, homes: this.homes, noise: this.noise, count: () => this.count };
      this.fields.set(s.view.id, new FlameField(this.ctx.kit, this.ctx.frame, s.view, pool, this.ctx.worlds, s.view.id.startsWith('gate')));
    }
  }

  /** (not for the lens: the hook that runs once everything is declared) a gate's view runs its scene and air in the
   *  'gates' stage with nowhere between them, so its field goes in after them (field.ts) */
  declarePost(_post: PostChain) { for (const f of this.fields.values()) f.declare(); }

  /** the depth contract: an r16float the size of the view's field, holding the flames' view distance (m) where they
   *  are dense enough to focus on and 6e4 elsewhere (1e5 does not fit a half float) */
  focus(view: ViewCtx): Texture | null { return this.fields.get(view.id)?.focus ?? null; }

  // ---------------------------------------------------------------- where the flames live
  layout(layers: MatterLayer[]) { this.setLayers('fire', layers); }

  /** the plasma kind hands its layers here (they are flames at form 1) */
  setLayers(kind: FlameKind, layers: MatterLayer[]) { this.layers[kind] = layers; this.dirty = true; }

  /** the show's stone count (a mandala's many dancers, a phone's few) scales the flames */
  resize(budget: Budget) {
    this.scale = Math.min(2, Math.max(0.3, budget.count / BASE_STONES));
    this.dirty = true;
  }

  /** the form of the flame on dancer d's hands now (0 when its hands aren't flame) */
  handForm(d: number) {
    const fd = this.dancers.find((x) => x.dancer === d);
    return fd && fd.handForm >= 0 ? Math.min(1, fd.handForm + this.form[d]) : 0;
  }

  /** whether dancer d wears flame at all, and how much of it */
  /** dancer d's flame's form now (its layers' and the dancer's, 0 fire … 1 plasma; 0 if it wears no flame) */
  flameForm(d: number) { const fd = this.dancers.find((x) => x.dancer === d); return fd ? Math.min(1, fd.form + this.form[d]) : 0; }
  weightOf(d: number) { return this.dancers.find((x) => x.dancer === d)?.weight ?? 0; }

  /** lay every flame layer out (once a frame at most: fire and plasma both hand layers in when a loadout changes) */
  private relayout() {
    this.dirty = false;
    const layers = [...this.layers.fire, ...this.layers.plasma].sort((a, b) => a.dancer - b.dancer);
    const per = fireParams.perDancer * this.scale;
    this.perNow = per;
    const total = layers.reduce((a, l) => a + l.weight, 0);
    const count = Math.min(MAXN, Math.round(per * total / 256) * 256);
    const formOf = (l: MatterLayer) => (l.layer.kind === 'plasma' ? 1 : Math.min(1, Math.max(0, Number(l.layer.params?.form ?? 0))));
    // who wears flame, and how much
    const by = new Map<number, FlameDancer>();
    for (const l of layers) {
      const fd = by.get(l.dancer) ?? { dancer: l.dancer, weight: 0, form: 0, handForm: -1 };
      fd.form = (fd.form * fd.weight + formOf(l) * l.weight) / (fd.weight + l.weight || 1);
      fd.weight += l.weight;
      if (!l.parts || l.parts.includes('hands')) fd.handForm = Math.max(fd.handForm, formOf(l));
      by.set(l.dancer, fd);
    }
    this.dancers = [...by.values()];
    if (!count || !layers.length) { this.count = 0; return; }
    // flames spread evenly over the body (not the gems' wide heart and close accents)
    const ranges = layoutHomes(count, layers, this.homeData, { spacing: [1, 1, 1], size: [1, 1, 1] });
    layers.forEach((l, k) => {
      const form = formOf(l);
      for (let i = ranges[k].from; i < ranges[k].to; i++) this.homeData[i * HOME_FLOATS + 4] = form;
    });
    this.homes.write(this.homeData.subarray(0, count * HOME_FLOATS));
    this.count = count;
  }

  // ---------------------------------------------------------------- each frame
  update(f: FrameCtx) {
    if (this.dirty) this.relayout();
    for (let d = 0; d < LIMITS.dancers; d++) this.form[d] = f.dancers[d]?.form ?? 0;
    const P = fireParams, s = this.s, b = s.body;
    const dt = Math.min(f.dt, 1 / 30) * (f.danceDt / Math.max(f.dt, 1e-6));
    this.burn += (this.burnTarget - this.burn) * (1 - Math.exp(-dt * this.burnRate));
    if (Math.abs(this.burnTarget - this.burn) < 1e-3) this.burn = this.burnTarget;
    b.dt = dt; b.time = f.t; b.floorY = 0; b.fill = 0.55; b.breathe = 0;
    s.count = this.count; s.frameNo = f.frame; s.dt = dt; s.time = f.t;
    s.burn = this.burn; s.wake = this.wake; s.wakeSpread = this.wakeSpread;
    s.life = P.life; s.buoyancy = P.buoyancy; s.turbulence = P.turbulence; s.drag = P.drag; s.inherit = P.inherit;
    s.size = P.size; s.embers = P.embers; s.heat = P.heat; s.cling = P.cling;
    s.blast = this.blast;
    s.stretch = P.stretch; s.emberGlow = P.emberGlow;
    s.form = [[...this.form.subarray(0, 4)], [...this.form.subarray(4, 8)]] as unknown as FireSim['form'];
    this.sim.set(s);
    this.blast = [0, 0, 0, 0];
    // a curl grid for each fire dancer (plasma barely takes it: past form 0.7 it has none)
    const curling = this.dancers.filter((d) => Math.min(1, d.form + this.form[d.dancer]) < 0.7).map((d) => d.dancer);
    this.curl.update(f, curling, this.count, P.curl, P.curlMax);
    // the field: each splat weighted by how many flames a dancer has, so the sum doesn't change with the count
    this.field.set({
      gain: P.density * 60_000 / Math.max(1000, this.perNow), spread: P.spread, soft: P.soft, smokeGain: P.smoke, drySmoke: P.drySmoke,
      reflect: P.reflect, stretch: P.stretch, tongues: P.tongues, intensity: P.intensity, gaps: P.gaps, scale: P.noiseScale,
      climb: P.climb, advect: P.advect, period: P.period, smokeDark: 2.5, plasmaGlow: P.plasmaGlow, flicker: P.flicker, cut: P.cut,
      focusT: P.focusT, time: f.t, embers: P.emberGlow, mirrorY: this.mirrorY(f),
    });
    this.updateLights(f);
    this.voice(f);
  }

  /** the floor the main view's world mirrors fire about (its water, else 0: the geode's agate) */
  private mirrorY(f: FrameCtx) {
    const id = f.views[0]?.world;
    return this.ctx.worlds.find((w) => w.id === id)?.waterY?.() ?? 0;
  }

  /** one light per flame dancer, in its middle, flickering with its flame */
  private updateLights(f: FrameCtx) {
    const L = this.lightList;
    L.length = 0;
    for (const fd of this.dancers) {
      const dancer = f.dancers[fd.dancer];
      if (!dancer) continue;
      // (a flame dancer in another world lights that world, not this one: the light uniform is the main view's)
      if (dancer.world && f.views[0]?.world && dancer.world !== f.views[0].world) continue;
      const w = dancer.skeleton.world, h = JOINT.Hips * JOINT_FLOATS, c = JOINT.Spine1 * JOINT_FLOATS;
      const form = Math.min(1, fd.form + this.form[fd.dancer]);
      const t = f.t * 1, k = fd.dancer * 1.7;
      const flicker = 0.86 + 0.08 * Math.sin(t * 13.1 + k) + 0.06 * Math.sin(t * 31.7 + k * 2.3) + form * 0.15 * Math.sin(t * 57.3 + k);
      const mix = (a: number, b2: number) => a + (b2 - a) * form;
      L.push({
        dancer: fd.dancer,
        pos: [(w[h] + w[c]) / 2, (w[h + 1] + w[c + 1]) / 2 + 0.1, (w[h + 2] + w[c + 2]) / 2],
        radius: 0.45,
        color: [mix(1.0, 0.62), mix(0.42, 0.32), mix(0.12, 1.0)],
        intensity: fireParams.light * fd.weight * this.burn * flicker,
      });
    }
    writeFireLights(this.lights, L);
  }

  // ---------------------------------------------------------------- its voice (audio/matter/fire.ts)
  private ears: MatterEars | null = null;
  private flares: Trigger[] = [];
  private carrier: CarryStep;
  /** dancers carried through a gate this frame (src/portals): their flames go with them */
  carry(moves: readonly Carry[]) { this.carrier.carry(moves); }

  /** the music hands the ears once (docs/extending/sound.md) */
  hear(ears: MatterEars) { this.ears = ears; }
  /** each flame dancer roars while it burns (louder as a limb sweeps through it), crackles now and then, and flares
   *  when a limb whips fast (a kick throwing a sheet of flame). The fire's own share only: its plasma end is the
   *  plasma kind's buzz */
  private voice(f: FrameCtx) {
    const E = this.ears;
    if (!E) return;
    const at: [number, number, number] = [0, 0, 0];
    for (const fd of this.dancers) {
      const d = f.dancers[fd.dancer];
      if (!d) continue;
      const form = Math.min(1, fd.form + this.form[fd.dancer]);
      const amount = fd.weight * this.burn * (1 - form) * d.presence;
      if (amount < 0.02) continue;
      middleOf(d, at);
      const limb = fastestLimb(d);
      E.hold({ kind: 'fire', type: 'roar', key: `dancer${fd.dancer}`, x: at[0], y: at[1], z: at[2], amount, speed: limb.speed });
      // crackles: about three a second at full flame, seeded by the frame
      if (seeded(f.frame, fd.dancer, 1) < amount * 3 * f.dt) {
        E.event({ kind: 'fire', type: 'crackle', x: at[0], y: at[1] + 0.3, z: at[2], strength: 0.3 + 0.5 * seeded(f.frame, fd.dancer, 2) });
      }
      const flare = (this.flares[fd.dancer] ??= new Trigger(6, 3.5, 0.25));
      if (flare.test(limb.speed, f.t)) {
        const w = d.skeleton.world, o = limb.joint * 12;
        E.event({ kind: 'fire', type: 'flare', x: w[o], y: w[o + 1], z: w[o + 2], strength: Math.min(1.2, amount * limb.speed / 8) });
      }
    }
  }

  /** the lights as last written (CPU copy, for a world's own CPU work or a probe) */
  get flameLights(): readonly FlameLight[] { return this.lightList; }

  stats() {
    return { flames: this.count, dancers: this.dancers.map((d) => d.dancer).join(','), burn: +this.burn.toFixed(3) };
  }
}

/** a tileable noise texture for the flames' edges: four channels of value-noise fbm at different scales (r: tongues,
 *  g: the reference's display noise, b: plasma's threads, a: spare) */
function noiseTexture(kit: Kit): Texture {
  const N = 128, data = new Uint8Array(N * N * 4);
  let seed = 0x9e3779b9;
  const rand = () => { seed = (seed ^ (seed << 13)) >>> 0; seed = (seed ^ (seed >>> 17)) >>> 0; seed = (seed ^ (seed << 5)) >>> 0; return seed / 4294967296; };
  const lattice = (g: number) => Float32Array.from({ length: g * g }, rand);
  const at = (lat: Float32Array, g: number, x: number, y: number) => {
    const fx = (x / N) * g, fy = (y / N) * g, ix = Math.floor(fx), iy = Math.floor(fy);
    const ux = fx - ix, uy = fy - iy, sx = ux * ux * (3 - 2 * ux), sy = uy * uy * (3 - 2 * uy);
    const v = (i: number, j: number) => lat[((j % g) * g) + (i % g)];
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * sx, b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
  const octaves = (gs: number[]) => gs.map((g) => ({ g, lat: lattice(g) }));
  const ch = [octaves([4, 8, 16, 32]), octaves([4, 8, 16, 32]), octaves([8, 16, 32]), octaves([16, 32])];
  const wts = [0.5, 0.27, 0.15, 0.08];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    ch.forEach((oc, c) => {
      let v = 0, ws = 0;
      oc.forEach((o, k) => { v += at(o.lat, o.g, x, y) * wts[k]; ws += wts[k]; });
      v /= ws;
      if (c === 2) v = Math.pow(1 - Math.abs(2 * v - 1), 3);   // ridged: thin bright threads
      data[(y * N + x) * 4 + c] = Math.round(Math.min(1, Math.max(0, (v - 0.5) * 1.6 + 0.5)) * 255);
    });
  }
  return kit.texture({ label: 'fire.noise', format: 'rgba8unorm', size: [N, N], usage: ['sample', 'copy-dst'] }).write(data);
}

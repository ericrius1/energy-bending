// Fire (and plasma, its power form): bodies of flame. One pool of GPU particles is shared by every dancer wearing
// fire or plasma; each particle has a home on a capsule (laid out by matter/core/layout.ts, like the gems') and lives
// a fraction of a second at a time: born at its home with the limb's velocity, rising, stirred, cooling, then born
// again (sim.wgsl). Drawn as stretched soft sprites added into the scene (draw.wgsl).
//
// Fire and plasma are one kind with a form per particle (0 fire … 1 plasma): a `plasma` loadout layer is form 1, a
// `fire` layer is its `params.form` (default 0), and the dancer's own form (`Dancer.form`, copied into `form[d]` each
// frame; the game animates it with bend.form) is added on top, so a dancer's flame morphs smoothly into plasma and back. The `plasma` kind (matter/plasma) hands its
// layers here and draws the arcs.
//
// What other code uses:
//   form[d]            per dancer slot, 0 … 1, added to each layer's own form (read-only: a copy of Dancer.form)
//   fireLights(kit)    the world light (matter/fire/lights.ts, light.wgsl): one point light per flame dancer
//   handForm(d)        the form of the flame on dancer d's hands (the plasma kind arcs between hands past 0.4)
//   resize(budget)     the show's stone count scales the flames (budget.count / 15000 × fireParams.perDancer)
import type { Kit, StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import simShader, { type FireSim } from './sim.wgsl';
import drawShader from './draw.wgsl';
import type { MatterCtx, MatterLayer, MatterPasses, Budget, MatterActs } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import type { FrameCtx } from '../../engine/frame';
import { LIMITS } from '../../engine/limits';
import { layoutHomes } from '../core/layout';
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';
import { fireParams } from './params';
import { fireLights, writeFireLights, type FlameLight } from './lights';
import type { FireLights } from './light.wgsl';

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
  readonly flames: StorageBuffer;
  readonly lights: UniformBuffer<FireLights>;
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
  private lightList: FlameLight[] = [];

  constructor(private ctx: MatterCtx) {
    const kit = ctx.kit;
    this.flames = kit.storage({ label: 'fire.flames', size: MAXN * 48, usage: ['storage', 'copy-dst'] });
    this.homes = kit.storage({ label: 'fire.homes', size: MAXN * HOME_FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.sim = kit.uniforms(simShader.structs.FireSim, 'fire.sim');
    this.lights = fireLights(kit);
    this.noise = noiseTexture(kit);
    const step = kit.compute(simShader, {
      label: 'fire.sim', threads: () => [Math.max(1, this.count)], enabled: () => this.count > 0,
      bind: { sim: this.sim, homes: this.homes, flames: this.flames },
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
    const bind = { sim: this.sim, flames: this.flames, noiseTex: this.noise };
    const on = () => s.on() && this.count > 0;
    const common = { count: 6, instances: () => this.count, depthWrite: false, cull: 'none' as const };
    if (s.world.mirrorFloor) {
      s.pass.draw(drawShader, { ...common, label: `fire.reflection.${s.world.id}`, bind, constants: { MIRROR: 1, SMOKE: 0 }, blend: 'add', enabled: () => on() && fireParams.reflect > 0 });
    }
    // smoke darkens what is behind (premultiplied over), and leaves the scene's alpha (the view distance) alone
    s.pass.draw(drawShader, {
      ...common, label: `fire.smoke.${s.world.id}`, bind, fragment: 'fs_smoke', constants: { MIRROR: 0, SMOKE: 1 },
      blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
      enabled: () => on() && fireParams.smoke > 0,
    });
    // the flames add light, and min their distance into the alpha (where they're solid) for the depth of field
    s.pass.draw(drawShader, {
      ...common, label: `fire.flames.${s.world.id}`, bind, constants: { MIRROR: 0, SMOKE: 0 },
      blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' } },
      enabled: on,
    });
  }

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
  weightOf(d: number) { return this.dancers.find((x) => x.dancer === d)?.weight ?? 0; }

  /** lay every flame layer out (once a frame at most: fire and plasma both hand layers in when a loadout changes) */
  private relayout() {
    this.dirty = false;
    const layers = [...this.layers.fire, ...this.layers.plasma].sort((a, b) => a.dancer - b.dancer);
    const per = (this.ctx.coarse ? fireParams.perDancerCoarse : fireParams.perDancer) * this.scale;
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
    s.intensity = P.intensity; s.stretch = P.stretch; s.erode = P.erode; s.reflect = P.reflect; s.emberGlow = P.emberGlow;
    s.smoke = P.smoke; s.plasmaGlow = P.plasmaGlow; s.flicker = P.flicker; s.tongues = P.tongues;
    s.form = [[...this.form.subarray(0, 4)], [...this.form.subarray(4, 8)]] as unknown as FireSim['form'];
    this.sim.set(s);
    this.blast = [0, 0, 0, 0];
    this.updateLights(f);
  }

  /** one light per flame dancer, in its middle, flickering with its flame */
  private updateLights(f: FrameCtx) {
    const L = this.lightList;
    L.length = 0;
    for (const fd of this.dancers) {
      const dancer = f.dancers[fd.dancer];
      if (!dancer) continue;
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

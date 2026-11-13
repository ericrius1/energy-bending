// The matter field: a coarse 3D grid of air round the dancers (wind, heat, wet) that every matter kind samples
// (field.wgsl) and nobody has to write. Each frame, before the kinds' own steps, one compute step (step.wgsl)
// carries last frame's air along its own wind, spreads and fades it, lets heat rise, and lays every dancer's
// capsules into it: the air near a limb is dragged to the limb's velocity, and warmed, chilled or wetted by the aura
// of what that part wears (auras.ts, weighted by the loadout's share on that part and the dancer's power form).
// On top go the CPU's point deposits (thrown streams, impacts) and vortex sources (the fusion's swirl).
//
// The grid is two rgba16float 3D textures in bind group 3, which this object re-shares with the bodies' buffers
// (matter/core/bodies.ts made group 3 with four bindings; the field adds three), so a kind gets the field by
// including field.wgsl. The box follows the dancers' middle in whole cells, so its contents never jump or blur
// when it moves. A few points can be read back to the CPU (probe, updraft) a frame or three late.
//
// Wiring: main.ts makes it (new Field({ kit, frame, bodies, coarse, query })) before any kind or world, and calls
// update(f) in the 'dancers' phase once the joints are up; the kind registered in index.ts draws the overlay.
import type { Kit, RawItem, StorageBuffer, Texture, UniformBuffer } from '@ericrius1/weft';
import type { FrameBuilder, FrameCtx } from '../../engine/frame';
import type { BodyBuffers } from '../core/bodies';
import type { LoadoutLayer } from '../core/kind';
import { BODY_PARTS, CAPSULES, type BodyPart } from '../core/capsules';
import { LIMITS } from '../../engine/limits';
import groupShader from './group.wgsl';
import stepShader, { type FieldSim } from './step.wgsl';
import probeShader, { type Probes } from './probe.wgsl';
import fieldShader, { type FieldBox } from './field.wgsl';
import { auraOf } from './auras';
import { fieldParams } from './params';

type V3 = [number, number, number];

/** something put into the field this frame: at p, within radius r (a Gaussian falloff), the air is raised to at least
 *  `heat` (negative: cold) and `wet`, and pushed toward the velocity `wind` (`windWeight` of the way, default 1).
 *  Once is an impact; every frame is a stream. */
export interface Deposit { p: V3; wind?: V3; windWeight?: number; heat?: number; wet?: number; r: number }

/** a vortex source: the air turns round `axis` through `at` at `strength` m/s at `radius` (solid inside, falling off
 *  outside, gone by three radii), drawn in toward the axis at `inflow` m/s and up it at `lift` m/s, over `height` m
 *  either side of `at` along the axis */
export interface Vortex { at: V3; axis?: V3; strength: number; radius: number; inflow?: number; lift?: number; height?: number }

/** what the field held at a probe point, as last read back */
export interface FieldReading {
  wind: V3;
  /** signed: 1 flame, -1 ice */
  heat: number;
  wet: number;
  /** how fast steam is being made there */
  steam: number;
  /** the rising air (m/s) averaged over the 0.75 m column above the point */
  up: number;
  /** the frame it was measured in (kit.frameIndex): compare with now for its age */
  frame: number;
}

export interface FieldOptions {
  kit: Kit;
  frame: FrameBuilder;
  bodies: BodyBuffers;
  /** a phone: a coarser grid */
  coarse?: boolean;
  /** the page's query: `aura=fire,water` treats dancer 0 as wearing fire and dancer 1 water (for the field only),
   *  `field` shows the overlay, `vortex` turns on the test vortex */
  query?: URLSearchParams;
  /** cells along x, y, z (default 48 × 32 × 48; a phone 32 × 24 × 32) */
  dims?: V3;
  /** a cell's size (m; default 0.18: the box is 8.6 × 5.8 × 8.6 m) */
  cell?: number;
}

const AURA_SLOTS = 256;
if (LIMITS.dancers * LIMITS.capsules !== AURA_SLOTS) throw new Error('field: step.wgsl sizes FieldSim.auras for 8 × 32 capsule slots');
const MAXD = LIMITS.fieldDeposits, MAXV = LIMITS.fieldVortices, MAXP = LIMITS.fieldProbes;
const READ_BYTES = MAXP * 32;

interface Probe { slot: number; at: V3; reading: FieldReading | null }

export class Field {
  /** the box's centre (m, world): the dancers' middle, moved in whole cells */
  readonly centre: V3 = [0, 1, 0];
  /** the box's low corner now and last frame */
  readonly origin: V3 = [0, 0, 0];
  readonly dims: V3;
  readonly cell: number;
  /** half the box's width (m) */
  readonly halfSize: number;
  /** cells along x */
  readonly cells: number;
  /** it runs (kinds can skip CPU deposits when false) */
  readonly live = true;
  /** each dancer slot's power form, 0 … 1: fire toward plasma, water toward ice. The game sets it; a loadout layer's
   *  own `params.form` (a number) wins for that layer */
  readonly forms: number[] = new Array(LIMITS.dancers).fill(0);
  /** how much of each dancer slot's matter is on its body, 0 … 1 (default 1): the show or the game lowers it while a
   *  body is in a heap or shattered, so a skeleton without its matter gives the air no heat or wet (it still stirs) */
  readonly presence: number[] = new Array(LIMITS.dancers).fill(1);
  /** ?aura=…: kinds dancer d is treated as wearing, for the field only (null: what the loadout says) */
  auraOverride: (string | null)[] = [];

  private A: Texture;
  private B: Texture;
  private nextA: Texture;
  private nextB: Texture;
  private box: UniformBuffer<FieldBox>;
  private sim: UniformBuffer<FieldSim>;
  private probes: UniformBuffer<Probes>;
  private readings: StorageBuffer;
  private boxData = { origin: [0, 0, 0] as V3, cell: 0, prev: [0, 0, 0] as V3, on: 0, dims: [0, 0, 0] as V3, pad: 0 };
  private auras = new Float32Array(AURA_SLOTS * 4);
  private pending: Deposit[] = [];
  private recent: Deposit[] = [];
  private dropped = 0;
  private vortices = new Map<string, Vortex>();
  private probeMap = new Map<string, Probe>();
  private probePoints = new Float32Array(MAXP * 4);
  private stage: GPUBuffer[];
  private busy = [false, false, false];
  private ring = 0;
  private copied = -1;
  private copiedIds: (string | null)[] = [];
  private copiedFrame = 0;
  private started = false;
  private frameNo = 0;
  private lastDeposits = 0;
  private lastVortices = 0;

  constructor(o: FieldOptions) {
    const kit = o.kit;
    this.dims = o.dims ?? (o.coarse ? [32, 24, 32] : [48, 32, 48]);
    this.cell = o.cell ?? (o.coarse ? 0.26 : 0.18);
    this.cells = this.dims[0];
    this.halfSize = (this.dims[0] * this.cell) / 2;
    const q = o.query;
    if (q?.has('field')) fieldParams.overlay = true;
    if (q?.has('vortex')) fieldParams.testVortex = Number(q.get('vortex')) || 3;
    if (q?.get('aura')) this.auraOverride = q.get('aura')!.split(',').map((k) => k.trim() || null);

    const tex = (label: string, usage: ('sample' | 'storage' | 'copy-src' | 'copy-dst')[]) =>
      kit.texture({ label, format: 'rgba16float', size: [...this.dims], dimension: '3d', usage });
    this.A = tex('field.a', ['sample', 'copy-dst']);
    this.B = tex('field.b', ['sample', 'copy-dst']);
    this.nextA = tex('field.a.next', ['storage', 'copy-src']);
    this.nextB = tex('field.b.next', ['storage', 'copy-src']);
    this.box = kit.uniforms(fieldShader.structs.FieldBox, 'field.box');
    this.sim = kit.uniforms(stepShader.structs.FieldSim, 'field.sim');
    this.probes = kit.uniforms(probeShader.structs.Probes, 'field.probes');
    this.readings = kit.storage({ label: 'field.readings', size: READ_BYTES, usage: ['storage', 'copy-src'] });
    this.stage = [0, 1, 2].map((i) => kit.device.createBuffer({ label: `field.readings.read${i}`, size: READ_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    this.box.set(this.boxData);

    // group 3 as every matter shader sees it: the bodies' buffers and the field (see the opening note)
    const b = o.bodies;
    kit.shareGroup(3, groupShader, { joints: b.joints, segs: b.segs, bodies: b.bodies, touch: b.touch, fieldA: this.A, fieldB: this.B, fieldBox: this.box }, 'bodies+field');

    const [X, Y, Z] = this.dims;
    const step = kit.compute(stepShader, { label: 'field.step', threads: [X, Y, Z], bind: { sim: this.sim, nextA: this.nextA, nextB: this.nextB } });
    const copy: RawItem = kit.raw((enc) => {
      enc.copyTextureToTexture({ texture: this.nextA.gpu }, { texture: this.A.gpu }, [X, Y, Z]);
      enc.copyTextureToTexture({ texture: this.nextB.gpu }, { texture: this.B.gpu }, [X, Y, Z]);
    }, 'field.copy');
    const probe = kit.compute(probeShader, { label: 'field.probe', threads: [MAXP], bind: { probes: this.probes, readings: this.readings }, enabled: () => this.probeMap.size > 0 });
    const readCopy = kit.raw((enc) => {
      this.copied = -1;
      if (!this.probeMap.size || this.busy[this.ring]) return;
      enc.copyBufferToBuffer(this.readings.gpu, 0, this.stage[this.ring], 0, READ_BYTES);
      this.copied = this.ring;
    }, 'field.probe.copy');
    o.frame.add('sim', step, 'field');
    o.frame.add('sim', copy, 'field');
    o.frame.add('sim', probe, 'field');
    o.frame.add('sim', readCopy, 'field');
    // deposits, vortices and probes made by anyone up to the end of the 'matter' phase land this frame
    o.frame.tick('post', () => this.flush(), 'field: this frame\'s deposits, vortices and probe points');
    o.frame.after(() => this.readBack(), 'field: probe readings');
  }

  // ---------------------------------------------------------------- what the game and kinds put in
  /** a point deposit for this frame (up to LIMITS.fieldDeposits a frame; more are dropped and counted in stats) */
  deposit(d: Deposit) {
    if (this.pending.length >= MAXD) { this.dropped++; return; }
    this.pending.push(d);
  }

  /** the deposits that went into the field last frame (steam is born round them too) */
  recentDeposits(): readonly Deposit[] { return this.recent; }

  /** set (or with null, remove) the vortex source named `id`; it stays until changed (up to LIMITS.fieldVortices) */
  vortex(id: string, v: Vortex | null) {
    if (!v) { this.vortices.delete(id); return; }
    if (!this.vortices.has(id) && this.vortices.size >= MAXV) throw new Error(`field: more than ${MAXV} vortex sources`);
    this.vortices.set(id, v);
  }

  /** watch the field at p (a named probe, moved each call) and return the last reading there: one to three frames
   *  late (reading.frame says when), null until the first comes back. Up to LIMITS.fieldProbes names at once */
  probe(id: string, p: V3): FieldReading | null {
    let pr = this.probeMap.get(id);
    if (!pr) {
      const used = new Set([...this.probeMap.values()].map((x) => x.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      if (slot >= MAXP) throw new Error(`field: more than ${MAXP} probes`);
      this.probeMap.set(id, (pr = { slot, at: [...p], reading: null }));
    }
    pr.at[0] = p[0]; pr.at[1] = p[1]; pr.at[2] = p[2];
    return pr.reading;
  }

  /** how strongly the air rises at p (m/s, averaged up 0.75 m above it): steam and flame lift a jump. One to three
   *  frames late; 0 until the first reading */
  updraft(id: string, p: V3): number { return this.probe(id, p)?.up ?? 0; }

  /** stop watching a probe */
  unprobe(id: string) { this.probeMap.delete(id); }

  // ---------------------------------------------------------------- each frame
  /** in the 'dancers' phase, after the joints are up: follow the dancers, lay out the auras, set the step */
  update(f: FrameCtx) {
    this.frameNo = f.frame;
    const D = Math.min(f.dancers.length, LIMITS.dancers);
    if (D) {
      let x = 0, y = 0, z = 0;
      for (let d = 0; d < D; d++) { const w = f.dancers[d].skeleton.world; x += w[0]; y += w[1]; z += w[2]; }
      this.centre[0] = x / D; this.centre[1] = y / D; this.centre[2] = z / D;
    }
    const prev: V3 = [...this.origin];
    // the box in whole cells, its floor 1.3 m under the hips (steam and flame rise: most of it is above)
    const snap = (v: number) => Math.round(v / this.cell) * this.cell;
    this.origin[0] = snap(this.centre[0] - this.halfSize);
    this.origin[1] = snap(this.centre[1] - 1.3);
    this.origin[2] = snap(this.centre[2] - (this.dims[2] * this.cell) / 2);
    if (!this.started) { prev[0] = this.origin[0]; prev[1] = this.origin[1]; prev[2] = this.origin[2]; this.started = true; }
    Object.assign(this.boxData, { origin: [...this.origin], cell: this.cell, prev, on: 1, dims: [...this.dims] });
    this.box.set(this.boxData);

    this.layAuras(f, D);
    const P = fieldParams;
    this.sim.set({
      dt: Math.min(Math.max(f.danceDt, 0), 1 / 20), time: f.t, capsules: CAPSULES.length,
      windDecay: P.windDecay, hotDecay: P.hotDecay, coldDecay: P.coldDecay, wetDecay: P.wetDecay, diffuse: P.diffuse,
      buoyancy: P.buoyancy, sink: P.sink, drag: P.drag, auraRate: P.auraRate, reach: P.reach, exchange: P.exchange,
      melt: P.melt, steamGain: P.steamGain, windMax: P.windMax, vortexRate: P.vortexRate, auras: this.auras,
    });
  }

  /** each capsule slot's aura: the layers worn on its part, by share, at the dancer's form */
  private layAuras(f: FrameCtx, D: number) {
    this.auras.fill(0);
    const perPart = new Map<BodyPart, [number, number, number, number]>();
    for (let d = 0; d < D; d++) {
      const forced = this.auraOverride[d];
      const layers: readonly LoadoutLayer[] = forced ? [{ kind: forced, share: 1 }] : f.dancers[d].loadout.layers;
      for (const part of BODY_PARTS) {
        let total = 0;
        const acc: [number, number, number, number] = [0, 0, 0, 0];
        for (const l of layers) if (l.share > 0 && (!l.parts || l.parts.includes(part))) total += l.share;
        for (const l of layers) {
          if (!(l.share > 0) || (l.parts && !l.parts.includes(part))) continue;
          const form = typeof l.params?.form === 'number' ? (l.params.form as number) : this.forms[d] ?? 0;
          const a = auraOf(l.kind, form), w = l.share / total;
          const k = w * Math.min(1, Math.max(0, this.presence[d] ?? 1));
          acc[0] += a.heat * k; acc[1] += a.wet * k; acc[2] += a.dry * k; acc[3] += a.stir * w;
        }
        if (!total) acc[3] = 1;   // bare skeleton still moves the air
        perPart.set(part, acc);
      }
      CAPSULES.forEach((c, s) => this.auras.set(perPart.get(c.part)!, (d * LIMITS.capsules + s) * 4));
    }
  }

  /** in the 'post' phase: this frame's deposits, vortex sources and probe points into their uniforms */
  private flush() {
    const deposit = this.pending.map((d) => ({
      at: [d.p[0], d.p[1], d.p[2], d.r] as [number, number, number, number],
      wind: [d.wind?.[0] ?? 0, d.wind?.[1] ?? 0, d.wind?.[2] ?? 0, d.wind ? d.windWeight ?? 1 : 0] as [number, number, number, number],
      levels: [d.heat ?? 0, d.wet ?? 0, 0, 0] as [number, number, number, number],
    }));
    this.lastDeposits = deposit.length;
    [this.recent, this.pending] = [this.pending, this.recent];
    this.pending.length = 0;
    const vs = [...this.vortices.values()];
    if (fieldParams.testVortex > 0) {
      const s = fieldParams.testVortex;
      vs.push({ at: [this.centre[0], this.centre[1] + 0.1, this.centre[2]], strength: s, radius: 0.55, inflow: 0.25 * s, lift: 0.3 * s, height: 1.4 });
    }
    const vortex = vs.slice(0, MAXV).map((v) => {
      const ax = v.axis ?? [0, 1, 0];
      return {
        at: [v.at[0], v.at[1], v.at[2], v.radius] as [number, number, number, number],
        axis: [ax[0], ax[1], ax[2], v.strength] as [number, number, number, number],
        flow: [v.inflow ?? 0, v.lift ?? 0, v.height ?? 2 * v.radius + 1, 0] as [number, number, number, number],
      };
    });
    this.lastVortices = vortex.length;
    this.sim.set({ deposits: deposit.length, vortices: vortex.length, ...(deposit.length ? { deposit } : {}), ...(vortex.length ? { vortex } : {}) });
    if (this.probeMap.size) {
      for (const p of this.probeMap.values()) this.probePoints.set([p.at[0], p.at[1], p.at[2], 0], p.slot * 4);
      this.probes.set({ at: this.probePoints, count: Math.max(...[...this.probeMap.values()].map((p) => p.slot)) + 1 });
      this.copiedIds = new Array(MAXP).fill(null);
      for (const [id, p] of this.probeMap) this.copiedIds[p.slot] = id;
      this.copiedFrame = this.frameNo;
    }
  }

  /** after the run: map the readings just copied, and hand them to their probes */
  private readBack() {
    if (this.copied < 0) return;
    const slot = this.copied, buf = this.stage[slot], ids = this.copiedIds, frame = this.copiedFrame;
    this.ring = (this.ring + 1) % 3;
    this.busy[slot] = true;
    void buf.mapAsync(GPUMapMode.READ).then(() => {
      const r = new Float32Array(buf.getMappedRange().slice(0));
      buf.unmap();
      this.busy[slot] = false;
      ids.forEach((id, i) => {
        const p = id ? this.probeMap.get(id) : undefined;
        if (!p || p.slot !== i) return;
        const o = i * 8;
        p.reading = { wind: [r[o], r[o + 1], r[o + 2]], heat: r[o + 4], wet: r[o + 5], steam: r[o + 6], up: r[o + 7], frame };
      });
    }, () => { this.busy[slot] = false; });
  }

  // ---------------------------------------------------------------- for the overlay and the stats
  stats() {
    return {
      cells: this.dims.join('×'), cell: this.cell, origin: this.origin.map((v) => +v.toFixed(2)).join(','),
      deposits: this.lastDeposits, dropped: this.dropped, vortices: this.lastVortices, probes: this.probeMap.size,
      aura: this.auraOverride.filter(Boolean).join(',') || 'loadouts',
    };
  }
}

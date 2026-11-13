// How hard the frame works, per class of device. Three classes (desktop, laptop, phone) each have a budget: the frame
// rate held to, the GPU time the autoscaler aims for, the render scale's range and the pixel-ratio cap, and the counts
// and fill each matter kind and world should run at (the BUDGETS table). The class is chosen once at start, before any
// kind is declared (main.ts): a phone's browser is a phone; anything else runs a probe of up to two seconds (additive
// fill into a 1024² half-float target, timed by the queue, so it works where timestamps don't) and its score picks the
// class. The result is kept per adapter in localStorage, so only a browser's first visit pays for the probe.
// `?class=desktop|laptop|phone` forces it; `?probe` probes again. `coarse` (what kinds and worlds read today) is
// `class === 'phone'`, exactly as the pointer test was on a phone; a laptop changes only what this file applies (the
// autoscaler, the render scale's range, the pixel-ratio cap) until each owner reads its numbers from BUDGETS.
// Dynamic resolution: weft's AutoResolution (or FrameBudget where the GPU's timestamps can't be trusted, as on WebKit,
// and on phones) holds the class's GPU budget by moving the render scale; a film or a capture turns it off so frames
// repeat exactly. The probe's thresholds come from this PC's RTX 5090 (docs/reports/4-perf.md); the Apple numbers
// behind the laptop and phone rows are estimates until the Macs' ?perf runs land in docs/reports/perf/.
import { AutoResolution, FrameBudget, isPhone, isWebKit, isAppleGpu, gpuName, type Kit } from '@ericrius1/weft';
import { defineParams, onParams } from './params';

export const perfParams = defineParams('perf', { autoRes: true, renderScale: 1 }, {
  autoRes: { label: 'dynamic resolution' },
  renderScale: { min: 0.25, max: 2, label: 'render scale' },
});

// ---------------------------------------------------------------- the budget table
export type DeviceClass = 'desktop' | 'laptop' | 'phone';
export const DEVICE_CLASSES: readonly DeviceClass[] = ['desktop', 'laptop', 'phone'];

export interface Budget {
  /** the frame rate the class is held to */
  targetFps: number;
  /** the GPU time per frame the autoscaler aims for (ms): under 1000 / targetFps, with room for the CPU and spikes */
  gpuMs: number;
  /** the render scale's range (× the canvas): the autoscaler moves between these; it starts at max */
  renderScale: { min: number; max: number };
  /** devicePixelRatio is capped here (a Retina laptop at 2 renders 4× the pixels of its CSS size) */
  maxPixelRatio: number;
  /** what kinds and worlds read today (MatterCtx.coarse, WorldCtx.coarse): true lowers their counts */
  coarse: boolean;
  /** gem particles across all dancers (showParams.count; a programme's own count is scaled by count / 15 000) */
  stones: number;
  /** flame particles for one dancer wearing only fire or plasma (fireParams.perDancer) */
  flamesPerDancer: number;
  /** water / ice particles for one dancer wearing only water (waterParams.perDancer) */
  waterPerDancer: number;
  /** the water surface's resolution × its view's (waterParams.resolution), and its smoothing passes */
  waterResolution: number;
  waterSmooth: number;
  /** steam puffs (steamParams.pool) */
  steam: number;
  /** × the size on screen of the sprites that still overdraw (steam's wisps, ice's mist): fill is size², so 0.85 is
   *  0.72 the fill. The phone's is 1 for now: its counts and resolutions are what `coarse` always gave, and the fill
   *  the critique worried about (flames, smoke, steam) was cut by fire's field and steam's cap; a phone's measured
   *  run should set it (docs/reports/5-integration.md) */
  spriteScale: number;
  /** the matter field's grid (cells) and its cell size (m) */
  field: { dims: [number, number, number]; cell: number };
  /** live gate views at once and their resolution × the main view's (portalParams.live, .scale) */
  gates: { live: number; scale: number };
  /** the depth of field (postParams.dof) */
  dof: boolean;
  /** free dancers ringing a jogo the game plays against the partner or on one screen (src/ai's roda) */
  roda: number;
}

/** per class: what the frame may cost. Desktop is today's numbers (the 5090's); phone is today's `coarse` numbers plus
 *  the fill cut the critique asked for; laptop sits between, aimed at 60 fps on an M-series Pro / Max (estimates) */
export const BUDGETS: Record<DeviceClass, Budget> = {
  desktop: {
    targetFps: 60, gpuMs: 14, renderScale: { min: 0.5, max: 1 }, maxPixelRatio: 2, coarse: false,
    stones: 15_000, flamesPerDancer: 60_000, waterPerDancer: 100_000, waterResolution: 1, waterSmooth: 3, steam: 6000,
    spriteScale: 1, field: { dims: [48, 32, 48], cell: 0.18 }, gates: { live: 2, scale: 0.5 }, dof: true, roda: 4,
  },
  laptop: {
    targetFps: 60, gpuMs: 12, renderScale: { min: 0.5, max: 1 }, maxPixelRatio: 1.5, coarse: false,
    stones: 12_000, flamesPerDancer: 36_000, waterPerDancer: 60_000, waterResolution: 0.75, waterSmooth: 2, steam: 4000,
    spriteScale: 0.85, field: { dims: [40, 28, 40], cell: 0.21 }, gates: { live: 1, scale: 0.4 }, dof: true, roda: 2,
  },
  phone: {
    targetFps: 30, gpuMs: 26, renderScale: { min: 0.5, max: 0.85 }, maxPixelRatio: 2, coarse: true,
    stones: 9000, flamesPerDancer: 24_000, waterPerDancer: 40_000, waterResolution: 0.5, waterSmooth: 1, steam: 2000,
    spriteScale: 1, field: { dims: [32, 24, 32], cell: 0.26 }, gates: { live: 1, scale: 0.4 }, dof: false, roda: 0,
  },
};

/** probe scores (Gpix/s of additive half-float fill) at and above which a class is chosen. This PC's RTX 5090 scores
 *  about 250 (docs/reports/4-perf.md); desktop is from about a fifth of that, laptop from about a fortieth */
export const PROBE_CLASS = { desktop: 50, laptop: 6 } as const;

// ---------------------------------------------------------------- choosing the class
export interface ProbeResult {
  /** Gpix/s of additive rgba16float fill (the fragment does a little ALU too, as a flame's sprite does) */
  gpixPerS: number;
  /** ms the probe took, the instances per submit it settled on, an empty submit's round trip (ms) */
  ms: number;
  instances: number;
  latencyMs: number;
  samples: [number, number][];
}

export interface DeviceChoice {
  klass: DeviceClass;
  budget: Budget;
  coarse: boolean;
  /** how it was chosen: 'forced' (?class), 'phone' (the browser says so), 'fallback' (a software adapter), 'probe',
   *  'cache' (an earlier probe on this adapter), 'film' (a film is always desktop) */
  how: 'forced' | 'phone' | 'fallback' | 'probe' | 'cache' | 'film';
  probe: ProbeResult | null;
  /** what the adapter says it is, and what the browser's GL says (Chrome names the Apple chip there) */
  adapter: Record<string, string>;
  gpuName: string;
  appleGpu: boolean;
  webkit: boolean;
  /** the old guess, for comparison: a coarse pointer */
  pointerCoarse: boolean;
}

/** the class a probe score earns (a phone's browser never rises above phone) */
export function classOf(score: number): DeviceClass {
  return score >= PROBE_CLASS.desktop ? 'desktop' : score >= PROBE_CLASS.laptop ? 'laptop' : 'phone';
}

const CACHE = 'energybending.perf.class';

function adapterInfo(kit: Kit): Record<string, string> {
  const i = (kit.adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  const out: Record<string, string> = {};
  if (i) for (const k of ['vendor', 'architecture', 'device', 'description']) { const v = (i as unknown as Record<string, unknown>)[k]; if (v) out[k] = String(v); }
  return out;
}

/** pick the device class (see the file's opening note). `fresh`: probe even if a result is kept */
export async function chooseClass(kit: Kit, query: URLSearchParams, o: { film?: boolean; fresh?: boolean } = {}): Promise<DeviceChoice> {
  const adapter = adapterInfo(kit), name = gpuName();
  const base = {
    adapter, gpuName: name, appleGpu: isAppleGpu(name), webkit: isWebKit(),
    pointerCoarse: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
  };
  // (kept in perfState at once: kinds and worlds are declared after this, and read budget() then)
  const make = (klass: DeviceClass, how: DeviceChoice['how'], probe: ProbeResult | null = null): DeviceChoice =>
    (perfState.choice = { klass, budget: BUDGETS[klass], coarse: BUDGETS[klass].coarse, how, probe, ...base });
  const forced = query.get('class') as DeviceClass | null;
  if (forced && DEVICE_CLASSES.includes(forced)) return make(forced, 'forced');
  if (o.film) return make('desktop', 'film');
  if (isPhone()) return make('phone', 'phone');
  const fallback = (kit.adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter || /swiftshader|llvmpipe/i.test(`${Object.values(adapter).join(' ')} ${name}`);
  if (fallback) return make('phone', 'fallback');
  const key = `${Object.values(adapter).join('|')}|${name}|${navigator.userAgent}`;
  if (!o.fresh && !query.has('probe')) {
    try {
      const kept = JSON.parse(localStorage.getItem(CACHE) ?? 'null') as { key: string; probe: ProbeResult; at: number } | null;
      if (kept && kept.key === key && Date.now() - kept.at < 30 * 86400e3) return make(classOf(kept.probe.gpixPerS), 'cache', kept.probe);
    } catch { /* not kept */ }
  }
  let probe: ProbeResult | null = null;
  try { probe = await probeFill(kit); } catch (e) { console.warn('energybending: the perf probe failed', e); }
  if (!probe) return make('laptop', 'probe');
  try { localStorage.setItem(CACHE, JSON.stringify({ key, probe, at: Date.now() })); } catch { /* not kept */ }
  return make(classOf(probe.gpixPerS), 'probe', probe);
}

// ---------------------------------------------------------------- the probe
const PROBE_WGSL = /* wgsl */ `
struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> V {
  var q = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: V;
  o.p = vec4f(q[vi], 0.0, 1.0);
  o.uv = q[vi] * 0.5 + 0.5 + vec2f(f32(ii) * 0.013, f32(ii) * 0.007);
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  // (a flame sprite's worth of work: a soft falloff and a little noise, then additive blending)
  var x = i.uv;
  var a = 0.0;
  for (var k = 0; k < 4; k++) { x = fract(x * 1.7 + vec2f(0.31, 0.17)); a += exp(-dot(x - 0.5, x - 0.5) * 8.0); }
  return vec4f(a * 0.001, a * 0.0005, 0.0002, 0.001);
}`;

/** up to ~2 s: additive fill of K full-target triangles into 1024², timed by the queue's round trip, at K and 2K so the
 *  fixed latency (≈ 40 ms on WebKit) cancels; the best of each is kept (another tab's work only ever adds) */
export async function probeFill(kit: Kit, limitMs = 2000): Promise<ProbeResult> {
  const d = kit.device, t0 = performance.now(), S = 1024;
  const tex = d.createTexture({ label: 'perf.probe', size: [S, S], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const view = tex.createView();
  const module = d.createShaderModule({ label: 'perf.probe', code: PROBE_WGSL });
  const pipe = await d.createRenderPipelineAsync({
    label: 'perf.probe', layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list' },
  });
  const run = async (k: number) => {
    const enc = d.createCommandEncoder({ label: 'perf.probe' });
    const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    if (k > 0) { p.setPipeline(pipe); p.draw(3, k); }
    p.end();
    const a = performance.now();
    d.queue.submit([enc.finish()]);
    await d.queue.onSubmittedWorkDone();
    return performance.now() - a;
  };
  await run(8);   // (first use: allocation, the pipeline's first bind)
  let latency = Infinity;
  for (let i = 0; i < 3; i++) latency = Math.min(latency, await run(0));
  // grow until a submit's work stands well clear of the round trip
  let k = 16, t = 0;
  for (; k < 16384; k *= 2) { t = await run(k); if (t - latency > 15 || performance.now() - t0 > limitMs * 0.45) break; }
  const samples: [number, number][] = [];
  let a = Infinity, b = Infinity;
  while (performance.now() - t0 < limitMs && samples.length < 12) {
    const ta = await run(k), tb = await run(2 * k);
    samples.push([+ta.toFixed(2), +tb.toFixed(2)]);
    a = Math.min(a, ta); b = Math.min(b, tb);
  }
  tex.destroy();
  // (Mpix per ms is Gpix per s; where the difference drowns in noise, the 2K submit less the round trip)
  const mpix = (k * S * S) / 1e6;
  const diff = b - a;
  const gpix = diff > 0.5 ? mpix / diff : (2 * mpix) / Math.max(0.5, b - Math.min(latency, b * 0.5));
  return { gpixPerS: +gpix.toFixed(1), ms: Math.round(performance.now() - t0), instances: k, latencyMs: +latency.toFixed(2), samples };
}

// ---------------------------------------------------------------- applying it
export interface PerfState {
  choice: DeviceChoice | null;
  /** the autoscaler the class runs (null: fixed, a film's) */
  auto: AutoResolution | null;
  /** reapply the params (the autoscaler on or off, the fixed scale) */
  apply: () => void;
}
export const perfState: PerfState = { choice: null, auto: null, apply: () => {} };

/** this device's budget (desktop's before the class is chosen): what a kind or world reads at declare, e.g.
 *  `import { budget } from '../../engine/perf'; const per = budget().flamesPerDancer;` */
export const budget = (): Budget => perfState.choice?.budget ?? BUDGETS.desktop;
/** this device's class ('desktop' before it is chosen) */
export const deviceClass = (): DeviceClass => perfState.choice?.klass ?? 'desktop';

/** the autoscaler for the class: FrameBudget (paces by the frames) on WebKit and phones, AutoResolution elsewhere */
export function makeAutoscaler(kit: Kit, b: Budget, phone: boolean): AutoResolution {
  const range = { min: b.renderScale.min, max: b.renderScale.max };
  if (phone || isWebKit() || !kit.profiler.available) return new FrameBudget(b.gpuMs, { ...range, keep: null });
  return new AutoResolution(b.gpuMs, range);
}

export function applyPerf(kit: Kit, fixed: boolean, choice: DeviceChoice | null = null) {
  const b = (choice ?? perfState.choice)?.budget ?? BUDGETS.desktop;
  const auto = fixed ? null : makeAutoscaler(kit, b, choice?.klass === 'phone');
  if (!fixed) { kit.maxPixelRatio = b.maxPixelRatio; kit.renderScale = b.renderScale.max; }
  const apply = () => {
    kit.autoRes = perfParams.autoRes && auto ? auto : null;
    if (!kit.autoRes) kit.renderScale = perfParams.renderScale;
  };
  apply();
  onParams(perfParams, apply);
  Object.assign(perfState, { choice: choice ?? perfState.choice, auto, apply });
  return apply;
}

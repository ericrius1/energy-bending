// ?perf=<suite>&sink=<url>: the page measures itself on whatever device opens it and reports back (scripts/
// perf-remote.mjs serves the build and the sink over the tailnet; scripts/perf-report.mjs makes the table). No click
// is needed: the sound starts only if the browser allows it without one. The suite stages each scene with `bend` calls
// (the critic's six from scripts/steps/critic-timings.json, then gem dancers in each world, a fire and water pair wide
// and close in the Pool and the redwoods, the geode hub with two live gates, the locked temple), and for each runs it
// in real time twice: with the class's autoscaler (what a player gets) and at render scale 1 (the true cost). Each run
// warms up, then for a few seconds records the frames' intervals from requestAnimationFrame (against the display's
// refresh, found first with the app paused), the JS time per frame and per CPU phase, weft's GPU times per pass (and
// whether they can be trusted here), the render scale and size, the pixel ratio, the live gates and the matter's
// counts. The scenes that need `?play&two` run in one page load and the gem dancers in another: the page reloads
// itself between the two, carrying its results in sessionStorage. Results are POSTed to the sink after every scene
// (the last POST says done), kept in window.__perf, shown on the page with a copy button, and the body gets
// data-perf="done" with a "PERF DONE" marker.
//   ?perf=default (≈ 6 min) | quick (≈ 2.5 min)   &perfscenes=id,id (only those)   &device=name (the report's column)
import type { Kit } from '@ericrius1/weft';
import type { Bend } from './hooks';
import type { FrameBuilder, FrameCtx } from './frame';
import { PHASES } from './frame';
import type { ViewCtx } from './views';
import { perfState, BUDGETS, type DeviceChoice } from './perf';

// ---------------------------------------------------------------- the suite
type Group = 'play' | 'gems';
interface Scene {
  id: string;
  group: Group;
  /** device pixels of the canvas, or the window as it is (what a player gets) */
  size: [number, number] | 'native';
  note: string;
  setup(b: Bend, run: RunCtx): Promise<void>;
  /** every frame while it runs (t: seconds since the scene was staged) */
  each?(b: Bend, t: number): void;
}
interface RunCtx { wait(s: number): Promise<void> }

const GROUP_QUERY: Record<Group, string[]> = { play: ['play', 'two'], gems: [] };
const FOLLOW = { followDist: 4.6, followPitch: 0.22, followFov: 48, followSwing: 1.6 };
const dusk = (b: Bend) => b.set('redwoods', { hour: 19.4, dayGoes: false });

async function pair(b: Bend, world: string, dress: [string, string], cam: Partial<typeof FOLLOW>, at: [number, number, number, number]) {
  b.lock(false);
  await b.world(world);
  if (world === 'redwoods') dusk(b);
  b.dress(0, dress[0]); b.dress(1, dress[1]);
  b.set('camera', { ...FOLLOW, ...cam });
  b.wake();
  b.place(0, at[0], at[1], Math.PI / 2); b.place(1, at[2], at[3], -Math.PI / 2);
}

// the critic's staging (scripts/steps/critic-timings.json), as bend calls
const critic = (size: [number, number]): Scene[] => {
  const tag = size[0] === 1280 ? '800' : '1080';
  return [
    { id: `critic-${tag}-redwoods-close`, group: 'play', size, note: 'fire and water, redwoods at dusk, close (two live gates)',
      setup: async (b) => { await pair(b, 'redwoods', ['fire', 'water'], { followDist: 3.2, followFov: 46, followPitch: 0.12, followSwing: 0 }, [-0.6, 0.4, 0.6, 0.4]); b.move(0, 'armada'); } },
    { id: `critic-${tag}-geode-hub-pair`, group: 'play', size, note: 'fire and water in the geode hub, wide, two live gates',
      setup: async (b) => { await pair(b, 'geode', ['fire', 'water'], { followDist: 5.5, followFov: 50, followPitch: 0.12, followSwing: 0 }, [-0.6, 1.0, 0.6, 1.0]); b.camera({ yaw: -2.9 }); },
      each: (b) => { b.camera({ yaw: -2.9 }); } },
  ];
};
const criticIce = (size: [number, number]): Scene => ({
  id: `critic-${size[0] === 1280 ? '800' : '1080'}-ice-plasma`, group: 'play', size, note: 'plasma and ice, temple',
  setup: async (b) => { await pair(b, 'temple', ['plasma', 'ice'], { followDist: 3.4, followFov: 46, followPitch: 0.1, followSwing: 0 }, [-0.6, 0, 0.6, 0]); },
});

export const SCENES: Scene[] = [
  ...critic([1280, 800]), ...critic([1920, 1080]),
  ...(['pool', 'redwoods'] as const).flatMap((w): Scene[] => [
    { id: `pair-${w}-wide`, group: 'play', size: 'native', note: `fire and water, ${w}, wide (7 m)`,
      setup: (b) => pair(b, w, ['fire', 'water'], { followDist: 7, followFov: 50, followPitch: 0.16, followSwing: 0 }, [-0.7, 0.4, 0.7, 0.4]) },
    { id: `pair-${w}-close`, group: 'play', size: 'native', note: `fire and water, ${w}, close (2.6 m)`,
      setup: (b) => pair(b, w, ['fire', 'water'], { followDist: 2.6, followFov: 46, followPitch: 0.1, followSwing: 0 }, [-0.5, 0.4, 0.5, 0.4]) },
  ]),
  { id: 'hub-gates', group: 'play', size: 'native', note: 'the geode hub, fire and water, two live gates',
    setup: async (b) => { await pair(b, 'geode', ['fire', 'water'], { followDist: 5.5, followFov: 50, followPitch: 0.12, followSwing: 0 }, [-0.6, 1.0, 0.6, 1.0]); b.camera({ yaw: -2.9 }); },
    each: (b) => { b.camera({ yaw: -2.9 }); } },
  { id: 'locked-temple', group: 'play', size: 'native', note: 'fire and water clashing in the temple, locked',
    setup: async (b, r) => {
      await pair(b, 'temple', ['fire', 'water'], { followSwing: 0 }, [-0.4, 0, 0.4, 0]);
      b.lock(true); await r.wait(1.5); b.place(0, -0.4, 0, Math.PI / 2); b.place(1, 0.4, 0, -Math.PI / 2);
    },
    // (a kick each way every 1.6 s keeps the flames and the water in each other)
    each: (() => { let last = -9; return (b: Bend, t: number) => { if (t - last > 1.6) { last = t; try { b.move(0, 'armada'); b.move(1, 'armada'); } catch { /* not now */ } } }; })() },
  criticIce([1280, 800]), criticIce([1920, 1080]),
  ...(['geode', 'redwoods', 'pool', 'temple'] as const).map((w): Scene => ({
    id: `gems-${w}`, group: 'gems', size: 'native', note: `gem dancers only, ${w}`,
    setup: async (b) => { await b.world(w); if (w === 'redwoods') dusk(b); b.wake(); },
  })),
];

const SUITES: Record<string, { autoWarm: number; fixedWarm: number; measure: number }> = {
  default: { autoWarm: 5, fixedWarm: 2.5, measure: 5 },
  quick: { autoWarm: 3, fixedWarm: 1.5, measure: 2.5 },
};

// ---------------------------------------------------------------- the run's state across page loads
const KEY = 'energybending.perf.run';
interface RunState { id: string; suite: string; startedAt: string; groups: Group[]; info: Record<string, unknown> | null; loads: unknown[]; scenes: SceneResult[]; errors: string[] }
const load = (): RunState | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const save = (s: RunState) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the POSTs still carry it */ } };

function scenesFor(query: URLSearchParams) {
  const only = query.get('perfscenes')?.split(',').filter(Boolean);
  return SCENES.filter((s) => !only || only.includes(s.id));
}

function urlFor(state: RunState, i: number) {
  const u = new URL(location.href);
  for (const k of ['play', 'two', 'perfgroup', 'perfrun', 'dress', 'world', 'lock']) u.searchParams.delete(k);
  for (const k of GROUP_QUERY[state.groups[i]]) u.searchParams.set(k, '');
  u.searchParams.set('perfgroup', String(i));
  u.searchParams.set('perfrun', state.id);
  return u.toString().replace(/=(?=&|$)/g, '');
}

/** the first load of ?perf: plan the page loads and go to the first (the promise never settles: the page is leaving) */
export function perfStart(query: URLSearchParams): Promise<never> {
  const suite = SUITES[query.get('perf') || 'default'] ? (query.get('perf') || 'default') : 'default';
  const groups = (['play', 'gems'] as Group[]).filter((g) => scenesFor(query).some((s) => s.group === g));
  const state: RunState = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, suite, startedAt: new Date().toISOString(), groups, info: null, loads: [], scenes: [], errors: [] };
  save(state);
  location.replace(urlFor(state, 0));
  return new Promise<never>(() => {});
}

// ---------------------------------------------------------------- measuring
interface Dist { n: number; mean: number; p50: number; p95: number; p99: number; max: number }
function dist(xs: number[]): Dist {
  if (!xs.length) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (v: number) => +v.toFixed(3);
  return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]) };
}

export interface RunStats {
  mode: 'auto' | 'fixed';
  seconds: number;
  frames: Dist & { fps: number; dropped: number; late: number };
  cpu: { frame: Dist; phases: Record<string, number> };
  gpu: { available: boolean; trusted: boolean; passesTrusted: boolean; frames: number; frame: Dist | null; passes: Record<string, number> };
  renderScale: { end: number; mean: number; min: number; max: number };
  render: number[];
  canvas: number[];
  dpr: number;
  liveGates: number;
}
interface SceneResult { id: string; note: string; group: Group; size: string; world: string; stageMs: number; runs: RunStats[]; matter: unknown; views: unknown; errors: string[] }

export interface PerfApp { bend: Bend; kit: Kit; frame: FrameBuilder; views: readonly ViewCtx[]; choice: DeviceChoice; ready: { pipelines?: number; failed: number } }

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));

export async function perfRun(app: PerfApp) {
  const { bend, kit, frame, views, choice } = app;
  const query = new URLSearchParams(location.search);
  const bootMs = Math.round(performance.now());
  const gi = Number(query.get('perfgroup') ?? 0);
  let state = load();
  if (!state || state.id !== query.get('perfrun')) {
    // (no state carried over: this load's scenes alone)
    const g = (GROUP_QUERY.play.every((k) => query.has(k)) ? 'play' : 'gems') as Group;
    state = { id: query.get('perfrun') ?? 'lost', suite: query.get('perf') || 'default', startedAt: new Date().toISOString(), groups: [g], info: null, loads: [], scenes: [], errors: ['the run state was lost between page loads: only this load\'s scenes'] };
  }
  const st = state;
  const group = st.groups[gi] ?? st.groups[0];
  const suite = SUITES[st.suite] ?? SUITES.default;
  const ui = overlay();
  const errors: string[] = [];
  collectErrors(kit, errors);

  // the sound only where it may start without a click (else the clock runs on the page's time, as before a touch)
  const audio = await audioAllowed();
  if (!audio) (bend.music as unknown as { start: () => void }).start = () => {};

  // the CPU's time: the whole step (phases, encoding, submit) and each phase
  let stepMs = 0;
  const phaseMs: Record<string, number> = Object.fromEntries(PHASES.map((p) => [p, 0]));
  const step = kit.step.bind(kit);
  kit.step = (dt: number) => { const a = performance.now(); step(dt); stepMs = performance.now() - a; };
  const ticks = (frame as unknown as { ticks: { phase: string; fn: (f: FrameCtx) => void }[] }).ticks;
  if (Array.isArray(ticks)) {
    frame.update = (f: FrameCtx) => {
      for (const p of PHASES) { const a = performance.now(); for (const t of ticks) if (t.phase === p) t.fn(f); phaseMs[p] += performance.now() - a; }
    };
  }
  kit.profiler.force = true;

  ui.say(`perf: finding the display's refresh (group ${gi + 1} of ${st.groups.length})`);
  const refresh = await findRefresh(kit);
  const info = st.info ?? describeDevice(kit, choice, app.ready, audio);
  st.info = info;
  st.loads.push({ group, bootMs, refresh, url: location.href, class: choice.klass, how: choice.how, probe: choice.probe, ready: app.ready, audio });

  const canvas = kit.canvas;
  const setSize = async (size: Scene['size']) => {
    if (size === 'native') { canvas.style.width = ''; canvas.style.height = ''; }
    else {
      const dpr = Math.min(devicePixelRatio || 1, kit.maxPixelRatio);
      canvas.style.width = `${size[0] / dpr}px`; canvas.style.height = `${size[1] / dpr}px`;
    }
    for (let i = 0; i < 3; i++) await raf();
  };
  const wait = async (s: number, each?: (t: number) => void, t0 = performance.now()) => {
    const end = performance.now() + s * 1000;
    while (performance.now() < end) { const now = await raf(); each?.((now - t0) / 1000); }
  };

  /** one run: warm, then measure in real time */
  const measure = async (mode: 'auto' | 'fixed', sc: Scene, t0: number): Promise<RunStats> => {
    const b = choice.budget;
    if (mode === 'auto') { kit.renderScale = b.renderScale.max; kit.autoRes = perfState.auto; }
    else { kit.autoRes = null; kit.renderScale = 1; }
    const each = sc.each ? (t: number) => sc.each!(bend, t) : undefined;
    ui.say(`perf: ${sc.id} · ${mode} · warming`);
    await wait(mode === 'auto' ? suite.autoWarm : suite.fixedWarm, each, t0);
    ui.say(`perf: ${sc.id} · ${mode} · measuring`);
    const iv: number[] = [], cpu: number[] = [], gpu: number[] = [], scales: number[] = [], passSum = new Map<string, number>();
    for (const p of PHASES) phaseMs[p] = 0;
    let gates = 0, gateN = 0, serial = kit.profiler.serial, last = await raf(), n = 0;
    const end = performance.now() + suite.measure * 1000;
    const startPhase = { ...phaseMs };
    while (performance.now() < end) {
      const now = await raf();
      iv.push(now - last); last = now;
      cpu.push(stepMs);
      scales.push(kit.renderScale);
      const p = kit.profiler;
      if (p.serial !== serial) {
        serial = p.serial; gpu.push(p.lastFrameMs);
        for (const [k, v] of p.lastMs) passSum.set(k, (passSum.get(k) ?? 0) + v);
      }
      if (n++ % 10 === 0) { gates += views.filter((v) => v.id.startsWith('gate') && v.on()).length; gateN++; }
      each?.((now - t0) / 1000);
    }
    const frames = dist(iv), ref = refresh.ms;
    const dropped = iv.reduce((a, x) => a + Math.max(0, Math.round(x / ref) - 1), 0);
    const late = iv.filter((x) => x > ref * 1.5).length;
    const p = kit.profiler, trusted = p.available && p.trusted;
    return {
      mode, seconds: suite.measure,
      frames: { ...frames, fps: frames.mean ? +(1000 / frames.mean).toFixed(1) : 0, dropped, late },
      cpu: { frame: dist(cpu), phases: Object.fromEntries(PHASES.map((ph) => [ph, +((phaseMs[ph] - startPhase[ph]) / Math.max(1, iv.length)).toFixed(3)])) },
      gpu: {
        available: p.available, trusted, passesTrusted: trusted && !choice.appleGpu, frames: gpu.length,
        frame: gpu.length ? dist(gpu) : null,
        passes: Object.fromEntries([...passSum].map(([k, v]) => [k, +(v / Math.max(1, gpu.length)).toFixed(3)]).sort((a, b) => (b[1] as number) - (a[1] as number))),
      },
      renderScale: { end: kit.renderScale, mean: +(scales.reduce((a, x) => a + x, 0) / Math.max(1, scales.length)).toFixed(3), min: Math.min(...scales), max: Math.max(...scales) },
      render: [...kit.size.render], canvas: [...kit.size.canvas], dpr: kit.size.dpr,
      liveGates: +(gates / Math.max(1, gateN)).toFixed(2),
    };
  };

  const result = () => ({
    schema: 1, runId: st.id, suite: st.suite, startedAt: st.startedAt, at: new Date().toISOString(),
    device: query.get('device') ?? '', variant: variantOf(query), ...st.info, loads: st.loads, scenes: st.scenes,
    errors: [...st.errors, ...errors], done: false,
  });
  const sink = query.get('sink');
  const post = async (body: unknown) => {
    if (!sink) return 'no sink';
    try {
      const u = new URL(sink, location.href), same = u.origin === location.origin;
      const r = await fetch(u, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain' }, mode: same ? 'same-origin' : 'no-cors' });
      return same ? (r.ok ? 'posted' : `POST ${r.status}`) : 'posted (no-cors: unconfirmed)';
    } catch (e) { return `POST failed: ${e}`; }
  };

  const scenes = scenesFor(query).filter((s) => s.group === group);
  let i = 0;
  for (const sc of scenes) {
    i++;
    ui.say(`perf: ${sc.id} (${i}/${scenes.length}, group ${gi + 1}/${st.groups.length}) · staging`);
    const before = errors.length, a = performance.now();
    try {
      await setSize(sc.size);
      await sc.setup(bend, { wait: (s) => wait(s) });
      await kit.ready();
    } catch (e) { errors.push(`${sc.id} staging: ${e}`); }
    const stageMs = Math.round(performance.now() - a), t0 = performance.now();
    const runs: RunStats[] = [];
    for (const mode of ['auto', 'fixed'] as const) {
      try { runs.push(await measure(mode, sc, t0)); } catch (e) { errors.push(`${sc.id} ${mode}: ${e}`); }
    }
    let matter: unknown = null, vs: unknown = null;
    try { const s = bend.stats(); matter = s.matter; vs = s.views; } catch { /* none */ }
    st.scenes.push({ id: sc.id, note: sc.note, group, size: sc.size === 'native' ? 'native' : sc.size.join('x'), world: views[0].world, stageMs, runs, matter, views: vs, errors: errors.slice(before) });
    save(st);
    const r = runs.find((x) => x.mode === 'fixed');
    ui.line(`${sc.id}: ${r ? `${r.frames.mean.toFixed(1)} ms (${r.frames.fps} fps)` : '—'}${r?.gpu.frame ? ` · GPU ${r.gpu.frame.mean.toFixed(2)} ms` : ''}`);
    ui.say(`perf: ${sc.id} done · ${await post(result())}`);
  }
  // restore the window's own size, put the scaler back
  await setSize('native');
  perfState.apply();

  if (gi + 1 < st.groups.length) {
    st.errors.push(...errors);
    save(st);
    ui.say('perf: next page load');
    location.replace(urlFor(st, gi + 1));
    return;
  }
  const out = { ...result(), done: true, finishedAt: new Date().toISOString() };
  (window as unknown as { __perf: unknown }).__perf = out;
  const posted = await post(out);
  try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
  ui.done(out, posted);
}

function variantOf(q: URLSearchParams) {
  return [q.has('baseline') && 'baseline', q.get('class') && `class-${q.get('class')}`, q.get('perf') && q.get('perf') !== 'default' && q.get('perf'), q.has('perfscenes') && 'some']
    .filter(Boolean).join('-');
}

/** the display's refresh: rAF with the app paused, its median interval snapped to a common rate */
async function findRefresh(kit: Kit) {
  const cb = (kit as unknown as { frameCb?: (t: unknown) => void }).frameCb;
  kit.manual = true;
  await raf(); await raf();
  const iv: number[] = [];
  let last = await raf();
  for (let i = 0; i < 90; i++) { const now = await raf(); iv.push(now - last); last = now; }
  kit.manual = false;
  if (cb) kit.loop(cb);
  const med = dist(iv).p50, hz = 1000 / med;
  const RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 240, 360];
  const snap = RATES.find((r) => Math.abs(r - hz) / r < 0.04);
  return { hz: snap ?? +hz.toFixed(1), ms: 1000 / (snap ?? hz), medianMs: +med.toFixed(3), p95Ms: dist(iv).p95, snapped: !!snap };
}

async function audioAllowed() {
  try {
    const C = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    const c = new C();
    const ok = c.state === 'running';
    await c.close();
    return ok;
  } catch { return false; }
}

function collectErrors(kit: Kit, into: string[]) {
  for (const e of kit.errors.values()) into.push(`[weft ${e.kind}] ${e.label}: ${e.message}`);
  const orig = console.error.bind(console);
  console.error = (...a: unknown[]) => { if (into.length < 200) into.push(a.map(String).join(' ').slice(0, 400)); orig(...a); };
  addEventListener('error', (e) => into.push(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => into.push(`rejection: ${String((e as PromiseRejectionEvent).reason).slice(0, 400)}`));
  void kit.device.lost.then((i) => into.push(`device lost: ${i.reason} ${i.message}`));
}

function limitsOf(l: GPUSupportedLimits) {
  const o: Record<string, number> = {};
  for (const k in l) { const v = (l as unknown as Record<string, unknown>)[k]; if (typeof v === 'number') o[k] = v; }
  return o;
}

function describeDevice(kit: Kit, choice: DeviceChoice, ready: PerfApp['ready'], audio: boolean) {
  const a = kit.adapter as GPUAdapter & { info?: GPUAdapterInfo; isFallbackAdapter?: boolean };
  const info: Record<string, unknown> = {};
  if (a.info) for (const k in a.info) { const v = (a.info as unknown as Record<string, unknown>)[k]; if (typeof v !== 'function') info[k] = v; }
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean; brands?: { brand: string; version: string }[] }; deviceMemory?: number };
  const { budget: _b, ...cls } = choice;
  return {
    ua: navigator.userAgent, platform: nav.userAgentData?.platform ?? navigator.platform, mobile: nav.userAgentData?.mobile ?? null,
    brands: nav.userAgentData?.brands ?? null, cores: navigator.hardwareConcurrency ?? null, memoryGB: nav.deviceMemory ?? null,
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio, colorDepth: screen.colorDepth },
    window: { w: innerWidth, h: innerHeight },
    baseline: new URLSearchParams(location.search).has('baseline'),
    class: cls, budget: choice.budget, budgets: BUDGETS,
    adapter: { info, isFallbackAdapter: a.isFallbackAdapter ?? null, features: [...a.features].sort(), limits: limitsOf(a.limits) },
    gpuDevice: { features: [...kit.device.features].sort(), limits: limitsOf(kit.device.limits) },
    ready, audio: audio ? 'on' : 'off (the browser wants a click first)',
    profiler: { available: kit.profiler.available, note: choice.appleGpu ? 'Apple GPU: per-pass times describe the pass structure on a tile GPU more than their cost; the frame total is the number to read' : choice.webkit ? 'WebKit: timestamps are not trusted' : '' },
  };
}

// ---------------------------------------------------------------- on screen
function overlay() {
  const box = document.createElement('div');
  box.id = 'perf';
  Object.assign(box.style, { position: 'fixed', left: '12px', top: '12px', right: '12px', maxHeight: '90vh', overflow: 'auto', zIndex: '10', font: '12px ui-monospace, Menlo, Consolas, monospace', color: '#e8e2f0', background: 'rgba(5,4,9,0.72)', padding: '8px 10px', borderRadius: '6px', whiteSpace: 'pre-wrap', pointerEvents: 'auto' });
  const head = document.createElement('div'), lines = document.createElement('div');
  box.append(head, lines);
  document.body.append(box);
  return {
    say(t: string) { head.textContent = t; },
    line(t: string) { lines.textContent += `${t}\n`; },
    done(out: { scenes: SceneResult[]; errors: string[] }, posted: string) {
      document.body.dataset.perf = 'done';
      head.textContent = `PERF DONE · ${out.scenes.length} scenes · ${posted}${out.errors.length ? ` · ${out.errors.length} error(s)` : ''}`;
      head.id = 'perf-done';
      Object.assign(head.style, { fontWeight: '700', color: '#9cf59c' });
      const rows = out.scenes.map((s) => {
        const f = s.runs.find((r) => r.mode === 'fixed'), au = s.runs.find((r) => r.mode === 'auto');
        const cell = (r?: RunStats) => r ? `${r.frames.mean.toFixed(1)} ms ${String(r.frames.fps).padStart(5)} fps p95 ${r.frames.p95.toFixed(1)}${r.gpu.frame ? ` gpu ${r.gpu.frame.mean.toFixed(2)}` : ''} @${r.renderScale.end.toFixed(2)} ${r.render.join('x')}` : '—';
        return `${s.id.padEnd(28)} fixed ${cell(f)}\n${''.padEnd(28)} auto  ${cell(au)}`;
      });
      lines.textContent = rows.join('\n') + (out.errors.length ? `\n\nerrors:\n${out.errors.slice(0, 20).join('\n')}` : '');
      const btn = document.createElement('button');
      btn.textContent = 'copy the results (JSON)';
      Object.assign(btn.style, { margin: '8px 0', font: 'inherit', padding: '4px 8px' });
      btn.onclick = async () => {
        const text = JSON.stringify((window as unknown as { __perf: unknown }).__perf);
        try { await navigator.clipboard.writeText(text); btn.textContent = 'copied'; } catch {
          const ta = document.createElement('textarea'); ta.value = text; ta.style.width = '100%'; ta.rows = 6; box.append(ta); ta.select(); btn.textContent = 'select all and copy the box below';
        }
      };
      box.insertBefore(btn, lines);
    },
  };
}

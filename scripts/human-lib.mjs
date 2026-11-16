// Virtual human players on the real page (phase 7, report 24-feel): what scripts/human-play.mjs and human-score.mjs
// share. A "human" here is a policy that reads the screen's state a few times a second and presses REAL input on the
// page (puppeteer's keyboard, mouse and touchscreen: the page's own keydown/keyup/pointer events), with a person's
// imperfections: a reaction delay of 150 to 350 ms between seeing and pressing, keys rolled over (the next one down
// before the last one up), taps of 60 to 140 ms, hesitations, wrong keys, and presses meant for the beat landing a
// few tens of ms off it. Nothing is placed or scripted in the page (no bend.place, bend.intent or bend.duel.cast).
//
// The recorder (installRecorder) runs in the page on requestAnimationFrame and keeps, per frame: the frame's time, the
// camera (eye, yaw, pitch, lens), both bodies (the duel's simulated root and velocity, and the drawn hips), where each
// body's chest lands on screen, the duel camera's "unclean eye" flag, the link, the world, and running counts of the
// moments (the world's answers, the HUD's words, the duel's juice), plus every key and pointer event with its own time.
// summarize() turns that into the feel measures (human-score.mjs scores them).
import { launch, adapterName } from './lib/browser.mjs';

// ---------------------------------------------------------------- randomness a run can repeat
export function rng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.pick = (xs) => xs[Math.floor(r() * xs.length)];
  r.gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return u - 3; };
  /** a person's reaction: 150 … 350 ms, most near 220 */
  r.react = () => Math.max(150, Math.min(350, 220 + r.gauss() * 45));
  return r;
}
export const sleep = (ms) => new Promise((res) => setTimeout(res, Math.max(0, ms)));

// ---------------------------------------------------------------- the page
export async function openGame({ url, query, size = '1280x720', mobile = false, say = console.log }) {
  const [W, H] = size.split('x').map(Number);
  const browser = await launch({ width: W, height: H });
  const page = await browser.newPage();
  if (mobile) await page.emulate({ viewport: { width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); say('pageerror:', e.message.slice(0, 200)); });
  await page.goto(`${url}${query ? `?${query}` : ''}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
  return { browser, page, errors, adapter: await adapterName(page), W, H };
}

// ---------------------------------------------------------------- the recorder (in the page)
/** mode 'duel' | 'jogo'; me: the seat this human plays (the pair: both, me = 0) */
export async function installRecorder(page, { stepped = false } = {}) {
  await page.evaluate((stepped) => {
    // (stepped: the driver steps the page by hand and samples after each frame at its virtual time `vt`; the input
    // events are stamped with it too. Real time: requestAnimationFrame and the events' own times)
    const R = (window.__hr = { f: [], keys: [], ptr: [], on: true, worlds: [], t0: performance.now(), virtual: stepped, vt: 0 });
    const ts = (e) => (R.virtual ? R.vt : e.timeStamp);
    const wIdx = (id) => { let i = R.worlds.indexOf(id); if (i < 0) { i = R.worlds.length; R.worlds.push(id); } return i; };
    addEventListener('keydown', (e) => { if (!e.repeat) R.keys.push([ts(e), e.code, 1]); }, { capture: true });
    addEventListener('keyup', (e) => R.keys.push([ts(e), e.code, 0]), { capture: true });
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend']) addEventListener(ev, (e) => R.ptr.push([ts(e), ev, e.clientX ?? e.touches?.[0]?.clientX ?? 0, e.clientY ?? e.touches?.[0]?.clientY ?? 0]), { capture: true });
    const HIPS = 0;   // (the rig's root joint: rig.ts JOINT.Hips is 0)
    let last = null;
    const sample = (R.sample = (now) => {
      if (!R.on) return;
      const B = window.bend; if (!B?.kit) return;
      const cam = B.kit.camera, M = cam.viewProj, [w, h] = B.kit.size.render;
      const proj = (x, y, z) => {
        const cx = M[0] * x + M[4] * y + M[8] * z + M[12], cy = M[1] * x + M[5] * y + M[9] * z + M[13], cw = M[3] * x + M[7] * y + M[11] * z + M[15];
        if (cw <= 0.01) return [NaN, NaN];
        return [cx / cw, cy / cw];
      };
      const D = B.duel, J = B.jogo;
      const mode = D?.started ? 'duel' : J?.state ? 'jogo' : 'front';
      const ds = B.show?.dancers ?? [];
      const row = { gpu: B.kit.profiler?.frameMs ?? null, t: now, cx: cam.position[0], cy: cam.position[1], cz: cam.position[2], yaw: cam.yaw, pitch: cam.pitch, fov: cam.fovY, mode };
      for (let k = 0; k < 2; k++) {
        const d = ds[k], Wj = d?.skeleton?.world;
        const hx = Wj ? Wj[HIPS * 12] : NaN, hy = Wj ? Wj[HIPS * 12 + 1] : NaN, hz = Wj ? Wj[HIPS * 12 + 2] : NaN;
        row[`h${k}`] = [hx, hy, hz];
        const s = proj(hx, hy + 0.35, hz);
        row[`s${k}`] = s;
        if (D?.started) {
          const c = D.match.chars[k];
          row[`r${k}`] = [c.root[0], c.root[1], c.root[2]]; row[`v${k}`] = [c.v[0], c.v[1], c.v[2]]; row[`g${k}`] = c.grounded ? 1 : 0;
        }
      }
      if (D?.started) {
        const L = D.match.contact.link;
        row.link = L ? (L.holder === 0 ? 1 : 2) : 0;
        row.bad = D.camera.last?.bad > 0 ? 1 : 0; row.why = D.camera.last?.why || '';
        row.world = wIdx(D.world); row.phase = D.state.phase; row.frozen = D.match.frozen(0) ? 1 : 0;
        row.cross = D.crossings.length; row.answers = D.answer?.log?.length ?? 0;
        row.way = D.crossCam.ways; row.dyaw = D.camera.yaw; row.dpitch = D.camera.pitch;
      } else if (J?.state) {
        row.world = wIdx(B.gates?.rigWorld ?? '?'); row.phase = J.phase;
      }
      // (the HUD's words: its stats are not free, so read twice a second)
      row.pops = R.f.length % 30 === 0 ? (B.hud?.stats?.().pops?.most?.total ?? 0) : (last?.pops ?? 0);
      const info = B.music?.clock?.info; row.beats = info?.beats ?? null; row.bpm = info?.bpm ?? null;
      R.f.push(row);
      last = row;
    });
    const tick = (now) => { requestAnimationFrame(tick); if (!R.virtual) sample(now); };
    requestAnimationFrame(tick);
    R.lastRow = () => last;
  }, stepped);
}

/** what a human sees, a few times a second: both bodies, the camera's yaw, the world, the gates, the beat */
export async function look(page) {
  return page.evaluate(() => {
    const B = window.bend, D = B.duel, J = B.jogo, ds = B.show?.dancers ?? [];
    const hips = (k) => { const W = ds[k]?.skeleton?.world; return W ? [W[0], W[1], W[2]] : null; };
    const duel = !!D?.started;
    const world = duel ? D.world : (B.gates?.rigWorld ?? B.stats().world);
    const gates = [...(B.gates?.gates?.values() ?? [])].filter((g) => g.world === world && g.partner && g.open > 0.5)
      .map((g) => ({ id: g.id, at: [g.at[0], g.at[1], g.at[2]], n: [g.n[0], g.n[1], g.n[2]], r: g.radius, to: g.partner.world }));
    const info = B.music?.clock?.info;
    const o = {
      now: performance.now(), duel, world, gates, yaw: B.kit.camera.yaw,
      me: duel ? [...D.match.chars[0].root] : hips(0), other: duel ? [...D.match.chars[1].root] : hips(1),
      vel: duel ? [...D.match.chars[0].v] : null, grounded: duel ? D.match.chars[0].grounded : true,
      link: duel && D.match.contact.link ? { holder: D.match.contact.link.holder, age: D.match.contact.age } : null,
      phase: duel ? D.state.phase : J?.phase ?? 'front', beats: info?.beats ?? null, bpm: info?.bpm ?? null,
      crossings: duel ? D.crossings.length : (J?.stats?.().crossings?.length ?? 0),
    };
    if (!duel && J?.state) { o.me = hips(0); o.other = hips(1); }
    return o;
  });
}
export async function stopRecorder(page) {
  return page.evaluate(() => {
    const R = window.__hr; R.on = false;
    const D = window.bend.duel, J = window.bend.jogo;
    return {
      f: R.f, keys: R.keys, ptr: R.ptr, worlds: R.worlds,
      history: D?.started ? D.history.map((h) => ({ t: h.t, e: h.e })) : [],
      crossings: D?.started ? D.crossings : (J?.stats?.().crossings ?? []),
      crossCam: D?.started ? { ...D.crossCam } : null,
      jogoHist: J ? (J.history ?? []).slice(-2000).map((h) => ({ t: h.t ?? 0, k: h.k ?? h.e?.k ?? h.type ?? '?' })) : [],
      stats: D?.started ? D.stats() : null,
      gpu: window.bend.kit.profiler?.frameMs ?? null,
    };
  });
}

// ---------------------------------------------------------------- the clock: real time, or the page stepped by hand
/** Real: timers are the wall's. Stepped: the page runs only when this steps it (bend.step, 60 fps), the human's
 *  delays are counted in those frames, and the recorder samples after each one; so a run repeats on a busy machine
 *  and a before and after compare on the same seeds. Every coroutine that waits on the clock must be spawned through
 *  it (spawn, after), so the stepper knows when all of them are waiting and the next frame can run */
export class Clock {
  constructor(page, stepped) { this.page = page; this.stepped = stepped; this.t = 0; this.timers = []; this.busy = 0; this.w0 = Date.now(); this.frames = 0; }
  now() { return this.stepped ? this.t : Date.now() - this.w0; }
  sleep(ms) {
    if (!this.stepped) return sleep(ms);
    return new Promise((res) => { this.timers.push({ at: this.t + Math.max(0, ms), res }); this.busy--; });
  }
  spawn(fn) {
    this.busy++;
    const p = (async () => { try { return await fn(); } finally { this.busy--; } })();
    p.catch((e) => console.log('human:', e.message));
    return p;
  }
  after(ms, fn) { return this.spawn(async () => { await this.sleep(ms); await fn(); }); }
  /** a spawned coroutine another may await: while it is awaited, the awaiting one isn't counted busy (else the stepper
   *  would wait on a parent waiting on its child) */
  joinable(p) {
    const c = this;
    return { then(res, rej) { if (c.stepped) c.busy--; return p.then((v) => { if (c.stepped) c.busy++; return v; }, (e) => { if (c.stepped) c.busy++; throw e; }).then(res, rej); } };
  }
  /** run `main` to its end (stepped: frame by frame) */
  async run(main) {
    let done = false;
    const p = this.spawn(main).finally(() => { done = true; });
    if (!this.stepped) return p;
    while (!done) {
      for (let spin = 0; this.busy > 0 && !done; spin++) await new Promise((r) => setImmediate(r));
      if (done) break;
      await this.page.evaluate(async (t) => { const R = window.__hr; R.vt = t; await window.bend.step(1); R.vt = t + 1000 / 60; R.sample(R.vt); }, this.t);
      this.t += 1000 / 60; this.frames++;
      this.timers.sort((a, b) => a.at - b.at);
      while (this.timers.length && this.timers[0].at <= this.t) { const x = this.timers.shift(); this.busy++; x.res(); }
    }
    return p;
  }
}

/** stepped: the music's clock on the stepped frames (as duel-page.mjs: with no sound and no film it runs on the
 *  wall clock, which a stepped page leaves behind), and the resolution held */
export async function stepSetup(page) {
  await page.evaluate(() => {
    const B = window.bend, k = B.kit, M = B.music;
    k.manual = true; k.autoRes = null; k.renderScale = 1;
    M.filmClock = M.now(); M.now = () => M.filmClock; M.time = () => M.filmClock;
  });
}

// ---------------------------------------------------------------- hands: real keys, with a person's timing
export class Hands {
  constructor(page, r, clock, { name = 'hands', log = null } = {}) {
    this.page = page; this.r = r; this.clock = clock; this.held = new Set(); this.name = name; this.log = log; this.pending = new Map(); this.q = Promise.resolve();
  }
  /** serialise the page's input calls (puppeteer's keyboard keeps one modifier state; two at once can interleave) */
  run(fn) { this.q = this.q.then(fn).catch(() => {}); return this.q; }
  async down(code) { if (this.held.has(code)) return; this.held.add(code); await this.run(() => this.page.keyboard.down(code)); }
  async up(code) { if (!this.held.has(code)) return; this.held.delete(code); await this.run(() => this.page.keyboard.up(code)); }
  /** a tap: down, 60 … 140 ms, up (in the background unless awaited) */
  tap(code, holdMs = this.r.range(60, 140)) { return this.clock.joinable(this.clock.spawn(async () => { await this.down(code); await this.clock.sleep(holdMs); await this.up(code); })); }
  /** the move keys wanted now, set after a reaction delay; a change rolls over (the new key down before the old one up,
   *  20 … 80 ms), as fingers do. `now` true skips the delay (a key the human already meant, holding on) */
  steer(want, opts) { return this.clock.joinable(this.clock.spawn(() => this._steer(want, opts))); }
  async _steer(want, { react = true } = {}) {
    const key = [...want].sort().join(',');
    if (this.steering === key) return;
    this.steering = key;
    if (react) await this.clock.sleep(this.r.react());
    if (this.steering !== key) return;   // (changed its mind while reacting)
    const moves = this.moveKeys ?? [];
    for (const k of want) await this.down(k);
    const off = [...this.held].filter((k) => moves.includes(k) && !want.has(k));
    if (off.length) { await this.clock.sleep(this.r.range(20, 80)); for (const k of off) await this.up(k); }
  }
  async releaseAll() { this.steering = ''; for (const k of [...this.held]) await this.up(k); }
}

/** the move keys (camera-relative W A S D, or the arrows) that walk toward world direction (dx, dz), given the camera's
 *  yaw (weft: yaw 0 looks down -z, positive turns left). Eight ways, as a keyboard has; a dead zone keeps one key held
 *  when the way is nearly straight */
export function keysToward(dx, dz, yaw, L = { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' }, dead = 0.38) {
  const l = Math.hypot(dx, dz); const out = new Set();
  if (l < 1e-3) return out;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const f = (dx * fx + dz * fz) / l, r = (dx * rx + dz * rz) / l;
  if (f > dead) out.add(L.fwd); else if (f < -dead) out.add(L.back);
  if (r > dead) out.add(L.right); else if (r < -dead) out.add(L.left);
  return out;
}

/** ms until the music's next beat (or the one after, if the next is too close to react to), from a look() */
export function msToBeat(s, min = 120) {
  if (s.beats == null || !s.bpm) return null;
  const per = 60000 / s.bpm, frac = s.beats - Math.floor(s.beats);
  let ms = (1 - frac) * per;
  while (ms < min) ms += per;
  return ms;
}

// ---------------------------------------------------------------- the measures
const sortN = (x) => [...x].filter(Number.isFinite).sort((a, b) => a - b);
export const pct = (x, p) => { const s = sortN(x); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
export const mean = (x) => { const s = x.filter(Number.isFinite); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN; };
const DEG = 180 / Math.PI;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** the feel measures from a recording. moveKeys: the codes that mean "go"; jumpKeys: the jump; me: the seat */
export function summarize(rec, { moveKeys, jumpKeys = [], me = 0, H = 720, W = 1280, skipS = 1.5, stepped = false } = {}) {
  const F = rec.f.filter((r) => r.mode !== 'front');
  const out = { frames: F.length };
  if (F.length < 30) return out;
  const t0 = F[0].t + skipS * 1000, G = F.filter((r) => r.t >= t0);
  const mins = (G[G.length - 1].t - G[0].t) / 60000;
  out.minutes = +mins.toFixed(2);
  // frames
  const dts = []; for (let i = 1; i < G.length; i++) dts.push(G[i].t - G[i - 1].t);
  // (stepped by hand every frame is 16.7 ms: the pacing is only measured in real time)
  out.frame = stepped ? { stepped: true, gpuMs: mean(G.map((r) => r.gpu)) } : { gpuMs: mean(G.map((r) => r.gpu)), p50: pct(dts, 0.5), p95: pct(dts, 0.95), p99: pct(dts, 0.99), hitches: dts.filter((d) => d > 33.4).length, hitchPerMin: dts.filter((d) => d > 33.4).length / mins, fps: 1000 / mean(dts) };
  // the camera: the view's turn rate (yaw and pitch together, deg/s), its change, and its jerk; swings; the floor
  const av = [], aa = [], aj = [], ep = [];
  let swings = 0, inSwing = false, floor = 0, bad = 0, nb = 0, cuts = 0;
  const why = {};
  for (let i = 1; i < G.length; i++) {
    const a = G[i - 1], b = G[i], dt = Math.max(1e-3, (b.t - a.t) / 1000);
    // (a gate's carry or a world change turns the eye in one frame by design: not the camera's swing)
    if (b.world !== a.world || b.cross !== a.cross) { av.push(NaN); continue; }
    const dy = wrap(b.yaw - a.yaw) * Math.cos(b.pitch), dp = b.pitch - a.pitch;
    // (a cut: the eye a metre or more, or the view 40° or more, in one frame of the same world; counted, not a turn)
    if (Math.hypot(b.cx - a.cx, b.cy - a.cy, b.cz - a.cz) > 1 || Math.hypot(dy, dp) * DEG > 40) { cuts++; (out.cutAt ??= []).push(+((b.t - F[0].t) / 1000).toFixed(2)); av.push(NaN); continue; }
    av.push(Math.hypot(dy, dp) * DEG / dt);
    ep.push(Math.hypot(b.cx - a.cx, b.cy - a.cy, b.cz - a.cz) / dt);
  }
  for (let i = 1; i < av.length; i++) {
    const dt = Math.max(1e-3, (G[i + 1].t - G[i].t) / 1000);
    aa.push(Number.isFinite(av[i]) && Number.isFinite(av[i - 1]) ? (av[i] - av[i - 1]) / dt : NaN);
  }
  for (let i = 1; i < aa.length; i++) {
    const dt = Math.max(1e-3, (G[i + 1].t - G[i].t) / 1000);
    aj.push(Number.isFinite(aa[i]) && Number.isFinite(aa[i - 1]) ? Math.abs(aa[i] - aa[i - 1]) / dt : NaN);
  }
  for (const v of av) { if (v > 120 && !inSwing) { swings++; inSwing = true; } else if (v < 60) inSwing = false; }
  for (const r of G) {
    if (r.pitch * DEG < -28) floor++;
    if (r.bad != null) { nb++; if (r.bad) { bad++; const k = (r.why || '?').slice(0, 12); why[k] = (why[k] ?? 0) + 1; } }
  }
  // (an eye speed change over a frame, m/s²: the boom's jolts)
  const eyeA = []; for (let i = 1; i < ep.length; i++) eyeA.push(Math.abs(ep[i] - ep[i - 1]) / Math.max(1e-3, (G[i + 1].t - G[i].t) / 1000));
  out.camera = {
    turnP50: pct(av, 0.5), turnP95: pct(av, 0.95), turnAccP95: pct(aa.map(Math.abs), 0.95), jerkP95: pct(aj, 0.95),
    swingsPerMin: swings / mins, cutsPerMin: cuts / mins, floorShare: floor / G.length, sceneryShare: nb ? bad / nb : null,
    sceneryWhy: Object.fromEntries(Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => [k, +(n / Math.max(1, nb)).toFixed(3)])),
    eyeJoltP95: pct(eyeA, 0.95),
  };
  // the body: the drawn hips' pops (moved more than its own speed can explain in one frame), and on screen
  const hk = `h${me}`, sk = `s${me}`, sk2 = `s${1 - me}`;
  let pops = 0, scrPops = 0, off = 0, overlap = 0, tiny = 0;
  const scrA = [];
  const hv = [];   // the drawn body's speed along the floor, m/s
  for (let i = 1; i < G.length; i++) {
    const a = G[i - 1], b = G[i], dt = Math.max(1e-3, (b.t - a.t) / 1000);
    const pa = a[hk], pb = b[hk];
    const same = b.world === a.world && b.cross === a.cross;
    if (pa && pb && Number.isFinite(pa[0]) && Number.isFinite(pb[0])) {
      const d = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
      hv.push(same ? d / dt : NaN);
      // (expected: the faster of its speeds either side of the frame, in 3D; a pop moves 15 cm past it)
      const va = a[`v${me}`], vb = b[`v${me}`], expect = va && vb ? Math.max(Math.hypot(...va), Math.hypot(...vb)) * dt : NaN;
      const d3 = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      // (not while fallen or re-forming, not carried in a grip (its speed isn't the grip's), not within a tenth of a second of
      // a crossing: those move the body by design)
      const nearCross = G.slice(Math.max(0, i - 6), i + 7).some((q) => q.cross !== b.cross || q.world !== b.world);
      if (same && !nearCross && !a.frozen && !b.frozen && !a.link && !b.link && b.phase === 'play' && a.phase === 'play' && (Number.isFinite(expect) ? d3 - expect > 0.15 && d3 > 0.2 : d3 > 0.35)) { pops++; (out.popAt ??= []).push(+((b.t - F[0].t) / 1000).toFixed(2)); }
    } else hv.push(NaN);
    // (on screen: its chest's second difference in pixels, 60 fps frames; a pop over 40 px at 720p is seen)
    if (i >= 2 && same) {
      const c = G[i - 2], s0 = c[sk], s1 = a[sk], s2 = b[sk];
      if (s0 && s1 && s2 && [s0, s1, s2].every((s) => Number.isFinite(s[0]))) {
        const ax = (s2[0] - 2 * s1[0] + s0[0]) * W / 2, ay = (s2[1] - 2 * s1[1] + s0[1]) * H / 2;
        const A = Math.hypot(ax, ay); scrA.push(A); if (A > 40) scrPops++;
      }
    }
    const s = b[sk], o = b[sk2];
    if (!s || !Number.isFinite(s[0]) || Math.abs(s[0]) > 1 || Math.abs(s[1]) > 1) off++;
    else if (o && Number.isFinite(o[0]) && Math.hypot((s[0] - o[0]) * W / 2, (s[1] - o[1]) * H / 2) < 45 && !b.link) overlap++;
  }
  out.body = { popsPerMin: pops / mins, screenPopsPerMin: scrPops / mins, screenAccP95: pct(scrA, 0.95), offScreenShare: off / G.length, confusableShare: overlap / G.length };
  // keys: held intervals of any move key; response from rest; stuck while pushing; momentum
  const keyAt = (t) => { const h = new Set(); for (const [kt, c, d] of rec.keys) { if (kt > t) break; if (moveKeys.includes(c)) d ? h.add(c) : h.delete(c); } return h.size > 0; };
  const sp = G.map((r, i) => {
    const v = r[`v${me}`];
    if (v) return Math.hypot(v[0], v[2]);
    return hv[i - 1] ?? NaN;
  });
  // (the drawn speed, smoothed over 5 frames, for the jogo's bodies whose velocity the page doesn't hand out)
  const spS = sp.map((_, i) => mean(sp.slice(Math.max(0, i - 2), i + 3)));
  // (a touch player's stick: a touch that landed on the left of the screen, held till the touches end)
  const touches = (rec.ptr ?? []).filter((p) => p[1] === 'touchstart' || p[1] === 'touchend');
  let keyIdx = 0, tIdx = 0, stick = false; const held = new Set(); const pushing = G.map((r) => {
    while (keyIdx < rec.keys.length && rec.keys[keyIdx][0] <= r.t) { const [, c, d] = rec.keys[keyIdx++]; if (moveKeys.includes(c)) d ? held.add(c) : held.delete(c); }
    while (tIdx < touches.length && touches[tIdx][0] <= r.t) { const [, ev, x] = touches[tIdx++]; if (ev === 'touchstart' && x < W * 0.45) stick = true; else if (ev === 'touchend') stick = false; }
    return held.size > 0 || stick;
  });
  let stuckF = 0, pushF = 0, fastF = 0, stops = 0, stuckRuns = 0, run = 0, lastStop = -99;
  const pushSp = [];
  for (let i = 0; i < G.length; i++) {
    const r = G[i], live = r.phase === 'play' || r.mode === 'jogo';
    if (!pushing[i] || !live || r.link || r.frozen) { run = 0; continue; }
    pushF++; const v = spS[i]; pushSp.push(v);
    if (v < 0.6) { stuckF++; run++; if (run === 30) stuckRuns++; } else run = 0;
    if (v > 3) fastF++;
    // (a stop: from over 3 m/s to under 1 within 15 frames, the key still held)
    if (i >= 15 && i >= lastStop + 30 && spS[i - 15] > 3 && v < 1 && pushing[i - 15]) { stops++; lastStop = i; }
  }
  out.move = { pushShare: pushF / G.length, stuckShare: pushF ? stuckF / pushF : null, stuckPerMin: stuckRuns / mins, speedPushing: mean(pushSp), fastShare: pushF ? fastF / pushF : null, stopsPerMin: stops / mins };
  // response: a move key pressed from rest (no move key held 150 ms before, the body slower than 0.3 m/s) to the
  // first frame the body runs faster than 0.5 m/s; a jump key on the ground to 2 cm up
  const resp = [], jresp = [];
  const frameAfter = (t) => { let lo = 0, hi = G.length; while (lo < hi) { const m = (lo + hi) >> 1; if (G[m].t < t) lo = m + 1; else hi = m; } return lo; };
  for (let ki = 0; ki < rec.keys.length; ki++) {
    const [t, c, d] = rec.keys[ki]; if (!d) continue;
    const i0 = frameAfter(t); if (i0 >= G.length || i0 < 10) continue;
    const r0 = G[i0];
    if (!(r0.phase === 'play' || r0.mode === 'jogo') || r0.link || r0.frozen) continue;
    if (moveKeys.includes(c)) {
      if (pushing[Math.max(0, frameAfter(t - 150) - 1)] || !(spS[i0 - 1] < 0.3)) continue;
      let hit = null; for (let i = i0; i < G.length && G[i].t - t < 600; i++) if (sp[i] > 0.5) { hit = G[i].t - t; break; }
      resp.push(hit);
    } else if (jumpKeys.includes(c)) {
      const g = r0[`g${me}`]; if (g === 0) continue;
      const y0 = (r0[`r${me}`] ?? r0[hk])[1];
      let hit = null; for (let i = i0; i < G.length && G[i].t - t < 600; i++) { const y = (G[i][`r${me}`] ?? G[i][hk])[1]; if (y - y0 > 0.02) { hit = G[i].t - t; break; } }
      jresp.push(hit);
    }
  }
  out.response = { moveMs: mean(resp.filter((x) => x != null)), moveP90: pct(resp.filter((x) => x != null), 0.9), moveN: resp.length, moveMissed: resp.filter((x) => x == null).length, jumpMs: mean(jresp.filter((x) => x != null)), jumpN: jresp.length, jumpMissed: jresp.filter((x) => x == null).length };
  // confusion: going nowhere (a 10 s window, keys held most of it, the body ending within 2 m of where it began)
  let nowhere = 0, windows = 0;
  for (let i = 0; i < G.length; i += 300) {
    const j = Math.min(G.length - 1, i + 600); if (j - i < 400) break;
    windows++;
    const a = G[i][hk], b = G[j][hk], p = pushing.slice(i, j).filter(Boolean).length / (j - i);
    if (a && b && p > 0.5 && Math.hypot(b[0] - a[0], b[2] - a[2]) < 2 && G[i].world === G[j].world) nowhere++;
  }
  out.confusion = { nowhereShare: windows ? nowhere / windows : null, wallPerMin: out.move.stuckPerMin, lostSelfShare: out.body.offScreenShare, confusableShare: out.body.confusableShare };
  // the dance: the duel's links for this seat; crossings; the moments
  const H2 = rec.history ?? [];
  const links = H2.filter((h) => h.e.k === 'link' && h.e.seat === me).map((h) => h.e.kind);
  const cnt = (k) => links.filter((x) => x === k).length;
  out.dance = { catches: cnt('catch') + cnt('aerial'), flings: cnt('fling'), swings: cnt('swing'), links: links.length, perfect: H2.filter((h) => h.e.k === 'link' && h.e.seat === me && h.e.perfect).length, falls: H2.filter((h) => h.e.k === 'fall' && h.e.seat === me).length };
  out.dance.catchesPerMin = out.dance.catches / mins; out.dance.flingsPerMin = out.dance.flings / mins;
  const C = rec.crossings ?? [];
  out.crossings = { n: C.length, through: C.filter((c) => c.how === 'through').length, flash: C.filter((c) => c.how === 'flash' || c.how === 'late').length, worlds: [...new Set(rec.worlds)], ways: rec.crossCam };
  const last = G[G.length - 1], first = G[0];
  const juice = H2.filter((h) => h.e.k === 'juice').length, tiers = H2.filter((h) => h.e.k === 'tier' || h.e.k === 'pairTier' || h.e.k === 'merge').length;
  const answers = (last.answers ?? 0) - (first.answers ?? 0), words = Math.max(0, (last.pops ?? 0) - (first.pops ?? 0));
  const jogoMagic = (rec.jogoHist ?? []).filter((h) => ['xch', 'echo', 'fusion', 'form', 'build'].includes(h.k)).length;
  out.magic = { perMin: (juice + tiers + answers + jogoMagic) / mins, juice, tiers, answers, words, jogo: jogoMagic };
  return out;
}

// ---------------------------------------------------------------- the scorecard
/** 0 … 100 per measure (100: a person wouldn't notice anything wrong; 0: they would at once), from thresholds a
 *  person notices. `lo` is good, `hi` bad (or the other way for the measures where more is better) */
const band = (x, good, bad) => {
  if (x == null || !Number.isFinite(x)) return null;
  const t = (x - good) / (bad - good);
  return Math.round(100 * Math.max(0, Math.min(1, 1 - t)));
};
export const SCORE_RULES = {
  'frames p95 ms': [(m) => m.frame?.p95, 17.5, 34],
  'hitches /min': [(m) => m.frame?.hitchPerMin, 0, 30],
  'camera turn p95 deg/s': [(m) => m.camera?.turnP95, 45, 160],
  'camera jerk p95': [(m) => m.camera?.jerkP95, 5e4, 4e5],
  'camera swings /min': [(m) => m.camera?.swingsPerMin, 0, 40],
  'camera cuts /min': [(m) => m.camera?.cutsPerMin, 0, 10],
  'camera looking down (>28°)': [(m) => m.camera?.floorShare, 0.05, 0.4],
  'camera eye unclean': [(m) => m.camera?.sceneryShare, 0.15, 0.6],
  'body pops /min': [(m) => m.body?.popsPerMin, 0, 20],
  'body screen pops /min': [(m) => m.body?.screenPopsPerMin, 5, 80],
  'key to motion ms': [(m) => m.response?.moveMs, 60, 220],
  'stuck pushing': [(m) => m.move?.stuckShare, 0.04, 0.35],
  'run stops /min': [(m) => m.move?.stopsPerMin, 0, 20],
  'momentum (fast share)': [(m) => m.move?.fastShare, 0.75, 0.2],
  'going nowhere': [(m) => m.confusion?.nowhereShare, 0, 0.5],
  'lost self (off screen)': [(m) => m.body?.offScreenShare, 0, 0.12],
  'bodies confusable': [(m) => m.body?.confusableShare, 0.02, 0.25],
  'magic /min': [(m) => m.magic?.perMin, 12, 0],
};
export const GROUPS = {
  smooth: ['frames p95 ms', 'hitches /min', 'camera turn p95 deg/s', 'camera jerk p95', 'camera swings /min', 'camera cuts /min', 'body pops /min', 'body screen pops /min'],
  responsive: ['key to motion ms', 'stuck pushing', 'run stops /min', 'momentum (fast share)'],
  clear: ['camera looking down (>28°)', 'camera eye unclean', 'going nowhere', 'lost self (off screen)', 'bodies confusable'],
  magic: ['magic /min'],
};
export function score(m) {
  const per = {};
  for (const [k, [f, g, b]] of Object.entries(SCORE_RULES)) per[k] = band(f(m), g, b);
  const groups = {};
  for (const [g, ks] of Object.entries(GROUPS)) { const v = ks.map((k) => per[k]).filter((x) => x != null); groups[g] = v.length ? Math.round(mean(v)) : null; }
  const all = Object.values(groups).filter((x) => x != null);
  return { per, groups, total: all.length ? Math.round(mean(all)) : null };
}

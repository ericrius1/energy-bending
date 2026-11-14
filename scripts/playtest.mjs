// The duel's playtest on the real page, in real time: headless Chrome on the GPU (under the shared render lock) opens
// ?duel with seat 1 a human seat and seat 2 a virtual player, and plays seat 1 with real key presses (puppeteer's
// keyboard: the page's own keydown and keyup, the solo layout on the duel's scheme: free, W A S D move (camera-
// relative), Space jump, C down; locked (&lock: --lock), A D move, W jump, S down; J the grab (held), L kick, I spin,
// O dodge, K dash; the powers U and H, the power form E), as a person would, and
// measures what a person would feel:
//   key to motion   from the keydown (the event's own time) to the first frame the body moves for it: a run (along
//                   the plane faster than 0.5 m/s) from standing, a jump (risen 2 cm) from the floor; in ms and frames
//   frame time      requestAnimationFrame's intervals: mean, p50, p95, p99, frames over 25 ms, and the GPU's time
//   the set         catches, swings, flings, combos, falls, style (bend.duel's history); the powers cast (by key),
//                   the forms, the reactions and the catches the powers made (bend.duel.stats().powers)
// The human seat's keys come from a ghost virtual player thinking for it in the page (bend.duel.ghost: its wish read
// every 16 ms and turned into key downs and ups: `--human brain`, the default), or a small script (`--human script`:
// run at the other, hop now and then, kick when close).
//   node scripts/playtest.mjs [--url http://127.0.0.1:5503/energybending/] [--world temple] [--seconds 90]
//     [--human brain|script] [--style lead] [--skill 0.7] [--bot-style flyer] [--bot-skill 0.7]
//     [--size 1280x720] [--lock] [--json out.json] [--dress fire,water] [--full] [--power-every S] [--stills dir] (a grab every 10 s, and
//     the frame after each of the first few casts by key)
import { writeFileSync } from 'node:fs';
import { launch, adapterName, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2), opts = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
const URL0 = opts.url ?? 'http://127.0.0.1:5503/energybending/';
const WORLD = opts.world ?? 'temple';
const SECONDS = Number(opts.seconds ?? 90);
const HUMAN = opts.human ?? 'brain';
const [W, H] = String(opts.size ?? '1280x720').split('x').map(Number);
const style = opts.style ?? 'lead', skill = Number(opts.skill ?? 0.7);
const botStyle = opts['bot-style'] ?? 'flyer', botSkill = Number(opts['bot-skill'] ?? 0.7);
const log = (...a) => console.log(`[playtest ${new Date().toISOString().slice(11, 19)}]`, ...a);

const release = await takeLock({ say: log });
const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') log('page error:', m.text().slice(0, 300)); });
const LOCK = !!opts.lock;
const q = `duel&world=${WORLD}&p1=human&p2=bot&style=${style},${botStyle}&skill=${skill},${botSkill}&seed=${opts.seed ?? 4}${LOCK ? '&lock' : ''}${opts.dress ? `&dress=${opts.dress}` : ''}`;
const STILLS = typeof opts.stills === 'string' ? opts.stills : null;
let stillN = 0, castStills = 0;
const still = async (name) => {
  if (!STILLS) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(STILLS, { recursive: true });
  const png = await page.evaluate(() => window.bend.grab('image/png'));
  writeFileSync(`${STILLS}/${String(stillN++).padStart(2, '0')}-${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
};
await page.goto(`${URL0}?${q}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000 });
log('adapter', await adapterName(page), `· ${URL0}?${q}`);

// ---------------------------------------------------------------- the page's own measures
await page.evaluate(() => {
  const P = (window.__pt = { frames: [], gpu: [], probes: [], pending: null, last: null });
  const c = () => window.bend.duel.match.chars[0];
  // the keydown's own time; a probe waits for the body to answer it
  addEventListener('keydown', (e) => {
    if (e.repeat || P.pending) return;
    const ch = c(), pl = ch.plane, vs = pl ? Math.abs(ch.v[0] * pl.right[0] + ch.v[2] * pl.right[2]) : Math.hypot(ch.v[0], ch.v[2]);
    // (not while joined: a base holding braces, its run is the pump; a held body is carried)
    if (!window.bend.duel.started || window.bend.duel.match.frozen(0) || ch.move || ch.staggered || window.bend.duel.match.contact.link) return;
    const run = pl ? ['KeyA', 'KeyD'] : ['KeyA', 'KeyD', 'KeyW', 'KeyS'], jump = pl ? 'KeyW' : 'Space';
    if (run.includes(e.code) && ch.grounded && vs < 0.15) P.pending = { kind: 'run', t: e.timeStamp, y: ch.root[1], frames: 0 };
    else if (e.code === jump && ch.grounded) P.pending = { kind: 'jump', t: e.timeStamp, y: ch.root[1], frames: 0 };
  }, { capture: true });
  const tick = (now) => {
    if (P.last != null) P.frames.push(now - P.last);
    P.last = now;
    const g = window.bend.kit?.profiler?.frameMs; if (g) P.gpu.push(g);
    const p = P.pending;
    if (p) {
      // (rAF runs before this frame's simulation: what moved, moved in the frames already run)
      const ch = c(), pl = ch.plane, vs = pl ? Math.abs(ch.v[0] * pl.right[0] + ch.v[2] * pl.right[2]) : Math.hypot(ch.v[0], ch.v[2]);
      if (now > p.t) p.frames++;
      const moved = p.kind === 'run' ? vs > 0.5 : ch.root[1] - p.y > 0.02;
      if (moved) { P.probes.push({ kind: p.kind, ms: now - p.t, frames: p.frames }); P.pending = null; }
      else if (now - p.t > 500) { P.probes.push({ kind: p.kind, ms: null, frames: p.frames }); P.pending = null; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// ---------------------------------------------------------------- the human seat
// (the duel's scheme on the solo layout, input/keyboard.ts: K or Shift dash, L kick, I spin, O dodge)
const KEYS = LOCK
  ? { left: 'KeyA', right: 'KeyD', jump: 'KeyW', down: 'KeyS', fwd: null, back: null, punch: 'KeyJ', kick: 'KeyL', spin: 'KeyI', dodge: 'KeyO', dash: 'KeyK', power1: 'KeyU', power2: 'KeyH', form: 'KeyE' }
  : { left: 'KeyA', right: 'KeyD', jump: 'Space', down: 'KeyC', fwd: 'KeyW', back: 'KeyS', punch: 'KeyJ', kick: 'KeyL', spin: 'KeyI', dodge: 'KeyO', dash: 'KeyK', power1: 'KeyU', power2: 'KeyH', form: 'KeyE' };
const pressed = { power1: 0, power2: 0, form: 0 };
let nextStill = 10, nextPower = 3, powerTurn = 0;
const held = new Set();
const hold = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } else if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
const tap = async (k) => { await page.keyboard.down(k); await new Promise((r) => setTimeout(r, 45)); await page.keyboard.up(k); };
// the first key joins seat 1 and starts the duel
await tap('KeyD');
if (HUMAN === 'brain') await page.evaluate((s) => window.bend.duel.ghost(0, s), { style, skill, seed: 41 });
log(`seat 1: ${HUMAN === 'brain' ? `a ghost ${style} player (skill ${skill}) on real keys` : 'a script on real keys'}; seat 2: ${botStyle} bot (skill ${botSkill}); ${SECONDS} s`);

const t0 = Date.now();
let lastScript = 0;
while (Date.now() - t0 < SECONDS * 1000) {
  const st = await page.evaluate((full) => {
    const d = window.bend.duel, w = d.wish(0), a = d.match.chars[0], b = d.match.chars[1];
    // (--full: the human seat's flow kept at least half full, so its power keys are pressed often)
    if (full && d.flow && d.flow(0) < 0.5) d.flow(0, 0.5);
    return { w, s: a.root[0], o: b.root[0], grounded: a.grounded, done: d.state.phase === 'done', set: d.state.set };
  }, !!opts.full);
  if (HUMAN === 'brain' && st.w) {
    const w = st.w;
    await hold(KEYS.left, w.moveX < -0.3); await hold(KEYS.right, w.moveX > 0.3);
    if (KEYS.fwd) { await hold(KEYS.fwd, w.moveZ > 0.3); await hold(KEYS.back, w.moveZ < -0.3); }
    await hold(KEYS.down, w.moveY < -0.5);
    await hold(KEYS.jump, !!(w.jumpHeld || w.jump));
    // (the grab is held while the hold lasts: the punch key down, let go for the fling)
    await hold(KEYS.punch, !!(w.punchHeld || w.punch));
    for (const b of ['kick', 'spin', 'dodge', 'dash']) if (w[b]) void tap(KEYS[b]);
    // the powers and the form: real key taps (the stick is already held the way the ghost aims them)
    for (const b of ['power1', 'power2', 'form']) if (w[b]) {
      pressed[b]++; await tap(KEYS[b]);
      if (b !== 'form' && castStills < 4) { castStills++; await new Promise((r) => setTimeout(r, 120)); await still(`cast-${b}`); }
    }
  } else if (HUMAN === 'script') {
    const d = st.o - st.s, now = Date.now();
    await hold(KEYS.right, d > 0.9); await hold(KEYS.left, d < -0.9);
    if (now - lastScript > 700) {
      lastScript = now;
      if (Math.abs(d) < 1.2) { await hold(KEYS.punch, true); setTimeout(() => void hold(KEYS.punch, false), 900); }
      else if (Math.random() < 0.4) { await hold(KEYS.jump, true); setTimeout(() => void hold(KEYS.jump, false), 120 + Math.random() * 250); }
    }
  }
  // (--power-every S: besides the ghost's own casts, U and H in turn every S seconds, real taps, along the stick it holds)
  const pe = Number(opts['power-every'] ?? 0);
  if (pe > 0 && (Date.now() - t0) / 1000 >= nextPower) {
    nextPower += pe;
    const b = powerTurn++ % 2 ? 'power2' : 'power1';
    pressed[b]++; await tap(KEYS[b]);
    if (castStills < 6) { castStills++; await new Promise((r) => setTimeout(r, 150)); await still(`key-${b}`); }
  }
  if ((Date.now() - t0) / 1000 >= nextStill) { nextStill += 10; await still(`t${Math.round((Date.now() - t0) / 1000)}`); }
  await new Promise((r) => setTimeout(r, 16));
}
for (const k of [...held]) await hold(k, false);

// ---------------------------------------------------------------- what it measured
const R = await page.evaluate(() => {
  const P = window.__pt, d = window.bend.duel;
  return { frames: P.frames, gpu: P.gpu, probes: P.probes, history: d.history.map((h) => ({ t: h.t, k: h.e.k, e: h.e })), stats: d.stats(), render: [...window.bend.kit.size.render] };
});
await browser.close();
release();

const sorted = (x) => [...x].sort((a, b) => a - b);
const pct = (x, p) => { const s = sorted(x); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const ft = R.frames.slice(30);
const runs = R.probes.filter((p) => p.kind === 'run' && p.ms != null), jumps = R.probes.filter((p) => p.kind === 'jump' && p.ms != null);
const links = R.history.filter((h) => h.k === 'link').map((h) => h.e);
const sets = R.history.filter((h) => h.k === 'done').map((h) => h.e);
const combos = R.history.filter((h) => h.k === 'combo' && h.e.why !== 'fall').map((h) => h.e);
const falls = R.history.filter((h) => h.k === 'fall').length;
const count = (kind, seat) => links.filter((l) => l.kind === kind && (seat == null || l.seat === seat)).length;
const out = {
  world: WORLD, locked: LOCK, human: HUMAN, style, skill, botStyle, botSkill, seconds: SECONDS, render: R.render,
  frameMs: { mean: mean(ft), p50: pct(ft, 0.5), p95: pct(ft, 0.95), p99: pct(ft, 0.99), over25: ft.filter((x) => x > 25).length, n: ft.length, fps: 1000 / mean(ft) },
  gpuMs: { mean: mean(R.gpu), p95: pct(R.gpu, 0.95) },
  keyToRun: { n: runs.length, msMean: mean(runs.map((p) => p.ms)), msP90: pct(runs.map((p) => p.ms), 0.9), framesMean: mean(runs.map((p) => p.frames)), missed: R.probes.filter((p) => p.kind === 'run' && p.ms == null).length },
  keyToJump: { n: jumps.length, msMean: mean(jumps.map((p) => p.ms)), msP90: pct(jumps.map((p) => p.ms), 0.9), framesMean: mean(jumps.map((p) => p.frames)), missed: R.probes.filter((p) => p.kind === 'jump' && p.ms == null).length },
  sets: sets.map((e) => ({ winner: e.winner, style: e.style })),
  catches: [0, 1].map((k) => count('catch', k) + count('aerial', k)), aerials: count('aerial'), swings: count('swing'), flings: count('fling'), lifts: count('lift'), vaults: count('vault'), counters: count('counter'),
  combos: combos.length, longest: Math.max(0, ...combos.map((e) => e.n)), falls, perfect: links.filter((l) => l.perfect).length, links: links.length,
  final: R.stats,
  powerKeys: pressed,
};
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
log(`frames: ${f(out.frameMs.fps)} fps, mean ${f(out.frameMs.mean, 2)} ms, p95 ${f(out.frameMs.p95, 2)}, p99 ${f(out.frameMs.p99, 2)}, ${out.frameMs.over25} over 25 ms of ${out.frameMs.n}; GPU ${f(out.gpuMs.mean, 2)} ms (p95 ${f(out.gpuMs.p95, 2)}) at ${R.render.join('x')}`);
log(`key to motion: run ${f(out.keyToRun.msMean)} ms (p90 ${f(out.keyToRun.msP90)}, ${f(out.keyToRun.framesMean)} frames, n ${out.keyToRun.n}, missed ${out.keyToRun.missed}); jump ${f(out.keyToJump.msMean)} ms (p90 ${f(out.keyToJump.msP90)}, ${f(out.keyToJump.framesMean)} frames, n ${out.keyToJump.n}, missed ${out.keyToJump.missed})`);
log(`dance: catches ${out.catches.join(' / ')} (seat 1 human-like / seat 2 bot; ${out.aerials} out of the air), ${out.swings} swings, ${out.flings} flings, ${out.lifts} lifts, ${out.vaults} vaults, ${out.counters} counters; ${out.combos} combos (longest ${out.longest}), ${out.perfect} of ${out.links} links on the beat, ${out.falls} falls; style now ${JSON.stringify(out.final.style)}, energy peak ${out.final.peak}${out.sets.length ? `; sets ${out.sets.map((x) => `P${x.winner + 1} ${x.style.join('-')}`).join(', ')}` : ''}`);
const PW = out.final.powers;
if (PW) log(`powers: keys pressed U ${pressed.power1}, H ${pressed.power2}, E ${pressed.form}; cast ${JSON.stringify(PW.casts)} (seat 1 / seat 2: power 1, power 2), forms ${JSON.stringify(PW.forms)}, reactions ${JSON.stringify(PW.reactions)}, catches by powers ${PW.felt.catches}, launches ${PW.felt.launches}`);
if (opts.json) { writeFileSync(opts.json, JSON.stringify(out, null, 1)); log(`wrote ${opts.json}`); }

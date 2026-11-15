// The finale's bloom, the banner, the one word's place and the count-in's HUD, as the player sees them (report 18):
// a duel of two virtual players in headless Chrome on the real GPU, stepped by hand at 60 fps on the frames' clock (as
// duel-page.mjs), grabbed from the duel's own camera with the HUD over it.
//   node scripts/bloom-cap.mjs <outDir> --url http://127.0.0.1:5491/energybending/ [--world pool] [--dress fire,water]
//        [--seed 2] [--size 1280x720] [--mode finale|count|word] [--set 20] [--every 2] [--fuse 1]
//   finale  plays a set of --set seconds and, with --fuse 1, lets its finale fuse (the set's merge and its stretch at the
//           top are written into the rules' state before the finale fires: a test of the look, not of the rules);
//           grabs every --every frames from the finale's start to the banner's end (a clip: frames/NNNN.jpg), and
//           samples each frame the share of each body's core under the bloom's light (moments.ts's measure)
//   count   grabs the count-in (and the first second of play) every --every frames
//   word    plays a whole set and reads the one word's placement each frame (bend.hud.stats().place): the slot changes
//           a second while a word stands, at a pair tier and over all words
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const outDir = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/bloom';
const base = arg('url', 'http://127.0.0.1:5491/energybending/');
const world = arg('world', 'pool'), dress = arg('dress', 'fire,water'), seed = arg('seed', '2'), styles = arg('styles', 'lead,flyer');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const mode = arg('mode', 'finale'), setS = arg('set', mode === 'word' ? '' : '20'), every = Number(arg('every', '2')), fuse = arg('fuse', '1') !== '0';
const bpm = arg('bpm', ''), restart = arg('restart', '1') !== '0';
mkdirSync(join(outDir, 'frames'), { recursive: true });

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
const q = `duel&world=${world}&dress=${dress}&p1=bot&p2=bot&style=${styles}&skill=0.85&seed=${seed}&go&noautores${setS ? `&set=${setS}` : ''}`;
await page.goto(`${base}?${q}`, { timeout: 120000 });
await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel?.moments, { timeout: 180000, polling: 200 });
console.log(`adapter: ${await adapterName(page)}`);
await page.evaluate((bpm, restart) => {
  const B = window.bend, k = B.kit;
  k.manual = true; k.autoRes = null; k.renderScale = 1;
  // (the music's clock on the stepped frames, as duel-page.mjs)
  const M = B.music;
  M.filmClock = M.now();
  M.now = () => M.filmClock; M.time = () => M.filmClock;
  window.__pin = () => { if (bpm) { const c = B.music.engine.clock; c.bpm = c.targetBpm = Number(bpm); } };
  window.__pin();
  if (restart) B.duel.restart();
}, bpm, restart);

const save = (name, url) => writeFileSync(join(outDir, name), Buffer.from(url.split(',')[1], 'base64'));
const t0 = Date.now();

if (mode === 'count') {
  // the count-in from its start, and a second of play
  let n = 0;
  for (let i = 0; i < 60 * 6; i += every) {
    const r = await page.evaluate(async (every) => { await window.bend.step(every); window.__pin(); const D = window.bend.duel; return { phase: D.state.phase, img: await window.bend.grab('image/jpeg') }; }, every);
    save(`frames/${String(n++).padStart(4, '0')}.jpg`, r.img);
    if (r.phase === 'play' && n > 90 / every * 2) break;
  }
  console.log(`count: ${n} frames`);
}

if (mode === 'finale') {
  // to the finale's start (with --fuse: the set earns the fusion first, its merge and its stretch at the top)
  for (;;) {
    const r = await page.evaluate(async (fuse) => {
      const B = window.bend, D = B.duel;
      for (let i = 0; i < 20; i++) {
        const s = D.state;
        if (fuse && s.phase === 'play') { s.merges = Math.max(1, s.merges); s.highBest = Math.max(s.highBest, 3100); s.peak = Math.max(s.peak, 0.93); }
        if (s.phase === 'finale') return s.phase;
        await B.step(1); window.__pin();
      }
      return D.state.phase;
    }, fuse);
    if (r === 'finale') break;
    if ((Date.now() - t0) / 1000 > 900) throw new Error('no finale');
  }
  // the finale and the banner, frame by frame: grabbed every `every`, the bloom's cover sampled every frame
  const res = await page.evaluate(async (every) => {
    const B = window.bend, D = B.duel, M = D.moments, out = [], fused = D.state.fused, timing = {};
    M.reset();
    B.kit.profiler.force = true;
    const snap = () => ({ frame: +B.kit.profiler.frameMs.toFixed(3), passes: Object.fromEntries([...B.kit.profiler.ms].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +v.toFixed(3)])) });
    let f = 0, worst = 0, sum = 0, frames = 0, top = -1, peakCover = 0;
    const cover = [];
    for (;;) {
      await B.step(1); window.__pin();
      const s = D.state, look = D.finale.look();
      const c = M.bloomCover();
      if (c) { frames++; sum += c.core; worst = Math.max(worst, c.core); cover.push(+c.core.toFixed(3)); }
      if (top < 0 && look && look.u >= 0.55) top = f;
      // (the GPU's time per pass as the duet begins, the bloom not yet grown, and with the flower open)
      if (f === 6) timing.start = snap();
      if (top >= 0 && f === top + 40) timing.open = { ...snap(), glows: c?.glows ?? 0 };
      if (f % every === 0) out.push({ f, u: look ? +look.u.toFixed(3) : null, phase: s.phase, img: await B.grab('image/jpeg') });
      f++;
      if (s.phase === 'intro' || f > 60 * 9) break;
    }
    return { out, fused, top, frames, mean: frames ? sum / frames : 0, worst, cover, peakCover, timing };
  }, every);
  let n = 0;
  for (const o of res.out) save(`frames/${String(n++).padStart(4, '0')}.jpg`, o.img);
  const meta = res.out.map(({ f, u, phase }) => ({ f, u, phase }));
  writeFileSync(join(outDir, 'finale.json'), JSON.stringify({ fused: res.fused, top: res.top, timing: res.timing, cover: { frames: res.frames, mean: +res.mean.toFixed(4), worst: +res.worst.toFixed(3), each: res.cover }, frames: meta }, null, 1));
  console.log(`finale: fused ${res.fused}, ${n} frames grabbed, the lift's top at frame ${res.top}; the bloom over a body's core: mean ${(res.mean * 100).toFixed(1)}%, worst ${(res.worst * 100).toFixed(1)}%`);
}

if (mode === 'word') {
  // (and with --grabs N: a frame every 6 for a second after each of the first N pair tiers, as report 17's sheet)
  const grabs = Number(arg('grabs', '0'));
  const res = await page.evaluate(async (grabs) => {
    const B = window.bend, D = B.duel, shots = [];
    B.hud.stats(true);
    let seen = D.history.length, left = 0, tiers = 0;
    for (let i = 0; i < 60 * 100; i++) {
      await B.step(1); window.__pin();
      for (; seen < D.history.length; seen++) if (D.history[seen].e.k === 'pairTier' && tiers < grabs) { tiers++; left = 60; }
      if (left > 0) { if (left % 6 === 0) shots.push({ n: tiers, t: +(D.now() / 1000).toFixed(2), img: await B.grab('image/jpeg') }); left--; }
      if (D.state.phase === 'finale') break;
    }
    return { place: B.hud.stats().place, shots };
  }, grabs);
  res.shots.forEach((o, i) => save(`frames/tier${o.n}-${String(i).padStart(3, '0')}.jpg`, o.img));
  writeFileSync(join(outDir, 'word.json'), JSON.stringify(res.place, null, 1));
  console.log(`word: ${JSON.stringify(res.place)}; ${res.shots.length} frames at tiers`);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
await browser.close();

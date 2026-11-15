// The big moments as the player sees them (phase 6, report 20): a fused finale's bloom and a pair tier, with the world
// answering them. A duel of two virtual players in headless Chrome on the real GPU, stepped by hand at 60 fps on the
// frames' clock (as bloom-cap.mjs), grabbed from the duel's own camera with the HUD over it, and measured:
//   the bloom   its size on screen (moments.ts bloomSize: the box round its lit footprint, the share of the screen it
//               lights), how much of a body's core it covers (bloomCover), how much of each body a solid hides
//               (moments.ts hidden: the lifted body behind a standing stone)
//   the answer  how much of the frame the world's answer changes (the same frame drawn with the answer and without it,
//               a ten-thousandth of a second apart: the share of pixels whose light changed by more than 3 %), its
//               level, and the GPU's time with it and without it at the peak
//   node scripts/answer-cap.mjs <outDir> --url http://127.0.0.1:5493/energybending/ [--world pool] [--dress water,ice]
//        [--seed 2] [--size 1280x720] [--mode finale|tier] [--tier 4] [--every 2] [--secs 7] [--set 20] [--before 1]
//        [--mirrors 1] (the mirrors open: by default they are shut, so a crossing doesn't take the take elsewhere)
//   finale  plays a set of --set seconds whose finale fuses (the set's merge and its stretch at the top written into the
//           rules' state: a test of the look, not of the rules), from the finale's start to the banner's end
//   tier    plays until the pair's chain is live, writes its varied links to one short of --tier's (1 DUET … 4 AURORA)
//           so its next link reaches it (the rules fire the tier and its word as ever), then --secs seconds after
// Works on a page without the answer (master): the answer's numbers are then left out.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const outDir = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/answer';
const base = arg('url', 'http://127.0.0.1:5493/energybending/');
const world = arg('world', 'pool'), dress = arg('dress', 'water,ice'), seed = arg('seed', '2'), styles = arg('styles', 'lead,flyer');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const mode = arg('mode', 'finale'), tier = Number(arg('tier', '4')), every = Number(arg('every', '2')), secs = Number(arg('secs', '7'));
const setS = arg('set', mode === 'finale' ? '20' : '60');
mkdirSync(join(outDir, 'frames'), { recursive: true });

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
const q = `duel&world=${world}&dress=${dress}&p1=bot&p2=bot&style=${styles}&skill=0.85&seed=${seed}&go&noautores&set=${setS}${arg("mirrors", "0") === "1" ? "" : "&mirrors=0"}`;
await page.goto(`${base}?${q}`, { timeout: 120000 });
await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel?.moments, { timeout: 180000, polling: 200 });
console.log(`adapter: ${await adapterName(page)}`);
const before = arg('before', '0') === '1';
await page.evaluate((before) => { window.__before = before; }, before);
await page.evaluate(() => {
  const B = window.bend, k = B.kit;
  k.manual = true; k.autoRes = null; k.renderScale = 1;
  const M = B.music;
  M.filmClock = M.now();
  M.now = () => M.filmClock; M.time = () => M.filmClock;
  B.duel.restart();
  // (--before: the world's answer held off for the whole run, as master had none)
  if (window.__before && B.duel.answer) B.duel.answer.off = true;
  // the page's measuring helpers
  window.__px = async (url) => {
    const img = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(320, 180), g = c.getContext('2d');
    g.drawImage(img, 0, 0, 320, 180);
    return g.getImageData(0, 0, 320, 180).data;
  };
  /** the same moment with the world's answer and without (a ten-thousandth of a second apart) */
  window.__ab = async () => {
    const D = B.duel, A = D.answer;
    if (!A || window.__before) return null;
    // (each held a few frames, so what the frame carries over from the last, the glow's trails and the lens, settles;
    // and the same frame held again with the answer on, the noise floor)
    const level = A.level;
    A.off = true; await B.step(5, 1e-4); const off = await B.grab('image/jpeg', 0.92, 1e-4);
    A.off = false; await B.step(5, 1e-4); const on = await B.grab('image/jpeg', 0.92, 1e-4);
    await B.step(5, 1e-4); const on2 = await B.grab('image/jpeg', 0.92, 1e-4);
    const a = await window.__px(on), b = await window.__px(off), c = await window.__px(on2);
    const diff = (x, y) => {
      let n = 0, sum = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])) / 3;
        sum += d; if (d > 8) n++;
      }
      return [n / (x.length / 4), sum / (x.length / 4) / 255];
    };
    const [ch, mean] = diff(a, b), [noise] = diff(a, c);
    return { changed: +ch.toFixed(3), noise: +noise.toFixed(3), mean: +mean.toFixed(4), level: +level.toFixed(3), on, off };
  };
  /** the GPU's time per frame and per pass over n held frames, with the answer and without */
  window.__gpu = async (n = 8) => {
    const D = B.duel, A = D.answer, P = B.kit.profiler;
    P.force = true;
    const run = async (off) => {
      if (A) A.off = off;
      const ms = [], passes = {};
      for (let i = 0; i < n; i++) {
        await B.step(1, 1e-4);
        if (i < 2) continue;
        ms.push(P.frameMs);
        for (const [k, v] of P.ms) passes[k] = (passes[k] ?? 0) + v / (n - 2);
      }
      return { frame: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(3), passes: Object.fromEntries(Object.entries(passes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, +v.toFixed(3)])) };
    };
    if (window.__before) return { on: await run(true), off: null };
    const on = await run(false), off = A ? await run(true) : null;
    if (A) A.off = false;
    return { on, off };
  };
  window.__look = () => {
    const D = B.duel, M = D.moments, eye = [...B.kit.camera.position];
    return { cover: M.bloomCover?.() ?? null, size: M.bloomSize?.() ?? null, hidden: M.hidden ? M.hidden(D.camSpace(), eye).map((v) => +v.toFixed(2)) : null, level: D.answer ? +D.answer.level.toFixed(3) : null };
  };
});

const save = (name, url) => writeFileSync(join(outDir, name), Buffer.from(url.split(',')[1], 'base64'));
const t0 = Date.now();
const out = { world, dress, seed, mode, frames: [], ab: [], gpu: null };

if (mode === 'finale') {
  for (;;) {
    const r = await page.evaluate(async () => {
      const B = window.bend, D = B.duel;
      for (let i = 0; i < 20; i++) {
        const s = D.state;
        if (s.phase === 'play') { s.merges = Math.max(1, s.merges); s.highBest = Math.max(s.highBest, 3100); s.peak = Math.max(s.peak, 0.93); }
        if (s.phase === 'finale') return s.phase;
        await B.step(1);
      }
      return D.state.phase;
    });
    if (r === 'finale') break;
    if ((Date.now() - t0) / 1000 > 900) throw new Error('no finale');
  }
  out.fused = await page.evaluate(() => window.bend.duel.state.fused);
  let top = -1;
  for (let f = 0; f < 60 * 9; f++) {
    const r = await page.evaluate(async (grab) => {
      const B = window.bend, D = B.duel;
      await B.step(1);
      const look = D.finale.look();
      return { u: look ? +look.u.toFixed(3) : null, phase: D.state.phase, ...window.__look(), img: grab ? await B.grab('image/jpeg') : null };
    }, f % every === 0);
    if (r.img) save(`frames/${String(f / every).padStart(4, '0')}.jpg`, r.img);
    delete r.img;
    out.frames.push({ f, ...r });
    if (top < 0 && r.u != null && r.u >= 0.55) top = f;
    // (the answer with and without, through the lift and the flower open; the GPU's time with the flower open)
    if (top >= 0 && [10, 40, 90, 150].includes(f - top)) {
      const ab = await page.evaluate(() => window.__ab());
      if (ab) { save(`ab-${f - top}-on.jpg`, ab.on); save(`ab-${f - top}-off.jpg`, ab.off); delete ab.on; delete ab.off; out.ab.push({ at: `top+${f - top}`, ...ab }); }
      if (f - top === 40) out.gpu = await page.evaluate(() => window.__gpu());
    }
    if (r.phase === 'intro') break;
  }
  out.top = top;
}

if (mode === 'tier') {
  const want = await page.evaluate((tier) => window.bend.duel.state && [14, 28, 48, 108][tier - 1], tier);
  let fired = false;
  while (!fired) {
    fired = await page.evaluate(async (tier, want) => {
      const B = window.bend, D = B.duel;
      for (let i = 0; i < 30; i++) {
        const s = D.state, P = s.pair;
        if (s.phase === 'play' && P.live && P.n >= 1 && P.tier < tier) { P.varied = Math.max(P.varied, want - 1); P.tier = tier - 1; }
        await B.step(1);
        if (D.events().some((e) => e.k === 'pairTier' && e.tier === tier)) return true;
      }
      return false;
    }, tier, want);
    if ((Date.now() - t0) / 1000 > 900) throw new Error('no tier');
  }
  for (let f = 0; f < 60 * secs; f++) {
    const r = await page.evaluate(async (grab) => {
      const B = window.bend;
      await B.step(1);
      return { ...window.__look(), img: grab ? await B.grab('image/jpeg') : null, word: B.duel.hud()?.pops?.length ?? null };
    }, f % every === 0);
    if (r.img) save(`frames/${String(f / every).padStart(4, '0')}.jpg`, r.img);
    delete r.img;
    out.frames.push({ f, ...r });
    if ([20, 60, 120, 240, 360].includes(f)) {
      const ab = await page.evaluate(() => window.__ab());
      if (ab) { save(`ab-${f}-on.jpg`, ab.on); save(`ab-${f}-off.jpg`, ab.off); delete ab.on; delete ab.off; out.ab.push({ at: `+${(f / 60).toFixed(2)}s`, ...ab }); }
      if (f === 60) out.gpu = await page.evaluate(() => window.__gpu());
    }
  }
}

const fr = out.frames.filter((x) => x.size);
const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0);
out.summary = {
  bloomFrames: fr.length,
  bloomH: +Math.max(0, ...fr.map((x) => x.size.h)).toFixed(3), bloomW: +Math.max(0, ...fr.map((x) => x.size.w)).toFixed(3), bloomArea: +Math.max(0, ...fr.map((x) => x.size.area)).toFixed(3),
  bloomAreaMean: +mean(fr.map((x) => x.size.area)).toFixed(3),
  coreMean: +mean(out.frames.filter((x) => x.cover).map((x) => x.cover.core)).toFixed(4), coreWorst: +Math.max(0, ...out.frames.filter((x) => x.cover).map((x) => x.cover.core)).toFixed(3),
  over15: out.frames.filter((x) => x.cover && x.cover.core > 0.15).length,
  hiddenFlyer: out.frames.filter((x) => x.hidden).length ? +mean(out.frames.filter((x) => x.hidden).map((x) => Math.max(...x.hidden))).toFixed(3) : null,
  hiddenFrames: out.frames.filter((x) => x.hidden && Math.max(...x.hidden) > 0).length,
  levelMax: Math.max(0, ...out.frames.map((x) => x.level ?? 0)),
};
writeFileSync(join(outDir, 'answer.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary));
console.log('ab:', JSON.stringify(out.ab));
console.log('gpu:', JSON.stringify(out.gpu));
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
await browser.close();

// The duel's big moments as a player sees them (report 15's issue 2, report 16-moments): seeded sets of two virtual
// players in the page, stepped by hand at 60 fps, every frame sampled after it is drawn by the moments probe
// (src/duel/moments.ts, bend.duel.moments): the words on screen at once and how much of each body is under a word, a
// HUD ring or the moment's own light, at the peak moments (a reaction, a tier, a merge, a catch at range or at a
// geyser's top), at every catch, and over all of play. Optionally a still a few frames into each of the first peaks.
//   node scripts/moments-cap.mjs <out.json> --url http://127.0.0.1:5452/energybending/ [--runs 'temple:fire,water:1;pool:water,ice:2']
//        [--size 640x360] [--until 64] [--stills dir] [--stills-max 4] [--after 8]
// A run is world:dress:seed[:styles] (styles lead,flyer by default); --runs default is a rotation of the reacting
// pairs over the four worlds.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/moments.json';
const base = arg('url', 'http://127.0.0.1:5452/energybending/');
const [W, H] = arg('size', '640x360').split('x').map(Number);
const until = Number(arg('until', '66')), stills = arg('stills', ''), stillsMax = Number(arg('stills-max', '4')), after = Number(arg('after', '8'));
const DEF = ['redwoods:fire,water:2', 'pool:fire,water:2', 'temple:water,ice:13', 'geode:ice,fire:1', 'temple:fire,ice:1', 'redwoods:water,fire:3', 'pool:water,ice:4', 'geode:fire,water:4'];
const runs = (arg('runs', '') ? arg('runs', '').split(';') : DEF).map((r) => { const [world, dress, seed, styles] = r.split(':'); return { world, dress, seed, styles: styles ?? 'lead,flyer' }; });
if (stills) mkdirSync(stills, { recursive: true });

const browser = await launch({ width: W, height: H });
const all = [];
for (const R of runs) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  const url = `${base}?duel&world=${R.world}&dress=${R.dress}&p1=bot&p2=bot&style=${R.styles}&skill=0.85&seed=${R.seed}&go&noautores&class=laptop`;
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel?.moments, { timeout: 180000, polling: 200 });
  if (!all.length) console.log(`adapter: ${await adapterName(page)}`);
  await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.autoRes = null; k.renderScale = 1; window.bend.duel.moments.reset(); });
  let shots = 0, frames = 0;
  const t0 = Date.now();
  for (;;) {
    // (a chunk of frames in the page: each stepped, then sampled; a peak's still a few frames on)
    const r = await page.evaluate(async (n, after, want) => {
      const B = window.bend, M = B.duel.moments, grabs = [];
      let pending = -1, phase = B.duel.state.phase, t = 0;
      for (let i = 0; i < n; i++) {
        await B.step(1);
        const before = M.probe.moments.length;
        M.sample(1 / 60);
        if (want > grabs.length && pending < 0 && M.probe.moments.length > before) pending = after;
        if (pending === 0) { grabs.push({ t: B.duel.now() / 1000, kinds: M.probe.moments[M.probe.moments.length - 1].kinds, png: await B.grab('image/jpeg') }); pending = -1; }
        else if (pending > 0) pending--;
        phase = B.duel.state.phase; t = B.duel.match.clock(B.duel.now()).time / 1000;
        if (phase === 'finale' || phase === 'done') break;
      }
      return { phase, t, grabs };
    }, 300, after, stills ? Math.max(0, stillsMax - shots) : 0);
    frames += 300;
    for (const g of r.grabs) {
      const name = `${R.world}-${R.dress.replace(',', '-')}-${R.seed}-${g.t.toFixed(1)}-${g.kinds.join('+')}.jpg`;
      writeFileSync(join(stills, name), Buffer.from(g.png.split(',')[1], 'base64'));
      shots++;
    }
    if (r.phase === 'finale' || r.phase === 'done' || r.t >= until) break;
  }
  const res = await page.evaluate(() => window.bend.duel.moments.result());
  const line = { ...R, ...res };
  all.push(line);
  const P = res.peak, C = res.catch, A = res.all;
  console.log(`${R.world} ${R.dress} seed ${R.seed}: ${res.moments} peaks, most words at once ${res.mostAtPeak} (mean of each peak's most ${res.mostMean}); peak frames ${P.frames}: words ${P.wordsMean} mean, ${P.wordsP90} p90, a body covered ${(P.covered * 100).toFixed(0)}% (by a word ${(P.byWord * 100).toFixed(0)}%, by light ${(P.byLight * 100).toFixed(0)}%); catches: covered ${(C.covered * 100).toFixed(0)}%; all play: words ${A.wordsMean}, covered ${(A.covered * 100).toFixed(0)}% (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await page.close();
}
await browser.close();

// the sum over the runs, weighted by frames
const keys = ['peak', 'catch', 'all'];
const sum = Object.fromEntries(keys.map((k) => {
  const n = all.reduce((a, r) => a + r[k].frames, 0) || 1, w = (f) => all.reduce((a, r) => a + r[k][f] * r[k].frames, 0) / n;
  return [k, { frames: n, wordsMean: +w('wordsMean').toFixed(2), wordsMax: Math.max(...all.map((r) => r[k].wordsMax)), covered: +w('covered').toFixed(3), coreMean: +w('coreMean').toFixed(3), byWord: +w('byWord').toFixed(3), byLight: +w('byLight').toFixed(3), coverMean: +w('coverMean').toFixed(3) }];
}));
const moments = all.reduce((a, r) => a + r.moments, 0), mostMean = all.reduce((a, r) => a + r.mostMean * r.moments, 0) / Math.max(1, moments);
const hist = {};
for (const r of all) for (const m of r.list) hist[m.most] = (hist[m.most] ?? 0) + 1;
console.log(`\nall ${all.length} runs: ${moments} peaks; each peak's most words at once ${mostMean.toFixed(2)} on average, ${JSON.stringify(hist)} (words: peaks); peak frames ${sum.peak.frames}: words ${sum.peak.wordsMean}, a body covered ${(sum.peak.covered * 100).toFixed(1)}% (word ${(sum.peak.byWord * 100).toFixed(1)}%, light ${(sum.peak.byLight * 100).toFixed(1)}%), mean cover of the core ${sum.peak.coreMean}, of the body ${sum.peak.coverMean}; catches covered ${(sum.catch.covered * 100).toFixed(1)}%; all play covered ${(sum.all.covered * 100).toFixed(1)}%`);
writeFileSync(out, JSON.stringify({ runs: all, sum, moments, mostMean, hist }, null, 1));
console.log(`wrote ${out}`);

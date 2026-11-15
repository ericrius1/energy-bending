// The duel measured in the page (phase 4, report 16): whole sets played by two virtual players in headless Chrome on the
// real GPU, stepped by hand at 60 fps (bend.step), so each world plays at its own track's tempo on the music's clock as
// the game does (the page's set length, the time warp, the world's solids and hazards as drawn), at a small size so it
// runs faster than real time. Where the Node harness (duel-measure.mjs) measures the rules and bodies alone, this is
// the page's own duel. Per set: fused, the peak, merges and the first one, catches (and from the air), falls, the
// hazard's rides, the tempo. Dress and styles rotated as duel-measure.mjs rotates them.
//   node scripts/duel-page.mjs --url http://localhost:<port>/energybending/ [--world geode,redwoods,temple,pool]
//     [--sets 8] [--seed 1] [--skill 0.85] [--set 60] [--size 480x270] [--bpm N] [--json out.json]
// (--set S plays sets of S seconds, as a film does; without it, the page's own: whole phrases of the world's track.
// --bpm N runs the world's music at N in place of its track's.)
import { writeFileSync } from 'node:fs';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5391/energybending/');
const worlds = arg('world', 'geode,redwoods,temple,pool').split(',');
const sets = Number(arg('sets', '8'));
const seed0 = Number(arg('seed', '1'));
const skill = arg('skill', '0.85');
const setS = arg('set', '');
const bpmArg = arg('bpm', '');
const [W, H] = arg('size', '480x270').split('x').map(Number);
const jsonOut = arg('json', '');
const DRESS = [['fire', 'water'], ['water', 'ice'], ['ice', 'fire'], ['plasma', 'gems'], ['gems', 'plasma']];
const STYLES = [['lead', 'flyer'], ['base', 'flyer'], ['lead', 'lead'], ['flyer', 'base']];

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
const all = [];
for (const world of worlds) {
  const rows = [];
  for (let r = 0; r < sets; r++) {
    const seed = seed0 + r, dress = DRESS[r % DRESS.length], styles = STYLES[Math.floor(r / DRESS.length) % STYLES.length];
    const q = `duel&world=${world}&dress=${dress}&p1=bot&p2=bot&style=${styles}&skill=${skill}&seed=${seed}&noautores${setS ? `&set=${setS}` : ''}`;
    await page.goto(`${BASE}?${q}`, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000, polling: 200 });
    const t0 = Date.now();
    const row = await page.evaluate(async (bpmArg) => {
      const B = window.bend, k = B.kit;
      k.manual = true; k.autoRes = null; k.renderScale = 1;
      // the music's clock on the stepped frames: with no sound and no film it runs on the page's wall clock
      // (performance.now), which a page stepped faster or slower than real time leaves behind or runs ahead of, so the
      // beat the dancers hear would jump against the time they dance in. A film's clock is the frames' own; so is this
      const M = B.music;
      M.filmClock = M.now();
      M.now = () => M.filmClock; M.time = () => M.filmClock;
      const pin = () => { if (bpmArg) { const c = B.music.engine.clock; c.bpm = c.targetBpm = Number(bpmArg); } };
      pin();
      const D = B.duel, rides = {}, falls = [0, 0];
      // (from set 1 again, on the stepped clock)
      D.restart();
      for (const kk of Object.keys(D.state.stats)) D.state.stats[kk] = 0;
      if (D.hazards?.rides) for (const kk of Object.keys(D.hazards.rides)) delete D.hazards.rides[kk];
      const merges = [];
      let fused = null, peak = 0, bpm = 0, catches = 0, aerials = 0, high = 0, lastT = -1;
      // step until the set's banner (done), at most 100 s
      for (let i = 0; i < 6000; i += 30) {
        await B.step(30); pin();
        const s = D.state;
        bpm = B.music.clock.info.bpm || bpm;
        for (const h of D.history) if (h.t > lastT && h.e.k === 'merge') merges.push(+((h.t - s.playFrom) / 1000).toFixed(1));
        lastT = D.history.length ? D.history[D.history.length - 1].t : lastT;
        if (s.phase === 'finale' || s.phase === 'done') { fused = s.fused; peak = s.peak; high = s.highBest / 1000; }
        if (s.phase === 'done' && s.set >= 1) break;
      }
      const s = D.state;
      catches = s.stats.catches + s.stats.aerials; aerials = s.stats.aerials;
      const hz = D.hazards?.rides ?? {};
      for (const [kk, v] of Object.entries(hz)) rides[kk] = { n: v.n, s: +v.s.toFixed(1) };
      return { fused, peak: +peak.toFixed(3), high: +high.toFixed(2), merges: s.stats.merges, mergeAt: merges, catches, aerials, falls: s.stats.falls, rides, bpm: +bpm.toFixed(2), setMs: D.match.o.setMs, phase: s.phase, perfect: +(s.stats.perfect / Math.max(1, s.stats.links)).toFixed(2), links: s.stats.links };
    }, bpmArg);
    row.seed = seed; row.dress = dress; row.styles = styles; row.wall = +((Date.now() - t0) / 1000).toFixed(1);
    rows.push(row);
    console.log(`${world} #${r + 1} seed ${seed} ${dress} ${styles}: ${row.fused ? 'FUSED' : 'no'} peak ${row.peak} high ${row.high}s merges ${row.merges} catches ${row.catches} (${row.aerials} air) falls ${row.falls} ${JSON.stringify(row.rides)} bpm ${row.bpm} set ${(row.setMs / 1000).toFixed(1)}s (${row.wall}s)`);
  }
  const n = rows.length, sum = (f) => rows.reduce((a, x) => a + f(x), 0), minutes = sum((x) => x.setMs) / 60000;
  const line = {
    world, sets: n, fused: sum((x) => (x.fused ? 1 : 0)), peak: +(sum((x) => x.peak) / n).toFixed(3), merged: sum((x) => (x.merges ? 1 : 0)), merges: sum((x) => x.merges),
    catchesPerMin: +(sum((x) => x.catches) / minutes).toFixed(1), air: +(sum((x) => x.aerials) / Math.max(1, sum((x) => x.catches))).toFixed(2), falls: sum((x) => x.falls),
    high: +(sum((x) => x.high) / n).toFixed(2), bpm: rows[0]?.bpm, rows,
  };
  all.push(line);
  console.log(`== ${world}: fused ${line.fused} of ${n}, peak ${line.peak}, merged ${line.merged} (${line.merges}), catches ${line.catchesPerMin}/min (${(line.air * 100).toFixed(0)}% air), falls ${line.falls}, top ${line.high}s, ${line.bpm} bpm`);
}
console.log('adapter:', await adapterName(page));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all, null, 1));
await browser.close();

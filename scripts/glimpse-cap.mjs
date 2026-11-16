// Stills of the next world glimpsed out of the mirrors (phase 7, report 24): a duel played by two virtual players,
// stepped at 60 fps, grabbed from the duel's own camera at chosen seconds of the set with the glimpses on and again off
// (two frames in a row, off then on: `bend.duel.glimpse.on`), so each pair shows only what the glimpse adds.
//   node scripts/glimpse-cap.mjs --url http://localhost:<port>/energybending/ --q "duel&world=temple&...&seed=1"
//     [--at 14,20,26] [--size 1280x720] [--out dir] [--name glimpse]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5391/energybending/');
const q = arg('q', 'duel&world=temple&dress=fire,water&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=1');
const at = arg('at', '14,20,26').split(',').map(Number);
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const out = arg('out', 'glimpse-cap'), name = arg('name', 'glimpse');
mkdirSync(out, { recursive: true });

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(`${BASE}?${q}&noautores`, { timeout: 400000 });
await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 400000, polling: 200 });
await page.evaluate(() => {
  const B = window.bend, k = B.kit;
  k.manual = true; k.autoRes = null; k.renderScale = 1;
  const M = B.music;
  M.filmClock = M.now(); M.now = () => M.filmClock; M.time = () => M.filmClock; M.film = true;
  B.duel.restart();
});
for (const s of at) {
  const r = await page.evaluate(async (s) => {
    const B = window.bend, D = B.duel;
    for (let i = 0; i < 60 * 40; i++) {
      if (D.state.phase === 'play' && D.voyage && (window.__t = (window.__t ?? 0) + 1 / 60) >= s) break;
      await B.step(1);
    }
    D.glimpse.on = false; await B.step(1);
    const off = await B.grab('image/jpeg', 0.9);
    D.glimpse.on = true; await B.step(1);
    const on = await B.grab('image/jpeg', 0.9);
    return { on, off, world: B.gates.rigWorld, t: window.__t };
  }, s);
  for (const [k, url] of [['on', r.on], ['off', r.off]]) writeFileSync(join(out, `${name}-${s}s-${k}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${s}s (${r.t.toFixed(1)} s of play) in ${r.world}`);
}
await browser.close();

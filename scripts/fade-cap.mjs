// The near fade's frame test seen in a duel (docs/reports/14-camera.md, "The near fade in the duel's frame"): a duel of
// two virtual players, stepped by hand, grabbed twice at each chosen moment: with the frame test on (`<world>-<t>.png`)
// and, one stepped frame later, off (`<world>-<t>-off.png`: as master draws it). The camera never reads the fade, so
// the set and the moment are the same either way. The moments are fixed (`--at 12,15,18,21`) or found (`--find 4`: the
// first moments, at least 2 s apart, where the pieces it dissolves cover the most of the frame, looked for every half
// second). Then a sheet per world (`sheet-<world>.jpg`: off above, on below), if ffmpeg is on the path.
//   node scripts/fade-cap.mjs <outdir> --url http://127.0.0.1:<port>/energybending/ --world geode --dress gems,plasma
//        [--at 12,15,18,21 | --find 4] [--seed 5] [--size 960x540] [--until 58]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/fade';
const base = arg('url', 'http://127.0.0.1:5391/energybending/');
const world = arg('world', 'geode'), dress = arg('dress', 'gems,plasma'), seed = arg('seed', '5');
const [W, H] = arg('size', '960x540').split('x').map(Number);
const at = arg('at', '') ? arg('at', '').split(',').map(Number) : null, find = Number(arg('find', '4')), until = Number(arg('until', '58'));
mkdirSync(out, { recursive: true });

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  page error:', m.text().slice(0, 300)); });
const url = `${base}?duel&world=${world}&dress=${dress}&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=${seed}&noautores`;
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
console.log(`opened ${url}; ${await adapterName(page)}`);
await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.autoRes = null; k.renderScale = 1; });

const grabPair = async (t) => {
  const r = await page.evaluate(async () => {
    const B = window.bend, seen = JSON.parse(JSON.stringify(B.fade.seen));
    const on = await B.grab('image/png');
    B.set('fadeFrame', { easeOut: 0, easeBack: 0 }); B.set('fade', { frame: false });
    const off = await B.grab('image/png');
    B.set('fade', { frame: true }); B.set('fadeFrame', { easeOut: 0.6, easeBack: 0.08 });
    return { on, off, seen };
  });
  const name = `${world}-${t}`;
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.on.split(',')[1], 'base64'));
  writeFileSync(join(out, `${name}-off.png`), Buffer.from(r.off.split(',')[1], 'base64'));
  console.log(`${name}: pieces ${JSON.stringify(r.seen.pieces)}, cover ${r.seen.cover.toFixed(2)}`);
  return name;
};

const names = [];
let t = 0, last = -9;
const stepTo = async (s) => { const n = Math.round((s - t) * 60); if (n > 0) await page.evaluate((n) => window.bend.step(n), n); t = s; };
if (at) for (const s of at) { await stepTo(s); names.push(await grabPair(s)); }
else {
  for (let s = 0.5; s <= until && names.length < find; s += 0.5) {
    await stepTo(s);
    const cover = await page.evaluate(() => window.bend.fade.seen.cover);
    if (cover >= 0.25 && s - last >= 2) { names.push(await grabPair(s)); last = s; t += 2 / 60; }
  }
}
await browser.close();

// the sheet: off above, on below
if (names.length) {
  const ins = names.flatMap((n) => ['-i', join(out, `${n}-off.png`)]).concat(names.flatMap((n) => ['-i', join(out, `${n}.png`)]));
  const k = names.length, row = (o) => Array.from({ length: k }, (_, i) => `[${o + i}]`).join('');
  const f = `${row(0)}hstack=${k}[a];${row(k)}hstack=${k}[b];[a][b]vstack=2,scale=${Math.min(1920, W * k)}:-1`;
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...ins, '-filter_complex', k > 1 ? f : '[0][1]vstack=2', '-q:v', '4', join(out, `sheet-${world}.jpg`)], { stdio: 'inherit' });
  if (r.status === 0) console.log(`sheet-${world}.jpg`);
}

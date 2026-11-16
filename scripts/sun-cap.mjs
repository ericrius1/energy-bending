// The sun worlds from the duel's own camera (report 20-sun-worlds): a seeded duel of two virtual players in the temple
// or the Pool, stepped by hand on the frames' clock (the music's clock pinned to them, as duel-page.mjs does, so the
// temple's spring tide follows the stepped beat), grabbed at given seconds; with --timings the GPU per pass over 150
// frames from the duel's camera; then with --wide a wide establishing still from a fixed pose (the duel camera's pose
// held by hand). The tide's height is printed with each grab. The mirrors are shut (&mirrors=0: the pair stay in the
// world asked for, and no gate is drawn live) unless --open. A page loaded again does not replay a set exactly, so a
// before and an after are the same seeded duel at the same second, not the same frame.
//   node scripts/sun-cap.mjs <outdir> --url http://127.0.0.1:<port>/energybending/ --world temple [--dress fire,water]
//     [--seed 3] [--at 6,18,30] [--size 1280x720] [--wide] [--timings] [--prefix name] [--set JSON] [--open]
//     [--hero x,y,z[;x,y,z]] (report 24: how often each point, a hero piece's middle and top, is inside the duel camera's
//     frame, sampled every quarter second while stepping; a point counts when it projects inside the frame in front of
//     the eye, whether or not something stands in front of it)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/sun';
const base = arg('url', 'http://127.0.0.1:5489/energybending/');
const world = arg('world', 'temple'), dress = arg('dress', 'fire,water'), seed = arg('seed', '3');
const at = arg('at', '6,18,30').split(',').filter(Boolean).map(Number);
const prefix = arg('prefix', world);
const [W, H] = arg('size', '1280x720').split('x').map(Number);
mkdirSync(out, { recursive: true });

/** each world's wide establishing pose: an eye up on the court's front, looking over the stage to the world beyond */
const WIDE = {
  temple: { eye: [3.5, 4.2, 14.5], look: [-1.5, 2.6, -12], fov: 62 },
  pool: { eye: [6.5, 3.4, 13], look: [-2, 1.6, -14], fov: 62 },
};

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log(`  page ${m.type()}:`, m.text().slice(0, 300)); });
const url = `${base}?duel${argv.includes('--open') ? '' : '&mirrors=0'}&world=${world}&dress=${dress}&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=${seed}&noautores${arg('query', '') ? '&' + arg('query', '') : ''}`;
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000, polling: 200 });
console.log(`opened ${url}; ${await adapterName(page)}`);
await page.evaluate(() => {
  const B = window.bend, k = B.kit;
  k.manual = true; k.autoRes = null; k.renderScale = 1;
  const M = B.music;
  M.filmClock = M.now();
  M.now = () => M.filmClock; M.time = () => M.filmClock;
  B.duel.restart();
});
// (--set '{"temple":{"shafts":0}}': params for the run, as shot.mjs's `params`)
if (arg('set', '')) await page.evaluate((P) => { for (const [g, v] of Object.entries(P)) window.bend.set(g, v); }, JSON.parse(arg('set', '')));

const grab = async (name) => {
  const { jpg, tide } = await page.evaluate(async () => ({ jpg: await window.bend.grab('image/jpeg', 0.9), tide: window.bend.worldOf?.('temple')?.tide ?? null }));
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(jpg.split(',')[1], 'base64'));
  console.log(`${name}.jpg${tide !== null && world === 'temple' ? `  tide ${tide.toFixed(2)} m` : ''}`);
};

let t = 0;
const heroPts = arg('hero', '') ? arg('hero', '').split(';').map((p) => p.split(',').map(Number)) : [];
const heroSeen = heroPts.map(() => 0);
let heroN = 0;
const stepTo = async (s) => {
  let n = Math.round((s - t) * 60);
  while (n > 0) {
    const k = Math.min(n, heroPts.length ? 15 : 60);
    const seen = await page.evaluate((k, P) => {
      window.bend.music.filmClock += k / 60; window.bend.step(k);
      const m = window.bend.kit.camera.viewProj;
      return P.map(([x, y, z]) => {
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (w <= 1e-3) return false;
        const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
        return Math.abs(px) < 1 && Math.abs(py) < 1;
      });
    }, k, heroPts);
    if (heroPts.length) { heroN++; seen.forEach((v, i) => { if (v) heroSeen[i]++; }); }
    n -= k;
  }
  t = s;
};
for (const s of at) { await stepTo(s); await grab(`${prefix}-${String(s).padStart(2, '0')}s`); }
if (heroPts.length) heroPts.forEach((p, i) => console.log(`hero point ${p.join(',')}: in the frame ${(100 * heroSeen[i] / Math.max(heroN, 1)).toFixed(0)} % of ${heroN} samples`));

if (argv.includes('--timings')) {
  const T = await page.evaluate(async () => {
    const k = window.bend.kit;
    k.profiler.force = true;
    for (let i = 0; i < 150; i++) { k.step(1 / 60); if (i % 5 === 0) await k.device.queue.onSubmittedWorkDone(); await new Promise((r) => setTimeout(r, 4)); }
    await k.device.queue.onSubmittedWorkDone();
    return { passes: [...k.profiler.ms].sort((a, b) => b[1] - a[1]), frame: k.profiler.frameMs, render: [...k.size.render] };
  });
  console.log(`gpu frame ${T.frame.toFixed(3)} ms at ${T.render.join('x')}`);
  for (const [l, v] of T.passes.slice(0, 16)) console.log(`  ${l.padEnd(28)} ${v.toFixed(3)} ms`);
  writeFileSync(join(out, `${prefix}-timings.json`), JSON.stringify(T, null, 1));
}
if (argv.includes('--wide')) {
  const P = WIDE[world];
  await page.evaluate((P) => { Object.defineProperty(window.bend.rig, 'pose', { get: () => P, set: () => {}, configurable: true }); }, P);
  await page.evaluate(() => window.bend.step(2));
  await grab(`${prefix}-wide`);
}

await browser.close();

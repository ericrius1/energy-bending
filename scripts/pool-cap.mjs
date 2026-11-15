// The Pool's moments from the duel's camera (report 16-pool): a duel of two virtual players in the Pool, stepped by
// hand, grabbed at the moments the water has to read: a body floating still, a body swimming, a catch made with a body
// in the water, and the swell's crest passing the pair (within 1.2 m of its middle, one of them low). Each is the first of its kind (scanned every tenth of a second) and
// grabbed when found; the times go to <outdir>/moments.json (`--at` grabs at given times instead). A page loaded again
// does not replay the same set, so a before and an after are the same kinds of moment in the same seeded duel, not the
// same frames. Then a sheet (`sheet.jpg`), if ffmpeg is on the path.
//   node scripts/pool-cap.mjs <outdir> --url http://127.0.0.1:<port>/energybending/ [--dress water,ice] [--seed 3]
//        [--size 960x540] [--until 60] [--at <moments.json>] [--timings]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/pool';
const base = arg('url', 'http://127.0.0.1:5391/energybending/');
const dress = arg('dress', 'water,ice'), seed = arg('seed', '3'), until = Number(arg('until', '60'));
const [W, H] = arg('size', '960x540').split('x').map(Number);
const given = arg('at', '') ? JSON.parse(readFileSync(arg('at', ''), 'utf8')) : null;
mkdirSync(out, { recursive: true });

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log(`  page ${m.type()}:`, m.text().slice(0, 300)); });
const url = `${base}?duel&world=pool&dress=${dress}&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=${seed}&noautores`;
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
console.log(`opened ${url}; ${await adapterName(page)}`);
await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.autoRes = null; k.renderScale = 1; });

/** what is happening now: each seat in the water (and how fast), a catch since the last look (history after `since`, ms
 *  of duel time), the swell's crest (0 … 1 across the pool) */
const look = (since) => page.evaluate((since) => {
  const D = window.bend.duel, Hz = D.hazards, H = Hz.hazard;
  const seats = Hz.chars.map((c) => ({ y: c.root[1], sp: Math.hypot(c.v[0], c.v[2]), wet: c.root[1] < -0.8, grounded: c.grounded }));
  const h = D.history, last = h.length ? h[h.length - 1].t : since;
  const caught = h.some((x) => x.t > since && x.e.k === 'link' && (x.e.kind === 'catch' || x.e.kind === 'aerial'));
  // (the swell's crest: hazards.ts swellNow, and how far it is from the pair's middle)
  const S = H.swell, ph = Math.floor(H.beat / 16), b = H.beat - ph * 16, u = b / 12, a = S.dirs[ph % S.dirs.length];
  const crest = -S.reach + 2 * S.reach * u, m = [0, 2].map((i) => (Hz.chars[0].root[i] + Hz.chars[1].root[i]) / 2);
  const off = Math.abs((m[0] - S.center[0]) * Math.cos(a) + (m[1] - S.center[1]) * Math.sin(a) - crest);
  return { seats, caught, last, swell: u > 0.15 && u < 0.9 ? off : 99, play: D.state.phase === 'play' };
}, since);

const grab = async (name) => {
  const { png, at } = await page.evaluate(async () => ({ png: await window.bend.grab('image/png'), at: window.bend.duel.stats().seats.map((s) => s.at) }));
  writeFileSync(join(out, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  console.log(`${name}.png: ${JSON.stringify(at)}`);
};

// (a page loaded again does not play the same set: the set's start rides on the page's own time, so each moment is
// grabbed in the run that finds it, and a before and an after are the same kinds of moment, not the same frames)
let t = 0;
const stepTo = async (s) => { const n = Math.round((s - t) * 60); if (n > 0) await page.evaluate((n) => window.bend.step(n), n); t = s; };
const moments = {}, names = [];
const take = async (k, s) => { moments[k] = s; names.push(k); await grab(k); };
const want = given ? Object.keys(given) : ['float', 'swim', 'catch', 'swell'];
let since = 0;
for (let s = 4; s <= until && want.some((w) => moments[w] === undefined); s += 0.1) {
  s = Math.round(s * 10) / 10;
  await stepTo(s);
  const L = await look(since);
  since = L.last;
  if (!L.play) continue;
  if (given) { for (const [k, at] of Object.entries(given)) if (moments[k] === undefined && Math.abs(at - s) < 0.05) await take(k, s); continue; }
  const wet = L.seats.findIndex((q) => q.wet && q.grounded);
  if (moments.float === undefined && wet >= 0 && L.seats[wet].sp < 0.8) await take('float', s);
  else if (moments.swim === undefined && wet >= 0 && L.seats[wet].sp > 2.2) await take('swim', s);
  else if (moments.catch === undefined && L.caught && L.seats.some((q) => q.wet)) await take('catch', s);
  else if (moments.swell === undefined && L.swell < 1.2 && L.seats.some((q) => q.y < 0.5)) await take('swell', s);
}
writeFileSync(join(out, 'moments.json'), JSON.stringify(moments));
console.log('moments', JSON.stringify(moments));

if (argv.includes('--timings')) {
  const T = await page.evaluate(async () => {
    const k = window.bend.kit;
    k.profiler.force = true;
    for (let i = 0; i < 150; i++) { k.step(1 / 60); if (i % 5 === 0) await k.device.queue.onSubmittedWorkDone(); await new Promise((r) => setTimeout(r, 4)); }
    await k.device.queue.onSubmittedWorkDone();
    return { passes: [...k.profiler.ms].sort((a, b) => b[1] - a[1]), frame: k.profiler.frameMs, render: [...k.size.render] };
  });
  console.log(`gpu frame ${T.frame.toFixed(3)} ms at ${T.render.join('x')}`);
  for (const [l, v] of T.passes.filter(([l], i) => i < 14 || /pool|scene|air|surface/.test(l))) console.log(`  ${l.padEnd(28)} ${v.toFixed(3)} ms`);
  writeFileSync(join(out, 'timings.json'), JSON.stringify(T, null, 1));
}
await browser.close();

if (names.length > 1) {
  const ins = names.flatMap((n) => ['-i', join(out, `${n}.png`)]);
  const k = names.length, cols = k > 2 ? 2 : k, rows = Math.ceil(k / cols);
  const lay = Array.from({ length: k }, (_, i) => `${(i % cols) ? `w0*${i % cols}` : '0'}_${Math.floor(i / cols) ? `h0*${Math.floor(i / cols)}` : '0'}`).join('|');
  const f = `${names.map((_, i) => `[${i}]`).join('')}xstack=inputs=${k}:layout=${lay}${rows * cols > k ? ':fill=black' : ''},scale=${Math.min(1920, W * cols)}:-1`;
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...ins, '-filter_complex', f, '-q:v', '4', join(out, 'sheet.jpg')], { stdio: 'inherit' });
  if (r.status === 0) console.log('sheet.jpg');
}

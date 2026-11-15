// A low-resolution test clip of a mirror crossing in the duel (phase 6, report 20-crossing), from the duel's own camera
// with the HUD and the mirrors' plaques (bend.grab), stepped at 60 fps on the frames' clock (as cross-measure.mjs).
// Pass 1 plays the set until its `--nth` crossing (1: the first) and notes when; pass 2 plays it again from the start
// (it is deterministic) and grabs every frame from `--before` s before that crossing to `--after` s after it, then
// ffmpeg makes an mp4 (no sound: the page's music is a schedule, not audio, headless). Stills of chosen moments too.
//   node scripts/cross-clip.mjs --url http://localhost:<port>/energybending/ --q "duel&world=geode&...&seed=2"
//     [--nth 1] [--before 2] [--after 5] [--size 640x360] [--out dir] [--name clip] [--stills 0.5,1.5,3]
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5391/energybending/');
const q = arg('q', 'duel&world=geode&dress=water,ice&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=2');
const nth = Number(arg('nth', '1'));
const before = Number(arg('before', '2')), after = Number(arg('after', '5'));
const [W, H] = arg('size', '640x360').split('x').map(Number);
const out = arg('out', 'cross-clip');
const name = arg('name', 'clip');
const stills = arg('stills', '').split(',').filter(Boolean).map(Number);
mkdirSync(out, { recursive: true });

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => { if (/through the mirror/.test(m.text())) console.log('  page:', m.text()); });

async function open() {
  await page.goto(`${BASE}?${q}&noautores`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000, polling: 200 });
  await page.evaluate(() => {
    const B = window.bend, k = B.kit;
    k.manual = true; k.autoRes = null; k.renderScale = 1;
    const M = B.music;
    M.filmClock = M.now(); M.now = () => M.filmClock; M.time = () => M.filmClock; M.film = true;
    B.duel.restart();
  });
}

// pass 1: when is the crossing (frames from the restart)
await open();
const at = await page.evaluate(async (nth) => {
  const B = window.bend, D = B.duel;
  for (let i = 0; i < 6600; i++) {
    await B.step(1);
    if (D.crossings.length >= nth) return { frame: i, cross: D.crossings[nth - 1] };
    if (D.state.phase === 'done') return null;
  }
  return null;
}, nth);
if (!at) { console.log('no crossing'); await browser.close(); process.exit(1); }
console.log(`crossing ${nth} at frame ${at.frame}: ${JSON.stringify(at.cross)}`);

// pass 2: again, grabbing from `before` s ahead of it
await open();
const f0 = Math.max(0, at.frame - Math.round(before * 60)), f1 = at.frame + Math.round(after * 60);
await page.evaluate(async (n) => { await window.bend.step(n); }, f0);
const dir = join(out, `${name}-frames`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const log = [];
for (let f = f0, i = 0; f <= f1; f++, i++) {
  const r = await page.evaluate(async () => {
    const B = window.bend, url = await B.grab('image/jpeg', 0.88);
    const G = B.gates, c = B.kit.camera;
    return { url, world: G.rigWorld, view: B.duel.world, offset: !!G.offset, eye: [...c.position].map((v) => +v.toFixed(2)), how: B.duel.crossings.at(-1)?.how ?? null };
  });
  const t = (f - at.frame) / 60;
  writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(r.url.split(',')[1], 'base64'));
  for (const s of stills) if (Math.abs(t - s) < 1 / 120) writeFileSync(join(out, `${name}-${s >= 0 ? '+' : ''}${s.toFixed(2)}s.jpg`), Buffer.from(r.url.split(',')[1], 'base64'));
  log.push({ t: +t.toFixed(3), offset: r.offset, eye: r.eye, how: r.how });
}
writeFileSync(join(out, `${name}.json`), JSON.stringify({ q, at, log }, null, 1));
const mp4 = join(out, `${name}.mp4`);
const ff = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '60', '-i', join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'veryfast', mp4]);
if (ff.status) console.log(String(ff.stderr));
console.log(`wrote ${mp4} (${f1 - f0 + 1} frames)`);
await browser.close();

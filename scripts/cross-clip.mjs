// A low-resolution test clip of a mirror crossing in the duel (phase 6, report 20-crossing), from the duel's own camera
// with the HUD and the mirrors' plaques (bend.grab), stepped at 60 fps on the frames' clock (as cross-measure.mjs).
// It grabs every frame, keeps the last `--before` s, and goes on `--after` s past the set's `--nth` crossing (1: the
// first); then ffmpeg makes an mp4 (no sound: the page's music is a schedule, not audio, headless). Stills of chosen moments too.
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

// one pass (a page reloaded doesn't always dance the same: shaders compiling on the first frames shift it), every frame
// grabbed, the last `before` seconds kept, until `after` s past the `nth` crossing
await open();
const dir = join(out, `${name}-frames`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const keep = Math.round(before * 60), ring = [];
let at = null, left = Math.round(after * 60), i = 0;
const log = [];
for (let f = 0; f < 6600 && left > 0; f++) {
  const r = await page.evaluate(async (nth) => {
    const B = window.bend, url = await B.grab('image/jpeg', 0.88), D = B.duel, G = B.gates, c = B.kit.camera;
    const X = D.crossings[nth - 1], g = X ? G.gates.get(X.out) : null, p = c.position, z = g ? +((p[0] - g.at[0]) * g.n[0] + (p[1] - g.at[1]) * g.n[1] + (p[2] - g.at[2]) * g.n[2]).toFixed(2) : null, fz = g ? +(c.forward[0] * g.n[0] + c.forward[1] * g.n[1] + c.forward[2] * g.n[2]).toFixed(2) : null;
    return { z, fz, url, n: D.crossings.length >= nth ? D.crossings[nth - 1] : null, done: D.state.phase === 'done', offset: !!G.offset, eye: [...c.position].map((v) => +v.toFixed(2)), how: D.crossings.at(-1)?.how ?? null, cam: { ...D.crossCam } };
  }, nth);
  ring.push({ f, ...r });
  if (!at && r.n) { at = { frame: f, cross: r.n }; console.log(`crossing ${nth} at frame ${f}: ${JSON.stringify(r.n)}`); }
  if (at) left--;
  else if (ring.length > keep) ring.shift();
  if (r.done && !at) break;
}
if (!at) { console.log('no crossing'); await browser.close(); process.exit(1); }
for (const r of ring) {
  const t = (r.f - at.frame) / 60, buf = Buffer.from(r.url.split(',')[1], 'base64');
  writeFileSync(join(dir, `f${String(i++).padStart(4, '0')}.jpg`), buf);
  for (const s of stills) if (Math.abs(t - s) < 1 / 120) writeFileSync(join(out, `${name}-${s >= 0 ? '+' : ''}${s.toFixed(2)}s.jpg`), buf);
  log.push({ t: +t.toFixed(3), offset: r.offset, z: r.z, fz: r.fz, eye: r.eye, how: r.how, cam: r.cam });
}
const f0 = ring[0].f, f1 = ring[ring.length - 1].f;
writeFileSync(join(out, `${name}.json`), JSON.stringify({ q, at, log }, null, 1));
const mp4 = join(out, `${name}.mp4`);
const ff = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '60', '-i', join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'veryfast', mp4]);
if (ff.status) console.log(String(ff.stderr));
console.log(`wrote ${mp4} (${f1 - f0 + 1} frames)`);
await browser.close();

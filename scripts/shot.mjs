// Headless stills and GPU timings: node scripts/shot.mjs <outdir> [steps.json] [--url URL] [--query 'pip&lock']
//   [--size 1280x800] [--timings] [--api bend|lapidary]
// Takes the shared render lock (docs/PLAN.md "Shared habits"), starts headless Chrome on the real GPU (it prints the
// adapter it got), opens the page and waits for it to be ready, then runs the steps: each step's frames are stepped by
// hand at 60 fps (window.bend.step) and the canvas read back (bend.grab) into <outdir>/<name>.png. With --timings it
// then times 120 frames of GPU work per pass (weft's profiler) and prints them sorted. Console warnings and errors from
// the page are printed, and counted at the end.
//
// A step: { name, query?, world?, wake?, goto?, next?, shot?, params?: { group: { key: value } }, frames?, yaw?, dist?,
//   pitch?, lock?, swipe?: y, hold?: [x, y, seconds], after?, frames2? }. A step with its own `query` opens the page
//   again with it. --api lapidary drives the original Gem Dancers (window.lapidary) with the same steps, for comparison.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2), opts = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) pos.push(a);
  else if (['url', 'query', 'size', 'api'].includes(a.slice(2))) opts[a.slice(2)] = argv[++i];
  else opts[a.slice(2)] = true;
}
const out = pos[0] ?? 'shots/adhoc';
const steps = pos[1] ? JSON.parse(readFileSync(pos[1], 'utf8')) : [{ name: 'asleep', frames: 120 }, { name: 'awake', wake: true, frames: 600 }];
const API = opts.api ?? 'bend';
const BASE = opts.url ?? (API === 'lapidary' ? 'http://127.0.0.1:5392/dancers/' : 'http://127.0.0.1:5391/energybending/');
const [W, H] = (opts.size ?? '1280x800').split('x').map(Number);
mkdirSync(out, { recursive: true });

const release = await takeLock();
const browser = await launch({ width: W, height: H, extra: ['--enable-webgpu-developer-features'] });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warn' || m.type() === 'warning' || /\[weft/.test(t)) { problems.push(`[${m.type()}] ${t}`); console.log(`  page ${m.type()}: ${t.slice(0, 500)}`); }
});
page.on('pageerror', (e) => { problems.push(`[pageerror] ${e.message}`); console.log('  pageerror:', e.message); });

let opened = null;
async function open(query) {
  const q = [opts.query, query, 'noautores'].filter(Boolean).join('&');
  const url = `${BASE}${BASE.includes('?') ? '&' : '?'}${q}`;
  if (opened === url) return;
  opened = url;
  const t0 = Date.now();
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
  console.log(`opened ${url} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.evaluate((api) => {
    const k = (window.bend ?? window.lapidary).kit;
    k.manual = true; k.autoRes = null; k.renderScale = 1;
    if (api === 'lapidary') {
      // the original's hooks, shaped like bend's for these steps (read-only comparison: nothing in it is changed)
      const L = window.lapidary;
      window.__api = {
        step: (n) => L.step(n), wake: () => L.wake(), goto: (i) => L.director.goto(i), next: () => L.director.next(), shoot: (s) => L.shoot(s),
        world: async (id) => { L.setScene(id === 'redwoods' ? 'forest' : 'geode', true); },
        camera: (o) => { Object.assign(L.cam, o); }, lock: () => {},
        set: (_g, patch) => { Object.assign(L.P, patch); L.updateLook(); },
        point: (x, y, inside) => L.point(x, y, inside), press: (d) => L.press(d), kit: L.kit,
      };
    } else window.__api = window.bend;
  }, API);
}

for (const s of steps) {
  await open(s.query ?? '');
  const t0 = Date.now();
  await page.evaluate(async (s) => {
    const B = window.__api;
    if (s.world) await B.world(s.world);
    if (s.params) for (const [g, patch] of Object.entries(s.params)) B.set(g, patch);
    if (s.wake) B.wake();
    if (s.goto !== undefined) B.goto(s.goto);
    if (s.next) B.next();
    if (s.shot) B.shoot(s.shot);
    if (s.lock !== undefined) B.lock(s.lock);
    const cam = {};
    for (const k of ['yaw', 'dist', 'pitch', 'height', 'idle']) if (s[k] !== undefined) cam[k] = s[k];
    if (Object.keys(cam).length) B.camera(cam);
    await B.step(s.frames ?? 120);
    const c = document.getElementById('stage'), r = c.getBoundingClientRect();
    if (s.swipe) {
      for (let i = 0; i < 24; i++) { B.point(r.width * (0.2 + 0.6 * i / 24), r.height * s.swipe); await B.step(1); }
      B.point(0, 0, false);
      await B.step(s.after ?? 10);
    }
    if (s.hold) {
      const [x, y, secs] = s.hold;
      B.point(r.width * x, r.height * y); B.press(true);
      await B.step(Math.round(secs * 60));
      B.press(false); B.point(0, 0, false);
      await B.step(s.after ?? 10);
    }
  }, s);
  const ms = Date.now() - t0;
  const png = await page.evaluate(async (api) => {
    if (api === 'bend') return window.bend.grab('image/png');
    // the original has no readback hook: read the canvas the way weft's Capture does
    const k = window.lapidary.kit;
    k.configureCanvas(GPUTextureUsage.COPY_SRC);
    k.step(1 / 60);
    const tex = k.context.getCurrentTexture(), w = tex.width, h = tex.height, row = Math.ceil((w * 4) / 256) * 256;
    const buf = k.device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = k.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row }, [w, h]);
    k.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange()), img = new ImageData(w, h), bgra = tex.format.startsWith('bgra');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = y * row + x * 4, d = (y * w + x) * 4;
      img.data[d] = src[s + (bgra ? 2 : 0)]; img.data[d + 1] = src[s + 1]; img.data[d + 2] = src[s + (bgra ? 0 : 2)]; img.data[d + 3] = 255;
    }
    buf.unmap();
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }, API);
  writeFileSync(join(out, `${s.name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  console.log(`${s.name}.png (${ms} ms)`);
}

console.log('adapter:', await adapterName(page));
if (opts.timings) {
  const t = await page.evaluate(async () => {
    const k = window.__api.kit;
    k.profiler.force = true;
    for (let i = 0; i < 150; i++) { k.step(1 / 60); if (i % 5 === 0) await k.device.queue.onSubmittedWorkDone(); await new Promise((r) => setTimeout(r, 4)); }
    await k.device.queue.onSubmittedWorkDone();
    return { passes: [...k.profiler.ms].sort((a, b) => b[1] - a[1]), frame: k.profiler.frameMs, render: [...k.size.render] };
  });
  console.log(`gpu frame ${t.frame.toFixed(3)} ms at ${t.render.join('x')}`);
  for (const [l, v] of t.passes) console.log(`  ${l.padEnd(28)} ${v.toFixed(3)} ms`);
  writeFileSync(join(out, 'timings.json'), JSON.stringify(t, null, 1));
}
if (API === 'bend') {
  const st = await page.evaluate(() => { const s = window.bend.stats(); return { failed: s.failed, errors: s.errors, matter: s.matter, views: s.views }; });
  console.log('stats:', JSON.stringify(st));
}
console.log(`${problems.length} console warning(s) or error(s)`);
writeFileSync(join(out, 'console.txt'), problems.join('\n'));
await browser.close();
release();

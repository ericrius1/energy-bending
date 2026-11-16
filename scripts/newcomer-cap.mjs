// A newcomer's first seconds as a film clip (report 25): the front page as a first-timer finds it (its "press any key
// to dance" pill and the petal and "you" over the body that will be theirs, all DOM over the canvas), one real key press,
// then a first-timer's walk with real keys (W A S D) to a mirror and through it (scripts/steps/newcomer.js's walker), the
// dance's YOU tell and its "you" tag in the frames. As scripts/front-cap.mjs does it: the page stepped by hand at 60 fps,
// each frame read back from the canvas (bend.grab, the HUD over it), laid under the page as its background, the canvas
// hidden and the page screenshotted with its DOM; the frames joined into a lossless clip. No sound: the film lays the
// tracks under it, and the page's own track (its id and place each frame) is written beside the clip (<out>.json) so
// they can be laid where the page played them.
//   node scripts/newcomer-cap.mjs <out.mkv> [--url http://127.0.0.1:5435/energybending/] [--size 1280x720]
//        [--front 1.5 (seconds of the front kept before the press)] [--key Enter] [--gate <a mirror's id> (else the
//        nearest)] [--after 2 (seconds kept after the crossing)] [--max 9 (seconds after the press at most)]
//        [--settle 300 (frames stepped before the first one kept)] [--png (keep the frames)]
import { mkdirSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(argv[0] ?? 'shots/newcomer.mkv');
const URL0 = opt('url', 'http://127.0.0.1:5435/energybending/');
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const FRONT = Math.round(Number(opt('front', '1.5')) * 60), AFTER = Math.round(Number(opt('after', '2')) * 60), MAX = Math.round(Number(opt('max', '9')) * 60);
const SETTLE = Number(opt('settle', '300')), KEY = opt('key', 'Enter'), GATE = opt('gate', null);
const dir = join(dirname(OUT), `${OUT.replace(/^.*[\\/]/, '').replace(/\.\w+$/, '')}-frames`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await launch({ width: W, height: H });
const rec = { key: KEY, front: FRONT, frames: [], crossings: [], devices: null };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(`${URL0}?noautores`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
  await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.renderScale = 1; });
  console.log('adapter:', await adapterName(page));
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.evaluate(async (n) => { await window.bend.step(n); }, SETTLE);
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.includes(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  /** one frame: stepped and read back, laid under the DOM, screenshotted */
  let n = 0;
  const frame = async () => {
    const st = await page.evaluate(async () => {
      const B = window.bend;
      document.getElementById('stage').style.visibility = 'visible';
      for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = '';
      const url = await B.grab('image/png');
      document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
      document.getElementById('stage').style.visibility = 'hidden';
      for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = 'hidden';
      const E = B.music?.engine;
      return { track: E?.track?.id ?? null, at: E?.trackAt ?? null, ctx: B.music?.ctx?.currentTime ?? null, world: B.jogo?.stats?.()?.world ?? null, n: B.jogo?.stats?.()?.crossings?.length ?? 0 };
    });
    await page.screenshot({ path: join(dir, `f${String(n).padStart(4, '0')}.png`), type: 'png' });
    rec.frames.push(st);
    n++;
    // (a screenshot can lose keys held in headless Chrome: they are pressed again, as a hand still on them would be)
    for (const k of held) await page.keyboard.down(k);
    return st;
  };
  for (let k = 0; k < FRONT; k++) await frame();
  await page.keyboard.press(KEY);
  const pressAt = n;
  // the walker (newcomer.js's): toward 1.8 m out in front of the mirror, then lined up, through it
  let target = null, lined = false, crossAt = null, ref = null, check = { f: 0, d: Infinity };
  const MAP = { KeyW: 'KeyW', KeyS: 'KeyS', KeyA: 'KeyA', KeyD: 'KeyD' };
  for (let f = 0; f < MAX && (crossAt == null || n < crossAt + AFTER); f++) {
    const st = await frame();
    if (crossAt == null && st.n > 0) { crossAt = n; console.log(`crossed at ${((n - pressAt) / 60).toFixed(2)} s after the press`); }
    if (f % 3 || crossAt != null) { if (crossAt != null && f % 3 === 0 && held.size) await setKeys([]); continue; }
    const want = await page.evaluate((gate, lined0, refIn) => {
      const B = window.bend, s = B.jogo?.stats?.();
      if (!s?.phase) return null;
      const dv = s.devices ?? [], me = Math.max(0, dv.findIndex((x) => x && /keyboard|mouse/.test(x)));
      const r = s.seats[me].root;
      const G = [...B.gates.gates.values()].filter((x) => x.world === B.gates.rigWorld && x.partner);
      const T = (gate && G.find((x) => x.id === gate)) || G.map((x) => ({ x, d: Math.hypot(x.at[0] - r[0], x.at[2] - r[2]) })).sort((a, b) => a.d - b.d)[0]?.x;
      if (!T) return null;
      const side = (r[0] - T.at[0]) * T.n[0] + (r[2] - T.at[2]) * T.n[2], sg = side >= 0 ? 1 : -1;
      const lat = Math.hypot((r[0] - T.at[0]) - side * T.n[0], (r[2] - T.at[2]) - side * T.n[2]);
      let lined = lined0;
      if (!lined && Math.abs(side) > 0.6 && lat < 0.45) lined = true;
      if (lined && lat > 1.0) lined = false;
      const tx = lined ? T.at[0] - sg * T.n[0] * 1.5 : T.at[0] + sg * T.n[0] * 1.8, tz = lined ? T.at[2] - sg * T.n[2] * 1.5 : T.at[2] + sg * T.n[2] * 1.8;
      const dx = tx - r[0], dz = tz - r[2], dl = Math.hypot(dx, dz) || 1;
      const y = B.camera().yaw, c = refIn ?? { F: [-Math.sin(y), -Math.cos(y)], R: [Math.cos(y), -Math.sin(y)] };
      const fw = (dx * c.F[0] + dz * c.F[1]) / dl, rt = (dx * c.R[0] + dz * c.R[1]) / dl, w = [];
      if (fw > 0.38) w.push('KeyW'); else if (fw < -0.38) w.push('KeyS');
      if (rt > 0.38) w.push('KeyD'); else if (rt < -0.38) w.push('KeyA');
      return { w, lined, dl, gate: T.id, camNow: { F: [-Math.sin(y), -Math.cos(y)], R: [Math.cos(y), -Math.sin(y)] }, devices: dv };
    }, GATE, lined, ref);
    if (!want) continue;
    lined = want.lined; target = want.gate; rec.devices = want.devices;
    ref ??= want.camNow;
    let keys = want.w.map((k) => MAP[k]);
    // (a hand that finds the body not getting nearer lets go and steers again from the view it has now)
    let stale = false;
    if (f - check.f >= 30) { stale = want.dl > check.d - 0.25 && held.size > 0; check = { f, d: want.dl }; }
    if (stale || keys.slice().sort().join() !== [...held].sort().join()) { await setKeys([]); ref = want.camNow; }
    await setKeys(keys);
  }
  await setKeys([]);
  rec.pressAt = pressAt; rec.crossAt = crossAt; rec.gate = target;
  rec.stats = await page.evaluate(() => { const s = window.bend.jogo?.stats?.(); return s ? { crossings: s.crossings, devices: s.devices, world: s.world, ways: s.ways } : null; });
} finally { await browser.close(); }
writeFileSync(OUT.replace(/\.\w+$/, '.json'), JSON.stringify(rec, null, 1));
const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '60', '-i', join(dir, 'f%04d.png'), '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', ...tags, OUT], { stdio: 'inherit' });
console.log(`${OUT}: ${readdirSync(dir).length} frames (the press at ${rec.pressAt}, the crossing at ${rec.crossAt}), ffmpeg ${r.status}`);
if (!argv.includes('--png')) rmSync(dir, { recursive: true, force: true });

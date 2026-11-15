// The duel camera measured in the page (report 18-camera): where cam-sim.mjs runs the camera in Node on rough bodies,
// this plays seeded duels of two virtual players in headless Chrome on the real GPU (stepped by hand at 60 fps, as
// duel-page.mjs does) and records every pose the free camera gives (src/duel/camera.ts: the look down, the lens, the
// boom, how calm, how unclean the eye), then prints per world the look down's mean and p90, the share of frames with
// the horizon in the lens and the frame's top edge over the level. Small and fast: nothing is grabbed.
//   node scripts/cam-page.mjs --url http://localhost:<port>/energybending/ [--world temple,redwoods,geode,pool]
//     [--sets 2] [--seed 3] [--seconds 40] [--size 640x360]
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5391/energybending/');
const worlds = arg('world', 'temple,redwoods,geode,pool').split(',');
const sets = Number(arg('sets', '2')), seed0 = Number(arg('seed', '3')), seconds = Number(arg('seconds', '40'));
const [W, H] = arg('size', '640x360').split('x').map(Number);
const DRESS = { temple: 'fire,water', redwoods: 'water,ice', geode: 'ice,fire', pool: 'water,ice' };

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
let first = true;
for (const world of worlds) {
  const all = [];
  for (let s = 0; s < sets; s++) {
    const q = `duel&world=${world}&dress=${DRESS[world] ?? 'fire,water'}&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=${seed0 + s}&noautores`;
    await page.goto(`${BASE}?${q}`, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000, polling: 200 });
    if (first) { console.log(await adapterName(page)); first = false; }
    const poses = await page.evaluate(async (seconds) => {
      const B = window.bend, k = B.kit, C = B.duel.camera, out = [];
      k.manual = true; k.autoRes = null; k.renderScale = 1;
      const up = C.update.bind(C);
      C.debug = true;
      C.update = (dt, I) => {
        const p = up(dt, I);
        if (B.duel.state.phase === 'play') out.push([p.pitch, p.fov, p.dist, C.calm ?? 0, C.last.bad, C.steep ? 1 : 0, C.last.why ?? '']);
        return p;
      };
      for (let i = 0; i < seconds * 60; i += 30) await B.step(30);
      return out;
    }, seconds);
    all.push(...poses);
  }
  const deg = all.map((p) => p[0] * 57.2958).sort((a, b) => a - b);
  const mean = (x) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
  const hor = all.filter((p) => Math.tan(p[0]) < Math.tan((p[1] * Math.PI) / 360)).length / Math.max(1, all.length);
  const top = mean(all.map((p) => p[1] / 2 - p[0] * 57.2958));
  console.log(`${world.padEnd(9)} ${all.length} frames: pitch mean ${mean(deg).toFixed(1)}°, p90 ${deg[Math.floor(deg.length * 0.9)]?.toFixed(0)}°, ` +
    `over 35° ${(100 * deg.filter((d) => d > 35).length / Math.max(1, deg.length)).toFixed(1)}%; horizon in frame ${(100 * hor).toFixed(1)}%; top edge ${top.toFixed(1)}° over the level; ` +
    `lens ${mean(all.map((p) => p[1])).toFixed(1)}°, boom ${mean(all.map((p) => p[2])).toFixed(1)} m, calm ${mean(all.map((p) => p[3])).toFixed(2)}, unclean ${(100 * all.filter((p) => p[4] > 0).length / Math.max(1, all.length)).toFixed(0)}%`);
  // (why the eye was unclean: o past the room, c near a solid, f a piece in the near frame, b a body's sight line
  // crossed; "ahead:" only where the pair will be a moment on; and the steep ceiling's share)
  const why = new Map();
  for (const p of all) if (p[4] > 0) why.set(p[6] || '?', (why.get(p[6] || '?') ?? 0) + 1);
  const top5 = [...why].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${(100 * n / Math.max(1, all.length)).toFixed(1)}%`).join(', ');
  console.log(`          unclean: ${top5}; the steep ceiling (43°) allowed in ${(100 * all.filter((p) => p[5]).length / Math.max(1, all.length)).toFixed(1)}% of frames`);
}
await browser.close();

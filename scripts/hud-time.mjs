// The HUD's costs (src/hud, docs/reports/11-hud.md): its CPU time a frame over the demo (?hud=demo: the countdown,
// then play with hits, KOs and pops), at a desktop and a phone size, and in a film's page the GPU time of the film's
// grade pass with the HUD laid over it and without (bend.hud.visible). Under the shared render lock.
//   node scripts/hud-time.mjs [--url http://127.0.0.1:5507/energybending/]
import { launch, adapterName, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const URL0 = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:5507/energybending/';
const release = await takeLock();

async function page(size, query) {
  const [W, H] = size;
  const browser = await launch({ width: W, height: H });
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await p.goto(`${URL0}?${query}&noautores`, { timeout: 120000 });
  await p.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
  return { browser, p };
}

/** the HUD's CPU per frame over n frames stepped at 60 fps */
async function cpu(label, size, query) {
  const { browser, p } = await page(size, query);
  const r = await p.evaluate(async () => {
    const B = window.bend;
    B.kit.manual = true;
    B.lock(true);
    await B.step(30);
    B.hud.demo?.at(0);
    B.hud.stats(true);
    const all = [];
    for (let i = 0; i < 40; i++) { await B.step(15); all.push(B.hud.stats(true)); }
    const mean = all.reduce((a, s) => a + s.cpuMs, 0) / all.length, worst = Math.max(...all.map((s) => s.cpuMaxMs));
    const base = all.reduce((a, s) => a + s.baseFrames, 0), frames = all.reduce((a, s) => a + s.frames, 0);
    return { mean, worst, base, frames, last: all[all.length - 1] };
  });
  console.log(`${label}: HUD CPU ${r.mean.toFixed(3)} ms a frame (worst ${r.worst.toFixed(3)}), base layer drawn ${r.base} of ${r.frames} frames, ${r.last.size.join('x')} at ${r.last.ratio}${r.last.compact ? ' compact' : ''}`);
  await browser.close();
  return r;
}

/** a film's page: the grade pass's GPU time with the HUD over it and without, and the CPU of the frame's HUD step */
async function film(label, size, scale) {
  const [W, H] = size;
  const { browser, p } = await page([W, H], `film&w=${W}&h=${H}&scale=${scale}&play&two&hud=demo&world=geode`);
  const r = await p.evaluate(async () => {
    const B = window.bend, k = B.kit;
    k.profiler.force = true;
    B.lock(true);
    const run = async (on) => {
      B.hud.visible = on;
      await B.step(30);
      const g = [], o = [];
      for (let i = 0; i < 120; i++) {
        const t0 = performance.now();
        await B.step(1);
        o.push(performance.now() - t0);
        g.push(k.profiler.ms.get('grade.film') ?? 0);
      }
      const m = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      return { grade: m(g), wall: m(o), hud: B.hud.stats(true) };
    };
    const off = await run(false), on = await run(true);
    return { off, on, render: [...k.size.render] };
  });
  console.log(`${label}: render ${r.render.join('x')}: grade.film ${r.off.grade.toFixed(4)} ms without the HUD, ${r.on.grade.toFixed(4)} with it (+${(r.on.grade - r.off.grade).toFixed(4)}); stepped frame ${r.off.wall.toFixed(2)} → ${r.on.wall.toFixed(2)} ms wall; HUD CPU (draw + flatten + upload) ${r.on.hud.cpuMs.toFixed(3)} ms`);
  await browser.close();
}

try {
  const { browser, p } = await page([640, 360], 'hud=0');
  console.log(`adapter: ${await adapterName(p)}`);
  await browser.close();
  await cpu('desktop 1920x1080', [1920, 1080], 'play&two&hud=demo&world=geode&dress=fire,water');
  await cpu('desktop 1280x720', [1280, 720], 'play&two&hud=demo&world=geode&dress=fire,water');
  await cpu('phone 390x844', [390, 844], 'play&two&hud=demo&world=geode&dress=fire,water');
  await cpu('jogo beat 1280x720', [1280, 720], 'jogo=script&hud=beat&world=geode');
  await film('film 1920x1080 scale 1.5', [1920, 1080], 1.5);
} finally {
  release();
}

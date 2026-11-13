// The stage dim per world, side by side (docs/reports/9-stage.md): each world's jogo against the partner, locked, the
// same moment shot at several `World.stageDim` values (the world's own set by hand for the take), one row a world.
//   node scripts/steps/stage-9-dim.mjs [--url http://[::1]:5461/energybending/] [--dims 0,0.35,0.55,0.75] [--at 9]
//   [--worlds geode,redwoods,pool,temple,forge] [--out docs/reports/media/9-stage-dim]   ('own' in --dims: the world's
//   own value, as the game has it)
// The play is frozen for the row (bend.kit.manual: the grabs step one frame each, and the dim's ease is skipped by
// setting the post chain's eased value), so a row differs only by the dim. Takes the render lock.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, takeLock } from '../lib/browser.mjs';

const argv = process.argv.slice(2), o = {};
for (let i = 0; i < argv.length; i += 2) o[argv[i].slice(2)] = argv[i + 1];
const BASE = o.url ?? 'http://[::1]:5461/energybending/';
const dims = (o.dims ?? '0,0.35,0.55,0.75').split(',').map((d) => (d === 'own' ? d : Number(d)));
const worlds = (o.worlds ?? 'geode,redwoods,pool,temple,forge').split(',');
const at = Number(o.at ?? 9);
const OUT = o.out ?? 'docs/reports/media/9-stage-dim';
const dir = 'shots/stage9/dim';
mkdirSync(dir, { recursive: true });
const release = await takeLock();
const b = await launch({ width: 1280, height: 800 });
const files = [];
try {
  for (const w of worlds) {
    const page = await b.newPage();
    page.on('pageerror', (e) => console.log(`[${w}] ${e.message}`));
    await page.goto(`${BASE}?jogo=partner&world=${w}&dress=fire,water&noautores`, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
    await page.evaluate(async (w, at) => {
      const B = window.bend; const k = B.kit; k.manual = true; k.autoRes = null; k.renderScale = 1;
      if (w === 'temple') B.set('temple', { tideHold: 0.42 });
      if (w === 'redwoods') B.set('redwoods', { hour: 19.4, dayGoes: false });
      await B.jogo.start();
      await B.step(Math.round(at * 60));
    }, w, at);
    for (const d of dims) {
      const jpg = await page.evaluate(async (w, d) => {
        const B = window.bend, W = B.worldOf(w);
        // ('own': the world's own World.stageDim, as the game has it, kept before any column sets it)
        if (!('ownDim' in W)) W.ownDim = W.stageDim ?? 0.55;
        const v = d === 'own' ? W.ownDim : d;
        Object.defineProperty(W, 'stageDim', { value: v, configurable: true, writable: true });
        // (two frames: main.ts reads the world's dim into the post chain, which eases it over 0.4 s: set it there too)
        const post = B.post ?? null;
        await B.step(1);
        if (post && 'stageNow' in post) post.stageNow = v * B.rig.locked;
        return B.grab('image/jpeg', 0.92);
      }, w, d);
      const f = join(dir, `${w}-${d}.jpg`);
      writeFileSync(f, Buffer.from(jpg.split(',')[1], 'base64'));
      files.push(f);
      console.log(f);
    }
    await page.close();
  }
} finally { await b.close(); release(); }
// one row a world, one column a dim
const args = ['-y', '-loglevel', 'error'];
for (const f of files) args.push('-i', f);
const n = files.length, cols = dims.length;
const layout = files.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, (_, k) => `w${k}`).join('+') : 0}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, (_, k) => `h${k * cols}`).join('+') : 0}`).join('|');
const scale = files.map((_, i) => `[${i}:v]scale=480:-1[s${i}]`).join(';');
args.push('-filter_complex', `${scale};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${n}:layout=${layout}`, '-frames:v', '1', '-q:v', '3', `${OUT}-sheet.jpg`);
spawnSync('ffmpeg', args, { stdio: 'inherit' });
console.log(`${OUT}-sheet.jpg`);

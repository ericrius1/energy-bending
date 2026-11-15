// "Which one is me" (report 18-you): the opening seconds and mid-play of a duel as the player sees it (the duel's own
// camera, 720p, the HUD over it), and the "you" tell measured at each still. A duel of a human seat (driven here by a
// virtual player, so it moves) against a bot, stepped by hand at 60 fps on the frames' clock (as bloom-cap.mjs).
//   node scripts/you-cap.mjs <outDir> --url http://127.0.0.1:5589/energybending/ [--worlds geode,redwoods,pool,temple]
//        [--mode solo|two] [--off: the tell off, as the build before it] [--dress fire,water] [--seed 2] [--size 1280x720] [--at 0.3,0.9,1.6,2.4,3.4,20,32]
// Each still (at a time of the set, s) is grabbed three times, the bodies held still between (a stepped frame of 10 µs):
// as seen; with the HUD off; with the HUD and the world's "you" tell off (bend.duel.you.show; the build before had
// none, so there only the HUD goes). The tell is what differs between the first and the last, in a box round each body
// (its bones' bounds on screen and 110 px over its head): its pixels (OKLab ΔE > 0.06), their mean ΔE and the luminance
// contrast (Weber) over what lies under them, for your body and for the other. In a build that tells you apart, yours
// has a tell and the other's has less; in one that does not, the two are the same (the P1 and P2 tags).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const outDir = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/you';
const base = arg('url', 'http://127.0.0.1:5589/energybending/');
const worlds = arg('worlds', 'geode,redwoods,pool,temple').split(',');
const mode = arg('mode', 'solo'), dress = arg('dress', 'fire,water'), seed = arg('seed', '2');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const off = argv.includes('--off');
const at = arg('at', '0.3,0.9,1.6,2.4,3.4,20,32').split(',').map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await launch({ width: W, height: H });
const rows = [];
for (const world of worlds) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  const p2 = mode === 'two' ? 'human' : 'bot';
  const q = `duel&world=${world}&dress=${dress}&p1=human&p2=${p2}&style=lead,flyer&skill=0.85&seed=${seed}&go&noautores&set=45`;
  await page.goto(`${base}?${q}`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel?.started, { timeout: 180000, polling: 200 });
  if (world === worlds[0]) console.log(`adapter: ${await adapterName(page)}`);
  const r = await page.evaluate(async (at, mode, seed, off) => {
    const B = window.bend, k = B.kit, D = B.duel;
    k.manual = true; k.autoRes = null; k.renderScale = 1;
    const M = B.music;
    M.filmClock = M.now(); M.now = () => M.filmClock; M.time = () => M.filmClock;
    // (the human seats driven by virtual players so they move; they stay the page's own seats: bend.duel.you)
    const seats = mode === 'two' ? [0, 1] : [0];
    for (const s of seats) D.setBrain(s, { style: s ? 'flyer' : 'lead', skill: 0.85, seed: Number(seed) + s });
    if (D.you) { D.you.seats = seats; if (off) D.you.show = false; }
    D.restart();
    const has = !!D.you && !off;
    const load = (url) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); res(g.getImageData(0, 0, im.width, im.height)); }; im.src = url; });
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const oklab = (d, i) => {
      const r = lin(d[i]), g = lin(d[i + 1]), b = lin(d[i + 2]);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    };
    const Y = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    /** the tell in a box: pixels that differ, their mean ΔE, the Weber contrast of their luminance over the bare */
    const tell = (a, b, box) => {
      const [x0, y0, x1, y1] = box.map(Math.round);
      let n = 0, de = 0, wc = 0;
      for (let y = Math.max(0, y0); y < Math.min(a.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(a.width, x1); x++) {
        const i = (y * a.width + x) * 4, A = oklab(a.data, i), Bq = oklab(b.data, i);
        const e = Math.hypot(A[0] - Bq[0], A[1] - Bq[1], A[2] - Bq[2]);
        if (e > 0.06) { n++; de += e; const ya = Y(a.data, i), yb = Y(b.data, i); wc += Math.abs(ya - yb) / (yb + 0.05); }
      }
      return { px: n, dE: n ? +(de / n).toFixed(3) : 0, weber: n ? +(wc / n).toFixed(2) : 0 };
    };
    const out = [];
    let ti = 0;
    for (let f = 0; f < 60 * 40 && ti < at.length; f++) {
      await B.step(1);
      const clock = (f + 1) / 60;
      if ((f + 1) / 60 < at[ti]) continue;
      // (the seats' boxes on screen, from the HUD's state: bones' bounds and the space over the head)
      const hs = D.hud();
      const boxes = [0, 1].map((s) => {
        const p = hs?.players.find((q) => q.seat === s);
        const b = p?.bounds, hd = p?.screen, [w, h] = k.size.render;
        if (!b || !hd) return null;
        // (over the head, where a tag or a marker stands; and the feet, where a ring lies)
        return { head: [hd[0] * w - 70, hd[1] * h - 170, hd[0] * w + 70, hd[1] * h + 15], feet: [b[0] * w - 40, b[3] * h - 30, b[2] * w + 40, b[3] * h + 25] };
      });
      const shot = await B.grab('image/jpeg', 0.9);
      const full = await load(await B.grab('image/png', 0.92, 1e-5));
      B.hud.visible = false;
      const noHud = await load(await B.grab('image/png', 0.92, 1e-5));
      if (has) D.you.show = false;
      const bare = await load(await B.grab('image/png', 0.92, 1e-5));
      B.hud.visible = true;
      if (has) D.you.show = true;
      const row = { t: at[ti], clock: +clock.toFixed(2), phase: D.state.phase, shot };
      for (const s of [0, 1]) {
        if (!boxes[s]) continue;
        row[`all${s}`] = tell(full, bare, boxes[s].head);
        row[`world${s}`] = has ? tell(noHud, bare, boxes[s].head) : { px: 0, dE: 0, weber: 0 };
        row[`feet${s}`] = has ? tell(noHud, bare, boxes[s].feet) : { px: 0, dE: 0, weber: 0 };
      }
      out.push(row);
      ti++;
    }
    return { has, out };
  }, at, mode, seed, off);
  for (const o of r.out) {
    const name = `${world}-${mode}${off ? '-off' : ''}-${String(o.t).replace('.', '_')}.jpg`;
    writeFileSync(join(outDir, name), Buffer.from(o.shot.split(',')[1], 'base64'));
    delete o.shot;
    console.log(`${world} ${mode} t ${o.t} (${o.phase}): you ${JSON.stringify(o.all0)} world ${JSON.stringify(o.world0)} feet ${JSON.stringify(o.feet0)} | other ${JSON.stringify(o.all1)} world ${JSON.stringify(o.world1)}`);
  }
  rows.push({ world, mode, tell: r.has, stills: r.out });
  await page.close();
  writeFileSync(join(outDir, `you-${mode}${off ? '-off' : ''}.json`), JSON.stringify(rows, null, 1));
}
await browser.close();

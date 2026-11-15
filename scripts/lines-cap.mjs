// The lines on screen in a duel (report 15's issue 5, report 16): how many pixels of the frame the near fade's outlines
// take, moment by moment. A duel of two virtual players, stepped by hand; at each moment three frames are grabbed in a
// row: the outlines kept (`fade.lines` 1), none (0: every dissolved piece goes whole), kept, none, kept. A pixel is an
// outline's where the kept frames agree, the others agree, and each differs from its neighbours (so a mote or a flame
// that moved between the frames isn't counted). Then the arena's rim light off, on, off, counted the same way (the
// rims round the tops and the drops: under the temple's tide they floated over the water). Also, per moment: the pieces the frame test dissolves, the tide (the temple), and
// the first frame saved as a still. The grabs all but hold time still (dt 0.1 ms) and compare frames two apart, so what alternates
// frame by frame (a dither, the grass's shimmer) doesn't count (`<world>-<t>.jpg`, with `--stills`). Prints a table and writes `<out>/lines-<world>.json`.
//   node scripts/lines-cap.mjs <outdir> --url http://127.0.0.1:<port>/energybending/ --world temple --dress fire,water
//        [--seed 3] [--from 4] [--to 40] [--every 1] [--size 960x540] [--stills 8,16,24]
// (the page must have the `fade.lines` param: phase 3's code needs it patched in to be measured the same way)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/lines';
const base = arg('url', 'http://127.0.0.1:5391/energybending/');
const world = arg('world', 'temple'), dress = arg('dress', 'fire,water'), seed = arg('seed', '3');
const [W, H] = arg('size', '960x540').split('x').map(Number);
const from = Number(arg('from', '4')), to = Number(arg('to', '40')), every = Number(arg('every', '1'));
const stills = new Set(arg('stills', '').split(',').filter(Boolean).map(Number));
mkdirSync(out, { recursive: true });

const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  page error:', m.text().slice(0, 300)); });
const url = `${base}?duel&world=${world}&dress=${dress}&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=${seed}&noautores`;
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
console.log(`opened ${url}; ${await adapterName(page)}`);
await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.autoRes = null; k.renderScale = 1; });

const rows = [];
let t = 0;
for (let s = from; s <= to + 1e-6; s += every) {
  const n = Math.round((s - t) * 60);
  if (n > 0) await page.evaluate((n) => window.bend.step(n), n);
  t = s;
  const r = await page.evaluate(async ([keep, dr]) => {
    const B = window.bend;
    // (time all but held still, dt 0.1 ms (0 makes some velocities 0/0), and every compared frame two apart: some of the frame alternates frame by frame)
    const grab = async () => { await B.grab('image/jpeg', 0.5, 1e-4); return B.grab('image/png', 0.92, 1e-4); };
    const A = await grab();
    B.set('fade', { lines: 0 });
    const N = await grab();
    B.set('fade', { lines: 1 });
    const C = await grab();
    B.set('fade', { lines: 0 });
    const M = await grab();
    B.set('fade', { lines: 1 });
    const E = await grab();
    B.set('arena', { rim: 0 });
    const R = await grab();
    B.set('arena', { rim: 1 });
    const F = await grab();
    B.set('arena', { rim: 0 });
    const Q = await grab();
    B.set('arena', { rim: 1 });
    // (--drowned: the rims under the tide, drawn as before (drown off) and drowned, the same way)
    const D = [];
    if (dr) for (const on of [false, true, false, true]) { B.set('arena', { drown: on }); D.push(await grab()); }
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [a, b, c, m, e, rr, ff, q] = await Promise.all([A, N, C, M, E, R, F, Q].map(load));
    const cv = document.createElement('canvas'); cv.width = a.width; cv.height = a.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const px = (img) => { g.drawImage(img, 0, 0); return g.getImageData(0, 0, cv.width, cv.height).data; };
    const pa = px(a), pb = px(b), pc = px(c), pm = px(m), pe = px(e), pr = px(rr), pf = px(ff), pq = px(q);
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let drowned = 0;
    if (D.length) {
      const pd = (await Promise.all(D.map(load))).map(px);
      for (let i = 0; i < pd[0].length; i += 4) {
        const l = pd.map((d) => lum(d, i));
        if (l[0] - l[1] > 12 && l[2] - l[1] > 12 && l[2] - l[3] > 12 && Math.abs(l[0] - l[2]) < 6 && Math.abs(l[1] - l[3]) < 6) drowned++;
      }
      drowned /= pd[0].length / 4;
    }
    let lines = 0, bright = 0, rim = 0;
    const mask = keep ? g.createImageData(cv.width, cv.height) : null;
    for (let i = 0; i < pa.length; i += 4) {
      const la = lum(pa, i), lb = lum(pb, i), lc = lum(pc, i), lm = lum(pm, i), le = lum(pe, i);
      // (on, off, on, off, on: the on frames agree, the off frames agree, and each differs from its neighbours: a mote
      // drifting through on real time can't do that)
      const same = Math.abs(la - lc) < 6 && Math.abs(lc - le) < 6 && Math.abs(lb - lm) < 6;
      if (same && Math.abs(la - lb) > 12 && Math.abs(lc - lb) > 12 && Math.abs(lc - lm) > 12 && Math.abs(le - lm) > 12) { lines++; if (la > lb) bright++; if (mask) { mask.data[i] = 255; mask.data[i + 1] = la > lb ? 255 : 80; } }
      if (mask) mask.data[i + 3] = 255;
      // (the arena's rim light: on, off, on, off, the same way)
      const lr = lum(pr, i), lf = lum(pf, i), lq = lum(pq, i);
      if (le - lr > 12 && lf - lr > 12 && lf - lq > 12 && Math.abs(le - lf) < 6 && Math.abs(lr - lq) < 6) { rim++; if (mask) mask.data[i + 2] = 255; }
    }
    let maskUrl = null;
    if (mask) { g.putImageData(mask, 0, 0); maskUrl = cv.toDataURL('image/png'); }
    const H = B.duel?.arena?.hazard;
    const tide = H?.on && H.kind === 'tide' ? H.tide.low + (H.tide.high - H.tide.low) * (0.5 - 0.5 * Math.cos((H.beat / (H.tide.bars * 4)) * Math.PI * 2)) : null;
    const seen = B.fade.seen;
    return { drowned, lines: lines / (pa.length / 4), bright: bright / (pa.length / 4), rim: rim / (pa.length / 4), pieces: seen.pieces.length, cover: seen.cover, tide, still: keep ? A : null, none: keep ? N : null, mask: maskUrl };
  }, [stills.has(s), argv.includes('--drowned')]);
  if (r.still) writeFileSync(join(out, `${world}-${s}.png`), Buffer.from(r.still.split(',')[1], 'base64'));
  // (with --masks: the frame with no outlines, and the mask: red the outlines' pixels, yellow where brighter, blue the rims)
  if (r.still && argv.includes('--masks')) {
    writeFileSync(join(out, `${world}-${s}-none.png`), Buffer.from(r.none.split(',')[1], 'base64'));
    writeFileSync(join(out, `${world}-${s}-mask.png`), Buffer.from(r.mask.split(',')[1], 'base64'));
  }
  delete r.still; delete r.none; delete r.mask;
  rows.push({ t: s, ...r });
  console.log(`${String(s).padStart(5)} s  lines ${(100 * r.lines).toFixed(3)}% of the frame (brighter ${(100 * r.bright).toFixed(3)}%), rim light ${(100 * r.rim).toFixed(3)}%${argv.includes('--drowned') ? ` (drowned rims ${(100 * r.drowned).toFixed(3)}%)` : ''}, pieces ${r.pieces}, cover ${r.cover.toFixed(2)}${r.tide != null ? `, tide ${r.tide.toFixed(2)} m` : ''}`);
}
await browser.close();
const mean = (k) => rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length);
const any = rows.filter((r) => r.lines > 0.0005).length;
const sum = { world, url, moments: rows.length, meanLines: mean('lines'), meanBright: mean('bright'), meanRim: mean('rim'), maxLines: Math.max(...rows.map((r) => r.lines)), withLines: any / Math.max(1, rows.length), meanPieces: mean('pieces') };
console.log(`${world}: lines ${(100 * sum.meanLines).toFixed(3)}% of the frame on average (max ${(100 * sum.maxLines).toFixed(3)}%), over 0.05% in ${(100 * sum.withLines).toFixed(0)}% of moments; rim light ${(100 * sum.meanRim).toFixed(3)}%; ${sum.meanPieces.toFixed(2)} pieces dissolving`);
writeFileSync(join(out, `lines-${world}.json`), JSON.stringify({ sum, rows }, null, 1));

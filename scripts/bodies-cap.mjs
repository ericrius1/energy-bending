// Can the two bodies be told apart? (report 17 issue 4, report 18-bodies.) Seeded duels of two virtual players in the
// page, stepped by hand at 60 fps from the duel's own camera, and at each catch (a contact link that has held `after`
// frames, both bodies on screen) the frame grabbed without the HUD and measured: each body's pixels (inside its bones'
// capsules, projected; where the two overlap, neither), and the world right round each body (a band just outside its
// capsules, clear of both bodies), compared in OKLab:
//   dAB      the distance between the two bodies' mean colours (×100: 1 is about a just-noticeable step)
//   dABc     the same in colour alone (a, b: hue and chroma, not lightness)
//   acc      how often a body pixel is nearer its own body's mean than the other's (0.5: one shape, 1: two)
//   dAw dBw  each body against the world round it (×100), and accAw accBw the same nearest-mean test against it
// Then a still of the same moment with the HUD (one frame on), as the player sees it.
//   node scripts/bodies-cap.mjs <out.json> --url http://127.0.0.1:<port>/energybending/ [--worlds geode,redwoods,temple,pool]
//     [--pairs water:ice,plasma:gems,...] [--seed 1] [--catches 3] [--until 40] [--after 14] [--skip s] [--stills dir] [--masks]
//     (--skip: no catch in the first s seconds of duel time; --masks: a still of the pixels measured beside each)
// The bones and their radii are seat.ts's halo's (the body's own capsules, a little narrower).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/bodies.json';
const base = arg('url', 'http://localhost:5489/energybending/');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const worlds = arg('worlds', 'geode,redwoods,temple,pool').split(',');
const MATTERS = ['fire', 'water', 'ice', 'plasma', 'gems'];
const ALLPAIRS = MATTERS.flatMap((a, i) => MATTERS.slice(i + 1).map((b) => `${a}:${b}`));
const pairs = arg('pairs', ALLPAIRS.join(',')).split(',').map((p) => p.split(':'));
const skip = Number(arg('skip', '0')), seed0 = Number(arg('seed', '1')), want = Number(arg('catches', '3')), until = Number(arg('until', '40')), after = Number(arg('after', '14'));
const stills = arg('stills', '');
if (stills) mkdirSync(stills, { recursive: true });

const browser = await launch({ width: W, height: H });
const rows = [];
let n = 0;
for (const world of worlds) {
  for (const [a, b] of pairs) {
    const seed = seed0 + (n++ % 4);
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('  pageerror:', e.message));
    const url = `${base}?duel&world=${world}&dress=${a},${b}&p1=bot&p2=bot&style=lead,flyer&skill=0.85&seed=${seed}&go&noautores&class=desktop`;
    await page.goto(url, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000, polling: 200 });
    if (!rows.length) console.log(`adapter: ${await adapterName(page)}`);
    const t0 = Date.now();
    if (argv.includes('--masks')) await page.evaluate(() => { window.__masks = true; });
    const r = await page.evaluate(async (want, until, after, skip) => {
      const B = window.bend, k = B.kit;
      k.manual = true; k.autoRes = null; k.renderScale = 1;
      const { JOINT: J } = await import(new URL('src/skeleton/rig.ts', location.href.split('?')[0]).href);
      const BONES = [[J.Hips, J.Spine1, 0.17], [J.Spine1, J.Neck, 0.15], [J.Neck, J.Head, 0.06], [J.Head, J.HeadEnd, 0.11],
        [J.LeftArm, J.LeftForeArm, 0.075], [J.LeftForeArm, J.LeftHand, 0.065], [J.RightArm, J.RightForeArm, 0.075], [J.RightForeArm, J.RightHand, 0.065],
        [J.LeftUpLeg, J.LeftLeg, 0.095], [J.LeftLeg, J.LeftFoot, 0.075], [J.RightUpLeg, J.RightLeg, 0.095], [J.RightLeg, J.RightFoot, 0.075]];
      const show = B.show;
      const sk = (s) => show.dancers[s].skeleton.world;
      // a body's bones on screen: [x0, y0, x1, y1, r0, r1] in pixels, or null if any end is behind the eye
      const onScreen = (world, m, Wp, Hp) => BONES.map(([ja, jb, r]) => {
        const P = (j) => {
          const o = j * 12, x = world[o], y = world[o + 1], z = world[o + 2];
          const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
          if (!(cw > 0.05)) return null;
          return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * Wp, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5) * Hp, cw];
        };
        const p = P(ja), q = P(jb);
        if (!p || !q) return null;
        const f = m[5] * Hp * 0.5;   // pixels per metre at distance 1 (the projection's y scale)
        return [p[0], p[1], q[0], q[1], (r * f) / p[2], (r * f) / q[2]];
      }).filter(Boolean);
      // signed distance (px) from a pixel to a body (its nearest bone's capsule surface, in units of that bone's radius)
      const near = (segs, x, y) => {
        let best = Infinity;
        for (const [x0, y0, x1, y1, r0, r1] of segs) {
          const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
          const t = L2 > 1e-6 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2)) : 0;
          const px = x0 + dx * t - x, py = y0 + dy * t - y, r = Math.max(1.5, r0 + (r1 - r0) * t);
          best = Math.min(best, Math.hypot(px, py) / r);
        }
        return best;
      };
      // sRGB (0 … 255) to OKLab
      const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = lin(i);
      const oklab = (R, G, Bb) => {
        const r = LUT[R], g = LUT[G], b = LUT[Bb];
        const l = Math.cbrt(0.4122214708 * r + 0.5363015019 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787999 * b);
        return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
      };
      const measure = async (url, segA, segB, Wp, Hp) => {
        const img = new Image(); img.src = url; await img.decode();
        const c = document.createElement('canvas'); c.width = Wp; c.height = Hp;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const D = g.getImageData(0, 0, Wp, Hp).data;
        const S = 2;   // every other pixel
        const sets = { A: [], B: [], wA: [], wB: [] };
        const box = (segs, pad) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of segs) { const r = Math.max(s[4], s[5]) * pad; x0 = Math.min(x0, s[0] - r, s[2] - r); x1 = Math.max(x1, s[0] + r, s[2] + r); y0 = Math.min(y0, s[1] - r, s[3] - r); y1 = Math.max(y1, s[1] + r, s[3] + r); } return [Math.max(0, x0 | 0), Math.max(0, y0 | 0), Math.min(Wp - 1, x1 | 0), Math.min(Hp - 1, y1 | 0)]; };
        const bA = box(segA, 3.2), bB = box(segB, 3.2);
        const X0 = Math.min(bA[0], bB[0]), Y0 = Math.min(bA[1], bB[1]), X1 = Math.max(bA[2], bB[2]), Y1 = Math.max(bA[3], bB[3]);
        for (let y = Y0; y <= Y1; y += S) for (let x = X0; x <= X1; x += S) {
          const a = near(segA, x, y), b = near(segB, x, y);
          let set = null;
          if (a < 0.9 && b > 1.4) set = sets.A;
          else if (b < 0.9 && a > 1.4) set = sets.B;
          else if (a > 2.0 && b > 2.0 && a < 3.2) set = sets.wA;
          if (a > 2.0 && b > 2.0 && b < 3.2) sets.wB.push(oklab(D[(y * Wp + x) * 4], D[(y * Wp + x) * 4 + 1], D[(y * Wp + x) * 4 + 2]));
          if (set) set.push(oklab(D[(y * Wp + x) * 4], D[(y * Wp + x) * 4 + 1], D[(y * Wp + x) * 4 + 2]));
        }
        if (window.__masks) {
          const o = g.getImageData(0, 0, Wp, Hp), E = o.data;
          for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
            const a = near(segA, x, y), b = near(segB, x, y), i = (y * Wp + x) * 4;
            const tint = a < 0.9 && b > 1.4 ? [255, 60, 60] : b < 0.9 && a > 1.4 ? [60, 255, 60] : a > 2 && b > 2 && (a < 3.2 || b < 3.2) ? [60, 60, 255] : null;
            if (tint) for (let q = 0; q < 3; q++) E[i + q] = (E[i + q] + tint[q]) >> 1;
          }
          g.putImageData(o, 0, 0);
          window.__maskUrl = c.toDataURL('image/jpeg', 0.85);
        }
        const mean = (s) => { const m = [0, 0, 0]; for (const p of s) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; } return m.map((v) => v / Math.max(1, s.length)); };
        const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const distc = (p, q) => Math.hypot(p[1] - q[1], p[2] - q[2]);
        const mA = mean(sets.A), mB = mean(sets.B), mwA = mean(sets.wA), mwB = mean(sets.wB);
        const acc2 = (s1, m1, s2, m2) => { let ok = 0; for (const p of s1) ok += dist(p, m1) < dist(p, m2) ? 1 : 0; let ok2 = 0; for (const p of s2) ok2 += dist(p, m2) < dist(p, m1) ? 1 : 0; return 0.5 * (ok / Math.max(1, s1.length) + ok2 / Math.max(1, s2.length)); };
        return {
          n: [sets.A.length, sets.B.length, sets.wA.length, sets.wB.length],
          mA: mA.map((v) => +v.toFixed(3)), mB: mB.map((v) => +v.toFixed(3)), mwA: mwA.map((v) => +v.toFixed(3)), mwB: mwB.map((v) => +v.toFixed(3)),
          dAB: +(100 * dist(mA, mB)).toFixed(2), dABc: +(100 * distc(mA, mB)).toFixed(2), acc: +acc2(sets.A, mA, sets.B, mB).toFixed(3),
          dAw: +(100 * dist(mA, mwA)).toFixed(2), dBw: +(100 * dist(mB, mwB)).toFixed(2),
          accAw: +acc2(sets.A, mA, sets.wA, mwA).toFixed(3), accBw: +acc2(sets.B, mB, sets.wB, mwB).toFixed(3),
        };
      };
      const D = B.duel, got = [];
      let held = 0, lastLink = null, frames = 0;
      while (got.length < want && frames < until * 60) {
        await B.step(1); frames++;
        const st = D.stats();
        if (st.phase === 'finale' || st.phase === 'done') break;
        const L = st.link;
        if (L) { const id = `${L.holder}`; held = lastLink === id ? held + 1 : 1; lastLink = id; } else { held = 0; lastLink = null; }
        if (held !== after || D.now() / 1000 < skip) continue;
        const Wp = k.size.render[0], Hp = k.size.render[1];
        const m = k.camera.viewProj;
        // both bodies wholly in front of the eye and their centres in the frame
        const ok = [0, 1].every((s) => { const w = sk(s), o = 15 * 12, cw = m[3] * w[o] + m[7] * w[o + 1] + m[11] * w[o + 2] + m[15]; if (cw < 0.1) return false; const x = (m[0] * w[o] + m[4] * w[o + 1] + m[8] * w[o + 2] + m[12]) / cw, y = (m[1] * w[o] + m[5] * w[o + 1] + m[9] * w[o + 2] + m[13]) / cw; return Math.abs(x) < 0.92 && Math.abs(y) < 0.92; });
        if (!ok) continue;
        B.hud.visible = false;
        const bare = await B.grab('image/png');
        frames++;
        const mm = Float32Array.from(k.camera.viewProj);
        const segA = onScreen(sk(0), mm, Wp, Hp), segB = onScreen(sk(1), mm, Wp, Hp);
        const meas = await measure(bare, segA, segB, Wp, Hp);
        B.hud.visible = true;
        const shot = await B.grab('image/jpeg', 0.9);
        frames++;
        got.push({ t: +(D.now() / 1000).toFixed(2), frame: frames, holder: L.holder, ...meas, shot, mask: window.__maskUrl });
      }
      return { got, frames };
    }, want, until, after, skip);
    const row = { world, a, b, seed, frames: r.frames, catches: r.got.map(({ shot, mask, ...m }) => m) };
    rows.push(row);
    if (stills) r.got.forEach((g, i) => {
      writeFileSync(join(stills, `${world}-${a}-${b}-${i}.jpg`), Buffer.from(g.shot.split(',')[1], 'base64'));
      if (g.mask) writeFileSync(join(stills, `${world}-${a}-${b}-${i}-mask.jpg`), Buffer.from(g.mask.split(',')[1], 'base64'));
    });
    const avg = (f) => r.got.length ? (r.got.reduce((s, g) => s + g[f], 0) / r.got.length).toFixed(2) : '-';
    console.log(`${world} ${a} v ${b} seed ${seed}: ${r.got.length} catches in ${r.frames} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)  dAB ${avg('dAB')} dABc ${avg('dABc')} acc ${avg('acc')}  dAw ${avg('dAw')} dBw ${avg('dBw')}`);
    await page.close();
    writeFileSync(out, JSON.stringify(rows, null, 1));
  }
}
await browser.close();

// the summary: per pair over every world's catches, and per world
const all = rows.flatMap((r) => r.catches.map((c) => ({ ...c, world: r.world, pair: `${r.a}:${r.b}` })));
const mean = (xs, f) => xs.length ? +(xs.reduce((s, x) => s + x[f], 0) / xs.length).toFixed(3) : null;
const summary = { pairs: {}, worlds: {} };
for (const p of new Set(all.map((c) => c.pair))) { const xs = all.filter((c) => c.pair === p); summary.pairs[p] = { n: xs.length, dAB: mean(xs, 'dAB'), dABc: mean(xs, 'dABc'), acc: mean(xs, 'acc'), dAw: mean(xs, 'dAw'), dBw: mean(xs, 'dBw'), accAw: mean(xs, 'accAw'), accBw: mean(xs, 'accBw') }; }
for (const w of worlds) { const xs = all.filter((c) => c.world === w); summary.worlds[w] = { n: xs.length, dAB: mean(xs, 'dAB'), acc: mean(xs, 'acc'), dAw: mean(xs, 'dAw'), dBw: mean(xs, 'dBw') }; }
writeFileSync(out, JSON.stringify({ rows, summary }, null, 1));
console.table(summary.pairs);
console.table(summary.worlds);

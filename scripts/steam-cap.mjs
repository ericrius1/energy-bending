// Steam and the geyser over the bodies as a player sees them (report 17's issue 3, report 18-steam): seeded sets of two
// virtual players in the page, stepped by hand at 60 fps on the frames' own music clock (as duel-page.mjs does), and
// sampled by the steam probe (src/duel/steam-probe.ts, bend.duel.steam): each sampled frame drawn as the player sees it
// and again at dt 0 with steam's matter and the geyser's light hidden; the difference over each body's core is the
// veil steam laid on it. Tallied over the frames steam is on screen, the frames a geyser stands, and the second after
// each STEAM!. Optionally stills (with the HUD, as bend.grab gives them) some frames after each STEAM!.
//   node scripts/steam-cap.mjs <out.json> --url http://127.0.0.1:5487/energybending/ [--runs 'redwoods:fire,water:3:flyer,lead']
//        [--size 640x360] [--until 64] [--every 4] [--stills dir] [--stills-at 8,40] [--stills-max 2] [--hour 18.9]
//        [--control] (hide nothing: the probe's own noise floor) [--parts glow,matter,all] (each still again without them)
//        [--force S] (every S s of play water rolls its wave at fire and fire flares in it: a geyser made, not waited for)
// A run is world:dress:seed[:styles]; the default is fire and water pairs over the four worlds (the film's redwoods
// set among them). Sampled every `every` frames, and every other frame while a geyser stands or after a STEAM!.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/steam.json';
const base = arg('url', 'http://127.0.0.1:5487/energybending/');
const [W, H] = arg('size', '640x360').split('x').map(Number);
const until = Number(arg('until', '66')), every = Number(arg('every', '4'));
const stills = arg('stills', ''), stillsAt = arg('stills-at', '8,40').split(',').map(Number), stillsMax = Number(arg('stills-max', '2'));
const hour = arg('hour', ''), control = argv.includes('--control'), parts = arg('parts', '').split(',').filter(Boolean), force = Number(arg('force', '0'));
const DEF = [
  'redwoods:fire,water:3:flyer,lead', 'redwoods:fire,water:1', 'redwoods:water,fire:2', 'redwoods:fire,water:5:base,flyer',
  'pool:fire,water:1:lead,flyer', 'pool:water,fire:2', 'pool:fire,water:4',
  'temple:fire,water:1:lead,flyer', 'temple:water,fire:3', 'temple:fire,water:6',
  'geode:fire,water:3:flyer,lead', 'geode:water,fire:4',
];
const runs = (arg('runs', '') ? arg('runs', '').split(';') : DEF).map((r) => { const [world, dress, seed, styles] = r.split(':'); return { world, dress, seed, styles: styles ?? 'lead,flyer' }; });
if (stills) mkdirSync(stills, { recursive: true });

const browser = await launch({ width: W, height: H });
const all = [];
for (const R of runs) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  const url = `${base}?duel&world=${R.world}&dress=${R.dress}&p1=bot&p2=bot&style=${R.styles}&skill=0.85&seed=${R.seed}&go&noautores&class=laptop`;
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel?.steam, { timeout: 180000, polling: 200 });
  if (!all.length) console.log(`adapter: ${await adapterName(page)}`);
  await page.evaluate((hour) => {
    const B = window.bend, k = B.kit;
    k.manual = true; k.autoRes = null; k.renderScale = 1;
    if (hour && B.params.redwoods) B.set('redwoods', { hour: Number(hour), dayGoes: false });
    // (the music's clock on the stepped frames, as duel-page.mjs has it)
    const M = B.music;
    M.filmClock = M.now();
    M.now = () => M.filmClock; M.time = () => M.filmClock;
    B.duel.restart();
    B.duel.steam.reset();
  }, hour);
  const t0 = Date.now();
  let shots = 0, steams = 0;
  for (;;) {
    const r = await page.evaluate(async (n, every, at, want, control, parts, force) => {
      const B = window.bend, D = B.duel, S = D.steam, grabs = [];
      window.__steam ??= { since: -1, i: 0, n: 0, forceAt: 6, wave: -1, forced: 0 };
      const st = window.__steam;
      let phase = D.state.phase, t = 0, worst = null;
      for (let j = 0; j < n; j++) {
        // (--force S: every S s of play, water's wave rolled at fire, and fire's flare cast as the wave reaches it)
        if (force > 0 && D.state.phase === 'play') {
          const tt = D.match.clock(D.now()).time / 1000, M = D.powers.rules.seats.map((x) => x.matter), w = M.indexOf('water'), f = M.indexOf('fire');
          if (w >= 0 && f >= 0) {
            const S0 = D.stats().seats, rw = S0[w].at, rf = S0[f].at;
            if (st.wave < 0 && tt >= st.forceAt) { D.flow(w, 1); D.flow(f, 1); D.cast(w, 1, [rf[0], rf[2]]); st.wave = 0; st.forceAt = tt + force; }
            else if (st.wave >= 0) {
              const W = D.powers.live.find((L) => L.kind === 'wave' && L.seat === w && !L.done);
              if (W && W.tip && Math.hypot(rf[0] - W.tip[0], rf[2] - W.tip[2]) < 1.0) { D.flow(f, 1); D.cast(f, 0, [rw[0], rw[2]]); st.forced++; st.wave = -1; }
              else if (++st.wave > 90) st.wave = -1;
            }
          }
        }
        const live = D.powers.live.some((L) => L.kind === 'geyser' && !L.done);
        const hot = live || (st.since >= 0 && st.since < 60);
        let s = null;
        if (st.i % (hot ? 2 : every) === 0) s = await S.sample(1 / 60, D.now() / 1000, 1.0, control);
        else await S.step(1 / 60);
        st.i++;
        // (frames since the last STEAM!)
        if (D.powers.fx.some((x) => x.k === 'react' && x.kind === 'geyser')) { st.since = 0; st.n++; }
        else if (st.since >= 0) st.since++;
        if (s && (!worst || s.worst > worst.worst)) worst = { worst: s.worst, t: s.t, screen: s.screen };
        if (want > grabs.length && st.since >= 0 && at.includes(st.since) && st.n <= 3) {
          grabs.push({ t: D.now() / 1000, since: st.since, n: st.n, png: await B.grab('image/jpeg', 0.92) });
          // (the same frame a hair later without some of steam: 'glow' the geyser's light, 'matter' the wisps, 'all')
          for (const p of parts) { S.hidden(p); grabs.push({ t: D.now() / 1000, since: st.since, n: st.n, part: p, png: await B.grab('image/jpeg', 0.92, 1e-4) }); S.hidden(null); }
        }
        phase = D.state.phase; t = D.match.clock(D.now()).time / 1000;
        if (phase === 'finale' || phase === 'done') break;
      }
      return { phase, t, grabs, worst, steams: st.n, forced: st.forced };
    }, 240, every, stillsAt, stills ? Math.max(0, stillsMax * stillsAt.length * (1 + parts.length) - shots) : 0, control, parts, force);
    steams = r.steams;
    for (const g of r.grabs) {
      const name = `${R.world}-${R.dress.replace(',', '-')}-${R.seed}-steam${g.n}-${String(g.since).padStart(3, '0')}${g.part ? `-no-${g.part}` : ''}.jpg`;
      writeFileSync(join(stills, name), Buffer.from(g.png.split(',')[1], 'base64'));
      shots++;
    }
    if (r.phase === 'finale' || r.phase === 'done' || r.t >= until) break;
  }
  const res = await page.evaluate(() => window.bend.duel.steam.result());
  const line = { ...R, steams, ...res };
  all.push(line);
  const f = (x) => `${x.frames} frames, a body covered ${(x.covered * 100).toFixed(1)}%, core opaque ${x.coreOpaque} (p90 ${x.coreP90}), core veil ${x.coreVeil}, screen ${x.screen}`;
  console.log(`${R.world} ${R.dress} seed ${R.seed} (${R.styles}): ${steams} STEAM!; steam on screen: ${f(res.steam)}; geyser: ${f(res.geyser)}; after STEAM!: ${f(res.event)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await page.close();
}
await browser.close();

// the sum over the runs, weighted by frames
const keys = ['steam', 'geyser', 'event'];
const sum = Object.fromEntries(keys.map((k) => {
  const n = all.reduce((a, r) => a + r[k].frames, 0) || 1, w = (f) => all.reduce((a, r) => a + r[k][f] * r[k].frames, 0) / n;
  return [k, { frames: all.reduce((a, r) => a + r[k].frames, 0), covered: +w('covered').toFixed(3), coreOpaque: +w('coreOpaque').toFixed(3), coreVeil: +w('coreVeil').toFixed(3), screen: +w('screen').toFixed(3), thick: +w('thick').toFixed(3) }];
}));
const steams = all.reduce((a, r) => a + r.steams, 0);
console.log(`\nall ${all.length} runs, ${steams} STEAM!:`);
for (const k of keys) console.log(`  ${k}: ${sum[k].frames} frames sampled, a body covered ${(sum[k].covered * 100).toFixed(1)}%, the core's opaque share ${sum[k].coreOpaque}, its mean veil ${sum[k].coreVeil}, the screen veiled ${sum[k].screen}, veil where it is ${sum[k].thick}`);
writeFileSync(out, JSON.stringify({ runs: all, sum, steams }, null, 1));
console.log(`wrote ${out}`);

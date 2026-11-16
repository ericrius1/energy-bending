// The feel scorecard (report 24-feel): virtual humans play the real page (scripts/human-play.mjs) in each style, the
// dancer in each world, and their measures are scored 0 … 100 the way a person would notice them (human-lib.mjs
// SCORE_RULES: frame pacing and hitches, the camera's turn rate, jerk and swings, time looking at the floor or
// standing in scenery, the body's pops on screen and in the world, key to motion, time stuck pushing, runs stopped,
// momentum kept, going nowhere, losing sight of one's body, the two bodies confusable, magic moments a minute),
// grouped smooth / responsive / clear / magic, and a total. Later phases rerun it and compare.
//   node scripts/human-score.mjs [--url http://localhost:5511/energybending/] [--label before] [--clock stepped|real]
//     [--runs newcomer:geode,dancer:temple,dancer:redwoods,dancer:geode,dancer:pool,explorer:temple,pair:pool]
//     [--seconds 45] [--seed 1] [--base docs/reports/perf/24-feel-before.json] [--stills dir] [--clips dir] [--raw dir]
//     [--again] (score the recordings in --raw again with the current measures, without playing)
//     [--merge] (keep the label's other runs already in its file: rerun only some)
// Writes docs/reports/perf/24-feel-<label>.json; with --base prints each score's change against that file.
// (--clock stepped, the default: the page stepped at 60 fps, so the camera, body and dance measures repeat on a busy
// machine and compare on the same seeds; the frame pacing then is not measured (a stepped frame is 16.7 ms). Run
// --clock real for the frame pacing and the wall's key-to-screen time.)
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { playSession, SOLO_KEYS } from './human-play.mjs';
import { SCORE_RULES, GROUPS, summarize, score } from './human-lib.mjs';

const argv = process.argv.slice(2), o = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
const URL0 = o.url ?? 'http://localhost:5511/energybending/';
const label = o.label ?? 'now';
const clock = o.clock ?? 'stepped';
const seed = Number(o.seed ?? 1);
const SECS = { newcomer: 50, dancer: 45, explorer: 80, pair: 50, touch: 35 };
const runs = String(o.runs ?? 'newcomer:geode,dancer:temple,dancer:redwoods,dancer:geode,dancer:pool,explorer:temple,pair:pool').split(',').map((x) => { const [style, world] = x.split(':'); return { style, world: world ?? 'temple' }; });
const out = { label, clock, seed, date: new Date().toISOString(), url: URL0, runs: [] };
const say = (...a) => console.log(`[score ${new Date().toISOString().slice(11, 19)}]`, ...a);
const outDir = 'docs/reports/perf';
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `24-feel-${label}.json`);
const prevOut = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;

if (o.merge && prevOut) out.runs = prevOut.runs.filter((x) => !runs.some((r) => r.style === x.style && r.world === x.world));
for (const r of runs) {
  const seconds = Number(o.seconds ?? SECS[r.style] ?? 45);
  say(`${r.style} in ${r.world}, ${seconds} s, ${clock}`);
  const t = Date.now();
  let res = null;
  const raw = o.raw ? (mkdirSync(o.raw, { recursive: true }), join(o.raw, `${label}-${r.style}-${r.world}.json`)) : null;
  if (o.again && raw && existsSync(raw)) {
    const prev = prevOut?.runs.find((x) => x.style === r.style && x.world === r.world) ?? { style: r.style, world: r.world, seed, seconds };
    const m = summarize(JSON.parse(readFileSync(raw, 'utf8')), { stepped: clock === 'stepped', moveKeys: SOLO_KEYS, jumpKeys: ['Space'], W: r.style === 'touch' ? 844 : 1280, H: r.style === 'touch' ? 390 : 720 });
    res = { ...prev, measures: m, score: score(m) };
  }
  for (let tries = 0; !res && tries < 2; tries++) {
    try {
      res = await playSession({ style: r.style, world: r.world, seconds, seed, url: URL0, clock, say, raw,
        stills: o.stills ? join(o.stills, label) : null, clip: o.clips ? (mkdirSync(o.clips, { recursive: true }), join(o.clips, `24-feel-${label}-${r.style}-${r.world}.mp4`)) : null });
    } catch (e) { say(`  failed (${e.message.split('\n')[0]}); again`); }
  }
  if (!res) continue;
  res.wall = +((Date.now() - t) / 1000).toFixed(0);
  out.runs.push(res);
  const m = res.measures, s = res.score;
  say(`  total ${s.total} (smooth ${s.groups.smooth}, responsive ${s.groups.responsive}, clear ${s.groups.clear}, magic ${s.groups.magic}); catches ${m.dance?.catches}, flings ${m.dance?.flings}, crossings ${m.crossings?.n} (${m.crossings?.through} through), magic ${m.magic?.perMin?.toFixed(1)}/min (${res.wall} s)`);
  writeFileSync(file, JSON.stringify(out, null, 1));
}

// ---------------------------------------------------------------- the card
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? '-' : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(d));
const base = o.base && existsSync(o.base) ? JSON.parse(readFileSync(o.base, 'utf8')) : null;
const key = (r) => `${r.style}:${r.world}`;
const baseOf = (r) => base?.runs.find((b) => key(b) === key(r));
const cols = out.runs.map(key);
console.log(`\nthe feel scorecard: ${label} (${clock})${base ? ` against ${base.label}` : ''}`);
console.log(['measure'.padEnd(26), ...cols.map((c) => c.padStart(17))].join(''));
for (const [name, [get]] of Object.entries(SCORE_RULES)) {
  const cells = out.runs.map((r) => {
    const v = get(r.measures), sc = r.score.per[name], b = baseOf(r);
    const was = b ? b.score.per[name] : null;
    return `${f(v)} [${sc ?? '-'}${b && was != null && sc != null && was !== sc ? `${sc > was ? '+' : ''}${sc - was}` : ''}]`.padStart(17);
  });
  console.log([name.padEnd(26), ...cells].join(''));
}
for (const g of [...Object.keys(GROUPS), 'total']) {
  const cells = out.runs.map((r) => { const v = g === 'total' ? r.score.total : r.score.groups[g], b = baseOf(r), w = b ? (g === 'total' ? b.score.total : b.score.groups[g]) : null; return `${v ?? '-'}${w != null && v != null ? ` (${v - w >= 0 ? '+' : ''}${v - w})` : ''}`.padStart(17); });
  console.log([g.toUpperCase().padEnd(26), ...cells].join(''));
}
const extra = (name, get) => console.log([name.padEnd(26), ...out.runs.map((r) => String(get(r.measures) ?? '-').padStart(17))].join(''));
extra('catches / flings', (m) => `${m.dance?.catches ?? '-'} / ${m.dance?.flings ?? '-'}`);
extra('links (on the beat)', (m) => `${m.dance?.links ?? '-'} (${m.dance?.perfect ?? '-'})`);
extra('crossings (through)', (m) => `${m.crossings?.n ?? 0} (${m.crossings?.through ?? 0})`);
extra('worlds seen', (m) => (m.crossings?.worlds ?? []).length);
extra('jump ms (n)', (m) => `${f(m.response?.jumpMs, 0)} (${m.response?.jumpN ?? 0})`);
extra('move ms p90 (n)', (m) => `${f(m.response?.moveP90, 0)} (${m.response?.moveN ?? 0})`);
extra('speed pushing m/s', (m) => f(m.move?.speedPushing));
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const all = mean(out.runs.map((r) => r.score.total));
out.total = all;
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`\nfeel score, all runs: ${all}${base?.total != null ? ` (was ${base.total})` : ''}; wrote ${file}`);
process.exit(0);

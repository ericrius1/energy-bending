// The fourth integration's takes (docs/reports/9-integration.md): a smoke run of every world with fire and water, the
// temple's and the redwoods' jogo (free against the partner, and locked from a script), two seams re-shot (the near
// fade across a temple stub, water's rise beside fire), and the critic's five 1080p scenes for the timings.
//   node scripts/steps/integ-9-gen.mjs   (writes scripts/steps/integ-9.json)
//   node scripts/critic-cap.mjs scripts/steps/integ-9.json --only <take> --prefix 9-integ --shots shots/integ9 --url …
import { writeFileSync, readFileSync } from 'node:fs';
const read = (f) => JSON.parse(readFileSync(`scripts/steps/${f}`, 'utf8'));
const water = read('water-9.json'), critic = read('critic6.json'), nf = read('nf-stage.json');
const take = (list, name) => structuredClone(list.find((t) => t.name === name));
const out = [];
// every world with fire and water at game distance (water-9's g-<world>: 7.5 m, an armada at 1 s)
for (const w of ['geode', 'redwoods', 'pool', 'temple', 'forge']) out.push({ ...take(water, `g-${w}`), name: `smoke-${w}` });
// the jogo against the partner, free, 12 s (critic6's partner-temple, its cues; the redwoods at dusk)
for (const w of ['temple', 'redwoods']) {
  const t = take(critic, 'partner-temple');
  out.push({ ...t, name: `jogo-${w}`, query: `jogo=partner&world=${w}&dress=fire,water`, fps: 2, seconds: 12,
    setup: (w === 'redwoods' ? "bend.set('redwoods', { hour: 19.4, dayGoes: false }); " : '') + t.setup,
    cues: Object.fromEntries(Object.entries(t.cues).filter(([s]) => Number(s) < 12)),
    sheet: { cols: 8, rows: 3, width: 240 }, stills: [6, 11] });
}
// the locked jogo from a script, the pair placed 1.2 m apart (water-9's lock-redwoods; the temple's twin threw on the
// water branch: `bend.jogo` missing)
for (const w of ['redwoods', 'temple']) {
  const t = take(water, 'lock-redwoods');
  out.push({ ...t, name: `lock-${w}`, query: `jogo=script&script=none&world=${w}&dress=fire,water`, timings: false,
    setup: t.setup.replaceAll('redwoods', w).replace(`bend.set('${w}', { hour: 19.4, dayGoes: false }); `, w === 'redwoods' ? "bend.set('redwoods', { hour: 19.4, dayGoes: false }); " : '') });
}
// the seams: a temple stub across the pair since the pillars moved (the near fade, a: off, b: on); water's rise in the
// front's first second beside fire (the field's thresholds now by source)
out.push({ ...take(nf, 'nf-temple-stub'), name: 'seam-temple-stub' });
out.push({ ...take(water, 'first-rise'), name: 'seam-first-rise' });
// the critic's five 1080p scenes, the profiler over 150 stepped frames at the end (Report 8's table); each logs the
// page's own adapter (critic-cap's closing probe asks from about:blank, which has no navigator.gpu)
const adapter = "const ai = (await navigator.gpu.requestAdapter())?.info ?? {}; console.warn('adapter in the page', ai.vendor, ai.architecture, ai.description); ";
for (const t of critic.filter((t) => t.name.startsWith('t-'))) out.push({ ...structuredClone(t), setup: adapter + t.setup });
writeFileSync('scripts/steps/integ-9.json', JSON.stringify(out, null, 1));
console.log(out.map((t) => t.name).join(' '));

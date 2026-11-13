// The ?perf runs as Markdown: node scripts/perf-report.mjs [files or dirs…] [--out file.md] [--all]
// Reads docs/reports/perf/*.json by default (finished runs only, unless --all), one column per run (device, variant),
// one row per scene. Three tables: the frame at fixed render scale 1 (the true cost: ms per frame from the frames'
// intervals, fps, p95), the frame with the class's autoscaler (what a player gets: ms, fps, the scale it settled on),
// and the GPU's time per frame where its timestamps are trusted, with the largest passes. Then each run's device: the
// adapter, the class and how it was chosen, the probe, the display's refresh, the pixel ratio, the errors.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const out = outAt >= 0 ? argv[outAt + 1] : null;
const all = argv.includes('--all');
const inputs = argv.filter((a, i) => !a.startsWith('--') && i !== outAt + 1);
const files = (inputs.length ? inputs : ['docs/reports/perf']).flatMap((p) => statSync(p).isDirectory()
  ? readdirSync(p).filter((f) => f.endsWith('.json')).sort().map((f) => join(p, f)) : [p]);
const runs = files.map((f) => ({ file: f, ...JSON.parse(readFileSync(f, 'utf8')) })).filter((r) => all || r.done);
if (!runs.length) { console.error('no finished runs (try --all)'); process.exit(1); }

const name = (r) => r.file.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
const scenes = [];
for (const r of runs) for (const s of r.scenes ?? []) if (!scenes.some((x) => x.id === s.id)) scenes.push({ id: s.id, note: s.note, size: s.size });
const find = (r, id, mode) => r.scenes?.find((s) => s.id === id)?.runs?.find((x) => x.mode === mode);
const f1 = (v) => (v === undefined || v === null ? '—' : v.toFixed(1));
const f2 = (v) => (v === undefined || v === null ? '—' : v.toFixed(2));

const L = [];
L.push(`Runs: ${runs.map((r) => `\`${name(r)}\``).join(', ')}. Frame times are the mean interval between animation frames in real`);
L.push('time (so capped by the display: a 60 Hz display never shows under 16.7 ms); "p95" is the 95th percentile.');
L.push('');
const head = (extra = '') => {
  L.push(`| scene | size |${runs.map((r) => ` ${name(r)}${extra} |`).join('')}`);
  L.push(`|---|---|${runs.map(() => '---|').join('')}`);
};
L.push('### At render scale 1 (the true cost)');
L.push('');
head();
for (const s of scenes) {
  L.push(`| ${s.id} | ${s.size} |${runs.map((r) => {
    const x = find(r, s.id, 'fixed');
    if (!x) return ' — |';
    return ` ${f1(x.frames.mean)} ms, ${f1(x.frames.fps)} fps (p95 ${f1(x.frames.p95)}) ${x.render.join('×')} |`;
  }).join('')}`);
}
L.push('');
L.push("### With the class's autoscaler (what a player gets)");
L.push('');
head();
for (const s of scenes) {
  L.push(`| ${s.id} | ${s.size} |${runs.map((r) => {
    const x = find(r, s.id, 'auto');
    if (!x) return ' — |';
    return ` ${f1(x.frames.mean)} ms, ${f1(x.frames.fps)} fps, scale ${f2(x.renderScale.end)} (${x.render.join('×')}) |`;
  }).join('')}`);
}
L.push('');
L.push('### GPU time per frame at scale 1 (weft\'s profiler; only where its timestamps are trusted)');
L.push('');
head();
for (const s of scenes) {
  L.push(`| ${s.id} | ${s.size} |${runs.map((r) => {
    const x = find(r, s.id, 'fixed');
    if (!x) return ' — |';
    if (!x.gpu.available) return ' no timestamps |';
    if (!x.gpu.trusted) return ' not trusted |';
    const top = Object.entries(x.gpu.passes).slice(0, 4).map(([k, v]) => `${k} ${f2(v)}`).join(', ');
    return ` **${f2(x.gpu.frame?.mean)}** ms${x.gpu.passesTrusted ? ` (${top})` : ' (passes not comparable on this GPU)'} |`;
  }).join('')}`);
}
L.push('');
L.push('### CPU (JS) per frame at scale 1, ms: the whole step / the dancers phase / the matter phase');
L.push('');
head();
for (const s of scenes) {
  L.push(`| ${s.id} | ${s.size} |${runs.map((r) => {
    const x = find(r, s.id, 'fixed');
    return x ? ` ${f2(x.cpu.frame.mean)} / ${f2(x.cpu.phases.dancers)} / ${f2(x.cpu.phases.matter)} |` : ' — |';
  }).join('')}`);
}
L.push('');
L.push('### The devices');
L.push('');
for (const r of runs) {
  const a = r.adapter?.info ?? {}, c = r.class ?? {}, load = r.loads?.[0] ?? {};
  L.push(`- **${name(r)}**: ${[a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' ') || 'unnamed adapter'}` +
    `${c.gpuName ? ` (GL: ${c.gpuName})` : ''}; class **${c.klass}** (${c.how}${c.probe ? `, probe ${c.probe.gpixPerS} Gpix/s` : ''}); ` +
    `display ${load.refresh?.hz ?? '?'} Hz; dpr ${r.screen?.dpr}, window ${r.window?.w}×${r.window?.h}; ${r.baseline ? 'baseline limits; ' : ''}` +
    `audio ${r.audio ?? '?'}; GPU timestamps ${r.scenes?.[0]?.runs?.[0]?.gpu?.trusted ? 'trusted' : 'not trusted or absent'}; ` +
    `${(r.errors ?? []).length} error(s); pipelines failed: ${r.ready?.failed ?? '?'}. ${String(r.ua ?? '').slice(0, 140)}`);
}
const text = L.join('\n') + '\n';
if (out) writeFileSync(out, text);
process.stdout.write(text);

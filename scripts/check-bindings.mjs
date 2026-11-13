// npm test: no shader stage may need more than WebGPU's baseline limits (what plenty of phones and laptops have
// exactly): 12 uniform buffers, 8 storage buffers, 16 sampled textures, 4 storage textures and 16 samplers per stage,
// 4 bind groups per pipeline, 64 KiB per uniform binding. Plain Node, no GPU: every .wgsl under src/ with an entry
// point is compiled by weft's own build step (the same includes and reflection the Vite plugin uses) and its bind
// group layouts are counted the way weft builds them (node_modules/@ericrius1/weft/dist/src/binder.js):
//   - group 0, the frame, is in every pipeline and visible to every stage: 2 uniforms (Frame, globals), 4 samplers;
//   - a shared group (kit.shareGroup) joins a pipeline when any entry of it uses one of its bindings, and then all of
//     its bindings are visible to every stage (every world's light, the field's textures, ...);
//   - a shader's own bindings count only in the stages whose entry uses them.
// A render pipeline pairs a vertex and a fragment entry; which pairs are drawn is the TypeScript's business, so the
// shared groups any render entry of a file uses are counted in all of that file's render entries (an upper bound).
// Compute entries are each their own pipeline.
//   node scripts/check-bindings.mjs            (fails on any stage over a limit)
//   node scripts/check-bindings.mjs --table    (also prints every stage's use, for AGENTS.md)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWgsl } from '@ericrius1/weft/wgsl';
// WebGPU's default limits, the same numbers ?baseline runs with (Node strips the types)
import { BASELINE_STAGE as BASE } from '../src/engine/baseline.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const libs = { weft: join(root, 'node_modules/@ericrius1/weft/dist/shaders') };
const table = process.argv.includes('--table');

/** the shared groups: the file handed to kit.shareGroup for each index (checked against the source below) */
const SHARED = { 2: 'src/worlds/light.wgsl', 3: 'src/matter/field/group.wgsl' };

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.wgsl')) files.push(p);
  }
})(src);
files.sort();
const rel = (p) => relative(root, p).split(sep).join('/');
const compile = (f) => compileWgsl(f, { root, libs });

let bad = 0;
const fail = (m) => { console.error(m); bad++; };

// every kit.shareGroup in src must be one this check knows about (a new shared group changes every count)
(function scanTs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { scanTs(p); continue; }
    if (!e.name.endsWith('.ts') || e.name.endsWith('.d.wgsl.ts')) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(/kit\.shareGroup\(\s*(\d+)/g)) {
      if (!SHARED[m[1]]) fail(`${rel(p)}: kit.shareGroup(${m[1]}, …) is not in scripts/check-bindings.mjs SHARED`);
    }
  }
})(src);

// the shared groups' bindings, as their declaring file reflects them
const shared = {};
for (const [g, file] of Object.entries(SHARED)) {
  const s = compile(join(root, file));
  shared[g] = { file, infos: Object.values(s.reflect.bindings).filter((b) => b.group === Number(g)) };
}

const kinds = ['uniform', 'storage', 'texture', 'storageTexture', 'sampler'];
const kindOf = (b) => (b.kind === 'samplerComparison' ? 'sampler' : b.kind === 'externalTexture' ? 'texture' : b.kind);
const rows = [];

for (const f of files) {
  const s = compile(f);
  const { bindings, entries, structs } = s.reflect;
  if (!entries.length) continue;
  const id = rel(f);
  // the shared groups a set of entries brings in
  const sharedOf = (es) => {
    const gs = new Set();
    for (const e of es) for (const n of e.resources) {
      const b = bindings[n];
      if (b && shared[b.group]) gs.add(b.group);
    }
    return gs;
  };
  const render = entries.filter((e) => e.stage !== 'compute');
  const renderShared = sharedOf(render);
  for (const e of entries) {
    const gs = e.stage === 'compute' ? sharedOf([e]) : renderShared;
    const n = { uniform: 2, storage: 0, texture: 0, storageTexture: 0, sampler: 4 };
    const groups = new Set([0]);
    for (const g of gs) {
      groups.add(g);
      for (const b of shared[g].infos) n[kindOf(b)]++;
    }
    for (const name of e.resources) {
      const b = bindings[name];
      if (!b || b.group === 0 || shared[b.group]) continue;
      groups.add(b.group);
      n[kindOf(b)]++;
    }
    // weft fills the gaps below the highest group with empty layouts: the count is the highest index + 1
    const nGroups = Math.max(...groups) + 1;
    for (const k of kinds) if (n[k] > BASE[k]) fail(`${id} ${e.stage} ${e.name}: ${n[k]} ${k} bindings (baseline ${BASE[k]})`);
    if (nGroups > BASE.groups) fail(`${id} ${e.stage} ${e.name}: bind group ${nGroups - 1} (baseline ${BASE.groups} groups)`);
    rows.push({ id, stage: e.stage, entry: e.name, ...n, groups: [...groups].sort().join(' ') });
  }
  // every uniform this file binds fits a uniform binding (the shared light block grows with the worlds)
  for (const b of Object.values(bindings)) {
    if (b.kind !== 'uniform' || !b.struct || !structs[b.struct]) continue;
    const size = structs[b.struct].size;
    if (size > BASE.uniformBytes) fail(`${id}: uniform '${b.name}' (${b.struct}) is ${size} bytes (baseline ${BASE.uniformBytes})`);
  }
}

if (table) {
  // one row per shader and stage: the most any of its entries of that stage uses, and what that leaves
  const agg = new Map();
  for (const r of rows) {
    const key = `${r.id}|${r.stage}`;
    const a = agg.get(key);
    if (!a) { agg.set(key, { ...r, groups: new Set(r.groups.split(' ')) }); continue; }
    for (const k of kinds) a[k] = Math.max(a[k], r[k]);
    for (const g of r.groups.split(' ')) a.groups.add(g);
  }
  console.log('| shader | stage | uniform | storage | sampled tex | storage tex | samplers | groups |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of agg.values()) {
    const c = (k) => `${r[k]} (${BASE[k] - r[k]})`;
    console.log(`| ${r.id.replace(/^src\//, '')} | ${r.stage} | ${c('uniform')} | ${c('storage')} | ${c('texture')} | ${c('storageTexture')} | ${c('sampler')} | ${[...r.groups].sort().join(' ')} |`);
  }
  const lb = shared[2] && compile(join(root, SHARED[2]));
  if (lb) for (const b of Object.values(lb.reflect.bindings)) {
    if (b.group === 2 && b.kind === 'uniform' && b.struct) console.log(`\nshared light uniform '${b.name}' (${b.struct}): ${lb.reflect.structs[b.struct].size} of ${BASE.uniformBytes} bytes`);
  }
}
const worst = (k) => rows.reduce((a, r) => (r[k] > a[k] ? r : a), rows[0]);
const w = worst('uniform');
console.log(bad ? `${bad} stage(s) over the baseline` : `bindings within the baseline (${rows.length} entry points; most uniforms: ${w.uniform} of 12, ${w.id} ${w.entry})`);
process.exit(bad ? 1 : 0);

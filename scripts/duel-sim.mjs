// The duel's Node playtest (src/duel/probe.ts, bundled with esbuild and run under Node, as scripts/test-ts.mjs runs the
// tests). No page, no GPU: two virtual players through the real bodies and the duel's rules, many seeded rounds.
//   node scripts/duel-sim.mjs [--world temple,geode] [--rounds 8] [--styles mix|aggressive,evasive] [--skills 0.7,0.7]
//                             [--seed 1] [--json out.json] [-v]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'duel-sim-'));
const out = join(dir, 'probe.mjs');
await build({ entryPoints: [join(root, 'src/duel/probe.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'error', absWorkingDir: root });
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root });
rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);

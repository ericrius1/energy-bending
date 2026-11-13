// The brains in simulated play, printed (src/ai/test/probe.ts, bundled with esbuild and run under Node, as
// scripts/test-ts.mjs runs the tests). No page, no GPU.
//   node scripts/steps/brains-sim.mjs [two|attacker|still|pattern|free] [seconds] [presetA] [presetB] [seed]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'brains-sim-'));
const out = join(dir, 'probe.mjs');
await build({ entryPoints: [join(root, 'src/ai/test/probe.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'error', absWorkingDir: root });
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root });
rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);

// Phase 3's measure of the duel (src/duel/measure.ts, bundled with esbuild and run under Node, as scripts/duel-sim.mjs
// runs the playtest): falls, catches, the ten powers' shares, reactions, the ice step as a ledge, the hazards ridden.
//   node scripts/duel-measure.mjs [--world temple,redwoods,geode,pool] [--sets 20] [--skills 0.85,0.85] [--hazards 1]
//                                 [--seed 1] [--view free] [--json out.json]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'duel-measure-'));
const out = join(dir, 'measure.mjs');
await build({ entryPoints: [join(root, 'src/duel/measure.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'error', absWorkingDir: root });
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root });
rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);

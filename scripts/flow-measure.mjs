// The flow measure (src/duel/flow.ts, bundled with esbuild and run under Node): how open the arenas are and how the
// bodies move in them (report 18-flow).
//   node scripts/flow-measure.mjs [--world temple,redwoods,geode,pool] [--sets 12] [--room 1] [--svg dir] [--json out.json]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'flow-measure-'));
const out = join(dir, 'flow.mjs');
await build({ entryPoints: [join(root, 'src/duel/flow.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'error', absWorkingDir: root });
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root });
rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);

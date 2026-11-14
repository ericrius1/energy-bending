// The duel camera's Node measure (src/duel/camprobe.ts, bundled with esbuild and run under Node, as duel-sim.mjs runs
// probe.ts): many seeded sets in the four arenas, every frame judged (the eye in the pieces, the near frame, hidden bodies,
// the flyer in frame).
//   node scripts/cam-sim.mjs [--world temple,redwoods,geode,pool] [--sets 6] [--set-s 40] [--seed 1] [--json out.json] [--impulses]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cam-sim-'));
const out = join(dir, 'probe.mjs');
await build({ entryPoints: [join(root, 'src/duel/camprobe.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'error', absWorkingDir: root });
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root });
rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);

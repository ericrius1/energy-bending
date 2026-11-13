// npm test, the TypeScript half: every src/**/*.test.ts, bundled with esbuild (Vite's own, already installed) into
// one plain .mjs each and run with Node, one after another. A test file is a script that prints its results and exits
// non-zero on a failure (see src/dancer/test/check.ts). Pure logic only: no DOM, no GPU. Fast (a few seconds).
//   node scripts/test-ts.mjs [filter]     (a filter runs only the files whose path contains it)
import { build } from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const filter = process.argv[2] ?? '';
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    // (src/audio/test exports its tests as a `tests` object instead: scripts/test-audio.mjs runs those)
    else if (e.name.endsWith('.test.ts') && p.includes(filter) && !/[\\/]audio[\\/]test[\\/]/.test(p)) files.push(p);
  }
})(join(root, 'src'));
files.sort();

const out = join(tmpdir(), `energybending-test-ts-${process.pid}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let failed = 0;
for (const f of files) {
  const name = relative(root, f).replace(/[\\/]/g, '_').replace(/\.ts$/, '.mjs');
  const dest = join(out, name);
  // (src/ is the app's: Vite-only imports like ?raw or .wgsl would fail here; tests import pure modules)
  await build({ entryPoints: [f], outfile: dest, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'error', absWorkingDir: root });
  console.log(`\n# ${relative(root, f)}`);
  const r = spawnSync(process.execPath, [dest], { stdio: 'inherit', cwd: root });
  if (r.status !== 0) failed++;
}
console.log(`\n${files.length - failed} of ${files.length} test file(s) passed`);
rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);

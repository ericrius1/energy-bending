// npm test (part two): the audio's pure-logic tests, src/audio/test/*.test.ts. Each file is bundled for Node with
// esbuild (Vite's own dependency) and imported; it exports `tests`, named functions that throw on failure.
import { build } from 'esbuild';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/audio/test/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort();
const out = mkdtempSync(join(tmpdir(), 'energybending-audio-test-'));
let failed = 0, passed = 0;
try {
  for (const f of files) {
    const file = join(out, f.replace(/\.ts$/, '.mjs'));
    await build({ entryPoints: [join(dir, f)], bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'error' });
    const { tests } = await import(pathToFileURL(file).href);
    console.log(f);
    for (const [name, fn] of Object.entries(tests)) {
      try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}: ${e?.message ?? e}`); }
    }
  }
} finally { rmSync(out, { recursive: true, force: true }); }
console.log(failed ? `${failed} failed, ${passed} passed` : `audio: ${passed} tests passed`);
process.exit(failed ? 1 : 0);

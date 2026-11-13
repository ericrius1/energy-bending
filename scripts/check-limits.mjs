// npm test: the caps in src/engine/limits.ts and src/engine/limits.wgsl agree (the shaders and the buffers must be
// sized from the same numbers). Plain Node, no GPU.
import { readFileSync } from 'node:fs';

const ts = readFileSync(new URL('../src/engine/limits.ts', import.meta.url), 'utf8');
const wgsl = readFileSync(new URL('../src/engine/limits.wgsl', import.meta.url), 'utf8');
const num = (s) => Number(s.replace(/_/g, '').replace(/u$/, ''));
const caps = Object.fromEntries([...ts.matchAll(/^\s+(\w+): ([\d_]+),/gm)].map((m) => [m[1], num(m[2])]));
const pairs = [...wgsl.matchAll(/^const (\w+): u32 = (\d+)u;\s*\/\/ LIMITS\.(\w+)/gm)];
let bad = 0;
for (const [, name, value, cap] of pairs) {
  if (caps[cap] === undefined) { console.error(`limits.wgsl ${name} names LIMITS.${cap}, which limits.ts doesn't have`); bad++; }
  else if (caps[cap] !== num(value)) { console.error(`${name} is ${value} in limits.wgsl but LIMITS.${cap} is ${caps[cap]} in limits.ts`); bad++; }
}
if (!pairs.length) { console.error('no caps found in limits.wgsl'); bad++; }
console.log(bad ? `${bad} mismatch(es)` : `limits agree (${pairs.length} caps checked)`);
process.exit(bad ? 1 : 0);

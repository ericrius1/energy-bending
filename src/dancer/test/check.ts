// A very small test harness for the pure modules (run by scripts/test-ts.mjs through `npm test`): `test(name, fn)`
// records a pass (fn may return a note) or a failure, `done()` prints them and sets the exit code. No dependencies.

const results: string[] = [];
let pass = 0, fail = 0;

export function test(name: string, fn: () => string | void) {
  try { const info = fn(); pass++; results.push(`ok    ${name}${info ? `  (${info})` : ''}`); }
  catch (e) { fail++; results.push(`FAIL  ${name}: ${(e as Error).message}`); }
}
export function assert(c: unknown, m?: string): asserts c { if (!c) throw new Error(m || 'assertion failed'); }
export function near(a: number, b: number, tol: number, m?: string) { assert(Math.abs(a - b) <= tol, `${m || ''} expected ${b}, got ${a} (tol ${tol})`); }

export function done() {
  for (const r of results) console.log(r);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (typeof process !== 'undefined') process.exitCode = fail ? 1 : 0;
}

declare const process: { exitCode?: number };

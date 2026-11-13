// A few lines of assertion for the audio's pure-logic tests (run in Node by scripts/test-audio.mjs, which bundles each
// *.test.ts with esbuild). A test file exports `tests`: named functions that throw on failure.
export type Tests = Record<string, () => void>;

export function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(what);
}
export function close(a: number, b: number, tol: number, what: string) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} is not within ${tol} of ${b}`);
}
/** a line of measurement the runner prints (the report quotes these) */
export const say = (s: string) => console.log(`    ${s}`);

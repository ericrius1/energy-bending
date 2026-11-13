// What the Node tests share: starting the room server as its own process (as Railway runs it), waiting for an event
// on a client, and a tiny step runner that prints one line per check and exits non-zero on any failure.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { NetLike } from '../src/net/net.ts';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Started { child: ChildProcess; log: () => string; stop: () => Promise<void> }

/** start server/index.ts on a port as a child process; resolves once it is listening */
export function startServer(port: number, env: Record<string, string> = {}): Promise<Started> {
  const e: Record<string, string | undefined> = { ...process.env, ...env };
  delete e.PORT;
  const entry = fileURLToPath(new URL('../server/index.ts', import.meta.url));
  const child = spawn(process.execPath, [entry, String(port)], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const stop = () => new Promise<void>((r) => {
    if (child.exitCode != null) return r();
    child.removeAllListeners('exit');
    child.on('exit', () => r());
    child.kill();
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { child.kill(); reject(new Error('server did not start:\n' + log)); }, 8000);
    child.stdout!.on('data', (d) => {
      log += d;
      if (log.includes('Energy Bending rooms on')) { clearTimeout(t); resolve({ child, log: () => log, stop }); }
    });
    child.stderr!.on('data', (d) => { log += d; });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`server exited ${code}:\n${log}`)); });
  });
}

/** the next `type` event on net (optionally matching pred), or a rejection after ms */
export function waitFor<T = any>(net: NetLike, type: string, pred: ((m: T) => boolean) | null = null, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const off = (net.on as (t: string, f: (m: T) => void) => () => void)(type, (m) => { if (!pred || pred(m)) { clearTimeout(t); off(); resolve(m); } });
    const t = setTimeout(() => { off(); reject(new Error(`timeout waiting for ${type}`)); }, ms);
  });
}

let passed = 0, failed = 0;
export async function step(name: string, fn: () => unknown) {
  const t0 = performance.now();
  try { await fn(); passed++; console.log(`ok   ${name} (${(performance.now() - t0).toFixed(0)} ms)`); }
  catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
export function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
process.on('unhandledRejection', (e) => { console.error('unhandled', e); });

// Shared helpers for the Node tests.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Start server.js on a port as a child process; resolves once it is listening.
export function startServer(port) {
  const env = { ...process.env };
  delete env.PORT;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url)), String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { child.kill(); reject(new Error('server did not start:\n' + log)); }, 5000);
    child.stdout.on('data', d => {
      log += d;
      if (log.includes('Dance First on')) { clearTimeout(t); resolve({ child, log: () => log, stop }); }
    });
    child.stderr.on('data', d => { log += d; });
    child.on('exit', code => { clearTimeout(t); reject(new Error(`server exited ${code}:\n${log}`)); });
  });
  function stop() {
    return new Promise(r => {
      if (child.exitCode != null) return r();
      child.removeAllListeners('exit');
      child.on('exit', () => r());
      child.kill();
    });
  }
}

// Resolve with the next `type` event on net (optionally matching pred), or reject after ms.
export function waitFor(net, type, pred = null, ms = 3000) {
  return new Promise((resolve, reject) => {
    const off = net.on(type, m => { if (!pred || pred(m)) { clearTimeout(t); off(); resolve(m); } });
    const t = setTimeout(() => { off(); reject(new Error(`timeout waiting for ${type}`)); }, ms);
  });
}

let passed = 0, failed = 0;
export async function step(name, fn) {
  const t0 = performance.now();
  try { await fn(); passed++; console.log(`ok   ${name} (${(performance.now() - t0).toFixed(0)} ms)`); }
  catch (e) { failed++; console.error(`FAIL ${name}\n`, e); throw e; }
}
export function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
process.on('unhandledRejection', e => { console.error('unhandled', e); });

// Headless Chrome with WebGPU on the real GPU, for the capture scripts (shot.mjs, film.mjs) and the shared render
// lock every headless GPU capture on this PC takes (docs/PLAN.md, "Shared habits").
// On Windows Chrome's WebGPU runs on D3D12; headless it still finds the discrete GPU as long as the GPU process is not
// blocklisted, so the flags are few. On a Mac it needs ANGLE on Metal. `adapterName(page)` asks the page which adapter
// it got, so a capture can prove it is not SwiftShader.
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmdirSync, existsSync } from 'node:fs';

const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
export const CHROME = process.env.CHROME
  ?? (win ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : mac ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');

/** the flags that give WebGPU on the real GPU headless (see the file's opening note) */
export function gpuFlags() {
  return [
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    ...(mac ? ['--use-angle=metal'] : []),
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--force-device-scale-factor=1',
  ];
}

export async function launch({ width = 1280, height = 800, extra = [] } = {}) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 0,
    args: [...gpuFlags(), `--window-size=${width},${height}`, ...extra],
    defaultViewport: { width, height, deviceScaleFactor: 1 },
  });
}

/** the WebGPU adapter the page sees: "vendor architecture description" (SwiftShader says so in its name) */
export async function adapterName(page) {
  return page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    if (!a) return 'no WebGPU adapter';
    const i = a.info ?? {};
    return [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' ') || 'unnamed adapter';
  });
}

// ---------------------------------------------------------------- the shared render lock
const LOCK = process.env.RENDER_LOCK ?? (win ? 'C:/Users/ericr/render-lock' : '/tmp/render-lock');
let held = false;

/** take the lock (a directory: mkdir is atomic), waiting while another capture holds it; released on any exit */
export async function takeLock({ waitMs = 5000, say = console.log } = {}) {
  for (let tries = 0; ; tries++) {
    try { mkdirSync(LOCK); held = true; break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (tries % 6 === 0) say(`render lock ${LOCK} is held; waiting`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  const release = () => { if (held && existsSync(LOCK)) { try { rmdirSync(LOCK); } catch { /* gone already */ } } held = false; };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { release(); process.exit(130); });
  process.on('uncaughtException', (e) => { console.error(e); release(); process.exit(1); });
  return release;
}

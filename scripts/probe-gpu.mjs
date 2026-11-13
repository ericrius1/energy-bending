// Which GPU does headless Chrome give WebGPU here? node scripts/probe-gpu.mjs (takes the render lock)
import { launch, adapterName, takeLock } from './lib/browser.mjs';
const release = await takeLock();
const b = await launch();
const p = await b.newPage();
await p.goto(process.argv[2] ?? 'http://127.0.0.1:5392/dancers/');
console.log('adapter:', await adapterName(p));
await b.close();
release();

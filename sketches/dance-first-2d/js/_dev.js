// _dev.js — test helpers. Not loaded by the app; import it by hand from the console:
//   await import('/js/_dev.js')
// It drives frames and the music scheduler at a steady 60 Hz even when the tab is throttled.
const d = window.danceFirst, m = d.music;
const cv = document.getElementById('gl');
const yieldNow = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

window.snap = () => {
  let im = document.getElementById('snap');
  if (!im) {
    im = document.createElement('img'); im.id = 'snap';
    im.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:3;object-fit:fill;pointer-events:none';
    document.body.appendChild(im);
  }
  d.advance(1); // draw in this same task so the buffer is still there to read
  im.src = cv.toDataURL('image/jpeg', 0.92);
};
window.drive = async (secs, fn) => {
  const t0 = performance.now(); let next = t0, lastLog = t0;
  const log = { levels: [], rms: [], peak: 0, frames: 0 };
  while (performance.now() - t0 < secs * 1000) {
    const now = performance.now();
    if (now >= next) {
      next += 16.67;
      if (fn) fn((now - t0) / 1000);
      if (m.started) m._tick();
      d.advance(1); log.frames++;
      if (now - lastLog > 500 && m.started) {
        lastLog = now; const lv = m.levelMeter();
        log.levels.push(m.level); log.rms.push(+lv.rms.toFixed(2)); log.peak = Math.max(log.peak, +lv.peak.toFixed(3));
      }
    }
    await yieldNow();
  }
  return log;
};
const W = () => cv.clientWidth, H = () => cv.clientHeight;
window.mouse = (x, y, type = 'pointermove') => cv.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerType: 'mouse', button: 0, bubbles: true }));
window.touch = (id, x, y, type) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', bubbles: true }));
window.key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
window.wave = t => mouse(W() * (0.5 + 0.2 * Math.sin(t * 3.1)), H() * (0.42 + 0.24 * Math.sin(t * 4.3)));
window.gentle = t => mouse(W() * (0.5 + 0.12 * Math.sin(t * 1.1)), H() * (0.45 + 0.15 * Math.sin(t * 1.7)));
window.errs = [];
window.addEventListener('error', e => errs.push(e.message));
window.addEventListener('unhandledrejection', e => errs.push(String(e.reason)));

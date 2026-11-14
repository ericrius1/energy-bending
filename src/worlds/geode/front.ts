// The front of the game, as the hub stages it: what the first page does around the menu (src/play/menu.ts builds the
// menu; its looks are index.html's). The hub is the front: the show's two dancers already dance in the geode with a
// live gate behind them (dancer/show.ts), and this file joins the menu to them.
//   - choosing a body re-dresses that dancer at once, with a flourish (Show.redress), and the choice is kept for the
//     next visit; the menu opens on the bodies kept from last time (menu.ts reads them)
//   - choosing a world turns the camera to that world's gate (Show.face); walking through a gate is still how to go
//   - the strip fades when the pointer rests, and comes back when it moves (a touch on the faded strip only wakes it)
//   - a key, a gamepad's button, a tap on the dancers, or the play button begins a jogo against the partner on the hub's
//     stage, in this page (src/play's `bend.front.begin`): the first gesture strikes a bowl (the stones' ring) and the
//     music comes up from the ambient bed; the key, touch or click that began it joins seat 1 at once (`joined`), so the
//     lobby's cards show who is who. The first jogo of a first visit has the teacher in the partner's seat for its
//     first lesson (src/ai's TeacherBrain, lesson 'first': a meia-lua and the esquiva, each answered twice, the ginga
//     between; at most a minute), remembered so it isn't offered again
//   - on a phone the gates show stills while the front is up (the device class's budget: engine/perf.ts)
// If src/play's `bend.front` isn't there, it opens the jogo's address instead, as the menu's play button always did.
import { isFront } from '../../dancer/show';
import type { Show } from '../../dancer/show';
import type { Music } from '../../audio/music';
import { budget, deviceClass } from '../../engine/perf';
import { setParams } from '../../engine/params';

type Bend = Record<string, any> & { show: Show; music: Music };
type Device = { device: 'keyboard'; code: string } | { device: 'touch'; id: number; x: number; y: number } | { device: 'mouse' } | null;

const IDLE_S = 3.2;
const TAUGHT = 'energybending.taught';
const TEACH_S = 60;
/** keys that never begin a jogo: the browser's, focus moving round the menu, main.ts's fullscreen */
const QUIET = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'ContextMenu', 'f', 'F']);

if (typeof document !== 'undefined' && isFront()) void install();

async function install() {
  const bend = await until(() => (window as unknown as { bend?: Bend }).bend);
  const root = await until(() => document.querySelector<HTMLElement>('.jg-front'));
  const show = bend.show;
  document.body.classList.add('front');
  root.classList.add('jg-strip');
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  let begun = false;

  // ---------------------------------------------------------------- the menu joined to the dancers
  // (the menu opens on the bodies kept from last time: menu.ts starts from the same lastDress the show wears)
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.jg-btn');
    if (!b) return;
    if (b.dataset.seat != null && b.dataset.name) show.redress(Number(b.dataset.seat), b.dataset.name);
    else if (b.dataset.world) show.face(b.dataset.world);
  }, { capture: true });
  // the play button begins in the page (on one screen); online and solo keep the menu's own way, by address
  root.querySelector('.jg-go')?.addEventListener('click', (e) => {
    const mode = currentMode(root);
    if (mode !== 'same' && mode !== 'partner') return;
    e.stopImmediatePropagation();
    // the click that pressed play joins seat 1 (it had joined nobody: the jogo sat in its lobby, waiting for a key)
    const pe = e as PointerEvent;
    void begin(mode, pe.pointerType === 'touch' || pe.pointerType === 'pen' ? { device: 'touch', id: pe.pointerId, x: pe.clientX, y: pe.clientY } : { device: 'mouse' });
  }, { capture: true });

  // ---------------------------------------------------------------- resting: the strip fades, and comes back
  let rest = 0;
  const wakeStrip = () => { rest = 0; if (!begun) root.classList.remove('idle', 'dim'); };
  addEventListener('pointermove', wakeStrip, { passive: true });
  addEventListener('focusin', wakeStrip);
  // a touch on the faded strip wakes it, and does nothing else
  root.addEventListener('pointerdown', (e) => {
    if (!root.classList.contains('idle')) return;
    wakeStrip();
    e.stopPropagation();
    root.addEventListener('click', (c) => { c.stopImmediatePropagation(); c.preventDefault(); }, { capture: true, once: true });
  }, { capture: true });

  // ---------------------------------------------------------------- beginning: a key, a button, a tap
  addEventListener('keydown', (e) => {
    if (begun || e.repeat || e.ctrlKey || e.metaKey || e.altKey || QUIET.has(e.key) || /^F\d+$/.test(e.key)) return;
    const inMenu = !!(e.target as HTMLElement)?.closest?.('.jg-front');
    if (inMenu && ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { wakeStrip(); return; }
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    // (space would also shatter the show: main.ts's key; the jogo is beginning instead)
    e.preventDefault();
    e.stopImmediatePropagation();
    void begin(currentMode(root) === 'same' ? 'same' : 'partner', e.key === ' ' ? { device: 'mouse' } : { device: 'keyboard', code: e.code });
  }, { capture: true });
  // a tap on the dancers (a drag still turns the camera and plays with the matter)
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; wakeStrip(); });
  canvas.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (begun || !d || performance.now() - d.t > 300 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    void begin(currentMode(root) === 'same' ? 'same' : 'partner', e.pointerType === 'mouse' ? { device: 'mouse' } : { device: 'touch', id: e.pointerId, x: e.clientX, y: e.clientY });
  });

  // a gamepad's button; and the strip's rest, counted on the same clock
  let last = performance.now();
  const tick = (now: number) => {
    const dt = (now - last) / 1000; last = now;
    if (begun) return;
    rest += dt;
    if (rest > IDLE_S && !root.matches(':hover, :focus-within')) root.classList.add('idle');
    for (const p of navigator.getGamepads?.() ?? []) if (p?.buttons.some((b) => b.pressed)) { void begin(currentMode(root) === 'same' ? 'same' : 'partner', null); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // a phone shows the gates' stills while the front is up (one live gate is the jogo's, not the menu's)
  if (deviceClass() === 'phone') setParams('gates', { live: 0 });

  // ---------------------------------------------------------------- the jogo, in this page
  async function begin(mode: 'same' | 'partner', device: Device) {
    if (begun) return;
    begun = true;
    root.classList.add('dim');
    document.body.classList.add('playing');
    ring(bend);
    if (deviceClass() === 'phone') setParams('gates', { live: budget().gates.live });
    const world = root.querySelector<HTMLElement>('.jg-world.on')?.dataset.world ?? 'geode';
    const lock = !!root.querySelector('.jg-lock.on');
    const q = new URLSearchParams({ jogo: mode, world, dress: show.dress.slice(0, 2).join(',') });
    if (!lock) q.set('free', '');
    const href = `${location.pathname}?${q.toString().replace(/=(?=&|$)/g, '')}`;
    try {
      if (typeof bend.front?.begin !== 'function') { location.assign(href); return; }
      const api = await bend.front.begin(mode, q, device ?? undefined);
      if (!api) { location.assign(href); return; }
      history.replaceState(null, '', href);
      teach(api);
    } catch (err) {
      console.warn('front: the jogo could not begin in the page; opening its address', err);
      location.assign(href);
    }
  }
}

/** the first gesture: the sound starts with a bowl struck (the stones' ring), and comes up from the ambient bed */
function ring(bend: Bend) {
  const m = bend.music, key = bend.show.program.key;
  const fresh = !m.live;
  m.start(key);
  if (!m.live) return;
  const t = m.now(), out = m.score.out;
  out.strike(t, 'glass', key + 12, 0.34, -0.15, 1.3);
  out.strike(t + 0.9, 'glass', key + 19, 0.16, 0.25, 1.3);
  if (!fresh) return;
  // the whole mix swells in over four seconds (the engine's own levels then follow the dancing)
  const full = (bend.params?.audio?.volume as number | undefined) ?? 0.9, t0 = performance.now();
  const swell = () => {
    const k = Math.min(1, (performance.now() - t0) / 4000);
    if (m.live) m.live.synth.volume = full * (0.45 + 0.55 * k * k * (3 - 2 * k));
    if (k < 1) requestAnimationFrame(swell);
  };
  swell();
}

/** a first visit's first jogo: the teacher's first lesson (a meia-lua and the esquiva, each answered twice, the ginga
 *  between), at most a minute, then the partner plays. Remembered, so it is offered once */
function teach(api: Record<string, any>) {
  let seen = false;
  try { seen = !!localStorage.getItem(TAUGHT); localStorage.setItem(TAUGHT, String(Date.now())); } catch { /* no storage: teach */ }
  const partner = api.partner;
  if (seen || typeof partner?.teach !== 'function') return;
  void import('../../ai/teacher').then(({ TeacherBrain }) => partner.teach(new TeacherBrain({ seed: 2, lesson: 'first' }), TEACH_S));
}

const currentMode = (root: HTMLElement) => root.querySelector<HTMLElement>('.jg-mode.on')?.dataset.mode ?? 'same';

function until<T>(get: () => T | null | undefined): Promise<T> {
  return new Promise((ok) => { const look = () => { const v = get(); if (v) ok(v); else requestAnimationFrame(look); }; look(); });
}

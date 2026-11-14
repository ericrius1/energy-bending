// The front of the game, as the hub stages it: what the first page does around the menu (src/play/menu.ts builds the
// menu; its looks are index.html's). The hub is the front: the show's two dancers already dance in the geode with a
// live gate behind them (dancer/show.ts), and this file joins the menu to them.
//   - choosing a body re-dresses that dancer at once, with a flourish (Show.redress), and the choice is kept for the
//     next visit; the menu opens on the bodies kept from last time (menu.ts reads them)
//   - choosing a world turns the camera to that world's gate (Show.face); walking through a gate is still how to go
//   - the strip fades when the pointer rests, and comes back when it moves (a touch on the faded strip only wakes it)
//   - a key, a gamepad's button, a tap on the dancers, or the play button begins the game chosen in this page (src/play's
//     `bend.front.begin`): the dance (a jogo against the partner on the hub's stage) or the duel (src/duel, in the
//     world chosen: the address becomes the duel's before it starts, so its bodies and devices take the duel's
//     profile and buttons). The first gesture strikes a bowl (the stones' ring) and the music comes up from the
//     ambient bed; the key, touch, click or pad that began it joins seat 1 at once (`joined`), so the lobby's cards show
//     who is who. A game in another world than the one on screen fades through a short veil, so no frame of the old
//     world's stage shows the new game. The first jogo of a first visit has the teacher in the partner's seat for its
//     first lesson (src/ai's TeacherBrain, lesson 'first': a meia-lua and the esquiva, each answered twice, the ginga
//     between; at most a minute), remembered so it isn't offered again; the first duel teaches itself (src/duel/lesson.ts)
//   - an online duel opens its room's address (through the veil); online and solo dances keep the menu's own way
//   - the arrow keys walk the strip (menu.ts); a gamepad's d-pad or left stick does too, A presses what is focused (or
//     begins), Start begins; ? opens the controls card (src/duel/help.ts)
//   - on a phone the gates show stills while the front is up (the device class's budget: engine/perf.ts)
// If src/play's `bend.front` isn't there, it opens the game's address instead, as the menu's play button always did.
import { isFront } from '../../dancer/show';
import type { Show } from '../../dancer/show';
import type { Music } from '../../audio/music';
import { budget, deviceClass } from '../../engine/perf';
import { setParams } from '../../engine/params';
import { moveFocus } from '../../play/menu';

type Bend = Record<string, any> & { show: Show; music: Music };
type Device = { device: 'keyboard'; code: string } | { device: 'touch'; id: number; x: number; y: number } | { device: 'mouse' } | { device: 'gamepad'; index: number } | null;
type Pick = { game: 'dance' | 'duel'; mode: string };

const IDLE_S = 3.2;
const TAUGHT = 'energybending.taught';
const TEACH_S = 60;
const VEIL_MS = 380;
/** keys that never begin a game: the browser's, focus moving round the menu, main.ts's fullscreen, the card's ? */
const QUIET = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'ContextMenu', 'f', 'F', '?']);

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
  // the play button begins in the page (on one screen); an online duel opens its room through the veil; online and solo
  // dances keep the menu's own way, by address
  root.querySelector('.jg-go')?.addEventListener('click', (e) => {
    const p = pick(root);
    const pe = e as PointerEvent;
    const dev: Device = pe.pointerType === 'touch' || pe.pointerType === 'pen' ? { device: 'touch', id: pe.pointerId, x: pe.clientX, y: pe.clientY } : { device: 'mouse' };
    if (p.game === 'duel' && p.mode === 'online') { e.stopImmediatePropagation(); void leave(duelAddress(root)); return; }
    if (p.mode !== 'same' && p.mode !== 'partner') return;
    e.stopImmediatePropagation();
    // the click that pressed play joins seat 1 (it had joined nobody: the jogo sat in its lobby, waiting for a key)
    void begin(p, dev);
  }, { capture: true });
  // (the duel's join button, with a friend's code, opens it the same way)
  root.querySelector('.jg-duelnet .jg-join')?.addEventListener('click', (e) => {
    const v = root.querySelector<HTMLInputElement>('.jg-duelnet .jg-code')?.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
    if (v.length < 3) return;
    e.stopImmediatePropagation();
    void leave(duelAddress(root, v));
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
  /** what a press away from the strip begins: the chosen game in the chosen way on one screen (an online duel needs
   *  its button: a stray key never opens a room) */
  const pressed = (): Pick | null => {
    const p = pick(root);
    if (p.game === 'duel') return p.mode === 'online' ? null : p;
    return { game: 'dance', mode: p.mode === 'same' ? 'same' : 'partner' };
  };
  addEventListener('keydown', (e) => {
    if (begun || e.repeat || e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea, .dh')) return;
    if (e.key === '?') { e.preventDefault(); void import('../../duel/help').then((m) => m.toggleHelp(m.guessDev(), pick(root).game === 'duel' ? show.dress.slice(0, 2) : [])); return; }
    if (QUIET.has(e.key)) return;
    const inMenu = !!(e.target as HTMLElement)?.closest?.('.jg-front');
    // (in the strip the arrows walk it: menu.ts; away from it they are the right half of the keyboard and begin)
    if (inMenu && ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { wakeStrip(); return; }
    const p = pressed();
    if (!p) { wakeStrip(); return; }
    // (space would also shatter the show: main.ts's key; the game is beginning instead)
    e.preventDefault();
    e.stopImmediatePropagation();
    void begin(p, e.key === ' ' ? { device: 'mouse' } : { device: 'keyboard', code: e.code });
  }, { capture: true });
  // a tap on the dancers (a drag still turns the camera and plays with the matter)
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; wakeStrip(); });
  canvas.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (begun || !d || performance.now() - d.t > 300 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    const p = pressed();
    if (!p) return;
    void begin(p, e.pointerType === 'mouse' ? { device: 'mouse' } : { device: 'touch', id: e.pointerId, x: e.clientX, y: e.clientY });
  });

  // a gamepad: the d-pad or the left stick walks the strip, A presses what is focused (play or nothing focused: begins),
  // Start begins, any other button begins as before; and the strip's rest, counted on the same clock
  let last = performance.now();
  const held = new Map<number, Set<string>>();
  const tick = (now: number) => {
    const dt = (now - last) / 1000; last = now;
    if (begun) return;
    rest += dt;
    if (rest > IDLE_S && !root.matches(':hover, :focus-within')) root.classList.add('idle');
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const was = held.get(pad.index) ?? new Set<string>(), is = new Set<string>();
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (b(12) || ay < -0.6) is.add('up'); if (b(13) || ay > 0.6) is.add('down');
      if (b(14) || ax < -0.6) is.add('left'); if (b(15) || ax > 0.6) is.add('right');
      pad.buttons.forEach((x, i) => { if (x?.pressed && (i < 12 || i > 15)) is.add(`b${i}`); });
      held.set(pad.index, is);
      const took = (k: string) => is.has(k) && !was.has(k);
      const dir = took('left') ? [-1, 0] : took('right') ? [1, 0] : took('up') ? [0, -1] : took('down') ? [0, 1] : null;
      if (dir) { wakeStrip(); moveFocus(root, dir[0], dir[1]); continue; }
      if (![...is].some((k) => k.startsWith('b') && !was.has(k))) continue;
      const focus = document.activeElement as HTMLElement | null;
      const inStrip = !!focus && root.contains(focus) && focus !== root, onGo = inStrip && focus!.classList.contains('jg-go');
      // walking the strip: A presses the focused button, other buttons wait for A on play or Start
      if (inStrip && !onGo && took('b0')) { wakeStrip(); if (focus instanceof HTMLInputElement) focus.select(); else focus!.click(); continue; }
      if (inStrip && !onGo && !took('b9')) { wakeStrip(); continue; }
      const p = pick(root);
      if (p.game === 'duel' && p.mode === 'online') { if (onGo || took('b9')) { void leave(duelAddress(root)); return; } wakeStrip(); continue; }
      const go = pressed();
      if (go) { void begin(go, { device: 'gamepad', index: pad.index }); return; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // a phone shows the gates' stills while the front is up (one live gate is the game's, not the menu's)
  if (deviceClass() === 'phone') setParams('gates', { live: 0 });

  // ---------------------------------------------------------------- the game, in this page
  async function begin(p: Pick, device: Device) {
    if (begun) return;
    begun = true;
    root.classList.add('dim');
    document.body.classList.add('playing');
    ring(bend);
    if (deviceClass() === 'phone') setParams('gates', { live: budget().gates.live });
    const world = root.querySelector<HTMLElement>('.jg-world.on')?.dataset.world ?? 'geode';
    const lock = !!root.querySelector('.jg-lock.on');
    const duel = p.game === 'duel';
    const q = duel
      ? new URLSearchParams({ duel: '', world, dress: show.dress.slice(0, 2).join(','), p1: 'human', p2: p.mode === 'same' ? 'human' : 'bot' })
      : new URLSearchParams({ jogo: p.mode, world, dress: show.dress.slice(0, 2).join(',') });
    if (duel ? lock : !lock) q.set(duel ? 'lock' : 'free', '');
    const href = `${location.pathname}?${q.toString().replace(/=(?=&|$)/g, '')}`;
    // another world than the one on screen: a short veil, so the new game's first frames aren't the old stage's
    const here = typeof bend.world === 'function' ? await bend.world() : world;
    const veil = world !== here ? await veilOn() : null;
    try {
      if (typeof bend.front?.begin !== 'function') { location.assign(href); return; }
      // (the duel reads its address as it starts: dancer/play.ts gives its bodies the duel's profile and its devices the
      // duel's buttons from it)
      if (duel) history.replaceState(null, '', href);
      const api = await bend.front.begin(duel ? 'duel' : p.mode, q, device ?? undefined);
      if (!api) { location.assign(href); return; }
      history.replaceState(null, '', href);
      if (!duel) teach(api);
      if (veil) { await frames(3); veilOff(veil); }
    } catch (err) {
      console.warn('front: the game could not begin in the page; opening its address', err);
      location.assign(href);
    }
  }
  /** an address of another page (an online duel): the veil, then the page */
  async function leave(href: string) {
    begun = true;
    root.classList.add('dim');
    await veilOn();
    location.assign(href);
  }
}

/** the duel's online address from the strip (its room, or a friend's code) */
function duelAddress(root: HTMLElement, room?: string) {
  const world = root.querySelector<HTMLElement>('.jg-world.on')?.dataset.world ?? 'geode';
  const dress = [0, 1].map((s) => root.querySelector<HTMLElement>(`.jg-swatch.on[data-seat="${s}"]`)?.dataset.name ?? (s ? 'water' : 'fire'));
  const q = new URLSearchParams(location.search), out = new URLSearchParams({ duel: '', net: room ?? root.querySelector('.jg-room')?.textContent ?? 'FERN42', world, dress: dress.join(',') });
  if (root.querySelector('.jg-lock.on')) out.set('lock', '');
  for (const k of ['server', 'lag', 'jitter', 'loss', 'debug', 'panel']) if (q.has(k)) out.set(k, q.get(k)!);
  return `${location.pathname}?${out.toString().replace(/=(?=&|$)/g, '')}`;
}

/** the veil: a dark fade over the stage while the game changes world (index.html `.jg-veil`) */
async function veilOn() {
  const v = document.createElement('div');
  v.className = 'jg-veil';
  document.body.append(v);
  await frames(1);
  v.classList.add('on');
  await new Promise((r) => setTimeout(r, VEIL_MS));
  return v;
}
function veilOff(v: HTMLElement) { v.classList.remove('on'); setTimeout(() => v.remove(), 900); }
const frames = (n: number) => new Promise<void>((ok) => { const f = () => (--n <= 0 ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); });

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

/** the game and the way chosen on the strip */
const pick = (root: HTMLElement): Pick => ({
  game: root.querySelector<HTMLElement>('.jg-game.on')?.dataset.game === 'duel' ? 'duel' : 'dance',
  mode: root.querySelector<HTMLElement>('.jg-mode.on')?.dataset.mode ?? 'same',
});

function until<T>(get: () => T | null | undefined): Promise<T> {
  return new Promise((ok) => { const look = () => { const v = get(); if (v) ok(v); else requestAnimationFrame(look); }; look(); });
}

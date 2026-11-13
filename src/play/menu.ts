// The front of the game and the jogo's few screens, in the page (DOM over the canvas; styles in index.html under
// "jogo"). No marketing copy: icons, device glyphs and short labels only, and nothing at all during play (the meters
// are in the world, hud.ts).
//
//   the front     how to play (together on one screen, with a partner, online, solo), where to start (the geode hub
//                 by default: its gates are the level select), what each dancer wears (the presets, as swatches that
//                 move), the side view on or off, and go. Choosing writes the choice into the page's address and opens
//                 it (?jogo=same|partner|online&world=…&dress=…&free), so a jogo is always a link
//   online        make a room (its code and a link to share) or join one by code; or watch (a free dancer, a guest)
//   the lobby     before a jogo on one screen: a card per dancer saying which device plays it, waiting for a press
//   waiting       online, until the other seat comes: the room's code and link
// Esc goes back to the front from anywhere.
import { PRESETS } from '../matter/core/presets';

export type Mode = 'same' | 'partner' | 'online' | 'solo';
export interface Choice { mode: Mode; world: string; dress: [string, string]; lock: boolean; room?: string; create?: boolean; watch?: boolean }

const WORLDS: [string, string][] = [['geode', '#8a5cff'], ['pool', '#5fb6ff'], ['temple', '#38c7b0'], ['forge', '#ff8a3c'], ['redwoods', '#7fb85a']];
/** each preset's two colours (the swatch's living gradient) */
const SWATCH: Record<string, [string, string]> = {
  fire: ['#ff5a14', '#ffd27a'], water: ['#1c6cff', '#7fe0ff'], ice: ['#a8dcff', '#ffffff'], plasma: ['#8a2cff', '#ff7af0'],
  gems: ['#7a4cff', '#4ce0ff'], ember: ['#c0306a', '#ff9a3c'], tide: ['#1c8cff', '#d8f4ff'], gemwater: ['#5a4cff', '#4cb8ff'],
  geodeheart: ['#ff7a2c', '#c08cff'], 'geodeheart-water': ['#4c8cff', '#c08cff'],
};

const svg = (body: string, vb = '0 0 48 48') => `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const figure = (x: number, s = 1) => `<g transform="translate(${x} 0) scale(${s})"><circle cx="0" cy="11" r="4"/><path d="M0 15v13M0 28l-6 11M0 28l6 11M-8 21l8-3 8 3"/></g>`;
export const GLYPHS = {
  same: svg(`${figure(15)}${figure(33)}<path d="M8 44h32" />`),
  partner: svg(`${figure(14)}<g transform="translate(33 0)"><path d="M0 7l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M0 24v6M-6 33l6-3 6 3M0 30l-5 9M0 30l5 9"/></g>`),
  online: svg(`${figure(13)}<circle cx="34" cy="22" r="9"/><path d="M25 22h18M34 13c-4 5-4 13 0 18M34 13c4 5 4 13 0 18"/>`),
  solo: svg(`${figure(24, 1.1)}`),
  lock: svg(`<rect x="6" y="12" width="36" height="24" rx="3"/><path d="M14 30l6-8 5 5 4-4 6 7"/>`),
  free: svg(`<path d="M24 6l16 9v18l-16 9-16-9V15z"/><path d="M8 15l16 9 16-9M24 24v18"/>`),
  go: svg(`<path d="M17 11l20 13-20 13z" fill="currentColor"/>`),
  back: svg(`<path d="M30 10L16 24l14 14"/>`),
  keyboard: svg(`<rect x="4" y="13" width="40" height="22" rx="3"/><path d="M10 20h2M16 20h2M22 20h2M28 20h2M34 20h4M10 26h2M16 26h16M36 26h2"/>`),
  gamepad: svg(`<path d="M14 16h20a8 8 0 0 1 8 8l2 9a4 4 0 0 1-7 3l-5-5H16l-5 5a4 4 0 0 1-7-3l2-9a8 8 0 0 1 8-8z"/><path d="M14 22v6M11 25h6"/><circle cx="32" cy="23" r="1.4"/><circle cx="36" cy="27" r="1.4"/>`),
  touch: svg(`<path d="M20 22V10a3 3 0 0 1 6 0v12M26 18a3 3 0 0 1 6 0v4M32 21a3 3 0 0 1 6 0v8c0 7-5 13-12 13h-2c-5 0-8-3-10-7l-5-9a3 3 0 0 1 5-3l2 3"/>`),
  camera: svg(`<rect x="6" y="14" width="28" height="20" rx="3"/><path d="M34 21l9-5v16l-9-5z"/>`),
  press: svg(`<circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="16" opacity="0.4"/>`),
  link: svg(`<path d="M20 28l8-8M17 22l-4 4a6 6 0 0 0 9 9l4-4M31 26l4-4a6 6 0 0 0-9-9l-4 4"/>`),
  watch: svg(`<path d="M4 24s7-12 20-12 20 12 20 12-7 12-20 12S4 24 4 24z"/><circle cx="24" cy="24" r="5"/>`),
};
const DEVICE_GLYPH: Record<string, string> = { keyboard: GLYPHS.keyboard, gamepad: GLYPHS.gamepad, touch: GLYPHS.touch, camera: GLYPHS.camera, bot: GLYPHS.partner };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = '', attrs: Record<string, string> = {}) {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const button = (cls: string, html: string, label: string, on: () => void) => {
  const b = el('button', `jg-btn ${cls}`, html + (label ? `<span>${label}</span>` : ''), { type: 'button', 'aria-label': label || cls });
  b.addEventListener('click', (e) => { e.stopPropagation(); on(); });
  return b;
};

/** the address of a choice (the jogo opens from it) */
export function hrefOf(c: Choice, base = location.pathname, keep: URLSearchParams = new URLSearchParams()) {
  const q = new URLSearchParams();
  for (const k of ['server', 'lag', 'jitter', 'loss', 'debug', 'panel']) if (keep.has(k)) q.set(k, keep.get(k)!);
  if (c.mode === 'solo') { q.set('play', ''); q.set('world', c.world); q.set('dress', c.dress[0]); }
  else {
    q.set('jogo', c.mode);
    q.set('world', c.world);
    q.set('dress', c.dress.join(','));
    if (!c.lock) q.set('free', '');
    if (c.mode === 'online') { if (c.room) q.set('room', c.room); if (c.create) q.set('create', ''); if (c.watch) q.set('watch', ''); }
  }
  return `${base}?${q.toString().replace(/=(?=&|$)/g, '')}`;
}

/** a fresh room code: four letters a person can read out (no I, O) */
export function roomCode(r: () => number = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(r() * A.length)];
  return s;
}

/** the front of the game: returns its root (removed when a choice is made) */
export function showFront(query: URLSearchParams, open: (href: string) => void = (h) => location.assign(h)): HTMLElement {
  const c: Choice = { mode: 'same', world: query.get('world') ?? 'geode', dress: ['fire', 'water'], lock: !query.has('free') };
  const root = el('div', 'jg jg-front');
  const go = () => open(hrefOf(c, location.pathname, query));

  const modes = el('div', 'jg-row jg-modes');
  const modeBtns: Record<string, HTMLButtonElement> = {};
  for (const [m, label] of [['same', 'together'], ['partner', 'partner'], ['online', 'online'], ['solo', 'solo']] as [Mode, string][]) {
    modeBtns[m] = button('jg-mode', GLYPHS[m], label, () => { c.mode = m; paint(); });
    modes.append(modeBtns[m]);
  }
  const worlds = el('div', 'jg-row jg-worlds');
  const worldBtns: Record<string, HTMLButtonElement> = {};
  for (const [w, col] of WORLDS) {
    worldBtns[w] = button('jg-world', `<i style="--c:${col}"></i>`, w, () => { c.world = w; paint(); });
    worlds.append(worldBtns[w]);
  }
  const bodies = el('div', 'jg-bodies');
  const bodyBtns: HTMLButtonElement[][] = [[], []];
  const names = Object.keys(PRESETS).filter((n) => SWATCH[n]);
  for (let s = 0; s < 2; s++) {
    const row = el('div', 'jg-row jg-body', `<b class="jg-seat">${s + 1}</b>`);
    for (const n of names) {
      const [a, b] = SWATCH[n];
      const btn = button('jg-swatch', `<i style="--a:${a};--b:${b}"></i>`, n, () => { c.dress[s] = n; paint(); });
      bodyBtns[s].push(btn);
      row.append(btn);
    }
    bodies.append(row);
  }
  const online = el('div', 'jg-row jg-online');
  const code = el('input', 'jg-code', '', { maxlength: '8', placeholder: '····', 'aria-label': 'room', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
  online.append(
    button('jg-make', GLYPHS.link, 'new room', () => { c.room = roomCode(); c.create = true; c.watch = false; go(); }),
    code,
    button('jg-join', GLYPHS.go, 'join', () => { const v = code.value.trim().toUpperCase(); if (v) { c.room = v; c.create = false; c.watch = false; go(); } }),
    button('jg-watch', GLYPHS.watch, 'watch', () => { const v = code.value.trim().toUpperCase(); if (v) { c.room = v; c.create = false; c.watch = true; go(); } }),
  );
  const foot = el('div', 'jg-row jg-foot');
  const lockBtn = button('jg-lock', GLYPHS.lock, 'side', () => { c.lock = !c.lock; paint(); });
  const goBtn = button('jg-go', GLYPHS.go, '', go);
  foot.append(lockBtn, goBtn);
  root.append(modes, worlds, bodies, online, foot);

  function paint() {
    for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle('on', m === c.mode);
    for (const [w, b] of Object.entries(worldBtns)) b.classList.toggle('on', w === c.world);
    for (let s = 0; s < 2; s++) bodyBtns[s].forEach((b, i) => b.classList.toggle('on', names[i] === c.dress[s]));
    bodies.classList.toggle('one', c.mode === 'solo');
    online.hidden = c.mode !== 'online';
    goBtn.hidden = c.mode === 'online';
    lockBtn.classList.toggle('on', c.lock);
    lockBtn.innerHTML = (c.lock ? GLYPHS.lock : GLYPHS.free) + `<span>${c.lock ? 'side' : '3d'}</span>`;
  }
  paint();
  document.body.append(root);
  // a gamepad or the keys move round it too: Enter goes
  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && c.mode !== 'online') go(); });
  return root;
}

/** the lobby before a jogo on one screen: which device plays which dancer */
export class Lobby {
  readonly root: HTMLElement;
  private cards: HTMLElement[] = [];
  constructor(partner: boolean) {
    this.root = el('div', 'jg jg-lobby');
    for (let s = 0; s < 2; s++) {
      const card = el('div', 'jg-card', `<b class="jg-seat">${s + 1}</b><div class="jg-dev">${s === 1 && partner ? GLYPHS.partner : GLYPHS.press}</div>`);
      this.cards.push(card);
      this.root.append(card);
    }
    document.body.append(this.root);
  }
  /** a seat's device: keyboard, gamepad, touch, camera, bot (the partner), or null (waiting for a press) */
  seat(s: number, device: string | null) {
    const c = this.cards[s];
    if (!c) return;
    c.querySelector('.jg-dev')!.innerHTML = device ? DEVICE_GLYPH[device] ?? GLYPHS.press : GLYPHS.press;
    c.classList.toggle('on', !!device);
  }
  hide() { this.root.classList.add('gone'); setTimeout(() => this.root.remove(), 600); }
}

/** online, until the other seat comes: the room's code and its link */
export class Waiting {
  readonly root: HTMLElement;
  constructor(room: string, href: string) {
    this.root = el('div', 'jg jg-waiting');
    const link = button('jg-share', GLYPHS.link, room, () => { void navigator.clipboard?.writeText(href).catch(() => {}); link.classList.add('on'); });
    this.root.append(el('div', 'jg-dev', GLYPHS.press), link);
    document.body.append(this.root);
  }
  set visible(v: boolean) { this.root.classList.toggle('gone', !v); }
  remove() { this.root.remove(); }
}

/** Esc: back to the front */
export function escapeToFront() {
  addEventListener('keydown', (e) => { if (e.key === 'Escape') location.assign(location.pathname); });
}

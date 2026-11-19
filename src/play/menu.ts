// The front of the game and the jogo's few screens, in the page (DOM over the canvas; styles in index.html under
// "jogo": the skin's honey glass in gold leading, docs/design/solarpunk.md). No marketing copy: icons, device glyphs and
// short labels only, and nothing at all during play (the meters are in the world, hud.ts).
//
//   the front     which game: the dance (the jogo) or the duel (the dance battle, src/duel); how to play it (together
//                 on one screen, with a partner, online; the dance also solo), where (the geode hub by default: its
//                 gates are the level select), what each dancer wears (the presets, as swatches that move), 3D (the
//                 default: free to walk to the mirrors) or the side view (kept per game), the controls card (?), and
//                 go. Choosing writes the choice into the page's address
//                 (?jogo=same|partner|online&world=…&dress=…[&lock]; ?duel&world=…&dress=…&p1=human&p2=bot|human[&lock];
//                 ?duel&net=ROOM&…), so a game is always a link; the hub's front (worlds/geode/front.ts) begins it in
//                 the page where it can
//   online        the dance: make a room (its code and a link to share) or join one by code; or watch (a free dancer, a
//                 guest). The duel: a room code made for you at once (a word and two digits, friendly to read out), its
//                 link with a copy button, go to open it; or a friend's code and join
//   the lobby     before a game on one screen: a card per dancer saying which device plays it, waiting for a press
//   waiting       online, until the other seat comes: the room's code and link
// The strip is walked with the arrow keys (or a gamepad's d-pad and stick: front.ts) as well as the pointer and Tab.
// Esc goes back to the front from anywhere in a jogo.
import { PRESETS, distinctDress, sameFamily, contrastOf } from '../matter/core/presets';
import { lastDress } from '../dancer/show';
import type { FrameBuilder } from '../engine/frame';
import type { InputHub, Player } from '../input/hub';
import type { TouchSource } from '../input/touch';
import { TouchPad } from '../input/touch-pad';
import type { Joined } from './index';

export type Mode = 'same' | 'partner' | 'online' | 'solo';
export type Game = 'dance' | 'duel';
export interface Choice { game?: Game; mode: Mode; world: string; dress: [string, string]; lock: boolean; room?: string; create?: boolean; watch?: boolean }

/** the worlds and their medallions' colours (the art bible's per-world light: the geode's amethyst, the water garden's
 *  clear blue, the temple's sunlit turquoise, the redwoods' moss) */
const WORLDS: [string, string][] = [['geode', '#a57cff'], ['pool', '#5ec0ea'], ['temple', '#45d2bd'], ['redwoods', '#8cc265']];
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
  // the dance: one dancer in the ginga, a turn round them; the duel: two leaping to catch each other, a spark between
  dance: svg(`${figure(18)}<path d="M28 39c7 0 13-6 13-14 0-6-4-11-9-12"/><path d="M29 10l3 3-4 2"/>`),
  duel: svg(`<circle cx="10" cy="13" r="4"/><path d="M11 17l4 11M15 28l-6 11M15 28l7 9M12 20l9-5"/><circle cx="38" cy="13" r="4"/><path d="M37 17l-4 11M33 28l6 11M33 28l-7 9M36 20l-9-5"/><path d="M24 3l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z"/>`),
  lock: svg(`<rect x="6" y="12" width="36" height="24" rx="3"/><path d="M14 30l6-8 5 5 4-4 6 7"/>`),
  free: svg(`<path d="M24 6l16 9v18l-16 9-16-9V15z"/><path d="M8 15l16 9 16-9M24 24v18"/>`),
  go: svg(`<path d="M17 11l20 13-20 13z" fill="currentColor"/>`),
  back: svg(`<path d="M30 10L16 24l14 14"/>`),
  help: svg(`<circle cx="24" cy="24" r="17"/><path d="M19 19.5a5 5 0 1 1 7 4.6c-1.4.7-2 1.6-2 3.2"/><circle cx="24" cy="33.5" r="1.4" fill="currentColor"/>`),
  copy: svg(`<rect x="15" y="15" width="22" height="24" rx="3"/><path d="M11 32V12a3 3 0 0 1 3-3h16"/>`),
  again: svg(`<path d="M37 18a14 14 0 1 0 1 10"/><path d="M38 9v9h-9"/>`),
  keyboard: svg(`<rect x="4" y="13" width="40" height="22" rx="3"/><path d="M10 20h2M16 20h2M22 20h2M28 20h2M34 20h4M10 26h2M16 26h16M36 26h2"/>`),
  gamepad: svg(`<path d="M14 16h20a8 8 0 0 1 8 8l2 9a4 4 0 0 1-7 3l-5-5H16l-5 5a4 4 0 0 1-7-3l2-9a8 8 0 0 1 8-8z"/><path d="M14 22v6M11 25h6"/><circle cx="32" cy="23" r="1.4"/><circle cx="36" cy="27" r="1.4"/>`),
  touch: svg(`<path d="M20 22V10a3 3 0 0 1 6 0v12M26 18a3 3 0 0 1 6 0v4M32 21a3 3 0 0 1 6 0v8c0 7-5 13-12 13h-2c-5 0-8-3-10-7l-5-9a3 3 0 0 1 5-3l2 3"/>`),
  camera: svg(`<rect x="6" y="14" width="28" height="20" rx="3"/><path d="M34 21l9-5v16l-9-5z"/>`),
  press: svg(`<circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="16" opacity="0.4"/>`),
  link: svg(`<path d="M20 28l8-8M17 22l-4 4a6 6 0 0 0 9 9l4-4M31 26l4-4a6 6 0 0 0-9-9l-4 4"/>`),
  watch: svg(`<path d="M4 24s7-12 20-12 20 12 20 12-7 12-20 12S4 24 4 24z"/><circle cx="24" cy="24" r="5"/>`),
};
/** play: a sun disc in a crown of sixteen petals (the art bible's emblem: docs/design/solarpunk.md), the play mark in
 *  deep honey on it. Filled, not stroked: it is the one solid, warm thing on the strip */
export function sunGlyph() {
  const n = 16, c = 24, r0 = 13.6, r1 = 23.2;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2, h = (Math.PI / n) * 0.66;
    const p = (r: number, t: number) => `${(c + Math.cos(t) * r).toFixed(2)} ${(c + Math.sin(t) * r).toFixed(2)}`;
    d += `M${p(r0, a - h)}Q${p(r1 * 0.97, a - h * 0.9)} ${p(r1, a)}Q${p(r1 * 0.97, a + h * 0.9)} ${p(r0, a + h)}Z`;
  }
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><radialGradient id="jg-sun" cx="0.42" cy="0.38" r="0.62"><stop offset="0" stop-color="#fffbe9"/><stop offset="0.45" stop-color="#ffd77e"/><stop offset="1" stop-color="#e09a3a"/></radialGradient>`
    + `<linearGradient id="jg-petal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c8"/><stop offset="1" stop-color="#e3a347"/></linearGradient></defs>`
    + `<path d="${d}" fill="url(#jg-petal)" stroke="#9b6a24" stroke-width="0.6" stroke-linejoin="round"/>`
    + `<circle cx="24" cy="24" r="14.2" fill="url(#jg-sun)" stroke="#a8742a" stroke-width="1.1"/><circle cx="24" cy="24" r="11.6" fill="none" stroke="#fff3d0" stroke-opacity="0.55" stroke-width="0.7"/>`
    + `<path d="M20.6 17.4l9.6 6.6-9.6 6.6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}
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

/** the debug and network keys an address keeps through the menu */
const KEEP = ['server', 'lag', 'jitter', 'loss', 'debug', 'panel'];
const bare = (q: URLSearchParams) => q.toString().replace(/=(?=&|$)/g, '');

/** the address of a choice (the game opens from it) */
export function hrefOf(c: Choice, base = location.pathname, keep: URLSearchParams = new URLSearchParams()) {
  if (c.game === 'duel') return duelHref(c, base, keep);
  const q = new URLSearchParams();
  for (const k of KEEP) if (keep.has(k)) q.set(k, keep.get(k)!);
  if (c.mode === 'solo') { q.set('play', ''); q.set('world', c.world); q.set('dress', c.dress[0]); }
  else {
    q.set('jogo', c.mode);
    q.set('world', c.world);
    q.set('dress', distinctDress(c.dress).join(','));
    if (c.lock) q.set('lock', '');
    if (c.mode === 'online') { if (c.room) q.set('room', c.room); if (c.create) q.set('create', ''); if (c.watch) q.set('watch', ''); }
  }
  return `${base}?${bare(q)}`;
}

/** the duel's address (src/duel/index.ts): two on one screen (p2 human), against a virtual partner (p2 bot), or online
 *  (&net=ROOM, the room server's; &server= kept). Free in 3D unless &lock (the duel's own default is free) */
export function duelHref(c: Choice, base = location.pathname, keep: URLSearchParams = new URLSearchParams()) {
  const q = new URLSearchParams();
  q.set('duel', '');
  if (c.mode === 'online') q.set('net', c.room || roomName());
  q.set('world', c.world);
  q.set('dress', distinctDress(c.dress).join(','));
  if (c.mode !== 'online') { q.set('p1', 'human'); q.set('p2', c.mode === 'same' ? 'human' : 'bot'); }
  if (c.lock) q.set('lock', '');
  for (const k of KEEP) if (keep.has(k)) q.set(k, keep.get(k)!);
  return `${base}?${bare(q)}`;
}

/** a fresh room code: four letters a person can read out (no I, O) */
export function roomCode(r: () => number = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(r() * A.length)];
  return s;
}
/** a friendlier room code: a word of the worlds and two digits (FERN42, TIDE17), easy to say to a friend; the room
 *  server takes 3 to 8 letters and digits */
const WORDS = ['FERN', 'MOSS', 'TIDE', 'LEAF', 'DAWN', 'GLOW', 'REED', 'PINE', 'SAGE', 'WAVE', 'RAIN', 'MIST', 'OPAL', 'JADE', 'LARK', 'WREN', 'DOVE', 'DUSK', 'CALM', 'BLOOM', 'CORAL', 'RIVER', 'STONE', 'EMBER', 'PEARL', 'CEDAR', 'OAK', 'SKY'];
export function roomName(r: () => number = Math.random) {
  return WORDS[Math.floor(r() * WORDS.length)] + String(10 + Math.floor(r() * 90));
}

/** what the front's buttons say they are (data- attributes: data-game, data-mode, data-world, data-seat and data-name),
 *  and the callback told of every choice as it is made (the hub's front re-dresses the dancers, turns to a gate) */
export type FrontChoice = { kind: 'game'; value: Game } | { kind: 'mode'; value: Mode } | { kind: 'world'; value: string } | { kind: 'body'; seat: number; value: string } | { kind: 'lock'; value: boolean };

const GAME_KEY = 'energybending.front.game';
const keptGame = (): Game => { try { return localStorage.getItem(GAME_KEY) === 'duel' ? 'duel' : 'dance'; } catch { return 'dance'; } };
const keepGame = (g: Game) => { try { localStorage.setItem(GAME_KEY, g); } catch { /* no storage */ } };
/** the view each game was last played in, by the "side" button (true: the side view). A new key (report 20-roam): the
 *  dance used to start in the side view, and nothing kept from then may keep it there; both games open in 3D */
const VIEW_KEY = 'energybending.front.side.v2';
export const keptSide = (): Record<Game, boolean> => {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'); return { dance: v?.dance === true, duel: v?.duel === true }; } catch { return { dance: false, duel: false }; }
};
const keepSide = (v: Record<Game, boolean>) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* no storage */ } };

/** the front of the game: returns its root (removed when a choice is made). It starts from the bodies last chosen
 *  (dancer/show.ts lastDress: what the show's dancers already wear) and the game last chosen */
export function showFront(query: URLSearchParams, open: (href: string) => void = (h) => location.assign(h), onChoose?: (c: FrontChoice) => void): HTMLElement {
  // (a world the game doesn't have, like the retired forge's ?world=forge, opens on the hub)
  const asked = query.get('world'), world = WORLDS.some(([w]) => w === asked) ? asked! : 'geode';
  const game = keptGame();
  // both games open in 3D, free to roam to the mirrors (report 20-roam); the side view is the "side" button's (kept
  // per game) or the address's &lock (&free in the address always opens 3D)
  const kept = keptSide();
  const sideOf = (g: Game) => (query.has('free') ? false : query.has('lock') ? true : kept[g]);
  const lockOf: Record<Game, boolean> = { dance: sideOf('dance'), duel: sideOf('duel') };
  const modeOf: Record<Game, Mode> = { dance: 'partner', duel: 'partner' };
  const c: Choice = { game, mode: modeOf[game], world, dress: lastDress(), lock: lockOf[game] };
  const root = el('div', 'jg jg-front');
  root.dataset.game = game;
  const go = () => open(hrefOf(c, location.pathname, query));

  const games = el('div', 'jg-row jg-games');
  const gameBtns: Record<string, HTMLButtonElement> = {};
  for (const [g, label] of [['dance', 'dance'], ['duel', 'duel']] as [Game, string][]) {
    gameBtns[g] = button('jg-game', GLYPHS[g], label, () => {
      if (c.game === g) return;
      modeOf[c.game!] = c.mode; lockOf[c.game!] = c.lock;
      c.game = g; c.mode = modeOf[g]; c.lock = lockOf[g];
      if (g === 'duel' && c.mode === 'solo') c.mode = 'partner';
      if (g === 'duel' && c.mode === 'online' && !c.room) c.room = roomName();
      keepGame(g); paint(); onChoose?.({ kind: 'game', value: g });
    });
    gameBtns[g].dataset.game = g;
    games.append(gameBtns[g]);
  }
  const modes = el('div', 'jg-row jg-modes');
  const modeBtns: Record<string, HTMLButtonElement> = {};
  for (const [m, label] of [['same', 'together'], ['partner', 'partner'], ['online', 'online'], ['solo', 'solo']] as [Mode, string][]) {
    modeBtns[m] = button('jg-mode', GLYPHS[m], label, () => {
      c.mode = m;
      if (c.game === 'duel' && m === 'online' && !c.room) c.room = roomName();
      paint(); onChoose?.({ kind: 'mode', value: m });
    });
    modeBtns[m].dataset.mode = m;
    modes.append(modeBtns[m]);
  }
  const worlds = el('div', 'jg-row jg-worlds');
  const worldBtns: Record<string, HTMLButtonElement> = {};
  for (const [w, col] of WORLDS) {
    worldBtns[w] = button('jg-world', `<i style="--c:${col}"></i>`, w, () => { c.world = w; paint(); onChoose?.({ kind: 'world', value: w }); });
    worldBtns[w].dataset.world = w;
    worlds.append(worldBtns[w]);
  }
  const bodies = el('div', 'jg-bodies');
  const bodyBtns: HTMLButtonElement[][] = [[], []];
  const names = Object.keys(PRESETS).filter((n) => SWATCH[n]);
  for (let s = 0; s < 2; s++) {
    const row = el('div', 'jg-row jg-body', `<b class="jg-seat">${s + 1}</b>`);
    for (const n of names) {
      const [a, b] = SWATCH[n];
      const btn = button('jg-swatch', `<i style="--a:${a};--b:${b}"></i>`, n, () => {
        c.dress[s] = n;
        // (the other seat never wears the same family of colour: it turns to this body's contrast)
        const o = 1 - s;
        if (sameFamily(n, c.dress[o])) { c.dress[o] = contrastOf(n); onChoose?.({ kind: 'body', seat: o, value: c.dress[o] }); }
        paint(); onChoose?.({ kind: 'body', seat: s, value: n });
      });
      btn.dataset.seat = String(s); btn.dataset.name = n;
      bodyBtns[s].push(btn);
      row.append(btn);
    }
    bodies.append(row);
  }
  // the dance online: make a room (opens it), join or watch one by code
  const online = el('div', 'jg-row jg-online');
  const code = el('input', 'jg-code', '', { maxlength: '8', placeholder: '····', 'aria-label': 'room', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
  online.append(
    button('jg-make', GLYPHS.link, 'new room', () => { c.room = roomCode(); c.create = true; c.watch = false; go(); }),
    code,
    button('jg-join', GLYPHS.go, 'join', () => { const v = code.value.trim().toUpperCase(); if (v) { c.room = v; c.create = false; c.watch = false; go(); } }),
    button('jg-watch', GLYPHS.watch, 'watch', () => { const v = code.value.trim().toUpperCase(); if (v) { c.room = v; c.create = false; c.watch = true; go(); } }),
  );
  // the duel online: a room made for you (its code, a new one, its link and a copy button; go opens it), or a friend's
  const net = el('div', 'jg-row jg-duelnet');
  const room = el('b', 'jg-room');
  const url = el('span', 'jg-url');
  const linkOf = () => `${location.origin}${duelHref({ ...c, mode: 'online' }, location.pathname, query)}`;
  const copyBtn = button('jg-copy', GLYPHS.copy, 'copy link', () => {
    const href = linkOf();
    const done = () => { copyBtn.classList.add('on'); copyBtn.querySelector('span')!.textContent = 'copied'; setTimeout(() => { copyBtn.classList.remove('on'); copyBtn.querySelector('span')!.textContent = 'copy link'; }, 1800); };
    const fallback = () => { const t = el('textarea', 'jg-clip') as HTMLTextAreaElement; t.value = href; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch { /* none */ } t.remove(); done(); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(href).then(done, fallback); else fallback();
  });
  const friend = el('input', 'jg-code', '', { maxlength: '8', placeholder: 'code', 'aria-label': "a friend's room", autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
  net.append(
    room,
    button('jg-again', GLYPHS.again, 'new code', () => { c.room = roomName(); paint(); }),
    url, copyBtn, friend,
    button('jg-join', GLYPHS.go, 'join', () => { const v = friend.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (v.length >= 3) { c.room = v; go(); } }),
  );
  friend.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); net.querySelector<HTMLButtonElement>('.jg-join')!.click(); } });
  const foot = el('div', 'jg-row jg-foot');
  const helpBtn = button('jg-help', GLYPHS.help, 'how to play', () => {
    void import('../duel/help').then((m) => m.toggleHelp(m.guessDev(), c.game === 'duel' ? c.dress : [], undefined, { game: c.game ?? 'dance', allowModeSwitch: true }));
  });
  const lockBtn = button('jg-lock', GLYPHS.free, '3D', () => {
    c.lock = !c.lock; kept[c.game ?? 'dance'] = c.lock; keepSide(kept);
    paint(); onChoose?.({ kind: 'lock', value: c.lock });
  });
  const goBtn = button('jg-go', sunGlyph(), '', go);
  goBtn.setAttribute('aria-label', 'play');
  foot.append(helpBtn, lockBtn, goBtn);
  root.append(games, modes, worlds, bodies, online, net, foot);

  function paint() {
    const duel = c.game === 'duel';
    root.dataset.game = c.game;
    for (const [g, b] of Object.entries(gameBtns)) b.classList.toggle('on', g === c.game);
    for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle('on', m === c.mode);
    modeBtns.solo.hidden = duel;
    for (const [w, b] of Object.entries(worldBtns)) b.classList.toggle('on', w === c.world);
    for (let s = 0; s < 2; s++) bodyBtns[s].forEach((b, i) => b.classList.toggle('on', names[i] === c.dress[s]));
    bodies.classList.toggle('one', c.mode === 'solo');
    online.hidden = duel || c.mode !== 'online';
    net.hidden = !duel || c.mode !== 'online';
    if (duel && c.mode === 'online') {
      room.textContent = c.room ?? '';
      const href = linkOf();
      url.textContent = href.replace(/^https?:\/\//, '').replace(/\?.*$/, '') + `?duel&net=${c.room}`;
      url.title = href;
    }
    goBtn.hidden = !duel && c.mode === 'online';
    goBtn.setAttribute('aria-label', duel ? (c.mode === 'online' ? 'open the room' : 'play the duel') : 'play the dance');
    lockBtn.classList.toggle('on', c.lock);
    // (what the view is now, and what pressing it does: 3D roams to the mirrors; the side view is the 2D stage)
    lockBtn.innerHTML = (c.lock ? GLYPHS.lock : GLYPHS.free) + `<span>${c.lock ? 'side view' : '3D'}</span>`;
    const what = c.lock ? 'the side view, a 2D stage: press for 3D, free to walk to the mirrors' : '3D, free to walk to the mirrors: press for the side view';
    lockBtn.setAttribute('aria-label', `view: ${what}`);
    lockBtn.title = `view: ${what}`;
  }
  paint();
  document.body.append(root);
  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input')) return;
    // the arrow keys walk the strip (a button pointed at shows its label); Enter on the strip (not on another button,
    // which Enter presses) goes
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (dir) { e.preventDefault(); moveFocus(root, dir[0], dir[1]); return; }
    if (e.key === 'Enter' && (t === root || t === goBtn) && !(c.game !== 'duel' && c.mode === 'online')) { e.preventDefault(); go(); }
  });
  return root;
}

/** move the focus within `root` to the nearest visible button (or input) in a direction (dx, dy: -1, 0, 1), the way a
 *  d-pad walks a menu; nothing focused yet: the chosen game's button, else the first */
export function moveFocus(root: HTMLElement, dx: number, dy: number) {
  const all = [...root.querySelectorAll<HTMLElement>('button, input')].filter((b) => !b.closest('[hidden]') && b.offsetParent !== null);
  if (!all.length) return null;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !root.contains(cur) || cur === root) { const f = root.querySelector<HTMLElement>('.jg-go:not([hidden])') ?? all[0]; f.focus(); return f; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, bestD = Infinity;
  for (const b of all) {
    if (b === cur) continue;
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2 - ax, y = r.top + r.height / 2 - ay;
    const along = x * dx + y * dy, across = Math.abs(x * dy - y * dx);
    if (along <= 2) continue;
    const d = along + across * 2.2;
    if (d < bestD) { bestD = d; best = b; }
  }
  best?.focus();
  return best;
}

/** the lobby before a jogo (or a duel) on one screen: which device plays which dancer. A seat still waiting says how
 *  to join it (a key, a click or a tap; a gamepad's button) and is itself a button: a click or a tap on it joins that
 *  seat. `hint` words a waiting seat's way to join; `alt` adds a small second button to a waiting seat (the duel's
 *  "or a partner": a virtual player takes a seat nobody came for) */
export class Lobby {
  readonly root: HTMLElement;
  private cards: HTMLElement[] = [];
  private hints: string[] = [];
  constructor(partner: boolean, onPick?: (seat: number, e: PointerEvent) => void, opts: { hint?: (seat: number) => string; alt?: { seat: number; label: string; on: () => void } } = {}) {
    this.root = el('div', 'jg jg-lobby');
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    for (let s = 0; s < 2; s++) {
      this.hints[s] = opts.hint?.(s) ?? (touch ? 'tap to join' : 'press a key or click');
      const card = el('div', 'jg-card', `<b class="jg-seat">${s + 1}</b><div class="jg-dev">${s === 1 && partner ? GLYPHS.partner : GLYPHS.press}</div><span class="jg-hint">${this.hints[s]}</span>`,
        { role: 'button', tabindex: '0', 'aria-label': `player ${s + 1}: join` });
      card.addEventListener('pointerdown', (e) => { if (!card.classList.contains('on')) { e.stopPropagation(); onPick?.(s, e); } });
      if (opts.alt?.seat === s) {
        const a = opts.alt;
        const alt = el('button', 'jg-alt', `${GLYPHS.partner}<span>${a.label}</span>`, { type: 'button', 'aria-label': a.label });
        alt.addEventListener('pointerdown', (e) => e.stopPropagation());
        alt.addEventListener('click', (e) => { e.stopPropagation(); a.on(); });
        card.append(alt);
      }
      this.cards.push(card);
      this.root.append(card);
    }
    document.body.append(this.root);
  }
  /** a seat's device: keyboard (or keyboard-solo|left|right: which half), gamepad (gamepad-N), touch, camera, bot (the
   *  partner), or null (waiting for a press) */
  seat(s: number, device: string | null) {
    const c = this.cards[s];
    if (!c) return;
    const kind = device?.replace(/-.*/, '') ?? null;
    c.querySelector('.jg-dev')!.innerHTML = kind ? DEVICE_GLYPH[kind] ?? GLYPHS.press : GLYPHS.press;
    const hint = c.querySelector<HTMLElement>('.jg-hint');
    const half = device === 'keyboard-left' ? 'keyboard · left' : device === 'keyboard-right' ? 'keyboard · right' : null;
    if (hint) hint.textContent = !device ? this.hints[s] : device === 'bot' ? 'partner' : half ?? kind!;
    c.classList.toggle('on', !!device);
  }
  hide() { this.root.classList.add('gone'); setTimeout(() => this.root.remove(), 600); }
}

/** what the duel's lobby needs of the duel (src/duel/index.ts) */
export interface DuelSeats {
  hub: InputHub;
  frame: FrameBuilder;
  canvas: HTMLCanvasElement;
  /** the seats people play (not virtual players), in the order devices take them */
  humanSeats: readonly number[];
  /** is seat k a virtual player now */
  bot: (k: number) => boolean;
  /** has the duel begun */
  started: () => boolean;
  /** give seat k to a virtual partner (and begin) */
  partner: (k: number) => void;
  /** the device whose press began the duel on the front: seat 1's */
  joined?: Joined;
}
/** the duel's lobby: a card per seat before the duel, who plays it (a key, a pad, touch, a virtual player) or, while it
 *  waits, how to join it, the card itself a button (a click or a tap joins that seat). The press, click, tap or pad
 *  that began the duel on the front joins seat 1 at once; a second human seat nobody takes can go to a virtual partner
 *  from its card. It stays a moment after the duel begins, so who is who reads, then goes. A touch player gets the
 *  touch pad's buttons (dancer/play.ts makes them for the seats it joins; the duel takes the hub's joins itself, so
 *  its touch players had none). Returns the lobby, or null with no seat to wait for (virtual players only) */
export function duelLobby(o: DuelSeats): Lobby | null {
  const { hub } = o;
  if (!o.humanSeats.length) return null;
  let pad: TouchPad | null = null;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const seatOf = (index: number) => o.humanSeats[index] ?? null;
  // a pointer joins the seat that waits: a touch as touch (one touch player per screen), a click as the keyboard (seat
  // 1's alone, the solo layout with the mouse; a second click splits it, the right half for seat 2)
  const joinPointer = (pt: { touch: boolean; id: number; x: number; y: number }) => {
    const n = hub.players.length;
    if (pt.touch) hub.touch(pt.id, pt.x, pt.y);
    if (hub.players.length !== n) return;
    const code = hub.players.some((p) => p.device === 'keyboard') ? 'ArrowRight' : 'KeyA';
    hub.key(code);
    (hub.players[n]?.source as { keyUp?(code: string): void } | undefined)?.keyUp?.(code);
  };
  const hint = (k: number) => {
    if (k === o.humanSeats[0]) return touch ? 'tap to join' : 'press a key or click';
    return touch ? 'a gamepad joins' : 'arrows, a pad, or click';
  };
  const lobby = new Lobby(false, (seat, e) => {
    if (o.started() && !o.humanSeats.includes(seat)) return;
    joinPointer({ touch: e.pointerType !== 'mouse', id: e.pointerId, x: e.clientX, y: e.clientY });
  }, {
    hint,
    // (a second human seat nobody takes: a virtual partner from its card)
    alt: o.humanSeats.length > 1 ? { seat: o.humanSeats[1], label: 'or a partner', on: () => o.partner(o.humanSeats[1]) } : undefined,
  });
  lobby.root.classList.add('jg-lobby-duel');
  for (let k = 0; k < 2; k++) if (o.bot(k)) lobby.seat(k, 'bot');
  const was = hub.onJoin, wasChange = hub.onChange;
  const shown = (p: Player) => {
    const k = seatOf(p.index);
    if (k != null) lobby.seat(k, p.device === 'keyboard' ? `keyboard-${p.slot}` : p.device);
    if (p.device === 'touch') pad ??= new TouchPad(p.source as TouchSource, o.canvas);
  };
  hub.onJoin = (p) => { was?.(p); shown(p); };
  hub.onChange = (p) => { wasChange?.(p); shown(p); };
  o.frame.tick('camera', () => pad?.update(), 'duel: the touch pad');
  // the lobby goes a moment after the duel begins; a seat given to a partner shows it at once
  let hideAt = 0;
  o.frame.tick('input', () => {
    if (hideAt < 0) return;
    for (let k = 0; k < 2; k++) if (o.bot(k)) lobby.seat(k, 'bot');
    if (!o.started()) return;
    const t = performance.now();
    if (!hideAt) hideAt = t + 1400;
    else if (t >= hideAt) { hideAt = -1; lobby.hide(); }
  }, 'duel: the lobby');
  // the press that began the duel joins seat 1 now (a key or a click that names no key of the layouts joins the
  // keyboard's solo layout, mouse included; a pad joins as that pad)
  const j = o.joined;
  if (j) {
    const n = hub.players.length;
    if (j.device === 'keyboard') {
      hub.key(j.code);
      // (the key went up while the duel was loading: let it go, report 24-newcomer)
      if (j.held && !j.held()) (hub.players[n]?.source as { keyUp?(code: string): void } | undefined)?.keyUp?.(j.code);
    } else if (j.device === 'gamepad') { const p = hub.join(hub.pads.source(j.index), 'gamepad'); if (p) p.slot = j.index; }
    if (hub.players.length === n) joinPointer(j.device === 'touch' ? { touch: true, id: j.id, x: j.x, y: j.y } : { touch: false, id: 0, x: 0, y: 0 });
  }
  return lobby;
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

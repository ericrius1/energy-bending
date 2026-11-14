// How to play the duel: the keys of every device (the one table the controls card and the first duel's lesson read)
// and the controls card, plain DOM over the canvas in the HUD's look (index.html `.dh`). The duel's lobby (how to join
// a seat) is menu.ts's `duelLobby`, beside the jogo's.
//   the card    "how to play": the keys for the player's device, a tab for each (the keyboard alone, two on one keyboard
//               (left and right layouts side by side), a gamepad, touch), and what each seat's two powers do. Opened
//               from the front's menu (its ? button, or ?) and in the duel with ? (F1 while someone plays the right half
//               of the keyboard, whose kick is /), a gamepad's Start, or the ? chip in the corner; Esc, the same key, ×
//               or a click outside closes it. It never pauses the duel
// Pure apart from the card itself (no DOM at import beyond one guarded key listener), so the tests read the table.
import type { FrameBuilder } from '../engine/frame';
import { POWERS, POWER_NAME, matterOf, type PowerId } from '../../shared/powers.ts';

/** the devices the card has a column for: the keyboard alone, its left and right halves, a gamepad, touch */
export type Dev = 'solo' | 'left' | 'right' | 'pad' | 'touch';
export type Action = 'move' | 'jump' | 'catch' | 'dash' | 'kick' | 'spin' | 'dodge' | 'power1' | 'power2' | 'form' | 'view' | 'help';

/** each device's keys (input/keyboard.ts LAYOUTS' duel scheme, input/gamepad.ts, input/touch.ts's buttons by label) */
export const KEYS: Record<Dev, Record<Action, string>> = {
  solo: { move: 'W A S D', jump: 'Space', catch: 'J', dash: 'Shift', kick: 'L', spin: 'I', dodge: 'O', power1: 'U', power2: 'H', form: 'E', view: 'V', help: '?' },
  left: { move: 'W A S D', jump: 'Space', catch: 'J', dash: 'Shift', kick: 'L', spin: 'I', dodge: 'O', power1: 'U', power2: 'H', form: 'E', view: 'V', help: '?' },
  right: { move: '← ↑ ↓ →', jump: "'", catch: ',', dash: '.', kick: '/', spin: ';', dodge: "'", power1: 'P', power2: '[', form: 'Enter', view: ']', help: 'F1' },
  pad: { move: 'left stick', jump: 'A', catch: 'X', dash: 'B', kick: 'Y', spin: 'LB', dodge: 'RB', power1: 'RT', power2: 'LT', form: 'L3 + R3', view: 'View', help: 'Start' },
  touch: { move: 'left thumb', jump: 'jump', catch: 'strike', dash: 'dash', kick: 'kick', spin: 'spin', dodge: 'dodge', power1: 'power 1', power2: 'power 2', form: 'form', view: 'lock', help: '?' },
};
/** a second key some actions have (shown smaller beside the first) */
const ALSO: Partial<Record<Dev, Partial<Record<Action, string>>>> = {
  solo: { catch: 'click', dash: 'K', view: 'Tab', help: 'F1' }, left: { dash: 'K', view: 'Tab', help: 'F1' }, right: { dash: 'right Shift' }, touch: { dash: 'swipe' },
};
const ROWS: [Action, string][] = [
  ['move', 'move'], ['jump', 'jump (twice in the air)'], ['catch', 'catch: hold · swing: the stick · fling: let go'], ['dash', 'dash'],
  ['kick', 'kick'], ['spin', 'spin · aú'], ['dodge', 'dodge'], ['power1', 'power 1'], ['power2', 'power 2'],
  ['form', 'power form (a full bar)'], ['view', 'side view or 3D'], ['help', 'this card'],
];
/** what a power does, in a few words (shared/powers.ts POWER_DOES says it at length) */
export const POWER_SHORT: Record<PowerId, string> = {
  flare: 'a rocket jump that lifts them too', ribbon: 'a dash that leaves a rising updraft', whip: 'a lash that catches at range',
  wave: 'a roll that carries, its crest a boost', step: 'a block of ice to stand on', slide: 'a slick, fast ice path',
  blink: 'a jump through space', arc: 'a tether that pulls you together', pillar: 'a column that launches', prism: 'a facet that turns a flight',
};

/** a source's name as the card's device: keyboard-solo|left|right, gamepad-N, touch; null for a virtual player */
export function devOf(name: string | null | undefined): Dev | null {
  if (!name) return null;
  if (name.startsWith('keyboard-')) { const l = name.slice(9); return l === 'left' || l === 'right' ? l : 'solo'; }
  if (name.startsWith('gamepad')) return 'pad';
  if (name === 'touch') return 'touch';
  return null;
}
/** the device this page most likely plays on, before anyone has pressed anything */
export function guessDev(): Dev {
  try { if ([...(navigator.getGamepads?.() ?? [])].some((p) => p?.connected)) return 'pad'; } catch { /* none */ }
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'solo';
}
export const keyOf = (d: Dev, a: Action) => KEYS[d][a];

// ---------------------------------------------------------------- the card
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const kbd = (s: string) => `<kbd>${esc(s)}</kbd>`;
const TABS: [string, string, Dev[]][] = [['kb', 'keyboard', ['solo']], ['split', 'two on one keyboard', ['left', 'right']], ['pad', 'gamepad', ['pad']], ['touch', 'touch', ['touch']]];
const tabOf = (d: Dev) => (d === 'left' || d === 'right' ? 'split' : d === 'solo' ? 'kb' : d);

let open: HTMLElement | null = null;
/** the controls card: open (on `dev`'s tab, with the matters' powers if given) or closed; returns whether it is open */
export function toggleHelp(dev: Dev = guessDev(), matters: string[] = [], show = !open): boolean {
  if (!show) { closeHelp(); return false; }
  if (open) return true;
  const root = document.createElement('div');
  root.className = 'dh';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'how to play');
  const tabs = TABS.map(([id, label]) => `<button type="button" class="dh-tab" data-tab="${id}">${label}</button>`).join('');
  const table = (devs: Dev[]) => `<table class="dh-keys">${devs.length > 1 ? `<tr><th></th>${devs.map((d) => `<th>${d}</th>`).join('')}</tr>` : ''}${ROWS.map(([a, label]) =>
    `<tr><td>${label}</td>${devs.map((d) => `<td>${kbd(KEYS[d][a])}${ALSO[d]?.[a] ? ` <small>${kbd(ALSO[d]![a]!)}</small>` : ''}</td>`).join('')}</tr>`).join('')}</table>`;
  const pages = TABS.map(([id, , devs]) => `<div class="dh-page" data-page="${id}">${table(devs)}</div>`).join('');
  const seen = [...new Set(matters.map((m) => matterOf(m)))];
  const powers = seen.length ? `<div class="dh-powers">${seen.map((m) => `<div><b>${m}</b>${POWERS[m].powers.map((p, i) => `<span><i>${i + 1}</i>${POWER_NAME[p]}: ${POWER_SHORT[p]}</span>`).join('')}</div>`).join('')}</div>` : '';
  root.innerHTML = `<div class="dh-card"><div class="dh-head"><span>how to play</span><button type="button" class="dh-close" aria-label="close">×</button></div>
    <div class="dh-tabs">${tabs}</div>${pages}${powers}
    <p class="dh-note">Catch each other, swing, fling, and dance on the beat: it fills your flow, and flow casts your powers.</p></div>`;
  const pick = (id: string) => {
    for (const t of root.querySelectorAll<HTMLElement>('.dh-tab')) t.classList.toggle('on', t.dataset.tab === id);
    for (const p of root.querySelectorAll<HTMLElement>('.dh-page')) p.hidden = p.dataset.page !== id;
  };
  pick(tabOf(dev));
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    e.stopPropagation();
    if (t === root || t.closest('.dh-close')) { closeHelp(); return; }
    const tab = t.closest<HTMLElement>('.dh-tab');
    if (tab?.dataset.tab) pick(tab.dataset.tab);
  });
  // (nothing under the card takes the pointer while it is up: the front's tap begins, the canvas turns the camera)
  for (const ev of ['pointerdown', 'pointerup']) root.addEventListener(ev, (e) => e.stopPropagation());
  document.body.append(root);
  open = root;
  requestAnimationFrame(() => root.classList.add('in'));
  root.querySelector<HTMLElement>('.dh-tab.on')?.focus({ preventScroll: true });
  return true;
}
export function closeHelp() {
  const r = open;
  if (!r) return;
  open = null;
  r.classList.remove('in');
  setTimeout(() => r.remove(), 250);
}
export const helpOpen = () => !!open;

/** in a duel: how the card opens, and whether the right half of the keyboard is being played (its kick is /, so ? is
 *  Shift and the kick: the card leaves it to them and opens with F1) */
let inDuel: { toggle(): void; split(): boolean } | null = null;
/** Esc closes the card, on any page that shows it; in a duel ? or F1 opens it. In capture and registered as this module
 *  loads, before the duel's input hub listens, so the hub never takes ? for the right half's / (a split keyboard) */
if (typeof addEventListener === 'function') addEventListener('keydown', (e) => {
  if (open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeHelp(); return; }
  if (!inDuel || e.repeat || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
  if (e.key === 'F1' || (e.key === '?' && !inDuel.split())) { e.preventDefault(); e.stopImmediatePropagation(); inDuel.toggle(); }
}, { capture: true });

// ---------------------------------------------------------------- in the duel: ?, F1, Start, the chip
export interface HelpCtx {
  frame: FrameBuilder;
  /** the device of the first human seat (its source's name), or null */
  device: () => string | null;
  /** the two seats' matters (their powers on the card) */
  matters: () => string[];
  /** the lesson, while it shows: Esc and Start skip it before they open anything */
  lesson?: { active(): boolean; skip(): void } | null;
  /** is someone playing the keyboard's right half (then ? is theirs: Shift and their kick; F1 opens the card) */
  split?: () => boolean;
}
export function installHelp(o: HelpCtx) {
  const dev = () => devOf(o.device()) ?? guessDev();
  const toggle = () => toggleHelp(dev(), o.matters());
  inDuel = { toggle, split: o.split ?? (() => false) };
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'dh-chip';
  chip.textContent = '?';
  chip.setAttribute('aria-label', 'how to play');
  chip.addEventListener('pointerdown', (e) => e.stopPropagation());
  chip.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  document.body.append(chip);
  addEventListener('keydown', (e) => {
    if (e.repeat || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    if (e.key === 'Escape' && o.lesson?.active()) { e.preventDefault(); o.lesson.skip(); }
  });
  // a gamepad's Start: skips the lesson while it shows, else the card
  let was = false;
  o.frame.tick('input', () => {
    let now = false;
    try { for (const p of navigator.getGamepads?.() ?? []) if (p?.buttons[9]?.pressed) now = true; } catch { /* none */ }
    if (now && !was) { if (o.lesson?.active()) o.lesson.skip(); else toggle(); }
    was = now;
  }, 'duel: the controls card (Start)');
  return { chip, toggle };
}

// The toggleable control legend for Energy Bending (Dance and Duel): the keys of every device (the one table the legend
// and the first duel's lesson read), the always-visible corner toggle pill showing its icon and key (`?` or `/`, or
// `F1` when a split keyboard uses `/` to kick), the non-blocking expandable legend panel, and the brief camera/view
// mode toast. Pure apart from the DOM card/pill itself, so the tests read the key tables directly.
import type { FrameBuilder } from '../engine/frame';
import { POWERS, POWER_NAME, matterOf, type PowerId } from '../../shared/powers.ts';

/** the devices the legend has a column for: keyboard+mouse, two on one keyboard (left/right), gamepad, touch */
export type Dev = 'solo' | 'left' | 'right' | 'pad' | 'touch';
export type HelpGame = 'dance' | 'duel';
export type Action = 'move' | 'jump' | 'catch' | 'dash' | 'kick' | 'spin' | 'dodge' | 'power1' | 'power2' | 'form' | 'view' | 'help';

/** each device's keys in Duel (input/keyboard.ts LAYOUTS' duel scheme, input/gamepad.ts, input/touch.ts's buttons) */
export const KEYS: Record<Dev, Record<Action, string>> = {
  solo: { move: 'W A S D', jump: 'Space', catch: 'J', dash: 'Shift', kick: 'L', spin: 'F', dodge: 'X', power1: '1', power2: '2', form: 'E', view: 'V', help: '?' },
  left: { move: 'W A S D', jump: 'Space', catch: 'J', dash: 'Shift', kick: 'L', spin: 'I', dodge: 'O', power1: 'U', power2: 'H', form: 'E', view: 'V', help: '?' },
  right: { move: '← ↑ ↓ →', jump: "'", catch: ',', dash: '.', kick: '/', spin: ';', dodge: "'", power1: 'P', power2: '[', form: 'Enter', view: ']', help: 'F1' },
  pad: { move: 'left stick', jump: 'A', catch: 'X', dash: 'B', kick: 'Y', spin: 'LB', dodge: 'RB', power1: 'RT', power2: 'LT', form: 'L3 + R3', view: 'View', help: 'Start' },
  touch: { move: 'left thumb', jump: 'jump', catch: 'strike', dash: 'dash', kick: 'kick', spin: 'spin', dodge: 'dodge', power1: 'power 1', power2: 'power 2', form: 'form', view: 'lock', help: '?' },
};
/** a second key some Duel actions have (shown beside the primary) */
const ALSO: Partial<Record<Dev, Partial<Record<Action, string>>>> = {
  solo: { catch: 'Click', dash: 'K', kick: 'R-Click', spin: 'I', dodge: 'O', power1: 'U', power2: 'H', view: 'Tab', help: '/' },
  left: { dash: 'K', view: 'Tab', help: 'F1' },
  right: { dash: 'R-Shift' },
  touch: { dash: 'swipe' },
};

type DanceAction = 'move' | 'jump' | 'crouch' | 'strike' | 'kick' | 'spin' | 'dodge' | 'form' | 'merge' | 'build';
/** each device's keys in Dance / Jogo */
export const DANCE_KEYS: Record<Dev, Record<DanceAction, string>> = {
  solo: { move: 'W A S D', jump: 'Space', crouch: 'C', strike: 'Click', kick: 'R-Click', spin: 'L', dodge: 'Shift', form: 'E', merge: 'F', build: 'G' },
  left: { move: 'W A S D', jump: 'Space', crouch: 'C', strike: 'J', kick: 'K', spin: 'L', dodge: 'Shift', form: 'E', merge: 'F', build: 'G' },
  right: { move: '← ↑ ↓ →', jump: "'", crouch: ';', strike: ',', kick: '.', spin: '/', dodge: 'R-Shift', form: 'Enter', merge: 'R-Ctrl', build: '\\' },
  pad: { move: 'left stick', jump: 'A', crouch: 'stick ↓', strike: 'X', kick: 'B', spin: 'LB / RB', dodge: 'RT', form: 'LT', merge: 'hold Y', build: 'D-pad ↑' },
  touch: { move: 'left thumb', jump: 'jump', crouch: 'stick ↓', strike: 'strike', kick: 'kick', spin: 'spin', dodge: 'dodge', form: 'form', merge: 'merge', build: 'build' },
};
const DANCE_ALSO: Partial<Record<Dev, Partial<Record<DanceAction, string>>>> = {
  solo: { strike: 'J', kick: 'K', spin: 'X' },
};

type CamAction = 'orbit' | 'zoom' | 'recenter' | 'view' | 'mirrors';
const CAM_KEYS: Record<Dev, Record<CamAction, [string, string?]>> = {
  solo: { orbit: ['R-Drag', '← ↑ ↓ →'], zoom: ['Scroll'], recenter: ['R'], view: ['V', 'Tab'], mirrors: ['M'] },
  left: { orbit: ['R-Drag'], zoom: ['Scroll'], recenter: ['R'], view: ['V', 'Tab'], mirrors: ['M'] },
  right: { orbit: ['—'], zoom: ['—'], recenter: ['—'], view: [']'], mirrors: ['M'] },
  pad: { orbit: ['right stick'], zoom: ['—'], recenter: ['—'], view: ['View'], mirrors: ['D-pad ←'] },
  touch: { orbit: ['right drag'], zoom: ['—'], recenter: ['—'], view: ['lock'], mirrors: ['mirrors'] },
};

/** what a power does, in a few words (shared/powers.ts POWER_DOES says it at length) */
export const POWER_SHORT: Record<PowerId, string> = {
  flare: 'rocket jump that lifts them too', ribbon: 'dash leaving a rising updraft', whip: 'lash that catches at range',
  wave: 'roll that carries & boosts', step: 'ice block to stand on', slide: 'slick, fast ice path',
  blink: 'instant warp through space', arc: 'tether pulling you together', pillar: 'crystal column that launches', prism: 'facet that redirects flight',
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

// ---------------------------------------------------------------- the legend panel & always-visible toggle pill
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const kbd = (s: string) => `<kbd>${esc(s)}</kbd>`;
const pairKbd = (a: string, b?: string) => (a === '—' ? `<span class="dh-dim">—</span>` : `${kbd(a)}${b ? ` <small>${kbd(b)}</small>` : ''}`);
const TABS: [string, string, Dev[]][] = [['kb', 'Keyboard', ['solo']], ['split', '2P Split', ['left', 'right']], ['pad', 'Gamepad', ['pad']], ['touch', 'Touch', ['touch']]];
const tabOf = (d: Dev) => (d === 'left' || d === 'right' ? 'split' : d === 'solo' ? 'kb' : d);

/** crisp controls-legend SVG icon for the always-visible pill */
const LEGEND_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">`
  + `<rect x="2.5" y="5.5" width="19" height="13" rx="3"/>`
  + `<path d="M6.5 10h1.2M10.5 10h1.2M14.5 10h1.2M17.5 10h.5M7 14h10"/>`
  + `</svg>`;

export interface ToggleOptions {
  game?: HelpGame;
  /** whether the camera is currently locked in 2D side view */
  locked?: () => boolean;
  /** toggle between 3D and 2D side view right from the legend */
  toggleView?: () => void;
  /** allow switching between Dance and Duel previews inside the legend (the front menu) */
  allowModeSwitch?: boolean;
}

let open: HTMLElement | null = null;
let openOpts: { dev: Dev; matters: string[]; opts: ToggleOptions; activeTab: string; activeGame: HelpGame } | null = null;
let activeChip: HTMLButtonElement | null = null;

function syncChipState() {
  if (!activeChip) return;
  const isOpen = !!open;
  activeChip.setAttribute('aria-pressed', String(isOpen));
  activeChip.setAttribute('aria-expanded', String(isOpen));
  activeChip.classList.toggle('open', isOpen);
}

function renderLegendBody(devTab: string, game: HelpGame, matters: string[], locked: boolean, allowModeSwitch: boolean, canToggleView: boolean) {
  const tab = TABS.find((t) => t[0] === devTab) ?? TABS[0];
  const devs = tab[2];
  const headCols = devs.length > 1 ? `<tr><th></th>${devs.map((d) => `<th>${d === 'left' ? 'P1' : 'P2'}</th>`).join('')}</tr>` : '';
  const row = (label: string, cells: string[]) => `<tr><td>${label}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const section = (title: string) => `<tr class="dh-sec"><td colspan="${devs.length + 1}">${title}</td></tr>`;

  const moveRows = [
    section('Move'),
    row(locked ? 'Move (2D)' : 'Move (3D)', devs.map((d) => {
      if (d === 'solo' || d === 'left') return kbd(locked ? 'A D' : 'W A S D');
      if (d === 'right') return kbd(locked ? '← →' : '← ↑ ↓ →');
      return kbd(KEYS[d].move);
    })),
    row(game === 'duel' ? 'Jump · wall-jump' : 'Jump (double)', devs.map((d) => {
      if (locked && (d === 'solo' || d === 'left')) return pairKbd('Space', 'W');
      if (locked && d === 'right') return kbd('↑');
      return kbd(KEYS[d].jump);
    })),
    row(locked ? 'Crouch · drop' : 'Crouch · fast-fall', devs.map((d) => {
      if (locked && (d === 'solo' || d === 'left')) return kbd('S');
      if (locked && d === 'right') return kbd('↓');
      return kbd(DANCE_KEYS[d].crouch);
    })),
  ];

  const camRows = [
    section('Camera'),
    ...(locked ? [] : [
      row('Orbit camera', devs.map((d) => pairKbd(CAM_KEYS[d].orbit[0], CAM_KEYS[d].orbit[1]))),
      row('Zoom in / out', devs.map((d) => pairKbd(CAM_KEYS[d].zoom[0]))),
      row('Recenter behind you', devs.map((d) => pairKbd(CAM_KEYS[d].recenter[0]))),
    ]),
    row('Switch 3D / Side View', devs.map((d) => pairKbd(CAM_KEYS[d].view[0], CAM_KEYS[d].view[1]))),
    row('Show mirror names', devs.map((d) => pairKbd(CAM_KEYS[d].mirrors[0]))),
  ];

  const moveActionRows = game === 'duel'
    ? [
        section('Duel & Powers'),
        row('Catch (hold) · Fling (release)', devs.map((d) => pairKbd(d === 'solo' ? 'Click' : KEYS[d].catch, d === 'solo' ? KEYS[d].catch : ALSO[d]?.catch))),
        row('Dash (8-way)', devs.map((d) => pairKbd(KEYS[d].dash, ALSO[d]?.dash))),
        row('Kick', devs.map((d) => pairKbd(d === 'solo' ? 'R-Click' : KEYS[d].kick, d === 'solo' ? KEYS[d].kick : undefined))),
        row('Spin · Cartwheel (+move)', devs.map((d) => pairKbd(KEYS[d].spin, ALSO[d]?.spin))),
        row('Dodge', devs.map((d) => pairKbd(KEYS[d].dodge, ALSO[d]?.dodge))),
        row('Power 1', devs.map((d) => pairKbd(KEYS[d].power1, ALSO[d]?.power1))),
        row('Power 2', devs.map((d) => pairKbd(KEYS[d].power2, ALSO[d]?.power2))),
        row('Power Form (full bar)', devs.map((d) => kbd(KEYS[d].form))),
      ]
    : [
        section('Dance Moves'),
        row('Strike · Throw (hold)', devs.map((d) => pairKbd(DANCE_KEYS[d].strike, DANCE_ALSO[d]?.strike))),
        row('Kick', devs.map((d) => pairKbd(DANCE_KEYS[d].kick, DANCE_ALSO[d]?.kick))),
        row('Spin · Cartwheel (+move)', devs.map((d) => pairKbd(DANCE_KEYS[d].spin, DANCE_ALSO[d]?.spin))),
        row('Dodge · Block', devs.map((d) => kbd(DANCE_KEYS[d].dodge))),
        row('Switch element form', devs.map((d) => kbd(DANCE_KEYS[d].form))),
        row('Merge / Fusion (hold)', devs.map((d) => kbd(DANCE_KEYS[d].merge))),
        row('Build ledge / ring', devs.map((d) => kbd(DANCE_KEYS[d].build))),
      ];

  const seen = game === 'duel' ? [...new Set(matters.map((m) => matterOf(m)))] : [];
  const powers = seen.length
    ? `<div class="dh-powers">${seen.map((m) => `<div><b>${m}</b>${POWERS[m].powers.map((p, i) => `<span><i>${i + 1}</i>${POWER_NAME[p]}: ${POWER_SHORT[p]}</span>`).join('')}</div>`).join('')}</div>`
    : '';

  const modeSwitch = allowModeSwitch
    ? `<div class="dh-modes"><button type="button" class="dh-mode${game === 'dance' ? ' on' : ''}" data-game="dance">Dance</button><button type="button" class="dh-mode${game === 'duel' ? ' on' : ''}" data-game="duel">Duel</button></div>`
    : `<span class="dh-badge">${game === 'duel' ? 'Duel' : 'Dance'}</span>`;

  const viewPill = canToggleView
    ? `<button type="button" class="dh-view" data-view-toggle title="Toggle 3D / Side View (V)">${locked ? '2D Side' : '3D Free'}</button>`
    : '';

  const tabs = TABS.map(([id, label]) => `<button type="button" class="dh-tab${id === devTab ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('');
  const tip = game === 'duel'
    ? 'Catch, swing & fling on the beat to fill flow, then cast powers. Alt+drag also orbits on a trackpad.'
    : 'Dance on the beat to build flow, hold F near your partner to fuse, or walk through any mirror to change worlds.';

  return `<div class="dh-card">`
    + `<div class="dh-head"><div class="dh-title"><span>Controls</span>${modeSwitch}${viewPill}</div><button type="button" class="dh-close" aria-label="close">×</button></div>`
    + `<div class="dh-tabs">${tabs}</div>`
    + `<div class="dh-scroll"><table class="dh-keys">${headCols}${[...moveRows, ...camRows, ...moveActionRows].join('')}</table>${powers}</div>`
    + `<p class="dh-note">${tip}</p>`
    + `<div class="dh-foot"><span>${kbd('?')} or ${kbd('/')} toggle legend</span><span>${kbd('Esc')} menu</span></div>`
    + `</div>`;
}

/** the controls legend: open (on `dev`'s tab, for Dance or Duel) or closed; returns whether it is open */
export function toggleHelp(dev: Dev = guessDev(), matters: string[] = [], show = !open, opts: ToggleOptions = {}): boolean {
  if (!show) { closeHelp(); return false; }
  const game: HelpGame = opts.game ?? (matters.length ? 'duel' : 'dance');
  if (open) {
    // refresh in place if options changed
    openOpts = { dev, matters, opts, activeTab: tabOf(dev), activeGame: game };
    open.innerHTML = renderLegendBody(openOpts.activeTab, openOpts.activeGame, matters, !!opts.locked?.(), !!opts.allowModeSwitch, !!opts.toggleView);
    syncChipState();
    return true;
  }
  const root = document.createElement('div');
  root.className = 'dh';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Controls legend');
  openOpts = { dev, matters, opts, activeTab: tabOf(dev), activeGame: game };
  const paint = () => {
    if (!openOpts) return;
    root.innerHTML = renderLegendBody(openOpts.activeTab, openOpts.activeGame, openOpts.matters, !!openOpts.opts.locked?.(), !!openOpts.opts.allowModeSwitch, !!openOpts.opts.toggleView);
  };
  paint();
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    e.stopPropagation();
    if (t.closest('.dh-close')) { closeHelp(); return; }
    const tab = t.closest<HTMLElement>('.dh-tab');
    if (tab?.dataset.tab && openOpts) { openOpts.activeTab = tab.dataset.tab; paint(); return; }
    const gm = t.closest<HTMLElement>('.dh-mode');
    if (gm?.dataset.game && openOpts) { openOpts.activeGame = gm.dataset.game as HelpGame; paint(); return; }
    if (t.closest('[data-view-toggle]') && openOpts?.opts.toggleView) {
      openOpts.opts.toggleView();
      setTimeout(() => paint(), 20);
      return;
    }
  });
  // keep clicks/drags on the legend itself from triggering canvas actions underneath
  for (const ev of ['pointerdown', 'pointerup', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation());
  document.body.append(root);
  open = root;
  syncChipState();
  requestAnimationFrame(() => root.classList.add('in'));
  return true;
}

export function closeHelp() {
  const r = open;
  if (!r) return;
  open = null;
  openOpts = null;
  syncChipState();
  r.classList.remove('in');
  setTimeout(() => r.remove(), 220);
}
export const helpOpen = () => !!open;

/** refresh the open legend when the camera view mode changes (e.g. V pressed while legend is open) */
export function refreshHelp() {
  if (!open || !openOpts) return;
  open.innerHTML = renderLegendBody(openOpts.activeTab, openOpts.activeGame, openOpts.matters, !!openOpts.opts.locked?.(), !!openOpts.opts.allowModeSwitch, !!openOpts.opts.toggleView);
}

/** active legend controller on the page (?, / when not split-keyboard, F1 toggle it; Esc closes when open) */
let activeHelp: { toggle(): void; split(): boolean; dispose(): void } | null = null;
/** Esc closes the legend on any page; ? or / (when not split-keyboard, where / is P2 kick) or F1 toggles it.
 *  Registered in capture phase before InputHub so pressing ? or / never splits the keyboard. */
if (typeof addEventListener === 'function') addEventListener('keydown', (e) => {
  if (open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeHelp(); return; }
  if (!activeHelp || e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
  const split = activeHelp.split();
  if (e.key === 'F1' || ((e.key === '?' || e.key === '/') && !split)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    activeHelp.toggle();
  }
}, { capture: true });

// ---------------------------------------------------------------- camera / view mode toast
let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** brief unobtrusive pill at top-center confirming a camera/view change (e.g. 3D ↔ Side View, Recenter) */
export function showCamToast(text: string, ms = 1700) {
  if (typeof document === 'undefined') return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'eb-cam-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl?.classList.remove('on'); }, ms);
}

// ---------------------------------------------------------------- always-visible legend toggle pill (Dance, Duel, Solo, Front)
export interface HelpCtx {
  frame?: FrameBuilder;
  /** which game's controls to show (default 'duel' if matters are provided, else 'dance') */
  game?: HelpGame | (() => HelpGame);
  /** the device of the first human seat (its source's name), or null */
  device: () => string | null;
  /** the two seats' matters (their powers on the card, Duel) */
  matters: () => string[];
  /** the lesson, while it shows: Esc and Start skip it before they open anything */
  lesson?: { active(): boolean; skip(): void } | null;
  /** is someone playing the keyboard's right half (then / is theirs to kick; F1 opens the legend) */
  split?: () => boolean;
  /** current camera view mode & toggle */
  locked?: () => boolean;
  toggleView?: () => void;
  /** allow switching Dance/Duel inside the legend (used on the front screen) */
  allowModeSwitch?: boolean;
}

export function installHelp(o: HelpCtx) {
  // replace any previous legend pill (e.g. transitioning from front screen into Dance or Duel)
  activeHelp?.dispose();
  closeHelp();

  const dev = () => devOf(o.device()) ?? guessDev();
  const gameOf = (): HelpGame => (typeof o.game === 'function' ? o.game() : o.game ?? (o.matters().length ? 'duel' : 'dance'));
  const split = o.split ?? (() => false);
  const toggle = () => toggleHelp(dev(), o.matters(), !open, { game: gameOf(), locked: o.locked, toggleView: o.toggleView, allowModeSwitch: o.allowModeSwitch });

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'dh-chip';
  chip.setAttribute('aria-label', 'Toggle controls legend');
  chip.setAttribute('aria-keyshortcuts', '? / F1');
  const paintChip = () => {
    const key = split() ? 'F1' : '?';
    chip.title = split() ? 'Controls legend ( F1 )' : 'Controls legend ( ? or / )';
    chip.innerHTML = `${LEGEND_ICON}<span class="dh-chip-lbl">Controls</span><kbd aria-hidden="true">${key}</kbd>`;
  };
  paintChip();
  chip.addEventListener('pointerdown', (e) => e.stopPropagation());
  chip.addEventListener('click', (e) => { e.stopPropagation(); toggle(); chip.blur(); });
  document.body.append(chip);
  activeChip = chip;
  syncChipState();

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    if (e.key === 'Escape' && o.lesson?.active()) { e.preventDefault(); o.lesson.skip(); }
  };
  addEventListener('keydown', onKey);

  // gamepad Start & live chip key badge sync (switches ? → F1 if 2P split joins)
  let wasStart = false, wasSplit = split(), wasLocked = !!o.locked?.(), disposed = false;
  o.frame?.tick('input', () => {
    if (disposed) return;
    const sp = split();
    if (sp !== wasSplit) { wasSplit = sp; paintChip(); }
    const lk = !!o.locked?.();
    if (lk !== wasLocked) { wasLocked = lk; refreshHelp(); }
    let now = false;
    try { for (const p of navigator.getGamepads?.() ?? []) if (p?.buttons[9]?.pressed) now = true; } catch { /* none */ }
    if (now && !wasStart) { if (o.lesson?.active()) o.lesson.skip(); else toggle(); }
    wasStart = now;
  }, 'help: the controls legend (Start, chip sync)');

  const dispose = () => {
    disposed = true;
    removeEventListener('keydown', onKey);
    if (activeChip === chip) activeChip = null;
    chip.remove();
  };
  activeHelp = { toggle, split, dispose };
  return { chip, toggle, dispose };
}

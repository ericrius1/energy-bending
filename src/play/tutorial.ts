// AAA-style interactive intro tutorial for Energy Bending (Dance and Duel).
// Starts live with your dance/battle partner on first play (persisted in localStorage; replayable anytime from the
// Controls Legend or with ?tutorial). Walks step-by-step through movement, camera, jump/dash, strikes & kicks,
// spins & cartwheels, and signature moves/powers — waiting for real player execution with live progress bars,
// device-aware glowing keycaps, checkmarks, and celebratory chimes. Pure TutorialEngine is unit-tested in Node.
import type { Dev, HelpGame } from '../duel/help';

export interface TutorialStepDef {
  id: string;
  title: string;
  body: (dev: Dev) => string;
  keys: (dev: Dev) => { key: string; label: string }[];
  goal: number;
}

export interface TutorialSample {
  dt: number;
  /** player root position [x, y, z] */
  root: readonly [number, number, number];
  /** partner root position [x, y, z] (optional) */
  partner?: readonly [number, number, number] | null;
  /** camera orbit/zoom/reset/toggle activity this frame */
  camMoved: boolean;
  viewToggled: boolean;
  /** body/game events fired by THIS player this frame */
  jumped: boolean;
  dashed: boolean;
  dodged: boolean;
  moves: readonly string[];
  exchanged: boolean;
  caughtOrFlung: boolean;
  powered: boolean;
  formedOrMerged: boolean;
}

const MOVE_KEYS = (dev: Dev) =>
  dev === 'pad' ? [{ key: 'Left Stick', label: 'Move' }]
    : dev === 'touch' ? [{ key: 'Left Thumb', label: 'Move' }]
    : [{ key: 'W A S D', label: 'Move' }];

const CAM_KEYS = (dev: Dev) =>
  dev === 'pad' ? [{ key: 'Right Stick', label: 'Orbit' }, { key: 'View', label: '2D / 3D' }]
    : dev === 'touch' ? [{ key: 'Right Drag', label: 'Orbit' }, { key: 'Lock', label: '2D / 3D' }]
    : [{ key: 'R-Drag', label: 'Orbit' }, { key: '← ↑ ↓ →', label: 'or Arrows' }, { key: 'R', label: 'Recenter' }, { key: 'V', label: '2D / 3D' }];

export function stepsFor(game: HelpGame): TutorialStepDef[] {
  if (game === 'duel') {
    return [
      {
        id: 'move',
        title: 'Find Yourself & Move',
        body: () => 'You are under the glowing <b>YOU</b> beacon with the gold compass under your feet. Run around the arena!',
        keys: MOVE_KEYS,
        goal: 1.8,
      },
      {
        id: 'camera',
        title: 'Steer the Camera',
        body: () => 'Orbit the camera around the arena, recenter behind you, or tap 2D / 3D view anytime.',
        keys: CAM_KEYS,
        goal: 1,
      },
      {
        id: 'dash',
        title: 'Jump & Air Dash',
        body: () => 'Leap into the air (tap twice to double-jump) and burst forward with an <b>Air Dash</b>!',
        keys: (d) => d === 'pad' ? [{ key: 'A', label: 'Jump ×2' }, { key: 'B', label: 'Dash' }]
          : d === 'touch' ? [{ key: 'Jump', label: 'Jump ×2' }, { key: 'Dash', label: 'Dash / Swipe' }]
          : [{ key: 'Space', label: 'Jump ×2' }, { key: 'Shift', label: 'Dash' }],
        goal: 2,
      },
      {
        id: 'moves',
        title: 'Kicks & Acrobatics',
        body: () => 'Flow between capoeira kicks and spins — every move rings in your element and cancels smoothly.',
        keys: (d) => d === 'pad' ? [{ key: 'Y', label: 'Kick' }, { key: 'LB', label: 'Spin / Aú' }]
          : d === 'touch' ? [{ key: 'Kick', label: 'Kick' }, { key: 'Spin', label: 'Spin / Aú' }]
          : [{ key: 'R-Click / L', label: 'Kick' }, { key: 'F / I', label: 'Spin / Cartwheel' }],
        goal: 2,
      },
      {
        id: 'catch',
        title: 'Catch & Fling',
        body: () => 'Close in on your partner and tap <b>Catch</b> to link up, swing them, and launch them sky-high!',
        keys: (d) => d === 'pad' ? [{ key: 'X', label: 'Catch / Fling' }]
          : d === 'touch' ? [{ key: 'Strike', label: 'Catch / Fling' }]
          : [{ key: 'Click / J', label: 'Catch / Fling' }],
        goal: 1,
      },
      {
        id: 'powers',
        title: 'Unleash Elemental Powers',
        body: () => 'Trigger your two elemental powers or activate <b>Power Form</b> when your flow fills!',
        keys: (d) => d === 'pad' ? [{ key: 'RT', label: 'Power 1' }, { key: 'LT', label: 'Power 2' }, { key: 'L3+R3', label: 'Form' }]
          : d === 'touch' ? [{ key: 'Power 1', label: 'Power 1' }, { key: 'Power 2', label: 'Power 2' }]
          : [{ key: '1', label: 'Power 1' }, { key: '2', label: 'Power 2' }, { key: 'E', label: 'Power Form' }],
        goal: 1,
      },
    ];
  }
  return [
    {
      id: 'move',
      title: 'Find Yourself & Move',
      body: () => 'You are the dancer under the <b>YOU</b> beacon with the gold directional ring at your feet. Run across the stage!',
      keys: MOVE_KEYS,
      goal: 1.8,
    },
    {
      id: 'camera',
      title: 'Steer the Camera',
      body: () => 'Orbit smoothly with right-drag, two-finger swipe, or arrow keys — or tap <b>V</b> for classic 2D side view.',
      keys: CAM_KEYS,
      goal: 1,
    },
    {
      id: 'jump',
      title: 'Jump & Evade',
      body: () => 'Tap <b>Jump</b> (twice to double-jump) and try a swift <b>Dodge / Roll</b> to slip under your partner.',
      keys: (d) => d === 'pad' ? [{ key: 'A', label: 'Jump ×2' }, { key: 'RT', label: 'Dodge / Roll' }]
        : d === 'touch' ? [{ key: 'Jump', label: 'Jump ×2' }, { key: 'Dodge', label: 'Dodge / Roll' }]
        : [{ key: 'Space', label: 'Jump ×2' }, { key: 'Shift', label: 'Dodge / Roll' }],
      goal: 2,
    },
    {
      id: 'attack',
      title: 'Strike & Kick on the Beat',
      body: () => 'Tap to strike, hold to stream energy, or right-click to unleash capoeira kicks — time them to the beat pulse!',
      keys: (d) => d === 'pad' ? [{ key: 'X', label: 'Strike / Hold' }, { key: 'B', label: 'Kick' }]
        : d === 'touch' ? [{ key: 'Strike', label: 'Strike' }, { key: 'Kick', label: 'Kick' }]
        : [{ key: 'Click / J', label: 'Strike (hold: Throw)' }, { key: 'R-Click / K', label: 'Kick' }],
      goal: 2,
    },
    {
      id: 'acro',
      title: 'Spin & Cartwheel',
      body: () => 'Tap <b>Spin</b> to twirl in place, or hold a direction + <b>Spin</b> to throw a sweeping cartwheel (Aú)!',
      keys: (d) => d === 'pad' ? [{ key: 'LB / RB', label: 'Spin / Cartwheel' }]
        : d === 'touch' ? [{ key: 'Spin', label: 'Spin / Cartwheel' }]
        : [{ key: 'L / X', label: 'Spin' }, { key: 'Move + L', label: 'Cartwheel' }],
      goal: 1,
    },
    {
      id: 'flow',
      title: 'Dance Together & Flow',
      body: () => 'Dance close with your partner to spark dodges, clashes, and Flow — press <b>E</b> for Form or hold <b>F</b> to Merge!',
      keys: (d) => d === 'pad' ? [{ key: 'LT', label: 'Form' }, { key: 'Hold Y', label: 'Merge' }]
        : d === 'touch' ? [{ key: 'Form', label: 'Form' }, { key: 'Merge', label: 'Merge' }]
        : [{ key: 'E', label: 'Elemental Form' }, { key: 'Hold F', label: 'Merge / Fusion' }],
      goal: 2,
    },
  ];
}

const ATTACK_MOVES = new Set(['strike', 'throw', 'meia-lua', 'armada', 'martelo', 'bencao', 'rasteira']);
const ACRO_MOVES = new Set(['spin', 'au', 'macaco', 'pirueta']);
const DODGE_MOVES = new Set(['role', 'esquiva', 'block']);

/** pure state machine for the interactive tutorial (unit-testable in Node) */
export class TutorialEngine {
  readonly steps: TutorialStepDef[];
  index = 0;
  progress = 0;
  state: 'idle' | 'active' | 'celebrate' | 'done' = 'idle';
  /** hold time after finishing a step (s) before advancing to the next */
  private stepHold = 0;
  /** hold time for the final "You're ready!" celebration banner (s) */
  private doneHold = 0;
  private lastRoot: [number, number, number] | null = null;
  private seenJump = false;
  private seenSecond = false;
  private camAccum = 0;

  constructor(readonly game: HelpGame) {
    this.steps = stepsFor(game);
  }

  get active() { return this.state === 'active' || this.state === 'celebrate'; }
  get current(): TutorialStepDef | null { return this.index < this.steps.length ? this.steps[this.index] : null; }
  get fraction() {
    const s = this.current;
    if (!s) return 1;
    return Math.max(0, Math.min(1, this.progress / Math.max(1e-4, s.goal)));
  }
  get stepping() { return this.stepHold > 0; }

  start() {
    this.index = 0;
    this.progress = 0;
    this.stepHold = 0;
    this.doneHold = 0;
    this.lastRoot = null;
    this.seenJump = false;
    this.seenSecond = false;
    this.camAccum = 0;
    this.state = 'active';
  }

  skip() {
    this.state = 'done';
    this.stepHold = 0;
    this.doneHold = 0;
  }

  /** advance one frame; returns event ('step' when a step is completed, 'complete' when the whole tutorial finishes) */
  update(s: TutorialSample): 'step' | 'complete' | null {
    if (this.state === 'idle' || this.state === 'done') return null;
    if (this.state === 'celebrate') {
      this.doneHold -= s.dt;
      if (this.doneHold <= 0) this.state = 'done';
      return null;
    }
    if (this.stepHold > 0) {
      this.stepHold -= s.dt;
      if (this.stepHold <= 0) {
        this.index++;
        this.progress = 0;
        this.seenJump = false;
        this.seenSecond = false;
        this.camAccum = 0;
        if (this.index >= this.steps.length) {
          this.state = 'celebrate';
          this.doneHold = 2.6;
          return 'complete';
        }
      }
      return null;
    }

    const step = this.current;
    if (!step) return null;
    const dx = this.lastRoot ? Math.hypot(s.root[0] - this.lastRoot[0], s.root[2] - this.lastRoot[2]) : 0;
    this.lastRoot = [s.root[0], s.root[1], s.root[2]];
    const nearPartner = !s.partner || Math.hypot(s.root[0] - s.partner[0], s.root[2] - s.partner[2]) < 4.5;
    const movesLower = s.moves.map((m) => m.toLowerCase());

    switch (step.id) {
      case 'move':
        // ignore large teleports/spawns (> 1.2 m in a single frame)
        if (dx > 0.002 && dx < 1.2) this.progress += dx;
        break;
      case 'camera':
        if (s.viewToggled) this.progress = step.goal;
        else if (s.camMoved) { this.camAccum += s.dt; this.progress = Math.min(step.goal, this.camAccum / 0.25); }
        break;
      case 'jump':
        if (s.jumped && !this.seenJump) { this.seenJump = true; this.progress += 1; }
        else if ((s.dodged || s.dashed || movesLower.some((m) => DODGE_MOVES.has(m))) && !this.seenSecond) { this.seenSecond = true; this.progress += 1; }
        else if (s.jumped && this.seenJump && !this.seenSecond) { this.seenSecond = true; this.progress += 1; }
        break;
      case 'dash':
        if (s.jumped && !this.seenJump) { this.seenJump = true; this.progress += 1; }
        if (s.dashed && !this.seenSecond) { this.seenSecond = true; this.progress += 1; }
        break;
      case 'attack':
      case 'moves':
        for (const m of movesLower) if (ATTACK_MOVES.has(m) || ACRO_MOVES.has(m)) this.progress += 1;
        break;
      case 'acro':
        if (movesLower.some((m) => ACRO_MOVES.has(m))) this.progress = step.goal;
        break;
      case 'catch':
        if (s.caughtOrFlung) this.progress = step.goal;
        else if (nearPartner && movesLower.some((m) => ATTACK_MOVES.has(m))) this.progress += 0.5;
        break;
      case 'powers':
        if (s.powered || s.formedOrMerged) this.progress = step.goal;
        break;
      case 'flow':
        if (s.exchanged || s.formedOrMerged) this.progress = step.goal;
        else if (nearPartner && movesLower.length > 0) this.progress += 1;
        break;
    }

    if (this.progress >= step.goal) {
      this.progress = step.goal;
      this.stepHold = 0.65;
      return 'step';
    }
    return null;
  }
}

// ---------------------------------------------------------------- DOM presenter
const STORAGE_PREFIX = 'eb.tutorial.v1.';
const CSS = `
.eb-tut { position: fixed; top: calc(14px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%);
  z-index: 8; width: min(440px, calc(100vw - 28px)); padding: 13px 16px 14px; border-radius: 18px;
  color: var(--eb-cream, #fbf4e4); font-family: var(--eb-body, system-ui, sans-serif);
  background: var(--eb-glass-bg, rgba(28, 20, 10, 0.72));
  box-shadow: var(--eb-lead, 0 0 0 1px rgba(222, 180, 104, 0.65)), 0 14px 36px rgba(10, 6, 2, 0.45);
  -webkit-backdrop-filter: var(--eb-blur, blur(14px)); backdrop-filter: var(--eb-blur, blur(14px));
  pointer-events: auto; opacity: 0; transform: translateX(-50%) translateY(-10px);
  transition: opacity 0.28s, transform 0.28s, box-shadow 0.25s; }
.eb-tut.on { opacity: 1; transform: translateX(-50%) translateY(0); }
.eb-tut.duel { top: calc(112px + env(safe-area-inset-top, 0px)); }
.eb-tut.ok { box-shadow: 0 0 0 2px rgba(114, 240, 174, 0.9), 0 0 28px rgba(114, 240, 174, 0.35), 0 14px 36px rgba(10, 6, 2, 0.45); }
.eb-tut-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.eb-tut-badge { font: 800 10px/1 var(--eb-body, system-ui, sans-serif); letter-spacing: 0.14em; text-transform: uppercase;
  padding: 4px 8px; border-radius: 999px; background: rgba(255, 200, 97, 0.2); color: #ffe08a;
  box-shadow: inset 0 0 0 1px rgba(255, 200, 97, 0.45); }
.eb-tut-dots { display: flex; gap: 5px; align-items: center; }
.eb-tut-dots i { display: block; width: 7px; height: 7px; border-radius: 50%; background: rgba(251, 244, 228, 0.22); transition: background 0.2s, transform 0.2s; }
.eb-tut-dots i.done { background: #6df0ab; }
.eb-tut-dots i.now { background: #ffd166; transform: scale(1.25); box-shadow: 0 0 8px rgba(255, 209, 102, 0.8); }
.eb-tut-skip { margin-left: auto; border: 0; background: transparent; color: rgba(251, 244, 228, 0.62); cursor: pointer;
  font: 700 10px/1 var(--eb-body, system-ui, sans-serif); letter-spacing: 0.12em; text-transform: uppercase;
  padding: 4px 8px; border-radius: 8px; transition: color 0.15s, background 0.15s; }
.eb-tut-skip:hover { color: #fbf4e4; background: rgba(255, 244, 220, 0.1); }
.eb-tut-h { margin: 0 0 4px; font: italic 700 18px/1.15 var(--eb-display, Georgia, serif); color: #fff6df; display: flex; align-items: center; gap: 8px; }
.eb-tut-chk { display: inline-grid; place-items: center; width: 0; height: 18px; margin-right: -8px; overflow: hidden; border-radius: 50%;
  background: #4cd98d; color: #0e2a19; font: 900 11px/1 system-ui, sans-serif; opacity: 0; transform: scale(0.5); transition: width 0.18s, margin-right 0.18s, opacity 0.18s, transform 0.18s; }
.eb-tut.ok .eb-tut-chk { width: 18px; margin-right: 0; opacity: 1; transform: scale(1); }
.eb-tut-p { margin: 0 0 9px; font-size: 12.5px; line-height: 1.4; color: rgba(251, 244, 228, 0.86); }
.eb-tut-p b { color: #ffe4a0; font-weight: 700; }
.eb-tut-keys { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 9px; }
.eb-tut-k { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: rgba(251, 244, 228, 0.82); }
.eb-tut-k kbd { font: 800 11px/1 var(--eb-body, system-ui, sans-serif); color: #2b1e0b; padding: 3px 7px; border-radius: 6px;
  background: linear-gradient(#fbf4e4, #efe2c2); box-shadow: 0 0 0 1px rgba(224, 154, 58, 0.85), 0 1px 0 rgba(120, 80, 20, 0.55); }
.eb-tut-bar { height: 5px; border-radius: 999px; background: rgba(255, 244, 220, 0.14); overflow: hidden; }
.eb-tut-fill { height: 100%; width: 0%; border-radius: 999px; background: linear-gradient(90deg, #ff9966, #ffd86f);
  transition: width 0.1s linear, background 0.2s; }
.eb-tut.ok .eb-tut-fill { background: linear-gradient(90deg, #4cd98d, #98f5c4); }
@media (max-width: 759px) {
  .eb-tut, .eb-tut.duel { top: calc(114px + env(safe-area-inset-top, 0px)); width: min(360px, calc(100vw - 20px)); padding: 10px 12px 11px; }
  .eb-tut-h { font-size: 16px; }
  .eb-tut-p { font-size: 11.5px; }
}
`;

let tutStyled = false;
function ensureTutStyle() {
  if (tutStyled || typeof document === 'undefined') return;
  tutStyled = true;
  const s = document.createElement('style');
  s.dataset.eb = 'tutorial';
  s.textContent = CSS;
  document.head.append(s);
}

export function shouldAutoTutorial(game: HelpGame, query: URLSearchParams, film: boolean): boolean {
  if (film) return false;
  if (query.has('tutorial')) return query.get('tutorial') !== '0' && query.get('tutorial') !== 'off';
  // keep automated headless probes / scripts clean unless ?tutorial is explicitly requested
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  try { return localStorage.getItem(STORAGE_PREFIX + game) !== 'done'; } catch { return true; }
}

function markTutorialDone(game: HelpGame) {
  try { localStorage.setItem(STORAGE_PREFIX + game, 'done'); } catch { /* ignore */ }
}

export interface TutorialHandle {
  readonly engine: TutorialEngine;
  active(): boolean;
  start(): void;
  skip(): void;
  update(sample: TutorialSample, dev: Dev): void;
  remove(): void;
}

export function createTutorial(o: {
  game: HelpGame;
  autoStart: boolean;
  onStep?: (stepId: string) => void;
  onComplete?: () => void;
}): TutorialHandle {
  const engine = new TutorialEngine(o.game);
  let el: HTMLElement | null = null;
  let lastKey = '';

  const mount = () => {
    if (el || typeof document === 'undefined') return;
    ensureTutStyle();
    el = document.createElement('aside');
    el.className = o.game === 'duel' ? 'eb-tut duel' : 'eb-tut';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Interactive tutorial');
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(el);
  };

  const paint = (dev: Dev) => {
    if (!engine.active) {
      if (el) el.classList.remove('on', 'ok');
      return;
    }
    mount();
    if (!el) return;
    el.classList.add('on');
    el.classList.toggle('ok', engine.stepping || engine.state === 'celebrate');

    if (engine.state === 'celebrate') {
      const k = 'celebrate';
      if (lastKey !== k) {
        lastKey = k;
        el.innerHTML = `<div class="eb-tut-top"><span class="eb-tut-badge">COMPLETE</span><div class="eb-tut-dots">${engine.steps.map(() => '<i class="done"></i>').join('')}</div></div>`
          + `<h3 class="eb-tut-h"><span class="eb-tut-chk">✓</span>You're Ready — Enjoy the ${o.game === 'duel' ? 'Duel' : 'Dance'}!</h3>`
          + `<p class="eb-tut-p">Open <b>Controls (?)</b> anytime in the corner for the full move legend or to replay this guide.</p>`
          + `<div class="eb-tut-bar"><div class="eb-tut-fill" style="width:100%"></div></div>`;
      }
      return;
    }

    const step = engine.current;
    if (!step) return;
    const k = `${step.id}|${dev}|${engine.index}`;
    if (lastKey !== k) {
      lastKey = k;
      const dots = engine.steps.map((_, i) => `<i class="${i < engine.index ? 'done' : i === engine.index ? 'now' : ''}"></i>`).join('');
      const keys = step.keys(dev).map((x) => `<span class="eb-tut-k"><kbd>${x.key}</kbd>${x.label}</span>`).join('');
      el.innerHTML = `<div class="eb-tut-top"><span class="eb-tut-badge">STEP ${engine.index + 1} / ${engine.steps.length}</span><div class="eb-tut-dots">${dots}</div><button class="eb-tut-skip" type="button">Skip</button></div>`
        + `<h3 class="eb-tut-h"><span class="eb-tut-chk">✓</span>${step.title}</h3>`
        + `<p class="eb-tut-p">${step.body(dev)}</p>`
        + `<div class="eb-tut-keys">${keys}</div>`
        + `<div class="eb-tut-bar"><div class="eb-tut-fill"></div></div>`;
      el.querySelector('.eb-tut-skip')?.addEventListener('click', (e) => {
        e.stopPropagation();
        handle.skip();
      });
    }
    const fill = el.querySelector('.eb-tut-fill') as HTMLElement | null;
    if (fill) fill.style.width = `${Math.round(engine.fraction * 100)}%`;
  };

  const handle: TutorialHandle = {
    engine,
    active: () => engine.active,
    start() {
      lastKey = '';
      engine.start();
    },
    skip() {
      engine.skip();
      markTutorialDone(o.game);
      if (el) el.classList.remove('on', 'ok');
    },
    update(sample: TutorialSample, dev: Dev) {
      const ev = engine.update(sample);
      if (ev === 'step') o.onStep?.(engine.current?.id ?? '');
      else if (ev === 'complete') {
        markTutorialDone(o.game);
        o.onComplete?.();
      }
      paint(dev);
    },
    remove() {
      engine.skip();
      el?.remove();
      el = null;
    },
  };

  if (o.autoStart) handle.start();
  return handle;
}

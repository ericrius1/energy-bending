// The keyboard (and, for the solo layout, the mouse) as an Intent source. Three layouts: 'solo' (one player: WASD,
// J K L, Shift, the mouse plays the bending hand and right-drag turns the free camera), and 'left' / 'right' for two
// players sharing one keyboard (WASD and the arrows). Ported from the prototype's input.js; DOM use is guarded, so the
// tests drive it through keyDown / keyUp / mouseMove / mouseDown / mouseUp.
//   locked | free where they differ
//   solo/left  A D move; W or Space jump | W S depth, Space jump; S crouch | C crouch; J punch (solo: also left click);
//              K kick; L spin; Shift dodge/block; E form; F merge (hold); Tab or V lock; G interact; Q walk (free)
//   right      arrows move, Up jump | Up Down depth, ' jump; Down crouch | ; crouch; , punch; . kick; / spin;
//              right Shift dodge; Enter form; right Ctrl merge; ] lock; \ interact; 0 (numpad) walk
import { makeIntent, nowMs, hasDOM, type Intent, type IntentSource, type InputMode } from './intent';

export type KeyLayout = 'solo' | 'left' | 'right';
interface Layout {
  left: string[]; right: string[]; jump: string[]; down: string[]; punch: string[]; kick: string[]; spin: string[];
  dodge: string[]; form: string[]; merge: string[]; lock: string[]; interact: string[];
  fwd: string[]; back: string[]; freeJump: string[]; freeDown: string[]; walk: string[]; mouse: boolean;
}
export const LAYOUTS: Record<KeyLayout, Layout> = {
  solo: { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'], down: ['KeyS'], punch: ['KeyJ'], kick: ['KeyK'], spin: ['KeyL'],
    dodge: ['ShiftLeft', 'ShiftRight'], form: ['KeyE'], merge: ['KeyF'], lock: ['KeyV', 'Tab'], interact: ['KeyG'],
    fwd: ['KeyW'], back: ['KeyS'], freeJump: ['Space'], freeDown: ['KeyC'], walk: ['KeyQ'], mouse: true },
  left: { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'], down: ['KeyS'], punch: ['KeyJ'], kick: ['KeyK'], spin: ['KeyL'],
    dodge: ['ShiftLeft'], form: ['KeyE'], merge: ['KeyF'], lock: ['KeyV', 'Tab'], interact: ['KeyG'],
    fwd: ['KeyW'], back: ['KeyS'], freeJump: ['Space'], freeDown: ['KeyC'], walk: ['KeyQ'], mouse: false },
  right: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp'], down: ['ArrowDown'], punch: ['Comma'], kick: ['Period'], spin: ['Slash'],
    dodge: ['ShiftRight'], form: ['Enter', 'NumpadEnter'], merge: ['ControlRight'], lock: ['BracketRight'], interact: ['Backslash'],
    fwd: ['ArrowUp'], back: ['ArrowDown'], freeJump: ['Quote'], freeDown: ['Semicolon'], walk: ['Numpad0'], mouse: false },
};
/** every key a layout listens to */
export const keysOf = (layout: KeyLayout) => new Set(Object.values(LAYOUTS[layout]).filter(Array.isArray).flat() as string[]);

export interface KeyboardOptions {
  /** where key events come from (null: none, for tests) and pointer events for the mouse (default: the target) */
  target?: EventTarget | null;
  mouseTarget?: EventTarget | null;
  /** client pixels of the dancer's bending shoulder and of a full arm's reach (solo: the mouse plays the hand) */
  dancerScreen?: () => { x: number; y: number; reach: number } | null;
  /** +1 | -1: which way the dancer faces on screen (left/right layouts aim along it) */
  facing?: () => number;
  preventDefault?: boolean;
}

export class KeyboardSource implements IntentSource {
  readonly name: string;
  mode: InputMode = 'locked';
  readonly L: Layout;
  private keys = new Set<string>();
  private edgeKeys = new Set<string>();
  private mouse = { x: 0, y: 0, t: -1e9, inside: true, down: new Set<number>(), dx: 0, dy: 0 };
  private lastDir: number;
  private mine: Set<string>;
  private handlers: [EventTarget, string, EventListener][] = [];

  constructor(readonly layout: KeyLayout = 'solo', private opts: KeyboardOptions = {}) {
    if (!LAYOUTS[layout]) throw new Error('KeyboardSource: layout must be solo, left or right');
    this.L = LAYOUTS[layout];
    this.name = 'keyboard-' + layout;
    this.lastDir = layout === 'right' ? -1 : 1;
    this.mine = keysOf(layout);
    if (hasDOM && opts.target !== null) this.attach(opts.target || window, opts.mouseTarget || null);
  }
  attach(target: EventTarget, mouseTarget: EventTarget | null) {
    const on = (el: EventTarget, ev: string, fn: (e: any) => void) => { el.addEventListener(ev, fn); this.handlers.push([el, ev, fn]); };
    on(target, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (this.mine.has(e.code)) { if (this.opts.preventDefault !== false) e.preventDefault(); if (!e.repeat) this.keyDown(e.code); }
    });
    on(target, 'keyup', (e: KeyboardEvent) => { if (this.mine.has(e.code)) this.keyUp(e.code); });
    on(target, 'blur', () => { this.keys.clear(); this.mouse.down.clear(); });
    if (this.L.mouse) {
      const mt = mouseTarget || target;
      on(mt, 'pointermove', (e: PointerEvent) => { if (e.pointerType === 'mouse') this.mouseMove(e.clientX, e.clientY); });
      on(mt, 'pointerdown', (e: PointerEvent) => { if (e.pointerType === 'mouse') { this.mouseMove(e.clientX, e.clientY); this.mouseDown(e.button); } });
      on(mt, 'pointerup', (e: PointerEvent) => { if (e.pointerType === 'mouse') this.mouseUp(e.button); });
      on(mt, 'pointerleave', () => { this.mouse.inside = false; });
      on(mt, 'pointerenter', () => { this.mouse.inside = true; });
      on(mt, 'contextmenu', (e: Event) => e.preventDefault());
    }
  }
  detach() { for (const [el, ev, fn] of this.handlers) el.removeEventListener(ev, fn); this.handlers = []; }
  keyDown(code: string) { if (!this.keys.has(code)) this.edgeKeys.add(code); this.keys.add(code); }
  keyUp(code: string) { this.keys.delete(code); }
  mouseMove(x: number, y: number) {
    const m = this.mouse;
    if (m.down.has(2)) { m.dx += x - m.x; m.dy += y - m.y; }
    m.x = x; m.y = y; m.t = nowMs(); m.inside = true;
  }
  mouseDown(b: number) { this.mouse.down.add(b); if (b === 0) { this.edgeKeys.add('Mouse0'); this.keys.add('Mouse0'); } }
  mouseUp(b: number) { this.mouse.down.delete(b); if (b === 0) this.keys.delete('Mouse0'); }

  update(dt = 1 / 60): Intent {
    const L = this.L, any = (list: string[]) => list.some((k) => this.keys.has(k)), edge = (list: string[]) => list.some((k) => this.edgeKeys.has(k));
    const free = this.mode === 'free';
    const o = makeIntent(); o.source = this.name;
    o.moveX = (any(L.right) ? 1 : 0) - (any(L.left) ? 1 : 0);
    if (o.moveX) this.lastDir = o.moveX;
    if (free) {
      o.moveZ = (any(L.fwd) ? 1 : 0) - (any(L.back) ? 1 : 0);
      o.moveY = any(L.freeDown) ? -1 : 0;
      o.jump = edge(L.freeJump); o.jumpHeld = any(L.freeJump);
      o.walk = any(L.walk);
    } else {
      o.moveY = any(L.down) ? -1 : 0;
      o.jump = edge(L.jump); o.jumpHeld = any(L.jump);
    }
    const punchKeys = L.mouse ? [...L.punch, 'Mouse0'] : L.punch;
    o.punch = edge(punchKeys); o.punchHeld = any(punchKeys);
    o.kick = edge(L.kick); o.spin = edge(L.spin);
    o.dodge = edge(L.dodge); o.dodgeHeld = any(L.dodge);
    o.form = edge(L.form); o.merge = any(L.merge);
    o.lock = edge(L.lock); o.interact = edge(L.interact);
    const d = L.mouse && this.opts.dancerScreen ? this.opts.dancerScreen() : null;
    if (L.mouse) {
      const m = this.mouse;
      if (d && d.reach > 0) {
        let ax = (m.x - d.x) / d.reach, ay = -(m.y - d.y) / d.reach;
        const l = Math.hypot(ax, ay); if (l > 1) { ax /= l; ay /= l; }
        o.aimX = ax; o.aimY = ay;
        o.aimActive = m.inside && nowMs() - m.t < 3000 && !(free && m.down.has(2));
      }
      if (free && m.down.has(2) && dt > 0) { o.camX = m.dx / dt / 700; o.camY = -m.dy / dt / 700; }
      m.dx = 0; m.dy = 0;
    }
    if (!o.aimActive && !(d && d.reach > 0)) {
      const f = this.opts.facing ? this.opts.facing() : this.lastDir;
      o.aimX = (f < 0 ? -1 : 1) * 0.9; o.aimY = 0.06; o.aimActive = false;
    }
    this.edgeKeys.clear();
    return o;
  }
}

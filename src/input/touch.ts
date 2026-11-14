// A touch screen as an Intent source: a virtual stick wherever the left thumb lands, the right half a drag for the
// bending hand (locked) or the camera (free, unless the 'hand' button is held), and buttons by name. `buttons` lists
// what a page should draw (input/touch-pad.ts draws them). Ported from the prototype's input.js; the tests drive it
// through down / move / up and press / release.
// The duel's scheme (`scheme = 'duel'`): a swipe of the stick's thumb (from near where it landed to past the rim in
// under 0.12 s) dashes that way, and the 'dash' button (shown only then) dashes along the stick, or the facing.
import { Buttons, makeIntent, radialDeadzone, hasDOM, type Intent, type IntentSource, type InputMode, type Scheme } from './intent';

/** a button a touch page draws: its name (what press() takes), whether it is held (not tapped), free mode only, the
 *  duel's scheme only */
export interface TouchButton { name: string; label: string; hold?: boolean; freeOnly?: boolean; duelOnly?: boolean }

export const TOUCH_BUTTONS: TouchButton[] = [
  { name: 'jump', label: 'jump' }, { name: 'strike', label: 'strike' }, { name: 'kick', label: 'kick' }, { name: 'spin', label: 'spin' },
  { name: 'dash', label: 'dash', duelOnly: true },
  { name: 'dodge', label: 'dodge', hold: true }, { name: 'form', label: 'form' }, { name: 'merge', label: 'merge', hold: true },
  { name: 'lock', label: 'lock' }, { name: 'interact', label: 'use' }, { name: 'hand', label: 'hand', hold: true, freeOnly: true },
];

interface Rect { left: number; top: number; width: number; height: number }

export class TouchSource implements IntentSource {
  readonly name = 'touch';
  mode: InputMode = 'locked';
  scheme: Scheme = 'jogo';
  /** the swipe: how long the stick's thumb has been out past the centre's dead area, and whether it is past the rim */
  private swipeT = 0;
  private swipeOut = false;
  readonly buttons = TOUCH_BUTTONS;
  readonly R: number;
  readonly stick = { active: false, id: null as number | null, ox: 0, oy: 0, x: 0, y: 0 };
  readonly hand = { active: false, id: null as number | null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 };
  private btn = new Buttons();
  private handlers: [string, EventListener][] = [];

  constructor(private el: HTMLElement | null, private opts: { stickRadius?: number; rect?: () => Rect; acceptTarget?: (t: EventTarget | null) => boolean } = {}) {
    this.R = opts.stickRadius || 60;
    if (hasDOM && el && el.addEventListener) {
      const ok = (e: PointerEvent) => e.pointerType !== 'mouse' && (e.target === el || !!opts.acceptTarget?.(e.target));
      const on = (ev: string, fn: (e: PointerEvent) => void) => { el.addEventListener(ev, fn as EventListener); this.handlers.push([ev, fn as EventListener]); };
      on('pointerdown', (e) => { if (ok(e)) { this.down(e.pointerId, e.clientX, e.clientY); el.setPointerCapture?.(e.pointerId); } });
      on('pointermove', (e) => this.move(e.pointerId, e.clientX, e.clientY));
      on('pointerup', (e) => this.up(e.pointerId));
      on('pointercancel', (e) => this.up(e.pointerId));
    }
  }
  detach() { for (const [ev, fn] of this.handlers) this.el?.removeEventListener(ev, fn); this.handlers = []; }
  press(name: string) { this.btn.press(name); }
  release(name: string) { this.btn.release(name); }
  private rect(): Rect { if (this.opts.rect) return this.opts.rect(); if (this.el) return this.el.getBoundingClientRect(); return { left: 0, top: 0, width: 800, height: 450 }; }
  down(id: number, x: number, y: number) {
    const r = this.rect();
    if (x < r.left + r.width / 2) { if (!this.stick.active) Object.assign(this.stick, { active: true, id, ox: x, oy: y, x, y }); }
    else if (!this.hand.active) Object.assign(this.hand, { active: true, id, ox: x, oy: y, x, y, dx: 0, dy: 0 });
  }
  move(id: number, x: number, y: number) {
    if (this.stick.active && this.stick.id === id) { this.stick.x = x; this.stick.y = y; }
    if (this.hand.active && this.hand.id === id) { this.hand.dx += x - this.hand.x; this.hand.dy += y - this.hand.y; this.hand.x = x; this.hand.y = y; }
  }
  up(id: number) {
    if (this.stick.id === id) { this.stick.active = false; this.stick.id = null; }
    if (this.hand.id === id) { this.hand.active = false; this.hand.id = null; }
  }
  update(dt = 1 / 60): Intent {
    const o = makeIntent(); o.source = this.name;
    const free = this.mode === 'free', B = this.btn;
    if (this.stick.active) {
      const rx = (this.stick.x - this.stick.ox) / this.R, ry = -(this.stick.y - this.stick.oy) / this.R;
      const [sx, sy] = radialDeadzone(rx, ry, 0.15, 1);
      o.moveX = sx;
      if (free) o.moveZ = sy; else o.moveY = sy;
      // the duel's swipe: out past the rim within 0.12 s of leaving the centre
      const m = Math.hypot(rx, ry);
      if (m < 0.35) { this.swipeT = 0; this.swipeOut = false; }
      else {
        this.swipeT += dt;
        if (!this.swipeOut && m >= 1.1) { this.swipeOut = true; if (this.scheme === 'duel' && this.swipeT <= 0.12 + dt * 0.5) o.dash = true; }
      }
    } else { this.swipeT = 0; this.swipeOut = false; }
    const handMode = !free || B.held('hand');
    if (this.hand.active) {
      if (handMode) {
        let ax = (this.hand.x - this.hand.ox) / (this.R * 1.6), ay = -(this.hand.y - this.hand.oy) / (this.R * 1.6);
        const l = Math.hypot(ax, ay); if (l > 1) { ax /= l; ay /= l; }
        o.aimX = ax; o.aimY = ay; o.aimActive = true;
      } else if (dt > 0) { o.camX = this.hand.dx / dt / 700; o.camY = -this.hand.dy / dt / 700; }
    }
    this.hand.dx = 0; this.hand.dy = 0;
    o.jump = B.took('jump'); o.jumpHeld = B.held('jump');
    o.punch = B.took('strike'); o.punchHeld = B.held('strike');
    o.kick = B.took('kick'); o.spin = B.took('spin');
    o.dodge = B.took('dodge'); o.dodgeHeld = B.held('dodge');
    o.form = B.took('form'); o.merge = B.held('merge');
    o.lock = B.took('lock'); o.interact = B.took('interact');
    if (this.scheme === 'duel' && B.took('dash')) o.dash = true;
    B.clear();
    return o;
  }
}

/** a bot is just a source: fn(dt, intent, source) fills a fresh neutral Intent each frame */
export class BotSource implements IntentSource {
  mode: InputMode = 'locked';
  constructor(public fn: ((dt: number, it: Intent, src: BotSource) => void) | null, readonly name = 'bot') {}
  update(dt = 1 / 60): Intent { const o = makeIntent(); o.source = this.name; this.fn?.(dt, o, this); return o; }
}

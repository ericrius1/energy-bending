// Gamepads (the standard mapping, an Xbox layout) as Intent sources, and a hub that notices pads coming and going
// (hot-join). Ported from the prototype's input.js. `getPads` can be faked, so the tests drive it with plain objects.
//   locked: left stick move (analog), A jump, X strike/throw, B kick, Y spin, LB/RB aú left/right, RT dodge/block,
//           LT form, right stick = the bending hand (a flick = a directional strike), both stick clicks or Y held 0.6 s
//           = merge, View = lock, d-pad up = interact.
//   free:   left stick = moveX/moveZ, d-pad down = crouch, right stick = camera unless LB is held (then it is the
//           bending hand); everything else as locked.
//   the duel's scheme (`scheme = 'duel'`, docs/design/duel.md): RT or B dash (the left stick's way), Y kick, LB spin
//           (an aú when the stick is pushed), RB dodge/block (held: it holds); merge only on both stick clicks.
import { Buttons, Hysteresis, makeIntent, radialDeadzone, hasDOM, type Intent, type IntentSource, type InputMode, type Scheme } from './intent';

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** what we need of a Gamepad (the real one, or a test's fake) */
export interface PadLike {
  id: string;
  connected?: boolean;
  axes: readonly number[];
  buttons: readonly ({ pressed: boolean; value: number } | number)[];
  vibrationActuator?: { type?: string; playEffect?: (type: string, o: Record<string, number>) => unknown } | null;
}
export type GetPads = () => readonly (PadLike | null)[];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const padsOf = (getPads?: GetPads): (PadLike | null)[] => {
  try {
    const list = getPads ? getPads() : typeof navigator !== 'undefined' && navigator.getGamepads ? (navigator.getGamepads() as unknown as (PadLike | null)[]) : [];
    return Array.from(list || []);
  } catch { return []; }
};

export class GamepadSource implements IntentSource {
  readonly name: string;
  mode: InputMode = 'locked';
  scheme: Scheme = 'jogo';
  connected = false;
  id = '';
  deadzone: number;
  aimDeadzone: number;
  private btn = new Buttons();
  private rt = new Hysteresis(0.5, 0.35);
  private lt = new Hysteresis(0.5, 0.35);
  private yHeldT = 0;
  private rPrevMag = 0;
  private rLowT = 0;

  constructor(readonly index = 0, private opts: { getPads?: GetPads; deadzone?: number; aimDeadzone?: number } = {}) {
    this.name = 'gamepad-' + index;
    this.deadzone = opts.deadzone ?? 0.2;
    this.aimDeadzone = opts.aimDeadzone ?? 0.25;
  }
  pad() { const p = padsOf(this.opts.getPads)[this.index]; return p && p.connected !== false ? p : null; }
  /** a buzz (0..1, ms) where the browser supports it; false where it doesn't */
  rumble(strength = 0.5, ms = 120) {
    const p = this.pad(), a = p && p.vibrationActuator;
    if (!a || !a.playEffect) return false;
    try { a.playEffect(a.type || 'dual-rumble', { duration: ms, startDelay: 0, strongMagnitude: clamp(strength, 0, 1), weakMagnitude: clamp(strength * 0.7, 0, 1) }); return true; } catch { return false; }
  }
  /** whether any button is down or a stick pushed (for joining a player) */
  active() {
    const p = this.pad();
    if (!p) return false;
    return p.buttons.some((x) => (typeof x === 'object' ? x.pressed || x.value > 0.5 : x > 0.5)) || p.axes.some((a) => Math.abs(a) > 0.6);
  }
  update(dt = 1 / 60): Intent {
    const o = makeIntent(); o.source = this.name;
    const p = this.pad();
    this.connected = !!p;
    if (!p) { this.btn.reset(); return o; }
    this.id = p.id || '';
    const b = (i: number) => { const x = p.buttons && p.buttons[i]; return !!x && (typeof x === 'object' ? x.pressed || x.value > 0.5 : x > 0.5); };
    const val = (i: number) => { const x = p.buttons && p.buttons[i]; return !x ? 0 : typeof x === 'object' ? x.value ?? (x.pressed ? 1 : 0) : +x; };
    const ax = (i: number) => (p.axes && Number.isFinite(p.axes[i]) ? p.axes[i] : 0);
    const B = this.btn;
    const set = (name: string, on: boolean) => (on ? B.press(name) : B.release(name));
    set('A', b(BTN.A)); set('B', b(BTN.B)); set('X', b(BTN.X)); set('Y', b(BTN.Y));
    set('LB', b(BTN.LB)); set('RB', b(BTN.RB)); set('VIEW', b(BTN.VIEW)); set('UP', b(BTN.UP));
    set('RT', this.rt.update(val(BTN.RT))); set('LT', this.lt.update(val(BTN.LT)));
    set('LSRS', b(BTN.LS) && b(BTN.RS));
    const free = this.mode === 'free';
    const [lx, ly] = radialDeadzone(ax(0), -ax(1), this.deadzone);
    const dpx = (b(BTN.RIGHT) ? 1 : 0) - (b(BTN.LEFT) ? 1 : 0);
    if (free) { o.moveX = dpx || lx; o.moveZ = ly; o.moveY = b(BTN.DOWN) ? -1 : 0; }
    else { o.moveX = dpx || lx; o.moveY = (b(BTN.DOWN) ? -1 : 0) || ly; }
    o.jump = B.took('A'); o.jumpHeld = B.held('A');
    if (this.scheme === 'duel') {
      o.dash = B.took('RT') || B.took('B');
      o.kick = B.took('Y');
      o.spin = B.took('LB');
      o.dodge = B.took('RB'); o.dodgeHeld = B.held('RB');
      this.yHeldT = 0;
    } else {
      o.kick = B.took('B');
      o.spin = B.took('Y');
      if (!free) { if (B.took('LB')) { o.spin = true; o.auDir = -1; } if (B.took('RB')) { o.spin = true; o.auDir = 1; } }
      o.dodge = B.took('RT'); o.dodgeHeld = B.held('RT');
      this.yHeldT = B.held('Y') ? this.yHeldT + dt : 0;
    }
    o.form = B.took('LT');
    o.merge = B.held('LSRS') || this.yHeldT >= 0.6;
    o.lock = B.took('VIEW'); o.interact = B.took('UP');
    // right stick: the bending hand, or the camera
    const rx = ax(2), ry = -ax(3);
    const handStick = !free || B.held('LB');
    const raw = Math.hypot(rx, ry);
    o.punch = B.took('X'); o.punchHeld = B.held('X');
    if (handStick) {
      const [hx, hy] = radialDeadzone(rx, ry, this.aimDeadzone, 0.95);
      o.aimX = hx; o.aimY = hy; o.aimActive = hx !== 0 || hy !== 0;
      // a flick: from near the centre to the rim in under 0.1 s
      if (raw < 0.3) this.rLowT = 0; else this.rLowT += dt;
      if (this.rPrevMag < 0.9 && raw >= 0.9 && this.rLowT <= 0.1 + dt * 0.5) { o.punch = true; o.flick = true; }
    } else {
      const [cx, cy] = radialDeadzone(rx, ry, 0.15, 0.95);
      o.camX = cx; o.camY = cy;
      this.rLowT = raw < 0.3 ? 0 : this.rLowT + dt;
    }
    this.rPrevMag = raw;
    B.clear();
    return o;
  }
}

/** notices pads connecting and disconnecting (events where the browser sends them, and polling for those that only
 *  show a pad after a button press) and keeps one GamepadSource per index */
export class GamepadHub {
  private known = new Map<number, string>();
  private sources = new Map<number, GamepadSource>();
  private fns: Record<'connect' | 'disconnect', ((index: number, id: string) => void)[]> = { connect: [], disconnect: [] };
  private target: EventTarget | null = null;
  private onC = (e: Event) => { const g = (e as GamepadEvent).gamepad; this.seen(g.index, g.id, true); };
  private onD = (e: Event) => { const g = (e as GamepadEvent).gamepad; this.seen(g.index, g.id, false); };

  constructor(private opts: { getPads?: GetPads; target?: EventTarget | null } = {}) {
    if (hasDOM && opts.target !== null) {
      this.target = opts.target || window;
      this.target.addEventListener('gamepadconnected', this.onC);
      this.target.addEventListener('gamepaddisconnected', this.onD);
    }
  }
  on(type: 'connect' | 'disconnect', fn: (index: number, id: string) => void) { this.fns[type].push(fn); return this; }
  private seen(i: number, id: string, on: boolean) {
    const was = this.known.has(i);
    if (on && !was) { this.known.set(i, id); for (const f of this.fns.connect) f(i, id); }
    else if (!on && was) { this.known.delete(i); for (const f of this.fns.disconnect) f(i, id); }
  }
  /** poll */
  update() {
    const pads = padsOf(this.opts.getPads), seen = new Set<number>();
    pads.forEach((p, i) => { if (p && p.connected !== false) { seen.add(i); this.seen(i, p.id, true); } });
    for (const i of [...this.known.keys()]) if (!seen.has(i)) this.seen(i, this.known.get(i)!, false);
  }
  indices() { return [...this.known.keys()].sort((a, b) => a - b); }
  source(i: number) { let s = this.sources.get(i); if (!s) { s = new GamepadSource(i, { getPads: this.opts.getPads }); this.sources.set(i, s); } return s; }
  dispose() { if (this.target) { this.target.removeEventListener('gamepadconnected', this.onC); this.target.removeEventListener('gamepaddisconnected', this.onD); } }
}

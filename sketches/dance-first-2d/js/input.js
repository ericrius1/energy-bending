// input.js — one Intent per player per frame, whatever the device. ES module; DOM use is guarded so the
// pure parts (dead zones, edges, gestures) run in Node.
//
// INTENT (DESIGN.md "Controls", plus the 3-D fields):
//   moveX  -1..1 right       moveY  -1..1 (+ up; < -0.5 = crouch / drop / fast fall)
//   moveZ  -1..1 + = into the screen (away from the camera); ignored in the locked 2-D view
//   jump (edge)  jumpHeld   punch (edge)  kick (edge)  spin (edge)  dodge (edge)  form (edge)  merge (held)
//   aimX, aimY  the bending hand: direction and reach (length 0..1) in the screen plane, relative to the
//               dancer's shoulder; aimActive  whether the hand is being played
//   camX, camY  free-camera look rate (-1..1 for a stick; a fast mouse drag may exceed 1)
//   lock (edge) toggle the 2-D lock      interact (edge) use a portal / build
// Extras (optional; Character uses them when present):
//   dodgeHeld, punchHeld   the held state of those buttons (block hold, strike held into a throw)
//   auDir  -1|+1 with spin: a cartwheel that way (gamepad bumpers)    flick  the punch came from a stick flick
//   limb ('LW'|'RW'|'LA'|'RA'), pose (26), pose3 (39), hasLegs, pinch  from CameraSource
//   source  the source's name
// Edges are resolved per update(): a press between two updates is reported once, however short.
//
// SOURCES (all have update(dt) -> Intent, a `mode` property 'locked' | 'free', and name):
//   new KeyboardSource(layout = 'solo' | 'left' | 'right', { target = window, mouseTarget, dancerScreen, facing, preventDefault = true })
//       dancerScreen() -> { x, y, reach } client pixels of the dancer's bending shoulder and of a full arm's
//       reach (solo layout: the mouse plays the hand). facing() -> +1|-1 (left/right layouts aim along it).
//       Keys (locked | free where they differ):
//         solo/left  A D move; W or Space jump | W S depth, Space jump; S crouch | C crouch; J punch (solo: also
//                    left click); K kick; L spin; Shift dodge/block; E form; F merge (hold); V lock; G interact.
//                    solo: mouse = bending hand; right-drag = camera (free).
//         right      arrows move, Up jump | Up Down depth, ' jump; Down crouch | ; crouch; , punch; . kick;
//                    / spin; right Shift dodge; Enter form; right Ctrl merge; ] lock; \ interact.
//       Testing hooks: keyDown(code), keyUp(code), mouseMove(x, y), mouseDown(button), mouseUp(button).
//   new GamepadSource(index, { getPads }) .connected .id .rumble(strength 0..1, ms)
//       locked: left stick move (analog), A jump, X strike/throw, B kick, Y spin, LB/RB aú left/right,
//               RT dodge/block, LT form, right stick = bending hand (a flick = a directional strike),
//               both stick clicks or Y held 0.6 s = merge, View = lock, d-pad up = interact.
//       free:   left stick = moveX/moveZ, d-pad down = crouch, right stick = camera unless LB is held
//               (then it is the bending hand); everything else as locked.
//   new GamepadHub({ getPads, target }) .update() .on('connect'|'disconnect', fn(index, id)) .source(index) .indices()
//   new TouchSource(element, { stickRadius = 60, acceptTarget }) .buttons [{ name, hold }] .press(name) .release(name)
//       .stick { active, ox, oy, x, y } (client px, for drawing) .hand { active, ox, oy, x, y }. Left half: a
//       virtual stick where the thumb lands. Right half: drag = bending hand (locked) or camera (free, unless
//       the 'hand' button is held). Testing hooks: down(id, x, y), move(id, x, y), up(id).
//   new CameraSource(tracker, { aimHand = 'R', jumpHand = 'L' })   see the class comment below.
//   new BotSource(fn)   fn(dt, intent) fills a fresh neutral intent each frame: a bot is just a source.
// Helpers: makeIntent(), mergeIntents(a, b) (either device drives), radialDeadzone(x, y, inner, outer),
//   Hysteresis(on, off), PeakDetector.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function makeIntent() {
  return {
    moveX: 0, moveY: 0, moveZ: 0, jump: false, jumpHeld: false, punch: false, kick: false, spin: false, dodge: false,
    form: false, merge: false, aimX: 0, aimY: 0, aimActive: false, camX: 0, camY: 0, lock: false, interact: false,
    dodgeHeld: false, punchHeld: false,
  };
}
const EDGES = ['jump', 'punch', 'kick', 'spin', 'dodge', 'form', 'lock', 'interact'];
const HELDS = ['jumpHeld', 'merge', 'dodgeHeld', 'punchHeld', 'aimActive'];
export function mergeIntents(a, b) {
  const o = makeIntent();
  const big = (x, y) => (Math.abs(x) >= Math.abs(y) ? x : y);
  for (const k of ['moveX', 'moveY', 'moveZ', 'camX', 'camY']) o[k] = big(a[k] || 0, b[k] || 0);
  for (const k of [...EDGES, ...HELDS]) o[k] = !!(a[k] || b[k]);
  const src = b.aimActive && !a.aimActive ? b : a;
  o.aimX = src.aimX; o.aimY = src.aimY;
  for (const k of ['auDir', 'flick', 'limb', 'pose', 'pose3', 'hasLegs']) if (a[k] != null || b[k] != null) o[k] = a[k] ?? b[k];
  return o;
}

// Radial dead zone with rescale: |v| < inner -> 0, inner..outer -> 0..1 (direction kept), > outer -> 1.
export function radialDeadzone(x, y, inner = 0.2, outer = 0.95) {
  const m = Math.hypot(x, y);
  if (m < inner || m === 0) return [0, 0];
  const k = clamp((m - inner) / (outer - inner), 0, 1) / m;
  return [x * k, y * k];
}
export class Hysteresis {
  constructor(on, off) { this.on = on; this.off = off; this.state = false; }
  update(v) { if (!this.state && v >= this.on) this.state = true; else if (this.state && v <= this.off) this.state = false; return this.state; }
}
// A speed peak: rises above `min`, then falls below `drop` x the peak -> fires once with the peak value.
export class PeakDetector {
  constructor(min, drop = 0.5, cool = 0.3) { this.min = min; this.drop = drop; this.cool = cool; this.peak = 0; this.t = 0; }
  update(v, dt) {
    this.t = Math.max(0, this.t - dt);
    if (v > this.peak) { this.peak = v; return 0; }
    if (this.peak >= this.min && v < this.peak * this.drop) { const p = this.peak; this.peak = v; if (this.t <= 0) { this.t = this.cool; return p; } return 0; }
    if (v < this.min * 0.3) this.peak = v;
    return 0;
  }
}

// Edge/held bookkeeping shared by the sources.
class Buttons {
  constructor() { this.down = new Set(); this.edges = new Set(); }
  press(n) { if (!this.down.has(n)) { this.down.add(n); this.edges.add(n); } }
  release(n) { this.down.delete(n); }
  held(n) { return this.down.has(n); }
  took(n) { const e = this.edges.has(n); return e; }
  clear() { this.edges.clear(); }
  reset() { this.down.clear(); this.edges.clear(); }
}

// ---------------------------------------------------------------- keyboard (+ mouse)
const LAYOUTS = {
  solo: { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'], down: ['KeyS'], punch: ['KeyJ'], kick: ['KeyK'], spin: ['KeyL'],
    dodge: ['ShiftLeft', 'ShiftRight'], form: ['KeyE'], merge: ['KeyF'], lock: ['KeyV'], interact: ['KeyG'],
    fwd: ['KeyW'], back: ['KeyS'], freeJump: ['Space'], freeDown: ['KeyC'], mouse: true },
  left: { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'], down: ['KeyS'], punch: ['KeyJ'], kick: ['KeyK'], spin: ['KeyL'],
    dodge: ['ShiftLeft'], form: ['KeyE'], merge: ['KeyF'], lock: ['KeyV'], interact: ['KeyG'],
    fwd: ['KeyW'], back: ['KeyS'], freeJump: ['Space'], freeDown: ['KeyC'], mouse: false },
  right: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp'], down: ['ArrowDown'], punch: ['Comma'], kick: ['Period'], spin: ['Slash'],
    dodge: ['ShiftRight'], form: ['Enter', 'NumpadEnter'], merge: ['ControlRight'], lock: ['BracketRight'], interact: ['Backslash'],
    fwd: ['ArrowUp'], back: ['ArrowDown'], freeJump: ['Quote'], freeDown: ['Semicolon'], mouse: false },
};

export class KeyboardSource {
  constructor(layout = 'solo', opts = {}) {
    if (!LAYOUTS[layout]) throw new Error('KeyboardSource: layout must be solo, left or right');
    this.layout = layout; this.L = LAYOUTS[layout]; this.opts = opts; this.name = 'keyboard-' + layout;
    this.mode = 'locked';
    this.keys = new Set(); this.edgeKeys = new Set();
    this.mouse = { x: 0, y: 0, t: -1e9, inside: true, down: new Set(), dx: 0, dy: 0 };
    this.lastDir = layout === 'right' ? -1 : 1;
    this.mine = new Set(Object.entries(this.L).filter(([k, v]) => Array.isArray(v)).flatMap(([, v]) => v));
    this._handlers = [];
    if (hasDOM && opts.target !== null) this.attach(opts.target || window, opts.mouseTarget || null);
  }
  attach(target, mouseTarget) {
    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); this._handlers.push([el, ev, fn, o]); };
    on(target, 'keydown', e => { if (this.mine.has(e.code)) { if (this.opts.preventDefault !== false) e.preventDefault(); if (!e.repeat) this.keyDown(e.code); } });
    on(target, 'keyup', e => { if (this.mine.has(e.code)) this.keyUp(e.code); });
    on(target, 'blur', () => { this.keys.clear(); this.mouse.down.clear(); });
    if (this.L.mouse) {
      const mt = mouseTarget || target;
      on(mt, 'pointermove', e => { if (e.pointerType === 'mouse') this.mouseMove(e.clientX, e.clientY); });
      on(mt, 'pointerdown', e => { if (e.pointerType === 'mouse') { this.mouseMove(e.clientX, e.clientY); this.mouseDown(e.button); } });
      on(mt, 'pointerup', e => { if (e.pointerType === 'mouse') this.mouseUp(e.button); });
      on(mt, 'pointerleave', () => { this.mouse.inside = false; });
      on(mt, 'pointerenter', () => { this.mouse.inside = true; });
      on(mt, 'contextmenu', e => e.preventDefault());
    }
  }
  detach() { for (const [el, ev, fn, o] of this._handlers) el.removeEventListener(ev, fn, o); this._handlers = []; }
  keyDown(code) { if (!this.keys.has(code)) this.edgeKeys.add(code); this.keys.add(code); }
  keyUp(code) { this.keys.delete(code); }
  mouseMove(x, y) {
    const m = this.mouse;
    if (m.down.has(2)) { m.dx += x - m.x; m.dy += y - m.y; }
    m.x = x; m.y = y; m.t = nowMs(); m.inside = true;
  }
  mouseDown(b) { this.mouse.down.add(b); if (b === 0) this.edgeKeys.add('Mouse0'), this.keys.add('Mouse0'); }
  mouseUp(b) { this.mouse.down.delete(b); if (b === 0) this.keys.delete('Mouse0'); }

  update(dt = 1 / 60) {
    const L = this.L, any = list => list.some(k => this.keys.has(k)), edge = list => list.some(k => this.edgeKeys.has(k));
    const free = this.mode === 'free';
    const o = makeIntent(); o.source = this.name;
    o.moveX = (any(L.right) ? 1 : 0) - (any(L.left) ? 1 : 0);
    if (o.moveX) this.lastDir = o.moveX;
    if (free) {
      o.moveZ = (any(L.fwd) ? 1 : 0) - (any(L.back) ? 1 : 0);
      o.moveY = any(L.freeDown) ? -1 : 0;
      o.jump = edge(L.freeJump); o.jumpHeld = any(L.freeJump);
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
    if (L.mouse && this.opts.dancerScreen) {
      const d = this.opts.dancerScreen(), m = this.mouse;
      if (d && d.reach > 0) {
        let ax = (m.x - d.x) / d.reach, ay = -(m.y - d.y) / d.reach;
        const l = Math.hypot(ax, ay); if (l > 1) { ax /= l; ay /= l; }
        o.aimX = ax; o.aimY = ay;
        o.aimActive = m.inside && nowMs() - m.t < 3000 && !(free && m.down.has(2));
      }
      if (free && m.down.has(2) && dt > 0) { o.camX = m.dx / dt / 700; o.camY = -m.dy / dt / 700; }
      m.dx = 0; m.dy = 0;
    } else {
      const f = this.opts.facing ? this.opts.facing() : this.lastDir;
      o.aimX = (f < 0 ? -1 : 1) * 0.9; o.aimY = 0.06; o.aimActive = false;
    }
    this.edgeKeys.clear();
    return o;
  }
}

// ---------------------------------------------------------------- gamepad
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const padsOf = getPads => { try { return Array.from((getPads ? getPads() : (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [])) || []); } catch (e) { return []; } };
export class GamepadSource {
  constructor(index = 0, opts = {}) {
    this.index = index; this.opts = opts; this.name = 'gamepad-' + index; this.mode = 'locked';
    this.btn = new Buttons();
    this.rt = new Hysteresis(0.5, 0.35); this.lt = new Hysteresis(0.5, 0.35);
    this.yHeldT = 0; this.flickT = 1; this.rPrevMag = 0; this.rLowT = 0;
    this.connected = false; this.id = '';
    this.deadzone = opts.deadzone ?? 0.2; this.aimDeadzone = opts.aimDeadzone ?? 0.25;
  }
  pad() { const p = padsOf(this.opts.getPads)[this.index]; return p && p.connected !== false ? p : null; }
  rumble(strength = 0.5, ms = 120) {
    const p = this.pad(), a = p && p.vibrationActuator;
    if (!a || !a.playEffect) return false;
    try { a.playEffect(a.type || 'dual-rumble', { duration: ms, startDelay: 0, strongMagnitude: clamp(strength, 0, 1), weakMagnitude: clamp(strength * 0.7, 0, 1) }); return true; } catch (e) { return false; }
  }
  update(dt = 1 / 60) {
    const o = makeIntent(); o.source = this.name;
    const p = this.pad();
    this.connected = !!p;
    if (!p) { this.btn.reset(); return o; }
    this.id = p.id || '';
    const b = i => { const x = p.buttons && p.buttons[i]; return !!x && (typeof x === 'object' ? x.pressed || x.value > 0.5 : x > 0.5); };
    const val = i => { const x = p.buttons && p.buttons[i]; return !x ? 0 : typeof x === 'object' ? x.value ?? (x.pressed ? 1 : 0) : +x; };
    const ax = i => (p.axes && Number.isFinite(p.axes[i]) ? p.axes[i] : 0);
    const B = this.btn;
    const set = (name, on) => (on ? B.press(name) : B.release(name));
    set('A', b(BTN.A)); set('B', b(BTN.B)); set('X', b(BTN.X)); set('Y', b(BTN.Y));
    set('LB', b(BTN.LB)); set('RB', b(BTN.RB)); set('VIEW', b(BTN.VIEW)); set('UP', b(BTN.UP));
    set('RT', this.rt.update(val(BTN.RT))); set('LT', this.lt.update(val(BTN.LT)));
    set('LSRS', b(BTN.LS) && b(BTN.RS));
    const free = this.mode === 'free';
    let [lx, ly] = radialDeadzone(ax(0), -ax(1), this.deadzone);
    const dpx = (b(BTN.RIGHT) ? 1 : 0) - (b(BTN.LEFT) ? 1 : 0), dpy = (b(BTN.UP) ? 1 : 0) - (b(BTN.DOWN) ? 1 : 0);
    if (free) {
      o.moveX = dpx || lx; o.moveZ = ly; o.moveY = b(BTN.DOWN) ? -1 : 0;
    } else {
      o.moveX = dpx || lx; o.moveY = (b(BTN.DOWN) ? -1 : 0) || ly;
    }
    o.jump = B.took('A'); o.jumpHeld = B.held('A');
    o.kick = B.took('B');
    o.spin = B.took('Y');
    if (!free) { if (B.took('LB')) { o.spin = true; o.auDir = -1; } if (B.took('RB')) { o.spin = true; o.auDir = 1; } }
    o.dodge = B.took('RT'); o.dodgeHeld = B.held('RT');
    o.form = B.took('LT');
    this.yHeldT = B.held('Y') ? this.yHeldT + dt : 0;
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

export class GamepadHub {
  constructor(opts = {}) {
    this.opts = opts; this.known = new Map(); this.sources = new Map(); this.fns = { connect: [], disconnect: [] };
    if (hasDOM && opts.target !== null) {
      const t = opts.target || window;
      this._c = e => this._seen(e.gamepad.index, e.gamepad.id, true);
      this._d = e => this._seen(e.gamepad.index, e.gamepad.id, false);
      t.addEventListener('gamepadconnected', this._c); t.addEventListener('gamepaddisconnected', this._d);
      this._t = t;
    }
  }
  on(type, fn) { (this.fns[type] || (this.fns[type] = [])).push(fn); return this; }
  _seen(i, id, on) {
    const was = this.known.has(i);
    if (on && !was) { this.known.set(i, id); for (const f of this.fns.connect) f(i, id); }
    else if (!on && was) { this.known.delete(i); for (const f of this.fns.disconnect) f(i, id); }
  }
  // poll (some browsers only report pads through getGamepads after a button press)
  update() {
    const pads = padsOf(this.opts.getPads), seen = new Set();
    pads.forEach((p, i) => { if (p && p.connected !== false) { seen.add(i); this._seen(i, p.id, true); } });
    for (const i of [...this.known.keys()]) if (!seen.has(i)) this._seen(i, this.known.get(i), false);
  }
  indices() { return [...this.known.keys()].sort((a, b) => a - b); }
  source(i) { if (!this.sources.has(i)) this.sources.set(i, new GamepadSource(i, { getPads: this.opts.getPads })); return this.sources.get(i); }
  dispose() { if (this._t) { this._t.removeEventListener('gamepadconnected', this._c); this._t.removeEventListener('gamepaddisconnected', this._d); } }
}

// ---------------------------------------------------------------- touch
export class TouchSource {
  constructor(element, opts = {}) {
    this.el = element; this.opts = opts; this.name = 'touch'; this.mode = 'locked';
    this.R = opts.stickRadius || 60;
    this.btn = new Buttons();
    this.buttons = [
      { name: 'jump' }, { name: 'strike' }, { name: 'kick' }, { name: 'spin' }, { name: 'dodge', hold: true }, { name: 'form' },
      { name: 'merge', hold: true }, { name: 'lock' }, { name: 'interact' }, { name: 'hand', hold: true, freeOnly: true },
    ];
    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.hand = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0 };
    this._h = [];
    if (hasDOM && element && element.addEventListener) {
      const ok = e => e.pointerType !== 'mouse' && (e.target === element || (opts.acceptTarget && opts.acceptTarget(e.target)));
      const on = (ev, fn) => { element.addEventListener(ev, fn); this._h.push([ev, fn]); };
      on('pointerdown', e => { if (ok(e)) { this.down(e.pointerId, e.clientX, e.clientY); element.setPointerCapture?.(e.pointerId); } });
      on('pointermove', e => this.move(e.pointerId, e.clientX, e.clientY));
      on('pointerup', e => this.up(e.pointerId));
      on('pointercancel', e => this.up(e.pointerId));
    }
  }
  detach() { for (const [ev, fn] of this._h) this.el.removeEventListener(ev, fn); this._h = []; }
  press(name) { this.btn.press(name); }
  release(name) { this.btn.release(name); }
  _rect() { if (this.opts.rect) return this.opts.rect(); if (this.el && this.el.getBoundingClientRect) return this.el.getBoundingClientRect(); return { left: 0, top: 0, width: 800, height: 450 }; }
  down(id, x, y) {
    const r = this._rect();
    if (x < r.left + r.width / 2) { if (!this.stick.active) Object.assign(this.stick, { active: true, id, ox: x, oy: y, x, y }); }
    else if (!this.hand.active) Object.assign(this.hand, { active: true, id, ox: x, oy: y, x, y, px: x, py: y, dx: 0, dy: 0 });
  }
  move(id, x, y) {
    if (this.stick.active && this.stick.id === id) { this.stick.x = x; this.stick.y = y; }
    if (this.hand.active && this.hand.id === id) { this.hand.dx += x - this.hand.x; this.hand.dy += y - this.hand.y; this.hand.x = x; this.hand.y = y; }
  }
  up(id) {
    if (this.stick.id === id) { this.stick.active = false; this.stick.id = null; }
    if (this.hand.id === id) { this.hand.active = false; this.hand.id = null; }
  }
  update(dt = 1 / 60) {
    const o = makeIntent(); o.source = this.name;
    const free = this.mode === 'free', B = this.btn;
    if (this.stick.active) {
      const [sx, sy] = radialDeadzone((this.stick.x - this.stick.ox) / this.R, -(this.stick.y - this.stick.oy) / this.R, 0.15, 1);
      o.moveX = sx;
      if (free) o.moveZ = sy; else o.moveY = sy;
    }
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
    B.clear();
    return o;
  }
}

// ---------------------------------------------------------------- bot
export class BotSource {
  constructor(fn, name = 'bot') { this.fn = fn; this.name = name; this.mode = 'locked'; }
  update(dt = 1 / 60) { const o = makeIntent(); o.source = this.name; this.fn && this.fn(dt, o, this); return o; }
}

// ---------------------------------------------------------------- camera body
// CameraSource(tracker): turns the camera pose into an Intent and a direct limb override.
// Reads (from js/pose.js BodyTracker): visible, frame (increments per fresh pose), pose (26, figure units,
// floor at y = 0, mirror view), pose3 (39, figure units, hip-centred; null without world landmarks), hasLegs,
// body { shX, shY, hipX, hipY, shW, torso } (raw image-plane units, y up), hands { L, R } (each
// { wrist, thumb, index, pinky: [x, y], vis }, same units).
// Gestures (all thresholds are in torso lengths, so they do not depend on distance to the camera):
//   move     shoulder centre x offset from a slowly adapting neutral (adapts in 2 s inside the dead zone,
//            10 s outside it); on above 0.3 torso, off below 0.18, full speed at 0.7.
//   crouch   hip drop below a slow standing height: on 0.35, off 0.2 -> moveY -1.
//   duck     the hip dropping fast (> 1.4 torso/s) through 0.25 -> dodge (with crouch -> esquiva).
//   jump     the hips rising > 0.3 torso at > 1.5 torso/s, OR a pinch of the jump hand (held = jumpHeld).
//   form     a pinch of the other hand.      merge   both wrists above the head and close together (0.25 s).
//   spin     the shoulder line foreshortens below 0.55 of its usual width and recovers above 0.8 within 0.9 s.
//   punch / kick  limb-speed peaks (wrist > 2.2 figure units/s while extended; ankle > 1.8 while lifted;
//            the bending hand needs 3.0 so playing the melody does not punch; both hands moving fast together
//            is a gesture, never a punch) -> intent.limb names the limb.
//   aim      the bending hand relative to its shoulder (aimActive while visible).
// Pinch: thumb-to-index distance / hand size (wrist to index or pinky) from the pose landmarks 17-22. These
// points are coarse (BlazePose places them near the knuckles, not the fingertips), so `pinch[side].conf`
// (0..1) reports landmark visibility x how decisive the ratio is; on below 0.38, off above 0.6, and it must
// hold for 2 frames. Expect it to behave like "close the hand" more than a precise pinch.
export class CameraSource {
  constructor(tracker, opts = {}) {
    this.tracker = tracker; this.opts = opts; this.name = 'camera'; this.mode = 'locked';
    this.aimHand = (opts.aimHand || 'R') === 'L' ? 'L' : 'R';
    this.jumpHand = opts.jumpHand ? ((opts.jumpHand === 'L') ? 'L' : 'R') : (this.aimHand === 'R' ? 'L' : 'R');
    this.reset();
  }
  reset() {
    this.nx = null; this.lean = new Hysteresis(0.3, 0.18); this.crouch = new Hysteresis(0.35, 0.2);
    this.hipN = null; this.prev = null; this.vel = new Float32Array(26); this.lastFrame = -1; this.hipV = 0; this.prevHip = null;
    this.jumpCool = 0; this.duckCool = 0; this.duckArmed = true;
    this.peaks = { LW: new PeakDetector(2.2, 0.5, 0.35), RW: new PeakDetector(2.2, 0.5, 0.35), LA: new PeakDetector(1.8, 0.5, 0.4), RA: new PeakDetector(1.8, 0.5, 0.4) };
    this.peaks[this.aimHand + 'W'].min = 3.0;
    this.pinch = { L: { on: false, ratio: 1, conf: 0, n: 0 }, R: { on: false, ratio: 1, conf: 0, n: 0 } };
    this.mergeT = 0; this.shWRef = null; this.twist = { armed: false, t: 0 };
    this.pend = {};
    this.debug = {};
  }
  _pinch(side, hand, dt) {
    const P = this.pinch[side];
    if (!hand || !hand.thumb || !hand.index) { P.n = 0; P.on = false; P.conf = 0; return; }
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const size = Math.max(d(hand.wrist, hand.index), d(hand.wrist, hand.pinky || hand.index), 1e-4);
    const ratio = d(hand.thumb, hand.index) / size;
    P.ratio = ratio;
    const vis = clamp(hand.vis ?? 1, 0, 1);
    const decisive = ratio < 0.38 ? clamp((0.38 - ratio) / 0.2 + 0.5, 0, 1) : ratio > 0.6 ? clamp((ratio - 0.6) / 0.3 + 0.5, 0, 1) : 0.3;
    P.conf += (vis * decisive - P.conf) * (1 - Math.exp(-dt * 10));
    const want = vis > 0.5 ? (P.on ? ratio < 0.6 : ratio < 0.38) : false;
    if (want !== P.on) { P.n++; if (P.n >= 2) { P.on = want; P.n = 0; return want ? 'down' : 'up'; } }
    else P.n = 0;
    return null;
  }
  update(dt = 1 / 60) {
    const o = makeIntent(); o.source = this.name;
    const tr = this.tracker;
    if (!tr || !tr.visible || !tr.pose) { this.prev = null; return o; }
    const P = tr.pose, B = tr.body;
    o.pose = P; o.pose3 = tr.pose3 || null; o.hasLegs = !!tr.hasLegs;
    const fresh = tr.frame !== this.lastFrame;
    const fdt = fresh && this.lastFrame >= 0 ? (tr.frameDt || dt) : dt;
    this.lastFrame = tr.frame;
    const J2 = { HEAD: 0, LS: 1, RS: 2, LE: 3, RE: 4, LW: 5, RW: 6, LH: 7, RH: 8, LK: 9, RK: 10, LA: 11, RA: 12 };
    const px = j => P[2 * J2[j]], py = j => P[2 * J2[j] + 1];
    // per-joint velocity (figure units / s), only on fresh frames
    if (fresh) {
      if (this.prev) for (let i = 0; i < 26; i++) this.vel[i] += ((P[i] - this.prev[i]) / Math.max(fdt, 1e-3) - this.vel[i]) * 0.6;
      this.prev = Float32Array.from(P);
    }
    const sp = j => Math.hypot(this.vel[2 * J2[j]], this.vel[2 * J2[j] + 1]);
    // ----- body-relative measures from the raw tracker body
    const torso = (B && B.torso) || 0.2;
    const shX = B ? B.shX : (px('LS') + px('RS')) / 2, hipY = B ? B.hipY : (py('LH') + py('RH')) / 2;
    const shW = B ? B.shW : Math.hypot(px('LS') - px('RS'), py('LS') - py('RS'));
    if (this.nx == null) this.nx = shX;
    const off = (shX - this.nx) / torso;
    const inDZ = Math.abs(off) < 0.18;
    this.nx += (shX - this.nx) * (1 - Math.exp(-dt / (inDZ ? 2 : 10)));
    if (this.lean.update(Math.abs(off))) o.moveX = Math.sign(off) * clamp((Math.abs(off) - 0.18) / (0.7 - 0.18), 0.25, 1);
    // crouch / duck / jump from the hips
    if (this.hipN == null) this.hipN = hipY;
    const drop = (this.hipN - hipY) / torso;
    if (!this.crouch.state && drop < 0.15) this.hipN += (hipY - this.hipN) * (1 - Math.exp(-dt / 4));
    if (this.prevHip != null && fresh) this.hipV += (((hipY - this.prevHip) / torso) / Math.max(fdt, 1e-3) - this.hipV) * 0.6;
    if (fresh) this.prevHip = hipY;
    if (this.crouch.update(drop)) o.moveY = -1;
    this.duckCool = Math.max(0, this.duckCool - dt); this.jumpCool = Math.max(0, this.jumpCool - dt);
    if (drop < 0.12) this.duckArmed = true;
    if (this.duckArmed && this.duckCool <= 0 && drop > 0.25 && this.hipV < -1.4) { o.dodge = true; o.moveY = -1; this.duckCool = 0.6; this.duckArmed = false; }
    this.jumpHoldT = Math.max(0, (this.jumpHoldT || 0) - dt);
    if (this.jumpCool <= 0 && -drop > 0.3 && this.hipV > 1.5) { o.jump = true; this.jumpCool = 0.8; this.jumpHoldT = 0.35; }
    // pinches
    const hands = tr.hands || {};
    for (const side of ['L', 'R']) {
      const ev = this._pinch(side, hands[side], dt);
      if (ev === 'down') { if (side === this.jumpHand) o.jump = true; else o.form = true; }
    }
    if (this.pinch[this.jumpHand].on) o.jumpHeld = true;
    if (this.jumpHoldT > 0) o.jumpHeld = true;   // a real jump: full height
    o.pinch = { L: { on: this.pinch.L.on, conf: +this.pinch.L.conf.toFixed(3), ratio: +this.pinch.L.ratio.toFixed(3) }, R: { on: this.pinch.R.on, conf: +this.pinch.R.conf.toFixed(3), ratio: +this.pinch.R.ratio.toFixed(3) } };
    // merge: both hands up over the head, together
    const handsUp = py('LW') > py('HEAD') && py('RW') > py('HEAD') && Math.hypot(px('LW') - px('RW'), py('LW') - py('RW')) < 0.09;
    this.mergeT = handsUp ? this.mergeT + dt : 0;
    o.merge = this.mergeT >= 0.25;
    // spin: the shoulders foreshorten, then recover
    if (this.shWRef == null) this.shWRef = shW;
    const ratio = shW / Math.max(this.shWRef, 1e-4);
    if (ratio > 0.8) this.shWRef += (shW - this.shWRef) * (1 - Math.exp(-dt / 5));
    if (ratio < 0.55 && !this.twist.armed) { this.twist.armed = true; this.twist.t = 0; }
    if (this.twist.armed) { this.twist.t += dt; if (ratio > 0.8) { if (this.twist.t <= 0.9) o.spin = true; this.twist.armed = false; } else if (this.twist.t > 1.5) this.twist.armed = false; }
    // punches and kicks from limb-speed peaks
    const shoulder = { LW: 'LS', RW: 'RS' }, hip = { LA: 'LH', RA: 'RH' };
    // both hands flying together is a gesture (merge, arms thrown up), not a punch
    if (sp('LW') > 1.5 && sp('RW') > 1.5) this.bothT = 0.3; else this.bothT = Math.max(0, (this.bothT || 0) - dt);
    if (fresh) for (const limb of ['LW', 'RW', 'LA', 'RA']) {
      const pk = this.peaks[limb].update(sp(limb), fdt);
      if (!pk) continue;
      if (limb[1] === 'W') {
        if (this.bothT > 0) continue;
        const ext = Math.hypot(px(limb) - px(shoulder[limb]), py(limb) - py(shoulder[limb]));
        if (ext > 0.8 * 0.23 && !o.merge) { o.punch = true; o.limb = limb; }
      } else if (tr.hasLegs) {
        const lifted = py(limb) > 0.1 || py(limb) > py(hip[limb]) - 0.25;
        if (lifted) { o.kick = true; o.limb = limb; }
      }
    }
    // the bending hand
    const aw = this.aimHand + 'W', as = this.aimHand + 'S';
    let ax = (px(aw) - px(as)) / 0.23, ay = (py(aw) - py(as)) / 0.23;
    const l = Math.hypot(ax, ay); if (l > 1) { ax /= l; ay /= l; }
    o.aimX = ax; o.aimY = ay; o.aimActive = true;
    this.debug = { off, drop, hipV: this.hipV, shRatio: ratio, pinch: o.pinch };
    return o;
  }
}

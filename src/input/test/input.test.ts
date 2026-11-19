// The pure parts of src/input: edges, dead zones, the gamepad mapping (fake pads), touch, the bot, camera gestures from
// synthetic landmark streams, and the hub's joining and keyboard split. The prototype's dev/test-input.mjs, ported,
// with the 3D body (limbs) in place of its pose3 and the hub added.
import { makeIntent, mergeIntents, radialDeadzone, Hysteresis, PeakDetector, type Intent } from '../intent';
import { KeyboardSource, LAYOUTS, keysOf } from '../keyboard';
import { GamepadSource, GamepadHub, type PadLike } from '../gamepad';
import { TouchSource, BotSource } from '../touch';
import { CameraSource, type TrackerLike } from '../camera';
import { BodyTracker, type MPPoint } from '../tracker';
import { InputHub } from '../hub';
import { LM } from '../../skeleton/landmarks';
import { test, assert, near, done } from '../../dancer/test/check';

test('Intent has every DESIGN.md field plus the 3D ones', () => {
  const i = makeIntent() as unknown as Record<string, unknown>;
  for (const k of ['moveX', 'moveY', 'jump', 'jumpHeld', 'punch', 'kick', 'spin', 'dodge', 'form', 'merge', 'aimX', 'aimY', 'aimActive', 'moveZ', 'camX', 'camY', 'lock', 'interact']) assert(k in i, k);
});

test('radial dead zone and hysteresis', () => {
  assert(radialDeadzone(0.1, 0.1, 0.2).every((v) => v === 0), 'inside');
  const [x, y] = radialDeadzone(0.6, 0, 0.2, 0.95); near(x, (0.6 - 0.2) / 0.75, 1e-9); near(y, 0, 1e-12);
  const [a] = radialDeadzone(1, 0); near(a, 1, 1e-9, 'full');
  const d = radialDeadzone(0.5, 0.5); near(Math.atan2(d[1], d[0]), Math.PI / 4, 1e-9, 'direction kept');
  const h = new Hysteresis(0.5, 0.35);
  const seq = [0.4, 0.6, 0.45, 0.36, 0.3, 0.55].map((v) => h.update(v));
  assert(JSON.stringify(seq) === JSON.stringify([false, true, true, true, false, true]), JSON.stringify(seq));
});

test('keyboard: a tap between frames is one edge; held states; layouts; free mode', () => {
  const k = new KeyboardSource('solo', { target: null });
  k.keyDown('KeyK'); k.keyUp('KeyK');
  let i = k.update(); assert(i.kick && !k.update().kick, 'tap edge once');
  k.keyDown('KeyW'); i = k.update(); assert(i.jump && i.jumpHeld, 'jump'); i = k.update(); assert(!i.jump && i.jumpHeld, 'held');
  k.keyUp('KeyW'); k.keyDown('KeyA'); k.keyDown('ShiftLeft'); i = k.update(); assert(i.moveX === -1 && i.dodge && i.dodgeHeld, 'move+dodge');
  k.keyDown('KeyD'); assert(k.update().moveX === 0, 'A+D cancel');
  k.mode = 'free'; k.keyUp('KeyA'); k.keyUp('KeyD'); k.keyDown('KeyW'); i = k.update(); assert(i.moveZ === 1 && !i.jump, 'free: W is depth');
  k.keyDown('Space'); i = k.update(); assert(i.jump, 'free: space jumps');
  k.keyDown('KeyQ'); assert(k.update().walk === true, 'free: Q walks');
  k.keyDown('KeyV'); assert(k.update().lock, 'lock');
  k.keyDown('Tab'); assert(k.update().lock, 'Tab locks too');
  const r = new KeyboardSource('right', { target: null });
  r.keyDown('ArrowLeft'); r.keyDown('Comma'); r.keyDown('ControlRight'); i = r.update();
  assert(i.moveX === -1 && i.punch && i.merge, 'right layout');
  r.keyDown('KeyJ'); assert(!r.update().punch, 'right ignores J');
  const l = new KeyboardSource('left', { target: null, facing: () => -1 });
  i = l.update(); assert(i.aimX < 0 && !i.aimActive, 'left aims along facing');
});

test('keyboard solo: the mouse plays the bending hand relative to the dancer', () => {
  const k = new KeyboardSource('solo', { target: null, dancerScreen: () => ({ x: 400, y: 300, reach: 100 }) });
  k.mouseMove(450, 250); let i = k.update();
  near(i.aimX, 0.5, 1e-9); near(i.aimY, 0.5, 1e-9); assert(i.aimActive, 'active');
  k.mouseMove(800, 300); i = k.update(); near(Math.hypot(i.aimX, i.aimY), 1, 1e-9, 'clamped to reach');
  k.mouseDown(0); i = k.update(); assert(i.punch && i.punchHeld, 'click = punch'); k.mouseUp(0);
  k.mode = 'free'; k.mouseDown(2); k.mouseMove(810, 300); i = k.update(1 / 60); assert(i.camX > 0 && !i.aimActive, 'right-drag = camera'); k.mouseUp(2);
  // quick right-click tap kicks without dragging the camera
  k.mouseDown(2); k.mouseUp(2); i = k.update(1 / 60); assert(i.kick && i.camX === 0, 'right-click tap = kick');
  // Alt+left-drag orbits camera on trackpads without punching
  k.mouseDown(0, true); k.mouseMove(830, 300); i = k.update(1 / 60); assert(i.camX > 0 && !i.punch, 'alt+left-drag = camera'); k.mouseUp(0);
  // R recenters camera
  k.keyDown('KeyR'); i = k.update(1 / 60); assert(i.camReset === true, 'R = camReset'); k.keyUp('KeyR');
  // 1-player mode (allowSplit: false): arrows orbit the 3D camera instead of splitting the keyboard
  const spHub = new InputHub({ target: null, allowSplit: false });
  spHub.key('KeyW'); spHub.key('ArrowRight');
  assert(spHub.players.length === 1 && spHub.players[0].slot === 'solo', '1P hub never splits on arrows');
  const spKb = spHub.players[0].source as KeyboardSource;
  spKb.mode = 'free'; spKb.keyDown('ArrowRight'); i = spKb.update(1 / 60);
  assert(i.camX > 0, '1P arrows orbit 3D camera');
  spKb.keyUp('ArrowRight');
  // ergonomic solo duel keys: 1/2 powers, F spin, X dodge
  spKb.scheme = 'duel';
  spKb.keyDown('Digit1'); assert(spKb.update().power1, 'solo duel: 1 = power1'); spKb.keyUp('Digit1');
  spKb.keyDown('Digit2'); assert(spKb.update().power2, 'solo duel: 2 = power2'); spKb.keyUp('Digit2');
  spKb.keyDown('KeyF'); assert(spKb.update().spin, 'solo duel: F = spin'); spKb.keyUp('KeyF');
  spKb.keyDown('KeyX'); assert(spKb.update().dodge, 'solo duel: X = dodge'); spKb.keyUp('KeyX');
});

// a fake Gamepad API
type Fake = PadLike & { buttons: { pressed: boolean; value: number }[]; axes: number[]; press(i: number, on?: boolean): void; trig(i: number, v: number): void; vibrationActuator: { type: string; calls: unknown[]; playEffect(t: string, o: Record<string, number>): unknown } };
function fakePad(): Fake {
  const p = {
    id: 'Xbox fake', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    vibrationActuator: { type: 'dual-rumble', calls: [] as unknown[], playEffect(t: string, o: Record<string, number>) { this.calls.push([t, o]); return Promise.resolve(); } },
  } as Fake;
  p.press = (i, on = true) => { p.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
  p.trig = (i, v) => { p.buttons[i] = { pressed: v > 0.5, value: v }; };
  return p;
}
test('gamepad: dead zones, analog run, buttons, triggers with hysteresis, rumble', () => {
  const pad = fakePad(), pads: (Fake | null)[] = [pad];
  const g = new GamepadSource(0, { getPads: () => pads });
  pad.axes = [0.15, 0.1, 0, 0]; let i = g.update(); assert(i.moveX === 0 && i.moveY === 0, 'dead zone');
  pad.axes = [0.6, 0, 0, 0]; i = g.update(); assert(i.moveX > 0.5 && i.moveX < 0.6, 'analog ' + i.moveX);
  pad.axes = [0, 0.9, 0, 0]; i = g.update(); assert(i.moveY < -0.8, 'stick down = crouch');
  pad.press(0); i = g.update(); assert(i.jump && i.jumpHeld, 'A'); i = g.update(); assert(!i.jump && i.jumpHeld, 'A held'); pad.press(0, false);
  pad.press(4); i = g.update(); assert(i.spin && i.auDir === -1, 'LB = au left'); pad.press(4, false);
  pad.trig(7, 0.6); i = g.update(); assert(i.dodge && i.dodgeHeld, 'RT'); pad.trig(7, 0.4); i = g.update(); assert(!i.dodge && i.dodgeHeld, 'RT hysteresis keeps it'); pad.trig(7, 0.2); assert(!g.update().dodgeHeld, 'RT released');
  pad.trig(6, 0.9); assert(g.update().form, 'LT form'); pad.trig(6, 0);
  pad.press(3); let merged = false; for (let k = 0; k < 40; k++) merged = g.update(1 / 60).merge; assert(merged, 'Y held = merge'); pad.press(3, false); g.update();
  pad.press(10); pad.press(11); assert(g.update().merge, 'both sticks = merge'); pad.press(10, false); pad.press(11, false);
  pad.press(8); assert(g.update().lock, 'View = lock'); pad.press(8, false);
  assert(g.rumble(0.8, 100) && pad.vibrationActuator.calls.length === 1, 'rumble');
  pads.length = 0; i = g.update(); assert(!g.connected && i.moveX === 0, 'unplugged → neutral');
});
test('gamepad: right stick = bending hand; a flick is a directional strike; free mode camera vs LB', () => {
  const pad = fakePad(), g = new GamepadSource(0, { getPads: () => [pad] });
  pad.axes = [0, 0, 0.5, -0.5]; let i = g.update(); assert(i.aimActive && i.aimX > 0 && i.aimY > 0 && !i.punch, 'aim, no flick');
  pad.axes = [0, 0, 0, 0]; g.update(); pad.axes = [0, 0, 0.95, 0]; i = g.update(1 / 60); assert(i.punch && i.flick, 'flick');
  pad.axes = [0, 0, 0, 0]; g.update(); pad.axes = [0, 0, 0.5, 0]; g.update(); for (let k = 0; k < 10; k++) g.update(1 / 60); pad.axes = [0, 0, 0.95, 0]; i = g.update(1 / 60);
  assert(!i.flick, 'a slow push is not a flick');
  g.mode = 'free'; pad.axes = [0.5, -0.8, 0.7, 0]; i = g.update();
  assert(i.moveZ > 0.6 && i.moveY === 0 && i.camX > 0.5 && !i.aimActive, 'free: depth + camera');
  pad.press(4); i = g.update(); assert(i.aimActive && i.camX === 0 && !i.spin, 'free: LB makes it the hand');
});
test('gamepad hub: hot-plug connect / disconnect', () => {
  const pads: (Fake | null)[] = [], ev: string[] = [];
  const hub = new GamepadHub({ getPads: () => pads, target: null }).on('connect', (i) => ev.push('+' + i)).on('disconnect', (i) => ev.push('-' + i));
  hub.update(); pads[1] = fakePad(); hub.update(); hub.update(); pads[1] = null; hub.update();
  assert(ev.join() === '+1,-1', ev.join());
  assert(hub.source(1) === hub.source(1), 'sources cached');
});

test('touch: stick where the thumb lands, right-half drag = hand / camera, buttons', () => {
  const t = new TouchSource(null, { rect: () => ({ left: 0, top: 0, width: 1000, height: 500 }), stickRadius: 50 });
  t.down(1, 200, 300); t.move(1, 250, 300); let i = t.update(); near(i.moveX, (1 - 0.15) / 0.85, 1e-9, 'stick full right');
  t.move(1, 200, 340); i = t.update(); assert(i.moveY < -0.6, 'stick down');
  t.down(2, 700, 250); t.move(2, 740, 210); i = t.update(); assert(i.aimActive && i.aimX > 0 && i.aimY > 0, 'hand drag');
  t.press('strike'); i = t.update(); assert(i.punch && i.punchHeld, 'strike button'); i = t.update(); assert(!i.punch && i.punchHeld, 'held'); t.release('strike');
  t.mode = 'free'; t.move(2, 760, 210); i = t.update(1 / 60); assert(!i.aimActive && i.camX > 0, 'free: drag = camera');
  t.press('hand'); t.move(2, 770, 200); i = t.update(); assert(i.aimActive, "free: 'hand' held");
  t.up(1); t.up(2); i = t.update(); assert(i.moveX === 0 && !i.aimActive, 'released');
  // (the duel's 'dash' and two powers joined the list, shown only in the duel's scheme)
  assert(t.buttons.map((b) => b.name).join() === 'jump,strike,kick,spin,dash,power1,power2,dodge,form,merge,lock,interact,hand', 'descriptors');
  assert(t.buttons.find((b) => b.name === 'dash')!.duelOnly === true, 'dash: the duel only');
});

test('the duel scheme: dash on Shift or K / B / a swipe or the dash button; the moves it displaced move over', () => {
  // keyboard (solo): the jogo's Shift is dodge, K kick, and no dash
  const k = new KeyboardSource('solo', { target: null });
  k.keyDown('ShiftLeft'); let i = k.update(); assert(i.dodge && !i.dash, 'jogo: Shift dodges'); k.keyUp('ShiftLeft');
  k.keyDown('KeyK'); i = k.update(); assert(i.kick && !i.dash, 'jogo: K kicks'); k.keyUp('KeyK');
  k.scheme = 'duel';
  k.keyDown('ShiftLeft'); i = k.update(); assert(i.dash && !i.dodge && !i.dodgeHeld, 'duel: Shift dashes'); assert(!k.update().dash, 'an edge'); k.keyUp('ShiftLeft');
  k.keyDown('KeyK'); i = k.update(); assert(i.dash && !i.kick, 'duel: K dashes'); k.keyUp('KeyK');
  k.keyDown('KeyL'); i = k.update(); assert(i.kick && !i.spin, 'duel: L kicks'); k.keyUp('KeyL');
  k.keyDown('KeyI'); assert(k.update().spin, 'duel: I spins'); k.keyUp('KeyI');
  k.keyDown('KeyO'); i = k.update(); assert(i.dodge && i.dodgeHeld, 'duel: O dodges'); k.keyUp('KeyO');
  k.keyDown('KeyW'); i = k.update(); assert(i.jump && i.moveY === 1, 'duel: W jumps and holds up'); k.keyUp('KeyW');
  k.keyDown('KeyS'); k.keyDown('KeyD'); k.keyDown('KeyK'); i = k.update(); assert(i.dash && i.moveX === 1 && i.moveY === -1, 'a dash down-right');
  const r = new KeyboardSource('right', { target: null }); r.scheme = 'duel';
  r.keyDown('Period'); i = r.update(); assert(i.dash && !i.kick, 'right: . dashes'); r.keyUp('Period');
  r.keyDown('ShiftRight'); assert(r.update().dash, 'right: right Shift dashes');
  // gamepad
  let pads: PadLike[] = [];
  const btns = (on: number[]) => Array.from({ length: 17 }, (_, j) => ({ pressed: on.includes(j), value: on.includes(j) ? 1 : 0 }));
  const g = new GamepadSource(0, { getPads: () => pads });
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([1]) }];
  i = g.update(); assert(i.kick && !i.dash, 'jogo: B kicks');
  g.scheme = 'duel'; pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([]) }]; g.update();
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([1]) }]; i = g.update(); assert(i.dash && !i.kick, 'duel: B dashes');
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([7]) }]; i = g.update(); assert(!i.dash && !i.dodge && i.power1, 'duel: RT is power 1');
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([3, 5]) }]; i = g.update(); assert(i.kick && i.dodge && i.dodgeHeld, 'duel: Y kicks, RB dodges');
  // touch: a swipe past the rim, quickly, dashes; a slow push doesn't; the dash button
  const t = new TouchSource(null, { rect: () => ({ left: 0, top: 0, width: 1000, height: 500 }), stickRadius: 50 });
  t.scheme = 'duel';
  t.down(1, 200, 300); t.update(1 / 60); t.move(1, 230, 300); t.update(1 / 60); t.move(1, 260, 300); i = t.update(1 / 60);
  assert(i.dash && i.moveX > 0.9, 'a swipe dashes'); assert(!t.update(1 / 60).dash, 'once');
  t.up(1); t.update(1 / 60);
  t.down(1, 200, 300); for (let x = 205; x <= 260; x += 5) { t.move(1, x, 300); i = t.update(1 / 60); assert(!i.dash, 'a slow push does not dash'); }
  t.up(1); t.press('dash'); assert(t.update().dash, 'the dash button'); t.release('dash');
  // the hub hands its scheme to every device it seats
  const hub = new InputHub({ target: null }); hub.scheme = 'duel'; hub.key('KeyA');
  assert(hub.players[0].source.scheme === 'duel', 'hub: seated in the duel scheme');
  hub.scheme = 'jogo'; assert((hub.players[0].source.scheme as string) === 'jogo', 'hub: and back');
});

test('the duel powers: U and H (solo, left), P and [ (right), RT and LT, two touch buttons; the form E, Enter, both sticks', () => {
  const k = new KeyboardSource('solo', { target: null });
  k.keyDown('KeyU'); let i = k.update(); assert(!i.power1 && !i.power2, 'jogo: U is nothing'); k.keyUp('KeyU');
  k.scheme = 'duel';
  k.keyDown('KeyU'); i = k.update(); assert(i.power1 && !i.power2, 'duel: U power 1'); assert(!k.update().power1, 'an edge'); k.keyUp('KeyU');
  k.keyDown('KeyH'); k.keyDown('KeyD'); i = k.update(); assert(i.power2 && i.moveX === 1, 'duel: H power 2 along the stick'); k.keyUp('KeyH'); k.keyUp('KeyD');
  k.keyDown('KeyE'); assert(k.update().form, 'E the form');
  const l = new KeyboardSource('left', { target: null }); l.scheme = 'duel';
  l.keyDown('KeyU'); assert(l.update().power1, 'left: U');
  const r = new KeyboardSource('right', { target: null }); r.scheme = 'duel';
  r.keyDown('KeyP'); i = r.update(); assert(i.power1 && !i.power2, 'right: P power 1'); r.keyUp('KeyP');
  r.keyDown('BracketLeft'); assert(r.update().power2, 'right: [ power 2'); r.keyUp('BracketLeft');
  r.keyDown('Enter'); assert(r.update().form, 'right: Enter the form');
  // no key of one layout's powers is another's, or the page's own (space, n, w, l, y, f, c, /)
  const all = (['solo', 'right'] as const).map((x) => [...LAYOUTS[x].duel.power1, ...LAYOUTS[x].duel.power2]);
  for (const key of all[0]) assert(!keysOf('right').has(key), `${key}: the left half's only`);
  for (const key of all[1]) assert(!keysOf('solo').has(key), `${key}: the right half's only`);
  for (const key of all.flat()) assert(!['Space', 'KeyN', 'KeyW', 'KeyL', 'KeyY', 'KeyF', 'KeyC', 'Slash'].includes(key), `${key}: not the page's`);
  // the duel's other keys stay as they were
  for (const x of ['solo', 'left', 'right'] as const) {
    const D = LAYOUTS[x].duel, used = [D.dash, D.kick, D.spin, D.dodge, LAYOUTS[x].punch, LAYOUTS[x].form, LAYOUTS[x].lock].flat();
    for (const key of [...D.power1, ...D.power2]) assert(!used.includes(key), `${x}: ${key} is free`);
  }
  // the hub splits the keyboard on the right half's power keys too
  const hub = new InputHub({ target: null }); hub.key('KeyU'); hub.key('KeyP');
  assert(hub.players.length === 2 && hub.players[1].slot === 'right', 'P seats the right half');
  // gamepad
  let pads: PadLike[] = [];
  const btns = (on: number[]) => Array.from({ length: 17 }, (_, j) => ({ pressed: on.includes(j), value: on.includes(j) ? 1 : 0 }));
  const g = new GamepadSource(0, { getPads: () => pads }); g.scheme = 'duel';
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([]) }]; g.update();
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([7]) }]; i = g.update(); assert(i.power1 && !i.power2 && !i.dash, 'RT power 1');
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([6]) }]; i = g.update(); assert(i.power2 && !i.form, 'LT power 2 (not the form)');
  pads = [{ id: 'x', axes: [0, 0, 0, 0], buttons: btns([10, 11]) }]; i = g.update(); assert(i.form && !i.merge, 'both sticks: the form');
  // touch
  const t = new TouchSource(null, { rect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) });
  t.press('power1'); assert(!t.update().power1, 'jogo: no powers'); t.release('power1');
  t.scheme = 'duel'; t.press('power2'); i = t.update(); assert(i.power2 && !i.power1, 'duel: the power 2 button'); t.release('power2');
  assert(t.buttons.filter((b) => b.name.startsWith('power')).every((b) => b.duelOnly), 'power buttons: the duel only');
});

test('bot source and merging devices', () => {
  const b = new BotSource((_dt, it) => { it.moveX = 1; it.kick = true; });
  const i = b.update(); assert(i.moveX === 1 && i.kick, 'bot');
  const m = mergeIntents(Object.assign(makeIntent(), { moveX: 0.2, jump: true }), Object.assign(makeIntent(), { moveX: -0.9, aimActive: true, aimX: 0.3 }));
  assert(m.moveX === -0.9 && m.jump && m.aimActive && m.aimX === 0.3, 'merge');
});

test('peak detector fires once per peak', () => {
  const p = new PeakDetector(2, 0.5, 0.15); const fired: number[] = [];
  for (const v of [0.5, 1, 2.5, 3, 2.8, 1.2, 0.5, 0.3, 2.6, 1.0]) fired.push(p.update(v, 0.05));
  assert(fired.filter(Boolean).length === 2, fired.join());
});

// ---------------------------------------------------------------- camera gestures from synthetic streams
// a fake tracker in the shape BodyTracker exposes; body units: torso = 0.2 image heights
type FakeT = TrackerLike & { st: { x: number; hip: number; lw: number[] | null; rw: number[] | null; la: number[] | null; ra: number[] | null; shW: number; pinchL: number; pinchR: number; handsUp: boolean }; set(): void };
function fakeTracker(): FakeT {
  const T = { visible: true, frame: 0, frameDt: 1 / 30, hasLegs: true, pose: new Float32Array(26), limbs: null, body: null, hands: { L: null, R: null } } as unknown as FakeT;
  const st = { x: 0, hip: 0.0, lw: null, rw: null, la: null, ra: null, shW: 0.12, pinchL: 1, pinchR: 1, handsUp: false } as FakeT['st'];
  T.st = st;
  T.set = () => {
    const P = T.pose!, s = 0.21 / 0.2;
    const put = (j: number, x: number, y: number) => { P[2 * j] = x; P[2 * j + 1] = y; };
    const fx = st.x * s, hipY = 0.36 + st.hip * s;
    put(7, fx - 0.04, hipY); put(8, fx + 0.04, hipY);
    const shw = (st.shW / 0.12) * 0.068;
    put(1, fx - shw, hipY + 0.21); put(2, fx + shw, hipY + 0.21); put(0, fx, hipY + 0.3);
    put(3, fx - 0.1, hipY + 0.12); put(4, fx + 0.1, hipY + 0.12);
    const lw = st.handsUp ? [fx - 0.02, hipY + 0.42] : st.lw || [fx - 0.12, hipY + 0.05], rw = st.handsUp ? [fx + 0.02, hipY + 0.42] : st.rw || [fx + 0.12, hipY + 0.05];
    put(5, lw[0], lw[1]); put(6, rw[0], rw[1]);
    put(9, fx - 0.06, hipY - 0.18); put(10, fx + 0.06, hipY - 0.18);
    const la = st.la || [fx - 0.08, 0], ra = st.ra || [fx + 0.08, 0];
    put(11, la[0], la[1]); put(12, ra[0], ra[1]);
    T.body = { shX: st.x, shY: 0.2 + st.hip, hipX: st.x, hipY: st.hip, shW: st.shW, torso: 0.2 };
    const hand = (cx: number, r: number) => ({ wrist: [cx, -0.05] as [number, number], index: [cx + 0.03, -0.0] as [number, number], pinky: [cx - 0.01, 0.0] as [number, number], thumb: [cx + 0.03 - 0.03 * r, -0.0 - 0.03 * r] as [number, number], vis: 0.9 });
    T.hands = { L: hand(-0.15, st.pinchL), R: hand(0.15, st.pinchR) };
    T.frame++;
  };
  T.set();
  return T;
}
const feed = (cam: CameraSource, T: FakeT, secs: number, change?: (t: number) => void) => { const out: Intent[] = []; for (let t = 0; t < secs; t += 1 / 30) { if (change) change(t); T.set(); out.push(cam.update(1 / 30)); } return out; };
const last = <T>(a: T[]) => a[a.length - 1];

test('camera: lean / step left-right with dead zone and hysteresis; the neutral adapts', () => {
  const T = fakeTracker(), cam = new CameraSource(T);
  feed(cam, T, 1);
  let r = feed(cam, T, 0.3, () => { T.st.x = 0.03; });
  assert(r.every((i) => i.moveX === 0), 'dead zone');
  r = feed(cam, T, 0.3, () => { T.st.x = 0.12; });
  assert(last(r).moveX > 0.6, 'lean right ' + last(r).moveX);
  r = feed(cam, T, 0.2, () => { T.st.x = 0.06; });
  assert(last(r).moveX > 0, 'hysteresis holds');
  r = feed(cam, T, 0.3, () => { T.st.x = -0.0; });
  assert(last(r).moveX === 0, 'released');
  r = feed(cam, T, 30, () => { T.st.x = 0.2; });
  assert(last(r).moveX === 0, 'neutral adapted');
  return 'adapts in ~30 s outside the dead zone';
});
test('camera: crouch, duck (dodge), real jump, merge, spin', () => {
  const T = fakeTracker(), cam = new CameraSource(T);
  feed(cam, T, 1.5);
  let r = feed(cam, T, 0.6, (t) => { T.st.hip = -0.1 * Math.min(1, t / 0.4); });
  assert(last(r).moveY === -1 && !r.some((i) => i.dodge), 'slow crouch, no dodge');
  r = feed(cam, T, 1, () => { T.st.hip = 0; }); assert(last(r).moveY === 0, 'stand up');
  r = feed(cam, T, 0.3, (t) => { T.st.hip = -0.1 * Math.min(1, t / 0.1); });
  assert(r.some((i) => i.dodge && i.moveY === -1), 'duck = dodge');
  feed(cam, T, 1.5, () => { T.st.hip = 0; });
  r = feed(cam, T, 0.3, (t) => { T.st.hip = 0.09 * Math.min(1, t / 0.12); });
  assert(r.some((i) => i.jump && i.jumpHeld), 'jump');
  feed(cam, T, 1, () => { T.st.hip = 0; });
  r = feed(cam, T, 0.5, () => { T.st.handsUp = true; }); assert(last(r).merge && !r.some((i) => i.punch), 'merge');
  T.st.handsUp = false; feed(cam, T, 1);
  r = feed(cam, T, 0.6, (t) => { T.st.shW = 0.12 * (t < 0.25 ? 1 - 2.2 * t : t < 0.5 ? 0.45 : 1); });
  assert(r.some((i) => i.spin), 'spin');
});
test('camera: punches and kicks from limb-speed peaks, with the limb named', () => {
  const T = fakeTracker(), cam = new CameraSource(T);
  feed(cam, T, 1);
  let r = feed(cam, T, 0.5, (t) => { const k = Math.min(1, t / 0.08); T.st.lw = [-0.12 - 0.15 * k, 0.36 + 0.21 * k]; });
  const p = r.find((i) => i.punch); assert(p && p.limb === 'LW', 'left punch ' + JSON.stringify(p && p.limb));
  T.st.lw = null; feed(cam, T, 1);
  r = feed(cam, T, 0.5, (t) => { const k = Math.min(1, t / 0.12); T.st.rw = [0.12 + 0.15 * k, 0.36 + 0.21 * k]; });
  assert(!r.some((i) => i.punch), 'the bending hand at a medium speed only plays');
  T.st.rw = null; feed(cam, T, 1);
  r = feed(cam, T, 0.5, (t) => { const k = Math.min(1, t / 0.12); T.st.ra = [0.08 + 0.3 * k, 0.3 * k]; });
  const kk = r.find((i) => i.kick); assert(kk && kk.limb === 'RA', 'kick');
  assert(r[0].aimActive && Number.isFinite(r[0].aimX), 'aim from the real hand');
});
test('camera: pinch with hysteresis, debounce and confidence; jump hand vs form hand', () => {
  const T = fakeTracker(), cam = new CameraSource(T, { aimHand: 'R' });
  feed(cam, T, 0.5);
  let r = feed(cam, T, 0.5, () => { T.st.pinchL = 0.1; });
  assert(r.filter((i) => i.jump).length === 1 && last(r).jumpHeld, 'left pinch = jump, held');
  assert(last(r).pinch!.L.on && last(r).pinch!.L.conf > 0.6, 'confidence ' + last(r).pinch!.L.conf);
  r = feed(cam, T, 0.2, () => { T.st.pinchL = 0.6; }); assert(last(r).pinch!.L.on, 'hysteresis: ratio 0.6 still on');
  r = feed(cam, T, 0.3, () => { T.st.pinchL = 1; }); assert(!last(r).pinch!.L.on && !last(r).jumpHeld, 'released');
  r = feed(cam, T, 0.1, (t) => { T.st.pinchR = t < 0.03 ? 0.1 : 1; }); assert(!r.some((i) => i.form), 'a one-frame blip is ignored');
  r = feed(cam, T, 0.5, () => { T.st.pinchR = 0.1; }); assert(r.filter((i) => i.form).length === 1 && !r.some((i) => i.jump), 'right pinch = form');
});

// ---------------------------------------------------------------- BodyTracker.ingest with synthetic MediaPipe output
function landmarks({ pinchR = 1, lean = 0 } = {}): [MPPoint[], MPPoint[]] {
  const lm: MPPoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const set = (i: number, x: number, y: number) => { lm[i] = { x: x + lean, y, z: 0, visibility: 0.95 }; };
  set(0, 0.5, 0.2); set(7, 0.53, 0.2); set(8, 0.47, 0.2);
  set(11, 0.56, 0.32); set(12, 0.44, 0.32); set(13, 0.6, 0.45); set(14, 0.4, 0.45); set(15, 0.62, 0.56); set(16, 0.38, 0.56);
  set(23, 0.54, 0.6); set(24, 0.46, 0.6); set(25, 0.55, 0.75); set(26, 0.45, 0.75); set(27, 0.55, 0.9); set(28, 0.45, 0.9);
  // the right hand (the picture's left): wrist 16, pinky 18, index 20, thumb 22
  set(18, 0.37, 0.6); set(20, 0.355, 0.6); set(22, 0.355 + 0.025 * pinchR, 0.6 - 0.02 * pinchR);
  set(17, 0.63, 0.6); set(19, 0.645, 0.6); set(21, 0.62, 0.58);
  const w = lm.map((p) => ({ x: (p.x - 0.5) * 1.6, y: (p.y - 0.6) * 1.6, z: 0, visibility: p.visibility }));
  return [lm, w];
}
test('BodyTracker.ingest: the 2D pose (as before), the 3D limbs in metres (not mirrored), hands → the pinch', () => {
  const tr = new BodyTracker();
  let t = 0;
  for (let i = 0; i < 30; i++) { const [lm, w] = landmarks(); tr.ingest(lm, w, (t += 33), 16 / 9); }
  assert(tr.visible && tr.everSeen && tr.hasLegs, 'flags');
  const L = tr.limbs!;
  assert(L && L.length === 39, 'limbs');
  const hipMid = [(L[3 * LM.LH] + L[3 * LM.RH]) / 2, (L[3 * LM.LH + 1] + L[3 * LM.RH + 1]) / 2];
  near(hipMid[0], 0, 1e-6, 'about the hips'); near(hipMid[1], 0, 1e-6, 'about the hips');
  assert(L[3 * LM.LS] > L[3 * LM.RS], "the player's own left at +x (worn, not mirrored)");
  assert(L[3 * LM.HEAD + 1] > L[3 * LM.LS + 1] && L[3 * LM.LA + 1] < -0.3, 'head up, feet down: ' + L[3 * LM.LA + 1].toFixed(2));
  assert(tr.pose[2 * 2] > tr.pose[2 * 1] && tr.pose[1] > tr.pose[2 * 7 + 1], 'the 2D pose is the mirror view, as before');
  const cam = new CameraSource(tr, { aimHand: 'L' });   // so the right hand is the jump hand
  for (let i = 0; i < 10; i++) { const [lm, w] = landmarks(); tr.ingest(lm, w, (t += 33), 16 / 9); cam.update(1 / 30); }
  let jumps = 0;
  for (let i = 0; i < 10; i++) { const [lm, w] = landmarks({ pinchR: 0.1 }); tr.ingest(lm, w, (t += 33), 16 / 9); if (cam.update(1 / 30).jump) jumps++; }
  assert(jumps === 1, 'pinch through the tracker: ' + jumps);
  return `pinch ratio ${cam.pinch.R.ratio.toFixed(2)} (closed), conf ${cam.pinch.R.conf.toFixed(2)}`;
});
test('BodyTracker.ingestHands: the hand model\'s fingertips give a fine pinch, matched to the nearer wrist', () => {
  const tr = new BodyTracker();
  let t = 0;
  for (let i = 0; i < 5; i++) { const [lm, w] = landmarks(); tr.ingest(lm, w, (t += 33), 16 / 9); }
  // a right hand (the picture's left) near the pose's right wrist, thumb tip on the index tip
  const hand = (pinch: boolean): MPPoint[] => {
    const h = Array.from({ length: 21 }, () => ({ x: 0.36, y: 0.6 }));
    h[0] = { x: 0.38, y: 0.58 }; h[8] = { x: 0.33, y: 0.66 }; h[17] = { x: 0.36, y: 0.64 };
    h[4] = pinch ? { x: 0.332, y: 0.658 } : { x: 0.35, y: 0.6 };
    return h;
  };
  const cam = new CameraSource(tr, { aimHand: 'L' });
  let jumps = 0, fine = false;
  for (let i = 0; i < 12; i++) {
    tr.ingestHands([hand(i >= 4)], t + 33, 4 / 3);
    const [lm, w] = landmarks(); tr.ingest(lm, w, (t += 33), 16 / 9);
    const it = cam.update(1 / 30); if (it.jump) jumps++; fine = !!it.pinch?.R.fine;
  }
  assert(tr.hands.R?.fine && fine, 'the fine hand is used');
  assert(jumps === 1, 'one fine pinch → one jump: ' + jumps);
  return `fine ratio ${cam.pinch.R.ratio.toFixed(2)} pinched`;
});

// ---------------------------------------------------------------- the hub
test('hub: the first device is player one, the next player two; the keyboard splits', () => {
  const pads: (Fake | null)[] = [];
  const hub = new InputHub({ target: null, getPads: () => pads });
  const joined: string[] = [], changed: string[] = [];
  hub.onJoin = (p) => joined.push(`${p.index}:${p.device}:${p.slot}`);
  hub.onChange = (p) => changed.push(`${p.index}:${p.slot}`);
  hub.key('KeyZ');   // not anyone's key
  assert((hub.players.length as number) === 0, 'no one yet');
  hub.key('KeyK');
  assert((hub.players.length as number) === 1 && hub.players[0].slot === 'solo', 'player one: solo keyboard');
  assert(hub.players[0].source.update(1 / 60).kick, 'the key that joined is not lost');
  hub.key('ArrowLeft');
  assert((hub.players.length as number) === 2 && (hub.players[0].slot as string) === "left" && hub.players[1].slot === 'right', 'split: ' + joined.join() + ' / ' + changed.join());
  hub.poll(); pads[0] = fakePad(); pads[0].press(0); hub.poll();
  assert((hub.players.length as number) === 2, 'full at two');
  return `${joined.join(', ')}; changed ${changed.join(', ')}`;
});
test('hub: a gamepad joins on its first press (hot-join), a touch joins, rumble reaches the pad', () => {
  const pads: (Fake | null)[] = [];
  const hub = new InputHub({ target: null, getPads: () => pads });
  pads[2] = fakePad(); hub.poll();
  assert((hub.players.length as number) === 0, 'plugged in is not playing');
  pads[2].press(1); hub.poll();
  assert((hub.players.length as number) === 1 && hub.players[0].device === 'gamepad' && hub.players[0].slot === 2, 'pad 2 is player one');
  assert(hub.rumble(0, 0.5, 80) && pads[2].vibrationActuator.calls.length === 1, 'rumble');
  hub.touch(7, 100, 100);
  assert((hub.players.length as number) === 2 && hub.players[1].device === 'touch', 'touch is player two');
});

done();

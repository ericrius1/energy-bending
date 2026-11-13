// dev/test-input.mjs — the pure parts of input.js and pose.js: edges, dead zones, gamepad mapping (fake pads),
// touch, the bot source, and camera gestures from synthetic landmark streams. node dev/test-input.mjs
import { makeIntent, mergeIntents, radialDeadzone, Hysteresis, PeakDetector, KeyboardSource, GamepadSource, GamepadHub, TouchSource, BotSource, CameraSource } from '../js/input.js';
import { BodyTracker } from '../js/pose.js';

let pass = 0, fail = 0; const out = [];
const test = (name, fn) => { try { const r = fn(); pass++; out.push(`ok    ${name}${r ? '  (' + r + ')' : ''}`); } catch (e) { fail++; out.push(`FAIL  ${name}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, t, m) => assert(Math.abs(a - b) <= t, `${m || ''} expected ${b} got ${a}`);

test('Intent has every DESIGN.md field plus the 3-D ones', () => {
  const i = makeIntent();
  for (const k of ['moveX', 'moveY', 'jump', 'jumpHeld', 'punch', 'kick', 'spin', 'dodge', 'form', 'merge', 'aimX', 'aimY', 'aimActive', 'moveZ', 'camX', 'camY', 'lock', 'interact']) assert(k in i, k);
});

test('radial dead zone and hysteresis', () => {
  assert(radialDeadzone(0.1, 0.1, 0.2).every(v => v === 0), 'inside');
  const [x, y] = radialDeadzone(0.6, 0, 0.2, 0.95); near(x, (0.6 - 0.2) / 0.75, 1e-9); near(y, 0, 1e-12);
  const [a] = radialDeadzone(1, 0); near(a, 1, 1e-9, 'full');
  const d = radialDeadzone(0.5, 0.5); near(Math.atan2(d[1], d[0]), Math.PI / 4, 1e-9, 'direction kept');
  const h = new Hysteresis(0.5, 0.35);
  const seq = [0.4, 0.6, 0.45, 0.36, 0.3, 0.55].map(v => h.update(v));
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
  k.keyDown('KeyV'); assert(k.update().lock, 'lock');
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
  k.mode = 'free'; k.mouseDown(2); k.mouseMove(810, 300); i = k.update(1 / 60); assert(i.camX > 0 && !i.aimActive, 'right-drag = camera');
});

// a fake Gamepad API
function fakePad() {
  const p = { id: 'Xbox fake', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), vibrationActuator: { type: 'dual-rumble', calls: [], playEffect(t, o) { this.calls.push([t, o]); return Promise.resolve(); } } };
  p.press = (i, on = true) => { p.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
  p.trig = (i, v) => { p.buttons[i] = { pressed: v > 0.5, value: v }; };
  return p;
}
test('gamepad: dead zones, analog run, buttons, triggers with hysteresis, rumble', () => {
  const pad = fakePad(), pads = [pad];
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
  assert(g.rumble(0.8, 100) && pad.vibrationActuator.calls.length === 1, 'rumble');
  pads.length = 0; i = g.update(); assert(!g.connected && i.moveX === 0, 'unplugged -> neutral');
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
  const pads = [], ev = [];
  const hub = new GamepadHub({ getPads: () => pads, target: null }).on('connect', i => ev.push('+' + i)).on('disconnect', i => ev.push('-' + i));
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
  assert(t.buttons.map(b => b.name).join() === 'jump,strike,kick,spin,dodge,form,merge,lock,interact,hand', 'descriptors');
});

test('bot source and merging devices', () => {
  const b = new BotSource((dt, it) => { it.moveX = 1; it.kick = true; });
  const i = b.update(); assert(i.moveX === 1 && i.kick, 'bot');
  const m = mergeIntents(Object.assign(makeIntent(), { moveX: 0.2, jump: true }), Object.assign(makeIntent(), { moveX: -0.9, aimActive: true, aimX: 0.3 }));
  assert(m.moveX === -0.9 && m.jump && m.aimActive && m.aimX === 0.3, 'merge');
});

test('peak detector fires once per peak', () => {
  const p = new PeakDetector(2, 0.5, 0.15); const fired = [];
  for (const v of [0.5, 1, 2.5, 3, 2.8, 1.2, 0.5, 0.3, 2.6, 1.0]) fired.push(p.update(v, 0.05));
  assert(fired.filter(Boolean).length === 2, fired.join());
});

// ---------------------------------------------------------------- camera gestures from synthetic streams
// A fake tracker in the shape BodyTracker exposes. Body units: torso = 0.2 image heights.
function fakeTracker() {
  const T = { visible: true, frame: 0, frameDt: 1 / 30, hasLegs: true, pose: new Float32Array(26), pose3: null, body: null, hands: {} };
  const st = { x: 0, hip: 0.0, lw: null, rw: null, la: null, ra: null, shW: 0.12, pinchL: 1, pinchR: 1, handsUp: false };
  T.st = st;
  T.set = () => {
    const P = T.pose, s = 0.21 / 0.2;   // figure units per image unit
    const put = (j, x, y) => { P[2 * j] = x; P[2 * j + 1] = y; };
    const fx = st.x * s, hipY = 0.36 + st.hip * s;
    put(7, fx - 0.04, hipY); put(8, fx + 0.04, hipY);
    const shw = st.shW / 0.12 * 0.068;
    put(1, fx - shw, hipY + 0.21); put(2, fx + shw, hipY + 0.21); put(0, fx, hipY + 0.3);
    put(3, fx - 0.1, hipY + 0.12); put(4, fx + 0.1, hipY + 0.12);
    const lw = st.handsUp ? [fx - 0.02, hipY + 0.42] : st.lw || [fx - 0.12, hipY + 0.05], rw = st.handsUp ? [fx + 0.02, hipY + 0.42] : st.rw || [fx + 0.12, hipY + 0.05];
    put(5, ...lw); put(6, ...rw);
    put(9, fx - 0.06, hipY - 0.18); put(10, fx + 0.06, hipY - 0.18);
    put(11, ...(st.la || [fx - 0.08, 0])); put(12, ...(st.ra || [fx + 0.08, 0]));
    T.body = { shX: st.x, shY: 0.2 + st.hip, hipX: st.x, hipY: st.hip, shW: st.shW, torso: 0.2 };
    const hand = (cx, r) => ({ wrist: [cx, -0.05], index: [cx + 0.03, -0.0], pinky: [cx - 0.01, 0.0], thumb: [cx + 0.03 - 0.03 * r, -0.0 - 0.03 * r], vis: 0.9 });
    T.hands = { L: hand(-0.15, st.pinchL), R: hand(0.15, st.pinchR) };
    T.frame++;
  };
  T.set();
  return T;
}
const feed = (cam, T, secs, change) => { const out = []; for (let t = 0; t < secs; t += 1 / 30) { if (change) change(t); T.set(); out.push(cam.update(1 / 30)); } return out; };

test('camera: lean / step left-right with dead zone and hysteresis; the neutral adapts', () => {
  const T = fakeTracker(), cam = new CameraSource(T);
  feed(cam, T, 1);
  let r = feed(cam, T, 0.3, () => { T.st.x = 0.03; });   // 0.15 torso: inside the dead zone
  assert(r.every(i => i.moveX === 0), 'dead zone');
  r = feed(cam, T, 0.3, () => { T.st.x = 0.12; });       // 0.6 torso
  assert(r.at(-1).moveX > 0.6, 'lean right ' + r.at(-1).moveX);
  r = feed(cam, T, 0.2, () => { T.st.x = 0.06; });       // 0.3 -> still on (hysteresis)
  assert(r.at(-1).moveX > 0, 'hysteresis holds');
  r = feed(cam, T, 0.3, () => { T.st.x = -0.0; });
  assert(r.at(-1).moveX === 0, 'released');
  r = feed(cam, T, 30, () => { T.st.x = 0.2; });         // standing somewhere new for a long time
  assert(r.at(-1).moveX === 0, 'neutral adapted');
  return 'adapts in ~30 s outside the dead zone';
});
test('camera: crouch, duck (dodge), real jump, merge, spin', () => {
  const T = fakeTracker(), cam = new CameraSource(T);
  feed(cam, T, 1.5);
  let r = feed(cam, T, 0.6, t => { T.st.hip = -0.1 * Math.min(1, t / 0.4); });           // slow crouch: 0.5 torso in 0.4 s
  assert(r.at(-1).moveY === -1 && !r.some(i => i.dodge), 'slow crouch, no dodge');
  r = feed(cam, T, 1, () => { T.st.hip = 0; }); assert(r.at(-1).moveY === 0, 'stand up');
  r = feed(cam, T, 0.3, t => { T.st.hip = -0.1 * Math.min(1, t / 0.1); });             // fast duck
  assert(r.some(i => i.dodge && i.moveY === -1), 'duck = dodge');
  feed(cam, T, 1.5, () => { T.st.hip = 0; });
  r = feed(cam, T, 0.3, t => { T.st.hip = 0.09 * Math.min(1, t / 0.12); });             // jump
  assert(r.some(i => i.jump && i.jumpHeld), 'jump');
  feed(cam, T, 1, () => { T.st.hip = 0; });
  r = feed(cam, T, 0.5, () => { T.st.handsUp = true; }); assert(r.at(-1).merge && !r.some(i => i.punch), 'merge');
  T.st.handsUp = false; feed(cam, T, 1);
  r = feed(cam, T, 0.6, t => { T.st.shW = 0.12 * (t < 0.25 ? 1 - 2.2 * t : t < 0.5 ? 0.45 : 1); });   // shoulders turn and come back
  assert(r.some(i => i.spin), 'spin');
});
test('camera: punches and kicks from limb-speed peaks, with the limb named', () => {
  const T = fakeTracker(), cam = new CameraSource(T);
  feed(cam, T, 1);
  // left hand punches out to the side (not the bending hand)
  // a hard punch: ~4 figure units/s (about 8-9 m/s for a 0.5 m torso), out to full reach
  let r = feed(cam, T, 0.5, t => { const k = Math.min(1, t / 0.08); T.st.lw = [-0.12 - 0.15 * k, 0.36 + 0.21 * k]; });
  const p = r.find(i => i.punch); assert(p && p.limb === 'LW', 'left punch ' + JSON.stringify(p && p.limb));
  // the bending (right) hand moving at the same speed only plays
  T.st.lw = null; feed(cam, T, 1);
  r = feed(cam, T, 0.5, t => { const k = Math.min(1, t / 0.12); T.st.rw = [0.12 + 0.15 * k, 0.36 + 0.21 * k]; });
  assert(!r.some(i => i.punch), 'the bending hand at a medium speed only plays');
  T.st.rw = null; feed(cam, T, 1);
  r = feed(cam, T, 0.5, t => { const k = Math.min(1, t / 0.12); T.st.ra = [0.08 + 0.3 * k, 0.3 * k]; });
  const kk = r.find(i => i.kick); assert(kk && kk.limb === 'RA', 'kick');
  assert(r[0].aimActive && Number.isFinite(r[0].aimX), 'aim from the real hand');
});
test('camera: pinch with hysteresis, debounce and confidence; jump hand vs form hand', () => {
  const T = fakeTracker(), cam = new CameraSource(T, { aimHand: 'R' });
  feed(cam, T, 0.5);
  let r = feed(cam, T, 0.5, () => { T.st.pinchL = 0.1; });
  assert(r.filter(i => i.jump).length === 1 && r.at(-1).jumpHeld, 'left pinch = jump, held');
  assert(r.at(-1).pinch.L.on && r.at(-1).pinch.L.conf > 0.6, 'confidence ' + r.at(-1).pinch.L.conf);
  r = feed(cam, T, 0.2, () => { T.st.pinchL = 0.6; }); assert(r.at(-1).pinch.L.on, 'hysteresis: ratio 0.6 still on');
  r = feed(cam, T, 0.3, () => { T.st.pinchL = 1; }); assert(!r.at(-1).pinch.L.on && !r.at(-1).jumpHeld, 'released');
  r = feed(cam, T, 0.1, t => { T.st.pinchR = t < 0.03 ? 0.1 : 1; }); assert(!r.some(i => i.form), 'a one-frame blip is ignored');
  r = feed(cam, T, 0.5, () => { T.st.pinchR = 0.1; }); assert(r.filter(i => i.form).length === 1 && !r.some(i => i.jump), 'right pinch = form');
});

// ---------------------------------------------------------------- BodyTracker.ingest with synthetic MediaPipe output
function landmarks({ pinchR = 1, lean = 0 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const set = (i, x, y) => { lm[i] = { x: x + lean, y, z: 0, visibility: 0.95 }; };
  set(0, 0.5, 0.2); set(11, 0.56, 0.32); set(12, 0.44, 0.32); set(13, 0.6, 0.45); set(14, 0.4, 0.45); set(15, 0.62, 0.56); set(16, 0.38, 0.56);
  set(23, 0.54, 0.6); set(24, 0.46, 0.6); set(25, 0.55, 0.75); set(26, 0.45, 0.75); set(27, 0.55, 0.9); set(28, 0.45, 0.9);
  // right hand (image left): wrist 16, pinky 18, index 20, thumb 22
  set(18, 0.37, 0.6); set(20, 0.355, 0.6); set(22, 0.355 + 0.025 * pinchR, 0.6 - 0.02 * pinchR);
  set(17, 0.63, 0.6); set(19, 0.645, 0.6); set(21, 0.62, 0.58);
  const w = lm.map(p => ({ x: (p.x - 0.5) * 1.6, y: (p.y - 0.6) * 1.6, z: 0, visibility: p.visibility }));
  return [lm, w];
}
test('BodyTracker.ingest: pose (2-D, as before), pose3 from world landmarks, hands -> camera pinch', () => {
  const tr = new BodyTracker(null);
  let t = 0;
  for (let i = 0; i < 30; i++) { const [lm, w] = landmarks(); tr.ingest(lm, w, (t += 33), 16 / 9); }
  assert(tr.visible && tr.everSeen && tr.hasLegs, 'flags');
  assert(tr.pose3 && tr.pose3.length === 39, 'pose3');
  const sc = [(tr.pose3[3] + tr.pose3[6]) / 2, (tr.pose3[4] + tr.pose3[7]) / 2], hc = [(tr.pose3[21] + tr.pose3[24]) / 2, (tr.pose3[22] + tr.pose3[25]) / 2];
  near(Math.hypot(sc[0] - hc[0], sc[1] - hc[1]), 0.21, 0.005, 'pose3 torso = 0.21');
  assert(tr.pose3[3 * 2] > tr.pose3[3 * 1], 'mirror: RS to the right of LS');
  assert(tr.pose[2 * 2] > tr.pose[2 * 1] && tr.pose[1] > tr.pose[2 * 7 + 1], '2-D pose layout unchanged');
  const cam = new CameraSource(tr, { aimHand: 'L' });   // so the right hand is the jump hand
  for (let i = 0; i < 10; i++) { const [lm, w] = landmarks(); tr.ingest(lm, w, (t += 33), 16 / 9); cam.update(1 / 30); }
  let jumps = 0;
  for (let i = 0; i < 10; i++) { const [lm, w] = landmarks({ pinchR: 0.1 }); tr.ingest(lm, w, (t += 33), 16 / 9); if (cam.update(1 / 30).jump) jumps++; }
  assert(jumps === 1, 'pinch through the tracker: ' + jumps + ' ' + JSON.stringify(cam.debug.pinch));
  return `pinch ratio open ${cam.pinch.R.ratio.toFixed(2)} (closed), conf ${cam.pinch.R.conf.toFixed(2)}`;
});

for (const r of out) console.log(r);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

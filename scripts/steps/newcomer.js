// A newcomer from the front page (report 24-newcomer), for roam-probe.mjs: the plain page as a first-timer finds it,
// one real press begins (Enter, an arrow, W, a click or a tap on the dancers), then a walk with real keys: `hold` keeps
// one key down (W or ArrowUp: what a first-timer does), `walk` steers to the nearest mirror the way roam-lib's walker
// does (on W A S D or the arrows). Measured on the stepped clock (60 fps) from the press:
//   move     the first time the body the press joined moves 0.25 m (and which seat that is, and its device)
//   cross    the first crossing, and how the main view went over (through the glass, under the flash, late)
//   floor    frames whose camera looks more than 40 degrees down (of all, and of the 3 s after each crossing)
//   stills   at 1, 3 and 6 s (the page's DOM over the canvas), the front before the press, and 1, 3 and 6 s after the
//            first crossing (x1s, x3s, x6s). NC.gate names the mirror the walker heads for (else the nearest), NC.after
//            how long it walks on after crossing (s)
// Set before this file (a --lib prefix): window.NC = { start: 'Enter' | 'ArrowUp' | 'KeyW' | 'click' | 'tap' | 'pad' (a
//   gamepad made up in the page: its A),
//   go: 'hold' | 'walk' | 'stick' (a thumb held up on the touch stick) | 'padstick' (the pad's left stick held up), keys: 'wasd' | 'arrows', secs: 10, tag: 'a' }
const NC = Object.assign({ start: 'Enter', go: 'hold', keys: 'wasd', secs: 10, tag: 'run' }, window.NC ?? {});
const MAP = NC.keys === 'arrows' ? { KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyA: 'ArrowLeft', KeyD: 'ArrowRight' } : { KeyW: 'KeyW', KeyS: 'KeyS', KeyA: 'KeyA', KeyD: 'KeyD' };
const held = new Set();
const press = async (want) => {
  want = want.map((k) => MAP[k] ?? k);
  for (const k of [...held]) if (!want.includes(k)) { await key(k, false); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await key(k, true); held.add(k); }
};
const S = () => bend.jogo?.stats() ?? bend.duel?.stats?.() ?? null;
const cam = () => bend.kit.camera;
const out = { tag: NC.tag, start: NC.start, go: NC.go, keys: NC.keys };
// (a gamepad, made up in the page: navigator.getGamepads gives one standard pad whose A and left stick the run sets)
const PAD = { id: 'newcomer pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
if (NC.start === 'pad') {
  navigator.getGamepads = () => [PAD, null, null, null];
  const ev = new Event('gamepadconnected'); ev.gamepad = PAD; dispatchEvent(ev);
}
const realMs = (ms) => new Promise((r) => setTimeout(r, ms));
await step(90);
await shot(`${NC.tag}-front`);
// the press that begins
const W0 = innerWidth, H0 = innerHeight;
if (NC.start === 'click') { await mouse(W0 * 0.5, H0 * 0.55); await window.__click('#stage'); }
else if (NC.start === 'tap') await tap(W0 * 0.5, H0 * 0.55);
else if (NC.start === 'pad') { PAD.buttons[0] = { pressed: true, touched: true, value: 1 }; PAD.timestamp++; await realMs(150); await step(2); PAD.buttons[0] = { pressed: false, touched: false, value: 0 }; PAD.timestamp++; }
else await key(NC.start);
const F0 = bend.kit.frameIndex;
const t = () => (bend.kit.frameIndex - F0) / 60;
// wait for the jogo
for (let i = 0; i < 120 && !bend.jogo; i++) await step(1);
const roots0 = bend.jogo.stats().seats.map((s) => s.root);
let move = null, cross = null, frames = 0, floor = 0, after = 0, afterFloor = 0, crossAt = [];
const pitches = [];
const stillsAt = [1, 3, 6];
const crossStills = [1, 3, 6];
const g = () => [...bend.gates.gates.values()].filter((x) => x.world === bend.gates.rigWorld && x.partner);
const meSeat = () => { const d = bend.jogo.stats().devices; const k = d.findIndex((n) => n && /keyboard|touch|mouse|gamepad/.test(n)); return k; };
let lined = false, ref = null, check = { f: 0, d: Infinity }, target = null, s0 = 0;
const camNow = () => { const y = bend.camera().yaw; return { F: [-Math.sin(y), -Math.cos(y)], R: [Math.cos(y), -Math.sin(y)] }; };
const keyOf = (k) => k;
if (NC.go === 'hold') await press(['KeyW']);
// (the left stick held up)
if (NC.go === 'padstick') { PAD.axes[1] = -1; PAD.timestamp++; }
// (a thumb on the left of the screen pushed up: the touch stick, held)
if (NC.go === 'stick') { await step(6); await touch('start', W0 * 0.2, H0 * 0.72); await step(2); await touch('move', W0 * 0.2, H0 * 0.72 - 40); await step(2); await touch('move', W0 * 0.2, H0 * 0.72 - 80); }
const movedAt = [null, null], trace = [];
for (let f = 0; f < NC.secs * 60; f += 3) {
  const st = bend.jogo.stats();
  // the walker (as roam-lib's walkTo): toward 1.8 m out in front of the nearest mirror, then through
  if (NC.go === 'walk' && st.phase && !cross) {
    const me = st.seats[Math.max(0, meSeat())];
    if (!target && NC.gate) target = g().find((x) => x.id === NC.gate);
    if (!target) { const r = me.root; target = g().map((x) => ({ x, d: Math.hypot(x.at[0] - r[0], x.at[2] - r[2]) })).sort((a, b) => a.d - b.d)[0]?.x; }
    if (target) {
      const r = me.root, G = target, side = (r[0] - G.at[0]) * G.n[0] + (r[2] - G.at[2]) * G.n[2], sg = side >= 0 ? 1 : -1;
      const lat = Math.hypot((r[0] - G.at[0]) - side * G.n[0], (r[2] - G.at[2]) - side * G.n[2]);
      if (!lined && Math.abs(side) > 0.6 && lat < 0.45) lined = true;
      if (lined && lat > 1.0) lined = false;
      const tx = lined ? G.at[0] - sg * G.n[0] * 1.5 : G.at[0] + sg * G.n[0] * 1.8, tz = lined ? G.at[2] - sg * G.n[2] * 1.5 : G.at[2] + sg * G.n[2] * 1.8;
      const dx = tx - r[0], dz = tz - r[2], dl = Math.hypot(dx, dz) || 1;
      const choose = (c) => { const fw = (dx * c.F[0] + dz * c.F[1]) / dl, rt = (dx * c.R[0] + dz * c.R[1]) / dl, w = []; if (fw > 0.38) w.push('KeyW'); else if (fw < -0.38) w.push('KeyS'); if (rt > 0.38) w.push('KeyD'); else if (rt < -0.38) w.push('KeyA'); return w; };
      ref ??= camNow();
      let want = choose(ref);
      let stale = false;
      if (f - check.f >= 30) { stale = dl > check.d - 0.25 && held.size > 0; check = { f, d: dl }; }
      const now = want.map((k) => MAP[k]).sort().join();
      if (stale || now !== [...held].sort().join()) { await press([]); await step(1); ref = camNow(); want = choose(ref); }
      await press(want);
    }
  }
  await step(3);
  const st2 = bend.jogo.stats(), T = t();
  const me = meSeat();
  for (let k = 0; k < 2; k++) if (movedAt[k] == null) { const r = st2.seats[k].root, r0 = roots0[k]; if (Math.hypot(r[0] - r0[0], r[2] - r0[2]) > 0.25) movedAt[k] = +T.toFixed(2); }
  if (!move && me >= 0) { const r = st2.seats[me].root, r0 = roots0[me]; if (Math.hypot(r[0] - r0[0], r[2] - r0[2]) > 0.25) move = { s: +T.toFixed(2), seat: me, device: st2.devices[me] }; }
  if (st2.crossings.length > s0) { s0 = st2.crossings.length; crossAt.push(T); if (!cross) cross = { s: +T.toFixed(2), from: st2.crossings[0].from, to: st2.crossings[0].to }; }
  if (frames % 10 === 0) trace.push({ t: +T.toFixed(1), me: st2.seats[Math.max(0, me)].root, w: st2.world, eye: bend.rig.eye.map((v) => +v.toFixed(1)), p: +cam().pitch.toFixed(2), keys: [...held].join('') , tgt: target?.id });
  const p = cam().pitch;
  frames++; pitches.push(+p.toFixed(2));
  if (p < -0.7) (out.downAt ??= []).push({ t: +T.toFixed(2), p: +p.toFixed(2), eye: bend.rig.eye.map((v) => +v.toFixed(2)), look: bend.rig.look.map((v) => +v.toFixed(2)), w: bend.gates.rigWorld, main: st2.world, pose: !!bend.rig.pose });
  const down = p < -0.7;
  if (down) floor++;
  if (crossAt.some((c) => T - c >= 0 && T - c < 3)) { after++; if (down) afterFloor++; }
  while (stillsAt.length && T >= stillsAt[0]) await shot(`${NC.tag}-${stillsAt.shift()}s`);
  while (cross && crossStills.length && T >= cross.s + crossStills[0]) await shot(`${NC.tag}-x${crossStills.shift()}s`);
  if (cross && NC.go === 'walk' && T > cross.s + (NC.after ?? 3.5)) break;
}
await press([]);
if (NC.go === 'stick') await touch('end');
const st = bend.jogo.stats();
out.movedAt = movedAt;
out.trace = NC.trace ? trace : undefined;
out.move = move;
out.cross = cross;
out.crossings = st.crossings;
out.devices = st.devices;
out.seats = st.seats;
out.floor = { frames, down: floor, share: +(floor / Math.max(1, frames)).toFixed(3), after, afterDown: afterFloor };
out.pitchMin = Math.min(...pitches);
await shot(`${NC.tag}-end`);
return JSON.stringify(out);

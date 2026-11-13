// Writes the dancers' capture steps (scripts/steps/dancers-*.json) for scripts/shot.mjs: every move on the gem body
// from the front and the side at its wind-up, its active moment and its recovery; the ginga, a run, a jump at its apex
// and the landing; the locked view with two dancers on ledges; the free follow camera; the camera easing into the
// lock; and a scripted sequence in both views as frames for a film. Each step drives ?play through window.bend
// (bend.intent, bend.move, bend.place, bend.camera). Then:
//   node scripts/steps/dancers.mjs
//   node scripts/shot.mjs shots/dancers-moves scripts/steps/dancers-moves.json --url http://127.0.0.1:5406/energybending/
// (and dancers-loco, dancers-lock, dancers-film-free, dancers-film-locked the same way).
import { writeFileSync } from 'node:fs';

// (every step carries the first's query: shot.mjs opens the page again when a step's query differs)
const out = (name, steps) => {
  for (const s of steps) s.query ??= steps[0].query;
  writeFileSync(new URL(`./dancers-${name}.json`, import.meta.url), JSON.stringify(steps, null, 1) + '\n');
};
const FPS = 60;
// the moves at 112 bpm (dancer/moves.ts): duration (s), active window or null, and the moments to show (progress u)
const MOVES = {
  'meia-lua': [0.8, [0.32, 0.62]], armada: [1.07, [0.4, 0.68]], martelo: [0.54, [0.38, 0.62]], bencao: [0.67, [0.36, 0.6]],
  rasteira: [0.8, [0.35, 0.72]], strike: [0.42, [0.5, 0.7]], throw: [1.07, [0.24, 0.82]], au: [1.07, null], macaco: [1.07, null],
  role: [0.8, null], esquiva: [0.6, null], block: [0.54, null], spin: [1.07, null], pirueta: [1.47, null],
};
const moments = (act) => (act ? [act[0] * 0.7, (act[0] + act[1]) / 2, act[1] + (1 - act[1]) * 0.45] : [0.25, 0.5, 0.75]);
// views of a dancer facing +x: from its front (the camera at +x) and its right side (at +z)
const VIEWS = { front: Math.PI / 2, side: 0 };
const boot = (q = 'play') => ({ name: 'boot', query: q, wake: true, frames: 520, js: "B.set('camera', { followDist: 3.3, followFov: 42, followPitch: 0.1 }); B.place(0, 0, 0, Math.PI / 2);" });
const settle = (yaw, x = 0) => `B.intent(0, null); B.place(0, ${x}, 0, Math.PI / 2); B.camera({ yaw: ${yaw.toFixed(4)}, pitch: 0.1, idle: 0 });`;

// ---------------------------------------------------------------- every move, front and side, three moments
const moves = [boot()];
for (const [name, [dur, act]] of Object.entries(MOVES)) {
  for (const [view, yaw] of Object.entries(VIEWS)) {
    moves.push({ name: `${name}.${view}.0-ready`, frames: 40, js: settle(yaw) });
    let at = 0;
    moments(act).forEach((u, k) => {
      // (a grab steps one frame of its own)
      const f = Math.max(1, Math.round(u * dur * FPS) - at - (k ? 1 : 0));
      moves.push({ name: `${name}.${view}.${k + 1}`, frames: f, js: k === 0 ? `B.move(0, '${name}');` : '' });
      at += f + (k ? 1 : 0);
    });
    moves.push({ name: `${name}.${view}.4-after`, frames: Math.round(dur * FPS) + 20 - at });
  }
}
out('moves', moves);

// ---------------------------------------------------------------- locomotion: ginga, a walk, a run, a jump, a landing
const loco = [boot()];
for (const [view, yaw] of Object.entries(VIEWS)) {
  loco.push({ name: `ginga.${view}.0`, frames: 60, js: settle(yaw) });
  for (let k = 1; k < 4; k++) loco.push({ name: `ginga.${view}.${k}`, frames: 31 });
}
// a run along +x (stick right, the camera behind and to the side), and a walk (the motion-matched clips)
loco.push({ name: 'run.side', frames: 50, js: `${settle(0, -4)} B.intent(0, { moveX: 0, moveZ: 0 }); B.camera({ yaw: 0.0, pitch: 0.1 }); B.intent(0, { moveX: 1 });` });
loco.push({ name: 'run.front', frames: 12, js: 'B.camera({ yaw: Math.PI / 2 - 0.5 });' });
loco.push({ name: 'walk.side', frames: 120, js: `${settle(0, -3)} B.intent(0, { moveX: 1, walk: true });` });
loco.push({ name: 'walk.front', frames: 30, js: 'B.camera({ yaw: Math.PI / 2 - 0.5 });' });
loco.push({ name: 'walk.turn', frames: 50, js: 'B.intent(0, { moveX: 0, moveZ: 1, walk: true }); B.camera({ yaw: 0.6 });' });
// a jump: up (the apex about 0.42 s in), and the landing
loco.push({ name: 'jump.ready', frames: 40, js: `${settle(0.3)}` });
loco.push({ name: 'jump.rise', frames: 12, js: "B.intent(0, { jump: true, jumpHeld: true });" });
loco.push({ name: 'jump.apex', frames: 13 });
loco.push({ name: 'jump.fall', frames: 18 });
loco.push({ name: 'jump.land', frames: 6 });
loco.push({ name: 'jump.after', frames: 20, js: "B.intent(0, { jumpHeld: false });" });
loco.push({ name: 'crouch', frames: 30, js: `${settle(0.3)} B.intent(0, { moveY: -1 });` });
out('loco', loco);

// ---------------------------------------------------------------- the lock: two dancers, the camera easing in, ledges
const lock = [
  { name: 'free.two', query: 'play&two', wake: true, frames: 520, js: "B.set('camera', { followDist: 4.6, followFov: 48, followPitch: 0.22 }); B.place(0, -1.4, 0.8, Math.PI / 2); B.place(1, 1.4, -0.6, -Math.PI / 2); B.camera({ yaw: 0.9, pitch: 0.22 });" },
  { name: 'free.follow', frames: 100, js: 'B.intent(0, { moveX: 1, moveZ: 0.4 });' },
  { name: 'lock.0', frames: 1, js: 'B.intent(0, null); B.lock(true);' },
  { name: 'lock.1', frames: 12 },
  { name: 'lock.2', frames: 25 },
  { name: 'lock.3', frames: 70 },
  { name: 'ledges.jump', frames: 18, js: 'B.place(0, -2.6, 0); B.place(1, 2.6, 0); B.intent(0, { jump: true, jumpHeld: true }); B.intent(1, { jump: true, jumpHeld: true });' },
  { name: 'ledges.on', frames: 80, js: 'B.intent(0, { jumpHeld: false }); B.intent(1, { jumpHeld: false });' },
  { name: 'ledges.high', frames: 22, js: "B.place(0, -0.3, 0); B.intent(0, { jump: true, jumpHeld: true });" },
  { name: 'ledges.high2', frames: 70, js: "B.intent(0, { jump: true, jumpHeld: true });" },
  { name: 'ledges.kick', frames: 30, js: "B.intent(0, { jumpHeld: false }); B.move(1, 'meia-lua');" },
  { name: 'unlock.1', frames: 20, js: 'B.lock(false);' },
  { name: 'unlock.2', frames: 70 },
];
out('lock', lock);

// ---------------------------------------------------------------- the film: ginga, meia-lua, esquiva, au, a jump to a ledge,
// armada, as frames (every other frame: 30 fps), free then locked
function film(locked) {
  const steps = [{ name: 'f0000', query: 'play&two', wake: true, frames: 520,
    js: `B.set('camera', { followDist: 4.4, followFov: 46, followPitch: 0.18 }); B.place(0, -1.2, 0, Math.PI / 2); B.place(1, 1.4, 0, -Math.PI / 2); B.camera({ yaw: 1.1, pitch: 0.18 });${locked ? ' B.lock(true);' : ''}` }];
  // the script, in seconds from the start of the film
  const at = [
    [0.0, locked ? 'B.place(0, -2.6, 0); B.place(1, 1.0, 0);' : ''],
    [1.6, "B.move(0, 'meia-lua');"],
    [1.75, "B.move(1, 'esquiva');"],
    [3.0, locked ? "B.intent(0, { moveX: 1 }); B.move(0, 'au');" : "B.move(0, 'au');"],
    [3.05, 'B.intent(0, { moveX: 0 });'],
    [4.5, "B.intent(1, { moveX: 1 });"],
    [4.8, "B.intent(1, { moveX: 0, jump: true, jumpHeld: true });"],
    [5.4, "B.intent(1, { jumpHeld: false });"],
    [6.4, "B.move(0, 'armada');"],
    [6.5, "B.move(1, 'spin');"],
  ];
  const N = 8 * 30;
  let script = 0;
  for (let k = 1; k <= N; k++) {
    const t = k / 30;
    let js = '';
    while (script < at.length && at[script][0] <= t) js += at[script++][1] + ' ';
    steps.push({ name: `f${String(k).padStart(4, '0')}`, frames: 1, js });
  }
  return steps;
}
out('film-free', film(false));
out('film-locked', film(true));
console.log('wrote scripts/steps/dancers-{moves,loco,lock,film-free,film-locked}.json');

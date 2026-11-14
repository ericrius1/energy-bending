// The duel's movement kit on camera (docs/reports/11-move.md): takes for scripts/critic-cap.mjs.
//   free 3D (the duel is 3D native): ?play&two&duel in the temple, the third-person camera behind player one, the
//     world's own solids for walls: a wall jump off a column, a climb between the stage's pillars, the moves flowing
//     (run, jump, air kick, dash, kick and aú on the run), an aú kicked off a column
//   locked: ?play&two&arena=test in the pool (its test arena drawn by a 2D overlay, composited into every grabbed frame
//     here): a wall slide, a shaft climbed, the dash, the dash-jump, the fast fall beside a plain fall
// Player one is scripted through bend.intent; player two, a bot, stands aside (in the lock unframed), except in the fast
// fall, where it is the plain fall beside it. Free, the stick is camera-relative, so the takes steer in world directions
// through `__go(wx, wz, extra)`, which turns them by the camera's stick yaw every frame.
//   node scripts/steps/move-gen.mjs          → scripts/steps/move-11.json
//   node scripts/critic-cap.mjs scripts/steps/move-11.json --prefix 11 --url http://127.0.0.1:5501/energybending/
import { writeFileSync } from 'node:fs';

const C = 'bend.show.dancers[0].controller.character';
const C1 = 'bend.show.dancers[1].controller.character';
const grabWrap = `
const g0 = bend.grab;
bend.grab = async (type, q, dt) => {
  const url = await g0(type, q, dt);
  const ov = document.getElementById('arena-overlay');
  if (!ov) return url;
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); x.drawImage(ov, 0, 0, img.width, img.height);
  return c.toDataURL(type || 'image/jpeg', q ?? 0.93);
};`;
/** a locked take: awake, the overlay into the grabs, the bot aside (unframed), player one at (s, y above the floor) */
const setup = (s, y = 0, bot = { s: 5.3, framed: false }) => `
bend.wake();${grabWrap}
await bend.step(30);
const c = ${C}, g = c.plane.ground ?? 0;
c.reset(${s}, g + ${y});
const b = ${C1}; b.reset(${bot.s}, g); bend.show.dancers[1].framed = ${bot.framed};
bend.intent(0, null); bend.intent(1, null);
`;
/** a free take: player one at (x, z) facing yaw, the bot at (bx, bz), the camera settled behind */
const setupFree = (x, z, yaw, bx, bz) => `
bend.wake();
await bend.step(30);
bend.set('camera', { followDist: 5.2 });
const c = ${C}; c.reset(${x}, undefined, ${z}); c.yaw = ${yaw};
const b = ${C1}; b.reset(${bx}, undefined, ${bz});
bend.intent(0, null); bend.intent(1, null);
window.__go = (wx, wz, extra = {}) => {
  const k = bend.show.dancers[0].controller, cy = Math.cos(k.inputYaw), sy = Math.sin(k.inputYaw);
  bend.intent(0, { moveX: wx * cy - wz * sy, moveZ: -(wx * sy + wz * cy), ...extra });
};
window.__w = { x: 0, z: 0, extra: {} };
`;
/** every frame of a free take: steer toward the world direction in window.__w */
const steer = 'const w = window.__w; window.__go(w.x, w.z, w.extra); w.extra = { jumpHeld: !!w.held };';
const FREE = 'play&two&duel&world=temple';
const LOCK = 'play&two&arena=test&world=pool';
const takes = [
  // ---------------------------------------------------------------- free 3D, the temple
  {
    // at the tall column in the back row (x 0.58, z -9.76): a run, a jump into it, the slide, the kick back off it
    name: 'move-free-column', query: FREE, seconds: 2.2, fps: 30, warm: 90, sheet: { cols: 4, rows: 4, width: 480 },
    setup: setupFree(4.4, -9.76, -Math.PI / 2, 4.6, -6.8) + 'window.__w = { x: -1, z: 0, held: true, extra: {} };',
    each: steer,
    cues: { 0.2: 'window.__w.extra = { jump: true, jumpHeld: true };', 1.0: 'window.__w.extra = { jump: true, jumpHeld: true };', 1.5: 'window.__w.x = 0;' },
    stills: [0.7, 1.2],
  },
  {
    // between the temple stage's two pillars (x 0.9 and 3.3): kicked from one to the other up to the lintel, then a
    // dash out toward the camera
    name: 'move-free-pillars', query: FREE, seconds: 2.2, fps: 60, warm: 90, sheet: { cols: 4, rows: 4, width: 480 },
    setup: setupFree(2.1, -4.15, Math.PI / 2, 4.6, -1.5) + `window.__w = { x: 1, z: 0, held: true, extra: { jump: true, jumpHeld: true } }; window.__tg = 1; window.__pr = false; window.__ne = ${C}.events.length;`,
    each: `const c = ${C}, W = window;
for (; W.__ne < c.events.length; W.__ne++) if (c.events[W.__ne].type === 'wallJump') { W.__tg = -W.__tg; W.__pr = false; }
if (t < 1.3) {
  W.__w.x = W.__tg; W.__w.z = 0;
  const n = c.wallNormal;
  if (!W.__pr && c.wallKick && n && n[0] * W.__tg < -0.5) { W.__w.extra = { jump: true, jumpHeld: true }; W.__pr = true; }
}
${steer}`,
    cues: { 1.3: 'window.__w = { x: 0, z: 1, held: false, extra: { dash: true } };', 1.6: 'window.__w = { x: 0, z: 0, held: false, extra: {} };' },
    stills: [0.5, 1.4],
  },
  {
    // the moves flowing on open ground: a run, a jump, a martelo in the air, a dash out of it, a landing, a kick on the
    // run, an aú
    name: 'move-free-flow', query: FREE, seconds: 2.8, fps: 30, warm: 90, sheet: { cols: 4, rows: 4, width: 480 },
    setup: setupFree(-9, 9, Math.PI / 2, -9.5, 7) + 'window.__w = { x: 1, z: 0, held: false, extra: {} };',
    each: steer,
    cues: {
      0.35: 'window.__w.held = true; window.__w.extra = { jump: true, jumpHeld: true };',
      0.5: 'window.__w.extra = { kick: true, jumpHeld: true };',
      0.7: 'window.__w.held = false; window.__w.extra = { dash: true };',
      1.2: 'window.__w.extra = { kick: true };',
      1.9: 'window.__w.extra = { spin: true };',
    },
    stills: [0.6, 0.8, 1.3],
  },
  {
    // the column again: the slide, then spin, which kicks off it into an aú
    name: 'move-free-wallau', query: FREE, seconds: 2.0, fps: 30, warm: 90, sheet: { cols: 4, rows: 3, width: 480 },
    setup: setupFree(4.4, -9.76, -Math.PI / 2, 4.6, -6.8) + 'window.__w = { x: -1, z: 0, held: true, extra: {} };',
    each: steer,
    cues: { 0.2: 'window.__w.extra = { jump: true, jumpHeld: true };', 0.9: 'window.__w.x = 0; window.__w.extra = { spin: true };' },
    stills: [1.1],
  },
  // ---------------------------------------------------------------- locked, the pool's test arena
  {
    // from the shaft's floor, a jump into the tall block's left face, arriving near the apex: the slide down it
    name: 'move-wallslide', query: LOCK, seconds: 1.6, fps: 30, warm: 120, sheet: { cols: 4, rows: 3, width: 480 },
    setup: setup(-5.0, 0),
    cues: { 0: 'bend.intent(0, { jump: true, jumpHeld: true, moveX: 1 });', 1.45: 'bend.intent(0, { moveX: 0 });' },
    stills: [0.6, 0.9],
  },
  {
    // the shaft between the left end and the tall block, kicked up wall to wall, out over the block
    name: 'move-climb', query: LOCK, seconds: 2.6, fps: 60, warm: 120, sheet: { cols: 4, rows: 4, width: 480 },
    setup: setup(-4.3, 0) + 'window.__tg = -1; window.__pr = false; window.__ne = c.events.length;',
    cues: { 0: 'bend.intent(0, { jump: true, jumpHeld: true, moveX: -1 });' },
    each: `const c = ${C}, W = window;
for (; W.__ne < c.events.length; W.__ne++) if (c.events[W.__ne].type === 'wallJump') { W.__tg = -W.__tg; W.__pr = false; }
const p = { moveX: W.__tg, jumpHeld: true };
if (!W.__pr && c.wallKick === W.__tg) { p.jump = true; W.__pr = true; }
if (c.y - (c.plane.origin[1] + (c.plane.ground ?? 0)) > 4.6) p.moveX = 1;
bend.intent(0, p);`,
    stills: [1.0, 2.0],
  },
  {
    // a dash along the floor, a jump, a dash up and to the right, a dash down to the floor
    name: 'move-dash', query: LOCK, seconds: 1.6, fps: 60, warm: 120, sheet: { cols: 4, rows: 4, width: 480 },
    setup: setup(-2, 0),
    cues: {
      0.1: 'bend.intent(0, { dash: true });',
      0.55: 'bend.intent(0, { jump: true, jumpHeld: true });',
      0.75: 'bend.intent(0, { dash: true, moveX: 1, moveY: 1 });',
      1.0: 'bend.intent(0, { jumpHeld: false, moveX: 0, moveY: 0 });',
      1.15: 'bend.intent(0, { dash: true, moveX: 1, moveY: -1 });',
      1.35: 'bend.intent(0, { moveX: 0, moveY: 0 });',
    },
    stills: [0.15, 0.85],
  },
  {
    // a run, a dash, a jump out of it: the long jump over the step, into the far end's wall
    name: 'move-dashjump', query: LOCK, seconds: 1.6, fps: 60, warm: 120, sheet: { cols: 4, rows: 4, width: 480 },
    setup: setup(-2.0, 0),
    cues: {
      0: 'bend.intent(0, { moveX: 1 });',
      0.2: 'bend.intent(0, { dash: true, moveX: 1 });',
      0.28: 'bend.intent(0, { jump: true, jumpHeld: true, moveX: 1 });',
      1.4: 'bend.intent(0, { moveX: 0, jumpHeld: false });',
    },
    stills: [0.5],
  },
  {
    // a jump and the air jump, then down: player one fast-falls; the bot beside it (framed) falls plain
    name: 'move-fastfall', query: LOCK, seconds: 1.5, fps: 60, warm: 120, sheet: { cols: 4, rows: 4, width: 480 },
    setup: setup(3.6, 0, { s: 4.8, framed: true }),
    cues: {
      0: 'bend.intent(0, { jump: true, jumpHeld: true }); bend.intent(1, { jump: true, jumpHeld: true });',
      0.3: 'bend.intent(0, { jump: true }); bend.intent(1, { jump: true });',
      0.62: 'bend.intent(0, { moveY: -1 });',
      1.3: 'bend.intent(0, { moveY: 0, jumpHeld: false }); bend.intent(1, { jumpHeld: false });',
    },
    stills: [0.8],
  },
];
writeFileSync(new URL('./move-11.json', import.meta.url), JSON.stringify(takes, null, 1) + '\n');
console.log(`${takes.length} takes → scripts/steps/move-11.json`);

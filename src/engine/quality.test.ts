import assert from 'node:assert/strict';
import { FrameQuality } from './quality';

const feed = (q: FrameQuality, seconds: number, fps: number) => {
  for (let i = 0; i < Math.ceil(seconds * fps); i++) q.step(1 / fps);
};
for (const fps of [30, 60, 120, 144]) {
  const q = new FrameQuality(); feed(q, 60, fps);
  assert.equal(q.level, 0, `${fps} FPS keeps the full look`);
}
const q = new FrameQuality();
feed(q, 10, 20); assert.equal(q.level, 0, 'startup does not lower quality');
feed(q, 10, 20); assert.equal(q.level, 1, 'sustained slow frames lower one step');
feed(q, 30, 20); assert.equal(q.level, 3, 'sustained pressure reaches the bounded fallback');
feed(q, 30, 30); assert.equal(q.level, 3, 'stable 30 FPS does not oscillate');
feed(q, 18, 60); assert.equal(q.level, 3, 'recovery needs sustained headroom');
feed(q, 5, 60); assert.equal(q.level, 2, 'recovers one step at a time');
feed(q, 65, 60); assert.equal(q.level, 0, 'recovers fully');
const pause = new FrameQuality(); feed(pause, 15, 60);
for (let i = 0; i < 20; i++) { pause.step(1); pause.step(0.1, false); }
feed(pause, 2, 20); assert.equal(pause.level, 0, 'hidden and resumed frames are not slow-device evidence');
const hitch = new FrameQuality(); feed(hitch, 15, 60); hitch.step(0.2); feed(hitch, 10, 60);
assert.equal(hitch.level, 0, 'one hitch does not lower quality');
const clamped = new FrameQuality(); feed(clamped, 35, 10);
assert.equal(clamped.level, 3, 'raw slow frames still count when simulation dt would be clamped');
const verySlow = new FrameQuality(); feed(verySlow, 40, 3);
assert.equal(verySlow.level, 3, 'very slow visible rendering is not mistaken for a paused tab');
console.log('frame quality: pacing, bounds, warmup, pauses and recovery passed');

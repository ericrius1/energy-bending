// The near fade's frame test (fade-frame.ts), checked without a GPU: a piece standing in the near part of the frame
// dissolves, eased; it doesn't flicker at the edge of the test; nothing a body stands on or is about to land on
// dissolves; boxes side by side are one piece; never more pieces than the shaders' slots; off, everything comes back.
import { test, assert, done } from '../dancer/test/check';
import { Solids } from '../engine/camera';
import { FRAME_SLOTS, FrameFade, type FrameBody, type FrameView } from './fade-frame';
import { box, type Solid } from './solids';

type V3 = [number, number, number];
const DT = 1 / 60;
/** the eye 6 m in front of the pair, looking at it along -z (the duel camera's side-on view) */
const view = (x = 0): FrameView => ({ position: [x, 1.6, 6], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], fovY: (46 * Math.PI) / 180, aspect: 16 / 9 });
/** a body standing with its feet at `feet`, moving at `vel` */
const body = (feet: V3, vel: V3 = [0, 0, 0]): FrameBody => {
  const at = (dy: number, dx = 0): V3 => [feet[0] + dx, feet[1] + dy, feet[2]];
  return { mid: at(0.95), pts: [at(0.05, 0.15), at(0.05, -0.15), at(0.95), at(1.3), at(1.2, 0.5), at(1.2, -0.5), at(1.8)], vel };
};
const pair = [body([-0.6, 0, 0]), body([0.6, 0, 0])];
/** a block 2.6 m from the eye, low in the frame's right half: across a near corner */
const block = box([1.2, 0.8, 3.4], [0.5, 0.8, 0.3]);
const run = (f: FrameFade, list: Solid[], frames: number, v = view(), bodies = pair, on = true) => {
  const S = new Solids(list);
  for (let i = 0; i < frames; i++) f.update(DT, v, S, bodies, on);
};

test('a piece in the near part of the frame dissolves, eased in', () => {
  const f = new FrameFade(), list = [block];
  run(f, list, 1);
  const k1 = f.strengthOf(block);
  assert(k1 > 0 && k1 < 0.2, `after a frame ${k1.toFixed(2)} (eased, not at once)`);
  run(f, list, 60);
  const k60 = f.strengthOf(block);
  assert(k60 > 0.95, `after a second ${k60.toFixed(2)}`);
  assert(f.top().length === 1 && f.top()[0].members[0] === block, 'it is handed to the shaders');
  assert(f.far > 5 && f.far < 6, `nothing past the pair's own depth dissolves (far ${f.far.toFixed(2)} m)`);
  return `k ${k1.toFixed(3)} after a frame, ${k60.toFixed(3)} after a second; cover ${(100 * f.top()[0].cover).toFixed(1)}% of the frame, ${(100 * f.top()[0].corner).toFixed(0)}% of its corners`;
});

test('a piece behind the near part, or out of frame, stays', () => {
  const f = new FrameFade();
  // (at the pair's own depth, beside them; and one behind the eye)
  const beside = box([2.5, 0.8, 0.3], [0.5, 0.8, 0.3]), behind = box([0, 1, 8], [1, 1, 0.3]);
  run(f, [beside, behind], 90);
  assert(f.strengthOf(beside) === 0 && f.strengthOf(behind) === 0, `beside ${f.strengthOf(beside)}, behind ${f.strengthOf(behind)}`);
});

test('no flicker: a piece going in and out of the test every 0.2 s keeps dissolving, and comes back only after its hold', () => {
  const f = new FrameFade(), list = [block];
  let last = 0, drops = 0;
  // (the eye swings 3 m sideways and back: the block in the near frame, then well out of it)
  for (let i = 0; i < 120; i++) {
    run(f, list, 1, view(Math.floor(i / 12) % 2 ? -6 : 0));
    const k = f.strengthOf(block);
    if (k < last - 1e-6) drops++;
    last = k;
  }
  assert(drops === 0, `its strength fell ${drops} times while it went in and out`);
  // out of frame for good: held, then eased back
  run(f, list, 30, view(-6));
  assert(f.strengthOf(block) > 0.9, `held 0.5 s after it left (${f.strengthOf(block).toFixed(2)})`);
  run(f, list, 330, view(-6));
  assert(f.strengthOf(block) === 0, `back after its hold and ease (${f.strengthOf(block).toFixed(3)})`);
});

test('nothing a body stands on, hangs from or is about to land on dissolves', () => {
  // a slab from the pair toward the eye, a body standing on it
  const slab = box([0.6, 0.25, 2], [0.6, 0.25, 2]);
  const f = new FrameFade();
  run(f, [slab], 90, view(), [body([-0.6, 0, 0]), body([0.6, 0.5, 0.4])]);
  assert(f.strengthOf(slab) === 0, `stood on: ${f.strengthOf(slab)}`);
  // a body falling onto the block (0.5 s above it, moving toward it): kept whole
  const g = new FrameFade();
  run(g, [block], 1, view(), [body([-0.6, 0, 0]), body([1.2, 3.2, 3.4], [0, -2, 0])]);
  assert(g.strengthOf(block) === 0, `about to be landed on: ${g.strengthOf(block)}`);
  // dissolving, then a body lands on it: it comes back at once and stays whole a moment after the body has gone
  const h = new FrameFade();
  run(h, [block], 60);
  run(h, [block], 12, view(), [body([-0.6, 0, 0]), body([1.2, 1.6, 3.4])]);
  assert(h.strengthOf(block) < 0.1, `landed on: back to ${h.strengthOf(block).toFixed(2)} in 0.2 s`);
  run(h, [block], 30);
  assert(h.strengthOf(block) === 0, `whole a moment after the body left (${h.strengthOf(block).toFixed(2)})`);
});

test('boxes side by side are one piece (a shelf of blades dissolves whole)', () => {
  const a = box([0.9, 0.8, 3.4], [0.3, 0.8, 0.3]), b = box([1.5, 0.75, 3.45], [0.29, 0.75, 0.28]), far = box([3, 0.8, 3.4], [0.3, 0.8, 0.3]);
  const f = new FrameFade();
  run(f, [a, b, far], 60);
  const p = f.top()[0];
  assert(p && p.members.length === 2 && p.members.includes(a) && p.members.includes(b), `members ${p?.members.length}`);
  assert(p.solid.kind === 'box' && Math.abs(p.solid.h[0] - 0.6) < 0.02, 'its shape is the box round both');
  assert(f.strengthOf(a) === f.strengthOf(b), 'one strength');
});

test(`never more pieces dissolving than the shaders' ${FRAME_SLOTS} slots`, () => {
  const list: Solid[] = [];
  for (let i = 0; i < 40; i++) list.push(box([-3 + (i % 10) * 0.65, 0.2 + Math.floor(i / 10) * 0.7, 3 + (i % 3) * 0.2], [0.12, 0.12, 0.12]));
  const f = new FrameFade(), S = new Solids(list);
  let most = 0;
  for (let i = 0; i < 120; i++) {
    f.update(DT, view(Math.sin(i / 20)), S, pair, true);
    let n = 0;
    for (const p of f.pieces.values()) if (p.k > 0 || p.on) n++;
    most = Math.max(most, n);
  }
  assert(most <= FRAME_SLOTS, `${most} at once`);
  return `${most} at once`;
});

test('the outline only where the pair can use the piece: kept near a body, gone on one the pair is nowhere near', () => {
  // the block 2.6 m from the eye, the pair 3.4 m beyond it: nobody near; then a body beside it
  const f = new FrameFade();
  run(f, [block], 90);
  const far = f.top()[0];
  assert(far && far.k > 0.95 && far.line < 0.01, `far from the pair: line ${far?.line.toFixed(2)} (dist ${far?.dist.toFixed(2)} m)`);
  const g = new FrameFade();
  run(g, [block], 90, view(), [body([-0.6, 0, 0]), body([1.6, 0, 2.0])]);
  const near = g.top()[0];
  assert(near && near.k > 0.95 && near.line > 0.6, `a body beside it: line ${near?.line.toFixed(2)} (dist ${near?.dist.toFixed(2)} m)`);
  return `line ${far.line.toFixed(2)} at ${far.dist.toFixed(1)} m from the pair, ${near.line.toFixed(2)} at ${near.dist.toFixed(1)} m`;
});

test('a held decision while the camera turns: a piece swept out of the frame by a turn stays dissolved till it settles', () => {
  const f = new FrameFade(), list = [block];
  run(f, list, 60);
  // the camera turns away (forward swinging at 1 rad/s) for 3 s: longer than the hold
  const turned = (a: number): FrameView => ({ ...view(), forward: [Math.sin(-a), 0, -Math.cos(a)], right: [Math.cos(a), 0, Math.sin(a)] });
  let a = 0;
  for (let i = 0; i < 180; i++) { a += DT * (i % 120 < 60 ? 1 : -1); run(f, list, 1, turned(a)); }
  assert(f.strengthOf(block) > 0.95, `held through the turn (${f.strengthOf(block).toFixed(2)}, turning ${f.turning.toFixed(2)} rad/s)`);
  // steady, out of frame: held for the hold, then back
  run(f, list, 420, turned(-1.2));
  assert(f.strengthOf(block) === 0, `back once the turn settled (${f.strengthOf(block).toFixed(3)})`);
});

test('off (the jogo, a film, `fade.frame` false): everything eases back', () => {
  const f = new FrameFade();
  run(f, [block], 60);
  run(f, [block], 1, view(), pair, false);
  const k = f.strengthOf(block);
  assert(k > 0.9, `eased, not at once (${k.toFixed(2)})`);
  run(f, [block], 240, view(), pair, false);
  assert(f.strengthOf(block) === 0 && f.top().length === 0, 'back');
});

done();

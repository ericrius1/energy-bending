// The full body: the retargeter's hints on the CMU rig, the IntentController end to end (Intents in, a posed rig out,
// with motion-matched walking blended in), and a CMU clip as a move through the prototype's adapter. Reads the real
// clips from public/motion.
import { readFileSync } from 'node:fs';
import { vec3, type Vec3 } from 'math';
import type { Motion } from '../../skeleton/clips';
import { JOINT, Skeleton } from '../../skeleton/rig';
import { newLandmarkPose } from '../../skeleton/landmarks';
import { fitSkeleton } from '../../skeleton/retarget';
import { Moves } from '../../skeleton/locomotion/moves';
import { IntentController } from '../intent-controller';
import { clipMove, pirouetteFlourish } from '../clip-move';
import { MOVES, registerMove, LOCO, NP, J, ANKLE_H } from '../moves';
import { makeIntent } from '../../input/intent';
import type { FrameCtx } from '../../engine/frame';
import { test, assert, near, done } from './check';

const load = (name: string): Motion => {
  const meta = JSON.parse(readFileSync(`public/motion/${name}.json`, 'utf8'));
  const bin = readFileSync(`public/motion/${name}.bin`);
  return { ...meta, bin: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) };
};
const motion = load('motion'), travel = load('travel');
const rig = motion.skeletons[0];
const bones = (sk: Skeleton) => rig.joints.map((j, k) => (j.parent < 0 ? 0 : vec3.distance(sk.pos[k], sk.pos[j.parent])));
const rest = (() => { const sk = new Skeleton(rig); return rig.joints.map((j) => Math.hypot(...j.offset)); void sk; })();
const frame = (beats: number): FrameCtx => ({ beat: { beats, bpm: 112 } } as unknown as FrameCtx);

test('hints keep every bone its own length; flat feet stand on the floor, kicking feet point', () => {
  const lm = newLandmarkPose(), sk = new Skeleton(rig);
  LOCO.ginga(lm.p, 0.2);
  fitSkeleton(lm, sk, 0, { ground: 0, ankle: ANKLE_H, feet: ['auto', 'auto'], hands: ['relaxed', 'fist'], curve: 1, lookAt: [0, 1.5, 3], look: 1 });
  const b = bones(sk);
  let worst = 0; for (let k = 0; k < b.length; k++) worst = Math.max(worst, Math.abs(b[k] - rest[k]));
  assert(worst < 1e-4, 'a bone changed length by ' + worst);
  const toe = Math.min(sk.pos[JOINT.LeftToeBase][1], sk.pos[JOINT.RightToeBase][1]);
  assert(toe > -0.03 && toe < 0.08, 'toes on the floor: ' + toe.toFixed(3));
  // a flat foot: the toe about as high as the ankle less the rig's own drop (level), not pointed down
  const drop = sk.pos[JOINT.LeftFoot][1] - sk.pos[JOINT.LeftToeBase][1];
  assert(drop < 0.06, 'left foot flat: ankle above toe by ' + drop.toFixed(3));
  // meia-lua at the top: the right foot pointed along the shin
  const k = newLandmarkPose(), ks = new Skeleton(rig);
  MOVES['meia-lua'].pose(0.47, { hand: 1, aim: null, air: false, beat: 0, groove: 1, t: 0 }, k.p);
  fitSkeleton(k, ks, 0, { ground: 0, ankle: ANKLE_H, feet: ['auto', 'point'], hands: ['fist', 'fist'], curve: 1 });
  const shin = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), ks.pos[JOINT.RightFoot], ks.pos[JOINT.RightLeg]));
  const foot = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), ks.pos[JOINT.RightToeBase], ks.pos[JOINT.RightFoot]));
  const along = vec3.dot(shin, foot);
  assert(along > 0.75, 'pointed: the foot follows the shin (cos ' + along.toFixed(2) + ')');
  assert(ks.pos[JOINT.RightFoot][1] > 1.0, 'the kick is high: ankle at ' + ks.pos[JOINT.RightFoot][1].toFixed(2));
  return `bones within ${worst.toExponential(1)} m, toes at ${toe.toFixed(3)} m, pointed foot cos ${along.toFixed(2)}`;
});

test('the head turns toward what it looks at, within a neck\'s reach', () => {
  const lm = newLandmarkPose(), a = new Skeleton(rig), b = new Skeleton(rig);
  LOCO.ginga(lm.p, 0);
  fitSkeleton(lm, a, 0, { ground: 0, curve: 1 });
  fitSkeleton(lm, b, 0, { ground: 0, curve: 1, lookAt: [3, 1.3, 1], look: 1 });
  const fwd = (s: Skeleton) => vec3.transformQuat(vec3.create(), [0, 0, 1] as Vec3, s.rot[JOINT.Head]);
  const fa = fwd(a), fb = fwd(b);
  assert(fb[0] > fa[0] + 0.3, `turned toward +x: ${fa[0].toFixed(2)} → ${fb[0].toFixed(2)}`);
});

test('IntentController: Intents in, a posed rig out; locked to a plane; free with mocap walking blended in', () => {
  const moves = new Moves(motion, travel);
  const c = new IntentController(rig, { seat: 0, moves });
  const sk = new Skeleton(rig);
  // stand, then walk (the walk modifier: 1.3 m/s, mocap's band), then run
  let w = 0;
  for (let i = 0; i < 60; i++) c.update(1 / 60, frame(i / 32), sk);
  const ankle0 = Math.min(sk.pos[JOINT.LeftFoot][1], sk.pos[JOINT.RightFoot][1]);
  c.script.set({ moveX: 1, walk: true });
  for (let i = 0; i < 120; i++) { c.update(1 / 60, frame(2 + i / 32), sk); w = Math.max(w, c.mocapW); }
  const walkedTo = c.character.x;
  c.script.set({ walk: false });
  for (let i = 0; i < 90; i++) c.update(1 / 60, frame(6 + i / 32), sk);
  const runW = c.mocapW;
  for (const p of sk.pos.slice(0, sk.count)) for (const v of p) assert(Number.isFinite(v), 'NaN');
  assert(w > 0.9, 'mocap walking shows at a walk: ' + w.toFixed(2));
  assert(runW < 0.2, 'and gives way to the procedural run: ' + runW.toFixed(2));
  assert(walkedTo > 1.5, 'walked ' + walkedTo.toFixed(2));
  // the hips over the physics' root
  near(sk.pos[0][0], c.character.x, 0.25, 'hips over the root');
  // locked: onto a plane with a ledge, jump up onto it
  c.script.set({ moveX: 0 });
  c.setPlane({ id: 't', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 6, ground: 0, ledges: [{ id: 'l', x0: -10, x1: 10, y: 1.5 }], spawns: [[0, 0]] });
  for (let i = 0; i < 60; i++) c.update(1 / 60, frame(9 + i / 32), sk);
  c.script.set({ jump: true, jumpHeld: true });
  for (let i = 0; i < 90; i++) c.update(1 / 60, frame(11 + i / 32), sk);
  assert(c.character.grounded && Math.abs(c.character.y - 1.5) < 1e-6, 'on the ledge: ' + c.character.y);
  const feet = Math.min(sk.pos[JOINT.LeftToeBase][1], sk.pos[JOINT.RightToeBase][1]);
  assert(feet > 1.47 && feet < 1.62, 'its feet on the ledge: ' + feet.toFixed(3));
  return `mocap weight at a walk ${w.toFixed(2)}, at a run ${runW.toFixed(2)}; standing ankle ${ankle0.toFixed(3)} m; toes on the ledge at ${feet.toFixed(2)}`;
});

test('a CMU clip as a move through the adapter: the pirouette flourish turns twice, in place, and ends where it began', () => {
  const def = pirouetteFlourish(motion)!;
  assert(def, 'the pirouette clip is there');
  const m = registerMove(def);
  assert(MOVES.pirueta === m && m.sampled, 'registered as a sampled move');
  const out = new Float32Array(NP);
  let turn = 0, prev: number | null = null, worstHip = 0;
  for (let u = 0; u <= 1.0001; u += 0.01) {
    m.pose(u, { hand: 1, aim: null, air: false, beat: 0, groove: 1, t: 0 }, out);
    const sx = out[3 * J.LS] - out[3 * J.RS], sz = out[3 * J.LS + 2] - out[3 * J.RS + 2], a = Math.atan2(-sz, sx);
    if (prev != null) { let d = a - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += d; }
    prev = a;
    worstHip = Math.max(worstHip, Math.hypot((out[3 * J.LH] + out[3 * J.RH]) / 2, (out[3 * J.LH + 2] + out[3 * J.RH + 2]) / 2));
    assert(out[3 * J.HEAD + 1] > 1.3 && Math.min(out[3 * J.LA + 1], out[3 * J.RA + 1]) < 0.35, `standing at u ${u.toFixed(2)}: ${Array.from(out).map((v) => v.toFixed(2)).join(' ')}`);
  }
  const deg = Math.abs(turn) * 57.3;
  assert(deg > 600 && deg < 840, 'about two turns: ' + deg.toFixed(0));
  assert(worstHip < 1e-4, 'in place: the hips stay over the root (' + worstHip + ')');
  // and a character can dance it
  const c = new IntentController(rig, { seat: 0 }), sk = new Skeleton(rig);
  for (let i = 0; i < 20; i++) c.update(1 / 60, frame(i / 32), sk);
  assert(c.move('pirueta'), 'started');
  let n = 0; while (c.character.move && n < 400) { c.update(1 / 60, frame(1 + n / 32), sk); n++; }
  assert(n > 60 && !c.character.move, 'danced it through: ' + n + ' frames');
  const custom = clipMove(motion, { name: 'x', piece: 'salsa', from: 2, to: 3, travel: true });
  assert(custom.dur === 1 && typeof custom.sample === 'function', 'any stretch of any clip');
  delete MOVES.pirueta;
  return `${deg.toFixed(0)}° over ${m.dur.toFixed(2)} s; ${n} frames danced`;
});

done();
void makeIntent;

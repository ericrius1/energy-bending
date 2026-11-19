// Interactive tutorial, human dance physics, target assist, and directional foot compass tests (pure Node).
import { test, assert, done } from '../../dancer/test/check';
import { TutorialEngine, type TutorialSample } from '../tutorial';
import { Character, HUMAN_DANCE_PHYS, PHYS } from '../../dancer/character';
import { YouTell } from '../../duel/you';
import { Glows } from '../glow';

const blank = (o: Partial<TutorialSample> = {}): TutorialSample => ({
  dt: 1 / 60,
  root: [0, 0, 0],
  partner: [2, 0, 0],
  camMoved: false,
  viewToggled: false,
  jumped: false,
  dashed: false,
  dodged: false,
  moves: [],
  exchanged: false,
  caughtOrFlung: false,
  powered: false,
  formedOrMerged: false,
  ...o,
});

const advanceHold = (T: TutorialEngine) => {
  let ev: 'step' | 'complete' | null = null;
  for (let i = 0; i < 45; i++) {
    const r = T.update(blank());
    if (r) ev = r;
  }
  return ev;
};

const stepId = (T: TutorialEngine) => T.current?.id;
const stateOf = (T: TutorialEngine): string => T.state;

test('dance tutorial: walks through all 6 interactive steps and finishes cleanly', () => {
  const T = new TutorialEngine('dance');
  T.start();
  assert(T.active && stepId(T) === 'move', 'starts on move step');
  // 1. Move >= 1.8m
  let x = 0;
  let res: 'step' | 'complete' | null = null;
  for (let i = 0; i < 30 && !res; i++) { x += 0.1; res = T.update(blank({ root: [x, 0, 0] })); }
  assert(res === 'step', 'move step completes once player travels');
  advanceHold(T);
  assert(stepId(T) === 'camera', 'advances to camera');
  // 2. Steer camera
  assert(T.update(blank({ viewToggled: true })) === 'step', 'camera completes on view toggle');
  advanceHold(T);
  assert(stepId(T) === 'jump', 'advances to jump & evade');
  // 3. Jump + dodge
  assert(T.update(blank({ jumped: true })) === null && T.fraction === 0.5, 'jump is half');
  assert(T.update(blank({ dodged: true })) === 'step', 'dodge completes jump/evade');
  advanceHold(T);
  assert(stepId(T) === 'attack', 'advances to strike & kick');
  // 4. Strike & kick
  assert(T.update(blank({ moves: ['strike'] })) === null && T.fraction === 0.5, 'first strike counts');
  assert(T.update(blank({ moves: ['meia-lua'] })) === 'step', 'kick completes attack step');
  advanceHold(T);
  assert(stepId(T) === 'acro', 'advances to spin & cartwheel');
  // 5. Cartwheel
  assert(T.update(blank({ moves: ['au'] })) === 'step', 'cartwheel completes acro');
  advanceHold(T);
  assert(stepId(T) === 'flow', 'advances to dance together');
  // 6. Exchange / Form
  assert(T.update(blank({ exchanged: true })) === 'step', 'exchange completes final step');
  const fin = advanceHold(T);
  assert(fin === 'complete' && stateOf(T) === 'celebrate', 'enters celebration state');
  for (let i = 0; i < 200; i++) T.update(blank());
  assert(stateOf(T) === 'done' && !T.active, 'finishes cleanly after celebration');
});

test('duel tutorial: walks through all 6 duel steps (move, camera, dash, moves, catch, powers)', () => {
  const T = new TutorialEngine('duel');
  T.start();
  assert(stepId(T) === 'move', 'duel starts on move');
  let x = 0, res: 'step' | 'complete' | null = null;
  for (let i = 0; i < 30 && !res; i++) { x += 0.1; res = T.update(blank({ root: [x, 0, 0] })); }
  assert(res === 'step', 'duel move completes');
  advanceHold(T);
  // camera via orbit duration
  res = null;
  for (let i = 0; i < 20 && !res; i++) res = T.update(blank({ camMoved: true }));
  assert(res === 'step', 'duel camera completes on orbit');
  advanceHold(T);
  assert(stepId(T) === 'dash', 'duel dash step');
  T.update(blank({ jumped: true }));
  assert(T.update(blank({ dashed: true })) === 'step', 'jump + dash completes');
  advanceHold(T);
  assert(stepId(T) === 'moves', 'duel moves step');
  T.update(blank({ moves: ['meia-lua'] }));
  assert(T.update(blank({ moves: ['spin'] })) === 'step', 'two moves complete');
  advanceHold(T);
  assert(stepId(T) === 'catch', 'duel catch step');
  assert(T.update(blank({ caughtOrFlung: true })) === 'step', 'catch completes');
  advanceHold(T);
  assert(stepId(T) === 'powers', 'duel powers step');
  assert(T.update(blank({ powered: true })) === 'step', 'casting a power completes');
  assert(advanceHold(T) === 'complete', 'duel tutorial completes');
});

test('HUMAN_DANCE_PHYS: snappy, flow-canceling, and free-3D target assist without touching PHYS', () => {
  assert(PHYS.snappy === false && PHYS.flow === false, 'legacy PHYS untouched for deterministic tests');
  assert(HUMAN_DANCE_PHYS.snappy === true && HUMAN_DANCE_PHYS.flow === true && HUMAN_DANCE_PHYS.dash === true, 'human dance phys enabled');
  const c = new Character({ seat: 0, x: 0, y: 0, z: 0 });
  c.setProfile('human');
  c.yaw = 0.2; // slightly off-angle from partner at +z (yaw 0)
  c.lookAt = [0, 0, 3];
  assert(c.startMove('meia-lua'), 'kick starts');
  assert(Math.abs(c.yaw) < 1e-4, `target assist aligned yaw toward nearby partner (got ${c.yaw.toFixed(3)})`);
  // facing directly away should NOT snap
  c.move = null;
  c.yaw = Math.PI;
  assert(c.startMove('meia-lua'), 'kick away starts');
  assert(Math.abs(Math.abs(c.yaw) - Math.PI) < 1e-4, 'does not override intentional move away');
});

test('YouTell: directional foot compass chevron draws extra glows when yaw is provided', () => {
  const G1 = new Glows(), G2 = new Glows();
  const base = (G: Glows) => ({
    glows: G, head: () => [0, 1.75, 0] as [number, number, number], root: () => [0, 0, 0] as [number, number, number],
    ground: () => 0, eye: () => [0, 1.5, 8] as [number, number, number], pressed: () => false, away: () => 0, device: () => 'keyboard-solo',
  });
  const tNoYaw = new YouTell(base(G1), () => [0]);
  const tYaw = new YouTell({ ...base(G2), yaw: () => 0.5 }, () => [0]);
  for (let i = 0; i < 60; i++) { G1.clear(); G2.clear(); tNoYaw.update(1 / 60); tYaw.update(1 / 60); }
  assert(G2.count === G1.count + 2, `chevron adds 2 crisp directional segments (${G1.count} -> ${G2.count})`);
});

done();

// Unit tests for the runner (src/play/runner.ts, track.ts, Character.rail): the loops' geometry (a point laid at s
// and l reads back as s and l; the frame turns smoothly; every world's loop is long enough to run), and a body on the
// track (it runs along by itself, holds its line round the curve with no stick, slides across only while the stick
// says so and stops when it lets go, never leaves the track's sides, jumps the moment Space is pressed, and its facing
// never snaps after a trick). Pure Node, no DOM/GPU.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Track, trackFor } from '../track';
import { LOOPS } from '../loops';
import { Character, type Rail } from '../../dancer/character';
import { makeIntent, type Intent } from '../../input/intent';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** a rail on a track whose stick is the intent's moveX (across) and moveZ (along), as behind the runners */
function railOn(T: Track, speed = 6): Rail {
  return {
    at: (x, z) => T.at(x, z), half: T.half, speed, slide: 5.2,
    steer: (_c, it) => (it.railTarget != null ? { lat: 0, push: it.railPush ?? 0, target: it.railTarget } : { lat: it.moveX, push: it.moveZ }),
    respawn: () => T.point(0, 0),
  };
}

function runner(T: Track) {
  const c = new Character({ seat: 0, x: T.point(0)[0], z: T.point(0)[1] });
  c.enableSurf(true);
  c.rail = railOn(T);
  c.surfHeading = c.yaw = T.frame(0).yaw;
  return c;
}

function step(c: Character, n: number, it: Partial<Intent> = {}, dt = 1 / 60) {
  for (let i = 0; i < n; i++) c.update(dt, { ...makeIntent(), ...it }, null);
}

describe('runner loops', () => {
  for (const [w, L] of Object.entries(LOOPS)) {
    it(`${w}: a point laid at (s, l) reads back as (s, l); the loop is long and turns smoothly`, () => {
      const T = trackFor(w)!;
      assert.ok(T.length > 60, `${w} lap ${T.length.toFixed(1)} m`);
      assert.equal(L.r.length, 120);
      let prevYaw = T.frame(0).yaw;
      for (let s = 0; s < T.length; s += 0.73) {
        for (const l of [-T.half, 0, T.half]) {
          const [x, z] = T.point(s, l), p = T.project(x, z, s);
          // (off the middle of a loop that isn't round, s is read through the angle: a few centimetres a metre)
          assert.ok(Math.abs(p.s - s) < 0.08 + Math.abs(l) * 0.12, `${w} s ${s.toFixed(2)} l ${l}: s back ${p.s.toFixed(3)}`);
          assert.ok(Math.abs(p.l - l) < 0.05, `${w} s ${s.toFixed(2)} l ${l}: l back ${p.l.toFixed(3)}`);
        }
        const yaw = T.frame(s).yaw;
        // (at most about 6° in 0.73 m: no corners)
        assert.ok(Math.abs(wrap(yaw - prevYaw)) < 0.11, `${w} turn at s ${s.toFixed(1)}: ${wrap(yaw - prevYaw).toFixed(3)} rad`);
        prevYaw = yaw;
      }
    });
  }
  it('a world without room for a loop has none (the geode: the runner takes the dance to the pool)', () => {
    assert.equal(trackFor('geode'), null);
  });
});

describe('a body on the track', () => {
  const T = trackFor('pool')!;

  it('runs along by itself at the cruise, holding its line round the curve with no stick', () => {
    const c = runner(T);
    const s0 = T.project(c.root[0], c.root[2]).s;
    step(c, 300);
    const p = T.project(c.root[0], c.root[2], s0 + 25);
    assert.ok(p.s - s0 > 22 && p.s - s0 < 33, `ran ${(p.s - s0).toFixed(1)} m in 5 s`);
    assert.ok(Math.abs(p.l) < 0.05, `drifted ${p.l.toFixed(3)} m off its line`);
    assert.ok(Math.abs(c.railSp - 6) < 0.2, `cruise ${c.railSp.toFixed(2)}`);
  });

  it('slides across only while the stick says so, stops when it lets go, and keeps inside the sides', () => {
    const c = runner(T);
    step(c, 12, { moveX: 1 });
    const l1 = c.railL;
    assert.ok(l1 > 0.2, `slid right ${l1.toFixed(2)}`);
    step(c, 12);
    const l2 = c.railL;
    assert.ok(l2 - l1 < 0.35, `coasted ${(l2 - l1).toFixed(2)} m after letting go`);
    step(c, 60);
    assert.ok(Math.abs(c.railL - l2) < 0.02, 'stays where it was let go');
    step(c, 120, { moveX: 1 });
    assert.ok(c.railL <= T.half + 0.05, `kept inside the right side: ${c.railL.toFixed(2)}`);
    step(c, 180, { moveX: -1 });
    assert.ok(c.railL >= -T.half - 0.05, `kept inside the left side: ${c.railL.toFixed(2)}`);
    const p = T.project(c.root[0], c.root[2]);
    assert.ok(Math.abs(p.l - c.railL) < 0.1, `the body is on its line: ${p.l.toFixed(2)} vs ${c.railL.toFixed(2)}`);
  });

  it('jumps the moment Space is pressed (held, too: no charge on the track)', () => {
    const c = runner(T);
    step(c, 30);
    assert.ok(c.grounded);
    step(c, 1, { jump: true, jumpHeld: true });
    assert.ok(c.v[1] > 4 || !c.grounded, `left the ground at once: vy ${c.v[1].toFixed(2)}`);
  });

  it('faces along the track through a trick and out of it, never snapping round', () => {
    const c = runner(T);
    step(c, 30);
    let prev = c.yaw, worst = 0;
    for (let i = 0; i < 240; i++) {
      const it: Partial<Intent> = i === 10 ? { spin: true } : i === 80 ? { dodge: true } : i === 150 ? { jump: true, jumpHeld: true } : i === 170 ? { jump: true } : {};
      step(c, 1, { ...it, moveX: i > 40 && i < 70 ? 1 : 0 });
      worst = Math.max(worst, Math.abs(wrap(c.yaw - prev)) * 60);
      prev = c.yaw;
    }
    assert.ok(worst < 4, `fastest turn ${worst.toFixed(2)} rad/s`);
  });

  it('a brain steers to a target line and catches up with a push', () => {
    const c = runner(T);
    step(c, 90, { railTarget: -1, railPush: 3 });
    assert.ok(Math.abs(c.railL + 1) < 0.1, `on its line: ${c.railL.toFixed(2)}`);
    assert.ok(c.railSp > 9, `pushing to catch up: ${c.railSp.toFixed(2)} m/s`);
  });
});

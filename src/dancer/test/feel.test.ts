// The duel's movement kit, measured (docs/design/duel.md "The feel, in numbers"; docs/reports/11-move.md has the
// table this prints). Character is pure, so a body is driven by Intents alone, as a player or a virtual player would,
// on test stages: a long flat floor, a two-wall shaft, a plane with walls off its origin's height. Each test checks a
// number against the brief's aim and says what it measured; the last prints the feel table (markdown).
// The jogo's feel (PHYS) is character.test.ts's: nothing here changes it (the last test checks the jogo's body still
// has no kit).
import { Character, PHYS, DUEL_PHYS, type CharEvent } from '../character';
import { type StagePlane } from '../../engine/camera';
import { makeIntent, type Intent } from '../../input/intent';
import { box, cylinder, type Solid } from '../../worlds/solids';
import { layoutTemple, solidsOf } from '../../worlds/temple/layout';
import { test, assert, near, done } from './check';

const I = (o: Partial<Intent> = {}): Intent => Object.assign(makeIntent(), o);
const BPM = 120;
const FLAT: StagePlane = { id: 'flat', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 30, ground: 0, ledges: [], spawns: [[0, 0], [2, 0]] };
/** a shaft 2.4 m wide between two walls 30 m high, and a floor */
const SHAFT: StagePlane = {
  id: 'shaft', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 12, ground: 0, ledges: [], spawns: [[0, 0], [0, 0]],
  walls: [{ id: 'L', s: -1.2, side: 1, y0: 0, y1: 30 }, { id: 'R', s: 1.2, side: -1, y0: 0, y1: 30 }],
};
const make = (plane: StagePlane, s = 0, phys = DUEL_PHYS) => { const c = new Character({ plane, phys }); c.reset(s, 0); settle(c); return c; };
/** a frame's worth of standing, so the body is grounded and its buffers are clear */
function settle(c: Character, secs = 0.2) { for (let i = 0; i < Math.round(secs * 240); i++) c.update(1 / 240, I(), 0); c.events.length = 0; }
let beat = 0;
/** step at hz for secs with fn(t) → Intent; each(c, t) after every step */
function run(c: Character, secs: number, fn: (t: number) => Partial<Intent>, hz = 240, each?: (c: Character, t: number) => void | boolean) {
  const dt = 1 / hz, n = Math.round(secs * hz);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    beat += (dt * BPM) / 60;
    c.update(dt, I(fn(t)), beat);
    if (each && each(c, t + dt) === true) return t + dt;
  }
  return secs;
}
const vs = (c: Character) => c.v[0] * c.plane!.right[0] + c.v[2] * c.plane!.right[2];
const f2 = (x: number) => x.toFixed(2), f3 = (x: number) => x.toFixed(3), ms = (x: number) => `${Math.round(x * 1000)} ms`;
const ROWS: [string, string, string][] = [];
const row = (what: string, got: string, aim: string) => { ROWS.push([what, got, aim]); return `${what}: ${got}`; };

// ---------------------------------------------------------------- the run
test('run: top speed in about 0.1 s, a stop in about 0.08 s, a reversal near-instant', () => {
  const c = make(FLAT);
  const top = run(c, 1, () => ({ moveX: 1 }), 240, (c) => vs(c) >= 0.99 * DUEL_PHYS.runSpeed);
  run(c, 0.5, () => ({ moveX: 1 }));
  const stop = run(c, 1, () => ({}), 240, (c) => Math.abs(vs(c)) < 0.05);
  run(c, 0.5, () => ({ moveX: 1 }));
  const turn = run(c, 1, () => ({ moveX: -1 }), 240, (c) => vs(c) < 0);
  const rev = turn + run(c, 1, () => ({ moveX: -1 }), 240, (c) => vs(c) <= -0.99 * DUEL_PHYS.runSpeed);
  // air control: from a standing jump, how long the stick takes to reach top speed in the air
  const a = make(FLAT);
  let air = 0;
  run(a, 0.02, (t) => ({ jump: t === 0, jumpHeld: true }));
  air = run(a, 1, () => ({ moveX: 1, jumpHeld: true }), 240, (c) => vs(c) >= 0.99 * DUEL_PHYS.runSpeed);
  assert(top >= 0.07 && top <= 0.13, 'top speed in ' + top);
  assert(stop >= 0.05 && stop <= 0.11, 'stop in ' + stop);
  assert(turn <= 0.06 && rev <= 0.16, 'reversal: turned in ' + turn + ', full speed back in ' + rev);
  assert(air > top && air < 0.3, 'air: top speed in ' + air);
  row('run: top speed', `${DUEL_PHYS.runSpeed} m/s`, '(fast; the jogo\'s 4)');
  row('run: rest to top speed', ms(top), 'about 100 ms');
  row('run: top speed to a stop', ms(stop), 'about 80 ms');
  row('run: reversal (moving the other way / at full speed)', `${ms(turn)} / ${ms(rev)}`, 'near-instant');
  row('air: rest to top speed (stick only)', ms(air), 'a little looser');
  return `top ${ms(top)}, stop ${ms(stop)}, reversal ${ms(turn)} (full ${ms(rev)}), air ${ms(air)}`;
});

// ---------------------------------------------------------------- the jump
function jumpArc(c: Character, held: (t: number) => boolean, extra: (t: number) => Partial<Intent> = () => ({})) {
  const y0 = c.y; let apex = 0, tApex = 0, land = 0, first = true;
  run(c, 3, (t) => {
    const o = { jump: first, jumpHeld: held(t), ...extra(t) }; first = false; return o;
  }, 240, (c, t) => {
    if (c.y - y0 > apex) { apex = c.y - y0; tApex = t; }
    if (t > 0.05 && c.grounded) { land = t; return true; }
  });
  return { apex, tApex, land };
}
test('jump: variable height (a tap is a short hop), heavier after the apex, one air jump', () => {
  const full = jumpArc(make(FLAT), () => true);
  const tap = jumpArc(make(FLAT), (t) => t < 1 / 60);       // held one 60 Hz frame
  const half = jumpArc(make(FLAT), (t) => t < 0.12);
  const fall = full.land - full.tApex;
  // the air jump at the apex
  const c = make(FLAT); let top = 0;
  const at = Math.round(full.tApex * 240) / 240;
  run(c, 2, (t) => ({ jump: t < 1e-9 || Math.abs(t - at) < 1e-9, jumpHeld: true }), 240, (c) => { top = Math.max(top, c.y); });
  assert(full.apex > 2.0 && full.apex < 2.45, 'full ' + full.apex);
  assert(full.tApex > 0.28 && full.tApex < 0.38, 'apex time ' + full.tApex);
  assert(fall < full.tApex, 'falls faster than it rises');
  assert(tap.apex < 0.45 * full.apex && tap.apex > 0.5, 'short hop ' + tap.apex);
  assert(half.apex > tap.apex && half.apex < full.apex, 'held longer, higher');
  assert(top > full.apex + 1.3, 'air jump ' + top);
  row('jump: full (held)', `${f2(full.apex)} m, apex at ${ms(full.tApex)}, down in ${ms(fall)}`, 'snappy, falls faster');
  row('jump: tap (one 60 Hz frame)', `${f2(tap.apex)} m in ${ms(tap.tApex)}`, 'a short hop');
  row('jump: held 0.12 s', `${f2(half.apex)} m`, 'between');
  row('jump: + air jump at the apex', `${f2(top)} m`, 'one air jump');
  return `full ${f2(full.apex)} m at ${ms(full.tApex)} (down ${ms(fall)}), tap ${f2(tap.apex)} m, 0.12 s ${f2(half.apex)} m, air jump to ${f2(top)} m`;
});

test('fast fall: down in the air falls faster and further than letting go', () => {
  const plain = jumpArc(make(FLAT), () => true);
  let vMin = 0;
  const c = make(FLAT);
  const ff = jumpArc(c, () => true, (t) => ({ moveY: t > 0.33 ? -1 : 0 }));
  const d = make(FLAT); run(d, 0.02, (t) => ({ jump: t === 0, jumpHeld: true })); run(d, 1, (t) => ({ moveY: t > 0.31 ? -1 : 0, jumpHeld: true }), 240, (c) => { vMin = Math.min(vMin, c.v[1]); if (c.grounded) return true; });
  assert(ff.land < plain.land - 0.07, 'fast fall lands sooner: ' + ff.land + ' vs ' + plain.land);
  assert(-vMin > DUEL_PHYS.maxFall, 'faster than the plain fall cap: ' + vMin);
  row('fast fall: apex to floor from 2.2 m', `${ms(ff.land - ff.tApex)} (plain ${ms(plain.land - plain.tApex)})`, 'down = fall fast');
  row('fast fall: top speed', `${f2(-vMin)} m/s (plain cap ${DUEL_PHYS.maxFall})`, '');
  return `apex to floor ${ms(ff.land - ff.tApex)} vs ${ms(plain.land - plain.tApex)}; ${f2(-vMin)} m/s`;
});

test('landing: no lag (the stick moves the body the frame it lands)', () => {
  const c = make(FLAT); let landT = -1, sAt = 0;
  run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true }));
  run(c, 2, () => ({ jumpHeld: true }), 240, (c, t) => { if (c.grounded) { landT = t; sAt = c.s; return true; } });
  run(c, 1 / 60, () => ({ moveX: 1 }), 240);
  assert(landT > 0 && c.s - sAt > 0.01, 'moved after landing: ' + (c.s - sAt));
  return `moved ${f3(c.s - sAt)} m in the frame after landing`;
});

// ---------------------------------------------------------------- walls
test('wall slide: pushing into a wall while falling slides down it at its capped speed', () => {
  const c = make(FLAT, 28);
  c.events.length = 0;
  // jump up against the plane's right end and push into it
  let vSlide = 0, n = 0, wallEv: CharEvent | undefined;
  run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(c, 2, () => ({ moveX: 1, jumpHeld: true }), 240, (c, t) => {
    wallEv ??= c.events.find((e) => e.type === 'wall');
    if (c.onWall && t > 0.6) { vSlide += c.v[1]; n++; }
    if (c.grounded) return true;
  });
  vSlide /= Math.max(1, n);
  assert(!!wallEv && wallEv.side === 1 && wallEv.wall === '_right', 'a wall event: ' + JSON.stringify(wallEv));
  near(-vSlide, DUEL_PHYS.wallSlideSpeed, 0.05, 'slide speed');
  // a fall from higher is braked to the cap; letting the stick go keeps the body there wallStick, then it falls
  const d = make(FLAT, 28);
  run(d, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(d, 0.5, () => ({ moveX: 1, jumpHeld: true }));
  assert(d.onWall, 'sliding');
  let off = 0;
  run(d, 0.5, () => ({}), 240, (c, t) => { if (!c.onWall) { off = t; return true; } });
  near(off, DUEL_PHYS.wallStick, 0.02, 'the stick let go: held');
  // down lets go at once
  const e = make(FLAT, 28);
  run(e, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(e, 0.5, () => ({ moveX: 1, jumpHeld: true }));
  run(e, 1 / 240, () => ({ moveX: 1, moveY: -1 }));
  assert(!e.onWall, 'down lets go');
  // rising fast against it: no slide yet
  const f = make(FLAT, 28); run(f, 0.05, (t) => ({ jump: t < 0.01, jumpHeld: true, moveX: 1 }));
  assert(!f.onWall && f.v[1] > 5, 'rising: not on the wall');
  row('wall slide: speed down the wall', `${f2(-vSlide)} m/s (free fall cap ${DUEL_PHYS.maxFall})`, 'slowly');
  row('wall slide: stick let go, held on', ms(off), 'jump-away is reliable');
  return `slides at ${f2(-vSlide)} m/s; held ${ms(off)} after the stick lets go`;
});

test('wall jump: up and away, refreshes the air jump and the dash, locks the stick out briefly', () => {
  const c = make(FLAT, 28);
  run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(c, 0.4, () => ({ moveX: 1, jumpHeld: true }));
  // spend the air jump and the dash first
  run(c, 1 / 240, () => ({ jump: true, jumpHeld: true, moveX: 1 }));
  assert(c.events.some((e) => e.type === 'wallJump'), 'a jump beside the wall kicks off it');
  const d = make(FLAT, 28);
  run(d, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(d, 0.12, () => ({ jumpHeld: true }));
  run(d, 1 / 240, () => ({ jump: true, jumpHeld: true }));                 // the air jump, away from the wall
  run(d, 1 / 240, () => ({ dash: true, moveX: 1, moveY: 1 }));             // the dash, back up at it
  run(d, 0.6, () => ({ moveX: 1, jumpHeld: true }), 240, (c) => c.onWall);
  assert(d.onWall, 'back on the wall');
  d.events.length = 0;
  const s0 = d.s, y0 = d.y;
  let peak = 0, sAtPeak = 0, tPeak = 0, s30 = 0, lockS = 0;
  // the stick held back toward the wall the whole time: the lockout keeps the kick going away
  run(d, 1, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }), 240, (c, t) => {
    if (c.y - y0 > peak) { peak = c.y - y0; sAtPeak = s0 - c.s; tPeak = t; }
    if (Math.abs(t - 0.3) < 1e-6) s30 = s0 - c.s;
    if (Math.abs(t - DUEL_PHYS.wallLock) < 2e-3) lockS = vs(c);
  });
  const wj = d.events.find((e) => e.type === 'wallJump');
  assert(!!wj && wj.dir === -1 && wj.wall === '_right', 'wallJump event ' + JSON.stringify(wj));
  assert(lockS < -DUEL_PHYS.wallJumpX * 0.95, 'held away through the lockout: ' + lockS);
  assert(peak > 1.4 && peak < 2.5, 'kick height ' + peak);
  // the refresh: after the kick, the air jump and the dash work again
  const e = make(FLAT, 28);
  run(e, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(e, 0.12, () => ({ jumpHeld: true }));
  run(e, 1 / 240, () => ({ jump: true, jumpHeld: true }));
  run(e, 1 / 240, () => ({ dash: true, moveX: 1, moveY: 1 }));
  assert(e.dashes === 0, 'dash spent');
  run(e, 0.6, () => ({ moveX: 1, jumpHeld: true }), 240, (c) => c.onWall);
  assert((e.dashes as number) === 1, 'the wall refreshed the dash');
  e.events.length = 0;
  run(e, 0.1, (t) => ({ jump: t === 0, jumpHeld: true }));
  run(e, 1 / 240, () => ({ jump: true, jumpHeld: true }));
  run(e, 1 / 240, () => ({ dash: true, moveX: -1 }));
  const types = e.events.map((q) => q.type + (q.air ? '(air)' : ''));
  assert(types.includes('wallJump') && types.includes('jump(air)') && types.includes('dash(air)'), 'refreshed: ' + types.join());
  row('wall jump: the kick', `+${f2(peak)} m at ${ms(tPeak)}, ${f2(sAtPeak)} m out by then; ${f2(s30)} m out at 0.3 s`, 'up and away');
  row('wall jump: stick held back at the wall', `still ${f2(-lockS)} m/s away after the ${ms(DUEL_PHYS.wallLock)} lockout`, 'no pull straight back');
  return `+${f2(peak)} m at ${ms(tPeak)}, ${f2(sAtPeak)} m out; refreshes: ${types.join(' ')}`;
});

/** climb a shaft `width` wide for 4 s: the stick toward the wall it's heading for, a jump the moment that wall is
 *  kickable (`touch`) or only once sliding down it; the rate from the first kick on */
function climb(width: number, touch: boolean) {
  const plane: StagePlane = { ...SHAFT, walls: [{ id: 'L', s: -width / 2, side: 1, y0: 0, y1: 40 }, { id: 'R', s: width / 2, side: -1, y0: 0, y1: 40 }] };
  const c = make(plane, 0);
  let target = 1, kicks = 0, t0 = -1, y0 = 0, pressed = false;
  run(c, 4, (t) => {
    const o: Partial<Intent> = { moveX: target, jumpHeld: true };
    if (t < 1e-9) o.jump = true;
    else if (!pressed && (touch ? c.wallKick === target : c.onWall && c.wallSide === target)) { o.jump = true; pressed = true; }
    return o;
  }, 240, (c, t) => {
    if (c.events.splice(0).some((e) => e.type === 'wallJump')) { kicks++; target = -target; pressed = false; if (t0 < 0) { t0 = t; y0 = c.y; } }
  });
  return { rate: (c.y - y0) / (4 - t0), kicks, y: c.y };
}
test('a two-wall shaft climbed by wall jumps', () => {
  const out: string[] = [];
  for (const w of [2.4, 3.6]) {
    const a = climb(w, true), b = climb(w, false);
    assert(a.kicks >= 6 && a.rate > 1.5, `${w} m: ${a.kicks} kicks, ${a.rate} m/s`);
    assert(b.rate > 0.5, `${w} m once sliding: ${b.rate} m/s`);
    row(`shaft ${w} m wide: kick on touch / once sliding`, `${f2(a.rate)} / ${f2(b.rate)} m/s up (${a.kicks} / ${b.kicks} kicks in 4 s)`, 'climbable by kicking');
    out.push(`${w} m: ${f2(a.rate)} m/s (${a.kicks} kicks), sliding first ${f2(b.rate)} m/s`);
  }
  return out.join('; ');
});

test('walls: one-sided faces in world y (a plane off the origin), the plane ends count as walls', () => {
  const P: StagePlane = { id: 'up', origin: [3, 2, -1], right: [0.6, 0, 0.8], halfWidth: 10, ground: 0, ledges: [], spawns: [[0, 0]],
    walls: [{ id: 'block.l', s: 2, side: -1, y0: 2, y1: 3 }, { id: 'high', s: -2, side: 1, y0: 3.6, y1: 9 }] };
  const c = make(P, 0);
  run(c, 1, () => ({ moveX: 1 }));
  near(c.s, 2 - DUEL_PHYS.halfW, 1e-6, 'stopped at the block (world y 2..3 = plane 0..1)');
  const d = make(P, 0);
  run(d, 1, () => ({ moveX: -1 }));
  assert(d.s < -3, 'walks under the high wall (world y 3.6..9 = plane 1.6..7, over a 1.55 m body): ' + d.s);
  const e = make(P, 2.5);
  run(e, 0.3, () => ({ moveX: -1 }));
  assert(e.s < 2, 'from behind a face, a body passes: ' + e.s);
  const f = make(P, 0);
  run(f, 3, () => ({ moveX: -1 }));
  near(f.s, -(P.halfWidth - DUEL_PHYS.wallMargin), 1e-6, 'the plane end');
  return `stops at ${f3(c.s)}, passes under the high wall to ${f2(d.s)}, end at ${f2(f.s)}`;
});

// ---------------------------------------------------------------- the dash
test('dash: 8-way, about 0.15 s and 3 m; one per airtime, refreshed on landing; i-frames first', () => {
  const c = make(FLAT, 0);
  c.events.length = 0;
  const s0 = c.s; let inv = 0, t1 = 0, endS = 0;
  run(c, 0.4, (t) => ({ dash: t === 0, moveX: 0 }), 240, (c, t) => {
    if (c.invulnerable) inv = t;
    if (c.dashing) t1 = t; else if (!endS && t > 0.01) endS = c.s;
  });
  const dist = endS - s0;
  const ev = c.events.find((e) => e.type === 'dash');
  assert(!!ev && (ev.dir as number[])[0] === 1 && !ev.air, 'dash event along the facing: ' + JSON.stringify(ev));
  assert(dist > 2.5 && dist < 3.5, 'dash distance ' + dist);
  near(t1, DUEL_PHYS.dashTime, 0.01, 'dash time');
  near(inv, DUEL_PHYS.dashIframes, 0.01, 'i-frames');
  // in the air: up-right is a diagonal; a second one waits for the landing
  const a = make(FLAT, 0); a.events.length = 0;
  run(a, 0.02, (t) => ({ jump: t === 0, jumpHeld: true }));
  const ay = a.y, as = a.s;
  run(a, DUEL_PHYS.dashTime + 1 / 240, (t) => ({ dash: t === 0, moveX: 1, moveY: 1, jumpHeld: true }));
  const diag = [a.s - as, a.y - ay];
  run(a, 0.3, (t) => ({ dash: t === 0.1, moveX: -1 }));
  const air = a.events.filter((e) => e.type === 'dash');
  assert(air.length === 1, 'one dash per airtime: ' + air.length);
  run(a, 2, () => ({}), 240, (c) => c.grounded);
  run(a, 0.3, (t) => ({ dash: t === 0.2 }));
  assert(a.events.filter((e) => e.type === 'dash').length === 2, 'refreshed on landing');
  // straight up
  const u = make(FLAT, 0); let up = 0;
  run(u, 1, (t) => ({ dash: t === 0, moveY: 1 }), 240, (c) => { up = Math.max(up, c.y); });
  row('dash: ground, along the facing', `${f2(dist)} m in ${ms(t1)}; ${ms(inv)} of i-frames`, 'about 0.15 s, a few metres');
  row('dash: air, up-right', `${f2(diag[0])} m along, ${f2(diag[1])} m up`, '8-way');
  row('dash: straight up from the floor', `${f2(up)} m`, '');
  return `ground ${f2(dist)} m in ${ms(t1)}, i-frames ${ms(inv)}; air diagonal (${f2(diag[0])}, ${f2(diag[1])}); up ${f2(up)} m`;
});

test('dash-jump: a jump out of a dash keeps its speed (a long jump)', () => {
  const span = (dashFirst: boolean) => {
    const c = make(FLAT, 0); const s0 = c.s;
    run(c, 0.5, () => ({ moveX: 1 }));
    const sA = c.s;
    if (dashFirst) run(c, 0.06, (t) => ({ dash: t === 0, moveX: 1 }));
    const sJ = c.s;
    run(c, 3, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }), 240, (c, t) => t > 0.05 && c.grounded);
    void s0; void sA;
    return c.s - sJ;
  };
  const plain = span(false), dj = span(true);
  assert(dj > plain * 1.5, 'dash-jump ' + dj + ' vs ' + plain);
  row('dash-jump: a running full jump spans', `${f2(dj)} m (a plain running jump ${f2(plain)} m)`, 'keeps the dash\'s speed');
  return `${f2(dj)} m vs ${f2(plain)} m`;
});

test('dash: into a wall stops it; on a wall it refreshes; a dash down lands and ends', () => {
  const c = make(FLAT, 27);
  run(c, 0.3, (t) => ({ dash: t === 0, moveX: 1 }));
  near(c.s, FLAT.halfWidth - DUEL_PHYS.wallMargin, 1e-6, 'at the end');
  assert(!c.dashing, 'ended at the wall');
  const d = make(FLAT, 0); d.events.length = 0;
  run(d, 0.02, (t) => ({ jump: t === 0, jumpHeld: true }));
  run(d, 0.3, () => ({ jumpHeld: true }));
  run(d, 1, (t) => ({ dash: t === 0, moveX: 1, moveY: -1 }), 240, (c) => c.grounded);
  assert(d.grounded && !d.dashing, 'a down dash lands and ends');
  return `dash into a wall: stopped at ${f2(c.s)}`;
});

// ---------------------------------------------------------------- latency and determinism
test('input to motion: the same frame (0 frames) for run, jump and dash', () => {
  const lat = (it: Partial<Intent>, moved: (c: Character, s0: number, y0: number) => number) => {
    const c = make(FLAT, 0); const s0 = c.s, y0 = c.y;
    for (let f = 0; f < 10; f++) {
      c.update(1 / 60, I(f === 0 ? it : { moveX: it.moveX, jumpHeld: it.jumpHeld }), 0);
      const d = moved(c, s0, y0);
      if (d > 1e-3) return { frames: f, d };
    }
    return { frames: Infinity, d: 0 };
  };
  const r = lat({ moveX: 1 }, (c, s0) => c.s - s0);
  const j = lat({ jump: true, jumpHeld: true }, (c, _s, y0) => c.y - y0);
  const d = lat({ dash: true }, (c, s0) => c.s - s0);
  assert(r.frames === 0 && j.frames === 0 && d.frames === 0, `latency run ${r.frames} jump ${j.frames} dash ${d.frames}`);
  row('input to motion (60 Hz)', `0 frames: in the press's own frame the run moves ${Math.round(r.d * 1000)} mm, the jump ${Math.round(j.d * 1000)} mm, the dash ${Math.round(d.d * 1000)} mm`, 'nothing sticky');
  return `0 frames; first frame: run ${f3(r.d)} m, jump ${f3(j.d)} m, dash ${f3(d.d)} m`;
});

test('the kit is frame-rate independent: a wall climb and dashes at 30, 60 and 144 Hz', () => {
  const ends: number[][] = [];
  for (const hz of [30, 60, 144]) {
    const c = make(SHAFT, 0);
    const dt = 1 / hz;
    const press = new Set<string>();
    const once = (k: string, t: number, at: number) => { if (t >= at && !press.has(k)) { press.add(k); return true; } return false; };
    for (let i = 0; i < Math.round(2.5 * hz); i++) {
      const t = i * dt;
      c.update(dt, I({ moveX: t < 0.9 ? 1 : t < 1.4 ? -1 : 1, jump: once('j0', t, 0) || once('j1', t, 0.6) || once('j2', t, 1.2), jumpHeld: true, dash: once('d', t, 1.8) }), 0);
    }
    ends.push([c.s, c.y]);
  }
  const d = Math.max(Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]), Math.hypot(ends[2][0] - ends[1][0], ends[2][1] - ends[1][1]));
  assert(d < 0.08, 'end positions differ by ' + d + ' ' + JSON.stringify(ends));
  return `ends within ${f3(d)} m: ${ends.map((e) => `(${f2(e[0])}, ${f2(e[1])})`).join(' ')}`;
});

test('the jogo\'s body has none of the kit (PHYS untouched); the duel profile is a separate object', () => {
  assert(!PHYS.dash && !PHYS.wallSlide && PHYS.runSpeed === 4 && PHYS.gravity === 22.7, 'PHYS as before');
  assert(DUEL_PHYS !== PHYS && DUEL_PHYS.dash && DUEL_PHYS.wallSlide, 'the duel profile');
  const c = new Character({ plane: FLAT }); c.reset(28, 0); settle(c);
  run(c, 0.3, (t) => ({ dash: t === 0, moveX: 1 }));
  assert(!c.events.some((e) => e.type === 'dash'), 'no dash in the jogo');
  run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(c, 1, () => ({ moveX: 1, jumpHeld: true }), 240, (c) => { assert(!c.onWall, 'no slide in the jogo'); });
  const k = new Character({ plane: FLAT, phys: 'duel' });
  assert(k.phys === DUEL_PHYS, 'phys: "duel"');
  k.setProfile('jogo'); assert(k.phys === PHYS, 'setProfile');
});

test('the poses: the wall lean and the dash lunge show on the body', () => {
  const c = make(FLAT, 28);
  run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
  run(c, 0.6, () => ({ moveX: 1, jumpHeld: true }));
  assert(c.onWall && c.wallW > 0.9, 'leaning: ' + c.wallW);
  for (const v of c.pose) assert(Number.isFinite(v), 'NaN');
  // a hand reaches the wall (right end, +s): the nearest wrist is within 10 cm of the face
  const p = c.pose2D(), face = FLAT.halfWidth - DUEL_PHYS.wallMargin + DUEL_PHYS.halfW;
  const wrist = Math.max(p[2 * 5], p[2 * 6]);
  assert(Math.abs(face - wrist) < 0.12, `a hand on the wall: wrist ${wrist}, face ${face}`);
  const d = make(FLAT, 0);
  run(d, 0.08, (t) => ({ dash: t === 0 }));
  assert(d.dashing && d.dashW > 0.9, 'lunging: ' + d.dashW);
  const q = d.pose2D(), head = q[1], hipY = (q[2 * 7 + 1] + q[2 * 8 + 1]) / 2;
  assert(head - hipY < 0.6, 'low: the head ' + (head - hipY) + ' m over the hips');
  return `wrist ${f3(face - wrist)} m off the wall face; lunge: head ${f2(head - hipY)} m over the hips (standing ~0.75)`;
});

// ---------------------------------------------------------------- free 3D: the world's solids are the walls
const TEMPLE = solidsOf(layoutTemple({ coarse: false }).stones);
/** a free body on flat ground among `solids`, at (x, z) facing yaw; the stick is world-aligned (inputYaw 0: moveX +x,
 *  moveZ -z) */
const free = (solids: Solid[], x: number, z: number, yaw = 0) => {
  const c = new Character({ plane: null, terrain: { groundAt: () => 0, solids }, phys: DUEL_PHYS });
  c.reset(x, 0, z); c.yaw = yaw; settle(c); return c;
};
const stick = (dx: number, dz: number) => ({ moveX: dx, moveZ: -dz });
const hsp = (c: Character) => Math.hypot(c.v[0], c.v[2]);

test('free 3D: a wall jump off a temple column (World.solids), up and out along its normal', () => {
  // the tall column in the temple's back row (x 0.58, z -9.76, 0.6 m round, to 6 m): from 3.5 m east, run at it, jump
  const cx = 0.58, cz = -9.76;
  const c = free(TEMPLE, cx + 3.5, cz, -Math.PI / 2);
  let wallEv: CharEvent | undefined, slideV = 0, n = 0;
  run(c, 1.6, (t) => ({ ...stick(-1, 0), jump: t > 0.2 && t < 0.21, jumpHeld: true }), 240, (c, t) => {
    wallEv ??= c.events.find((e) => e.type === 'wall');
    if (c.onWall && t > 1.0) { slideV += c.v[1]; n++; }
    if (c.grounded && t > 0.4) return true;
  });
  assert(!!wallEv, 'met the column as a wall');
  const wn = wallEv!.n as number[];
  assert(wn[0] > 0.95, 'its normal faces east: ' + JSON.stringify(wn));
  // kick off it, from mid-slide
  const d = free(TEMPLE, cx + 3.5, cz, -Math.PI / 2);
  run(d, 0.6, (t) => ({ ...stick(-1, 0), jump: t > 0.2 && t < 0.21, jumpHeld: true }), 240, (c) => c.onWall && c.v[1] < 0);
  assert(d.onWall, 'sliding on the column');
  d.events.length = 0;
  const x0 = d.x, y0 = d.y; let peak = 0, out = 0, tPeak = 0;
  run(d, 1.2, (t) => ({ jump: t === 0, jumpHeld: true, ...stick(-1, 0) }), 240, (c, t) => { if (c.y - y0 > peak) { peak = c.y - y0; out = c.x - x0; tPeak = t; } });
  const wj = d.events.find((e) => e.type === 'wallJump');
  assert(!!wj && (wj.n as number[])[0] > 0.95 && String(wj.wall).startsWith('solid.'), 'wallJump off the column ' + JSON.stringify(wj));
  assert(peak > 1.2 && out > 1.0, `kick: +${peak} m, ${out} m out`);
  void slideV; void n;
  row('free 3D: wall jump off a temple column (r 0.6 m)', `met at its face (normal ${wn.map((v) => v.toFixed(2)).join(', ')}); kick +${f2(peak)} m at ${ms(tPeak)}, ${f2(out)} m out by then (stick held back at it)`, 'walls are the world\'s solids');
  return `normal (${wn.map((v) => v.toFixed(2)).join(', ')}), kick +${f2(peak)} m, ${f2(out)} m out`;
});

/** kick up between two solids: the stick toward the one it's heading for, a jump the moment a wall is kickable whose
 *  normal faces back the way it came; height after `secs` and the rate from the first kick */
function climb3d(solids: Solid[], x: number, z: number, ax: number, az: number, secs: number, ceiling = Infinity) {
  const c = free(solids, x, z);
  let tg = 1, kicks = 0, t0 = -1, y0 = 0, pressed = false, top = 0, tTop = -1;
  run(c, secs, (t) => {
    const o: Partial<Intent> = { ...stick(ax * tg, az * tg), jumpHeld: true };
    if (t < 1e-9) o.jump = true;
    const wn = c.wallNormal;
    if (!pressed && c.wallKick && wn && (wn[0] * ax + wn[1] * az) * tg < -0.5) { o.jump = true; pressed = true; }
    return o;
  }, 240, (c, t) => {
    if (c.events.splice(0).some((e) => e.type === 'wallJump')) { kicks++; tg = -tg; pressed = false; if (t0 < 0) { t0 = t; y0 = c.y; } }
    if (c.y > top) top = c.y;
    if (tTop < 0 && c.y + DUEL_PHYS.bodyH >= ceiling - 0.02) tTop = t;
  });
  return { rate: (c.y - y0) / (secs - t0), kicks, top, tTop, y: c.y };
}
test('free 3D: a climb between two close solids (two columns 1.8 m apart; the temple\'s stage pillars to the lintel)', () => {
  const two: Solid[] = [cylinder([-1.4, 0, 0], [-1.4, 40, 0], 0.5), cylinder([1.4, 0, 0], [1.4, 40, 0], 0.5)];
  const a = climb3d(two, 0, 0, 1, 0, 4);
  assert(a.kicks >= 6 && a.rate > 1.5, `columns: ${a.kicks} kicks, ${a.rate} m/s`);
  // the temple's stage: two pillars (x 0.9 and 3.3, z -4.15) under a lintel from 2.6 m: kick up between them to it
  const b = climb3d(TEMPLE, 2.1, -4.15, 1, 0, 2, 2.6);
  assert(b.kicks >= 1 && b.tTop > 0, `temple pillars: ${b.kicks} kicks, head at the lintel at ${b.tTop}`);
  assert(b.top + DUEL_PHYS.bodyH <= 2.6 + 0.03, 'the lintel stops the head: ' + (b.top + DUEL_PHYS.bodyH));
  row('free 3D: climb between two columns 1.8 m apart', `${f2(a.rate)} m/s up (${a.kicks} kicks in 4 s, ${f2(a.y)} m)`, 'climbable by kicking');
  row('free 3D: the temple\'s stage pillars (1.7 m apart)', `head at the lintel (2.6 m) in ${ms(b.tTop)}, ${b.kicks} kick(s); the lintel stops it`, '');
  return `columns ${f2(a.rate)} m/s (${a.kicks} kicks); temple pillars: the lintel in ${ms(b.tTop)}`;
});

test('free 3D: a wall run along a face met fast, then the slide; a kick out of it keeps the run\'s speed along the face', () => {
  // a wall 12 m long along x at z = -1 (its face toward +z), 5 m high
  const wall: Solid[] = [box([0, 2.5, -1.5], [6, 2.5, 0.5])];
  const c = free(wall, -5, 0.2, Math.PI / 2);
  let ev: CharEvent | undefined, peakY = 0, t0 = 0, t1 = 0, x0 = 0, x1 = 0;
  run(c, 0.3, () => stick(1, 0));
  run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, ...stick(1, -0.6) }));
  run(c, 1.2, () => ({ jumpHeld: true, ...stick(1, -0.6) }), 240, (c, t) => {
    if (!ev && (ev = c.events.find((e) => e.type === 'wall'))) { t0 = t; x0 = c.x; }
    if (c.wallRunT > 0) { t1 = t; x1 = c.x; }
    if (ev) peakY = Math.max(peakY, c.y);
  });
  assert(!!ev && ev.run === true, 'a wall run: ' + JSON.stringify(ev));
  const runFor = t1 - t0, along = x1 - x0;
  // a kick out of a run along the face
  const d = free(wall, -5, 0.2, Math.PI / 2);
  run(d, 0.3, () => stick(1, 0));
  run(d, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, ...stick(1, -0.6) }));
  run(d, 0.6, () => ({ jumpHeld: true, ...stick(1, -0.6) }), 240, (c) => c.onWall);
  run(d, 0.1, () => ({ jumpHeld: true, ...stick(1, -0.6) }));
  run(d, 1 / 240, () => ({ jump: true, jumpHeld: true, ...stick(1, -0.6) }));
  assert(d.v[2] > DUEL_PHYS.wallJumpX * 0.9 && d.v[0] > 2, `kicked out (+z) still running along (+x): ${d.v.map((v) => v.toFixed(2))}`);
  row('free 3D: wall run along a flat face', `${ms(runFor)} running, ${f2(along)} m along it, peak ${f2(peakY)} m`, 'a short wall run');
  row('free 3D: kick out of the run', `${f2(d.v[2])} m/s out, ${f2(d.v[0])} m/s still along the face, ${f2(d.v[1])} up`, '');
  return `ran ${ms(runFor)}, ${f2(along)} m along; kick (${d.v.map((v) => v.toFixed(1)).join(', ')})`;
});

test('free 3D: the dash along the camera-relative stick, up with jump held, down with the stick down', () => {
  const c = free([], 0, 0);
  const x0 = c.x, z0 = c.z;
  run(c, DUEL_PHYS.dashTime + 1 / 240, (t) => ({ dash: t === 0, ...stick(Math.SQRT1_2, Math.SQRT1_2) }));
  const ev = c.events.find((e) => e.type === 'dash')!;
  const dx = c.x - x0, dz = c.z - z0;
  assert(Math.abs(Math.atan2(dz, dx) - Math.PI / 4) < 0.05 && Math.hypot(dx, dz) > 2.5, `along the stick: (${dx}, ${dz})`);
  const u = free([], 0, 0);
  run(u, 0.02, (t) => ({ jump: t === 0, jumpHeld: true }));
  const y0 = u.y, ux0 = u.x;
  run(u, DUEL_PHYS.dashTime + 1 / 240, (t) => ({ dash: t === 0, jumpHeld: true, ...stick(1, 0) }));
  const up = [u.x - ux0, u.y - y0];
  assert(up[0] > 1.5 && up[1] > 1.5, 'up and along: ' + up);
  // camera-relative: the camera turned a quarter (inputYaw), the same stick goes another way
  const r = free([], 0, 0); r.inputYaw = Math.PI / 2;
  run(r, DUEL_PHYS.dashTime + 1 / 240, (t) => ({ dash: t === 0, moveX: 1 }));
  assert(Math.abs(r.x) < 0.05 && Math.abs(r.z) > 2.5, `camera-relative: (${r.x}, ${r.z})`);
  row('free 3D: dash along the stick (45°)', `${f2(Math.hypot(dx, dz))} m, dir (${(ev.dir as number[]).map((v) => v.toFixed(2)).join(', ')})`, 'camera-relative');
  row('free 3D: dash with jump held', `${f2(up[0])} m along, ${f2(up[1])} m up`, 'up by jump');
  return `flat ${f2(Math.hypot(dx, dz))} m; up-diagonal (${f2(up[0])}, ${f2(up[1])})`;
});

test('flow: run → jump → air kick → dash → land → kick on the run, with no stop in between', () => {
  const c = free([], 0, 0, Math.PI / 2);
  run(c, 0.4, () => stick(1, 0));
  const sp0 = hsp(c);
  run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, ...stick(1, 0) }));
  run(c, 0.12, () => ({ jumpHeld: true, ...stick(1, 0) }));
  const before = hsp(c);
  run(c, 1 / 240, () => ({ kick: true, jumpHeld: true, ...stick(1, 0) }));
  assert(c.move?.name === 'martelo', 'an air kick: ' + c.move?.name);
  run(c, 0.05, () => ({ jumpHeld: true, ...stick(1, 0) }));
  const during = hsp(c);
  // the dash cuts the kick once its active window opens (the kick is thrown)
  let cut = -1;
  run(c, 0.5, () => ({ dash: true, ...stick(1, 0) }), 240, (c, t) => { if (c.dashing) { cut = t; return true; } });
  assert(cut > 0 && cut < 0.4, 'dash cut the kick at ' + cut);
  run(c, 2, () => stick(1, 0), 240, (c) => c.grounded);
  const land = hsp(c);
  // a kick started at a run slides on with the run (slideK 3): how far it carries in its first 0.2 s
  const s0 = c.x;
  run(c, 1 / 240, () => ({ kick: true, ...stick(1, 0) }));
  run(c, 0.2, () => stick(1, 0));
  const carried = c.x - s0;
  const types = c.events.map((e) => e.type).filter((t) => t !== 'step');
  assert(during > before * 0.95, `the air kick keeps the momentum: ${before} → ${during}`);
  assert(carried > 0.4, 'the ground kick carries the run: ' + carried);
  row('flow: speed into a jump → air kick', `${f2(sp0)} → ${f2(before)} → ${f2(during)} m/s (kept)`, 'aerials keep momentum');
  row('flow: a dash cuts the air kick', `${ms(cut)} after asking (as its active window opens)`, 'moves cancel into each other');
  row('flow: a kick on the run slides on', `${f2(carried)} m in its first 0.2 s (landed at ${f2(land)} m/s)`, 'no stop-start');
  return `${types.join(' → ')}`;
});

test('flow: kick or spin on a wall kicks off it into a martelo or an aú', () => {
  for (const [b, move] of [['kick', 'martelo'], ['spin', 'au']] as const) {
    const c = make(FLAT, 28);
    run(c, 0.02, (t) => ({ jump: t === 0, jumpHeld: true, moveX: 1 }));
    run(c, 0.6, () => ({ moveX: 1, jumpHeld: true }), 240, (c) => c.onWall);
    assert(c.onWall, 'on the wall');
    c.events.length = 0;
    run(c, 1 / 240, () => ({ [b]: true, moveX: 1 }));
    const types = c.events.map((e) => e.type + (e.type === 'move' ? `:${e.move}` : ''));
    assert(types[0] === 'wallJump' && types[1] === `move:${move}` && c.v[1] > 5 && vs(c) < -5, `${b}: ${types.join()} v ${c.v.map((v) => v.toFixed(1))}`);
  }
  return 'wallJump → martelo; wallJump → au';
});

test('the feel table', () => {
  console.log('\n| what | measured | the brief |\n|---|---|---|');
  for (const [a, b, c] of ROWS) console.log(`| ${a} | ${b} | ${c} |`);
  console.log('');
});

done();

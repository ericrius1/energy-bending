// Which one is me (you.ts, report 18-you), checked without a GPU: whose seats are the page's own in each mode; the tell
// is drawn on those seats only, in their colour; the opening comes as a set begins and goes; the first press answers
// once a set; the camera favours the one player's body; the tell fades in the finale duet.
import { test, assert, done } from '../dancer/test/check';
import { YouTell, ownSeats, deviceLabel, YOU, type YouCtx } from './you';
import { Glows, GLOW_FLOATS } from '../play/glow';
import { SEAT_RGB } from './seat';

type V3 = [number, number, number];
const make = (o: Partial<YouCtx> = {}, seats: number[] = [0]) => {
  const G = new Glows(), press = [false, false], away = [0, 0];
  const ctx: YouCtx = {
    glows: G, head: (k) => [k ? 1 : -1, 1.75, 0] as V3, root: (k) => [k ? 1 : -1, 0, 0] as V3, ground: () => 0, eye: () => [0, 1.5, 9],
    pressed: (k) => press[k], away: (k) => away[k], device: (k) => (k ? 'keyboard-right' : 'keyboard-left'), ...o,
  };
  return { G, press, away, T: new YouTell(ctx, () => seats) };
};
/** the glows' colours this frame: how many in each seat's colour */
const bySeat = (G: Glows) => {
  const n = [0, 0];
  for (let i = 0; i < G.count; i++) { const r = G.data[i * GLOW_FLOATS + 8]; for (let k = 0; k < 2; k++) if (Math.abs(r - SEAT_RGB[k][0]) < 1e-4) n[k]++; }
  return n;
};

test('the page\'s own seats in each mode', () => {
  assert(ownSeats({ online: false, netSeat: null, human: [0], bot: () => false, film: false }).join() === '0', 'solo: seat 1');
  assert(ownSeats({ online: false, netSeat: null, human: [0, 1], bot: () => false, film: false }).join() === '0,1', 'two at one screen: both');
  assert(ownSeats({ online: false, netSeat: null, human: [0, 1], bot: (k) => k === 1, film: false }).join() === '0', 'a seat given to a partner is not yours');
  assert(ownSeats({ online: true, netSeat: 1, human: [0, 1], bot: () => false, film: false }).join() === '1', 'online: this page\'s seat');
  assert(ownSeats({ online: true, netSeat: null, human: [0, 1], bot: () => false, film: false }).length === 0, 'a watcher has none');
  assert(ownSeats({ online: false, netSeat: null, human: [0], bot: () => false, film: true }).length === 0, 'a film has none');
  assert(deviceLabel('keyboard-left') === 'W A S D' && deviceLabel('keyboard-right') === 'ARROWS' && deviceLabel('gamepad-0') === 'PAD', 'the devices named');
});

test('the tell is on your body only, in your colour, all through play', () => {
  for (const seat of [0, 1]) {
    const { G, T } = make({}, [seat]);
    T.set();
    for (let i = 0; i < 400; i++) { G.clear(); T.update(1 / 60); }
    const n = bySeat(G);
    assert(n[seat] >= 3 && n[1 - seat] === 0, `seat ${seat + 1}: ${n.join(' / ')} glows`);
    assert(T.intro() === 0, 'the opening is over');
    assert(T.hud(seat)?.label === 'YOU' && T.hud(1 - seat) === undefined, 'the HUD says YOU on yours only');
  }
  const two = make({}, [0, 1]);
  two.T.set(); two.T.update(1 / 60);
  assert(two.T.hud(0)?.label === 'P1' && two.T.hud(0)?.sub === 'W A S D' && two.T.hud(1)?.sub === 'ARROWS', 'two at one screen: each seat by its device');
  assert(two.T.favour() === null, 'two at one screen: the camera stays as it was');
});

test('the opening comes as a set begins, and is shorter on later sets', () => {
  const { G, T } = make();
  T.set();
  let peak = 0, t = 0, end = 0;
  for (let i = 0; i < 600; i++) { G.clear(); T.update(1 / 60); t += 1 / 60; const v = T.intro(); peak = Math.max(peak, v); if (v > 0) end = t; }
  assert(peak > 0.99, `the opening reaches ${peak.toFixed(2)}`);
  assert(Math.abs(end - YOU.intro) < 0.05, `it ends at ${end.toFixed(2)} s`);
  T.set(); t = 0; end = 0;
  for (let i = 0; i < 600; i++) { T.update(1 / 60); t += 1 / 60; if (T.intro() > 0) end = t; }
  assert(Math.abs(end - YOU.introLater) < 0.05, `a later set's ends at ${end.toFixed(2)} s`);
  T.set();
  for (let i = 0; i < 30; i++) T.update(1 / 60);
  const f = T.favour();
  assert(!!f && f.seat === 0 && f.turn > 0.15, 'the camera favours you in the opening');
});

test('your first press is answered once a set', () => {
  const { G, T, press } = make();
  T.set();
  for (let i = 0; i < 20; i++) T.update(1 / 60);
  assert(T.pulse(0) === 0, 'nothing before a press');
  press[0] = true; G.clear(); T.update(1 / 60);
  const many = G.count;
  assert(T.pulse(0) > 0.95, 'the answer begins');
  press[0] = false;
  for (let i = 0; i < 70; i++) T.update(1 / 60);
  assert(T.pulse(0) === 0, 'and ends');
  press[0] = true; T.update(1 / 60);
  assert(T.pulse(0) === 0, 'once a set');
  T.set(); T.update(1 / 60);
  assert(T.pulse(0) > 0.95, 'again on the next set');
  return `${many} glows on the answer's frame`;
});

test('the tell fades in the finale duet, and can be hidden', () => {
  const { G, T, away } = make();
  for (let i = 0; i < 60; i++) T.update(1 / 60);
  away[0] = 1;
  for (let i = 0; i < 60; i++) { G.clear(); T.update(1 / 60); }
  assert(G.count === 0, `${G.count} glows while away (the finale's duet)`);
  away[0] = 0; T.show = false;
  for (let i = 0; i < 60; i++) { G.clear(); T.update(1 / 60); }
  assert(G.count === 0 && T.hud(0) === undefined, 'hidden');
});

test('the marker keeps its size on screen', () => {
  const near = make({ eye: () => [-1, 1.7, 6] }), far = make({ eye: () => [-1, 1.7, 14] });
  for (const m of [near, far]) for (let i = 0; i < 60; i++) { m.G.clear(); m.T.update(1 / 60); }
  // (the petal is the first glow: its length over its distance)
  const len = (G: Glows) => G.data[5] - G.data[1];
  const a = len(near.G) / 6, b = len(far.G) / 14;
  assert(Math.abs(a - b) / a < 0.2, `angular sizes ${a.toFixed(4)} and ${b.toFixed(4)}`);
});

done();

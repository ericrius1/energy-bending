// Who each body is, worn in its matter (seats.ts, report 18-bodies), checked without a GPU: a tint keeps only its hue,
// the two seats come apart as two colours with a side each for fire's one channel, and a tint nobody sets goes back to
// none after a few frames (the duel stopped).
import { test, assert, done } from '../../dancer/test/check';
import { setSeatTint, seatTints, tickSeatTints, seatPair } from './seats';
import { SEAT_RGB } from '../../duel/seat';

test('a tint keeps its hue (brightest channel 1) and its strength, clamped', () => {
  setSeatTint(2, SEAT_RGB[0], 1.4);
  const T = seatTints();
  assert(Math.abs(Math.max(T[8], T[9], T[10]) - 1) < 1e-6, 'brightest channel 1');
  assert(Math.abs(T[8] / T[9] - SEAT_RGB[0][0] / SEAT_RGB[0][1]) < 1e-4, 'the hue kept');
  assert(T[11] === 1, 'strength clamped to 1');
});

test('two seats: two colours, a side each (+ the first, − the other), nothing for the rest', () => {
  setSeatTint(0, SEAT_RGB[0], 0.8);
  setSeatTint(1, SEAT_RGB[1], 0.5);
  setSeatTint(2, [0, 0, 0], 0);
  const p = seatPair();
  assert(Math.abs(p.side[0] - 0.8) < 1e-6 && Math.abs(p.side[1] + 0.5) < 1e-6, `sides ${p.side.slice(0, 2)}`);
  assert(p.side.slice(2).every((s) => s === 0), 'no side for an untinted slot');
  assert(p.a[0] > p.a[1] && p.b[1] > p.b[0], 'a is rose, b is fern');
});

test('a tint nobody sets goes back to none', () => {
  setSeatTint(0, SEAT_RGB[0], 1);
  for (let i = 0; i < 3; i++) tickSeatTints();
  assert(seatTints()[3] > 0, 'still worn three frames on');
  for (let i = 0; i < 3; i++) tickSeatTints();
  assert(seatTints().every((v) => v === 0), 'gone once nobody sets it');
});

done();

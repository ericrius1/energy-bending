// Who is who (seat.ts, shared/powers.ts formLook; report 13 issue 5), checked without a GPU: each seat's colour stands
// apart from every matter's and from the other seat's; a power form never turns a body into its partner's matter; the
// contact's ring is drawn in two halves, each on its own dancer's side, in its own colour; the halo follows the bones.
import { test, assert, done } from '../dancer/test/check';
import { SEAT_CSS, SEAT_RGB, seatHalo, splitRing } from './seat';
import { MATTER_CSS } from './hud-state';
import { FORM_TOWARD, POWERS, formLook, type Matter } from '../../shared/powers.ts';
import { Glows, GLOW_FLOATS } from '../play/glow';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';

type V3 = [number, number, number];
const hueOf = (css: string) => {
  const n = parseInt(css.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return { h: 0, s: 0 };
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / mx };
};
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test('each seat\'s colour stands apart from every matter\'s, and from the other seat\'s', () => {
  const seats = SEAT_CSS.map(hueOf);
  assert(hueGap(seats[0].h, seats[1].h) >= 120, `the seats are ${hueGap(seats[0].h, seats[1].h).toFixed(0)}° apart`);
  let least = 360, which = '';
  for (const [m, css] of Object.entries(MATTER_CSS)) {
    const M = hueOf(css);
    if (M.s < 0.2) continue;   // (steam is white: any hue stands apart from it)
    for (let k = 0; k < 2; k++) { const g = hueGap(seats[k].h, M.h); if (g < least) { least = g; which = `seat ${k + 1} and ${m}`; } }
  }
  assert(least >= 35, `${which} are only ${least.toFixed(0)}° apart`);
  for (const c of SEAT_RGB) assert(Math.max(...c) > 1.2, 'a seat\'s light is bright enough to read through the glow');
  return `seats ${seats.map((s) => s.h.toFixed(0)).join('° and ')}°; the nearest matter ${least.toFixed(0)}° away (${which})`;
});

test('a power form never takes the partner\'s matter', () => {
  const all = Object.keys(POWERS) as Matter[];
  const lines: string[] = [];
  for (const m of all) for (const p of all) {
    const L = formLook(m, p), to = FORM_TOWARD[m];
    if (to && to === p) { assert(L.depth <= 0.3, `${m} beside ${p} still turns ${L.depth} toward ${to}`); lines.push(`${m} beside ${p}: ${L.name}`); }
    else assert(L.depth === 1 && L.name === POWERS[m].form, `${m} beside ${p} changed (${L.name}, ${L.depth})`);
  }
  assert(formLook('water', 'ice').name !== 'ice' && formLook('fire', 'plasma').name !== 'plasma', 'the forms beside their own matter are named for themselves');
  return lines.join('; ');
});

test('the contact\'s ring: two halves, each on its own dancer\'s side, in its own colour', () => {
  const G = new Glows();
  const p: V3 = [0, 1.2, 0], eye: V3 = [0, 2, 6], pa: V3 = [-0.5, 1.2, 0], pb: V3 = [0.6, 1.3, 0.2];
  splitRing(G, p, 0.3, 0.02, eye, pa, pb, 0, 1, 1);
  assert(G.count === 20, `${G.count} segments`);
  let wrong = 0;
  for (let i = 0; i < G.count; i++) {
    const o = i * GLOW_FLOATS, D = G.data, mid: V3 = [(D[o] + D[o + 4]) / 2 - p[0], (D[o + 1] + D[o + 5]) / 2 - p[1], (D[o + 2] + D[o + 6]) / 2 - p[2]];
    const seat = Math.abs(D[o + 8] - SEAT_RGB[0][0]) < 1e-4 ? 0 : 1, side = mid[0] * (pa[0] - pb[0]) + mid[1] * (pa[1] - pb[1]) + mid[2] * (pa[2] - pb[2]);
    if ((seat === 0) !== (side > 0)) wrong++;
    // (on the ring, facing the eye)
    const r = Math.hypot(...mid);
    assert(Math.abs(r - 0.3) < 0.03, `a segment ${r.toFixed(3)} m from the middle`);
  }
  assert(wrong === 0, `${wrong} segments on the other dancer's side`);
  return `${G.count} segments, ${G.count / 2} a side`;
});

test('the halo follows the bones, brighter in the power form', () => {
  const W = new Float32Array(40 * JOINT_FLOATS);
  for (let j = 0; j < 38; j++) { W[j * JOINT_FLOATS] = 0.1 * (j % 5); W[j * JOINT_FLOATS + 1] = 0.05 * j; W[j * JOINT_FLOATS + 2] = 0; }
  const a = new Glows(), b = new Glows();
  seatHalo(a, W, 1, 1, 0, 'gems');
  seatHalo(b, W, 1, 1, 1, 'gems');
  assert(a.count === 11 && b.count === 11, `${a.count} glows`);
  assert(b.data[7] > a.data[7] * 1.5, 'the form\'s halo is brighter');
  assert(Math.abs(a.data[8] - SEAT_RGB[1][0]) < 1e-4, 'in the seat\'s colour');
  const h = JOINT.Hips * JOINT_FLOATS;
  assert(Math.abs(a.data[0] - W[h]) < 1e-6 && Math.abs(a.data[1] - W[h + 1]) < 1e-6, 'the first runs from the hips');
  const none = new Glows();
  seatHalo(none, W, 0, 0, 0, 'fire');
  assert(none.count === 0, 'gone while it reforms');
});

done();

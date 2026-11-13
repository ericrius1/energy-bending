// skeleton.js — shared joint layout and the "body made of fire" emitter.
// Stage space: x centred on the stage, y = 0 at the floor, 1 unit ~ a little more than body height.
import { FLOOR, MATTER, PLASMA_CH } from './fire.js';

export const J = { HEAD: 0, LS: 1, RS: 2, LE: 3, RE: 4, LW: 5, RW: 6, LH: 7, RH: 8, LK: 9, RK: 10, LA: 11, RA: 12 };
export const NJ = 13;

// Flame hue per ghost layer (the player burns classic fire).
export const HUES = [0.57, 0.38, 0.84];
export const GHOST_PALETTES = [2, 5, 3];
export const TUNE = { heat: 6.2, water: 3.2, ice: 2.6, plasma: 7.0 };
export const ELEMENTS = ['Fire', 'Water', 'Fire + Water', 'Ice', 'Plasma'];

const SC = 13, HC = 14; // virtual joints: shoulder centre, hip centre
// [a, b, radius, heat]
const BONES = [
  [SC, HC, 0.03, 0.85],
  [J.LS, J.RS, 0.021, 0.8],
  [J.LH, J.RH, 0.024, 0.8],
  [J.LS, J.LE, 0.017, 0.85], [J.LE, J.LW, 0.015, 0.95],
  [J.RS, J.RE, 0.017, 0.85], [J.RE, J.RW, 0.015, 0.95],
  [J.LH, J.LK, 0.021, 0.8], [J.LK, J.LA, 0.017, 0.8],
  [J.RH, J.RK, 0.021, 0.8], [J.RK, J.RA, 0.017, 0.8],
  [SC, J.HEAD, 0.014, 0.7],
  [J.HEAD, J.HEAD, 0.036, 1.05],
  [J.LA, J.LA, 0.017, 0.7], [J.RA, J.RA, 0.017, 0.7],
];
// which side of the body each bone belongs to: -1 left, 0 centre, 1 right
const SIDE = [0, 0, 0, -1, -1, 1, 1, -1, -1, 1, 1, 0, 0, -1, 1];

const px = new Float32Array(15), py = new Float32Array(15), vx = new Float32Array(15), vy = new Float32Array(15);

// Emits one dancer into the fire sim.
// o: { k, ox, emission, hue (null = classic fire), embers, seed, z, element }
//   element: 0 fire, 1 water, 2 fire + water, 3 ice, 4 plasma (hue is ignored for 4).
//   Water (1) also follows fire.look.ice and fire (0) follows fire.look.plasma, so a form change can
//   be a smooth morph with the element left alone; 3 and 4 are always ice and plasma.
export function emitDancer(fire, pose, vel, o) {
  const k = o.k, ox = o.ox || 0, E = o.emission;
  for (let j = 0; j < NJ; j++) {
    px[j] = (pose[j * 2] + ox) * k; py[j] = FLOOR + pose[j * 2 + 1] * k;
    vx[j] = vel[j * 2] * k; vy[j] = vel[j * 2 + 1] * k;
  }
  const mid = (d, a, b) => {
    px[d] = (px[a] + px[b]) / 2; py[d] = (py[a] + py[b]) / 2; vx[d] = (vx[a] + vx[b]) / 2; vy[d] = (vy[a] + vy[b]) / 2;
  };
  mid(SC, J.LS, J.RS); mid(HC, J.LH, J.RH);
  // element: 0 fire, 1 water, 2 both (left side water, right side fire, the core both), 3 ice, 4 plasma
  const el = o.element || 0;
  const ice = el === 3, plasma = el === 4;
  let cx = 0, cy = 0;
  if (plasma) { cx = PLASMA_CH[0]; cy = PLASMA_CH[1]; }
  else if (o.hue != null) { const a = o.hue * Math.PI * 2; cx = Math.cos(a); cy = Math.sin(a); }
  // water morphing to ice (look.ice) moves toward the ice amount: ice lingers where water falls away
  const li = el === 1 || el === 2 ? Math.max(0, Math.min(1, fire.look?.ice || 0)) : ice ? 1 : 0;
  const heat = (plasma ? TUNE.plasma : TUNE.heat) * E, wet = (TUNE.water * (1 - li) + TUNE.ice * li) * (0.55 + 0.45 * E);
  const wm = ice ? MATTER.ice : true;          // what the "water" side is made of
  const rf = plasma ? 0.8 : 1, rw = ice ? 1.05 : 1.1;
  const isFire = el === 0 || plasma, isWater = el === 1 || ice;
  for (let i = 0; i < BONES.length; i++) {
    const [a, b, r, h] = BONES[i];
    const sp = Math.min(4, (Math.hypot(vx[a], vy[a]) + Math.hypot(vx[b], vy[b])) * 0.5);
    const side = SIDE[i];
    const fireK = isFire ? 1 : isWater ? 0 : side > 0 ? 1 : side < 0 ? 0 : 0.6;
    const waterK = isWater ? 1 : isFire ? 0 : side < 0 ? 1 : side > 0 ? 0 : 0.55;
    if (fireK) fire.seg(px[a], py[a], px[b], py[b], vx[a], vy[a], vx[b], vy[b], r * k * rf, heat * h * fireK * (1 + 0.14 * sp), cx, cy, i * 0.37 + (o.seed || 0));
    if (waterK) fire.seg(px[a], py[a], px[b], py[b], vx[a], vy[a], vx[b], vy[b], r * k * rw, wet * h * waterK * (1 + (ice ? 0.12 : 0.25) * sp), 0, 0, i * 0.37 + (o.seed || 0), wm);
  }
  // hands: hotter (or wetter), trailing, shedding sparks, spray or ice dust
  for (const j of [J.LW, J.RW]) {
    const sp = Math.min(5, Math.hypot(vx[j], vy[j]));
    const water = isWater || (el === 2 && j === J.LW);
    if (water) fire.seg(px[j], py[j], px[j], py[j], vx[j], vy[j], vx[j], vy[j], 0.022 * k, wet * (0.8 + (ice ? 0.35 : 0.6) * sp), 0, 0, j, wm);
    else fire.seg(px[j], py[j], px[j], py[j], vx[j], vy[j], vx[j], vy[j], 0.02 * k * rf, heat * (0.9 + 0.42 * sp), cx, cy, j + (o.seed || 0));
    if (o.embers) fire.ember(px[j], py[j], 0.02 * k, (30 + 520 * sp) * o.embers * (water ? 0.8 : 1), water ? wm : plasma ? MATTER.plasma : false);
  }
  if (o.embers > 0.5) {
    const m = isWater ? wm : plasma ? MATTER.plasma : false;
    fire.ember(px[J.HEAD], py[J.HEAD], 0.03 * k, 40 * o.embers * E * (ice ? 2 : 1), m);
    fire.ember(px[HC], (py[HC] + py[SC]) / 2, 0.06 * k, 60 * o.embers * E * (ice ? 2 : 1), m);
  }
  // where the body is, for the fusion looks
  if (fire.noteBody) fire.noteBody((px[SC] + px[HC]) / 2, (py[SC] + py[HC]) / 2, Math.max(0.05, Math.hypot(px[J.HEAD] - px[HC], py[J.HEAD] - py[HC])), el);
  // feet stir the pool (ice barely: it frosts it instead, by itself)
  for (const j of [J.LA, J.RA]) {
    if (py[j] - FLOOR < 0.035 * k) {
      const sp = Math.min(3, Math.hypot(vx[j], vy[j]));
      if (sp > 0.08) fire.ripple(px[j], o.z ?? 0.93, 0.03 * k, 0.02 * sp * (ice ? 0.3 : 1));
    }
  }
}

// Two-bone IK. Returns [jointX, jointY, endX, endY]; over-reach stretches the limb (it is fire, after all).
export function ik2(sx, sy, tx, ty, a, b, bend, maxStretch = 2.0) {
  let dx = tx - sx, dy = ty - sy;
  let d = Math.hypot(dx, dy);
  const reach = a + b;
  if (d > reach * maxStretch) { const s = reach * maxStretch / d; dx *= s; dy *= s; d = reach * maxStretch; tx = sx + dx; ty = sy + dy; }
  if (d >= reach * 0.999) {
    const f = a / reach;
    return [sx + dx * f, sy + dy * f, tx, ty];
  }
  const dd = Math.max(d, Math.abs(a - b) + 1e-3);
  const cosA = Math.max(-1, Math.min(1, (a * a + dd * dd - b * b) / (2 * a * dd)));
  const ang = Math.atan2(dy, dx) + bend * Math.acos(cosA);
  return [sx + a * Math.cos(ang), sy + a * Math.sin(ang), tx, ty];
}

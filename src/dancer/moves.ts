// The move library: capoeira as procedural, parametric 3D poses on the 13 landmarks (skeleton/landmarks.ts), ported
// from the 2D prototype (sketches/dance-first-2d/js/moves.js). Pure: no DOM, no GPU (it runs in Node for the tests).
//
// Units and frame. A pose is 39 floats (13 landmarks, order LM) in the dancer's own frame, in METRES: x across the
// body with the dancer's own left at +x, y up from the ground under the hips, z forward. The keyframes below are
// still written in the prototype's figure units (a standing hip at 0.3, head top at 0.69) and in its mirrored frame
// (its L joints at -x): the body rig (`rig`) solves each pose there, with this repo's CMU bone lengths in figure units
// (BONE), then writes it out mirrored (x negated) and scaled by FU metres per figure unit. One conversion in one
// place, instead of a few hundred hand-converted literals; FU is the CMU rig's leg over the prototype's (0.827 / 0.36),
// so a pose's limbs are exactly as long as the rig's and the retargeter (skeleton/retarget.ts) lands every joint where
// the landmarks put it. Ankles sit ANKLE_H above a floor the keyframes call y = 0 (the rig's ankle is above its sole).
//
// API
//   MOVES[name]  MoveDef { name, dur, windup, active, recover, attack, hit, travel, iframes, cancelInto, airOk, evade,
//                aimW, usesHand, hold, loop, style?, pose(u, ctx, out39) }
//     dur      seconds at 112 bpm (times tempoScale(bpm)); active, iframes: windows in progress u (0..1)
//     hit      { a, b, r, stream? }: the hit capsule from landmark a to b, radius r (m); 'HAND'/'ELBOW' mean the
//              striking hand's. stream { len, speed } (m, m/s): the bending throw's stream grows from b along the aim
//     travel   { z, y, u0, u1 }: root motion (m) along the facing and up, eased over u0..u1
//     style    (u, ctx) → MoveStyle: hints for what 13 points can't say (fists, open hands, pointed or flexed feet)
//   asMove(def) normalises a definition; it also takes SAMPLED moves (motion capture, a clip):
//              { name, dur, sample(u, out39), …optional fields } → a full definition whose pose() calls sample().
//   registerMove(def) adds one to MOVES. travelAt(def, u) → [dz, dy] (m). tempoScale(bpm). gingaSteps(b0, b1).
//   LOCO.ginga/run/rise/fall/land/crouch/stagger/reform(out, …): locomotion poses (39 floats, metres).
//   rig(params, out): the body rig every procedural pose is built with (params in figure units, prototype frame).
import { LM } from '../skeleton/landmarks';
import type { HandStyle, FootStyle } from '../skeleton/retarget';

export const J = LM;
export const NJ = 13;
export const NP = 39;
export const BPM_REF = 112;
/** metres per prototype figure unit: the CMU rig's leg (thigh + shin, 0.8267 m) over the prototype's (0.36) */
export const FU = 0.8267 / 0.36;
/** how high the rig's ankle stands above the floor its sole is on (m) */
export const ANKLE_H = 0.075;
/** and the wrist above a palm on the floor (m) */
export const WRIST_H = 0.035;
/** the CMU rig's lengths (public/motion/*.json, skeleton 0; checked by the tests) in figure units */
export const BONE = {
  UA: 0.2833 / FU, FA: 0.1968 / FU, TH: 0.4127 / FU, SH: 0.4140 / FU,
  /** hip joints' middle to shoulder joints' middle, and the head's middle above the shoulders' */
  TORSO: 0.3732 / FU, NECK: 0.200 / FU,
  /** half the shoulder joints' width, half the hip joints' */
  SHW: 0.2224 / FU, HPW: 0.0830 / FU,
};
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
type V = number[];
const mix3 = (a: V, b: V, t: number): V => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const tempoScale = (bpm: number) => BPM_REF / clamp(bpm || BPM_REF, 80, 140);

// ---------------------------------------------------------------- vector helpers (prototype frame)
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ry = (v: V, t: number): V => { const c = Math.cos(t), s = Math.sin(t); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const inFrame = (o: V, l: V, u: V, f: V, b: V): V => [o[0] + l[0] * b[0] + u[0] * b[1] + f[0] * b[2], o[1] + l[1] * b[0] + u[1] * b[1] + f[1] * b[2], o[2] + l[2] * b[0] + u[2] * b[1] + f[2] * b[2]];

/** two-bone IK in 3D with a pole direction → [joint xyz, end xyz] */
function ik3(s: V, t: V, a: number, b: number, pole: V, maxStretch: number): V {
  let d = sub(t, s), dist = len(d);
  const reach = a + b;
  if (dist > reach * maxStretch) { d = mul(d, (reach * maxStretch) / dist); dist = reach * maxStretch; t = add(s, d); }
  if (dist < 1e-6) return [s[0], s[1] - a, s[2], t[0], t[1], t[2]];
  const n = mul(d, 1 / dist);
  if (dist >= reach * 0.999) { const j = add(s, mul(n, a)); return [j[0], j[1], j[2], t[0], t[1], t[2]]; }
  let q = sub(pole, mul(n, dot(pole, n)));
  if (len(q) < 1e-6) q = Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]);
  q = norm(q);
  const dd = Math.max(dist, Math.abs(a - b) + 1e-3);
  const cosA = clamp((a * a + dd * dd - b * b) / (2 * a * dd), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const j = add(s, add(mul(n, a * cosA), mul(q, a * sinA)));
  return [j[0], j[1], j[2], t[0], t[1], t[2]];
}

// ---------------------------------------------------------------- the rig
/** a pose's parameters, in figure units and the prototype's frame (its L at -x). All optional except hip:
 *   hip [x,y,z]   the hips' middle.   yaw, pitch, roll: body turn about y (+ turns the R side back), forward lean
 *                 (+ tips the shoulders forward), side lean (+ toward the R side).   twist: shoulders' yaw against
 *                 the hips.   tilt: pelvis roll.   crunch: torso length.   head [x,y,z]: head offset.
 *   lh, rh        hand targets; or lhS/rhS from that shoulder (local axes); or lhB/rhB from the shoulder in the
 *                 shoulders' own frame [lateral, up, forward].
 *   lf, rf        foot targets (y = 0: on the floor); or lfB/rfB from the hip joint in the hips' frame.
 *   lkp, rkp, lep, rep  knee / elbow poles in the hips' / shoulders' frame [lateral, up, forward].
 *   rotX, rotZ, pivot   whole-body rotation about the x axis (+ tips the top toward +z) and the z axis, about pivot. */
export interface RigParams {
  hip: V; yaw?: number; pitch?: number; roll?: number; twist?: number; tilt?: number; crunch?: number; head?: V;
  lh?: V; rh?: V; lhS?: V; rhS?: V; lhB?: V; rhB?: V; lf?: V; rf?: V; lfB?: V; rfB?: V;
  lkp?: V; rkp?: V; lep?: V; rep?: V; rotX?: number; rotZ?: number; pivot?: V;
  [k: string]: unknown;
}

const _proto = new Float32Array(NP);
const ANK = ANKLE_H / FU;

/** solve a pose in the prototype's frame and figure units, then write it out in this repo's (mirrored, metres) */
export function rig(P: RigParams, out: Float32Array = new Float32Array(NP)) {
  const o = _proto;
  const hip: V = P.hip.length === 3 ? P.hip : [P.hip[0], P.hip[1], 0];
  const yaw = P.yaw || 0, pitch = P.pitch || 0, roll = P.roll || 0, tw = P.twist || 0, tilt = P.tilt || 0;
  const cp = Math.cos(pitch);
  const up = ry([Math.sin(roll) * cp, Math.cos(roll) * cp, Math.sin(pitch)], yaw);
  const latH = ry([Math.cos(tilt + roll * 0.4), Math.sin(tilt + roll * 0.4), 0], yaw);
  const fwdH = ry([0, 0, 1], yaw);
  let latS = ry([1, 0, 0], yaw + tw); latS = norm(sub(latS, mul(up, dot(latS, up))));
  const fwdS = cross(latS, up);
  const sc = add(hip, mul(up, BONE.TORSO * (P.crunch ?? 1)));
  const set = (j: number, v: V) => { o[3 * j] = v[0]; o[3 * j + 1] = v[1]; o[3 * j + 2] = v[2]; };
  const LH = sub(hip, mul(latH, BONE.HPW)), RH = add(hip, mul(latH, BONE.HPW));
  const LS = sub(sc, mul(latS, BONE.SHW)), RS = add(sc, mul(latS, BONE.SHW));
  set(J.LH, LH); set(J.RH, RH); set(J.LS, LS); set(J.RS, RS);
  const hd = P.head || [0, 0, 0];
  set(J.HEAD, add(add(sc, mul(up, BONE.NECK)), add(mul(fwdS, 0.012), hd)));
  for (let i = 0; i < 2; i++) {
    const sd = i ? 1 : -1, S = i ? RS : LS;
    let t: V;
    const abs = i ? P.rh : P.lh, rel = i ? P.rhS : P.lhS, bod = i ? P.rhB : P.lhB;
    if (bod) t = inFrame(S, latS, up, fwdS, bod);
    else if (rel) t = add(S, rel);
    else if (abs) t = abs;
    else t = inFrame(S, latS, up, fwdS, [sd * 0.05, -0.2, 0.02]);
    const pb = (i ? P.rep : P.lep) || [sd * 0.5, -0.6, -0.45];
    const pole = inFrame([0, 0, 0], latS, up, fwdS, pb);
    const k = ik3(S, t, BONE.UA, BONE.FA, pole, 1.04);
    set(i ? J.RE : J.LE, k.slice(0, 3)); set(i ? J.RW : J.LW, k.slice(3));
  }
  for (let i = 0; i < 2; i++) {
    const sd = i ? 1 : -1, H = i ? RH : LH;
    let f: V;
    const abs = i ? P.rf : P.lf, bod = i ? P.rfB : P.lfB;
    if (bod) f = inFrame(H, latH, [0, 1, 0], fwdH, bod);
    else f = abs || [sd * 0.1, 0, 0];
    // the keyframes' floor is the sole's: the ankle stands above it
    f = [f[0], f[1] + ANK, f[2]];
    const pb = (i ? P.rkp : P.lkp) || [sd * 0.3, 0, 1];
    const pole = inFrame([0, 0, 0], latH, [0, 1, 0], fwdH, pb);
    const k = ik3(H, f, BONE.TH, BONE.SH, pole, 1.06);
    set(i ? J.RK : J.LK, k.slice(0, 3)); set(i ? J.RA : J.LA, k.slice(3));
  }
  if (P.rotZ || P.rotX) {
    const pv = P.pivot || hip, cz = Math.cos(P.rotZ || 0), sz = Math.sin(P.rotZ || 0), cx = Math.cos(P.rotX || 0), sx = Math.sin(P.rotX || 0);
    for (let j = 0; j < NJ; j++) {
      let x = o[3 * j] - pv[0], y = o[3 * j + 1] - pv[1], z = o[3 * j + 2] - pv[2];
      const x1 = x * cz - y * sz, y1 = x * sz + y * cz; x = x1; y = y1;
      const y2 = y * cx - z * sx, z2 = y * sx + z * cx; y = y2; z = z2;
      o[3 * j] = pv[0] + x; o[3 * j + 1] = pv[1] + y; o[3 * j + 2] = pv[2] + z;
    }
  }
  // out: mirrored (the dancer's own left at +x) and in metres
  for (let j = 0; j < NJ; j++) { out[3 * j] = -o[3 * j] * FU; out[3 * j + 1] = o[3 * j + 1] * FU; out[3 * j + 2] = o[3 * j + 2] * FU; }
  return out;
}

export function lerpPose(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, w: number) { for (let i = 0; i < NP; i++) out[i] = a[i] + (b[i] - a[i]) * w; return out; }
/** a pose turned about y (yaw: forward becomes (sin yaw, 0, cos yaw)) */
export function rotY(out: Float32Array, pose: ArrayLike<number>, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let j = 0; j < NJ; j++) { const x = pose[3 * j], z = pose[3 * j + 2]; out[3 * j] = x * c + z * s; out[3 * j + 1] = pose[3 * j + 1]; out[3 * j + 2] = -x * s + z * c; }
  return out;
}
/** what touches the floor first, allowing for how high each joint stands above it (an ankle above its sole) */
function lowest(out: Float32Array, joints: number[]) {
  let m = Infinity;
  for (const j of joints) m = Math.min(m, out[3 * j + 1] - (j === J.LA || j === J.RA ? ANKLE_H : j === J.LW || j === J.RW ? WRIST_H : 0));
  return m;
}
function shiftPose(out: Float32Array, dx: number, dy: number, dz: number) { for (let j = 0; j < NJ; j++) { out[3 * j] += dx; out[3 * j + 1] += dy; out[3 * j + 2] += dz; } }

// ---------------------------------------------------------------- keyframe tracks
type Key = [number, Record<string, unknown>];
/** keys: [[u, {param: number | [x,y,z]}], ...]. Missing params carry forward (and back to the start). Cubic Hermite
 *  with Catmull-Rom tangents, zeroed at holds and turning points (no overshoot). */
function track(keys: Key[]) {
  const names = new Set<string>();
  for (const k of keys) for (const n of Object.keys(k[1])) names.add(n);
  let prev: Record<string, unknown> = {};
  for (const k of keys) { for (const n of names) if (!(n in k[1]) && n in prev) k[1][n] = prev[n]; prev = k[1]; }
  for (let i = keys.length - 2; i >= 0; i--) for (const n of names) if (!(n in keys[i][1])) keys[i][1][n] = keys[i + 1][1][n];
  const T = keys.map((k) => k[0]), N = keys.length, list = [...names];
  const tan = (i: number, n: string, c: number) => {
    if (i <= 0 || i >= N - 1) return 0;
    const g = (j: number) => { const v = keys[j][1][n]; return c < 0 ? (v as number) : (v as V)[c]; };
    const a = g(i - 1), b = g(i), d = g(i + 1);
    if ((b - a) * (d - b) <= 0) return 0;
    return (d - a) / (T[i + 1] - T[i - 1]);
  };
  return (u: number): RigParams => {
    u = clamp(u, T[0], T[N - 1]);
    let i = 0; while (i < N - 2 && u > T[i + 1]) i++;
    const t0 = T[i], h = T[i + 1] - t0, s = h > 0 ? (u - t0) / h : 0;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const o: Record<string, number | V> = {};
    for (const n of list) {
      const a = keys[i][1][n] as number | V, b = keys[i + 1][1][n] as number | V;
      if (typeof a === 'number') o[n] = h00 * a + h10 * h * tan(i, n, -1) + h01 * (b as number) + h11 * h * tan(i + 1, n, -1);
      else { const v: V = []; for (let c = 0; c < a.length; c++) v[c] = h00 * a[c] + h10 * h * tan(i, n, c) + h01 * (b as V)[c] + h11 * h * tan(i + 1, n, c); o[n] = v; }
    }
    return o as RigParams;
  };
}

// The neutral stance (ginga's "paralela"): facing +z, feet apart, knees soft, hands up in front.
const BASE: RigParams = {
  hip: [0, 0.3, 0], yaw: 0, pitch: 0.12, roll: 0, twist: 0, tilt: 0, crunch: 1, head: [0, 0, 0],
  lh: [-0.12, 0.42, 0.12], rh: [0.12, 0.44, 0.15], lf: [-0.13, 0, 0], rf: [0.13, 0, 0],
};
const base = (o: Partial<RigParams> = {}): RigParams => Object.assign({}, BASE, o) as RigParams;
function airLegs(P: RigParams, k = 1) {
  P.hip = [P.hip[0], mix(P.hip[1], 0.33, k), P.hip[2] || 0];
  P.lf = mix3(P.lf || [-0.1, 0, 0], [-0.08, 0.08, 0.04], k);
  P.rf = mix3(P.rf || [0.1, 0, 0], [0.07, 0.13, 0.1], k);
  delete P.lfB; delete P.rfB;
  return P;
}

// ---------------------------------------------------------------- locomotion
const BACK_AT = [[1, 0], [0, 0], [0, 1], [0, 0]];   // foot stepped back at beats 0,1,2,3 (L, R)
function gingaParams(beat: number, groove = 1) {
  const b = ((beat % 4) + 4) % 4, seg = Math.floor(b) % 4, f = b - Math.floor(b);
  const c = BACK_AT[seg], n = BACK_AT[(seg + 1) % 4];
  // during beat seg → seg+1 the feet travel from state c to n, lifting at 0.35 and landing on the next beat
  const p = clamp((f - 0.35) / 0.65, 0, 1), q = smooth(p), lift = Math.sin(Math.PI * p);
  const Lb = mix(c[0], n[0], q), Rb = mix(c[1], n[1], q);
  const Lmov = c[0] !== n[0] ? 1 : 0, Rmov = c[1] !== n[1] ? 1 : 0;
  const s = Rb - Lb, back = Math.max(Lb, Rb), g = groove;
  const bounce = Math.pow(0.5 + 0.5 * Math.cos(TAU * f), 2);   // lowest on the beat, as the foot lands
  const breathe = Math.sin((TAU * b) / 4);
  const P = base({
    hip: [0.012 * s * g, 0.3 - 0.05 * back * g - 0.016 * bounce * g, -0.045 * back * g],
    pitch: 0.1 + 0.22 * back * g, yaw: 0.4 * s * g, twist: 0.15 * s * g, roll: -0.04 * s * g,
    lf: [-0.13 - 0.02 * Lb, 0.045 * lift * Lmov * g, -0.22 * Lb * g],
    rf: [0.13 + 0.02 * Rb, 0.045 * lift * Rmov * g, -0.22 * Rb * g],
  });
  const gL = Math.max(0, -s) * g, gR = Math.max(0, s) * g;
  // the arm on the side of the stepped-back leg comes across the face; the other drops low and out
  P.lh = mix3(mix3([-0.12, 0.42, 0.12], [0.04, 0.58, 0.15], gL), [-0.22, 0.3, 0.08], gR);
  P.rh = mix3(mix3([0.12, 0.44, 0.15], [-0.04, 0.6, 0.16], gR), [0.22, 0.3, 0.08], gL);
  P.lh[1] += 0.012 * breathe; P.rh[1] -= 0.012 * breathe;
  return P;
}
/** the ginga's foot plants crossed in (beat0, beat1] */
export function gingaSteps(beat0: number, beat1: number) {
  const out: { foot: 'L' | 'R'; beat: number }[] = [];
  if (!(beat1 > beat0) || beat1 - beat0 > 8) return out;
  for (let n = Math.floor(beat0) + 1; n <= beat1; n++) {
    const prev = BACK_AT[(((n - 1) % 4) + 4) % 4], cur = BACK_AT[((n % 4) + 4) % 4];
    if (prev[0] !== cur[0]) out.push({ foot: 'L', beat: n });
    if (prev[1] !== cur[1]) out.push({ foot: 'R', beat: n });
  }
  return out;
}

export const LOCO = {
  ginga(out: Float32Array, beat: number, groove = 1) { return rig(gingaParams(beat, groove), out); },

  /** a run at `phase` (radians of stride), k 0..1 how much of a run */
  run(out: Float32Array, phase: number, k: number) {
    k = clamp(k, 0, 1);
    const P = base({ hip: [0, 0.31 - 0.015 * k + 0.018 * k * Math.cos(2 * phase), 0.02 * k], pitch: 0.12 + 0.2 * k, twist: 0.25 * k * Math.sin(phase) });
    for (let i = 0; i < 2; i++) {
      const ph = phase + i * Math.PI, sd = i ? 1 : -1;
      const z = 0.2 * k * Math.sin(ph) + 0.03 * k;
      const y = 0.11 * k * Math.max(0, Math.cos(ph)) * (0.55 + 0.45 * Math.max(0, Math.sin(ph) + 0.3));
      const foot = [sd * mix(0.13, 0.06, k), y, z];
      if (i) P.rf = foot; else P.lf = foot;
      const hand = [sd * 0.05, mix(-0.12, -0.13, k), mix(0.12, -0.13 * Math.sin(ph) + 0.05, k)];
      if (i) { P.rhS = hand; delete P.rh; } else { P.lhS = hand; delete P.lh; }
    }
    P.lep = [-0.3, -0.4, -1]; P.rep = [0.3, -0.4, -1];
    return rig(P, out);
  },
  rise(out: Float32Array, k = 1) {
    return rig(base({ hip: [0, mix(0.32, 0.36, k), 0], pitch: mix(0.12, 0.0, k),
      lf: [-0.08, mix(0, 0.12, k), mix(0, 0.06, k)], rf: [0.08, mix(0, 0.16, k), mix(0, 0.1, k)],
      lh: [mix(-0.12, -0.2, k), mix(0.42, 0.8, k), 0.05], rh: [mix(0.12, 0.2, k), mix(0.44, 0.82, k), 0.06] }), out);
  },
  fall(out: Float32Array, k = 1) {
    return rig(base({ hip: [0, mix(0.34, 0.37, k), 0], pitch: 0.06,
      lf: [-0.1, mix(0.1, 0.02, k), 0.0], rf: [0.1, mix(0.14, 0.04, k), 0.05],
      lh: [mix(-0.2, -0.32, k), mix(0.7, 0.55, k), 0.02], rh: [mix(0.2, 0.32, k), mix(0.72, 0.56, k), 0.02] }), out);
  },
  land(out: Float32Array, k = 1) {
    return rig(base({ hip: [0, mix(0.3, 0.2, k), -0.02 * k], pitch: mix(0.12, 0.4, k), lf: [-0.15, 0, 0], rf: [0.15, 0, 0.02],
      lh: [mix(-0.12, -0.28, k), mix(0.42, 0.28, k), 0.1], rh: [mix(0.12, 0.28, k), mix(0.44, 0.3, k), 0.12] }), out);
  },
  /** cocorinha: the low squat on the balls of the feet, knees open, one forearm guarding the head */
  crouch(out: Float32Array, beat = 0) {
    const br = 0.006 * Math.sin((TAU * beat) / 2);
    return rig(base({ hip: [0, 0.16 + br, -0.03], pitch: 0.42, crunch: 0.95, lf: [-0.14, 0.02, -0.02], rf: [0.14, 0.02, 0.03],
      lkp: [-0.8, 0.2, 0.7], rkp: [0.8, 0.2, 0.7], rh: [0.03, 0.46 + br, 0.17], lh: [-0.1, 0.1, 0.17] }), out);
  },
  stagger(out: Float32Array, u: number) {
    const k = 1 - smooth((u - 0.45) / 0.55), w = Math.sin(u * 14) * 0.03 * k;
    return rig(base({ hip: [0, mix(0.3, 0.32, k), -0.05 * k], pitch: mix(0.12, -0.5, k) + w, twist: 0.3 * k, roll: 0.1 * k,
      head: [0, 0, -0.02 * k], lh: [mix(-0.12, -0.1, k), mix(0.42, 0.74, k), mix(0.12, 0.2, k)], rh: [mix(0.12, 0.2, k), mix(0.44, 0.7, k), mix(0.15, 0.24, k)],
      lf: [-0.14, 0, mix(0, -0.06, k)], rf: [0.14, mix(0, 0.09, k), mix(0, 0.14, k)] }), out);
  },
  reform(out: Float32Array, u: number) {
    const a = smooth(u / 0.75), open = Math.sin(Math.PI * clamp((u - 0.35) / 0.65, 0, 1));
    rig(base({ hip: [0, mix(0.1, 0.3, a), 0], pitch: mix(1.0, 0.12, a), crunch: mix(0.6, 1, a),
      lf: [mix(-0.04, -0.13, a), 0, 0], rf: [mix(0.04, 0.13, a), 0, 0],
      lh: [mix(-0.02, -0.12, a) - 0.24 * open, mix(0.1, 0.42, a) + 0.25 * open, 0.12], rh: [mix(0.02, 0.12, a) + 0.24 * open, mix(0.12, 0.44, a) + 0.25 * open, 0.12] }), out);
    const s = mix(0.35, 1, smooth(u / 0.5));
    for (let i = 0; i < NP; i++) out[i] *= s;
    return out;
  },

  /** kinetic surfing & carving glide: leaned into turns, knees athletic, arms open for balance; slideK opens into a sideways carve */
  surf(out: Float32Array, phase: number, speedK: number, bank = 0, slideK = 0) {
    const k = clamp(speedK, 0, 1.3), bk = clamp(bank, -1, 1), sl = clamp(slideK, 0, 1);
    const sway = Math.sin(phase * 0.85) * 0.018 * k;
    const bounce = Math.cos(phase * 1.7) * 0.014 * k;
    // sideways surf stance when carving or sliding; forward athletic lean when surging
    const yaw = sl * (bk < 0 ? -0.92 : 0.92) + bk * 0.28;
    const roll = bk * 0.42 - sl * (bk < 0 ? -0.18 : 0.18);
    const pitch = 0.2 + 0.18 * k - 0.12 * sl;
    const hipY = 0.265 - 0.035 * Math.abs(bk) - 0.055 * sl + bounce;
    const stride = (1 - sl * 0.65) * 0.14 * Math.sin(phase) * Math.min(k, 1);
    const liftL = (1 - sl * 0.85) * 0.065 * Math.max(0, Math.cos(phase)) * Math.min(k, 1);
    const liftR = (1 - sl * 0.85) * 0.065 * Math.max(0, -Math.cos(phase)) * Math.min(k, 1);
    const P = base({
      hip: [bk * 0.045, hipY, 0.03 * k],
      yaw, pitch, roll, twist: -bk * 0.32 - sl * 0.35, crunch: 0.95 - 0.05 * sl,
      lf: [-0.14 - 0.04 * sl, liftL, -0.09 + stride - 0.07 * sl],
      rf: [0.14 + 0.04 * sl, liftR, 0.11 - stride + 0.09 * sl],
    });
    // arms wide like an expressive surfer/skater carving through energy
    P.lhB = [-0.26 - 0.06 * sl, -0.04 + 0.1 * bk + sway, 0.04 + 0.08 * sl];
    P.rhB = [0.26 + 0.06 * sl, -0.02 - 0.1 * bk - sway, 0.08 - 0.06 * sl];
    delete P.lh; delete P.rh;
    return rig(P, out);
  },

  /** hold-to-charge coil: drops low into a loaded athletic crouch while drawing energy into the chest */
  charge(out: Float32Array, charge: number, beat = 0) {
    const c = clamp(charge, 0, 1);
    const vib = c > 0.65 ? Math.sin(beat * TAU * 8) * 0.008 * (c - 0.65) : 0;
    const P = base({
      hip: [vib, mix(0.27, 0.17, c), -0.03 * c],
      pitch: mix(0.2, 0.48, c), crunch: mix(0.96, 0.86, c),
      lf: [-0.16 - 0.03 * c, 0, -0.09], rf: [0.16 + 0.03 * c, 0, 0.1],
      lkp: [-0.55, 0.2, 0.9], rkp: [0.55, 0.2, 0.9],
    });
    // hands pull inward toward a glowing core at the solar plexus, widening slightly at Overdrive
    const open = smooth((c - 0.72) / 0.28);
    P.lhB = [-0.14 + 0.09 * c - 0.12 * open, -0.1 + 0.08 * c, 0.14 + 0.05 * c];
    P.rhB = [0.14 - 0.09 * c + 0.12 * open, -0.1 + 0.08 * c, 0.14 + 0.05 * c];
    delete P.lh; delete P.rh;
    return rig(P, out);
  },
};

// ---------------------------------------------------------------- the moves
/** what a move is handed: which hand strikes (+1 the right), the aim (the dancer's own frame, x its left; length
 *  0..1), in the air or not, the beat, the groove, time into the move (s) */
export interface MoveCtx { hand: number; aim: ArrayLike<number> | null; air: boolean; beat: number; groove: number; t: number }
export type { HandStyle, FootStyle };
/** hints for the retargeter, [left, right] */
export interface MoveStyle { hands?: [HandStyle, HandStyle]; feet?: [FootStyle, FootStyle] }
export interface Hit { a: string; b: string; r: number; stream?: { len: number; speed: number } }
export interface Travel { z?: number; y?: number; u0: number; u1: number }

export interface MoveInput {
  name: string;
  dur: number;
  active?: [number, number] | null;
  attack?: boolean;
  hit?: Hit | null;
  travel?: Travel | null;
  iframes?: [number, number] | null;
  cancelInto?: string[];
  airOk?: boolean;
  evade?: boolean;
  aimW?: number;
  usesHand?: boolean;
  hold?: { u: number };
  guard?: [number, number];
  loop?: boolean;
  style?: (u: number, ctx: MoveCtx) => MoveStyle;
  pose?: (u: number, ctx: MoveCtx, out: Float32Array) => Float32Array;
  /** a sampled move (motion capture): write the pose at progress u (39 floats, metres, the dancer's frame) */
  sample?: (u: number, out: Float32Array) => void;
}
export interface MoveDef extends MoveInput {
  active: [number, number] | null;
  attack: boolean;
  hit: Hit | null;
  travel: Travel | null;
  iframes: [number, number] | null;
  cancelInto: string[];
  airOk: boolean;
  evade: boolean;
  aimW: number;
  usesHand: boolean;
  windup: number;
  recover: number;
  sampled: boolean;
  pose: (u: number, ctx: MoveCtx, out: Float32Array) => Float32Array;
}

/** the aim in the prototype's frame (its x mirrored), unit length, or the fallback */
function aimDir(ctx: MoveCtx, fallback: V = [0, 0.06, 1]): V {
  const a = ctx.aim ? [-ctx.aim[0], ctx.aim[1], ctx.aim[2]] : fallback;
  const l = len(a);
  return l > 0.15 ? mul(a, 1 / l) : norm(fallback);
}
function setHand(P: RigParams, side: number, v: V, mode: '' | 'S' | 'B' = '') {
  const k = side > 0 ? 'rh' : 'lh';
  delete P[k]; delete P[k + 'S']; delete P[k + 'B'];
  P[k + mode] = v;
}

const meiaLua = track([
  [0.00, base()],
  [0.18, { hip: [-0.04, 0.31, 0], roll: -0.08, pitch: 0.0, twist: 0.2, rf: [0.17, 0.03, -0.02], lh: [-0.26, 0.46, 0.06], rh: [0.0, 0.58, 0.16] }],
  [0.32, { hip: [-0.05, 0.33, -0.01], roll: -0.28, pitch: -0.12, rf: [0.38, 0.24, 0.14], lh: [-0.34, 0.42, 0.0], rh: [-0.02, 0.58, 0.16] }],
  [0.47, { hip: [-0.05, 0.34, -0.02], roll: -0.3, pitch: -0.25, rf: [0.17, 0.62, 0.26], lh: [-0.34, 0.38, -0.02] }],
  [0.62, { hip: [-0.03, 0.34, -0.02], roll: -0.1, pitch: -0.22, twist: -0.15, rf: [-0.2, 0.54, 0.24], lh: [-0.3, 0.4, 0.0], rh: [0.08, 0.56, 0.14] }],
  [0.78, { hip: [0.0, 0.32, 0], roll: 0, pitch: 0.0, twist: 0, rf: [0.02, 0.16, 0.1], lh: [-0.16, 0.42, 0.1], rh: [0.12, 0.48, 0.14] }],
  [1.00, base()],
]);
const marteloT = track([
  [0.00, base()],
  [0.16, { hip: [-0.02, 0.3, -0.02], pitch: 0.0, yaw: -0.2, roll: -0.1, rf: [0.15, 0.02, 0.0], lh: [-0.2, 0.42, 0.06], rh: [0.04, 0.56, 0.16] }],
  [0.36, { hip: [-0.03, 0.32, -0.03], pitch: -0.12, yaw: -0.55, roll: -0.35, rf: [0.24, 0.28, 0.08], rkp: [1, 0.6, 0.2], lh: [-0.3, 0.42, 0.0], rh: [0.0, 0.56, 0.16] }],
  [0.47, { hip: [-0.03, 0.33, -0.02], pitch: -0.2, yaw: -0.8, roll: -0.45, rf: [0.04, 0.48, 0.36] }],
  [0.60, { rf: [0.0, 0.47, 0.35] }],
  [0.74, { hip: [-0.02, 0.32, -0.02], pitch: -0.08, yaw: -0.5, roll: -0.25, rf: [0.22, 0.26, 0.08] }],
  [1.00, base()],
]);
const bencaoT = track([
  [0.00, base()],
  [0.18, { hip: [0, 0.31, -0.01], pitch: 0.02, rf: [0.11, 0.13, 0.08], rkp: [0.1, 1, 1], lh: [-0.08, 0.52, 0.12], rh: [0.08, 0.55, 0.16] }],
  [0.34, { hip: [0, 0.33, -0.03], pitch: -0.12, rf: [0.1, 0.3, 0.14], lh: [-0.06, 0.57, 0.16], rh: [0.07, 0.58, 0.18] }],
  [0.46, { hip: [0, 0.33, 0.0], pitch: -0.36, rf: [0.08, 0.3, 0.44] }],
  [0.58, { pitch: -0.34, rf: [0.08, 0.29, 0.43] }],
  [0.76, { hip: [0, 0.32, 0.02], pitch: -0.08, rf: [0.12, 0.13, 0.16], lh: [-0.1, 0.46, 0.12], rh: [0.1, 0.48, 0.15] }],
  [1.00, base({ rf: [0.13, 0, 0.04] })],
]);
const rasteiraT = track([
  [0.00, base()],
  [0.20, { hip: [-0.05, 0.2, -0.03], pitch: 0.25, roll: -0.25, lf: [-0.12, 0, 0], rf: [0.16, 0, 0.02], lh: [-0.22, 0.14, 0.04], rh: [0.06, 0.45, 0.14] }],
  [0.35, { hip: [-0.07, 0.15, -0.04], pitch: 0.2, roll: -0.55, lf: [-0.08, 0, -0.02], rf: [0.38, 0.02, 0.04], rkp: [0, 1, 0.3], lh: [-0.32, 0.0, 0.0], rh: [0.02, 0.36, 0.12] }],
  [0.52, { rf: [0.3, 0.02, 0.3], hip: [-0.07, 0.14, -0.03] }],
  [0.70, { rf: [0.06, 0.03, 0.42], roll: -0.45 }],
  [0.85, { hip: [-0.03, 0.24, -0.01], pitch: 0.2, roll: -0.1, rf: [0.12, 0.02, 0.16], lh: [-0.18, 0.22, 0.08], rh: [0.08, 0.45, 0.14] }],
  [1.00, base()],
]);
const esquivaT = track([
  [0.00, base()],
  [0.12, { hip: [-0.05, 0.17, -0.06], pitch: -0.35, roll: -0.55, lf: [-0.21, 0, -0.04], rf: [0.15, 0, 0.06], lkp: [-0.6, 0, 1], lh: [-0.32, 0.02, -0.06], rh: [-0.03, 0.43, 0.13] }],
  [0.60, { hip: [-0.055, 0.165, -0.065], pitch: -0.38, roll: -0.58, lh: [-0.33, 0.02, -0.06], rh: [-0.04, 0.42, 0.13] }],
  [0.82, { hip: [-0.02, 0.26, -0.02], pitch: -0.05, roll: -0.15, lh: [-0.18, 0.3, 0.06], rh: [0.06, 0.48, 0.15] }],
  [1.00, base()],
]);
// cocorinha: down into the squat (LOCO.crouch's pose), held, up again
const COCO = { hip: [0, 0.16, -0.03], pitch: 0.42, crunch: 0.95, lf: [-0.14, 0.02, -0.02], rf: [0.14, 0.02, 0.03],
  lkp: [-0.8, 0.2, 0.7], rkp: [0.8, 0.2, 0.7], rh: [0.03, 0.46, 0.17], lh: [-0.1, 0.1, 0.17] };
const cocorinhaT = track([
  [0.00, base()],
  [0.18, { ...COCO }],
  [0.72, { ...COCO, hip: [0, 0.155, -0.035], rh: [0.03, 0.465, 0.17] }],
  [1.00, base()],
]);
// negativa: the left hand and the right foot carry it; the left leg out along the floor ahead; leaning back and to the
// left side, the head turned away (to the right), the right hand guarding the face
const negativaT = track([
  [0.00, base()],
  [0.18, { hip: [-0.06, 0.1, -0.04], pitch: -0.2, roll: -0.45, yaw: 0.2, head: [0.025, 0, 0], crunch: 0.95,
    lh: [-0.24, 0.0, -0.06], rh: [0.0, 0.3, 0.12], lf: [-0.1, 0.0, 0.36], rf: [0.1, 0, -0.02], rkp: [0.6, 0.4, 1], lkp: [-0.2, 1, 0.2] }],
  [0.62, { hip: [-0.065, 0.095, -0.045], lf: [-0.11, 0.0, 0.37] }],
  [0.82, { hip: [-0.02, 0.24, -0.02], pitch: 0.05, roll: -0.1, yaw: 0.05, head: [0, 0, 0], lh: [-0.16, 0.3, 0.06], rh: [0.08, 0.45, 0.14],
    lf: [-0.13, 0, 0.04], rf: [0.13, 0, 0] }],
  [1.00, base()],
]);
// the bow: the feet drawn together, the hands meet before the chest; then a deep bow from the hips (the torso near
// level, the hips back over the heels, the head tucked), the right hand to the belly and the left arm swept out and
// back: a silhouette that reads as a bow from a film's distance, not a lean; held, then up
const bowT = track([
  [0.00, base()],
  [0.22, { hip: [0, 0.32, 0], pitch: 0.0, lf: [-0.06, 0, 0], rf: [0.06, 0, 0], lh: [-0.015, 0.47, 0.11], rh: [0.015, 0.47, 0.11], head: [0, 0, 0] }],
  [0.42, { hip: [0, 0.345, -0.06], pitch: 1.2, head: [0, -0.07, -0.03], lh: [-0.2, 0.46, -0.01], rh: [0.02, 0.33, 0.06] }],
  [0.68, { hip: [0, 0.345, -0.065], pitch: 1.25, head: [0, -0.075, -0.032], lh: [-0.21, 0.47, -0.02], rh: [0.02, 0.325, 0.06] }],
  [0.86, { hip: [0, 0.32, 0], pitch: 0.04, head: [0, 0, 0], lh: [-0.1, 0.4, 0.1], rh: [0.1, 0.42, 0.12] }],
  [1.00, base()],
]);
const blockT = track([
  [0.00, base()],
  [0.12, { hip: [0, 0.28, -0.03], pitch: 0.0, lf: [-0.14, 0, -0.06], rf: [0.13, 0, 0.04], lh: [0.0, 0.63, 0.1], rh: [0.04, 0.55, 0.13], lep: [-0.3, -1, 0.4], rep: [0.3, -1, 0.4] }],
  [0.30, { hip: [0, 0.275, -0.035], lh: [0.0, 0.632, 0.102], rh: [0.04, 0.552, 0.132] }],
  [0.55, { hip: [0, 0.29, -0.01], pitch: 0.08, lh: [-0.1, 0.48, 0.14], rh: [0.1, 0.48, 0.16] }],
  [1.00, base()],
]);
const strikeT = track([
  [0.00, { a: 0, e: 0, lift: 0, tw: 0, pitch: 0.12, hz: 0 }],
  [0.28, { a: 1, e: -0.35, lift: 0.07, tw: -0.55, pitch: 0.06, hz: -0.02 }],
  [0.50, { a: 1, e: 0.85, lift: 0.0, tw: 0.4, pitch: 0.2, hz: 0.03 }],
  [0.58, { e: 1.0, tw: 0.55, pitch: 0.24, hz: 0.04 }],
  [0.70, { e: 1.0, tw: 0.55, pitch: 0.22, hz: 0.04 }],
  [0.86, { a: 0.6, e: 0.3, tw: 0.1, pitch: 0.14, hz: 0.01 }],
  [1.00, { a: 0, e: 0, lift: 0, tw: 0, pitch: 0.12, hz: 0 }],
]);
const throwT = track([
  [0.00, { a: 0, e: 0, coil: 0, tw: 0, pitch: 0.12, hz: 0 }],
  [0.15, { a: 1, e: 0, coil: 1, tw: -0.75, pitch: 0.0, hz: -0.03 }],
  [0.24, { a: 1, e: 0.8, coil: 0.15, tw: 0.3, pitch: 0.16, hz: 0.02 }],
  [0.32, { e: 1.0, coil: 0, tw: 0.5, pitch: 0.2, hz: 0.04 }],
  [0.82, { e: 1.0, coil: 0, tw: 0.45, pitch: 0.18, hz: 0.04 }],
  [0.93, { a: 0.5, e: 0.4, tw: 0.1, pitch: 0.14, hz: 0.01 }],
  [1.00, { a: 0, e: 0, coil: 0, tw: 0, pitch: 0.12, hz: 0 }],
]);
const num = (p: RigParams, k: string) => p[k] as number;

const ATTACK_NAMES = ['meia-lua', 'armada', 'martelo', 'bencao', 'rasteira', 'strike', 'throw'];
const KICK_CANCEL = ['esquiva', 'au', 'role', 'macaco', 'block', 'jump', 'spin', ...ATTACK_NAMES];
const others = (n: string, list = KICK_CANCEL) => list.filter((x) => x !== n);
/** a kick: the kicking foot pointed while it's up, the guard's hands closed */
const kickStyle = (side: 'L' | 'R', foot: FootStyle = 'point') => (): MoveStyle =>
  ({ feet: side === 'L' ? [foot, 'auto'] : ['auto', foot], hands: ['fist', 'fist'] });
/** radii in the prototype's figure units, as metres */
const R = (r: number) => r * FU;

const MOVE_DEFS: Record<string, Omit<MoveInput, 'name'>> = {
  ginga: {
    dur: (4 * 60) / BPM_REF, loop: true, cancelInto: ['*'], aimW: 1,
    pose(u, ctx, out) { return LOCO.ginga(out, ctx.beat ?? u * 4, ctx.groove ?? 1); },
  },

  // crescent kick: the lead leg swings out to its own side, up over the front of the body and across
  'meia-lua': {
    dur: 0.8, active: [0.32, 0.62], attack: true, hit: { a: 'RK', b: 'RA', r: R(0.06) }, cancelInto: others('meia-lua'), aimW: 0.7,
    style: kickStyle('R'),
    pose(u, _ctx, out) { return rig(meiaLua(u), out); },
  },

  // spinning kick: turn the back to the partner, then the rear leg sweeps round at head height
  armada: {
    dur: 1.07, active: [0.4, 0.68], attack: true, hit: { a: 'LK', b: 'LA', r: R(0.06) }, travel: { z: 0.04 * FU, u0: 0.1, u1: 0.4 },
    cancelInto: others('armada'), airOk: true, aimW: 0.4, style: kickStyle('L'),
    pose(u, ctx, out) {
      const turn = smooth(u / 0.32), kick = smooth((u - 0.3) / 0.4), up = Math.sin(Math.PI * clamp((u - 0.3) / 0.48, 0, 1));
      const yaw = -Math.PI * turn - Math.PI * kick;
      const P = base({ yaw, twist: -0.6 * Math.sin(Math.PI * clamp(u / 0.45, 0, 1)), pitch: mix(0.12, -0.05, up), roll: 0.32 * up,
        hip: [0, 0.3 + 0.04 * up, 0], head: [0, 0, 0] });
      // the feet pivot under the turning hips; the kicking (L) foot rises and travels with the hips
      P.rfB = [0.1 - 0.03 * up, -0.3, 0.0];
      P.lfB = mix3([-0.1, -0.3, 0], [-0.3, 0.2, 0.12], up);
      P.lkp = [-0.4, 0.6, 1];
      // arms wrap in, then fly open for balance
      P.lhB = mix3([0.08, -0.06, 0.15], [-0.18, -0.06, 0.06], up); P.rhB = mix3([-0.02, -0.04, 0.16], [0.24, -0.02, 0.0], up);
      delete P.lh; delete P.rh;
      if (u > 0.78) { const e = smooth((u - 0.78) / 0.22); P.lfB = mix3(P.lfB, [-0.1, -0.3, 0.02], e); }
      if (ctx.air) P.rfB = [0.07, -0.18, 0.08];
      return rig(P, out);
    },
  },

  // snap kick: the knee chambers out to the side, the shin whips in at head height and snaps back
  martelo: {
    dur: 0.54, active: [0.38, 0.62], attack: true, hit: { a: 'RK', b: 'RA', r: R(0.055) }, cancelInto: others('martelo'), airOk: true, aimW: 0.7,
    style: kickStyle('R'),
    pose(u, ctx, out) {
      const P = marteloT(u);
      if (ctx.air) { const lf = P.lf!; P.lf = [lf[0], lf[1] + 0.13, lf[2] + 0.06]; P.hip = [P.hip[0], P.hip[1] + 0.02, P.hip[2]]; }
      return rig(P, out);
    },
  },

  // push kick: knee high, then the sole drives straight forward
  bencao: {
    dur: 0.67, active: [0.36, 0.6], attack: true, hit: { a: 'RK', b: 'RA', r: R(0.065) }, travel: { z: 0.1 * FU, u0: 0.3, u1: 0.8 },
    cancelInto: others('bencao'), aimW: 0.6, style: kickStyle('R', 'flex'),
    pose(u, _ctx, out) { return rig(bencaoT(u), out); },
  },

  // low sweep: drop onto the rear leg with a hand on the floor; the lead leg sweeps along the ground
  rasteira: {
    dur: 0.8, active: [0.35, 0.72], attack: true, hit: { a: 'RK', b: 'RA', r: R(0.06) }, travel: { z: 0.05 * FU, u0: 0.1, u1: 0.4 },
    cancelInto: others('rasteira'), aimW: 0,
    style: (u) => ({ hands: [u > 0.15 && u < 0.85 ? 'floor' : 'relaxed', 'fist'], feet: ['auto', 'flex'] }),
    pose(u, _ctx, out) { return rig(rasteiraT(u), out); },
  },

  // hand strike along the aim: draw back by the ear, hips turn, the hand drives out and recoils
  strike: {
    dur: 0.42, active: [0.5, 0.7], attack: true, hit: { a: 'ELBOW', b: 'HAND', r: R(0.05) }, travel: { z: 0.04 * FU, u0: 0.3, u1: 0.6 },
    cancelInto: others('strike'), airOk: true, aimW: 0, usesHand: true,
    style: (_u, ctx) => ({ hands: ctx.hand > 0 ? ['open', 'fist'] : ['fist', 'open'] }),
    pose(u, ctx, out) {
      const k = strikeT(u), s = ctx.hand || 1, d = aimDir(ctx);
      const P = base({ pitch: num(k, 'pitch'), twist: -num(k, 'tw') * s, yaw: -0.15 * s * num(k, 'a'), hip: [0, 0.3 - 0.02 * num(k, 'a'), num(k, 'hz')], lf: [-0.14, 0, -0.06], rf: [0.13, 0, 0.05] });
      if (ctx.air) airLegs(P);
      const e = num(k, 'e'), lift = num(k, 'lift'), a = num(k, 'a');
      const rest = [s * 0.04, -0.12, 0.12];
      const back = [s * 0.03 - d[0] * 0.07, 0.07, -0.07];
      const drive = [d[0] * 0.232 * e, d[1] * 0.232 * e + lift, d[2] * 0.232 * e];
      const tgt = e < 0 ? mix3([0, lift, 0], back, -e / 0.35) : drive;
      setHand(P, s, mix3(rest, tgt, a), 'S');
      setHand(P, -s, mix3(s > 0 ? [-0.12, 0.42, 0.12] : [0.12, 0.44, 0.15], [-s * 0.02, 0.56, 0.16], a));
      return rig(P, out);
    },
  },

  // the bending throw: the arm coils across the body, whips out along the aim and holds for the stream
  throw: {
    dur: 1.07, active: [0.24, 0.82], attack: true, hit: { a: 'HAND', b: 'HAND', r: R(0.05), stream: { len: 1.3 * FU, speed: 4.2 * FU } },
    cancelInto: ['esquiva', 'au', 'role', 'macaco', 'block', 'jump', 'spin'], airOk: true, aimW: 0, usesHand: true,
    style: (_u, ctx) => ({ hands: ctx.hand > 0 ? ['relaxed', 'open'] : ['open', 'relaxed'] }),
    pose(u, ctx, out) {
      const k = throwT(u), s = ctx.hand || 1, d = aimDir(ctx);
      const e = num(k, 'e'), a = num(k, 'a'), coilK = num(k, 'coil');
      const P = base({ pitch: num(k, 'pitch') + 0.08 * d[2] * e, twist: -num(k, 'tw') * s, yaw: -0.15 * s * a, hip: [0, 0.29, num(k, 'hz') * Math.sign(d[2] || 1)], lf: [-0.15, 0, -0.08], rf: [0.14, 0, 0.07] });
      if (ctx.air) airLegs(P);
      const rest = [s * 0.04, -0.12, 0.12];
      const coil = [-s * 0.12 - d[0] * 0.05, -0.12 - d[1] * 0.06, 0.06 - d[2] * 0.04];
      const wob = 0.006 * Math.sin(u * 40) * (u > 0.32 && u < 0.82 ? 1 : 0);
      const ext = [d[0] * 0.235 * e, d[1] * 0.235 * e + wob, d[2] * 0.235 * e];
      setHand(P, s, mix3(rest, mix3(ext, coil, coilK), a), 'S');
      setHand(P, -s, mix3([-s * 0.04, -0.12, 0.1], [-d[0] * 0.17 - s * 0.05, -d[1] * 0.12 - 0.06, -d[2] * 0.15], e * a), 'S');
      return rig(P, out);
    },
  },

  // cartwheel, travelling forward: the body turns side-on and wheels over its hands in the y-z plane
  au: {
    dur: 1.07, travel: { z: 0.78 * FU, u0: 0.12, u1: 0.9 }, cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'esquiva'], evade: true, aimW: 0,
    style: (u) => { const on = u > 0.2 && u < 0.85; return { hands: on ? ['floor', 'floor'] : ['open', 'open'], feet: ['point', 'point'] }; },
    pose(u, _ctx, out) {
      const w = smooth(u / 0.16), r = smooth((u - 0.14) / 0.72), e = smooth((u - 0.86) / 0.14), star = w * (1 - e);
      const P = base({ hip: [0, mix(0.3, 0.33, star), 0], yaw: (-Math.PI / 2) * star, pitch: mix(0.12, 0.0, star), roll: 0.25 * w * (1 - r),
        rotX: TAU * r });
      P.lhB = mix3([-0.06, -0.14, 0.12], [-0.1, 0.22, 0.0], star); P.rhB = mix3([0.06, -0.14, 0.12], [0.1, 0.22, 0.0], star);
      delete P.lh; delete P.rh;
      P.lfB = mix3([-0.09, -0.3, 0], [-0.14, -0.27, 0.0], star); P.rfB = mix3([0.09, -0.3, 0], [0.14, -0.27, 0.0], star);
      P.lkp = [-1, 0, 0.3]; P.rkp = [1, 0, 0.3];
      rig(P, out);
      if (r > 0 && r < 1) { const m = lowest(out, [J.LW, J.RW, J.LA, J.RA]); shiftPose(out, 0, -m * smooth(Math.min(r, 1 - r) / 0.08), 0); }
      return out;
    },
  },

  // back handspring, travelling backward: sink, swing the arms up and back over the head to the floor, the legs
  // follow over the top and land; the hips lift through the arch so it reads as a spring, not a roll
  macaco: {
    dur: 1.07, travel: { z: -0.6 * FU, u0: 0.25, u1: 0.85 }, cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'esquiva', 'au'], evade: true, aimW: 0,
    style: (u) => { const on = u > 0.35 && u < 0.75; return { hands: on ? ['floor', 'floor'] : ['open', 'open'], feet: ['point', 'point'] }; },
    pose(u, _ctx, out) {
      const w = smooth(u / 0.25), r = smooth((u - 0.25) / 0.55), e = smooth((u - 0.8) / 0.2);
      const arch = Math.sin(Math.PI * r);
      const P = base({ hip: [0, mix(mix(0.3, 0.17, w), 0.3, e), 0], pitch: mix(mix(0.12, 0.5, w), 0.12, e) - 0.9 * arch, crunch: mix(1, 0.92, w * (1 - r)), rotX: -TAU * r });
      // arms swing forward in the crouch, then overhead and back to the floor
      P.lhB = mix3(mix3([-0.06, -0.14, 0.12], [-0.05, -0.05, 0.2], w), [-0.08, 0.22, -0.02], smooth(r / 0.3));
      P.rhB = mix3(mix3([0.06, -0.14, 0.12], [0.05, -0.05, 0.2], w), [0.08, 0.22, -0.02], smooth(r / 0.3));
      if (e > 0) { P.lhB = mix3(P.lhB, [-0.06, -0.14, 0.12], e); P.rhB = mix3(P.rhB, [0.06, -0.14, 0.12], e); }
      delete P.lh; delete P.rh;
      P.lfB = [-0.06, -mix(0.29, 0.2, w * (1 - e)) + 0.08 * arch, 0.0]; P.rfB = [0.06, -mix(0.29, 0.2, w * (1 - e)) + 0.08 * arch, 0.03];
      delete P.lf; delete P.rf;
      // the hips fly in an arc (the prototype glued the lowest point to the floor all the way round, so it lay down
      // flat at the quarter turns): over the top it is in the air, the floor caught by the feet, then the hands at
      // the handstand, then the feet again
      P.hip = [0, P.hip[1] + 0.24 * Math.sin(Math.PI * r), 0];
      rig(P, out);
      const m = lowest(out, [J.LW, J.RW, J.LA, J.RA]);
      const snap = Math.max(1 - smooth(r / 0.15), smooth(1 - Math.abs(r - 0.5) / 0.1), smooth((r - 0.82) / 0.13));
      shiftPose(out, 0, m < 0 ? -m : -m * snap, 0);
      return out;
    },
  },

  // low rolling turn (the dodge roll): drop to the hands and turn all the way round, travelling forward
  role: {
    dur: 0.8, travel: { z: 0.62 * FU, u0: 0.12, u1: 0.85 }, iframes: [0.18, 0.62], cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'rasteira', 'esquiva', 'au'], evade: true, aimW: 0,
    style: (u) => { const on = u > 0.15 && u < 0.85; return { hands: on ? ['floor', 'floor'] : ['relaxed', 'relaxed'] }; },
    pose(u, _ctx, out) {
      const w = smooth(u / 0.18), r = smooth((u - 0.15) / 0.65), e = smooth((u - 0.82) / 0.18), low = w * (1 - e);
      const P = base({ hip: [0, mix(0.3, 0.16, low) + 0.03 * Math.sin(Math.PI * r), 0], pitch: mix(0.12, 1.0, low), yaw: TAU * r, crunch: mix(1, 0.9, low) });
      // hands to the floor ahead of the body, one then the other as it turns
      const side = Math.cos(TAU * r);
      P.lhB = mix3([-0.06, -0.14, 0.12], [-0.08, -0.18 + 0.03 * Math.max(0, -side), 0.12], low);
      P.rhB = mix3([0.06, -0.14, 0.12], [0.08, -0.18 + 0.03 * Math.max(0, side), 0.12], low);
      delete P.lh; delete P.rh;
      P.lfB = [-0.1, -0.24 * (1 - low) - 0.14 * low + 0.03 * Math.max(0, Math.sin(TAU * r)) * low, -0.06 * low];
      P.rfB = [0.1, -0.24 * (1 - low) - 0.14 * low + 0.03 * Math.max(0, -Math.sin(TAU * r)) * low, -0.02 * low];
      delete P.lf; delete P.rf;
      rig(P, out);
      const m = lowest(out, [J.LA, J.RA, J.LW, J.RW]);
      shiftPose(out, 0, -m * low, 0);
      return out;
    },
  },

  // low dodge: drop and lean back and to the side, one hand on the floor, the other guarding the face
  esquiva: {
    dur: 0.6, iframes: [0.06, 0.62], cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'rasteira', 'au', 'role', 'macaco', 'strike'], airOk: true, evade: true, aimW: 0.3,
    style: (u, ctx) => ({ hands: [!ctx.air && u > 0.08 && u < 0.8 ? 'floor' : 'relaxed', 'open'] }),
    pose(u, ctx, out) {
      if (ctx.air) {
        const k = Math.sin(Math.PI * clamp(u / 0.85, 0, 1));
        const P = airLegs(base({ hip: [0, 0.34, 0], pitch: 0.4 * k, yaw: TAU * smooth(u), crunch: mix(1, 0.85, k),
          lh: [mix(-0.12, -0.02, k), mix(0.42, 0.44, k), 0.14], rh: [mix(0.12, 0.04, k), mix(0.44, 0.5, k), 0.16] }), 1);
        P.lf = [-0.05, mix(0.08, 0.18, k), 0.08]; P.rf = [0.06, mix(0.13, 0.2, k), 0.1];
        return rig(P, out);
      }
      return rig(esquivaT(u), out);
    },
  },

  block: {
    dur: 0.54, hold: { u: 0.3 }, guard: [0.06, 0.45],
    cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'bencao', 'rasteira', 'strike', 'au', 'role', 'macaco', 'esquiva'], aimW: 0,
    style: () => ({ hands: ['open', 'open'] }),
    pose(u, _ctx, out) { return rig(blockT(u), out); },
  },

  // (integration 8: the four moves the partner brain asked for, 7-partner.md, and a bow to end a film on)

  // cocorinha: the squat on the balls of the feet, knees open, one forearm guarding the head (LOCO.crouch's pose as a
  // move), a beat long: under a high kick, then back up into the ginga
  cocorinha: {
    dur: 0.6, iframes: [0.05, 0.9], evade: true, aimW: 0,
    cancelInto: ['compasso', 'rasteira', 'meia-lua', 'au', 'esquiva', 'jump'],
    style: () => ({ hands: ['relaxed', 'open'] }),
    pose(u, _ctx, out) { return rig(cocorinhaT(u), out); },
  },

  // negativa: dropped to the floor on one side, the left hand and the right foot down, the left leg stretched out low
  // along the floor, the head turned away from the kick and the right hand guarding it; then back up into the ginga
  negativa: {
    dur: 0.8, iframes: [0.1, 0.7], evade: true, aimW: 0,
    cancelInto: ['rasteira', 'compasso', 'au', 'role', 'esquiva', 'jump'],
    style: (u) => ({ hands: [u > 0.12 && u < 0.82 ? 'floor' : 'relaxed', 'open'], feet: ['flex', 'auto'] }),
    pose(u, _ctx, out) {
      rig(negativaT(u), out);
      // the hand and the foot that carry it stay on the floor while it is down
      const low = smooth(u / 0.18) * (1 - smooth((u - 0.78) / 0.2));
      if (low > 0) shiftPose(out, 0, -lowest(out, [J.LW, J.RA, J.LA]) * low, 0);
      return out;
    },
  },

  // meia-lua de compasso: from a low step the body turns its back, both hands go to the floor and the heel of the
  // straight right leg sweeps a full circle behind and up, at a ducking head's height (the armada's turn with the torso
  // pitched to the floor)
  compasso: {
    dur: 1.1, active: [0.45, 0.75], attack: true, hit: { a: 'RK', b: 'RA', r: R(0.07) }, travel: { z: 0.03 * FU, u0: 0.1, u1: 0.4 },
    cancelInto: others('compasso'), aimW: 0.3,
    style: (u) => { const on = u > 0.22 && u < 0.85; return { hands: on ? ['floor', 'floor'] : ['fist', 'fist'], feet: ['auto', 'flex'] }; },
    pose(u, _ctx, out) {
      const down = smooth(u / 0.3) * (1 - smooth((u - 0.82) / 0.18));
      const turn = smooth(u / 0.38), sweep = smooth((u - 0.38) / 0.42), up = Math.sin(Math.PI * clamp((u - 0.36) / 0.48, 0, 1));
      const P = base({ yaw: -Math.PI * turn - Math.PI * sweep, pitch: mix(0.12, 1.3, down), crunch: mix(1, 0.92, down),
        hip: [0, mix(0.3, 0.17, down), 0], head: [0, 0, 0] });
      // the standing (left) leg bent under the hips; the right sweeps straight behind and up through the active window
      P.lfB = mix3([-0.1, -0.3, 0], [-0.1, -0.16, 0.06], down);
      P.rfB = mix3(mix3([0.1, -0.3, 0], [0.14, -0.15, -0.12], down), [0.16, 0.28, -0.16], up);
      P.lkp = [-0.4, 0.3, 1]; P.rkp = [0.3, 0.2, -1];
      delete P.lf; delete P.rf;
      // the hands go down to the floor ahead of the shoulders (the shoulders' forward points to the floor when pitched)
      P.lhB = mix3([-0.08, -0.06, 0.15], [-0.07, 0.02, 0.21], down); P.rhB = mix3([0.08, -0.04, 0.16], [0.07, 0.02, 0.21], down);
      delete P.lh; delete P.rh;
      rig(P, out);
      if (down > 0) shiftPose(out, 0, -lowest(out, [J.LW, J.RW, J.LA]) * down, 0);
      return out;
    },
  },

  // queda de rins: one elbow tucked into the hip, that hand and the head toward the floor, the body tipped over
  // sideways onto them with the legs tucked up in the air, then back down: to change sides and to travel
  'queda-de-rins': {
    dur: 1.2, travel: { z: 0.4 * FU, u0: 0.15, u1: 0.8 }, iframes: [0.2, 0.8], evade: true, aimW: 0,
    cancelInto: ['compasso', 'meia-lua', 'au', 'jump'],
    style: (u) => { const on = u > 0.18 && u < 0.84; return { hands: [on ? 'floor' : 'relaxed', 'open'], feet: ['point', 'point'] }; },
    pose(u, _ctx, out) {
      // the body turns its left side to the way it goes (a quarter turn), then tips over that way about the hips, head
      // down past level, so the side the camera sees (square to the facing) is the whole balanced figure: the head and
      // both hands low ahead, the left elbow in the hip under it, the legs bent together and raised high behind
      const turn = smooth(u / 0.2) * (1 - smooth((u - 0.8) / 0.2));
      const w = smooth((u - 0.06) / 0.26), e = smooth((u - 0.72) / 0.24), on = w * (1 - e);
      // (balanced: the legs keep moving a little in the air while the body holds)
      const sway = Math.sin(Math.PI * clamp((u - 0.3) / 0.42, 0, 1));
      const P = base({ hip: [0, mix(0.3, 0.26, on), 0], yaw: (Math.PI / 2) * turn, pitch: mix(0.12, 0, on), crunch: mix(1, 0.9, on),
        rotX: 2.05 * on, pivot: [0, 0.27, 0], head: [0, 0, 0] });
      // both hands to the floor on the left side (down, once tipped) a little toward the head: the left elbow bent back
      // into the hip (its pole toward the hips), the right hand planted a hand's width further ahead
      P.lhB = mix3([-0.06, -0.14, 0.12], [-0.12, 0.03, 0.02], on); P.rhB = mix3([0.06, -0.14, 0.12], [-0.15, 0.1, 0.07], on);
      P.lep = mix3([-0.5, -0.6, -0.45], [0, -1, 0.1], on); P.rep = mix3([0.5, -0.6, -0.45], [0.2, -1, 0.3], on);
      delete P.lh; delete P.rh;
      // the legs together, bent, raised toward the right side (up, once tipped); they open a little in the hold
      P.lfB = mix3([-0.1, -0.3, 0], [0.13 - 0.03 * sway, -0.17, 0.08 + 0.04 * sway], on); P.rfB = mix3([0.1, -0.3, 0], [0.19 + 0.03 * sway, -0.12, 0.04 - 0.04 * sway], on);
      P.lkp = mix3([-0.3, 0, 1], [0.3, 0.2, 1], on); P.rkp = mix3([0.3, 0, 1], [0.6, 0.3, 1], on);
      delete P.lf; delete P.rf;
      rig(P, out);
      // whatever is lowest on the floor: the feet on the way in and out, the hand and the head (its middle 0.1 m above
      // the floor it rests on) tipped over
      shiftPose(out, 0, -Math.min(lowest(out, [J.LW, J.LA, J.RA]), out[3 * J.HEAD + 1] - 0.1), 0);
      return out;
    },
  },

  // a bow to end on: the feet together, the hands meet before the chest, the head and torso bow and hold, then rise
  bow: {
    dur: 2.4, aimW: 0, cancelInto: ['*'],
    style: () => ({ hands: ['open', 'open'] }),
    pose(u, _ctx, out) { return rig(bowT(u), out); },
  },

  // the spin flourish: a full pirouette on the balls of the feet, arms open and sweeping, rising overhead
  spin: {
    dur: 1.07, cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'esquiva', 'au', 'strike', 'throw'], airOk: true, aimW: 0.3,
    style: () => ({ hands: ['open', 'open'], feet: ['point', 'point'] }),
    pose(u, ctx, out) {
      const w = smooth(u / 0.15), r = smooth((u - 0.12) / 0.73), e = smooth((u - 0.8) / 0.2), on = w * (1 - e);
      const lift = smooth((r - 0.5) / 0.4) * (1 - e);
      const P = base({ hip: [0, mix(0.3, 0.355, on), 0], pitch: mix(0.12, -0.02, on), yaw: TAU * r, twist: -0.3 * Math.sin(Math.PI * r),
        lf: [mix(-0.13, -0.035, on), mix(0, 0.025, on), 0], rf: [mix(0.13, 0.035, on), mix(0, 0.01, on), 0.02] });
      if (ctx.air) airLegs(P);
      P.lhB = mix3([-0.06, -0.14, 0.12], [-0.21 + 0.1 * lift, -0.02 + 0.22 * lift, 0.02], on);
      P.rhB = mix3([0.06, -0.14, 0.12], [0.21 - 0.1 * lift, -0.02 + 0.22 * lift, 0.02], on);
      delete P.lh; delete P.rh;
      return rig(P, out);
    },
  },

  // ---------------------------------------------------------------- Flow Surf acrobatic & morph moves
  // forward tucked 360° aerial somersault
  somersault: {
    dur: 0.72, travel: { z: 0.72 * FU, y: 0.46 * FU, u0: 0.06, u1: 0.88 }, iframes: [0.08, 0.82],
    cancelInto: ['*'], airOk: true, evade: true, aimW: 0,
    style: () => ({ hands: ['open', 'open'], feet: ['point', 'point'] }),
    pose(u, _ctx, out) {
      const r = smooth((u - 0.06) / 0.78);
      const tuck = Math.sin(Math.PI * clamp((u - 0.05) / 0.82, 0, 1));
      const arc = Math.sin(Math.PI * clamp(u / 0.92, 0, 1));
      const P = base({
        hip: [0, 0.28 + 0.16 * arc, 0], pitch: 0.28 + 0.52 * tuck, crunch: mix(1, 0.8, tuck),
        rotX: TAU * r, pivot: [0, 0.34, 0],
      });
      P.lfB = mix3([-0.1, -0.3, 0.02], [-0.07, -0.11, 0.16], tuck);
      P.rfB = mix3([0.1, -0.3, 0.04], [0.07, -0.11, 0.16], tuck);
      P.lkp = [-0.2, 0.5, 1]; P.rkp = [0.2, 0.5, 1];
      delete P.lf; delete P.rf;
      P.lhB = mix3([-0.22, -0.04, 0.06], [-0.08, -0.14, 0.18], tuck);
      P.rhB = mix3([0.22, -0.04, 0.06], [0.08, -0.14, 0.18], tuck);
      delete P.lh; delete P.rh;
      return rig(P, out);
    },
  },

  // charged arched 360° backflip with soaring loft
  backflip: {
    dur: 0.84, travel: { z: 0.56 * FU, y: 0.74 * FU, u0: 0.06, u1: 0.9 }, iframes: [0.08, 0.84],
    cancelInto: ['*'], airOk: true, evade: true, aimW: 0,
    style: () => ({ hands: ['open', 'open'], feet: ['point', 'point'] }),
    pose(u, _ctx, out) {
      const r = smooth((u - 0.08) / 0.78);
      const arch = Math.sin(Math.PI * clamp((u - 0.04) / 0.86, 0, 1));
      const P = base({
        hip: [0, 0.28 + 0.22 * arch, 0], pitch: mix(0.22, -0.38, arch), crunch: mix(1, 1.04, arch),
        rotX: -TAU * r, pivot: [0, 0.36, 0],
      });
      P.lfB = mix3([-0.1, -0.3, 0], [-0.09, -0.18, -0.1], arch);
      P.rfB = mix3([0.1, -0.3, 0.03], [0.09, -0.16, -0.07], arch);
      delete P.lf; delete P.rf;
      P.lhB = mix3([-0.2, -0.04, 0.08], [-0.22, 0.2, -0.04], arch);
      P.rhB = mix3([0.2, -0.04, 0.08], [0.22, 0.2, -0.04], arch);
      delete P.lh; delete P.rh;
      return rig(P, out);
    },
  },

  // Tier 2 / Overdrive diagonal 540° twisting corkscrew flip
  corkscrew: {
    dur: 0.94, travel: { z: 0.96 * FU, y: 0.88 * FU, u0: 0.05, u1: 0.92 }, iframes: [0.06, 0.88],
    cancelInto: ['*'], airOk: true, evade: true, aimW: 0,
    style: () => ({ hands: ['open', 'open'], feet: ['point', 'point'] }),
    pose(u, _ctx, out) {
      const r = smooth((u - 0.06) / 0.82);
      const peak = Math.sin(Math.PI * clamp(u / 0.94, 0, 1));
      const P = base({
        hip: [0, 0.29 + 0.25 * peak, 0],
        yaw: TAU * 1.5 * r, pitch: 0.12 - 0.28 * peak, roll: 0.35 * peak,
        rotX: TAU * r, rotZ: 0.45 * peak, pivot: [0, 0.36, 0],
      });
      P.lfB = mix3([-0.1, -0.3, 0], [-0.08, -0.16, 0.08], peak);
      P.rfB = mix3([0.1, -0.3, 0.02], [0.09, -0.22, -0.05], peak);
      delete P.lf; delete P.rf;
      P.lhB = mix3([-0.2, -0.04, 0.08], [-0.26, 0.16, 0.04], peak);
      P.rhB = mix3([0.2, -0.04, 0.08], [0.26, 0.16, -0.02], peak);
      delete P.lh; delete P.rh;
      return rig(P, out);
    },
  },

  // charged double-rotation 720° cyclone tornado spin
  cyclone: {
    dur: 0.88, travel: { z: 0.56 * FU, y: 0.18 * FU, u0: 0.08, u1: 0.86 }, iframes: [0.1, 0.78],
    cancelInto: ['*'], airOk: true, evade: true, aimW: 0,
    style: () => ({ hands: ['open', 'open'], feet: ['point', 'point'] }),
    pose(u, ctx, out) {
      const w = smooth(u / 0.14), r = smooth((u - 0.08) / 0.78), e = smooth((u - 0.84) / 0.16), on = w * (1 - e);
      const lift = Math.sin(Math.PI * r);
      const P = base({
        hip: [0, mix(0.28, 0.36, on) + 0.06 * lift, 0],
        yaw: TAU * 2.0 * r, pitch: mix(0.14, -0.06, on), twist: -0.45 * lift,
        lf: [mix(-0.13, -0.05, on), mix(0, 0.07, lift), 0],
        rf: [mix(0.13, 0.05, on), mix(0, 0.11, lift), 0.03],
      });
      if (ctx.air) airLegs(P);
      P.lhB = mix3([-0.14, -0.1, 0.1], [-0.28, 0.14 * lift, 0.02], on);
      P.rhB = mix3([0.14, -0.1, 0.1], [0.28, 0.18 * lift, 0.02], on);
      delete P.lh; delete P.rh;
      return rig(P, out);
    },
  },

  // Water / Ice elemental morph: sleek low hydro-slip wave slide skimming the surface
  'hydro-slip': {
    dur: 0.76, travel: { z: 1.05 * FU, u0: 0.05, u1: 0.88 }, iframes: [0.06, 0.82],
    cancelInto: ['*'], airOk: true, evade: true, aimW: 0,
    style: (u) => ({ hands: [u > 0.12 && u < 0.78 ? 'floor' : 'open', 'open'], feet: ['point', 'point'] }),
    pose(u, _ctx, out) {
      const low = smooth(u / 0.18) * (1 - smooth((u - 0.74) / 0.24));
      const crest = smooth((u - 0.68) / 0.3);
      const P = base({
        hip: [0, mix(0.27, 0.13, low) + 0.05 * Math.sin(Math.PI * crest), 0.04 * low],
        yaw: 0.95 * low, pitch: mix(0.2, 0.42, low), roll: -0.42 * low, twist: -0.5 * low, crunch: mix(1, 0.88, low),
      });
      P.lfB = mix3([-0.12, -0.28, -0.06], [-0.14, -0.13, -0.18], low);
      P.rfB = mix3([0.12, -0.28, 0.08], [0.16, -0.12, 0.24], low);
      delete P.lf; delete P.rf;
      // trailing hand skims the glassy floor, leading arm rides the wave crest
      P.lhB = mix3([-0.22, -0.05, 0.06], [-0.22, -0.2, -0.12], low);
      P.rhB = mix3([0.22, -0.05, 0.08], [0.26, 0.08, 0.16], low);
      delete P.lh; delete P.rh;
      rig(P, out);
      if (low > 0.05) {
        const m = lowest(out, [J.LA, J.RA, J.LW]);
        if (m < 0) shiftPose(out, 0, -m * low, 0);
      }
      return out;
    },
  },

  // Fire / Plasma / Gems elemental morph: streamlined comet launch + dissolve + triumphant mid-air reform spin
  'ember-surge': {
    dur: 0.78, travel: { z: 1.12 * FU, y: 0.28 * FU, u0: 0.05, u1: 0.88 }, iframes: [0.06, 0.84],
    cancelInto: ['*'], airOk: true, evade: true, aimW: 0,
    style: () => ({ hands: ['open', 'open'], feet: ['point', 'point'] }),
    pose(u, _ctx, out) {
      const dive = smooth(u / 0.18) * (1 - smooth((u - 0.62) / 0.24));
      const reform = smooth((u - 0.56) / 0.42);
      const lift = Math.sin(Math.PI * clamp(u / 0.92, 0, 1));
      const P = base({
        hip: [0, 0.28 + 0.16 * lift, 0.06 * dive],
        pitch: mix(0.22, 1.18, dive), yaw: TAU * reform, crunch: mix(1, 1.06, dive),
      });
      P.lfB = mix3([-0.1, -0.3, 0], [-0.07, -0.28, -0.14], dive);
      P.rfB = mix3([0.1, -0.3, 0.02], [0.07, -0.24, -0.18], dive);
      delete P.lf; delete P.rf;
      // arms sweep back like comet wings during dissolve, then flare wide on reform
      const flare = Math.sin(Math.PI * reform);
      P.lhB = mix3([-0.2, -0.05, 0.08], [-0.14 - 0.16 * flare, -0.18 + 0.28 * flare, -0.18 + 0.22 * flare], Math.max(dive, flare));
      P.rhB = mix3([0.2, -0.05, 0.08], [0.14 + 0.16 * flare, -0.18 + 0.28 * flare, -0.18 + 0.22 * flare], Math.max(dive, flare));
      delete P.lh; delete P.rh;
      return rig(P, out);
    },
  },

  // stylish sideways carving power-drift
  'surf-carve': {
    dur: 0.56, travel: { z: 0.64 * FU, u0: 0.05, u1: 0.86 }, iframes: [0.08, 0.72],
    cancelInto: ['*'], airOk: false, evade: true, aimW: 0,
    style: () => ({ hands: ['open', 'open'], feet: ['flex', 'flex'] }),
    pose(u, _ctx, out) {
      const w = Math.sin(Math.PI * clamp(u, 0, 1));
      const P = base({
        hip: [0, mix(0.27, 0.18, w), 0],
        yaw: 1.05 * w, roll: -0.46 * w, pitch: 0.22, twist: -0.4 * w,
        lf: [-0.17, 0, -0.11], rf: [0.17, 0, 0.13],
      });
      P.lhB = [-0.26, -0.14 * w, 0.04]; P.rhB = [0.26, 0.08 * w, 0.1];
      delete P.lh; delete P.rh;
      return rig(P, out);
    },
  },
};

// ---------------------------------------------------------------- definitions
/** a full move from a definition (procedural with pose(), or sampled with sample()) */
export function asMove(def: MoveInput): MoveDef {
  if (!def || typeof def !== 'object') throw new Error('asMove: definition required');
  const m = {
    active: null, attack: false, hit: null, travel: null, iframes: null, cancelInto: [], airOk: false, evade: false, aimW: 0.5, usesHand: false,
    ...def,
  } as MoveDef;
  m.sampled = false;
  if (typeof def.pose !== 'function') {
    const sample = def.sample;
    if (typeof sample !== 'function') throw new Error(`move ${def.name}: needs pose(u, ctx, out) or sample(u, out)`);
    m.pose = (u, _ctx, out) => { sample(u, out); return out; };
    m.sampled = true;
  }
  if (!(m.dur > 0)) throw new Error(`move ${def.name}: dur must be > 0`);
  m.windup = m.active ? m.dur * m.active[0] : 0;
  m.recover = m.active ? m.dur * (1 - m.active[1]) : 0;
  m.evade = !!m.evade;
  return m;
}
export const MOVES: Record<string, MoveDef> = {};
for (const [name, d] of Object.entries(MOVE_DEFS)) MOVES[name] = asMove({ name, ...d });
/** add a move (procedural or sampled) to the library; the buttons can reach it through the mapping, scripts by name */
export function registerMove(def: MoveInput) { const m = asMove(def); MOVES[m.name] = m; return m; }

export const MOVE_NAMES = Object.keys(MOVES);
export const ATTACKS = MOVE_NAMES.filter((n) => MOVES[n].attack);
/** a move's root travel at progress u: [along the facing, up] in metres */
export function travelAt(def: MoveDef | null, u: number): [number, number] {
  const t = def && def.travel;
  if (!t) return [0, 0];
  const k = smooth((u - t.u0) / (t.u1 - t.u0));
  return [(t.z || 0) * k, (t.y || 0) * k];
}

// moves.js — the movement vocabulary of the Jogo: procedural, parametric 3-D poses on the 13-joint skeleton.
// Pure ES module, no DOM, no dependencies (runs in Node for the tests and contact sheets).
//
// LOCAL FRAME (figure units: the old full-size figure, standing hip 0.36, head top about 0.69).
//   x = the dancer's lateral axis (L joints at -x, R joints at +x: "screen left/right" for a figure that
//   faces the viewer), y = up, z = FORWARD (toward the partner). The root (0,0,0) is the ground point under
//   the hips. A pose is Float32Array(39): joint j is (out[3j], out[3j+1], out[3j+2]), order J below
//   (identical to js/skeleton.js J). The character turns it by its yaw (a rotation, never a mirror),
//   multiplies by `scale` (0.36) and adds the world root:  world = root + Ry(yaw) * local * scale,
//   Ry(yaw) * (0,0,1) = (sin yaw, 0, cos yaw)  (yaw = pi/2 faces world +x).
//
// API
//   J, NJ, BONE, BPM_REF = 112, FIG_HEIGHT, tempoScale(bpm) = 112 / clamp(bpm, 80, 140)
//   MOVES[name]   { name, dur, windup, active:[u0,u1]|null, recover, attack, hit, travel, iframes:[u0,u1]|null,
//                   cancelInto:[names | 'jump' | '*'], airOk, evade, aimW, usesHand?, hold?, loop?, pose(u, ctx, out39) }
//     dur        seconds at 112 bpm (multiply by tempoScale(bpm)). windup = dur*active[0], recover = dur*(1-active[1]).
//     active     the dangerous window in normalised progress u. iframes likewise.
//     hit        { a, b, r, stream? }: joint names of the hit capsule (a -> b) and radius in figure units.
//                'HAND'/'ELBOW' mean the striking hand (ctx.hand: +1 = R, -1 = L).
//                stream { len, speed }: the capsule extends from b along the aim, growing at speed (figure
//                units / s of move time) from the active start, up to len (the bending throw).
//     travel     { z, y, u0, u1 }: root motion in figure units along the facing (z) and up, eased u0..u1.
//     evade      the move carries the dancer clear (the rules' "dodging").   aimW  how far the bending hand
//                may follow the aim during the move (0..1).   hold { u }: progress freezes at u while held.
//     pose(u, ctx, out39): ctx = { hand: +1|-1, aim: [x,y,z] local (length 0..1), air: bool, beat, groove }.
//                Attack poses depend only on (u, hand, aim, air), so a move replays identically from its event.
//   asMove(def)   normalises a move definition. Also accepts SAMPLED moves (motion capture):
//                   { name, dur, sample(u, out39) [, attack, active, hit, travel, iframes, airOk, evade, aimW] }
//                 -> a full definition whose pose() calls sample(). registerMove(def) adds one to MOVES.
//   MOVE_NAMES, ATTACKS, travelAt(def, u) -> [dz, dy]
//   LOCO          ginga(out, beat, groove), run(out, phase, k), rise(out, k), fall(out, k), land(out, k),
//                 crouch(out, beat), stagger(out, u), reform(out, u)   (all local frame, 39 floats)
//   gingaSteps(beat0, beat1) -> [{ foot: 'L'|'R', beat }] foot plants crossed in (beat0, beat1]
//   rig(params, out39)        the body rig all poses are built with
//   project2D(pose39, viewYaw = 0, out26)  orthographic view: screen x = p . (cos v, 0, -sin v), screen y = y.
//                 viewYaw 0 looks from +z (the front of a dancer at yaw 0); -pi/2 looks from -x (profile,
//                 forward pointing right).
//   lerpPose(out, a, b, w), rotY(out, pose, yaw), NP = 39

export const J = { HEAD: 0, LS: 1, RS: 2, LE: 3, RE: 4, LW: 5, RW: 6, LH: 7, RH: 8, LK: 9, RK: 10, LA: 11, RA: 12 };
export const NJ = 13, NP = 39;
export const BONE = { UA: 0.115, FA: 0.115, TH: 0.18, SH: 0.18, TORSO: 0.21, NECK: 0.085, SHW: 0.068, HPW: 0.042 };
export const BPM_REF = 112;
export const FIG_HEIGHT = 0.69;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const tempoScale = bpm => BPM_REF / clamp(bpm || BPM_REF, 80, 140);

// ---------------------------------------------------------------- vector helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ry = (v, t) => { const c = Math.cos(t), s = Math.sin(t); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const inFrame = (o, l, u, f, b) => [o[0] + l[0] * b[0] + u[0] * b[1] + f[0] * b[2], o[1] + l[1] * b[0] + u[1] * b[1] + f[1] * b[2], o[2] + l[2] * b[0] + u[2] * b[1] + f[2] * b[2]];

// Two-bone IK in 3-D with a pole direction. -> [jx, jy, jz, ex, ey, ez]
function ik3(s, t, a, b, pole, maxStretch) {
  let d = sub(t, s), dist = len(d);
  const reach = a + b;
  if (dist > reach * maxStretch) { d = mul(d, reach * maxStretch / dist); dist = reach * maxStretch; t = add(s, d); }
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
// P (all optional except hip):
//   hip [x,y,z]        hip centre.
//   yaw, pitch, roll   body turn about y (+ turns the R side backward); forward lean (+ tips the shoulders
//                      toward the body's front); side lean (+ tips them toward the body's R side).
//   twist              shoulder yaw relative to the hips (counter-rotation). tilt  pelvis roll. crunch  torso length.
//   head [x,y,z]       head offset.
//   lh, rh             hand targets (local); or lhS/rhS relative to that shoulder (local axes); or lhB/rhB
//                      relative to the shoulder in the shoulders' own frame [lateral, up, forward].
//   lf, rf             foot targets (local); or lfB/rfB relative to the hip joint in the hips' frame.
//   lkp, rkp, lep, rep knee / elbow pole in the hips' / shoulders' frame [lateral, up, forward].
//   rotX, rotZ, pivot  whole-body rotation about the local x axis (+ tips the top toward +z) and the
//                      local z axis (+ tips the top toward -x), about pivot (default hip). Z first.
export function rig(P, out = new Float32Array(NP)) {
  const hip = P.hip.length === 3 ? P.hip : [P.hip[0], P.hip[1], 0];
  const yaw = P.yaw || 0, pitch = P.pitch || 0, roll = P.roll || 0, tw = P.twist || 0, tilt = P.tilt || 0;
  const cp = Math.cos(pitch);
  const up = ry([Math.sin(roll) * cp, Math.cos(roll) * cp, Math.sin(pitch)], yaw);
  const latH = ry([Math.cos(tilt + roll * 0.4), Math.sin(tilt + roll * 0.4), 0], yaw);
  const fwdH = ry([0, 0, 1], yaw);
  let latS = ry([1, 0, 0], yaw + tw); latS = norm(sub(latS, mul(up, dot(latS, up))));
  const fwdS = cross(latS, up);
  const sc = add(hip, mul(up, BONE.TORSO * (P.crunch ?? 1)));
  const set = (j, v) => { out[3 * j] = v[0]; out[3 * j + 1] = v[1]; out[3 * j + 2] = v[2]; };
  const LH = sub(hip, mul(latH, BONE.HPW)), RH = add(hip, mul(latH, BONE.HPW));
  const LS = sub(sc, mul(latS, BONE.SHW)), RS = add(sc, mul(latS, BONE.SHW));
  set(J.LH, LH); set(J.RH, RH); set(J.LS, LS); set(J.RS, RS);
  const hd = P.head || [0, 0, 0];
  set(J.HEAD, add(add(sc, mul(up, BONE.NECK)), add(mul(fwdS, 0.012), hd)));
  for (let i = 0; i < 2; i++) {
    const sd = i ? 1 : -1, S = i ? RS : LS;
    let t;
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
    let f;
    const abs = i ? P.rf : P.lf, bod = i ? P.rfB : P.lfB;
    if (bod) f = inFrame(H, latH, [0, 1, 0], fwdH, bod);
    else f = abs || [sd * 0.1, 0, 0];
    const pb = (i ? P.rkp : P.lkp) || [sd * 0.3, 0, 1];
    const pole = inFrame([0, 0, 0], latH, [0, 1, 0], fwdH, pb);
    const k = ik3(H, f, BONE.TH, BONE.SH, pole, 1.06);
    set(i ? J.RK : J.LK, k.slice(0, 3)); set(i ? J.RA : J.LA, k.slice(3));
  }
  if (P.rotZ || P.rotX) {
    const pv = P.pivot || hip, cz = Math.cos(P.rotZ || 0), sz = Math.sin(P.rotZ || 0), cx = Math.cos(P.rotX || 0), sx = Math.sin(P.rotX || 0);
    for (let j = 0; j < NJ; j++) {
      let x = out[3 * j] - pv[0], y = out[3 * j + 1] - pv[1], z = out[3 * j + 2] - pv[2];
      const x1 = x * cz - y * sz, y1 = x * sz + y * cz; x = x1; y = y1;
      const y2 = y * cx - z * sx, z2 = y * sx + z * cx; y = y2; z = z2;
      out[3 * j] = pv[0] + x; out[3 * j + 1] = pv[1] + y; out[3 * j + 2] = pv[2] + z;
    }
  }
  return out;
}

export function project2D(pose, viewYaw = 0, out = new Float32Array(NJ * 2)) {
  const c = Math.cos(viewYaw), s = Math.sin(viewYaw);
  for (let j = 0; j < NJ; j++) { out[2 * j] = pose[3 * j] * c - pose[3 * j + 2] * s; out[2 * j + 1] = pose[3 * j + 1]; }
  return out;
}
export function lerpPose(out, a, b, w) { for (let i = 0; i < NP; i++) out[i] = a[i] + (b[i] - a[i]) * w; return out; }
export function rotY(out, pose, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let j = 0; j < NJ; j++) { const x = pose[3 * j], z = pose[3 * j + 2]; out[3 * j] = x * c + z * s; out[3 * j + 1] = pose[3 * j + 1]; out[3 * j + 2] = -x * s + z * c; }
  return out;
}
function minY(out, joints) { let m = Infinity; for (const j of joints) m = Math.min(m, out[3 * j + 1]); return m; }
function shiftPose(out, dx, dy, dz) { for (let j = 0; j < NJ; j++) { out[3 * j] += dx; out[3 * j + 1] += dy; out[3 * j + 2] += dz; } }

// ---------------------------------------------------------------- keyframe tracks
// keys: [[u, {param: number | [x,y,z]}], ...]. Missing params carry forward (and back to the start).
// Cubic Hermite with Catmull-Rom tangents, zeroed at holds and turning points (no overshoot).
function track(keys) {
  const names = new Set();
  for (const k of keys) for (const n of Object.keys(k[1])) names.add(n);
  let prev = {};
  for (const k of keys) { for (const n of names) if (!(n in k[1]) && n in prev) k[1][n] = prev[n]; prev = k[1]; }
  for (let i = keys.length - 2; i >= 0; i--) for (const n of names) if (!(n in keys[i][1])) keys[i][1][n] = keys[i + 1][1][n];
  const T = keys.map(k => k[0]), N = keys.length, list = [...names];
  const tan = (i, n, c) => {
    if (i <= 0 || i >= N - 1) return 0;
    const g = j => { const v = keys[j][1][n]; return c < 0 ? v : v[c]; };
    const a = g(i - 1), b = g(i), d = g(i + 1);
    if ((b - a) * (d - b) <= 0) return 0;
    return (d - a) / (T[i + 1] - T[i - 1]);
  };
  return u => {
    u = clamp(u, T[0], T[N - 1]);
    let i = 0; while (i < N - 2 && u > T[i + 1]) i++;
    const t0 = T[i], h = T[i + 1] - t0, s = h > 0 ? (u - t0) / h : 0;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const o = {};
    for (const n of list) {
      const a = keys[i][1][n], b = keys[i + 1][1][n];
      if (typeof a === 'number') o[n] = h00 * a + h10 * h * tan(i, n, -1) + h01 * b + h11 * h * tan(i + 1, n, -1);
      else { o[n] = []; for (let c = 0; c < a.length; c++) o[n][c] = h00 * a[c] + h10 * h * tan(i, n, c) + h01 * b[c] + h11 * h * tan(i + 1, n, c); }
    }
    return o;
  };
}

// The neutral stance (ginga's "paralela"): facing +z, feet apart, knees soft, hands up in front.
const BASE = {
  hip: [0, 0.3, 0], yaw: 0, pitch: 0.12, roll: 0, twist: 0, tilt: 0, crunch: 1, head: [0, 0, 0],
  lh: [-0.12, 0.42, 0.12], rh: [0.12, 0.44, 0.15], lf: [-0.13, 0, 0], rf: [0.13, 0, 0],
};
const base = (o = {}) => Object.assign({}, BASE, o);
function airLegs(P, k = 1) {
  P.hip = [P.hip[0], mix(P.hip[1], 0.33, k), P.hip[2] || 0];
  P.lf = mix3(P.lf || [-0.1, 0, 0], [-0.08, 0.08, 0.04], k);
  P.rf = mix3(P.rf || [0.1, 0, 0], [0.07, 0.13, 0.1], k);
  delete P.lfB; delete P.rfB;
  return P;
}

// ---------------------------------------------------------------- locomotion
const BACK_AT = [[1, 0], [0, 0], [0, 1], [0, 0]];   // foot stepped back at beats 0,1,2,3 (L, R)
function gingaParams(beat, groove = 1) {
  const b = ((beat % 4) + 4) % 4, seg = Math.floor(b) % 4, f = b - Math.floor(b);
  const c = BACK_AT[seg], n = BACK_AT[(seg + 1) % 4];
  // during beat seg -> seg+1 the feet travel from state c to n, lifting at 0.35 and landing on the next beat
  const p = clamp((f - 0.35) / 0.65, 0, 1), q = smooth(p), lift = Math.sin(Math.PI * p);
  const Lb = mix(c[0], n[0], q), Rb = mix(c[1], n[1], q);
  const Lmov = c[0] !== n[0] ? 1 : 0, Rmov = c[1] !== n[1] ? 1 : 0;
  const s = Rb - Lb, back = Math.max(Lb, Rb), g = groove;
  const bounce = Math.pow(0.5 + 0.5 * Math.cos(TAU * f), 2);   // lowest on the beat, as the foot lands
  const breathe = Math.sin(TAU * b / 4);
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
export function gingaSteps(beat0, beat1) {
  const out = [];
  if (!(beat1 > beat0) || beat1 - beat0 > 8) return out;
  for (let n = Math.floor(beat0) + 1; n <= beat1; n++) {
    const prev = BACK_AT[(((n - 1) % 4) + 4) % 4], cur = BACK_AT[((n % 4) + 4) % 4];
    if (prev[0] !== cur[0]) out.push({ foot: 'L', beat: n });
    if (prev[1] !== cur[1]) out.push({ foot: 'R', beat: n });
  }
  return out;
}

export const LOCO = {
  ginga(out, beat, groove = 1) { return rig(gingaParams(beat, groove), out); },

  run(out, phase, k) {
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
  rise(out, k = 1) {
    return rig(base({ hip: [0, mix(0.32, 0.36, k), 0], pitch: mix(0.12, 0.0, k),
      lf: [-0.08, mix(0, 0.12, k), mix(0, 0.06, k)], rf: [0.08, mix(0, 0.16, k), mix(0, 0.1, k)],
      lh: [mix(-0.12, -0.2, k), mix(0.42, 0.8, k), 0.05], rh: [mix(0.12, 0.2, k), mix(0.44, 0.82, k), 0.06] }), out);
  },
  fall(out, k = 1) {
    return rig(base({ hip: [0, mix(0.34, 0.37, k), 0], pitch: 0.06,
      lf: [-0.1, mix(0.1, 0.02, k), 0.0], rf: [0.1, mix(0.14, 0.04, k), 0.05],
      lh: [mix(-0.2, -0.32, k), mix(0.7, 0.55, k), 0.02], rh: [mix(0.2, 0.32, k), mix(0.72, 0.56, k), 0.02] }), out);
  },
  land(out, k = 1) {
    return rig(base({ hip: [0, mix(0.3, 0.2, k), -0.02 * k], pitch: mix(0.12, 0.4, k), lf: [-0.15, 0, 0], rf: [0.15, 0, 0.02],
      lh: [mix(-0.12, -0.28, k), mix(0.42, 0.28, k), 0.1], rh: [mix(0.12, 0.28, k), mix(0.44, 0.3, k), 0.12] }), out);
  },
  // cocorinha: the low squat, one forearm guarding the head
  crouch(out, beat = 0) {
    const br = 0.006 * Math.sin(TAU * beat / 2);
    return rig(base({ hip: [0, 0.15 + br, -0.05], pitch: 0.5, crunch: 0.95, lf: [-0.13, 0, 0], rf: [0.13, 0, 0.02],
      lkp: [-0.7, 0, 1], rkp: [0.7, 0, 1], rh: [0.03, 0.44 + br, 0.16], lh: [-0.08, 0.07, 0.16] }), out);
  },
  stagger(out, u) {
    const k = 1 - smooth((u - 0.45) / 0.55), w = Math.sin(u * 14) * 0.03 * k;
    return rig(base({ hip: [0, mix(0.3, 0.32, k), -0.05 * k], pitch: mix(0.12, -0.5, k) + w, twist: 0.3 * k, roll: 0.1 * k,
      head: [0, 0, -0.02 * k], lh: [mix(-0.12, -0.1, k), mix(0.42, 0.74, k), mix(0.12, 0.2, k)], rh: [mix(0.12, 0.2, k), mix(0.44, 0.7, k), mix(0.15, 0.24, k)],
      lf: [-0.14, 0, mix(0, -0.06, k)], rf: [0.14, mix(0, 0.09, k), mix(0, 0.14, k)] }), out);
  },
  reform(out, u) {
    const a = smooth(u / 0.75), open = Math.sin(Math.PI * clamp((u - 0.35) / 0.65, 0, 1));
    rig(base({ hip: [0, mix(0.1, 0.3, a), 0], pitch: mix(1.0, 0.12, a), crunch: mix(0.6, 1, a),
      lf: [mix(-0.04, -0.13, a), 0, 0], rf: [mix(0.04, 0.13, a), 0, 0],
      lh: [mix(-0.02, -0.12, a) - 0.24 * open, mix(0.1, 0.42, a) + 0.25 * open, 0.12], rh: [mix(0.02, 0.12, a) + 0.24 * open, mix(0.12, 0.44, a) + 0.25 * open, 0.12] }), out);
    const s = mix(0.35, 1, smooth(u / 0.5));
    for (let i = 0; i < NP; i++) out[i] *= s;
    return out;
  },
};

// ---------------------------------------------------------------- the moves
function aimDir(ctx, fallback = [0, 0.06, 1]) {
  const a = ctx.aim || fallback;
  const l = len(a);
  return l > 0.15 ? mul(a, 1 / l) : norm(fallback);
}
function setHand(P, side, v, mode) {
  const k = side > 0 ? 'rh' : 'lh';
  delete P[k]; delete P[k + 'S']; delete P[k + 'B'];
  P[k + (mode || '')] = v;
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

const ATTACK_NAMES = ['meia-lua', 'armada', 'martelo', 'bencao', 'rasteira', 'strike', 'throw'];
const KICK_CANCEL = ['esquiva', 'au', 'role', 'macaco', 'block', 'jump', 'spin', ...ATTACK_NAMES];
const others = (n, list = KICK_CANCEL) => list.filter(x => x !== n);

const MOVE_DEFS = {
  ginga: {
    dur: 4 * 60 / BPM_REF, loop: true, cancelInto: ['*'], aimW: 1,
    pose(u, ctx, out) { return LOCO.ginga(out, ctx.beat ?? u * 4, ctx.groove ?? 1); },
  },

  // crescent kick: the lead leg swings out to its own side, up over the front of the body and across
  'meia-lua': {
    dur: 0.8, active: [0.32, 0.62], attack: true, hit: { a: 'RK', b: 'RA', r: 0.06 }, cancelInto: others('meia-lua'), aimW: 0.7,
    pose(u, ctx, out) { return rig(meiaLua(u), out); },
  },

  // spinning kick: turn the back to the partner, then the rear leg sweeps round at head height
  armada: {
    dur: 1.07, active: [0.4, 0.68], attack: true, hit: { a: 'LK', b: 'LA', r: 0.06 }, travel: { z: 0.04, u0: 0.1, u1: 0.4 },
    cancelInto: others('armada'), airOk: true, aimW: 0.4,
    pose(u, ctx, out) {
      const turn = smooth(u / 0.32), kick = smooth((u - 0.3) / 0.4), up = Math.sin(Math.PI * clamp((u - 0.3) / 0.48, 0, 1));
      const yaw = -Math.PI * turn - Math.PI * kick;
      const P = base({ yaw, twist: -0.6 * Math.sin(Math.PI * clamp(u / 0.45, 0, 1)), pitch: mix(0.12, -0.05, up), roll: 0.32 * up,
        hip: [0, 0.3 + 0.04 * up, 0], head: [0, 0, 0] });
      // the feet pivot under the turning hips; the kicking (L) foot rises and travels with the hips
      P.rfB = [0.1 - 0.03 * up, -0.3 - 0.0 * up, 0.0];
      P.lfB = mix3([-0.1, -0.3, 0], [-0.3, 0.2, 0.12], up);
      P.lkp = [-0.4, 0.6, 1];
      // arms wrap in, then fly open for balance
      P.lhB = mix3([0.08, -0.06, 0.15], [-0.18, -0.06, 0.06], up); P.rhB = mix3([-0.02, -0.04, 0.16], [0.24, -0.02, 0.0], up);
      if (u > 0.78) { const e = smooth((u - 0.78) / 0.22); P.lfB = mix3(P.lfB, [-0.1, -0.3, 0.02], e); }
      if (ctx.air) { P.rfB = [0.07, -0.18, 0.08]; }
      return rig(P, out);
    },
  },

  // snap kick: the knee chambers out to the side, the shin whips in at head height and snaps back
  martelo: {
    dur: 0.54, active: [0.38, 0.62], attack: true, hit: { a: 'RK', b: 'RA', r: 0.055 }, cancelInto: others('martelo'), airOk: true, aimW: 0.7,
    pose(u, ctx, out) {
      const P = marteloT(u);
      if (ctx.air) { P.lf = [P.lf[0], P.lf[1] + 0.13, P.lf[2] + 0.06]; P.hip = [P.hip[0], P.hip[1] + 0.02, P.hip[2]]; }
      return rig(P, out);
    },
  },

  // push kick: knee high, then the sole drives straight forward
  bencao: {
    dur: 0.67, active: [0.36, 0.6], attack: true, hit: { a: 'RK', b: 'RA', r: 0.065 }, travel: { z: 0.1, u0: 0.3, u1: 0.8 },
    cancelInto: others('bencao'), aimW: 0.6,
    pose(u, ctx, out) { return rig(bencaoT(u), out); },
  },

  // low sweep: drop onto the rear leg with a hand on the floor; the lead leg sweeps along the ground
  rasteira: {
    dur: 0.8, active: [0.35, 0.72], attack: true, hit: { a: 'RK', b: 'RA', r: 0.06 }, travel: { z: 0.05, u0: 0.1, u1: 0.4 },
    cancelInto: others('rasteira'), aimW: 0,
    pose(u, ctx, out) { return rig(rasteiraT(u), out); },
  },

  // hand strike along the aim: draw back by the ear, hips turn, the hand drives out and recoils
  strike: {
    dur: 0.42, active: [0.5, 0.7], attack: true, hit: { a: 'ELBOW', b: 'HAND', r: 0.05 }, travel: { z: 0.04, u0: 0.3, u1: 0.6 },
    cancelInto: others('strike'), airOk: true, aimW: 0, usesHand: true,
    pose(u, ctx, out) {
      const k = strikeT(u), s = ctx.hand || 1, d = aimDir(ctx);
      const P = base({ pitch: k.pitch, twist: -k.tw * s, yaw: -0.15 * s * k.a, hip: [0, 0.3 - 0.02 * k.a, k.hz], lf: [-0.14, 0, -0.06], rf: [0.13, 0, 0.05] });
      if (ctx.air) airLegs(P);
      const rest = [s * 0.04, -0.12, 0.12];
      const back = [s * 0.03 - d[0] * 0.07, 0.07, -0.07];
      const drive = [d[0] * 0.232 * k.e, d[1] * 0.232 * k.e + k.lift, d[2] * 0.232 * k.e];
      const tgt = k.e < 0 ? mix3([0, k.lift, 0], back, -k.e / 0.35) : drive;
      setHand(P, s, mix3(rest, tgt, k.a), 'S');
      setHand(P, -s, mix3(s > 0 ? [-0.12, 0.42, 0.12] : [0.12, 0.44, 0.15], [-s * 0.02, 0.56, 0.16], k.a));
      return rig(P, out);
    },
  },

  // the bending throw: the arm coils across the body, whips out along the aim and holds for the stream
  throw: {
    dur: 1.07, active: [0.24, 0.82], attack: true, hit: { a: 'HAND', b: 'HAND', r: 0.05, stream: { len: 1.3, speed: 4.2 } },
    cancelInto: ['esquiva', 'au', 'role', 'macaco', 'block', 'jump', 'spin'], airOk: true, aimW: 0, usesHand: true,
    pose(u, ctx, out) {
      const k = throwT(u), s = ctx.hand || 1, d = aimDir(ctx);
      const P = base({ pitch: k.pitch + 0.08 * d[2] * k.e, twist: -k.tw * s, yaw: -0.15 * s * k.a, hip: [0, 0.29, k.hz * Math.sign(d[2] || 1)], lf: [-0.15, 0, -0.08], rf: [0.14, 0, 0.07] });
      if (ctx.air) airLegs(P);
      const rest = [s * 0.04, -0.12, 0.12];
      const coil = [-s * 0.12 - d[0] * 0.05, -0.12 - d[1] * 0.06, 0.06 - d[2] * 0.04];
      const wob = 0.006 * Math.sin(u * 40) * (u > 0.32 && u < 0.82 ? 1 : 0);
      const ext = [d[0] * 0.235 * k.e, d[1] * 0.235 * k.e + wob, d[2] * 0.235 * k.e];
      setHand(P, s, mix3(rest, mix3(ext, coil, k.coil), k.a), 'S');
      setHand(P, -s, mix3([-s * 0.04, -0.12, 0.1], [-d[0] * 0.17 - s * 0.05, -d[1] * 0.12 - 0.06, -d[2] * 0.15], k.e * k.a), 'S');
      return rig(P, out);
    },
  },

  // cartwheel, travelling forward: the body turns side-on and wheels over its hands in the y-z plane
  au: {
    dur: 1.07, travel: { z: 0.78, u0: 0.12, u1: 0.9 }, cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'esquiva'], evade: true, aimW: 0,
    pose(u, ctx, out) {
      const w = smooth(u / 0.16), r = smooth((u - 0.14) / 0.72), e = smooth((u - 0.86) / 0.14), star = w * (1 - e);
      const P = base({ hip: [0, mix(0.3, 0.33, star), 0], yaw: -Math.PI / 2 * star, pitch: mix(0.12, 0.0, star), roll: 0.25 * w * (1 - r),
        rotX: TAU * r });
      P.lhB = mix3([-0.06, -0.14, 0.12], [-0.1, 0.22, 0.0], star); P.rhB = mix3([0.06, -0.14, 0.12], [0.1, 0.22, 0.0], star);
      delete P.lh; delete P.rh;
      P.lfB = mix3([-0.09, -0.3, 0], [-0.14, -0.27, 0.0], star); P.rfB = mix3([0.09, -0.3, 0], [0.14, -0.27, 0.0], star);
      P.lkp = [-1, 0, 0.3]; P.rkp = [1, 0, 0.3];
      rig(P, out);
      if (r > 0 && r < 1) { const m = minY(out, [J.LW, J.RW, J.LA, J.RA]); shiftPose(out, 0, -m * smooth(Math.min(r, 1 - r) / 0.08), 0); }
      return out;
    },
  },

  // back handspring, travelling backward: crouch, reach back over the head to the floor, legs follow over
  macaco: {
    dur: 1.07, travel: { z: -0.6, u0: 0.25, u1: 0.85 }, cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'esquiva', 'au'], evade: true, aimW: 0,
    pose(u, ctx, out) {
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
      rig(P, out);
      const m = minY(out, [J.LW, J.RW, J.LA, J.RA]);
      const hop = 0.1 * Math.sin(Math.PI * clamp((r - 0.35) / 0.5, 0, 1));
      shiftPose(out, 0, -m + hop, 0);
      return out;
    },
  },

  // low rolling turn (the dodge roll): drop to the hands and turn all the way round, travelling forward
  role: {
    dur: 0.8, travel: { z: 0.62, u0: 0.12, u1: 0.85 }, iframes: [0.18, 0.62], cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'rasteira', 'esquiva', 'au'], evade: true, aimW: 0,
    pose(u, ctx, out) {
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
      const m = minY(out, [J.LA, J.RA, J.LW, J.RW]);
      shiftPose(out, 0, -m * low, 0);
      return out;
    },
  },

  // low dodge: drop and lean back and to the side, one hand on the floor, the other guarding the face
  esquiva: {
    dur: 0.6, iframes: [0.06, 0.62], cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'rasteira', 'au', 'role', 'macaco', 'strike'], airOk: true, evade: true, aimW: 0.3,
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
    pose(u, ctx, out) { return rig(blockT(u), out); },
  },

  // the spin flourish: a full pirouette on the balls of the feet, arms open and sweeping, rising overhead
  spin: {
    dur: 1.07, cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'esquiva', 'au', 'strike', 'throw'], airOk: true, aimW: 0.3,
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
};

// ---------------------------------------------------------------- definitions
const DEFAULTS = { active: null, attack: false, hit: null, travel: null, iframes: null, cancelInto: [], airOk: false, evade: false, aimW: 0.5, usesHand: false };
export function asMove(def) {
  if (!def || typeof def !== 'object') throw new Error('asMove: definition required');
  const m = Object.assign({}, DEFAULTS, def);
  if (typeof m.pose !== 'function') {
    if (typeof def.sample !== 'function') throw new Error(`move ${def.name}: needs pose(u, ctx, out) or sample(u, out)`);
    m.pose = (u, ctx, out) => { def.sample(u, out); return out; };
    m.sampled = true;
  }
  if (!(m.dur > 0)) throw new Error(`move ${def.name}: dur must be > 0`);
  m.windup = m.active ? m.dur * m.active[0] : 0;
  m.recover = m.active ? m.dur * (1 - m.active[1]) : 0;
  m.evade = !!m.evade;
  return m;
}
export const MOVES = {};
for (const [name, d] of Object.entries(MOVE_DEFS)) MOVES[name] = asMove(Object.assign({ name }, d));
export function registerMove(def) { const m = asMove(def); MOVES[m.name] = m; return m; }

export const MOVE_NAMES = Object.keys(MOVES);
export const ATTACKS = MOVE_NAMES.filter(n => MOVES[n].attack);
export function travelAt(def, u) {
  const t = def && def.travel;
  if (!t) return [0, 0];
  const k = smooth((u - t.u0) / (t.u1 - t.u0));
  return [(t.z || 0) * k, (t.y || 0) * k];
}

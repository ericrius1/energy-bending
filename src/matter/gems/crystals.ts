// The large crystals: a second scale of gem body, one or a few crystals per capsule shaped to the limb (a long
// prism along an upper arm, a forearm, a thigh or a shin; a cluster on a hand or a foot; a great geode over the
// torso; a cut stone for the head). A gem layer wears them with `params.crystals` (1: every part it covers; 'torso':
// only the geode and the hips). Each rides its bone rigidly on a little spring (here, on the CPU: a few dozen of
// them), cracks into the layer's small stones at a peak or an impact (motion.ts), or when the body sheds, and
// re-forms when its stones are home. While a crystal stands, the small stones under it are hidden on the body
// (Sim.caps: the cull skips them); when it cracks they burst off it as shards.
import { LIMITS } from '../../engine/limits';
import { JOINT, JOINT_FLOATS, type Rig } from '../../skeleton/rig';
import type { Dancer } from '../../dancer/dancer';
import { CAPSULES } from '../core/capsules';
import type { MatterLayer } from '../core/kind';
import { SHAPES, type ShapeId } from './shapes';
import type { Peak } from './motion';

const SEGS = LIMITS.capsules;
/** crystals one body can wear (the uniform holds this many per dancer) */
export const PER_BODY = 16;
export const MAX_CRYSTALS = LIMITS.dancers * PER_BODY;

type V3 = [number, number, number];
type Q = [number, number, number, number];

/** how each capsule is worn as a crystal: its shape, the capsules it covers (their stones hide under it), its role */
interface Plan { at: string; shape: ShapeId; covers: string[]; role: 0 | 1 | 2 }
const SIDE = (s: 'Left' | 'Right', h: 'L' | 'R'): Plan[] => [
  { at: `${h}HipJoint`, shape: 'prism', covers: [`${h}HipJoint`], role: 0 },
  { at: `${s}UpLeg`, shape: 'prism2', covers: [`${s}UpLeg`], role: 1 },
  { at: `${s}Leg`, shape: 'prism2', covers: [`${s}Leg`], role: 1 },
  { at: `${s}Foot`, shape: 'cluster', covers: [`${s}Foot`, `${s}ToeBase`], role: 2 },
  { at: `${s}Shoulder`, shape: 'prism', covers: [`${s}Shoulder`], role: 1 },
  { at: `${s}Arm`, shape: 'prism2', covers: [`${s}Arm`], role: 1 },
  { at: `${s}ForeArm`, shape: 'prism2', covers: [`${s}ForeArm`], role: 1 },
  { at: `${s}FingerBase`, shape: 'cluster', covers: [`${s}FingerBase`, `${s}HandIndex1`], role: 2 },
];
const PLANS: Plan[] = [
  { at: 'Spine', shape: 'geode', covers: ['LowerBack', 'Spine', 'Neck'], role: 0 },
  { at: 'Neck1', shape: 'prism', covers: ['Neck1'], role: 2 },
  { at: 'Head', shape: 'cut', covers: ['Head'], role: 2 },
  ...SIDE('Left', 'L'),
  ...SIDE('Right', 'R'),
];
const capIndex = (joint: string) => CAPSULES.findIndex((c) => c.joint === joint);

/** one crystal on one dancer */
interface Crystal {
  dancer: number; joint: number; shape: number; kind: number; glow: number;
  slots: number[];               // the capsule slots it covers
  centre: V3; turn: Q; size: V3; // in its joint's frame
  low: number;                   // how near the ground it rests (0 feet … 1 head): the re-forming goes feet first
  pos: V3; vel: V3; rot: Q; prev: V3;
  whole: number; down: number;   // 0 … 1 standing; seconds until it may re-form
  fresh: boolean;
}

/** tunables (gems/params.ts) */
export interface CrystalParams { crystalSpring: number; crystalLag: number; reform: number; crackBurst: number; crackAt: number }

export class Crystals {
  /** the Crystals uniform's rows: pos (xyz, grown), rot, size (xyz, dancer), look (kind, glow, flash, shape) */
  readonly rows = Array.from({ length: MAX_CRYSTALS }, () => ({ pos: [0, 0, 0, 0], rot: [0, 0, 0, 1], size: [0, 0, 0, 0], look: [0, 0, 0, 0] }));
  /** per shape (SHAPES order): the first instance and how many */
  readonly runs = SHAPES.map(() => ({ first: 0, count: 0 }));
  /** per capsule slot: 1 while a standing crystal covers it (its stones hide) */
  readonly hide = new Float32Array(LIMITS.dancers * SEGS);
  /** per capsule slot: this frame's crack (the share of its stones that burst off), and how fast they go */
  readonly crack = new Float32Array(LIMITS.dancers * SEGS);
  private list: Crystal[] = [];
  cracks = 0;

  get count() { return this.list.length; }

  /** the gem layers that wear crystals: which crystal on which capsule, in which mineral */
  layout(layers: readonly MatterLayer[], suiteOf: (l: MatterLayer) => number[], heartOf: (l: MatterLayer) => number) {
    const old = new Map(this.list.map((c) => [`${c.dancer}.${c.joint}.${c.shape}`, c]));
    const next: Crystal[] = [];
    for (const l of layers) {
      const want = l.layer.params?.crystals;
      if (!want) continue;
      const suite = suiteOf(l);
      const only = want === 'torso' ? ['torso'] : null;
      const idx = new Map(l.rig.joints.map((j, k) => [j.name, k]));
      const glow = heartOf(l);
      for (const p of PLANS) {
        const ci = capIndex(p.at);
        if (ci < 0) continue;
        const cap = CAPSULES[ci];
        if (l.parts && !l.parts.includes(cap.part)) continue;
        if (only && !only.includes(cap.part)) continue;
        const j = idx.get(cap.joint), k = idx.get(cap.child);
        if (j === undefined || k === undefined || next.filter((c) => c.dancer === l.dancer).length >= PER_BODY) continue;
        const fit = fitOf(p, l.rig, idx, ci);
        const shape = SHAPES.indexOf(p.shape);
        const was = old.get(`${l.dancer}.${j}.${shape}`);
        next.push({
          dancer: l.dancer, joint: j, shape, kind: suite[Math.min(p.role, suite.length - 1)], glow: p.shape === 'geode' ? glow : 0,
          slots: p.covers.map(capIndex).filter((c) => c >= 0).map((c) => l.dancer * SEGS + c),
          ...fit, pos: was?.pos ?? [0, 0, 0], vel: was?.vel ?? [0, 0, 0], rot: was?.rot ?? [0, 0, 0, 1], prev: was?.prev ?? [0, 0, 0],
          whole: was?.whole ?? 0, down: was?.down ?? 0.5, fresh: !was,
        });
      }
    }
    next.sort((a, b) => a.shape - b.shape);
    this.list = next;
    this.runs.forEach((r) => { r.first = 0; r.count = 0; });
    next.forEach((c, i) => { const r = this.runs[c.shape]; if (!r.count) r.first = i; r.count++; });
    for (const r of this.rows) r.pos[3] = 0;
  }

  /**
   * each frame: every crystal to its bone on its spring; cracks at the peaks (motion.ts) and on a shatter; re-forming
   * once it may (`standing`: the dance is on and nothing is falling). Writes the uniform's rows, hide and crack.
   */
  update(dancers: readonly Dancer[], dt: number, peaks: readonly Peak[], squash: Float32Array, standing: boolean, shatter: boolean, P: CrystalParams) {
    this.hide.fill(0);
    this.crack.fill(0);
    const hits = new Map<number, Peak>();
    for (const pk of peaks) hits.set(pk.slot, pk);
    const step = Math.max(dt, 0);
    this.list.forEach((c, n) => {
      const w = dancers[c.dancer]?.skeleton.world;
      if (!w) return;
      const o = c.joint * JOINT_FLOATS;
      const jp: V3 = [w[o], w[o + 1], w[o + 2]], jq: Q = [w[o + 4], w[o + 5], w[o + 6], w[o + 7]];
      // where its bone holds it, squashed with the body on a landing
      let tp = add(jp, qrot(jq, c.centre));
      const sq = squash[c.dancer * 4], ground = squash[c.dancer * 4 + 1];
      if (sq !== 0) tp = [squash[c.dancer * 4 + 2] + (tp[0] - squash[c.dancer * 4 + 2]) * (1 + sq * 0.5), ground + (tp[1] - ground) * (1 - sq), squash[c.dancer * 4 + 3] + (tp[2] - squash[c.dancer * 4 + 3]) * (1 + sq * 0.5)];
      const tq = qmul(jq, c.turn);
      const tv: V3 = step > 0 && !c.fresh ? scale(sub(tp, c.prev), 1 / step) : [0, 0, 0];
      const jumped = len(sub(tp, c.prev)) > 0.5;
      c.prev = tp;
      if (c.fresh || jumped) { c.pos = [...tp]; c.vel = [...tv]; c.rot = [...tq]; c.fresh = false; }
      else if (step > 0) {
        // a little spring: implicit, a touch under-damped, and never more than `crystalLag` from its bone
        const k = P.crystalSpring, cd = 2 * Math.sqrt(k) * 0.6, den = 1 + step * cd + step * step * k;
        for (let a = 0; a < 3; a++) c.vel[a] = (c.vel[a] + step * (k * (tp[a] - c.pos[a]) + cd * tv[a])) / den;
        for (let a = 0; a < 3; a++) c.pos[a] += c.vel[a] * step;
        const e = sub(c.pos, tp), el = len(e);
        if (el > P.crystalLag) c.pos = add(tp, scale(e, P.crystalLag / el));
        c.rot = qslerp(c.rot, tq, 1 - Math.exp(-step * 28));
      }
      // cracks: a peak on any capsule it covers, or the body shattering
      let hit = shatter ? 1 : 0, speed = len(tv);
      for (const s of c.slots) { const pk = hits.get(s); if (pk && pk.strength >= P.crackAt) { hit = Math.max(hit, pk.strength); speed = Math.max(speed, pk.speed); } }
      if (hit > 0 && c.whole > 0.5) {
        c.whole = 0;
        c.down = P.reform * (0.8 + 0.4 * ((n * 0.618) % 1));
        for (const s of c.slots) this.crack[s] = Math.min(1, P.crackBurst * (0.6 + 0.4 * hit));
        this.cracks++;
      }
      // re-forming: feet first, as the stones rise
      if (!standing) { c.whole = Math.max(0, c.whole - step * 4); c.down = Math.max(c.down, 0.6 + c.low * 0.8); }
      else if (c.down > 0) c.down -= step;
      else c.whole = Math.min(1, c.whole + step * 2.5);
      if (c.whole > 0.5) for (const s of c.slots) this.hide[s] = 1;
      // the uniform's row
      const row = this.rows[n];
      const grow = c.whole <= 0 ? 0 : 0.55 + 0.45 * smooth(c.whole);
      row.pos = [c.pos[0], c.pos[1], c.pos[2], grow]; row.rot = [...c.rot]; row.size = [c.size[0], c.size[1], c.size[2], c.dancer];
      row.look = [c.kind, c.glow, c.whole > 0 ? 1 - smooth(Math.min(1, c.whole * 1.2)) : 0, c.shape];
    });
  }
}

/** a crystal's place, turn and size in its joint's frame, from the rig's rest offsets and the capsule's radii */
function fitOf(p: Plan, rig: Rig, idx: Map<string, number>, ci: number) {
  const cap = CAPSULES[ci];
  const off = (name: string): V3 => [...rig.joints[idx.get(name)!].offset] as V3;
  const child = off(cap.child);
  const l = len(child);
  if (p.shape === 'geode') {
    // the whole torso, from the lower back to the top of the chest, its hollow facing forward (+z at rest)
    const lower = scale(off('Spine'), -1);
    const top = add(add(off('Spine1'), off('Neck')), off('Neck1'));
    const axis = sub(top, lower), h = len(axis);
    return { centre: scale(add(lower, top), 0.5), turn: basisQ(axis), size: [0.2, h * 0.56, 0.155] as V3, low: 0.55 };
  }
  if (p.shape === 'cut') {
    const c = scale(child, 0.42);
    return { centre: c, turn: basisQ(child), size: [0.098, 0.125, 0.085] as V3, low: 1 };
  }
  const ra = Math.max(cap.ra0, cap.ra1), rb = Math.max(cap.rb0, cap.rb1);
  if (p.shape === 'cluster') {
    // a hand's or a foot's end: on along the next bone too
    const next = p.covers[1] ? off(CAPSULES[capIndex(p.covers[1])].child) : [0, 0, 0] as V3;
    const reach = add(child, next), r = len(reach);
    return { centre: scale(reach, 0.5), turn: basisQ(reach), size: [ra * 1.5 + 0.02, r * 0.62, rb * 1.3 + 0.02] as V3, low: /Foot/.test(p.at) ? 0 : 0.55 };
  }
  const low = /Leg|Hip/.test(p.at) ? (/UpLeg|Hip/.test(p.at) ? 0.35 : 0.15) : 0.7;
  return { centre: scale(child, 0.5), turn: basisQ(child), size: [ra + 0.022, l * 0.5 + Math.max(ra, rb) * 0.7, rb + 0.022] as V3, low };
}

/** the turn that takes y to `axis` and keeps z as near forward (+z) as it can: a right-handed frame */
function basisQ(axis: V3): Q {
  const y = norm(axis);
  const ref: V3 = Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x = norm(cross(y, ref));
  const z = cross(x, y);
  return fromCols(x, y, z);
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const smooth = (x: number) => x * x * (3 - 2 * x);
function qmul(a: Q, b: Q): Q {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function qrot(q: Q, v: V3): V3 {
  const t = scale(cross([q[0], q[1], q[2]], v), 2);
  return add(add(v, scale(t, q[3])), cross([q[0], q[1], q[2]], t));
}
function qslerp(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d *= s;
  const r: Q = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t];
  const l = Math.hypot(...r) || 1;
  return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
}
/** a rotation from its matrix's columns */
function fromCols(x: V3, y: V3, z: V3): Q {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** the joints a heart sits between (the chest), for hearts.ts */
export const HEART_JOINTS = [JOINT.Spine, JOINT.Spine1, JOINT.Neck];

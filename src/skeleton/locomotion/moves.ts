// Motion matching's database (from Gem Dancers' Lead mode, play/moves.ts). The vocabulary a travelling dancer draws
// on: every frame of the clips in motion.json and travel.json, described by what it does — where
// the feet are and how they're moving, how the hips go, where the dance travels over the next second and which way it
// turns, how lively it is — so that a dancer asked to go somewhere can find, among all of them, the move that goes
// there and carries on from where its body is (motion matching: Clavet, "Motion Matching and The Road to Next-Gen
// Animation", 2016; Holden, "Code vs Data Driven Displacement", 2021). Built once, when the first such dancer is made.
// Distances are in leg lengths (thigh + shin), so a move can be danced by a body of any size.
import { quat, vec3, type Quat, type Vec3 } from 'math';
import { MAXJ, type Rig } from '../rig';
import type { Motion } from '../clips';

/** a repertoire: the dances a dancer may draw its moves from */
export interface Style { id: string; title: string; note: string; clips: string[] }
export const STYLES: Style[] = [
  { id: 'latin', title: 'Latin', note: 'salsa and lambada', clips: ['salsa/0', 'salsa/1', 'lambada/0', 'salsa-travel/0'] },
  {
    id: 'modern', title: 'Modern', note: 'pirouettes, leaps, whirls',
    clips: ['pirouette/0', 'jete/0', 'whirl/0', 'arch/0', 'walk/0', 'tour-jete/0', 'small-jetes/0', 'side-steps/0', 'leap/0'],
  },
  {
    id: 'folk', title: 'Folk', note: 'Indian dance, Charleston, Lindy Hop, the moonwalk',
    clips: ['indian/0', 'charleston/0', 'twist/0', 'macarena/0', 'lindy/0', 'hopscotch/0', 'rain/0', 'happy/0', 'moonwalk/0'],
  },
  { id: 'free', title: 'Free', note: 'anything at all', clips: [] },
];
export const styleMask = (id: string) => {
  const k = STYLES.findIndex((s) => s.id === id);
  return k < 0 || STYLES[k].id === 'free' ? 0xffff : 1 << k;
};

/** one dancer of one piece, every frame decoded, with its path across the floor */
export interface Clip {
  key: string;
  title: string;
  /** the styles it belongs to (bits of STYLES) */
  style: number;
  skeleton: Rig;
  frames: number;
  nrot: number;
  /** per frame: root position, then each rotating joint's local rotation (x, y, z, w) */
  pose: Float32Array;
  /** per frame: the hips' path over the floor, smoothed (x, z), and which way the body faces (unwrapped) */
  path: Float32Array;
  /** thigh + shin (m) */
  leg: number;
  /** its first row in the feature table */
  row: number;
}

// the features, in groups: [first, size, weight]
const G_FEET = 0, G_FEETV = 6, G_HIPSV = 12, G_TRAJ = 15, G_DIR = 21, G_ENERGY = 27;
export const NF = 28;
const GROUPS: [number, number, number][] = [[G_FEET, 6, 0.75], [G_FEETV, 6, 0.9], [G_HIPSV, 3, 1], [G_TRAJ, 6, 1.1], [G_DIR, 6, 1.4], [G_ENERGY, 1, 1]];
/** frames ahead the trajectory looks (at 30 fps): a third of a second, two thirds, one */
export const AHEAD = [10, 20, 30];
/** a move this close to the end of its clip can't be started (it has no future to match) */
export const TAIL = 32;

// scratch (pmndrs/math, allocated once)
const _moves_pos: Vec3[] = Array.from({ length: MAXJ }, () => vec3.create());
const _moves_rot: Quat[] = Array.from({ length: MAXJ }, () => quat.create());
const _moves_local = quat.create();
const _moves_off = vec3.create();

/** forward kinematics of one decoded frame into flat world positions (MAXJ × 3) */
function fk(skel: Rig, pose: Float32Array, at: number, out: Float32Array, o: number) {
  const J = skel.joints;
  let r = 0;
  for (let k = 0; k < J.length && k < MAXJ; k++) {
    const j = J[k], p = _moves_pos[k], q = _moves_rot[k];
    if (j.rotates) quat.fromBuffer(_moves_local, pose, at + 3 + 4 * r++);
    else quat.identity(_moves_local);
    if (j.parent < 0) {
      vec3.set(p, pose[at] + j.offset[0], pose[at + 1] + j.offset[1], pose[at + 2] + j.offset[2]);
      quat.copy(q, _moves_local);
    } else {
      vec3.transformQuat(_moves_off, j.offset as unknown as Vec3, _moves_rot[j.parent]);
      vec3.add(p, _moves_pos[j.parent], _moves_off);
      quat.multiply(q, _moves_rot[j.parent], _moves_local);
    }
    out[o + k * 3] = p[0]; out[o + k * 3 + 1] = p[1]; out[o + k * 3 + 2] = p[2];
  }
}

export const legOf = (s: Rig) => {
  const len = (n: string) => Math.hypot(...s.joints.find((j) => j.name === n)!.offset);
  return len('LeftLeg') + len('LeftFoot');
};

/** the whole vocabulary: the clips, and a table of every frame's features (normalised and weighted) */
export class Moves {
  readonly clips: Clip[] = [];
  readonly rows: number;
  readonly feat: Float32Array;
  readonly rowClip: Uint8Array;
  /** which feet are planted on the floor, per row (bit 0 the left, bit 1 the right) */
  readonly contact: Uint8Array;
  readonly mean = new Float32Array(NF);
  readonly scale = new Float32Array(NF);
  /** the energy (mean joint speed, m/s in leg lengths) of the calmest and liveliest tenth of the moves */
  readonly calm: number;
  readonly lively: number;
  /** joint indices (the same in every skeleton) */
  readonly J: Record<string, number>;

  /** `travel`: the travelling dances (travel.json), when they've loaded, drawn on with the rest */
  constructor(motion: Motion, travel: Motion | null = null) {
    const names = motion.skeletons[0].joints.map((j) => j.name);
    this.J = Object.fromEntries(names.map((n, i) => [n, i]));
    const sets = travel ? [motion, travel] : [motion];
    for (const s of sets.flatMap((m) => m.skeletons)) {
      if (s.joints.some((j, i) => j.name !== names[i])) throw new Error('moves: skeletons differ in their joints');
    }
    let rows = 0;
    for (const m of sets) {
      const view = new DataView(m.bin), i16 = new Int16Array(m.bin);
      for (const piece of m.pieces) {
        piece.dancers.forEach((pd, d) => {
          const key = `${piece.id}/${d}`;
          let style = 0;
          STYLES.forEach((s, k) => { if (s.id === 'free' || s.clips.includes(key)) style |= 1 << k; });
          const skeleton = m.skeletons[pd.skeleton];
          const nrot = skeleton.joints.filter((j) => j.rotates).length;
          const W = 3 + 4 * nrot, n = piece.frames;
          const pose = new Float32Array(n * W);
          for (let f = 0; f < n; f++) {
            const o = pd.offset + f * pd.stride;
            pose[f * W] = view.getFloat32(o, true);
            pose[f * W + 1] = view.getFloat32(o + 4, true);
            pose[f * W + 2] = view.getFloat32(o + 8, true);
            const q = (o + 12) >> 1;
            for (let k = 0; k < nrot * 4; k++) pose[f * W + 3 + k] = i16[q + k] / 32767;
            // unit quaternions, in the same hemisphere as the frame before (the packer keeps them so, the int16s nearly)
            for (let r = 0; r < nrot; r++) {
              const a = f * W + 3 + r * 4;
              const l = 1 / Math.hypot(pose[a], pose[a + 1], pose[a + 2], pose[a + 3]);
              for (let k = 0; k < 4; k++) pose[a + k] *= l;
            }
          }
          this.clips.push({ key, title: piece.title, style, skeleton, frames: n, nrot, pose, path: new Float32Array(n * 3), leg: legOf(skeleton), row: rows });
          rows += n;
        });
      }
    }
    this.rows = rows;
    this.rowClip = new Uint8Array(rows);
    this.contact = new Uint8Array(rows);
    const raw = new Float32Array(rows * NF);
    const { J } = this;
    const feet = [J.LeftFoot, J.RightFoot];

    for (const [c, clip] of this.clips.entries()) {
      const n = clip.frames, W = 3 + 4 * clip.nrot, P = new Float32Array(n * MAXJ * 3);
      for (let f = 0; f < n; f++) fk(clip.skeleton, clip.pose, f * W, P, f * MAXJ * 3);
      const at = (f: number, j: number, a: number) => P[(Math.max(0, Math.min(n - 1, f)) * MAXJ + j) * 3 + a];
      // which way the body faces: across the hips and the shoulders (left is +x when facing +z), averaged over a third
      // of a second; the path: the hips over the floor, averaged over two thirds
      const fx = new Float32Array(n), fz = new Float32Array(n);
      for (let f = 0; f < n; f++) {
        const lx = at(f, J.LeftUpLeg, 0) - at(f, J.RightUpLeg, 0) + at(f, J.LeftArm, 0) - at(f, J.RightArm, 0);
        const lz = at(f, J.LeftUpLeg, 2) - at(f, J.RightUpLeg, 2) + at(f, J.LeftArm, 2) - at(f, J.RightArm, 2);
        const l = Math.hypot(lx, lz) || 1;
        fx[f] = -lz / l; fz[f] = lx / l;
      }
      let prevYaw = 0;
      for (let f = 0; f < n; f++) {
        let sx = 0, sz = 0, px = 0, pz = 0, wsum = 0;
        for (let k = -5; k <= 5; k++) { const g = Math.max(0, Math.min(n - 1, f + k)); sx += fx[g]; sz += fz[g]; }
        for (let k = -10; k <= 10; k++) {
          const w = Math.exp(-(k * k) / 40);
          px += at(f + k, 0, 0) * w; pz += at(f + k, 0, 2) * w; wsum += w;
        }
        let yaw = Math.atan2(sx, sz);
        if (f > 0) yaw = prevYaw + Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw));
        prevYaw = yaw;
        clip.path[f * 3] = px / wsum; clip.path[f * 3 + 1] = pz / wsum; clip.path[f * 3 + 2] = yaw;
      }
      // how lively: every joint's mean speed, averaged over a quarter second
      const speed = new Float32Array(n);
      for (let f = 0; f < n; f++) {
        let s = 0;
        for (let j = 0; j < clip.skeleton.joints.length; j++) {
          s += Math.hypot(at(f + 1, j, 0) - at(f - 1, j, 0), at(f + 1, j, 1) - at(f - 1, j, 1), at(f + 1, j, 2) - at(f - 1, j, 2)) * 15;
        }
        speed[f] = s / clip.skeleton.joints.length / clip.leg;
      }
      const inv = 1 / clip.leg;
      // a foot is planted when its toe or its heel is down and still (in legs: a toe within 7%, an ankle within 14% of
      // the floor, moving under 0.6 legs a second); a plant has to last a few frames
      [[J.LeftFoot, J.LeftToeBase], [J.RightFoot, J.RightToeBase]].forEach(([ankle, toe], side) => {
        const down = new Uint8Array(n);
        for (let f = 0; f < n; f++) {
          const still = (j: number) => Math.hypot(at(f + 1, j, 0) - at(f - 1, j, 0), at(f + 1, j, 2) - at(f - 1, j, 2)) * 15 * inv < 0.6;
          down[f] = (at(f, toe, 1) * inv < 0.07 && still(toe)) || (at(f, ankle, 1) * inv < 0.14 && still(ankle)) ? 1 : 0;
        }
        for (let f = 0; f < n; f++) {
          let run = 0;
          for (let g = f; g < n && down[g]; g++) run++;
          for (let g = f - 1; g >= 0 && down[g]; g--) run++;
          if (down[f] && run >= 4) this.contact[clip.row + f] |= 1 << side;
        }
      });
      for (let f = 0; f < n; f++) {
        const o = (clip.row + f) * NF;
        this.rowClip[clip.row + f] = c;
        const ox = clip.path[f * 3], oz = clip.path[f * 3 + 1], yaw = clip.path[f * 3 + 2];
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        // a world vector (x, z) in the body's frame: (left, forward)
        const lx = (x: number, z: number) => x * cs - z * sn, lz = (x: number, z: number) => x * sn + z * cs;
        feet.forEach((j, k) => {
          const x = at(f, j, 0) - ox, z = at(f, j, 2) - oz;
          raw[o + G_FEET + k * 3] = lx(x, z) * inv; raw[o + G_FEET + k * 3 + 1] = at(f, j, 1) * inv; raw[o + G_FEET + k * 3 + 2] = lz(x, z) * inv;
          const vx = (at(f + 1, j, 0) - at(f - 1, j, 0)) * 15, vy = (at(f + 1, j, 1) - at(f - 1, j, 1)) * 15, vz = (at(f + 1, j, 2) - at(f - 1, j, 2)) * 15;
          raw[o + G_FEETV + k * 3] = lx(vx, vz) * inv; raw[o + G_FEETV + k * 3 + 1] = vy * inv; raw[o + G_FEETV + k * 3 + 2] = lz(vx, vz) * inv;
        });
        const hx = (at(f + 1, 0, 0) - at(f - 1, 0, 0)) * 15, hy = (at(f + 1, 0, 1) - at(f - 1, 0, 1)) * 15, hz = (at(f + 1, 0, 2) - at(f - 1, 0, 2)) * 15;
        raw[o + G_HIPSV] = lx(hx, hz) * inv; raw[o + G_HIPSV + 1] = hy * inv; raw[o + G_HIPSV + 2] = lz(hx, hz) * inv;
        AHEAD.forEach((k, a) => {
          const g = Math.min(n - 1, f + k);
          const x = clip.path[g * 3] - ox, z = clip.path[g * 3 + 1] - oz, turn = clip.path[g * 3 + 2] - yaw;
          raw[o + G_TRAJ + a * 2] = lx(x, z) * inv; raw[o + G_TRAJ + a * 2 + 1] = lz(x, z) * inv;
          raw[o + G_DIR + a * 2] = Math.sin(turn); raw[o + G_DIR + a * 2 + 1] = Math.cos(turn);
        });
        let e = 0;
        for (let k = -4; k <= 4; k++) e += speed[Math.max(0, Math.min(n - 1, f + k))];
        raw[o + G_ENERGY] = e / 9;
      }
    }

    // normalise: each feature less its mean, over its group's spread, times the group's weight
    for (let d = 0; d < NF; d++) {
      let m = 0;
      for (let r = 0; r < rows; r++) m += raw[r * NF + d];
      this.mean[d] = m / rows;
    }
    for (const [first, size, weight] of GROUPS) {
      let sd = 0;
      for (let d = first; d < first + size; d++) {
        let v = 0;
        for (let r = 0; r < rows; r++) { const e = raw[r * NF + d] - this.mean[d]; v += e * e; }
        sd += Math.sqrt(v / rows);
      }
      sd = Math.max(sd / size, 1e-4);
      for (let d = first; d < first + size; d++) this.scale[d] = weight / sd;
    }
    this.feat = new Float32Array(rows * NF);
    for (let r = 0; r < rows; r++) for (let d = 0; d < NF; d++) this.feat[r * NF + d] = (raw[r * NF + d] - this.mean[d]) * this.scale[d];
    const energies = Array.from({ length: rows }, (_, r) => raw[r * NF + G_ENERGY]).sort((a, b) => a - b);
    this.calm = energies[Math.floor(rows * 0.1)];
    this.lively = energies[Math.floor(rows * 0.9)];
  }

  /** the row of a clip's frame */
  row(clip: number, frame: number) {
    const c = this.clips[clip];
    return c.row + Math.max(0, Math.min(c.frames - 1, Math.round(frame)));
  }

  /** normalise a raw feature into a query */
  normalise(q: Float32Array, d: number, v: number) { q[d] = (v - this.mean[d]) * this.scale[d]; }

  /**
   * the best move for a query (normalised features) among the clips in `mask`: its row, and its cost. A move from
   * the clip now playing (`clip`) is a little favoured, so a dance carries on unless something else is much better;
   * moves near ones just made (`recent` rows, each costing `recentCost` more) a little avoided, so it doesn't repeat
   * itself.
   */
  search(q: Float32Array, mask: number, clip: number, recent: Int32Array, recentCost: Float32Array, out: { row: number; cost: number }) {
    let best = Infinity, bestRow = -1;
    const F = this.feat;
    for (let c = 0; c < this.clips.length; c++) {
      const cl = this.clips[c];
      if (!(cl.style & mask)) continue;
      const bias = c === clip ? 0.92 : 1;
      const end = cl.row + cl.frames - TAIL;
      for (let r = cl.row; r < end; r++) {
        let cost = 0;
        const o = r * NF, cap = best / bias;
        for (let d = 0; d < NF; d++) { const e = F[o + d] - q[d]; cost += e * e; if (cost >= cap) break; }
        cost *= bias;
        if (cost >= best) continue;
        for (let k = 0; k < recent.length; k++) if (recent[k] >= 0 && Math.abs(r - recent[k]) < 24) cost += recentCost[k];
        if (cost < best) { best = cost; bestRow = r; }
      }
    }
    out.row = bestRow;
    out.cost = best;
    return out;
  }

  /** the cost of one row against a query */
  cost(q: Float32Array, row: number) {
    let cost = 0;
    const o = row * NF;
    for (let d = 0; d < NF; d++) { const e = this.feat[o + d] - q[d]; cost += e * e; }
    return cost;
  }

  static readonly F = { FEET: G_FEET, FEETV: G_FEETV, HIPSV: G_HIPSV, TRAJ: G_TRAJ, DIR: G_DIR, ENERGY: G_ENERGY };
}

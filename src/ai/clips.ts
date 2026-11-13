// The motion data, put to work for brains. The repo's 22 CMU clips (public/motion: 11 dances in motion.json, 11
// travelling dances in travel.json) were probed in Node (limb speed, root travel, turning, head height, foot strikes:
// see docs/reports/3-brains.md) and sorted by what each reads as:
//
//   grooves     dancing on the spot to loop under a standing body instead of the ginga, picked by the music's level
//               (lambada and the arching arms when calm, the Indian dance and salsa in the middle, the Charleston and
//               the Twist at the peak)
//   flourishes  short spectacular stretches registered as sampled moves (clipMove's adapter, here baked): two turns
//               off the side-steps, a slow arms-up turn from the whirl, leaps from the grand jeté, the breaker's floor
//               spin, the small jetés' turning dip, the tour jeté; plus the library's own pirouette
//   walks       the travelling dances: left to the motion-matching Mover (skeleton/locomotion), which the
//               IntentController already blends in at a walk
//
// Every stretch is baked once into 39-float landmark frames (30 fps) in the frame the body faced when the stretch
// began, the root under the hips, on the spot: a groove samples that table at the music's beat (looping with a
// cross-fade at the seam, at a rate that matches the clip's own step tempo to the music's, within ±15 %), a flourish
// at its progress u. Turning stretches were chosen to end within a few degrees of a whole number of turns, so the
// cross-fade back to the ginga has nothing to undo. Also here: `palmas`, a procedural clap (an NPC keeping time).
import { quat, vec3 } from 'math';
import { Track, type Motion } from '../skeleton/clips';
import { forward, Skeleton } from '../skeleton/rig';
import { landmarksFromSkeleton, newLandmarkPose } from '../skeleton/landmarks';
import { MOVES, registerMove, rig, LOCO, NP, lerpPose, type MoveInput, type RigParams } from '../dancer/moves';
import { pirouetteFlourish } from '../dancer/clip-move';

/** a stretch of a clip and what it is for */
export interface ClipDef {
  /** the name a brain asks for (a groove's id, or the move's name) */
  name: string;
  piece: string;
  /** which file it is in */
  file: 'motion' | 'travel';
  dancer?: number;
  from: number;
  to: number;
  role: 'groove' | 'flourish';
  /** how lively it is: mean limb speed in the body's own frame (m/s), from the probe */
  energy: number;
  /** the clip's own step tempo (bpm, from its foot strikes; rough), for grooves */
  bpm?: number;
  /** what it reads as */
  note: string;
}

/** the table (numbers measured by the probe in docs/reports/3-brains.md) */
export const CLIPS: readonly ClipDef[] = [
  // grooves: on the spot, under a standing body; low turn, so they loop without drifting
  { name: 'lambada', piece: 'lambada', file: 'motion', from: 0.6, to: 17.6, role: 'groove', energy: 0.37, bpm: 79 * 1.5, note: 'a soft hip sway, almost no turn: calm' },
  { name: 'arch', piece: 'arch', file: 'motion', from: 0.4, to: 3.2, role: 'groove', energy: 0.22, bpm: 102, note: 'the arms arching up and over, slow: stillness, a breakdown' },
  { name: 'macarena', piece: 'macarena', file: 'motion', from: 1.2, to: 5.0, role: 'groove', energy: 0.45, bpm: 90, note: 'arm by arm, on the spot: a party crowd, calm to medium' },
  { name: 'salsa', piece: 'salsa', file: 'motion', from: 2.0, to: 4.6, role: 'groove', energy: 0.9, bpm: 120, note: 'the lead\'s basic step: medium' },
  { name: 'indian', piece: 'indian', file: 'motion', from: 1.0, to: 12.0, role: 'groove', energy: 0.85, bpm: 118, note: 'the Indian dance on the spot, hands up and out: medium' },
  { name: 'charleston', piece: 'charleston', file: 'motion', from: 0.4, to: 3.6, role: 'groove', energy: 1.25, bpm: 91 * 1.25, note: 'kicks and swivels, no turn: lively' },
  { name: 'twist', piece: 'twist', file: 'motion', from: 0.4, to: 4.2, role: 'groove', energy: 1.95, bpm: 114, note: 'the Twist, swivelling ±60° round a steady facing: the peak' },
  // flourishes: sampled moves (spin with the stick up, the brain's flourish hint set to the name)
  { name: 'giro', piece: 'side-steps', file: 'travel', from: 1.0, to: 3.0, role: 'flourish', energy: 1.2, note: 'two quick turns out of a side step (721°)' },
  { name: 'volta', piece: 'whirl', file: 'motion', from: 2.8, to: 5.4, role: 'flourish', energy: 0.45, note: 'one slow turn with the arms up (359°): calm' },
  { name: 'saltos', piece: 'jete', file: 'motion', from: 3.3, to: 5.3, role: 'flourish', energy: 2.6, note: 'two grand jetés, danced on the spot: big' },
  { name: 'voo', piece: 'small-jetes', file: 'travel', from: 4.8, to: 7.3, role: 'flourish', energy: 1.4, note: 'arms up, a dip, two turns (715°)' },
  { name: 'tour', piece: 'tour-jete', file: 'travel', from: 1.2, to: 2.3, role: 'flourish', energy: 2.6, note: 'one turning leap' },
  { name: 'quebra', piece: 'breaking', file: 'motion', from: 2.4, to: 5.6, role: 'flourish', energy: 2.2, note: 'down to the floor and a breaker\'s spin (662°); ends low: the peak only' },
];

/** a baked stretch: frames of 39 floats (metres, the body's own frame at the stretch's start) at `fps` */
export interface Baked { frames: Float32Array; n: number; fps: number; dur: number }

const _q = quat.create(), _root = vec3.create(), _up: [number, number, number] = [0, 1, 0];

/** sample a stretch of one dancer of a piece into landmark frames (the clip adapter's sampling, done once) */
export function bake(motion: Motion, piece: string, dancer: number, from: number, to: number, fps = 30): Baked {
  const p = motion.pieces.find((x) => x.id === piece);
  if (!p) throw new Error(`bake: no piece '${piece}'`);
  const track = new Track(motion, p, dancer), sk = new Skeleton(track.rig), lm = newLandmarkPose();
  const n = Math.max(2, Math.round((to - from) * fps) + 1);
  const frames = new Float32Array(n * NP);
  let yaw0 = 0, c0 = 1, s0 = 0;
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * i) / (n - 1), s = track.sample(t), r = track.rig.joints[0];
    vec3.set(_root, s[0] + r.offset[0], s[1] + r.offset[1], s[2] + r.offset[2]);
    forward(sk, _root, quat.setAxisAngle(_q, _up, 0), s, 3);
    landmarksFromSkeleton(sk, lm);
    if (i === 0) { yaw0 = lm.yaw; c0 = Math.cos(yaw0); s0 = Math.sin(yaw0); }
    // this instant's frame → the world (about its own root) → the stretch's starting frame, on the spot
    const cy = Math.cos(lm.yaw), sy = Math.sin(lm.yaw), o = i * NP;
    for (let j = 0; j < 13; j++) {
      const lx = lm.p[3 * j], ly = lm.p[3 * j + 1], lz = lm.p[3 * j + 2];
      const wx = lx * cy + lz * sy, wz = -lx * sy + lz * cy;
      frames[o + 3 * j] = wx * c0 - wz * s0; frames[o + 3 * j + 1] = ly; frames[o + 3 * j + 2] = wx * s0 + wz * c0;
    }
  }
  return { frames, n, fps, dur: to - from };
}

/** a baked stretch at time t (s from its start, clamped), linearly between frames */
export function sampleBaked(b: Baked, t: number, out: Float32Array) {
  const x = Math.max(0, Math.min(b.n - 1.0001, t * b.fps)), i = Math.floor(x), u = x - i, a = i * NP, c = a + NP;
  for (let k = 0; k < NP; k++) out[k] = b.frames[a + k] + (b.frames[c + k] - b.frames[a + k]) * u;
  return out;
}

/** a groove: a baked stretch looped on the spot, locked to the music's beat */
export class ClipGroove {
  /** seconds of cross-fade at the loop's seam */
  seam = 0.4;
  private tmp = new Float32Array(NP);
  constructor(readonly def: ClipDef, readonly baked: Baked) {}
  /** the music's beats → the clip's time: its own step tempo matched to the music's, within ±15 % */
  clipTime(beats: number, bpm: number) {
    const own = this.def.bpm ?? bpm, rate = Math.max(0.85, Math.min(1.15, bpm / own));
    return (beats * 60 / bpm) * rate;
  }
  /** the pose at the music's beat (39 floats, metres, the body's own frame) */
  sample(beats: number, bpm: number, out: Float32Array) {
    const L = this.baked.dur - this.seam, t = this.clipTime(beats, bpm), tau = ((t % L) + L) % L;
    sampleBaked(this.baked, tau, out);
    // the first `seam` seconds fade in from the stretch's end
    if (tau < this.seam) { sampleBaked(this.baked, tau + L, this.tmp); lerpPose(out, this.tmp, out, tau / this.seam); }
    return out;
  }
}

/** the clips a scene uses, baked once */
export class ClipLibrary {
  readonly grooves = new Map<string, ClipGroove>();
  /** names of the flourish moves registered (and the pirouette) */
  readonly flourishes: string[] = [];
  constructor(motion: Motion, travel: Motion | null) {
    for (const d of CLIPS) {
      const m = d.file === 'travel' ? travel : motion;
      if (!m || !m.pieces.some((p) => p.id === d.piece)) continue;
      const b = bake(m, d.piece, d.dancer ?? 0, d.from, d.to);
      if (d.role === 'groove') this.grooves.set(d.name, new ClipGroove(d, b));
      else {
        if (!MOVES[d.name]) registerMove(flourishMove(d, b));
        this.flourishes.push(d.name);
      }
    }
    const pir = pirouetteFlourish(motion);
    if (pir) { if (!MOVES[pir.name]) registerMove(pir); this.flourishes.push(pir.name); }
    registerGestures();
  }
  /** the groove whose energy suits a music level 0 … 1 (calm → the sway, the peak → the Twist), varied by `pick` */
  grooveFor(level: number, pick = 0.5): ClipGroove | null {
    const list = [...this.grooves.values()].filter((g) => g.def.name !== 'arch');
    if (!list.length) return null;
    // the energy wanted: 0.3 m/s when calm to 1.8 at the peak; the nearest two, one chosen by `pick`
    const want = 0.3 + 1.5 * Math.max(0, Math.min(1, level));
    list.sort((a, b) => Math.abs(a.def.energy - want) - Math.abs(b.def.energy - want));
    return list[pick < 0.65 || list.length < 2 ? 0 : 1];
  }
  /** a flourish that suits the level (the floor spin only at the peak) */
  flourishFor(level: number, pick: number): string | null {
    const ok = this.flourishes.filter((n) => {
      const d = CLIPS.find((c) => c.name === n);
      if (!d) return true;   // the pirouette
      if (n === 'quebra') return level > 0.8;
      return level < 0.4 ? d.energy < 1.5 : true;
    });
    return ok.length ? ok[Math.min(ok.length - 1, Math.floor(pick * ok.length))] : null;
  }
}

/** a flourish move from a baked stretch: sampled, on the spot, cancellable into a dodge or a jump once it's mostly
 *  done, open hands */
function flourishMove(d: ClipDef, b: Baked): MoveInput {
  return {
    name: d.name, dur: b.dur,
    cancelInto: ['jump', 'esquiva', 'au', 'role'],
    aimW: 0,
    style: () => ({ hands: ['open', 'open'], feet: ['auto', 'auto'] }),
    sample: (u, out) => { sampleBaked(b, u * b.dur, out); },
  };
}

// ---------------------------------------------------------------- gestures
/** where in `palmas` the hands meet (its progress u) */
export const PALMAS_MEET = 0.5;
/** `palmas`: the roda's clap, big enough to read from the camera's game distance: the arms swing open wide and low,
 *  then in and up so the hands meet in front of the face (at u PALMAS_MEET: pressed that much before the beat), with
 *  a dip of the knees on the clap; half a second long, so a clap on every beat never stops moving */
export function registerGestures() {
  if (MOVES.palmas) return;
  const base: RigParams = { hip: [0, 0.3, 0], pitch: 0.08, lf: [-0.14, 0, 0], rf: [0.14, 0, 0] };
  const M = PALMAS_MEET;
  registerMove({
    name: 'palmas', dur: 0.5, cancelInto: ['*'], aimW: 0,
    style: () => ({ hands: ['open', 'open'] }),
    pose(u, ctx, out) {
      // in: open wide and low → together at the face; then open again
      const a = u < M ? 1 - u / M : (u - M) / (1 - M), e = a * a * (3 - 2 * a);
      const meet = 0.012 + 0.26 * e, y = 0.57 - 0.13 * e, fwd = 0.2 - 0.07 * e;
      const dip = Math.max(0, 1 - Math.abs(u - M) / 0.25);
      rig({ ...base, hip: [0, 0.3 - 0.025 * dip, 0], pitch: 0.08 + 0.06 * dip, lh: [-meet, y, fwd], rh: [meet, y, fwd], lep: [-0.7, -0.4, -0.2], rep: [0.7, -0.4, -0.2] }, out);
      void ctx;
      return out;
    },
  });
}

/** the ginga's idle at `groove`, lowered toward the cocorinha by `low` (Angola's ginga baixa: a third of the way at
 *  most, so the feet still step back on the beat), blended toward a groove clip by w (what a brain's body hints
 *  become) */
export function idlePose(out: Float32Array, beats: number, bpm: number, groove: number, clip: ClipGroove | null, w: number, tmp: Float32Array, low = 0) {
  LOCO.ginga(out, beats, groove);
  if (low > 1e-3) { LOCO.crouch(tmp, beats); lerpPose(out, out, tmp, 0.35 * Math.min(1, low)); }
  if (clip && w > 1e-3) { clip.sample(beats, bpm, tmp); lerpPose(out, out, tmp, Math.min(1, w)); }
  return out;
}

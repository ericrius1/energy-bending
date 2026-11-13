// The body plays (the prototype's conductor, on 3D skeletons). For every dancer the game marks as a player, the
// bending hand (the one that has been moving more lately, unless told which) plays the melody: how high it is picks
// the note from the mood's pentatonic pool, how far it has travelled since its last note decides whether this 16th
// gets one (an 8th when it drifts, every 16th when it flies), and a sharp flick (its speed peaking and dropping
// away) strikes a note at once, louder. On a beat the note snaps to the chord; a note repeated within an 8th turns
// into a trill. The player's whole body sets the groove's intensity (hands, hips, head and feet; stillness lets go
// fast, so a held pose becomes a breakdown in a few seconds), raised arms open the sound, a hip sway colours the bass.
//
// Distances are metres and speeds m/s (the prototype's units were half the screen's height, about 2 m, so its
// thresholds are doubled here). Joint speeds come from the skeleton's GPU layout (`world[j * 12 + 3]`).
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import type { Performer } from './engine';
import type { Harmony } from './harmony';
import type { Instrument } from './instrument';
import type { MusicClock } from './clock';
import { panOf, distOf, type Listener } from './spatial';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** prototype units per metre */
const U = 0.5;

export interface MelodyParams {
  /** which hand plays: the one moving more ('auto'), one side, or both (each in its own register and voice) */
  hand: 'auto' | 'left' | 'right' | 'both';
  /** voices for the left and right hand (instrument.voice palettes: 1 kalimba, 0 pluck …) */
  palettes: [number, number];
  gain: number;
}

interface HandState { travel: number; peak: number; strike: number; lastIdx: number; lastRel: number; trill: boolean; busy: number }
interface PlayerState { id: string; world: Float32Array; floor: number; head: number; energy: number; lift: number; sway: number; slowX: number; slowZ: number; hands: [HandState, HandState]; bending: 0 | 1 }

const HANDS = [JOINT.LeftHand, JOINT.RightHand] as const;

export class Conductor implements Performer {
  readonly params: MelodyParams = { hand: 'auto', palettes: [1, 0], gain: 1 };
  private players = new Map<string, PlayerState>();
  /** the most any player is dancing (0 … 1.2), and how raised and swaying their arms and hips are */
  energy = 0;
  lift = 0;
  sway = 0;
  /** notes played (the measurements read it) */
  notes = 0;

  constructor(public out: Instrument, private h: Harmony, private clock: MusicClock, public listener: Listener) {}

  /** each frame: the players' skeletons (world layout), their floor; `now` for the hands' breath */
  update(now: number, dt: number, players: readonly { id: string; world: Float32Array }[], floorY = 0) {
    const seen = new Set<string>();
    let energy = 0, lift = 0, sway = 0;
    for (const p of players) {
      seen.add(p.id);
      let s = this.players.get(p.id);
      if (!s) {
        s = { id: p.id, world: p.world, floor: floorY, head: 1.6, energy: 0, lift: 0, sway: 0, slowX: p.world[0], slowZ: p.world[2],
          hands: [0, 1].map(() => ({ travel: 0, peak: 0, strike: 0, lastIdx: -1, lastRel: -99, trill: false, busy: 0 })) as [HandState, HandState], bending: 1 };
        this.players.set(p.id, s);
      }
      s.world = p.world; s.floor = floorY;
      this.updatePlayer(s, now, dt);
      energy = Math.max(energy, s.energy); lift = Math.max(lift, s.lift);
      if (Math.abs(s.sway) > Math.abs(sway)) sway = s.sway;
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
    this.energy = energy; this.lift = lift; this.sway = sway;
    if (!players.length) for (let i = 0; i < 2; i++) this.out.hand(now, i, 0, 0);
  }

  private updatePlayer(s: PlayerState, now: number, dt: number) {
    const w = s.world, sp = (j: number) => w[j * JOINT_FLOATS + 3], y = (j: number) => w[j * JOINT_FLOATS + 1];
    s.head += (y(JOINT.Head) - s.floor - s.head) * (1 - Math.exp(-dt / 3));
    // hands: how far each has travelled, and a flick (a speed peak falling away) strikes a note
    for (let k = 0; k < 2; k++) {
      const hs = s.hands[k], v = sp(HANDS[k]);
      if (v > 0.36) hs.travel += v * dt; else hs.travel *= Math.exp(-dt * 0.8);
      hs.busy += (v - hs.busy) * (1 - Math.exp(-dt / 0.6));
      if (v > hs.peak) hs.peak = v;
      else if (hs.peak > 4 && v < hs.peak * 0.5) { hs.strike = Math.max(hs.strike, clamp(0.6 + (hs.peak - 4) * 0.06, 0.6, 1)); hs.peak = v; }
      else if (v < 1.2) hs.peak = v;
    }
    // the bending hand: the busier, with a margin so it doesn't flicker between them
    const [l, r] = s.hands;
    if (s.bending === 1 && l.busy > r.busy * 1.25) s.bending = 0;
    else if (s.bending === 0 && r.busy > l.busy * 1.25) s.bending = 1;
    // energy, from the whole body
    const dz = (v: number) => Math.max(0, Math.min(v * U, 4) - 0.12);
    const hips = sp(JOINT.Hips);
    let raw = 0.15 * (dz(sp(JOINT.LeftHand)) + dz(sp(JOINT.RightHand))) + 0.6 * dz(hips) + 0.08 * dz(sp(JOINT.Head))
      + 0.12 * (dz(sp(JOINT.LeftToeBase)) + dz(sp(JOINT.RightToeBase)));
    raw = clamp(raw, 0, 1.2);
    const tau = raw > s.energy ? 0.3 : raw < 0.03 ? 0.9 : 2.2;
    s.energy += (raw - s.energy) * (1 - Math.exp(-dt / tau));
    // arms up opens the sound; the hips swaying from their slow place colours the bass
    const shY = (y(JOINT.LeftShoulder) + y(JOINT.RightShoulder)) / 2, wy = (y(JOINT.LeftHand) + y(JOINT.RightHand)) / 2;
    const lift = clamp((wy - (shY - 0.24)) / 0.6, 0, 1);
    s.lift += (lift - s.lift) * (1 - Math.exp(-dt * 5));
    s.slowX += (w[0] - s.slowX) * (1 - Math.exp(-dt / 3));
    s.slowZ += (w[2] - s.slowZ) * (1 - Math.exp(-dt / 3));
    const rt = this.listener.right;
    const sway = clamp(((w[0] - s.slowX) * rt[0] + (w[2] - s.slowZ) * rt[2]) / 0.2, -1, 1);
    s.sway += (sway - s.sway) * (1 - Math.exp(-dt * 6));
    // a breath of air for each moving hand
    for (let k = 0; k < 2; k++) {
      const j = HANDS[k] * JOINT_FLOATS;
      this.out.hand(now, k, clamp(sp(HANDS[k]) / 7, 0, 1) * 0.8, panOf(this.listener, w[j], w[j + 1], w[j + 2]));
    }
  }

  /** which hands play for a player */
  private playing(s: PlayerState): number[] {
    const h = this.params.hand;
    return h === 'both' ? [0, 1] : h === 'left' ? [0] : h === 'right' ? [1] : [s.bending];
  }

  /** every 16th: each playing hand, if it has earned a note */
  onStep(rel: number, s16: number, t: number) {
    const H = this.h, pool = H.pool;
    for (const s of this.players.values()) {
      const w = s.world;
      for (const k of this.playing(s)) {
        const hs = s.hands[k], j = HANDS[k] * JOINT_FLOATS, v = w[j + 3];
        const eighth = s16 % 2 === 0;
        let vel = 0;
        if (hs.strike > 0) { vel = hs.strike; hs.strike = 0; }
        else if (hs.travel > (eighth ? 0.22 : 0.34) && (eighth || v > 2.6)) vel = 0.42 + 0.4 * Math.min(1, v / 5.6);
        if (!vel) continue;
        hs.travel = 0;
        // its height on the body: hip height is low in the range, well over the head the top
        const norm = (w[j + 1] - s.floor - 0.15 * s.head) / (1.05 * s.head);
        let idx = H.poolIndexFor(norm, k === 0 ? 1 : 5, k === 0 ? 9 : 11);
        if (s16 % 4 === 0) idx = H.snapToChord(idx, t);
        if (idx === hs.lastIdx && rel - hs.lastRel <= 2) {
          hs.trill = !hs.trill;
          idx = clamp(idx + (hs.trill ? 1 : -1), 0, pool.length - 1);
        } else hs.lastIdx = idx;
        hs.lastRel = rel;
        const sd = this.clock.stepDur, dur = v > 2.6 ? sd * 0.9 : sd * 2.6;
        const x = w[j], y = w[j + 1], z = w[j + 2];
        this.out.voice(t, this.params.palettes[k], pool[idx], vel * this.params.gain, dur, panOf(this.listener, x, y, z) * 0.8, distOf(this.listener, x, y, z));
        this.notes++;
      }
    }
  }
}

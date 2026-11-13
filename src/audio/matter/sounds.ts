// How matter is heard: the contract between a matter kind and the music. A kind that wants to be heard gives its
// MatterPasses a `hear(ears)` method; the music calls it once, after the kinds are declared, handing it `ears`. From
// then on the kind tells the ears what happens, whenever it learns of it (each frame, or when a GPU readback lands):
//
//   ears.event({ kind: 'water', type: 'splash', x, y, z, strength: 0.7 })        a one-off sound
//   ears.hold({ kind: 'fire', type: 'roar', key: 'dancer0', x, y, z, amount: 0.8, speed: 3.1 })   a held sound
//
// A held sound lasts while it is restated every frame (stop restating it and it fades out in a quarter second). The
// ears place each sound (pan and distance from the camera), pick its note from the chord sounding then if the voice is
// pitched, and put it on the grid when the groove is running. Which types each kind has, and how each one sounds, are
// in this folder's other files (fire.ts, water.ts, ice.ts, plasma.ts, steam.ts), one per kind, registered in
// `matterVoices`; docs/extending/sound.md says how to add one. The gems are the one batch case: their GPU events
// (thousands a second) go to the score's own budgeted path (score.ts `stones`), which this interface also describes.
import { Registry } from '../../engine/registry';
import type { Nodes } from '../synth/nodes';
import type { Mix } from '../synth/mix';
import type { Harmony } from '../harmony';
import type { MatterPlay, HoldPlay } from '../instrument';

/** a one-off sound from matter: what kind, what happened, where (world metres), how hard (0 … 1, more is allowed) */
export interface MatterSound {
  kind: string;
  type: string;
  x: number; y: number; z: number;
  strength: number;
  /** when it happened (the music's clock, s); now if left out */
  when?: number;
  /** anything else the voice reads (an arc's length in metres, a splash's mass) */
  extra?: number;
}

/** a held sound, restated each frame while it lasts: `key` tells one source from another (a dancer, a stream) */
export interface MatterHold {
  kind: string;
  type: string;
  key: string;
  x: number; y: number; z: number;
  /** how much of it there is (0 … 1): flame amount, flow, charge */
  amount: number;
  /** how fast it moves (m/s): a limb's speed through the fire, the pour's rate */
  speed: number;
}

/** what a kind is handed */
export interface MatterEars {
  event(e: MatterSound): void;
  hold(h: MatterHold): void;
  /** the music's clock now (s): stamp an event read back late with the time it happened, if known */
  now(): number;
}

/** what a matter kind implements to be heard (an optional method on its MatterPasses) */
export interface Voiced { hear(ears: MatterEars): void }
export const isVoiced = (k: object): k is Voiced => typeof (k as Partial<Voiced>).hear === 'function';

/** a one-off sound's recipe: its note, if it has one, whether it goes on the grid, and how to play it */
export interface EventVoice {
  /** the note (midi) from the chord at time t; leave out for an unpitched sound */
  note?(h: Harmony, t: number, seed: number, e: MatterSound): number;
  /** put it on the grid when the groove runs (pitched sounds usually; a crackle should stay free) */
  grid?: boolean;
  play(n: Nodes, m: Mix, t: number, p: MatterPlay): void;
}

/** a held sound's recipe: built once per key, then set every frame */
export interface HoldVoice {
  note?(h: Harmony, t: number): number;
  make(n: Nodes, m: Mix): { set(t: number, p: HoldPlay): void };
}

/** a kind's voice: its sounds by type */
export interface MatterVoice {
  /** the matter kind's id */
  id: string;
  events: Record<string, EventVoice>;
  holds?: Record<string, HoldVoice>;
}

export const matterVoices = new Registry<MatterVoice>('matter voice');

/** a 0 … 1 hash of a place (so the same splash has the same variation every time it is replayed) */
export const seedOf = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 4.1414 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** the shared parts of a held voice: a level, a distance filter and a panner, all moved smoothly */
export function holdOut(n: Nodes, m: Mix, rev = 0.25) {
  const g = n.gn(0), lp = n.bq('lowpass', 20000, 0.5), p = n.pan(0), send = n.gn(rev);
  n.link(g, lp, p, m.world);
  n.link(p, send, m.revIn);
  return {
    input: g,
    place(t: number, level: number, pan: number, dist: number) {
      const d = Math.max(0, Math.min(1, dist));
      g.gain.setTargetAtTime(level * (1 - 0.5 * d), t, 0.06);
      lp.frequency.setTargetAtTime(20000 * Math.pow(0.12, d), t, 0.1);
      p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.06);
      send.gain.setTargetAtTime(rev + 0.35 * d, t, 0.2);
    },
  };
}

/** the shared way out of a one-off voice: distance, pan, the room (into the world's bus) */
export const eventOut = (_n: Nodes, m: Mix, src: AudioNode, p: MatterPlay, rev = 0.25) => m.route(src, m.world, p.pan, rev, 0, p.dist);

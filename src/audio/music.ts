// The sound of the show: the live instrument (sound.ts, made at the first touch, as browsers ask), or for a film a
// Recorder that writes the score down to be rendered offline after the last frame; the score (score.ts) that the
// bodies and the stones play on it; and the place it is heard in (each world's tone and, in the redwoods, the wood's
// own sounds). Muting, volume and the audio clock are here.
import { Sound, Recorder, type Sink } from './sound';
import { Score, earsOf, type Ears } from './score';
import type { World } from '../worlds/world';
import type { Dancer } from '../dancer/dancer';
import { defineParams, onParams } from '../engine/params';

export const audioParams = defineParams('audio', { volume: 0.9, muted: false }, { volume: { min: 0, max: 1.5 }, muted: {} });

const silent: Sink = { strike() {}, chord() {}, energy() {}, whoosh() {}, drone() {}, boom() {}, ambience() {} };

export class Music {
  readonly score: Score;
  readonly recorder = new Recorder();
  sound: Sound | null = null;
  /** the film's clock (s), when filming: the score is written against it */
  filmClock = 0;
  private lastAmbience = -1;
  private ears: Ears[] = [];
  private heard: { world: Float32Array; ears: Ears }[] = [];
  private _h = { energy: 0, sweep: 0, charge: 0 };

  constructor(private film: boolean, private world: () => World, stones: string[]) {
    this.score = new Score(film ? this.recorder : silent);
    this.score.setStones(stones);
    this.recorder.tone = world().tone();
    onParams(audioParams, () => { if (this.sound) this.sound.volume = audioParams.muted ? 0 : audioParams.volume; });
  }

  /** when a sound made now should play (the audio clock, or the film's) */
  now() { return this.film ? this.filmClock : this.sound ? this.sound.time + 0.02 : 0; }

  /** the first touch: make the instrument (never while filming: the film renders its score offline) */
  start(key: number) {
    if (this.sound || this.film) return;
    // iOS: play through the ring/silent switch, like any music app
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.sound = new Sound(ctx, this.world().tone());
    this.sound.volume = audioParams.muted ? 0 : audioParams.volume;
    this.score.out = this.sound;
    this.score.setKey(this.now(), key);
    void ctx.resume();
  }

  /** the place changed: how it sounds */
  retone() {
    const t = this.world().tone();
    this.sound?.setTone(t);
    this.recorder.tone = t;
  }

  /** the cast changed: which joints of each skeleton make sound */
  hear(dancers: readonly Dancer[]) { this.ears = dancers.map((d) => earsOf(d.rig.joints.map((j) => j.name))); }

  /** each frame: the wood's sounds a few times a second, then the score hears the bodies and the hand */
  frame(dt: number, dancers: readonly Dancer[], awake: boolean, hand: { sweep: number; charge: number }) {
    const now = this.now();
    if ((this.sound || this.film) && now - this.lastAmbience >= 0.25) {
      this.lastAmbience = now;
      // (a world with no wood of its own still gets the call: it turns the wood's sounds down)
      const a = this.world().ambience() ?? [0, 0, 0, 0];
      this.score.out.ambience(now, a[0], a[1], a[2], a[3]);
    }
    if (!awake) return;
    let speed = 0;
    const D = dancers.length;
    this.heard.length = D;
    for (let d = 0; d < D; d++) {
      const w = dancers[d].skeleton.world, n = dancers[d].skeleton.count;
      for (let j = 0; j < n; j++) speed += w[j * 12 + 3] / (D * 40);
      this.heard[d] = { world: w, ears: this.ears[d] ?? earsOf(dancers[d].rig.joints.map((j) => j.name)) };
    }
    const h = this._h;
    h.energy = Math.max(0, Math.min(1, (speed - 0.25) / 1.3));
    h.sweep = hand.sweep;
    h.charge = hand.charge;
    this.score.frame(now, dt, h, this.heard, 0);
  }
}

// The music's clock: where the music is, in beats, and its tempo. Everything that should land on the beat reads
// FrameCtx.beat, which this fills. For now it is a plain local clock (it starts at 0 and runs at `bpm`); the music
// engine (wave 1, from the 2D prototype's js/audio.js) and the network's shared clock will drive it through the same
// three calls the prototype has: syncTo (jump to a beat at a time), beatInfo, beatError.

export class BeatClock {
  bpm = 112;
  private beat0 = 0;
  private t0 = 0;
  /** what FrameCtx.beat holds (refilled in place each frame) */
  readonly info = { beats: 0, bpm: this.bpm };

  /** the beat at clock time t (s) */
  beatAt(t: number) { return this.beat0 + ((t - this.t0) * this.bpm) / 60; }

  /** from now on, beat `beat` falls at time `t` (and the tempo is `bpm`) */
  syncTo(beat: number, t: number, bpm = this.bpm) { this.beat0 = beat; this.t0 = t; this.bpm = bpm; }

  /** where we are at time t: the beat (fractional), the bar (4 beats), the phase in the beat */
  beatInfo(t: number) {
    const b = this.beatAt(t);
    return { beat: b, bar: Math.floor(b / 4), phase: b - Math.floor(b) };
  }

  /** how far t is from the nearest beat, in seconds (negative: early) */
  beatError(t: number) {
    const b = this.beatAt(t), d = b - Math.round(b);
    return (d * 60) / this.bpm;
  }

  /** each frame */
  update(t: number) { this.info.beats = this.beatAt(t); this.info.bpm = this.bpm; return this.info; }
}

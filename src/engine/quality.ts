// Frame pacing, independent of GPU timestamps (unavailable or unreliable on many phones). The controller never
// caps the refresh rate or changes the render size. Owners read these multipliers when preparing their frame.
export const QUALITY = [
  { air: 1, reflections: 1, particles: 1 },
  { air: 0.75, reflections: 0.8, particles: 1 },
  { air: 0.6, reflections: 0.65, particles: 0.85 },
  { air: 0.4, reflections: 0.5, particles: 0.65 },
] as const;

export class FrameQuality {
  level = 0;
  meanMs = 0;
  p90Ms = 0;
  private elapsed = 0;
  private samples: number[] = [];
  private bad = 0;
  private good = 0;
  private settling = 12;
  /** frame times (ms) past which a stretch of frames is slow (mean, p90) and under which it has room (mean, p90). The
   *  defaults are the phone's at 30 fps, tuned on an iPhone 16e; `target` sets them for another rate */
  private limits = { badMean: 34.5, badP90: 42, goodMean: 24, goodP90: 28 };

  get value() { return QUALITY[this.level]; }

  /** hold the frames to `fps` (the device class's targetFps). At 30 the phone's own numbers; faster, numbers relative to
   *  the frame interval: slow past a fifth over it on average (or half over it for a tenth of the frames), with room
   *  when the frames keep to it, so a 60 Hz screen at 60 fps counts as room and steps back up */
  target(fps: number) {
    if (fps <= 30) return;
    const T = 1000 / fps;
    this.limits = { badMean: T * 1.2, badP90: T * 1.5, goodMean: T * 1.06, goodP90: T * 1.2 };
  }

  /** Seconds of *wall* time between animation frames, before the simulation clamps dt. Ignore pauses and reset
   *  the evidence on visibility changes; neither a background tab nor one startup hitch is a slow GPU. */
  step(dt: number, visible = true) {
    if (!visible || !Number.isFinite(dt) || dt <= 0 || dt >= 1) {
      this.elapsed = this.bad = this.good = 0;
      this.samples.length = 0;
      this.settling = Math.max(this.settling, 3);
      return this.level;
    }
    if (this.settling > 0) { this.settling -= dt; return this.level; }
    this.samples.push(dt * 1000);
    this.elapsed += dt;
    if (this.elapsed < 2) return this.level;
    this.meanMs = this.elapsed * 1000 / this.samples.length;
    this.samples.sort((a, b) => a - b);
    this.p90Ms = this.samples[Math.floor((this.samples.length - 1) * 0.9)];
    const L = this.limits;
    this.bad = this.meanMs > L.badMean || this.p90Ms > L.badP90 ? this.bad + this.elapsed : 0;
    this.good = this.meanMs < L.goodMean && this.p90Ms < L.goodP90 ? this.good + this.elapsed : 0;
    const next = this.bad >= 4 ? Math.min(QUALITY.length - 1, this.level + 1)
      : this.good >= 20 ? Math.max(0, this.level - 1) : this.level;
    if (next !== this.level) { this.level = next; this.bad = this.good = 0; this.settling = 4; }
    this.elapsed = 0;
    this.samples.length = 0;
    return this.level;
  }
}

export const frameQuality = new FrameQuality();
export const quality = () => frameQuality.value;

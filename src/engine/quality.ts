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

  get value() { return QUALITY[this.level]; }

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
    this.bad = this.meanMs > 34.5 || this.p90Ms > 42 ? this.bad + this.elapsed : 0;
    this.good = this.meanMs < 24 && this.p90Ms < 28 ? this.good + this.elapsed : 0;
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

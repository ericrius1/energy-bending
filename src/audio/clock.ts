// The music's clock: the one owner of time. A grid of 16th notes ("steps") with a tempo and a swing, either running
// free (it starts where it is told and the tempo glides toward a target) or following a shared clock (a server says
// step 0 is heard at `epoch`; the grid is slewed toward it a couple of milliseconds a step, never jumped while it is
// close). Everything that should land on the beat asks it: FrameCtx.beat (what the dancers, matter and worlds read),
// the scheduler (engine.ts), the quantiser that puts stones on the grid, and the beat-error that judges a move.
//
// It is pure logic: no AudioContext, no timers. Times are in seconds on whatever clock the caller runs on (the
// AudioContext's currentTime live, the film's clock when filming); the shared clock's offset is measured by the caller
// and handed in. The prototype's js/audio.js kept this inside its Music class; it is the same arithmetic, split out so
// it can be tested against a fake clock (test/clock.test.ts).

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** the most the grid moves toward the shared clock per step while synced (s): 2 ms is inaudible as a tempo wobble */
export const SLEW = 0.002;

/** where the grid is at a time (BeatInfo in the prototype) */
export interface BeatInfo {
  /** the absolute step (16th) at or before `now`, and its place in the bar */
  step: number;
  s16: number;
  bar: number;
  stepDur: number;
  /** when the next 16th (swung, as it sounds), the next quarter and the next bar line fall */
  nextStepTime: number;
  nextBeatTime: number;
  nextBarTime: number;
  now: number;
  synced: boolean;
}

/** what the scheduler is handed for each step it must play */
export interface StepHost {
  /** play step `rel` (steps since the origin) at time t (swung) */
  step(rel: number, t: number): void;
  /** the grid jumped (a new shared clock): rel numbers moved by d; shift anything counted in them */
  jump?(d: number, cur: number): void;
}

export interface Sync { epoch: number; bpm: number }

export class MusicClock {
  bpm: number;
  /** the tempo the free clock glides toward (6 % of the gap a step) */
  targetBpm: number;
  /** the delay of every odd 16th, as a fraction of a step */
  swing = 0.1;
  /** the next step to schedule (absolute) */
  step = 0;
  /** the step that counts as bar 0, beat 0 */
  origin = 0;
  /** the unswung time of `step` */
  gridTime = 0;
  /** what FrameCtx.beat holds (refilled in place by update) */
  readonly info = { beats: 0, bpm: 0 };
  /** the shared clock, while following one: step n is heard at server time epoch + n × stepDur (ms) */
  sync: Sync | null = null;
  /** the applied offset (server s − local s), slewed toward the filtered measurement */
  syncOff: number | null = null;
  private syncFilt: number | null = null;
  /** the last step's time handed to the host (a jump never schedules before it) */
  private lastSchedT = -Infinity;
  jumps = 0;

  constructor(bpm = 112, at = 0) {
    this.bpm = this.targetBpm = bpm;
    this.gridTime = at;
    this.info.bpm = bpm;
  }

  get stepDur() { return 60 / this.bpm / 4; }
  get synced() { return !!(this.sync && this.syncOff != null); }

  // ---------------------------------------------------------------- reading the grid
  /** the unswung time of absolute step k */
  stepTime(k: number) { return this.synced ? this.tOf(k) : this.gridTime + (k - this.step) * this.stepDur; }
  /** the time step k sounds at (odd 16ths late by the swing) */
  swungTime(k: number) { return this.stepTime(k) + ((((k - this.origin) & 1) === 1) ? this.swing * this.stepDur : 0); }

  /** beats since the origin at time t (fractional, unswung): what the dancers and the light lean on */
  beatAt(t: number) {
    const steps = (this.step - this.origin) - (this.stepTime(this.step) - t) / this.stepDur;
    return steps / 4;
  }

  /** each frame: FrameCtx.beat at time t */
  update(t: number) { this.info.beats = this.beatAt(t); this.info.bpm = this.bpm; return this.info; }

  /** signed ms from t to the nearest grid line (positive: late). grid 1 = 16ths, 2 = 8ths, 4 = beats. Odd 16ths are
   *  swung exactly as the scheduler plays them, because that is where they are heard */
  beatError(t: number, grid = 1) {
    const sd = this.stepDur;
    grid = Math.max(1, Math.round(grid));
    const k0 = this.step + Math.floor((t - this.stepTime(this.step)) / sd);
    let best = Infinity;
    for (let k = k0 - grid; k <= k0 + grid + 1; k++) {
      if (grid > 1 && ((((k - this.origin) % grid) + grid) % grid) !== 0) continue;
      const e = t - this.swungTime(k);
      if (Math.abs(e) < Math.abs(best)) best = e;
    }
    return best * 1000;
  }

  /** the grid position at time t */
  beatInfo(t: number): BeatInfo {
    const sd = this.stepDur;
    let cur = this.step + Math.floor((t - this.stepTime(this.step)) / sd);
    if (this.swungTime(cur) > t) cur--;
    const rel = cur - this.origin;
    let b = cur + 1; while ((((b - this.origin) % 4) + 4) % 4) b++;
    let B = cur + 1; while ((((B - this.origin) % 16) + 16) % 16) B++;
    return {
      step: cur, s16: ((rel % 16) + 16) % 16, bar: Math.floor(rel / 16), stepDur: sd,
      nextStepTime: this.swungTime(cur + 1), nextBeatTime: this.stepTime(b), nextBarTime: this.stepTime(B),
      now: t, synced: this.synced,
    };
  }

  /** the grid line (swung, every `grid` steps) nearest to t, and the gap to it (s, positive: the line is later) */
  nearest(t: number, grid = 1) {
    const sd = this.stepDur;
    const k0 = this.step + Math.floor((t - this.stepTime(this.step)) / sd);
    let best = t, gap = Infinity;
    for (let k = k0 - grid - 1; k <= k0 + grid + 1; k++) {
      if (grid > 1 && ((((k - this.origin) % grid) + grid) % grid) !== 0) continue;
      const g = this.swungTime(k);
      if (Math.abs(g - t) < Math.abs(gap)) { gap = g - t; best = g; }
    }
    return { t: best, gap };
  }

  /** put an event that happened at t on the grid, if it is close: to the next line when that is at most `ahead` s
   *  away, to "now" when the last line passed at most `behind` s ago (it already sounds on the beat); otherwise free.
   *  Live, nothing can be played in the past, so the window looks forward; `behind` is the lateness the ear forgives */
  quantise(t: number, ahead: number, behind = 0.012, grid = 1): { t: number; snapped: boolean } {
    const sd = this.stepDur * grid;
    const k0 = this.step + Math.floor((t - this.stepTime(this.step)) / this.stepDur) - grid - 1;
    let prev = -Infinity, next = Infinity;
    for (let k = k0; k <= k0 + 2 * grid + 3; k++) {
      if (grid > 1 && ((((k - this.origin) % grid) + grid) % grid) !== 0) continue;
      const g = this.swungTime(k);
      if (g <= t) prev = Math.max(prev, g); else next = Math.min(next, g);
    }
    if (t - prev <= behind) return { t, snapped: true };
    if (next - t <= ahead && next - t < sd) return { t: next, snapped: true };
    return { t, snapped: false };
  }

  /** the nearest grid time that is still playable after `now` (the prototype's quantTime, for stomps and glisses) */
  quantTime(now: number, grid = 1, tol = 0.035) {
    const base = this.stepDur * grid;
    let g0 = this.gridTime;
    if (grid > 1) { const rel = this.step - this.origin; const off = ((rel % grid) + grid) % grid; g0 = this.gridTime + (off ? (grid - off) * this.stepDur : 0); }
    const n = Math.floor((g0 - (now - tol)) / base);
    return Math.max(g0 - n * base, now + 0.004);
  }

  /** gently pull the free grid toward a body event (the bottom of a bounce), at most 12 ms */
  nudgeTo(tEvent: number) {
    if (this.sync) return;
    const beat = this.stepDur * 4;
    const rel = this.step - this.origin;
    const off = ((rel % 4) + 4) % 4;
    const nextBeat = this.gridTime + (off ? (4 - off) * this.stepDur : 0);
    let err = (tEvent - nextBeat) % beat;
    if (err > beat / 2) err -= beat;
    if (err < -beat / 2) err += beat;
    this.gridTime += clamp(err * 0.12, -0.012, 0.012);
  }

  /** the free grid placed so that it is `beats` (since the origin) at time t, keeping the tempo; the next step to
   *  schedule is the first at or after `from` (a track starting under the first touch; a film's shot put on its
   *  film's grid). Step numbers stay where they were: only the origin and the grid's time move */
  anchor(t: number, beats = 0, from = t) {
    if (this.sync) return;
    const sd = this.stepDur;
    const k = Math.ceil(beats * 4 + (from - t) / sd - 1e-9);
    this.origin = this.step - k;
    this.gridTime = t + (k - beats * 4) * sd;
  }

  /** the time base under the clock moved (live: the AudioContext started after a while on the page's clock) */
  rebase(dt: number) { this.gridTime += dt; this.lastSchedT += dt; }

  // ---------------------------------------------------------------- the shared clock
  /** follow a shared clock. A new epoch or tempo re-phases (a jump at the next advance); the same one only refreshes */
  syncTo(s: Sync) {
    const bpm = clamp(+s.bpm || this.bpm, 40, 240);
    const prev = this.sync;
    this.sync = { epoch: +s.epoch, bpm };
    if (!prev || prev.epoch !== this.sync.epoch || prev.bpm !== bpm) this.syncOff = null;
    this.bpm = this.targetBpm = bpm;
  }

  unsync() {
    if (!this.sync) return;
    this.sync = null; this.syncOff = null; this.syncFilt = null;
    this.targetBpm = this.bpm;
  }

  /** a measurement of the shared clock: `server` (s) is what it read when `heard` (s, local) was being heard; `dt` the
   *  time since the last one. Small differences are filtered (0.3 s), big ones (over 0.25 s) taken at once */
  measure(server: number, heard: number, dt: number) {
    const raw = server - heard;
    if (this.syncFilt == null || Math.abs(raw - this.syncFilt) > 0.25) this.syncFilt = raw;
    else this.syncFilt += (raw - this.syncFilt) * (1 - Math.exp(-dt / 0.3));
  }

  /** the local time step k must be scheduled at to be heard with everyone else's */
  private tOf(k: number) { const S = this.sync!; return (S.epoch + (k * 60000) / (S.bpm * 4)) / 1000 - this.syncOff!; }
  serverTimeOfStep(n: number) { return this.sync ? this.sync.epoch + (n * 60000) / (this.sync.bpm * 4) : null; }
  audioTimeOf(serverMs: number) { const o = this.syncOff ?? this.syncFilt; return this.sync && o != null ? serverMs / 1000 - o : null; }
  serverTimeOf(t: number) { const o = this.syncOff ?? this.syncFilt; return this.sync && o != null ? (t + o) * 1000 : null; }

  // ---------------------------------------------------------------- scheduling
  /** hand the host every step whose time falls before `until`; `cur` is now (nothing is scheduled before it) */
  advance(cur: number, until: number, host: StepHost) {
    if (this.sync && this.syncFilt != null) this.advanceSynced(cur, until, host);
    else this.advanceFree(cur, until, host);
  }

  private advanceFree(cur: number, until: number, host: StepHost) {
    // asleep (a hidden tab, a long stall): skip ahead rather than machine-gun the stale steps
    if (this.gridTime < cur - 0.3) {
      const skip = Math.ceil((cur - this.gridTime) / this.stepDur);
      this.step += skip; this.gridTime += skip * this.stepDur;
    }
    while (this.gridTime < until) {
      const rel = this.step - this.origin;
      const t = this.gridTime + ((rel & 1) === 1 ? this.swing * this.stepDur : 0);
      host.step(rel, Math.max(t, cur));
      this.lastSchedT = t;
      this.bpm += (this.targetBpm - this.bpm) * 0.06;
      this.gridTime += this.stepDur;
      this.step++;
    }
  }

  private advanceSynced(cur: number, until: number, host: StepHost) {
    const S = this.sync!, sd = 60 / (S.bpm * 4);
    this.bpm = S.bpm;
    if (this.syncOff == null || Math.abs(this.syncFilt! - this.syncOff) > 2 * sd || this.tOf(this.step) < cur - 0.3) this.jump(cur, host);
    for (;;) {
      const tn = this.tOf(this.step);
      if (tn >= until) break;
      this.gridTime = tn;
      const rel = this.step - this.origin;
      const t = tn + ((rel & 1) === 1 ? this.swing * sd : 0);
      host.step(rel, Math.max(t, cur));
      this.lastSchedT = t;
      this.step++;
      // slew toward the measured clock, at most SLEW a step
      this.syncOff! += clamp((this.syncFilt! - this.syncOff!) * 0.35, -SLEW, SLEW);
    }
    this.gridTime = this.tOf(this.step);
  }

  /** re-phase onto the shared clock: the origin becomes the server's step 0; never re-schedule audio already queued */
  private jump(cur: number, host: StepHost) {
    const S = this.sync!, sdMs = 60000 / (S.bpm * 4), sd = sdMs / 1000;
    this.syncOff = this.syncFilt;
    const minT = Math.max(cur + 0.02, this.lastSchedT + sd * 0.6);
    const n = Math.ceil(((minT + this.syncOff!) * 1000 - S.epoch) / sdMs);
    const d = n - (this.step - this.origin);
    this.step = n; this.origin = 0;
    this.gridTime = this.tOf(n);
    this.jumps++;
    host.jump?.(d, cur);
  }
}

// The deck: a world's track played live, under the music's clock. It never keeps time of its own: every tick it asks
// where the clock says the track should be (audio/track.ts trackPos of the clock's beat) and makes the sound be there,
// by AudioBufferSourceNode segments started at a time and a place in the file:
//   - a new track (a world's, from the bar line it began on; a room's, from its new epoch) starts where the clock says,
//     and the old one fades out over a second; joining late (its file still decoding) it fades in where it should be;
//   - the loop: a segment that reaches the loop's end hands over to one at its start, a 30 ms equal-power crossfade
//     centred on the seam (a bar line);
//   - drift: a segment more than 12 ms from where the clock says (a shared clock re-phased, a tempo that changed) is
//     crossfaded to the right place (40 ms; half a second for a jump of more than 0.3 s);
//   - a clock whose tempo differs from the track's by less than 3 % (a room set to another tempo) plays it at that
//     rate, so its bars stay on the room's; beyond that it plays at its own rate and is re-placed when it drifts.
// The loader fetches the files (the hub's first, the rest a few seconds later) and decodes them with an
// OfflineAudioContext at 48 kHz, so the first track is ready before the first touch makes the AudioContext; it keeps at
// most two decoded (the one playing and the one before or after it: a 3-minute track is about 70 MB of samples).
import { trackPos, loopOf, type TrackInfo } from './track';
import type { MusicClock } from './clock';

/** the files, fetched and decoded: one per page */
export class TrackLoader {
  private bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private decoding = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer>();
  /** the most recently wanted first: what stays decoded */
  private order: string[] = [];
  failed = new Set<string>();

  constructor(readonly base: string) {}

  /** fetch a track's file (once) */
  fetch(t: TrackInfo) {
    let p = this.bytes.get(t.id);
    if (!p) {
      p = fetch(this.base + t.file).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))).catch((e) => { console.warn(`music: couldn't fetch ${t.file}`, e); this.failed.add(t.id); return null; });
      this.bytes.set(t.id, p);
    }
    return p;
  }

  /** decode a track (fetching it if need be), and keep it and the one wanted before it */
  want(t: TrackInfo) {
    this.order = [t.id, ...this.order.filter((i) => i !== t.id)];
    for (const id of this.order.slice(2)) { this.ready.delete(id); this.decoding.delete(id); }
    this.order = this.order.slice(0, 2);
    let p = this.decoding.get(t.id);
    if (!p) {
      p = this.fetch(t).then(async (b) => {
        if (!b) return null;
        const Off = globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
        const buf = await new Off(2, 1, 48000).decodeAudioData(b.slice(0));
        if (this.order.includes(t.id)) this.ready.set(t.id, buf);
        return buf;
      }).catch((e) => { console.warn(`music: couldn't decode ${t.file}`, e); this.failed.add(t.id); return null; });
      this.decoding.set(t.id, p);
    }
    return p;
  }

  get(id: string) { return this.ready.get(id) ?? null; }
}

/** what the deck reads of the music each tick */
export interface DeckHost {
  readonly track: TrackInfo | null; readonly trackAt: number; readonly trackBeat0: number; readonly clock: MusicClock;
  /** a mirror crossing's bridge (Engine.crossTo): the old track bent from tA to tB and faded, the new one from tB at
   *  `pos` in its file, bent by rB and eased to its own rate by tC */
  readonly bridge?: { from: TrackInfo | null; to: TrackInfo; tA: number; tB: number; tC: number; rA: number; rB: number; pos: number } | null;
}

/** a segment's rate ramp (linear from r0 at t0 to r1 at t1) */
interface Ramp { t0: number; t1: number; r0: number; r1: number }
interface Seg { track: TrackInfo; src: AudioBufferSourceNode; gain: GainNode; t0: number; p0: number; rate: number; fading: boolean; handed: boolean; stop: number; ramp?: Ramp }

/** where a segment is in its file at time t (its rate ramp integrated) */
export function segPos(s: { t0: number; p0: number; rate: number; ramp?: Ramp }, t: number) {
  const R = s.ramp;
  if (!R || t <= R.t0) return s.p0 + (t - s.t0) * (R ? R.r0 : s.rate);
  const u = Math.min(t, R.t1) - R.t0, k = (R.r1 - R.r0) / Math.max(1e-6, R.t1 - R.t0);
  return s.p0 + (R.t0 - s.t0) * R.r0 + R.r0 * u + 0.5 * k * u * u + Math.max(0, t - R.t1) * R.r1;
}

const N = 32, IN = new Float32Array(N), OUT = new Float32Array(N);
for (let i = 0; i < N; i++) { IN[i] = Math.sin(((i / (N - 1)) * Math.PI) / 2); OUT[i] = Math.cos(((i / (N - 1)) * Math.PI) / 2); }

export class Deck {
  private segs: Seg[] = [];
  /** measurements (bend.music.deck.stats()): starts, seams, re-placings, the last error seen (ms) */
  readonly counts = { starts: 0, seams: 0, resyncs: 0, lastErrMs: 0 };

  constructor(private ctx: AudioContext, private dest: AudioNode, readonly loader: TrackLoader, private host: DeckHost) {}

  /** the rate a track plays at under the clock's tempo */
  private rateFor(t: TrackInfo) { const r = this.host.clock.bpm / t.bpm; return Math.abs(r - 1) <= 0.03 ? r : 1; }
  /** where the clock says the track is at time t */
  private where(t: TrackInfo, at: number) { return trackPos(t, this.host.clock.beatAt(at) - this.host.trackBeat0); }

  /** the bridge whose old track has been bent (each is bent once) */
  private bent: object | null = null;

  /** each tick of the scheduler (cur: the context's time now) */
  update(cur: number) {
    const H = this.host, T = H.track, horizon = cur + 0.6, Bx = H.bridge ?? null;
    this.segs = this.segs.filter((s) => s.stop > cur - 0.1);
    // a crossing's bridge: the old track's rate bent toward the new tempo up to the beat the new one comes in on (its
    // beats stay with the clock's as the clock bends), then it fades from there, below
    if (Bx && this.bent !== Bx && Bx.from) {
      this.bent = Bx;
      const t0 = Math.max(cur + 0.01, Bx.tA), t1 = Math.max(t0 + 0.02, Bx.tB);
      for (const s of this.segs) if (!s.fading && s.track === Bx.from) {
        const r = s.src.playbackRate;
        r.cancelScheduledValues(t0); r.setValueAtTime(s.rate, t0); r.linearRampToValueAtTime(s.rate * Bx.rA, t1);
        s.ramp = { t0, t1, r0: s.rate, r1: s.rate * Bx.rA };
      }
    }
    // another track's segments fade from when the new one began (a bridge's old track quicker)
    for (const s of this.segs) if (!s.fading && s.track !== T) this.fade(s, Math.max(cur + 0.01, H.trackAt), Bx && s.track === Bx.from ? 0.75 : 1.2);
    if (!T) return;
    const buf = this.loader.get(T.id);
    if (!buf) { void this.loader.want(T); return; }
    const r = this.rateFor(T), L = loopOf(T);
    const live = this.segs.filter((s) => !s.fading && s.track === T);
    const s = live[live.length - 1];
    if (!s && Bx && Bx.to === T && H.trackAt === Bx.tB && Bx.tC > cur) {
      // the bridge's new track: in on its beat at its place, bent and eased to its own rate by tC
      const ts = Math.max(cur + 0.02, Bx.tB), late = ts - Bx.tB;
      const ramp: Ramp = { t0: Bx.tB, t1: Bx.tC, r0: Bx.rB, r1: 1 };
      const p = segPos({ t0: Bx.tB, p0: Bx.pos, rate: 1, ramp }, ts);
      if (ts > horizon) return;
      this.start(T, buf, ts, p, Bx.rB + (1 - Bx.rB) * Math.min(1, late / Math.max(1e-3, Bx.tC - Bx.tB)), late > 0.05 ? 0.25 : 0.12, { ...ramp, t0: ts, r0: Bx.rB + (1 - Bx.rB) * Math.min(1, late / Math.max(1e-3, Bx.tC - Bx.tB)) });
      this.counts.starts++;
      return;
    }
    if (!s) {
      let ts = Math.max(cur + 0.03, H.trackAt), p = this.where(T, ts);
      if (p < 0) { ts += -p / r; p = 0; }
      if (ts > horizon) return;
      this.start(T, buf, ts, p, r, ts - H.trackAt > 0.08 ? 0.25 : 0.012);
      this.counts.starts++;
      return;
    }
    // when this segment reaches the loop's end (past its ramp: the ramp ends long before the loop does)
    const te = s.ramp ? s.ramp.t1 + (L.end - segPos(s, s.ramp.t1)) / s.ramp.r1 : s.t0 + (L.end - s.p0) / s.rate;
    // drift: a little ahead of now, if this segment is still playing then
    // (a segment not started yet is where it was put; places compare round the loop, so a seam's two sides agree)
    const tc = cur + 0.05;
    // (not while a bridge's ramp is under way: the clock bends with it, both linear, and they agree within a few ms)
    if (!s.handed && tc >= s.t0 && tc < te - 0.05 && (!s.ramp || tc > s.ramp.t1 + 0.05)) {
      let err = segPos(s, tc) - this.where(T, tc);
      const len = L.end - L.start;
      if (Math.abs(err) > len / 2) err -= Math.round(err / len) * len;
      this.counts.lastErrMs = err * 1000;
      if (Math.abs(err) > 0.012 || Math.abs(s.rate - r) > 0.0005) {
        const big = Math.abs(err) > 0.3, ts = cur + 0.03;
        this.fade(s, ts, big ? 0.5 : 0.04);
        this.start(T, buf, ts, Math.max(0, this.where(T, ts)), r, big ? 0.4 : 0.04);
        this.counts.resyncs++;
        return;
      }
    }
    // the seam: hand over to the loop's start, crossfaded round the bar line
    if (!s.handed && te < horizon) {
      const xf = 0.03, t1 = te - xf / 2;
      s.handed = true;
      this.fade(s, t1, xf);
      this.start(T, buf, t1, L.start - (xf / 2) * r, r, xf);
      this.counts.seams++;
    }
  }

  private start(t: TrackInfo, buf: AudioBuffer, at: number, pos: number, rate: number, fadeIn: number, ramp?: Ramp) {
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf, playbackRate: rate });
    if (ramp) { src.playbackRate.setValueAtTime(ramp.r0, at); src.playbackRate.linearRampToValueAtTime(ramp.r1, Math.max(at + 0.02, ramp.t1)); }
    const gain = new GainNode(this.ctx, { gain: 0 });
    src.connect(gain).connect(this.dest);
    if (fadeIn <= 0.06) gain.gain.setValueCurveAtTime(IN, at, fadeIn);
    else { gain.gain.setValueAtTime(0, at); gain.gain.setTargetAtTime(1, at, fadeIn / 3); }
    src.start(at, Math.max(0, Math.min(buf.duration - 0.01, pos)));
    this.segs.push({ track: t, src, gain, t0: at, p0: pos, rate: ramp ? ramp.r1 : rate, fading: false, handed: false, stop: Infinity, ...(ramp ? { ramp } : {}) });
  }

  private fade(s: Seg, at: number, dur: number) {
    s.fading = true;
    const g = s.gain.gain;
    g.cancelScheduledValues(at);
    let curved = false;
    if (dur <= 0.06) {
      // (a curve may not overlap another: a segment still fading in falls back to the exponential)
      try { g.setValueCurveAtTime(OUT, at, dur); curved = true; } catch { /* below */ }
    }
    if (curved) s.stop = at + dur + 0.02;
    else if (dur <= 0.06) { g.setTargetAtTime(0, at, dur / 3); s.stop = at + dur * 2.5; }
    else {
      g.setTargetAtTime(0, at, dur / 3);
      s.stop = at + dur * 2.5;
    }
    try { s.src.stop(s.stop); } catch { /* already stopped */ }
  }

  /** silence at once (the page is closing, the music switched off), or over `fade` s (the duel's count-in: the track
   *  set to start again on its "go", src/duel/sound.ts); the next tick starts it where the clock says */
  stop(fade = 0.05) { const t = this.ctx.currentTime; for (const s of this.segs) if (!s.fading || fade <= 0.05) this.fade(s, t, fade); }

  stats() { return { ...this.counts, playing: this.segs.filter((s) => !s.fading).map((s) => s.track.id), segments: this.segs.length }; }
  /** where the newest segment of the current track is in its file at context time t (null: none) — for the checks */
  positionAt(t: number) {
    const s = [...this.segs].reverse().find((x) => x.track === this.host.track && t >= x.t0 && t < x.stop);
    if (!s) return null;
    return { pos: s.p0 + (t - s.t0) * s.rate, track: s.track.id };
  }
}

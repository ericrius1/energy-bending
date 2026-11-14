// The worlds' music: each Suno track measured and encoded for the web (docs/extending/sound.md, "A world's track").
//   node scripts/music-analyze.mjs [--from ~/Downloads] [--only temple,forge] [--no-encode] [--clicks] [--seams]
// For each track (TRACKS below: a title, the worlds it plays in, the tempo and key it was asked for) it reads
// `<from>/<title>.mp3` (or .wav), decodes it with ffmpeg and measures:
//   - the tempo: the beat period whose comb best fits the onsets over the whole track (the Rayleigh vector strength of
//     the spectral flux at that period, searched ±10 % round the asked-for tempo, then refined by a line fitted through
//     every beat's own onset), so a 200 s track pins it to about 0.01 bpm;
//   - how steady it is: each beat's onset against that line, as the median of every 4-bar window (ms) and its spread;
//   - the bar: which of the four beats is the downbeat (the low band's onsets and the change of harmony fall on it),
//     and bar 1, the first bar line at or after the music starts;
//   - the swing: where the off 16ths fall (a fraction of a 16th late), if they are there at all;
//   - the key: the whole track's chroma against the Krumhansl-Kessler profiles; and per bar the diatonic triad its chroma
//     fits best (what the game's pitched sounds play from: the matter voices, stones and feet stay in the track's chord);
//   - a loop: whole 4-bar phrases, inside the body of the track (the intro and the outro left out), whose two ends sound
//     most alike (the bars either side of the seam: chroma, band energies, level), so it loops without a seam;
//   - the loudness (EBU R128) and true peak, for one gain that brings every track to -16 LUFS.
// It encodes each to AAC (.m4a, 160 kb/s, 48 kHz: iOS Safari and Chrome play it) in public/music/, measures the
// encode's alignment against the source (times are the .m4a's as decoded), and writes public/music/tracks.json and
// shared/tracks.ts (the same numbers: the game, the room server's tempo per world and the film tool read them).
// --clicks renders each track with clicks on the measured grid (an accent on the downbeat) and a few seconds round the
// loop's seam into docs/reports/media/music/ (git-ignored), and prints how well the onsets sit on the clicks.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

/** the tracks: one per world (the geode's also plays on the hub, the front of the game) */
export const TRACKS = [
  { id: 'geode', title: 'Inside the Geode', worlds: ['geode', 'hub'], bpm: 112, key: 'A minor', suno: 'b58fbd8f-0a18-43a6-bd7b-24c8f866196b' },
  { id: 'redwoods', title: 'Embers in the Redwoods', worlds: ['redwoods'], bpm: 112, key: 'D minor', suno: '66a9093d-da67-4c7f-9e47-8974c21f4ed2' },
  { id: 'pool', title: 'The Still Pool', worlds: ['pool'], bpm: 120, key: 'C major', suno: 'd2cb3439-072c-4643-8b5b-77195acf1061' },
  { id: 'temple', title: 'Moon Over the Tide Temple', worlds: ['temple'], bpm: 90, key: 'G major', suno: '2ff9ec8c-42b1-4766-9069-ed975d98475a' },
  { id: 'forge', title: 'The Sky Forge', worlds: ['forge'], bpm: 124, key: 'F♯ minor', suno: '46a862a6-df17-4ab2-b4d1-3a92d28e3599' },
];

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pcOf = (name) => { const n = name.split(' ')[0].replace('#', '♯'); const i = NOTE.indexOf(n); return i >= 0 ? i : ['C', 'D♭', 'D', 'D♯', 'E', 'F', 'G♭', 'G', 'G♯', 'A', 'A♯', 'B'].indexOf(n); };

// ---------------------------------------------------------------- audio in
const SR = 22050;
/** a file decoded by ffmpeg to mono float at SR (or `rate`, `channels`) */
export function decode(file, rate = SR, channels = 1) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`ffmpeg couldn't decode ${file}: ${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// ---------------------------------------------------------------- FFT (radix 2, in place)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** magnitude spectra: frames of n with hop h (Hann), each a Float32Array of n/2 bins; `each(mag, frame)` */
function stft(x, n, h, each) {
  const win = new Float32Array(n).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const re = new Float64Array(n), im = new Float64Array(n), mag = new Float32Array(n / 2);
  const frames = Math.max(0, Math.floor((x.length - n) / h) + 1);
  for (let f = 0; f < frames; f++) {
    const o = f * h;
    for (let i = 0; i < n; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    each(mag, f);
  }
  return frames;
}

// ---------------------------------------------------------------- onsets
export const ON_N = 1024, ON_H = 128, FR = SR / ON_H;   // the onset envelope's rate: 172 frames a second (5.8 ms)
/** spectral flux on a log magnitude, half-wave rectified: whole band, low band (< 180 Hz: kicks, surdo, the bass) */
export function onsets(x) {
  const lowK = Math.round((180 * ON_N) / SR), topK = Math.round((8000 * ON_N) / SR);
  let prev = null;
  const all = [], low = [], rms = [];
  stft(x, ON_N, ON_H, (mag, f) => {
    const lm = mag.map((m) => Math.log1p(1000 * m));
    let a = 0, l = 0, e = 0;
    if (prev) for (let k = 1; k < topK; k++) { const d = lm[k] - prev[k]; if (d > 0) { a += d; if (k < lowK) l += d; } }
    for (let k = 1; k < topK; k++) e += mag[k] * mag[k];
    all.push(a); low.push(l); rms.push(Math.sqrt(e));
    prev = lm;
  });
  // (each frame is centred half a window later than its start)
  const shift = ON_N / 2 / ON_H;
  const hp = (v) => {  // less a local mean over ±0.25 s, so only the attacks remain
    const out = new Float32Array(v.length), W = Math.round(0.25 * FR);
    let s = 0;
    for (let i = 0; i < Math.min(v.length, W); i++) s += v[i];
    for (let i = 0; i < v.length; i++) {
      if (i + W < v.length) s += v[i + W];
      if (i - W - 1 >= 0) s -= v[i - W - 1];
      const n = Math.min(v.length, i + W + 1) - Math.max(0, i - W);
      out[i] = Math.max(0, v[i] - s / n);
    }
    return out;
  };
  return { all: hp(all), low: hp(low), rms: Float32Array.from(rms), shift };
}
const tOfFrame = (f, shift) => (f + shift) / FR;
/** linear interpolation of an envelope at frame position p */
const at = (v, p) => { const i = Math.floor(p), u = p - i; return i < 0 || i + 1 >= v.length ? 0 : v[i] * (1 - u) + v[i + 1] * u; };

/** the vector strength of the envelope at period P (frames) and its phase (frames) */
export function strength(v, P, from = 0, to = v.length) {
  let c = 0, s = 0, sum = 0;
  const w = (2 * Math.PI) / P;
  for (let i = from; i < to; i++) { const x = v[i]; if (!x) continue; c += x * Math.cos(w * i); s += x * Math.sin(w * i); sum += x; }
  let ph = (Math.atan2(s, c) / w); if (ph < 0) ph += P;
  return { r: Math.hypot(c, s) / (sum || 1), phase: ph };
}

// ---------------------------------------------------------------- chroma
const CH_N = 8192, CH_H = 2048;
/** the tuning: how far (semitones, -0.5 … 0.5) the track's partials sit from A = 440 Hz, from the spectral peaks of
 *  every 8th frame (parabolic), weighted by their level; and the chroma at that tuning (each bin's pitch class, weighted
 *  by how near it is to the note's centre) */
function chroma(x) {
  const hist = new Float64Array(100);
  let fr = 0;
  stft(x, CH_N, CH_H, (mag) => {
    if (fr++ % 8) return;
    let mx = 0; for (let k = 20; k < 800; k++) mx = Math.max(mx, mag[k]);
    for (let k = 25; k < 750; k++) {
      const m = mag[k]; if (m < mx * 0.1 || m < mag[k - 1] || m < mag[k + 1]) continue;
      const a = mag[k - 1], c = mag[k + 1], d = a - 2 * m + c, kk = k + (d < 0 ? (a - c) / (2 * d) : 0);
      const midi = 69 + 12 * Math.log2((kk * SR) / CH_N / 440), dev = midi - Math.round(midi);
      hist[Math.floor((dev + 0.5) * 100) % 100] += m;
    }
  });
  let bi = 0, bv = -1;
  for (let i = 0; i < 100; i++) { let v = 0; for (let j = -4; j <= 4; j++) v += hist[(i + j + 100) % 100] * (1 - Math.abs(j) / 5); if (v > bv) { bv = v; bi = i; } }
  const tuning = (bi + 0.5) / 100 - 0.5;
  const out = [];
  const bins = [];
  for (let k = 1; k < CH_N / 2; k++) {
    const f = (k * SR) / CH_N;
    if (f < 65 || f > 2100) continue;
    const midi = 69 + 12 * Math.log2(f / 440) - tuning;
    bins.push([k, ((Math.round(midi) % 12) + 12) % 12, 1 - Math.min(1, Math.abs(midi - Math.round(midi)) * 2)]);
  }
  stft(x, CH_N, CH_H, (mag) => {
    const c = new Float32Array(12);
    for (const [k, p, w] of bins) c[p] += w * Math.log1p(100 * mag[k]);
    out.push(c);
  });
  return { frames: out, t: (f) => (f * CH_H + CH_N / 2) / SR, tuning };
}
const norm = (v) => { const m = Math.hypot(...v) || 1; return v.map((x) => x / m); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const corr = (a, b) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
};
// Krumhansl-Kessler key profiles
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const rot = (p, k) => p.map((_, i) => p[((i - k) % 12 + 12) % 12]);
function keyOf(c) {
  const all = [];
  for (let k = 0; k < 12; k++) {
    all.push({ tonic: k, mode: 'major', r: corr(c, rot(KK_MAJ, k)) });
    all.push({ tonic: k, mode: 'minor', r: corr(c, rot(KK_MIN, k)) });
  }
  all.sort((a, b) => b.r - a.r);
  return all;
}
/** the seven diatonic triads of a key (pitch classes, root first) and their names */
function triads(tonic, mode) {
  const scale = (mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).map((s) => (s + tonic) % 12);
  return scale.map((r, i) => {
    const t = [r, scale[(i + 2) % 7], scale[(i + 4) % 7]];
    const third = (t[1] - r + 12) % 12, fifth = (t[2] - r + 12) % 12;
    const q = third === 4 ? '' : fifth === 6 ? 'dim' : 'm';
    return { pcs: t, name: NOTE[r] + q };
  });
}

// ---------------------------------------------------------------- the tempo
/** the harmonic comb: the vector strengths at the bar's first eight harmonics (a 4/4 groove puts onsets on all of them:
 *  the bar, the half bar, the beats, the 8ths and the swung or tripled figures between), summed */
function comb(v, bpm, from = 0, to = v.length) {
  const bar = (4 * 60 * FR) / bpm;
  let s = 0;
  for (let h = 1; h <= 8; h++) s += strength(v, bar / h, from, to).r * (h === 4 || h === 8 ? 1.5 : 1);
  return s;
}
function scanTempo(v, b0, b1, step, from, to) {
  let best = null;
  for (let b = b0; b <= b1 + 1e-9; b += step) { const r = comb(v, b, from, to); if (!best || r > best.r) best = { bpm: b, r }; }
  return best;
}
/** the tempo through the track: the comb in 16 s windows every 4 s, each searched near the whole track's tempo, then
 *  a running median (a window with too little in it takes its neighbours') */
export function tempoCurve(v, askBpm) {
  const g = scanTempo(v, askBpm * 0.8, askBpm * 1.25, 0.05);
  const W = Math.floor(16 * FR), H = Math.floor(4 * FR), out = [];
  for (let f0 = 0; f0 + W <= v.length; f0 += H) {
    let b = scanTempo(v, g.bpm * 0.94, g.bpm * 1.06, 0.05, f0, f0 + W);
    b = scanTempo(v, b.bpm - 0.06, b.bpm + 0.06, 0.01, f0, f0 + W);
    out.push({ t: (f0 + W / 2) / FR, bpm: b.bpm, r: b.r });
  }
  const rs = out.map((o) => o.r).sort((a, b) => a - b), rMed = rs[Math.floor(rs.length / 2)];
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return out.map((o, i) => {
    const near = out.slice(Math.max(0, i - 3), i + 4).filter((n) => n.r > rMed * 0.6).map((n) => n.bpm);
    return { t: o.t, bpm: near.length ? med(near) : g.bpm, r: o.r };
  });
}
/** the beats: dynamic programming over the onsets (Ellis 2007) with the local beat period from the tempo curve, each
 *  beat then nudged to its onset's peak (parabolic, within a frame) */
function trackBeats(v, curve) {
  const n = v.length, sd = Math.sqrt(v.reduce((a, x) => a + x * x, 0) / n) || 1;
  const o = Float64Array.from(v, (x) => x / sd);
  const per = (i) => { const t = i / FR; let k = 0; while (k + 1 < curve.length && curve[k + 1].t < t) k++; return (60 / curve[k].bpm) * FR; };
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1), tight = 100;
  for (let i = 0; i < n; i++) {
    const P = per(i);
    let best = 0, bj = -1;
    for (let j = Math.max(0, Math.round(i - 2 * P)); j <= i - Math.round(P / 2); j++) {
      const s = score[j] - tight * Math.log((i - j) / P) ** 2;
      if (bj < 0 || s > best) { best = s; bj = j; }
    }
    score[i] = o[i] + (bj >= 0 ? Math.max(0, best) : 0);
    if (bj >= 0 && best > 0) back[i] = bj;
  }
  // the last beat: the best score within the last beat's span
  const P = per(n - 1);
  let last = n - 1;
  for (let i = n - 1; i > n - 1 - P; i--) if (score[i] > score[last]) last = i;
  const beats = [];
  for (let i = last; i >= 0; i = back[i]) { beats.push(i); if (back[i] < 0) break; }
  beats.reverse();
  return beats.map((i) => {
    const a = o[i - 1] ?? 0, b = o[i], c = o[i + 1] ?? 0, d = a - 2 * b + c;
    return i + (d < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * d))) : 0);
  });
}
/** a smooth time map through the beats: a local line over ±16 beats (beats more than 25 ms off it left out, twice) */
function smoothBeats(times) {
  const n = times.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 16), hi = Math.min(n - 1, i + 16);
    let keep = [];
    for (let k = lo; k <= hi; k++) keep.push(k);
    let a = 0, b = 0;
    for (let pass = 0; pass < 3; pass++) {
      let sk = 0, st = 0, skk = 0, skt = 0;
      for (const k of keep) { sk += k; st += times[k]; skk += k * k; skt += k * times[k]; }
      const m = keep.length;
      b = (m * skt - sk * st) / (m * skk - sk * sk || 1); a = (st - b * sk) / m;
      const next = keep.filter((k) => Math.abs(times[k] - (a + b * k)) < 0.025);
      if (next.length < 8) break;
      keep = next;
    }
    out[i] = a + b * i;
  }
  return out;
}

/** the 8ths through the track, as frames: in 8 s windows every half second, the phase of the 8ths' harmonic at the
 *  local tempo puts an 8th line near the window's middle; the lines are counted from window to window (unwrapped), and
 *  a local line through every window within ±5 s gives each 8th's time (a window with too little pulse is left out) */
function pulseMap(v, curve) {
  const W = Math.floor(8 * FR), H = Math.floor(0.5 * FR), pts = [];
  const bpmAt = (t) => { let k = 0; while (k + 1 < curve.length && curve[k + 1].t < t) k++; return curve[k].bpm; };
  for (let f0 = 0; f0 + W <= v.length; f0 += H) {
    const c = f0 + W / 2, P8 = (30 / bpmAt(c / FR)) * FR, s = strength(v, P8, f0, f0 + W);
    pts.push({ c, L: s.phase + Math.round((c - s.phase) / P8) * P8, P8, r: s.r });
  }
  const rs = pts.map((p) => p.r).sort((a, b) => a - b), keep = pts.filter((p) => p.r >= rs[Math.floor(rs.length / 2)] * 0.5);
  keep[0].N = 0;
  for (let i = 1; i < keep.length; i++) keep[i].N = keep[i - 1].N + Math.round((keep[i].L - keep[i - 1].L) / ((keep[i].P8 + keep[i - 1].P8) / 2));
  const fitAt = (n) => {
    const P8n = keep.reduce((a, p) => a + p.P8, 0) / keep.length;
    let near = keep.filter((p) => Math.abs(p.N - n) * P8n <= 5 * FR);
    if (near.length < 4) near = keep.slice().sort((a, b) => Math.abs(a.N - n) - Math.abs(b.N - n)).slice(0, 6);
    let sk = 0, st = 0, skk = 0, skt = 0, w = 0;
    for (const p of near) { const q = p.r; w += q; sk += q * p.N; st += q * p.L; skk += q * p.N * p.N; skt += q * p.N * p.L; }
    const b = (w * skt - sk * st) / (w * skk - sk * sk || 1), a = (st - b * sk) / w;
    return a + b * n;
  };
  const out = [];
  const n0 = Math.floor(-keep[0].L / keep[0].P8) - 1, n1 = keep[keep.length - 1].N + Math.ceil((v.length - keep[keep.length - 1].L) / keep[keep.length - 1].P8) + 1;
  for (let n = n0; n <= n1; n++) out.push(fitAt(n));
  return out.filter((f, i) => f >= 0 || out[i + 1] > 0);
}

/** a track brought to one tempo: the beats found, their time map smoothed, and the audio stretched beat by beat to
 *  the body's median tempo (rubberband, pitch kept, formants kept, the two channels together). A beat's stretch is at
 *  most ±4 % (a ritardando past that, an outro's, is left as it is) */
export function conform(src, ask, outWav, gainDb = 0) {
  const x = decode(src);
  const O = onsets(x);
  const curve = tempoCurve(O.all, ask.bpm);
  const T = pulseMap(O.all, curve).map((f) => tOfFrame(f, O.shift)), raw = T;
  const d = [];
  for (let k = 0; k + 1 < T.length; k++) d.push(T[k + 1] - T[k]);
  // the target: the median beat over the middle of the track (its body: the intro and outro left out)
  const mid = d.slice(Math.floor(d.length * 0.15), Math.floor(d.length * 0.85)).sort((a, b) => a - b);
  const D = mid[Math.floor(mid.length / 2)];
  const cmds = [], ratios = [];
  let prev = null;
  for (let k = 0; k < d.length; k++) {
    const r = Math.max(0.96, Math.min(1.04, d[k] / D));
    ratios.push(r);
    if (prev == null || Math.abs(r - prev) > 0.0004) { cmds.push(`${Math.max(0, T[k]).toFixed(4)} rubberband tempo ${r.toFixed(5)};`); prev = r; }
  }
  const tmp = join(outWav, '..');
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'tempo.cmd'), cmds.join('\n') + '\n');
  const af = `asendcmd=f=tempo.cmd,rubberband=tempo=${ratios[0].toFixed(5)}:transients=crisp:detector=compound:phase=laminar:window=standard:formant=preserved:pitchq=quality:channels=together,volume=${gainDb.toFixed(2)}dB`;
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', resolve(src), '-map', '0:a:0', '-af', af, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', resolve(outWav)], { cwd: tmp, encoding: 'utf8' });
  if (r.status) throw new Error(`rubberband: ${r.stderr}`);
  const bpms = curve.map((c) => c.bpm);
  return {
    bpm: 30 / D, beats: raw.length,
    source: { minBpm: +Math.min(...bpms).toFixed(2), maxBpm: +Math.max(...bpms).toFixed(2), curve: curve.filter((_, i) => i % 4 === 0).map((c) => [+c.t.toFixed(0), +c.bpm.toFixed(2)]) },
    stretch: { min: +Math.min(...ratios).toFixed(4), max: +Math.max(...ratios).toFixed(4), clamped: ratios.filter((q) => q === 0.96 || q === 1.04).length },
  };
}

// ---------------------------------------------------------------- one track
export function analyse(file, ask) {
  const x = decode(file);
  const dur = x.length / SR;
  const O = onsets(x);
  const { all, low, rms, shift } = O;
  // the tempo: the harmonic comb (the bar's first eight harmonics: a 4/4 groove's onsets) over ±20 % of the asked-for
  // tempo, coarse then fine; the phase from the beat's own harmonic
  let best = scanTempo(all, ask.bpm * 0.8, ask.bpm * 1.25, 0.05);
  best = scanTempo(all, best.bpm - 0.08, best.bpm + 0.08, 0.002);
  const bpm = best.bpm, P = (60 / bpm) * FR;
  // the phase: the beat harmonic's is a mean over every onset in the beat (swung 16ths and triplets drag it late), so
  // take the peak of the onsets folded on the beat (0.5 ms bins, a 4 ms kernel) within an 8th of it
  const ph = (() => {
    const p0 = strength(all, P).phase, nb = Math.round((P / FR) * 2000), fold = new Float64Array(nb);
    for (let i = 0; i < all.length; i++) if (all[i]) fold[Math.floor(((i % P) / P) * nb) % nb] += all[i];
    const k = Math.round(0.004 * 2000), sm = (j) => { let v = 0; for (let d = -2 * k; d <= 2 * k; d++) v += fold[(j + d + nb) % nb] * Math.exp(-0.5 * (d / k) ** 2); return v; };
    let bj = 0, bv = -1;
    const c = Math.round((p0 / P) * nb);
    for (let d = -Math.round(nb / 8); d <= Math.round(nb / 8); d++) { const j = (c + d + nb) % nb, v = sm(j); if (v > bv) { bv = v; bj = j; } }
    return (bj / nb) * P;
  })();
  const beat0 = tOfFrame(ph, shift);       // a beat (seconds), on the comb
  const spb = 60 / bpm;
  // steadiness: in every 4-bar window, where the beat's phase sits against the line (ms; the onsets' own timing)
  // (the 8ths' harmonic: on and off the beat its onsets agree, where the beat's own harmonic loses the "ands")
  const windows = [], P8 = P / 2, ph8 = strength(all, P8).phase;
  for (let t = 0; t + 16 * spb <= dur; t += 16 * spb) {
    const f0 = Math.floor(t * FR), f1 = Math.floor((t + 16 * spb) * FR), s = strength(all, P8, f0, f1);
    if (s.r < 0.05) continue;
    let d = s.phase - ph8; d -= Math.round(d / P8) * P8;
    windows.push({ t: +t.toFixed(1), ms: +((d / FR) * 1000).toFixed(1), r: +s.r.toFixed(2) });
  }
  const wms = windows.filter((w) => w.r >= 0.25).map((w) => w.ms);
  const local = tempoCurve(all, ask.bpm).map((c) => +c.bpm.toFixed(2));

  // the swing: where the second and fourth 16ths fall, folded over every beat (the envelope's mass between 1/4 and
  // 0.45 of a beat, against the straight 16th); none if there is no off-16th to speak of
  const fold = new Float64Array(96);
  for (let k = 0; ph + (k + 1) * P < all.length; k++) for (let j = 0; j < 96; j++) fold[j] += at(all, ph + k * P + (j / 96) * P);
  const meanFold = fold.reduce((a, b) => a + b, 0) / 96;
  let swPeak = 0, swAt = 24;
  for (let j = 20; j <= 40; j++) if (fold[j] > swPeak) { swPeak = fold[j]; swAt = j; }
  const swing = swPeak > 1.3 * meanFold ? Math.max(0, +((swAt - 24) / 24).toFixed(3)) : 0;

  // the bar: which beat of four carries the low band's onsets and the harmony's changes
  const C = chroma(x);
  const chromaAt = (t0, t1) => {
    const c = new Array(12).fill(0); let n = 0;
    for (let f = 0; f < C.frames.length; f++) { const t = C.t(f); if (t >= t0 && t < t1) { for (let p = 0; p < 12; p++) c[p] += C.frames[f][p]; n++; } }
    return n ? c.map((v) => v / n) : c;
  };
  // the bar, in two steps. First the beat against the "and" (a comb can sit half a beat out): all the onsets, on the
  // beats or on the 8ths between. Then which of the four beats is the downbeat: the harmony changes on a bar line (the
  // chroma of whole bars either side of it differ most when the bars are the right ones), the low band hits it (the
  // kick, the surdo, the bass's attack), and the onsets are strongest there
  const peakAt = (v, t) => { const f = t * FR - shift; let m = 0; for (let i = Math.floor(f - 3); i <= f + 3; i++) m = Math.max(m, v[i] ?? 0); return m; };
  const nBeats = Math.floor((dur - beat0) / spb) - 1;
  let on = 0, off = 0;
  for (let k = 1; k < nBeats; k++) { on += peakAt(all, beat0 + k * spb); off += peakAt(all, beat0 + (k + 0.5) * spb); }
  const b0 = beat0 + (off > on * 1.05 ? spb / 2 : 0);
  // (purity: a bar that holds one chord fits a triad's template best: every major and minor triad, centred)
  const TPL = [];
  for (let r = 0; r < 12; r++) for (const third of [3, 4]) { const t = new Array(12).fill(-0.25); t[r] = 1; t[(r + third) % 12] = 1; t[(r + 7) % 12] = 1; TPL.push(norm(t)); }
  const comp = [0, 1, 2, 3].map((c) => {
    let nov = 0, n = 0, lo = 0, al = 0, m = 0, pur = 0;
    let prevC = null;
    for (let t = b0 + c * spb; t + 4 * spb <= dur; t += 4 * spb) {
      const raw = chromaAt(t, t + 4 * spb), mean = raw.reduce((a, x) => a + x, 0) / 12, ch = norm(raw.map((x) => x - mean));
      if (prevC) { nov += 1 - dot(prevC, ch); n++; }
      pur += Math.max(...TPL.map((tp) => dot(ch, tp)));
      prevC = ch;
      lo += peakAt(low, t); al += peakAt(all, t); m++;
    }
    return { nov: nov / Math.max(1, n), low: lo / Math.max(1, m), all: al / Math.max(1, m), pur: pur / Math.max(1, m) };
  });
  const sum = (k) => comp.reduce((a, c) => a + c[k], 0) || 1;
  const scores = comp.map((c) => c.nov / sum('nov') + c.pur / sum('pur') * 2 + c.low / sum('low') + c.all / sum('all'));
  const order = scores.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]);
  const db = order[0][1];
  const halfShift = b0 !== beat0;
  const barDur = 4 * spb;
  // bar 1: the first bar line at or after the music starts (less a quarter beat: a soft first downbeat counts)
  const rmsMed = [...rms].sort((a, b) => a - b)[Math.floor(rms.length / 2)];
  let startF = rms.findIndex((v) => v > rmsMed * 0.1);
  const tStart = tOfFrame(Math.max(0, startF), shift);
  let downbeat = b0 + db * spb;
  downbeat += Math.ceil((Math.max(0, tStart - spb / 4) - downbeat) / barDur) * barDur;
  const bars = Math.floor((dur - downbeat) / barDur);

  // the key, and a triad per bar
  const whole = chromaAt(0, dur);
  const keys = keyOf(whole);
  const K = keys[0];
  const T = triads(K.tonic, K.mode);
  const chords = [], barFeat = [];
  for (let b = 0; b < bars; b++) {
    const t0 = downbeat + b * barDur, c = chromaAt(t0, t0 + barDur), cn = norm(c);
    let bi = 0, bv = -Infinity;
    T.forEach((tr, i) => {
      const tpl = new Array(12).fill(-0.15); for (const p of tr.pcs) tpl[p] = 1; tpl[tr.pcs[0]] = 1.25;
      const v = dot(cn, norm(tpl)) + (i === 0 ? 0.02 : 0);
      if (v > bv) { bv = v; bi = i; }
    });
    chords.push(bi);
    // the bar's sound for the loop's seam: chroma, six band levels, its loudness
    const f0 = Math.floor(t0 * FR), f1 = Math.floor((t0 + barDur) * FR);
    let e = 0; for (let f = f0; f < f1 && f < rms.length; f++) e += rms[f] ** 2;
    barFeat.push({ chroma: cn, db: 10 * Math.log10(e / Math.max(1, f1 - f0) + 1e-12), low: (() => { let s = 0; for (let f = f0; f < f1; f++) s += low[f] ?? 0; return s; })(), onset: (() => { let s = 0; for (let f = f0; f < f1; f++) s += all[f] ?? 0; return s; })() });
  }

  // the loop: inside the body (bars within 6 dB of the median loudness, from the first to the last), whole 4-bar
  // phrases, at least half the track; the seam's cost is how unalike the bars either side of it are
  const dbs = barFeat.map((f) => f.db), med = [...dbs].sort((a, b) => a - b)[Math.floor(dbs.length / 2)];
  // (and only where the grid holds: no 4-bar window it touches has a clear pulse more than 15 ms off the line, so an
  // outro's ritardando is never looped; a stretch with no pulse to speak of may be)
  const wMed = wms.slice().sort((a, b) => a - b)[Math.floor(wms.length / 2)] ?? 0;
  const gridOk = (b) => {
    const t0 = downbeat + b * barDur, t1 = t0 + barDur;
    const ws = windows.filter((w) => w.t < t1 && w.t + 16 * spb > t0);
    return ws.every((w) => w.r < 0.2 || Math.abs(w.ms - wMed) <= 15);
  };
  const body = dbs.map((d, b) => d >= med - 6 && gridOk(b));
  // the longest run of good bars
  let first = 1, last = 1;
  for (let b = 1, run = -1; b <= bars; b++) {
    if (b < bars && body[b]) { if (run < 0) run = b; continue; }
    if (run >= 0 && b - 1 - run > last - first) { first = run; last = b - 1; }
    run = -1;
  }
  const onMed = [...barFeat.map((f) => f.onset)].sort((a, b) => a - b)[Math.floor(bars / 2)] || 1;
  const fd = (a, b) => (1 - dot(a.chroma, b.chroma)) * 4 + Math.abs(a.db - b.db) / 6 + Math.abs(a.onset - b.onset) / onMed;
  let loop = null;
  for (let a = first; a < last; a++) for (let b = a + 16; b <= last; b += 4) {
    if (b - a < Math.min(32, (last - first) * 0.5)) continue;
    // at the seam the bar after b-1 is a (it would have been b): a like b, a-1 like b-1, a+1 like b+1
    const cost = fd(barFeat[a], barFeat[b] ?? barFeat[b - 1]) + 0.6 * fd(barFeat[a - 1], barFeat[b - 1]) + 0.4 * fd(barFeat[a + 1], barFeat[Math.min(bars - 1, b + 1)]);
    const score = cost - 0.6 * ((b - a) / bars) + ((b - a) % 8 ? 0.05 : 0);
    if (!loop || score < loop.score) loop = { a, b, cost, score };
  }
  const loopStartBar = loop.a, loopEndBar = loop.b;

  // how well the onsets sit on the grid: for each beat, the nearest strong onset (a local peak above the 70th
  // percentile) within ±60 ms
  const sorted = [...all].sort((a, b) => a - b), thr = sorted[Math.floor(sorted.length * 0.7)];
  const offs = [];
  for (let k = 0; ; k++) {
    const t = downbeat + k * spb; if (t > dur - 0.1) break;
    const f = t * FR - shift; let bi = -1, bv = 0;
    for (let i = Math.floor(f - 0.06 * FR); i <= f + 0.06 * FR; i++) {
      const v = all[i] ?? 0; if (v > thr && v >= (all[i - 1] ?? 0) && v >= (all[i + 1] ?? 0) && v > bv) { bv = v; bi = i; }
    }
    if (bi >= 0) offs.push(((bi - f) / FR) * 1000);
  }
  const absSorted = offs.map(Math.abs).sort((a, b) => a - b);
  const within = (ms) => offs.filter((o) => Math.abs(o) <= ms).length / Math.max(1, Math.floor((dur - downbeat) / spb));
  return {
    duration: +dur.toFixed(3), bpm, spb, downbeat, bars, tStart,
    comb: +best.r.toFixed(3), barScores: scores.map((s) => +s.toFixed(3)), barParts: comp.map((c) => [+c.nov.toFixed(3), +c.pur.toFixed(3), +c.low.toFixed(2), +c.all.toFixed(2)]), halfShift, onOff: +(on / off).toFixed(2), barMargin: +(order[0][0] / order[1][0]).toFixed(3),
    swing,
    steady: { windowsMs: windows, medianSpreadMs: +(Math.max(...wms) - Math.min(...wms)).toFixed(1), maxAbsMs: +Math.max(...wms.map(Math.abs)).toFixed(1), localBpm: local },
    key: { tonic: K.tonic, mode: K.mode, name: `${NOTE[K.tonic]} ${K.mode}`, r: +K.r.toFixed(3), tuningCents: Math.round(C.tuning * 100), next: keys.slice(1, 3).map((k) => `${NOTE[k.tonic]} ${k.mode} ${k.r.toFixed(3)}`) },
    triads: T, chords,
    loop: { startBar: loopStartBar, endBar: loopEndBar, cost: +loop.cost.toFixed(3), body: [first, last] },
    onGrid: { beatsWithOnset: offs.length, medianMs: +offs.slice().sort((a, b) => a - b)[Math.floor(offs.length / 2)]?.toFixed(1), median_abs_ms: +(absSorted[Math.floor(absSorted.length / 2)] ?? NaN).toFixed(1), within20: +within(20).toFixed(3), within40: +within(40).toFixed(3) },
    barDb: dbs.map((d) => +d.toFixed(1)),
  };
}

// ---------------------------------------------------------------- loudness, encoding, alignment
function loudness(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const s = r.stderr, sum = s.slice(s.lastIndexOf('Summary:'));
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]) };
}
/** the lag (s) that best lines b up with a (b later: positive), by cross-correlating a stretch of the onset envelopes */
function lag(a, b) {
  const A = onsets(a.subarray(0, SR * 40)).all, B = onsets(b.subarray(0, SR * 40)).all;
  let best = 0, bv = -Infinity;
  for (let l = -40; l <= 40; l++) { let s = 0; for (let i = 50; i < A.length - 50; i++) s += A[i] * (B[i + l] ?? 0); if (s > bv) { bv = s; best = l; } }
  // refine to a sample on the raw signal round that lag
  const c0 = Math.round((best / FR) * SR);
  let bl = c0, bs = -Infinity;
  for (let l = c0 - 200; l <= c0 + 200; l++) { let s = 0; for (let i = SR * 5; i < SR * 25; i += 3) s += a[i] * (b[i + l] ?? 0); if (s > bs) { bs = s; bl = l; } }
  return bl / SR;
}

// ---------------------------------------------------------------- run
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2), opt = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const FROM = resolve(String(opt.from ?? join(homedir(), 'Downloads')).replace(/^~/, homedir()));
  const only = opt.only ? String(opt.only).split(',') : null;
  const OUTDIR = join(ROOT, 'public/music'), MEDIA = join(ROOT, 'docs/reports/media/music');
  mkdirSync(OUTDIR, { recursive: true });
  const manifestFile = join(OUTDIR, 'tracks.json');
  const prev = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { tracks: {} };
  const TARGET = -16;
  for (const T of TRACKS) {
    if (only && !only.includes(T.id)) continue;
    const src = ['.mp3', '.wav', '.m4a', '.flac'].map((e) => join(FROM, T.title + e)).find(existsSync);
    if (!src) { console.log(`${T.id}: no ${T.title}.mp3 or .wav in ${FROM}; kept as it was`); continue; }
    console.log(`${T.id}: ${src}`);
    const out = join(OUTDIR, `${T.id}.m4a`);
    const L = loudness(src);
    // one gain to -16 LUFS, kept a decibel under full scale at the true peak
    const gain = Math.min(TARGET - L.lufs, -1 - L.peak);
    // one tempo (the films lay this WAV under them; the game plays its encode)
    const wav = join(MEDIA, `${T.id}.wav`);
    let C = prev.tracks[T.id]?.measured?.conform ?? null;
    if (!opt['no-encode'] || !existsSync(wav)) {
      C = conform(src, { bpm: T.bpm }, wav, gain);
      const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', out]);
      if (r.status) throw new Error(`encode ${T.id}: ${r.stderr}`);
    }
    // the encode against the WAV it came from (AAC's priming is in the file's edit list: ffmpeg trims it, as a browser should)
    const offset = lag(decode(wav), decode(out));
    const A = analyse(out, { bpm: C?.bpm ?? T.bpm });
    const Lout = loudness(out);
    const r3 = (v) => +v.toFixed(4);
    const barDur = 4 * A.spb;
    const track = {
      id: T.id, title: T.title, worlds: T.worlds, file: `music/${T.id}.m4a`, suno: T.suno,
      bpm: +A.bpm.toFixed(4), downbeat: r3(A.downbeat), beatsPerBar: 4, swing: A.swing,
      bars: A.bars, duration: A.duration,
      loop: { startBar: A.loop.startBar, endBar: A.loop.endBar, start: r3(A.downbeat + A.loop.startBar * barDur), end: r3(A.downbeat + A.loop.endBar * barDur) },
      key: { tonic: A.key.tonic, mode: A.key.mode, name: A.key.name, cents: A.key.tuningCents },
      asked: { bpm: T.bpm, key: T.key },
      triads: A.triads.map((t) => t.pcs), chords: A.chords.map((i) => i),
      chordNames: A.triads.map((t) => t.name),
      measured: {
        comb: A.comb, steady: A.steady, barScores: A.barScores, barMargin: A.barMargin, keyR: A.key.r, keyNext: A.key.next,
        loopCost: A.loop.cost, body: A.loop.body, onGrid: A.onGrid, musicStarts: +A.tStart.toFixed(3),
        conform: C, lufs: +Lout.lufs.toFixed(1), truePeak: +Lout.peak.toFixed(1), sourceLufs: L.lufs, gainDb: +gain.toFixed(2), encodeLagMs: +(offset * 1000).toFixed(2),
        bytes: statSync(out).size,
      },
    };
    prev.tracks[T.id] = track;
    const asked = pcOf(T.key), keyOk = asked === A.key.tonic && T.key.includes(A.key.mode);
    console.log(`  ${A.bpm.toFixed(3)} bpm (asked ${T.bpm}), bar 1 at ${A.downbeat.toFixed(3)} s, ${A.bars} bars, swing ${A.swing}; key ${A.key.name} (r ${A.key.r}; asked ${T.key}${keyOk ? '' : ' — differs'}; next ${A.key.next.join(', ')}; tuned ${A.key.tuningCents} cents from A440)`);
    if (C) console.log(`  the source: ${C.source.minBpm}…${C.source.maxBpm} bpm through the track (${C.source.curve.map((c) => c.join(':')).join(' ')}); ${C.beats} 8ths; stretched ${C.stretch.min}…${C.stretch.max} (${C.stretch.clamped} beats at the ±4 % limit) to ${C.bpm.toFixed(3)} bpm`);
    console.log(`  steady: where the pulse is clear, 4-bar phases within ${A.steady.medianSpreadMs} ms (max |${A.steady.maxAbsMs}| ms), tempo curve ${A.steady.localBpm.filter((_, i) => i % 4 === 0).join(' ')}`);
    console.log(`  bar: beats/ands ${A.onOff}${A.halfShift ? ' (moved half a beat)' : ''}; downbeat scores ${A.barScores.join(' ')} (margin ${A.barMargin}; novelty/purity/low/all ${A.barParts.map((p) => p.join('/')).join(' ')}); loop bars ${A.loop.startBar}…${A.loop.endBar} (${track.loop.start.toFixed(2)}–${track.loop.end.toFixed(2)} s, seam cost ${A.loop.cost}; body ${A.loop.body.join('…')})`);
    console.log(`  on the grid: ${(A.onGrid.within20 * 100).toFixed(0)} % of beats have an onset within 20 ms, ${(A.onGrid.within40 * 100).toFixed(0)} % within 40; median offset ${A.onGrid.medianMs} ms (|${A.onGrid.median_abs_ms}|)`);
    console.log(`  ${(track.measured.bytes / 1e6).toFixed(2)} MB, ${track.measured.lufs} LUFS (gain ${gain.toFixed(1)} dB), encode lag ${track.measured.encodeLagMs} ms`);
    if (opt.clicks) clicks(out, track, MEDIA);
  }
  prev.generated = 'scripts/music-analyze.mjs';
  prev.worlds = Object.fromEntries(Object.values(prev.tracks).flatMap((t) => t.worlds.map((w) => [w, t.id])));
  writeFileSync(manifestFile, JSON.stringify(prev, null, 1) + '\n');
  writeShared(prev);
  console.log(`wrote ${manifestFile} and shared/tracks.ts`);
}

/** the numbers the game and the room server read, as a module (shared/tracks.ts) */
function writeShared(m) {
  const lean = Object.fromEntries(Object.values(m.tracks).map((t) => [t.id, {
    id: t.id, title: t.title, file: t.file, bpm: t.bpm, downbeat: t.downbeat, swing: t.swing, bars: t.bars, duration: t.duration,
    loop: t.loop, key: t.key, triads: t.triads, chords: t.chords,
  }]));
  const src = `// The worlds' tracks (Suno instrumentals), as measured by scripts/music-analyze.mjs: written by it, not by hand
// (public/music/tracks.json has the same numbers and how they were measured). Times are seconds in the track's .m4a;
// bar 1 is \`downbeat\`; \`loop\` is in whole bars counted from 0 (bar 1 is 0: bar n + 1 starts at downbeat + n bars); \`triads\` are the key's seven
// diatonic triads (pitch classes, root first) and \`chords\` which of them each bar's chroma fits best.
export interface TrackInfo {
  id: string; title: string; file: string; bpm: number; downbeat: number; swing: number; bars: number; duration: number;
  loop: { startBar: number; endBar: number; start: number; end: number };
  key: { tonic: number; mode: 'major' | 'minor'; name: string; cents: number };
  triads: number[][]; chords: number[];
}
export const TRACKS: Record<string, TrackInfo> = ${JSON.stringify(lean)};
/** the track each world plays (the geode's also on the hub) */
export const WORLD_TRACKS: Record<string, string> = ${JSON.stringify(m.worlds)};
/** a world's track, or null */
export const trackFor = (world: string | null | undefined): TrackInfo | null => (world && WORLD_TRACKS[world] ? TRACKS[WORLD_TRACKS[world]] ?? null : null);
`;
  writeFileSync(join(ROOT, 'shared/tracks.ts'), src);
}

/** the track with clicks on the grid (a high click on the downbeat), and the loop's seam (4 bars before it, 4 after) */
function clicks(file, t, dir) {
  mkdirSync(dir, { recursive: true });
  const rate = 48000, x = decode(file, rate, 2), n = x.length / 2, out = new Float32Array(x);
  const spb = 60 / t.bpm;
  for (let k = 0; ; k++) {
    const tt = t.downbeat + k * spb; if (tt >= n / rate) break;
    const f = k % 4 === 0 ? 2000 : 1200, i0 = Math.round(tt * rate);
    for (let i = 0; i < rate * 0.03 && i0 + i < n; i++) { const v = 0.35 * Math.sin((2 * Math.PI * f * i) / rate) * Math.exp(-i / (rate * 0.006)); out[(i0 + i) * 2] += v; out[(i0 + i) * 2 + 1] += v; }
  }
  const wav = (data, path) => {
    const b = Buffer.alloc(44 + data.length * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
    for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
    writeFileSync(path, b);
  };
  const tmp = join(dir, `${t.id}-clicks.wav`);
  wav(out, tmp);
  spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', tmp, '-c:a', 'aac', '-b:a', '192k', join(dir, `${t.id}-clicks.m4a`)]);
  // the seam: [end - 4 bars, end) then [start, start + 4 bars), a 30 ms crossfade, as the game plays it
  const bar = 4 * spb, xf = 0.03, A0 = Math.round((t.loop.end - 4 * bar) * rate), A1 = Math.round((t.loop.end + xf / 2) * rate);
  const B0 = Math.round((t.loop.start - xf / 2) * rate), B1 = Math.round((t.loop.start + 4 * bar) * rate), X = Math.round(xf * rate);
  const seam = new Float32Array(((A1 - A0) + (B1 - B0) - X) * 2);
  for (let i = 0; i < A1 - A0; i++) { const g = i >= A1 - A0 - X ? Math.cos(((i - (A1 - A0 - X)) / X) * Math.PI / 2) : 1; seam[i * 2] += x[(A0 + i) * 2] * g; seam[i * 2 + 1] += x[(A0 + i) * 2 + 1] * g; }
  const o = A1 - A0 - X;
  for (let i = 0; i < B1 - B0; i++) { const g = i < X ? Math.sin((i / X) * Math.PI / 2) : 1; seam[(o + i) * 2] += x[(B0 + i) * 2] * g; seam[(o + i) * 2 + 1] += x[(B0 + i) * 2 + 1] * g; }
  wav(seam, join(dir, `${t.id}-seam.wav`));
}

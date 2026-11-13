// Listening by measurement: what a render's numbers say about how it sounds. Peak and RMS (dBFS), the crest factor
// (peak over RMS: a squashed mix has a small one, a spiky one a large one), samples at full scale (clipping), an
// approximate loudness (ITU-R BS.1770's K-weighting, ungated, so "LUFS" here is a little lower than a meter's for
// music with pauses), the stereo correlation, and a coarse spectrum: the share of the energy in six bands, so mud
// (250-500 Hz), harshness (2-6 kHz) and a missing bottom or top show up as numbers. Pure arithmetic: it runs in the
// lab's page on rendered buffers, and in Node on WAV files.

export interface Stats {
  seconds: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  lufs: number;
  clipped: number;
  correlation: number;
  /** share of the energy (dB relative to the total) in each band */
  bands: Record<string, number>;
}

export const BANDS: [string, number, number][] = [
  ['sub <60', 0, 60], ['bass 60-250', 60, 250], ['mud 250-500', 250, 500], ['mid 500-2k', 500, 2000],
  ['harsh 2-6k', 2000, 6000], ['air 6k+', 6000, 24000],
];

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** an in-place radix-2 FFT of re/im (length a power of two) */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** a biquad run over a signal (direct form I) */
function biquad(x: Float64Array, b: number[], a: number[]) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** BS.1770's K-weighting at 48 kHz: a high shelf (+4 dB above ~1.5 kHz) and a high-pass at ~38 Hz */
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] };
const HIGHPASS = { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] };

/** the numbers for a stretch of a stereo signal (samples `from` … `to`) */
export function measure(L: Float32Array, R: Float32Array, rate: number, from = 0, to = L.length): Stats {
  const n = Math.max(1, to - from);
  let peak = 0, ss = 0, clipped = 0, lr = 0, ll = 0, rr = 0;
  const kl = new Float64Array(n), kr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const l = L[from + i], r = R[from + i];
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    ss += (l * l + r * r) / 2;
    lr += l * r; ll += l * l; rr += r * r;
    kl[i] = l; kr[i] = r;
  }
  const rms = Math.sqrt(ss / n);
  // loudness: K-weighted mean square of both channels, summed (rates other than 48 kHz get the 48 kHz filter: close enough)
  let ks = 0;
  for (const ch of [kl, kr]) {
    const k = biquad(biquad(ch, SHELF.b, SHELF.a), HIGHPASS.b, HIGHPASS.a);
    let s = 0; for (let i = 0; i < k.length; i++) s += k[i] * k[i];
    ks += s / k.length;
  }
  const lufs = -0.691 + 10 * Math.log10(Math.max(ks, 1e-12));
  // the spectrum: Hann-windowed 4096-point frames, every 2048, mono
  const N = 4096, power = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= n; s += N / 2, frames++) {
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); re[i] = ((L[from + s + i] + R[from + s + i]) / 2) * w; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  let total = 0;
  for (let k = 1; k < N / 2; k++) total += power[k];
  const bands: Record<string, number> = {};
  for (const [name, lo, hi] of BANDS) {
    let e = 0;
    for (let k = 1; k < N / 2; k++) { const f = (k * rate) / N; if (f >= lo && f < hi) e += power[k]; }
    bands[name] = frames && total > 0 ? +(10 * Math.log10(Math.max(e / total, 1e-9))).toFixed(1) : -90;
  }
  return {
    seconds: +(n / rate).toFixed(2), peak: +peak.toFixed(4), peakDb: +db(peak).toFixed(1), rmsDb: +db(rms).toFixed(1),
    crestDb: +(db(peak) - db(rms)).toFixed(1), lufs: +lufs.toFixed(1), clipped,
    correlation: +(lr / Math.sqrt(Math.max(ll * rr, 1e-18))).toFixed(2), bands,
  };
}

/** the loudest moment: the peak and where it is (s), and the loudest 400 ms window's RMS (dBFS) */
export function loudest(L: Float32Array, R: Float32Array, rate: number) {
  let peak = 0, at = 0;
  for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) { peak = a; at = i; } }
  const w = Math.floor(rate * 0.4);
  let best = 0;
  for (let s = 0; s + w <= L.length; s += Math.floor(w / 2)) {
    let e = 0; for (let i = s; i < s + w; i++) e += (L[i] * L[i] + R[i] * R[i]) / 2;
    best = Math.max(best, e / w);
  }
  return { peak: +peak.toFixed(4), at: +(at / rate).toFixed(2), maxRms400Db: +db(Math.sqrt(best)).toFixed(1) };
}

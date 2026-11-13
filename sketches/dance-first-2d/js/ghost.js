// ghost.js — record a dance as a few kilobytes, replay it as a ghost, and pack it into a link.
import { J, NJ } from './skeleton.js';

export const LOOP_STEPS = 128;           // 8 bars of 16th notes
const FRAME = 2 + NJ * 2;                // root (x, y) + 13 joints relative to it
const RX = 1.8, RY = 1.3, REL = 0.7;     // quantisation ranges
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const q8 = (v, lo, hi) => clamp(Math.round((v - lo) / (hi - lo) * 255), 0, 255);
const d8 = (b, lo, hi) => lo + (b / 255) * (hi - lo);

export class LoopRecorder {
  constructor(startRel) {
    this.startRel = startRel;
    this.frames = new Float32Array(LOOP_STEPS * NJ * 2);
    this.filled = new Uint8Array(LOOP_STEPS);
    this.events = [];
    this.done = false;
  }

  // Returns progress 0..1 (negative while counting in).
  sample(rel, pose) {
    const pos = rel - this.startRel;
    if (pos < 0) return pos / 16;
    const slot = Math.floor(pos);
    if (slot >= LOOP_STEPS) { this._finish(); return 1; }
    if (!this.filled[slot]) { this.frames.set(pose, slot * NJ * 2); this.filled[slot] = 1; }
    return pos / LOOP_STEPS;
  }

  event(rel, side) {
    const slot = Math.round(rel - this.startRel);
    if (slot >= 0 && slot < LOOP_STEPS) this.events.push({ slot, side });
  }

  _finish() {
    if (this.done) return;
    const n = NJ * 2;
    let last = -1;
    for (let i = 0; i < LOOP_STEPS; i++) if (this.filled[i]) { last = i; break; }
    if (last < 0) { this.done = true; this.empty = true; return; }
    for (let i = 0; i < LOOP_STEPS; i++) {
      if (this.filled[i]) last = i;
      else this.frames.copyWithin(i * n, last * n, last * n + n);
    }
    this.done = true;
  }

  layer() {
    return { start: ((this.startRel % 64) + 64) % 64, frames: this.frames, events: this.events.slice(0, 60) };
  }
}

// Plays a recorded loop back in time with the music.
export class GhostDancer {
  constructor(layer) {
    this.layer = layer;
    this.pose = new Float32Array(NJ * 2);
  }

  poseAt(rel) {
    const L = LOOP_STEPS, n = NJ * 2, f = this.layer.frames;
    const ph = (((rel - this.layer.start) % L) + L) % L;
    const i1 = Math.floor(ph), u = ph - i1;
    const i0 = (i1 + L - 1) % L, i2 = (i1 + 1) % L, i3 = (i1 + 2) % L;
    const u2 = u * u, u3 = u2 * u;
    for (let c = 0; c < n; c++) {
      const p0 = f[i0 * n + c], p1 = f[i1 * n + c], p2 = f[i2 * n + c], p3 = f[i3 * n + c];
      this.pose[c] = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    }
    return this.pose;
  }
}

// ---------- link encoding ----------
function packLayer(layer) {
  const ev = layer.events;
  const out = new Uint8Array(2 + ev.length * 2 + LOOP_STEPS * FRAME);
  out[0] = (layer.start & 63) | (((layer.el || 0) & 3) << 6); out[1] = ev.length;
  let o = 2;
  for (const e of ev) { out[o++] = e.slot; out[o++] = e.side < 0 ? 0 : 1; }
  const n = NJ * 2, f = layer.frames;
  // column-major with deltas: each channel is a smooth curve, which deflate loves
  const prev = new Uint8Array(FRAME);
  const cols = new Uint8Array(LOOP_STEPS * FRAME);
  for (let i = 0; i < LOOP_STEPS; i++) {
    const rx = (f[i * n + J.LH * 2] + f[i * n + J.RH * 2]) / 2, ry = (f[i * n + J.LH * 2 + 1] + f[i * n + J.RH * 2 + 1]) / 2;
    const qx = q8(rx, -RX, RX), qy = q8(ry, 0, RY);
    const rxq = d8(qx, -RX, RX), ryq = d8(qy, 0, RY);
    const row = new Uint8Array(FRAME);
    row[0] = qx; row[1] = qy;
    for (let j = 0; j < NJ; j++) {
      row[2 + j * 2] = q8(f[i * n + j * 2] - rxq, -REL, REL);
      row[3 + j * 2] = q8(f[i * n + j * 2 + 1] - ryq, -REL, REL);
    }
    for (let c = 0; c < FRAME; c++) { cols[c * LOOP_STEPS + i] = (row[c] - prev[c]) & 255; prev[c] = row[c]; }
  }
  out.set(cols, o);
  return out;
}

function unpackLayer(buf, o) {
  const b0 = buf[o++], ne = buf[o++];
  const start = b0 & 63, el = b0 >> 6;
  const events = [];
  for (let i = 0; i < ne; i++) events.push({ slot: buf[o++], side: buf[o++] ? 1 : -1 });
  const n = NJ * 2, frames = new Float32Array(LOOP_STEPS * n);
  const row = new Uint8Array(FRAME);
  for (let i = 0; i < LOOP_STEPS; i++) {
    for (let c = 0; c < FRAME; c++) row[c] = (row[c] + buf[o + c * LOOP_STEPS + i]) & 255;
    const rx = d8(row[0], -RX, RX), ry = d8(row[1], 0, RY);
    for (let j = 0; j < NJ; j++) {
      frames[i * n + j * 2] = rx + d8(row[2 + j * 2], -REL, REL);
      frames[i * n + j * 2 + 1] = ry + d8(row[3 + j * 2], -REL, REL);
    }
  }
  return { layer: { start, el, events, frames }, next: o + LOOP_STEPS * FRAME };
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const b64u = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

// header: version, mood, bpm, layer count
export async function encodeShare({ mood, bpm, layers }) {
  const parts = layers.map(packLayer);
  const raw = new Uint8Array(4 + parts.reduce((a, p) => a + p.length, 0));
  raw[0] = 1; raw[1] = mood; raw[2] = clamp(Math.round(bpm), 60, 200); raw[3] = layers.length;
  let o = 4;
  for (const p of parts) { raw.set(p, o); o += p.length; }
  if (typeof CompressionStream !== 'undefined') {
    try { return 'z' + b64u(await pipe(raw, new CompressionStream('deflate-raw'))); } catch (e) { /* fall through */ }
  }
  return 'r' + b64u(raw);
}

export async function decodeShare(str) {
  let raw = unb64u(str.slice(1));
  if (str[0] === 'z') raw = await pipe(raw, new DecompressionStream('deflate-raw'));
  if (raw[0] !== 1) throw new Error('Unknown dance format');
  const mood = raw[1], bpm = raw[2], count = Math.min(raw[3], 3);
  const layers = [];
  let o = 4;
  for (let i = 0; i < count; i++) { const r = unpackLayer(raw, o); layers.push(r.layer); o = r.next; }
  return { mood, bpm, layers };
}

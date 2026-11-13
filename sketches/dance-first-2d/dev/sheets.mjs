// dev/sheets.mjs — contact sheets: every move as a strip of stick-figure frames, seen from the FRONT
// (top row, view yaw 0: the dancer faces you) and from the SIDE (bottom row, view yaw -pi/2: forward points
// right, as in the locked 2-D view). Writes dev/sheets/<move>.png and .svg. No dependencies.
//   node dev/sheets.mjs [moveName ...]
// Colours: L limbs blue, R limbs orange, torso and head white. A red frame border = active (hit) window,
// cyan = i-frames, yellow = both. The hit capsule is drawn red in active frames. Ground line grey.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { MOVES, LOCO, J, NJ, NP, project2D } from '../js/moves.js';

const OUT = new URL('./sheets/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const FW = 120, FH = 150, PX = 150;           // frame size, pixels per figure unit
const BONES = [[J.LS, J.RS, 'c'], [J.LH, J.RH, 'c'], [-1, -2, 'c'], [J.LS, J.LE, 'l'], [J.LE, J.LW, 'l'], [J.RS, J.RE, 'r'], [J.RE, J.RW, 'r'],
  [J.LH, J.LK, 'l'], [J.LK, J.LA, 'l'], [J.RH, J.RK, 'r'], [J.RK, J.RA, 'r'], [-1, J.HEAD, 'c']];
const COL = { c: [235, 235, 235], l: [90, 160, 255], r: [255, 150, 60], hit: [255, 40, 40], g: [90, 90, 90] };

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t), d])) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { this.d[i * 4] = 18; this.d[i * 4 + 1] = 18; this.d[i * 4 + 2] = 24; this.d[i * 4 + 3] = 255; } }
  cap(x0, y0, x1, y1, r, c, a = 1) {
    const minx = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1)), maxx = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + r + 1));
    const miny = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1)), maxy = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + r + 1));
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy || 1e-9;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L));
      const d = Math.hypot(x - x0 - dx * t, y - y0 - dy * t);
      const k = Math.max(0, Math.min(1, r + 0.5 - d)) * a;
      if (k <= 0) continue;
      const i = (y * this.w + x) * 4;
      for (let ch = 0; ch < 3; ch++) this.d[i + ch] = this.d[i + ch] * (1 - k) + c[ch] * k;
    }
  }
  rect(x0, y0, x1, y1, c) { this.cap(x0, y0, x1, y0, 1, c); this.cap(x1, y0, x1, y1, 1, c); this.cap(x1, y1, x0, y1, 1, c); this.cap(x0, y1, x0, y0, 1, c); }
}

function drawFigure(cv, svg, p2, ox, oy, hit, s) {
  const X = j => ox + FW / 2 + (j === -1 ? (p2[2 * J.LS] + p2[2 * J.RS]) / 2 : j === -2 ? (p2[2 * J.LH] + p2[2 * J.RH]) / 2 : p2[2 * j]) * PX;
  const Y = j => oy + FH - 12 - (j === -1 ? (p2[2 * J.LS + 1] + p2[2 * J.RS + 1]) / 2 : j === -2 ? (p2[2 * J.LH + 1] + p2[2 * J.RH + 1]) / 2 : p2[2 * j + 1]) * PX;
  cv.cap(ox + 4, oy + FH - 12, ox + FW - 4, oy + FH - 12, 0.6, COL.g);
  svg.push(`<line x1="${ox + 4}" y1="${oy + FH - 12}" x2="${ox + FW - 4}" y2="${oy + FH - 12}" stroke="#555"/>`);
  // L limbs first (they are usually the far side in the side view), then the rest
  const order = [...BONES].sort((a, b) => (a[2] === 'l' ? -1 : 0) - (b[2] === 'l' ? -1 : 0));
  for (const [a, b, k] of order) {
    cv.cap(X(a), Y(a), X(b), Y(b), 2.2, COL[k]);
    svg.push(`<line x1="${X(a).toFixed(1)}" y1="${Y(a).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(b).toFixed(1)}" stroke="rgb(${COL[k]})" stroke-width="4" stroke-linecap="round"/>`);
  }
  cv.cap(X(J.HEAD), Y(J.HEAD), X(J.HEAD), Y(J.HEAD), 0.036 * PX, COL.c, 0.9);
  svg.push(`<circle cx="${X(J.HEAD).toFixed(1)}" cy="${Y(J.HEAD).toFixed(1)}" r="${(0.036 * PX).toFixed(1)}" fill="#ddd"/>`);
  if (hit) {
    const ax = ox + FW / 2 + hit[0] * PX, ay = oy + FH - 12 - hit[1] * PX, bx = ox + FW / 2 + hit[2] * PX, by = oy + FH - 12 - hit[3] * PX;
    cv.cap(ax, ay, bx, by, hit[4] * PX, COL.hit, 0.45);
    svg.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="rgba(255,40,40,0.45)" stroke-width="${(2 * hit[4] * PX).toFixed(1)}" stroke-linecap="round"/>`);
  }
  void s;
}

const jIdx = (name, hand) => name === 'HAND' ? (hand > 0 ? J.RW : J.LW) : name === 'ELBOW' ? (hand > 0 ? J.RE : J.LE) : J[name];
function hitSeg(def, pose, u, ctx, viewYaw) {
  const h = def.hit; if (!h || !def.active || u < def.active[0] || u > def.active[1]) return null;
  const a = jIdx(h.a, ctx.hand), b = jIdx(h.b, ctx.hand);
  const A = [pose[3 * a], pose[3 * a + 1], pose[3 * a + 2]], B = [pose[3 * b], pose[3 * b + 1], pose[3 * b + 2]];
  if (h.stream) {
    const t = (u - def.active[0]) * def.dur, L = Math.min(h.stream.len, h.stream.speed * t);
    const d = ctx.aim, l = Math.hypot(...d);
    B[0] += d[0] / l * L; B[1] += d[1] / l * L; B[2] += d[2] / l * L;
  }
  const c = Math.cos(viewYaw), s = Math.sin(viewYaw);
  return [A[0] * c - A[2] * s, A[1], B[0] * c - B[2] * s, B[1], h.r];
}

function sheet(name, frames, poseAt, def) {
  const views = [0, -Math.PI / 2];
  const W = FW * frames.length, H = FH * views.length;
  const cv = new Canvas(W, H), svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 18}" font-family="monospace" font-size="10"><rect width="100%" height="100%" fill="#121218"/>`];
  const p = new Float32Array(NP), p2 = new Float32Array(NJ * 2);
  frames.forEach((u, i) => {
    const ctx = { hand: 1, aim: [0, 0.15, 1], air: false, beat: u * 4 };
    poseAt(u, ctx, p);
    for (let v = 0; v < views.length; v++) {
      project2D(p, views[v], p2);
      const ox = i * FW, oy = v * FH;
      drawFigure(cv, svg, p2, ox, oy, def ? hitSeg(def, p, u, ctx, views[v]) : null);
      const act = def && def.active && u >= def.active[0] && u <= def.active[1];
      const ifr = def && def.iframes && u >= def.iframes[0] && u <= def.iframes[1];
      if (act || ifr) cv.rect(ox + 1, oy + 1, ox + FW - 2, oy + FH - 2, act && ifr ? [255, 230, 40] : act ? [255, 40, 40] : [40, 220, 255]);
      if (v === 0) svg.push(`<text x="${ox + 4}" y="${H + 12}" fill="#aaa">u=${u.toFixed(2)}${act ? ' A' : ''}${ifr ? ' I' : ''}</text>`);
    }
  });
  svg.push(`<text x="4" y="12" fill="#fff">${name} (top: front, bottom: side)</text></svg>`);
  writeFileSync(new URL(`${name}.png`, OUT), png(W, H, cv.d));
  writeFileSync(new URL(`${name}.svg`, OUT), svg.join('\n'));
}

const want = process.argv.slice(2);
const N = 12;
const us = n => Array.from({ length: n }, (_, i) => i / (n - 1));
for (const [name, def] of Object.entries(MOVES)) {
  if (want.length && !want.includes(name)) continue;
  if (name === 'ginga') { sheet('ginga', us(13).map(u => u), (u, ctx, out) => LOCO.ginga(out, u * 4, 1), null); continue; }
  sheet(name, us(N), (u, ctx, out) => def.pose(u, ctx, out), def);
}
if (!want.length || want.includes('loco')) {
  const L = [
    ['run.0', (o) => LOCO.run(o, 0, 1)], ['run.1', (o) => LOCO.run(o, Math.PI / 2, 1)], ['run.2', (o) => LOCO.run(o, Math.PI, 1)], ['run.3', (o) => LOCO.run(o, 1.5 * Math.PI, 1)],
    ['rise', (o) => LOCO.rise(o, 1)], ['fall', (o) => LOCO.fall(o, 1)], ['land', (o) => LOCO.land(o, 1)], ['crouch', (o) => LOCO.crouch(o, 0)],
    ['stagger.2', (o) => LOCO.stagger(o, 0.2)], ['stagger.7', (o) => LOCO.stagger(o, 0.7)], ['reform.2', (o) => LOCO.reform(o, 0.2)], ['reform.6', (o) => LOCO.reform(o, 0.6)], ['reform1', (o) => LOCO.reform(o, 1)],
  ];
  sheet('loco', L.map((_, i) => i), (i, ctx, out) => L[i][1](out), null);
  // air variants of the air-capable moves, and the strike/throw aimed up and down
  for (const n of ['martelo', 'armada', 'strike', 'throw', 'esquiva', 'spin']) sheet(n + '.air', us(8), (u, ctx, out) => MOVES[n].pose(u, Object.assign(ctx, { air: true }), out), MOVES[n]);
  sheet('throw.up', us(8), (u, ctx, out) => MOVES.throw.pose(u, Object.assign(ctx, { aim: [0.3, 0.8, 0.5] }), out), MOVES.throw);
  sheet('strike.lefthand', us(8), (u, ctx, out) => MOVES.strike.pose(u, Object.assign(ctx, { hand: -1 }), out), MOVES.strike);
}
console.log('sheets written to', OUT.pathname);

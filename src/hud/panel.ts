// A player's panel in its top corner (a slim bar on a phone): the matter's emblem ringed by the super meter, the
// name, the KOs as slanted marks toward the round's target, the hits this life as crystal pips that crack, the dash's
// readiness, and the spell slots (empty sockets until phase 2). Seat 1's panel is seat 0's mirrored: the emblem
// always on the outer edge. What never changes (the glass, the emblem, the name) is a sprite made once; the rest is
// drawn only when a value changes or a piece of it is moving (a pip cracking, a KO mark landing, a meter filling).
import type { HudPlayer, HudBeat } from './state';
import type { Box } from './layout';
import { FONT, GOLD, GOLD_HI, glass, glyph, glyphLines, glow, haloText, lift, matterOf, rgba, sprite, stamp, approach, easeOut, easeOutBack, clamp01, type Ctx } from './style';

interface Metrics {
  em: { cx: number; cy: number; disc: number; glyph: number; ring: number; ringW: number };
  name: { x: number; y: number; size: number; seat: number };
  ko: { w: number; h: number; gap: number; end: number; cy: number };
  pips: { x: number; cy: number; w: number; h: number; gap: number };
  dash: { size: number; gapBefore: number };
  slot: { size: number; gap: number; gapBefore: number };
  r: number;
}
const DESKTOP: Metrics = {
  em: { cx: 37, cy: 37, disc: 23, glyph: 29, ring: 29.5, ringW: 3.4 },
  name: { x: 76, y: 29, size: 15, seat: 9.5 },
  ko: { w: 7.5, h: 15, gap: 4.5, end: 18, cy: 24 },
  pips: { x: 77, cy: 52, w: 14, h: 20, gap: 7 },
  dash: { size: 14, gapBefore: 16 },
  slot: { size: 17, gap: 6, gapBefore: 14 },
  r: 18,
};
const COMPACT: Metrics = {
  em: { cx: 18, cy: 18, disc: 12, glyph: 15.5, ring: 15.2, ringW: 2.1 },
  name: { x: 37, y: 14.5, size: 10.5, seat: 7.5 },
  ko: { w: 4.6, h: 9.5, gap: 3, end: 10, cy: 10.5 },
  pips: { x: 38, cy: 26, w: 7, h: 10, gap: 4 },
  dash: { size: 8, gapBefore: 9 },
  slot: { size: 8.5, gap: 3.5, gapBefore: 8 },
  r: 12,
};

const CRACK = 0.55, LAND = 0.6, REFILL = 0.5;

export class PlayerPanel {
  // what is shown (eased toward the state) and the motion in flight
  private superShown = 0;
  private dashShown = 1;
  private reformShown = 0;
  private lastHits = -1;
  private lastKos = -1;
  private lastDashReady = true;
  private crackAt: number[] = [];
  private refillAt = -1;
  private landAt: number[] = [];
  private readyAt = -1;
  private flowSeen = 0;
  private gainAt = -9;
  private gainFrom = 0;
  private t = 0;
  private sig = '';
  /** the box drawn last (what to clear) */
  drawn: Box | null = null;

  constructor(readonly seat: 0 | 1) {}

  /** advance the motion; true if the panel must be drawn again this frame */
  update(p: HudPlayer, dt: number): boolean {
    this.t += dt;
    const t = this.t;
    if (this.lastHits >= 0 && p.hits > this.lastHits) for (let i = this.lastHits; i < p.hits; i++) this.crackAt[i] = t;
    if (this.lastHits > 0 && p.hits < this.lastHits) { this.refillAt = t; this.crackAt = []; }
    if (this.lastKos >= 0 && p.kos > this.lastKos) for (let i = this.lastKos; i < p.kos; i++) this.landAt[i] = t + (i - this.lastKos) * 0.08;
    if (p.kos < this.lastKos) this.landAt = [];
    const ready = p.dash >= 0.999;
    if (ready && !this.lastDashReady) this.readyAt = t;
    this.lastDashReady = ready;
    this.lastHits = p.hits; this.lastKos = p.kos;
    const s0 = this.superShown, d0 = this.dashShown, r0 = this.reformShown;
    this.superShown = Math.abs(p.superMeter - s0) < 0.002 ? p.superMeter : approach(s0, p.superMeter, 10, dt);
    // (the dash's recharge is shown as it is: it is already a smooth ramp; only a refill jumps, and that eases)
    this.dashShown = p.dash < d0 ? p.dash : Math.abs(p.dash - d0) < 0.004 ? p.dash : approach(d0, p.dash, 22, dt);
    this.reformShown = Math.abs(p.reforming - r0) < 0.003 ? p.reforming : approach(r0, p.reforming, 16, dt);
    // flow gained (a good move): the ring's pulse starts from what it was
    if (p.superMeter > this.flowSeen + 0.012) { this.gainAt = t; this.gainFrom = this.flowSeen; }
    this.flowSeen = p.superMeter;
    const moving = this.crackAt.some((c) => t - c < CRACK) || this.landAt.some((c) => t - c < LAND) || t - this.refillAt < REFILL + 0.3
      || t - this.readyAt < 0.4;
    // (the flow ring is the live layer's: drawFlow, every frame)
    const sig = [p.name, p.color, p.matter, p.hits, p.hitsMax, p.kos, this.dashShown.toFixed(3), this.reformShown.toFixed(3),
      p.charges.map((c) => `${c.n}/${c.max}:${c.ready.toFixed(2)}`).join(',')].join('|');
    const changed = sig !== this.sig;
    this.sig = sig;
    return changed || moving;
  }

  /** forget the drawn state (a resize: everything is drawn again) */
  invalidate() { this.sig = ''; }

  draw(g: Ctx, p: HudPlayer, box: Box, compact: boolean, u: number, koTarget: number, dpr: number) {
    const M = compact ? COMPACT : DESKTOP, flip = this.seat === 1;
    /** x within the panel from its outer edge, in units → canvas px */
    const X = (x: number) => (flip ? box.x + box.w - x * u : box.x + x * u);
    const Y = (y: number) => box.y + y * u;
    const t = this.t, col = p.color, [deep, light] = matterOf(p.matter);

    // ---------------------------------------------------------------- the still part (a sprite)
    const key = `panel:${this.seat}:${compact}:${box.w.toFixed(1)}:${box.h.toFixed(1)}:${u.toFixed(3)}:${p.name}:${col}:${p.matter}`;
    const still = sprite(key, dpr, box.w + 24 * u, box.h + 24 * u, 12 * u, 12 * u, (s) => {
      s.translate(12 * u, 12 * u);
      const x = (v: number) => (flip ? box.w - v * u : v * u), y = (v: number) => v * u;
      glass(s, 0, 0, box.w, box.h, M.r * u, col, flip ? 'right' : 'left');
      // the emblem: a dark well with the matter's glyph in it, its glow behind
      const ecx = x(M.em.cx), ecy = y(M.em.cy);
      stamp(s, glow(deep, M.em.ring * u * 1.25, dpr, 0.4), ecx, ecy);
      const well = s.createRadialGradient(ecx, ecy - M.em.disc * u * 0.3, 0, ecx, ecy, M.em.disc * u);
      well.addColorStop(0, 'rgba(30,24,44,0.95)');
      well.addColorStop(1, 'rgba(8,6,14,0.95)');
      s.beginPath(); s.arc(ecx, ecy, M.em.disc * u, 0, Math.PI * 2);
      s.fillStyle = well; s.fill();
      s.lineWidth = 1; s.strokeStyle = rgba(light, 0.35); s.stroke();
      s.save();
      s.translate(ecx, ecy);
      const gs = M.em.glyph * u;
      const gg = s.createLinearGradient(0, -gs / 2, 0, gs / 2);
      gg.addColorStop(0, light); gg.addColorStop(0.55, lift(deep, 0.25)); gg.addColorStop(1, deep);
      glyph(s, p.matter, gs);
      s.fillStyle = gg; s.fill();
      glyphLines(s, p.matter, gs);
      s.lineWidth = Math.max(0.8, u * (compact ? 0.7 : 1.1)); s.strokeStyle = 'rgba(255,255,255,0.5)'; s.stroke();
      s.restore();
      // the name, in caps, and the seat after it
      s.font = `600 ${M.name.size * u}px ${FONT}`;
      s.letterSpacing = `${(M.name.size * u * 0.08).toFixed(2)}px`;
      s.textBaseline = 'alphabetic';
      s.textAlign = flip ? 'right' : 'left';
      const koSpan = (M.ko.end + koTarget * (M.ko.w + M.ko.gap)) * u;
      let name = p.name.toUpperCase();
      const room = box.w - M.name.x * u - koSpan - 8 * u;
      while (name.length > 1 && s.measureText(name).width > room) name = name.slice(0, -1);
      if (name !== p.name.toUpperCase()) name = name.slice(0, -1) + '…';
      haloText(s, name, x(M.name.x), y(M.name.y), '#f4f0fa', 0.45, Math.max(2, 2.6 * u));
      const nw = s.measureText(name).width;
      s.font = `700 ${M.name.seat * u}px ${FONT}`;
      s.letterSpacing = `${(M.name.seat * u * 0.12).toFixed(2)}px`;
      s.fillStyle = rgba(lift(col, 0.35), 0.85);
      s.fillText(`P${this.seat + 1}`, flip ? x(M.name.x) - nw - 6 * u : x(M.name.x) + nw + 6 * u, y(M.name.y));
    });
    stamp(g, still, box.x, box.y);
    this.drawn = { x: box.x - 12 * u, y: box.y - 12 * u, w: box.w + 24 * u, h: box.h + 24 * u };

    const ecx = X(M.em.cx), ecy = Y(M.em.cy);
    g.lineCap = 'round';
    // reforming: the glyph dims and a thin arc fills inside the ring
    if (this.reformShown > 0.003) {
      g.beginPath(); g.arc(ecx, ecy, M.em.disc * u - 0.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(8,6,14,0.62)'; g.fill();
      g.lineWidth = Math.max(1.2, 1.6 * u);
      g.beginPath(); g.arc(ecx, ecy, M.em.disc * u - 3 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.reformShown);
      g.strokeStyle = rgba(light, 0.9); g.stroke();
    }
    g.lineCap = 'butt';

    // ---------------------------------------------------------------- the KOs: slanted marks toward the target
    const K = M.ko, n = Math.max(1, koTarget);
    for (let i = 0; i < n; i++) {
      // from the inner end of the run (nearest the name) outward: the far edge is where the target is
      const xi = box.w / u - K.end - (n - 1 - i) * (K.w + K.gap) - K.w / 2;
      const cx = X(xi), cy = Y(K.cy);
      const filled = i < p.kos;
      const land = this.landAt[i] != null ? (t - this.landAt[i]) / LAND : 2;
      const sc = filled && land >= 0 && land < 1 ? 1 + 0.9 * (1 - easeOut(land / 0.4)) : 1;
      if (filled && land >= 0 && land < 1) stamp(g, glow(lift(col, 0.4), K.h * u * 2.2, dpr, 0.7), cx, cy, 0.6 + land * 0.9, 1 - land);
      ko(g, cx, cy, K.w * u * sc, K.h * u * sc, flip, filled, col, filled && land >= 0 && land < 0.35 ? 1 - land / 0.35 : 0);
    }

    // ---------------------------------------------------------------- the hits: crystal pips that crack
    const P = M.pips, max = Math.max(1, p.hitsMax);
    for (let i = 0; i < max; i++) {
      const cx = X(P.x + P.w / 2 + i * (P.w + P.gap)), cy = Y(P.cy), w = P.w * u, h = P.h * u;
      // pips break from the inner end: the first hit takes the one nearest the dash
      const j = max - 1 - i;
      const broken = j < p.hits;
      const c = this.crackAt[j] != null ? (t - this.crackAt[j]) / CRACK : 2;
      if (!broken) {
        const rf = this.refillAt >= 0 ? (t - this.refillAt - i * 0.09) / REFILL : 2;
        if (rf < 0) { socket(g, cx, cy, w, h, false); continue; }
        const k = rf < 1 ? easeOutBack(rf) : 1;
        pip(g, cx, cy, w * k, h * k, col, rf < 1 ? clamp01(1 - rf * 2) : 0, flip);
      } else if (c < 1) crack(g, cx, cy, w, h, col, c, flip);
      else socket(g, cx, cy, w, h, true);
    }

    // ---------------------------------------------------------------- the dash
    let x = P.x + max * (P.w + P.gap) - P.gap + M.dash.gapBefore;
    const D = M.dash.size, ready = this.dashShown >= 0.999;
    const dcx = X(x + D * 0.7), dcy = Y(P.cy);
    const flash = this.readyAt >= 0 ? clamp01(1 - (t - this.readyAt) / 0.4) : 0;
    if (ready) stamp(g, glow(lift(col, 0.3), D * u * 1.6, dpr, 0.45), dcx, dcy, 1, 0.55 + 0.6 * flash);
    chevrons(g, dcx, dcy - D * u * 0.12, D * u, flip, ready ? lift(col, 0.55 + 0.45 * flash) : 'rgba(255,255,255,0.3)', Math.max(1.3, 1.9 * u * (D / 13)));
    // the recharge, a hairline under the chevrons
    const bw = D * u * 1.5, by = dcy + D * u * 0.62;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(dcx - bw / 2, by, bw, Math.max(1, 1.6 * u * (D / 13)));
    if (!ready && this.dashShown > 0) {
      g.fillStyle = rgba(lift(col, 0.3), 0.9);
      const fw = bw * this.dashShown;
      g.fillRect(flip ? dcx + bw / 2 - fw : dcx - bw / 2, by, fw, Math.max(1, 1.6 * u * (D / 13)));
    }
    x += D * 1.4;

    // ---------------------------------------------------------------- the spell slots
    const S = M.slot, slots = Math.max(2, p.charges.length);
    x += S.gapBefore;
    for (let i = 0; i < slots; i++) {
      const sx = X(x + S.size / 2 + i * (S.size + S.gap)), sy = Y(P.cy), s = S.size * u;
      slot(g, sx, sy, s, p.charges[i] ?? null, col, u * (S.size / 16));
    }
  }

  /** the flow meter round the emblem (the super's fuel: dancing well fills it), alive on the live layer: it breathes
   *  on each beat, a bright current runs along what is filled once a beat, a gain (a good move) flashes the new part
   *  and sends a ring out; full, it turns gold and glints */
  drawFlow(g: Ctx, p: HudPlayer, box: Box, compact: boolean, u: number, beat: HudBeat, dpr: number, out: Box[]) {
    const M = compact ? COMPACT : DESKTOP, flip = this.seat === 1, t = this.t, col = p.color;
    const ecx = flip ? box.x + box.w - M.em.cx * u : box.x + M.em.cx * u, ecy = box.y + M.em.cy * u;
    const R = M.em.ring * u, W = M.em.ringW * u, f = this.superShown, full = f >= 0.999;
    const spb = 60 / Math.max(30, beat.bpm || 120), ph = ((beat.phase % 1) + 1) % 1;
    const breath = f > 0.02 ? Math.exp(-ph * spb * 7) : 0;
    const gain = clamp01(1 - (t - this.gainAt) / 0.6);
    const dir = flip ? -1 : 1, a0 = -Math.PI / 2, span = Math.PI * 2 * f;
    const at = (k: number) => a0 + dir * span * k;
    g.lineCap = 'round';
    // the track
    g.lineWidth = W; g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.beginPath(); g.arc(ecx, ecy, R, 0, Math.PI * 2); g.stroke();
    if (f > 0.004) {
      if (full) stamp(g, glow(GOLD, R * 1.7, dpr, 0.5), ecx, ecy, 1, 0.45 + 0.5 * breath);
      else if (gain > 0) stamp(g, glow(lift(col, 0.3), R * 1.6, dpr, 0.5), ecx, ecy, 1, gain * 0.9);
      // what is filled, swelling on the beat
      g.lineWidth = W * (1 + 0.55 * breath + 0.4 * gain);
      g.strokeStyle = full ? GOLD_HI : lift(col, 0.22 + 0.35 * breath);
      g.beginPath(); g.arc(ecx, ecy, R, a0, at(1), flip); g.stroke();
      // the part just gained, white as it lands, and a ring going out
      if (gain > 0 && !full) {
        const k0 = clamp01(this.gainFrom / Math.max(f, 1e-3));
        g.strokeStyle = `rgba(255,255,255,${(0.9 * gain).toFixed(3)})`;
        g.beginPath(); g.arc(ecx, ecy, R, at(k0), at(1), flip); g.stroke();
        g.lineWidth = Math.max(1, 1.4 * u * gain);
        g.strokeStyle = rgba(lift(col, 0.5), 0.8 * gain);
        g.beginPath(); g.arc(ecx, ecy, R + W + 7 * u * (1 - gain), 0, Math.PI * 2); g.stroke();
      }
      // the current: a short bright run along the filled part, once a beat
      if (span > 0.25) {
        const len = Math.min(0.7, span * 0.28), head = a0 + dir * (len + (span - len) * ph);
        g.lineWidth = W * 0.9;
        g.strokeStyle = `rgba(255,255,255,${full ? '0.85' : '0.6'})`;
        g.beginPath(); g.arc(ecx, ecy, R, head - dir * len, head, flip); g.stroke();
      }
      // the leading end: a spark
      const e = at(1);
      stamp(g, glow(full ? '#ffffff' : lift(col, 0.5), W * 2.6, dpr, 0.9), ecx + Math.cos(e) * R, ecy + Math.sin(e) * R, 1, 0.6 + 0.4 * breath);
    }
    g.lineCap = 'butt';
    const h = R * 1.75 + 2;
    out.push({ x: ecx - h, y: ecy - h, w: 2 * h, h: 2 * h });
  }
}

// ---------------------------------------------------------------- the pieces

function diamond(g: Ctx, cx: number, cy: number, w: number, h: number) {
  g.beginPath();
  g.moveTo(cx, cy - h / 2); g.lineTo(cx + w / 2, cy); g.lineTo(cx, cy + h / 2); g.lineTo(cx - w / 2, cy);
  g.closePath();
}

/** an intact pip: a cut crystal in the player's colour, `white` its flash as it reforms */
function pip(g: Ctx, cx: number, cy: number, w: number, h: number, col: string, white: number, flip: boolean) {
  if (w < 0.5) return;
  const gr = g.createLinearGradient(cx, cy - h / 2, cx, cy + h / 2);
  gr.addColorStop(0, lift(col, 0.7)); gr.addColorStop(0.5, lift(col, 0.15)); gr.addColorStop(1, rgba(col, 0.85));
  diamond(g, cx, cy, w, h);
  g.fillStyle = gr; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke();
  // a facet catching the light
  const s = flip ? -1 : 1;
  g.beginPath();
  g.moveTo(cx, cy - h / 2); g.lineTo(cx - s * w / 2, cy); g.lineTo(cx - s * w * 0.08, cy - h * 0.06);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.32)'; g.fill();
  if (white > 0) { diamond(g, cx, cy, w, h); g.fillStyle = `rgba(255,255,255,${white.toFixed(3)})`; g.fill(); }
}

/** a broken pip's socket: dark, a hairline round it, the crack left in it */
function socket(g: Ctx, cx: number, cy: number, w: number, h: number, cracked: boolean) {
  diamond(g, cx, cy, w, h);
  g.fillStyle = 'rgba(0,0,0,0.32)'; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.2)'; g.stroke();
  if (cracked) {
    g.beginPath();
    crackLine(g, cx, cy, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.stroke();
  }
}

function crackLine(g: Ctx, cx: number, cy: number, w: number, h: number) {
  g.moveTo(cx + w * 0.04, cy - h / 2);
  g.lineTo(cx - w * 0.14, cy - h * 0.14);
  g.lineTo(cx + w * 0.12, cy + h * 0.1);
  g.lineTo(cx - w * 0.03, cy + h / 2);
}

/** a pip cracking: a white flash, then two halves falling apart along the crack and three shards flying (u 0 … 1) */
function crack(g: Ctx, cx: number, cy: number, w: number, h: number, col: string, u: number, flip: boolean) {
  socket(g, cx, cy, w, h, u > 0.4);
  const e = easeOut(u), a = 1 - u;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(cx + side * w * 0.55 * e, cy + h * 0.5 * u * u);
    g.rotate(side * 0.5 * e);
    g.translate(-cx, -cy);
    g.beginPath();
    g.moveTo(cx + w * 0.04, cy - h / 2);
    g.lineTo(cx - w * 0.14, cy - h * 0.14);
    g.lineTo(cx + w * 0.12, cy + h * 0.1);
    g.lineTo(cx - w * 0.03, cy + h / 2);
    g.lineTo(cx + side * w / 2, cy);
    g.closePath();
    g.globalAlpha = a;
    g.fillStyle = lift(col, 0.35 + 0.65 * clamp01(1 - u * 5));
    g.fill();
    g.globalAlpha = 1;
    g.restore();
  }
  // shards
  const s = flip ? -1 : 1;
  g.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(3)})`;
  for (let k = 0; k < 3; k++) {
    const ang = -Math.PI / 2 + (k - 1) * 0.9 * s, d = (w * 0.6 + h * 0.9 * e) * (0.7 + 0.25 * k);
    const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d + h * 0.6 * u * u, r = w * 0.16 * a;
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r * 0.6); g.closePath(); g.fill();
  }
  if (u < 0.2) { diamond(g, cx, cy, w * (1 + u), h * (1 + u)); g.fillStyle = `rgba(255,255,255,${(0.9 * (1 - u / 0.2)).toFixed(3)})`; g.fill(); }
}

/** a KO mark: a slanted bar, filled in the player's colour once scored */
function ko(g: Ctx, cx: number, cy: number, w: number, h: number, flip: boolean, filled: boolean, col: string, white: number) {
  const s = w * 0.32 * (flip ? -1 : 1);
  g.beginPath();
  g.moveTo(cx - w / 2 + s, cy - h / 2); g.lineTo(cx + w / 2 + s, cy - h / 2);
  g.lineTo(cx + w / 2 - s, cy + h / 2); g.lineTo(cx - w / 2 - s, cy + h / 2);
  g.closePath();
  if (filled) {
    const gr = g.createLinearGradient(cx, cy - h / 2, cx, cy + h / 2);
    gr.addColorStop(0, lift(col, 0.6)); gr.addColorStop(1, lift(col, 0.05));
    g.fillStyle = gr; g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.45)'; g.stroke();
    if (white > 0) { g.fillStyle = `rgba(255,255,255,${white.toFixed(3)})`; g.fill(); }
  } else {
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.24)'; g.stroke();
  }
}

/** the dash: two chevrons pointing the way the panel faces (inward) */
function chevrons(g: Ctx, cx: number, cy: number, s: number, flip: boolean, col: string, lw: number) {
  const d = flip ? -1 : 1;
  g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = col;
  g.beginPath();
  for (const o of [-0.38, 0.12]) {
    const x = cx + d * o * s;
    g.moveTo(x - d * s * 0.22, cy - s * 0.38); g.lineTo(x + d * s * 0.2, cy); g.lineTo(x - d * s * 0.22, cy + s * 0.38);
  }
  g.stroke();
  g.lineCap = 'butt';
}

/** a spell slot: an empty socket until phase 2; then filled by its readiness, its charges as dots under it */
function slot(g: Ctx, cx: number, cy: number, s: number, c: { n: number; max: number; ready: number } | null, col: string, k: number) {
  const r = s * 0.28;
  const x = cx - s / 2, y = cy - s / 2;
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + s, y, x + s, y + s, r); g.arcTo(x + s, y + s, x, y + s, r); g.arcTo(x, y + s, x, y, r); g.arcTo(x, y, x + s, y, r);
  g.closePath();
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fill();
  g.lineWidth = 1; g.strokeStyle = c ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.14)'; g.stroke();
  if (!c) return;
  const f = c.n > 0 ? 1 : clamp01(c.ready);
  if (f > 0) {
    g.save(); g.clip();
    g.fillStyle = c.n > 0 ? rgba(lift(col, 0.35), 0.85) : rgba(col, 0.4);
    g.fillRect(x, y + s * (1 - f), s, s * f);
    g.restore();
  }
  for (let i = 0; i < c.max; i++) {
    const dx = cx + (i - (c.max - 1) / 2) * 3.4 * k;
    g.beginPath(); g.arc(dx, cy + s / 2 + 3.2 * k, 1.1 * k, 0, Math.PI * 2);
    g.fillStyle = i < c.n ? '#ffffff' : 'rgba(255,255,255,0.22)'; g.fill();
  }
}


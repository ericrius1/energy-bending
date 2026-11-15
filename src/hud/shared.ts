// The shared energy, drawn as one thing between the two panels: a strand of light from each panel, in its dancer's
// colour, flowing toward the set's orb in the middle. Both strands are the one value (the dance's intensity, which
// only rises when the two play together), so they grow toward the orb together and touch it at full; they flow
// faster and swell as it rises, a pulse runs along them on each beat, and the set's peak is marked on both. In the orb
// the **merge** (the fusion's charge) grows: a core of both colours turning, from a seed to the whole orb, blooming
// gold when full. Round the orb runs the set's time on the music: a progress arc against the set's length, ticked
// every four bars, its head swelling on each beat, gold through the finale; the time left under it.
import type { HudState } from './state';
import type { Layout, Box } from './layout';
import { GOLD, GOLD_HI, INK, glow, label, leaded, leadGold, leaf, lift, petals, rgba, sprite, stamp, stampLabel, approach, clamp01, type Ctx } from './style';
import { PALETTE } from './theme';

const mmss = (s: number) => { s = Math.max(0, Math.ceil(s - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const N = 26;
/** how far the sun's crown of petals reaches past its disc (the set's ring runs just outside it) */
const crownOf = (u: number, small: boolean) => (small ? 4.2 : 6) * u;

/** the clock's times for a set of this length, to make ahead (Hud's warm-up) */
export function warmShared(st: HudState, L: Layout, dpr: number): (() => void)[] {
  const u = L.u, fs = (L.compact ? 9 : 12) * u, out: (() => void)[] = [];
  for (let s = Math.ceil(st.set.length); s >= 0; s--) for (const c of [INK, GOLD_HI]) out.push(() => { label(mmss(s), fs, 600, 0.08, c, 0.5, Math.max(2, 2.6 * u), dpr); });
  return out;
}

/** the sun's petals lit (the merge's bloom over the still crown) */
function sunPetals(R: number, u: number, small: boolean, dpr: number) {
  const r1 = R + crownOf(u, small), P = r1 + 4;
  return sprite(`sunpetals:${R.toFixed(2)}:${u.toFixed(3)}:${small}`, dpr, P * 2, P * 2, P, P, (s) => {
    s.beginPath();
    petals(s, P, P, R * 0.96, r1, 12, -Math.PI / 2);
    const gr = s.createRadialGradient(P, P, R, P, P, r1);
    gr.addColorStop(0, PALETTE.sunHi); gr.addColorStop(1, PALETTE.sun);
    s.fillStyle = gr; s.fill();
    s.lineWidth = Math.max(0.6, 0.6 * u); s.strokeStyle = rgba(PALETTE.honey, 0.8); s.stroke();
  });
}

export class Shared {
  private t = 0;
  private e = 0;
  private m = 0;
  private seen = false;

  update(st: HudState, dt: number) {
    this.t += dt;
    const s = st.shared;
    if (!this.seen) { this.e = s.energy; this.m = s.merge; this.seen = true; }
    this.e = approach(this.e, clamp01(s.energy), 7, dt);
    this.m = approach(this.m, clamp01(s.merge), 6, dt);
  }

  draw(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[]) {
    const u = L.u, O = L.orb, S = L.shared, t = this.t, e = this.e, m = this.m;
    const spb = 60 / Math.max(30, st.beat.bpm || 120), ph = ((st.beat.phase % 1) + 1) % 1;
    const beatK = Math.exp(-ph * spb * 6);
    const [a, b] = [st.players.find((p) => p.seat === 0), st.players.find((p) => p.seat === 1)];
    const ca = a?.color ?? '#ff7a4a', cb = b?.color ?? '#4ab0ff';
    const y = S.y, gap = 5 * u;
    const ends: [number, number, string, number][] = [[S.x0, O.x - O.r - gap, ca, 1], [S.x1, O.x + O.r + gap, cb, -1]];
    const peak = clamp01(st.shared.peak);

    const R = O.r, cx = O.x, cy = O.y, Se = st.set;
    const finale = Se.phase === 'finale', full = m >= 0.995;
    const len0 = Math.max(1, Se.length), Ra = R + crownOf(u, L.compact) + (L.compact ? 2.8 : 3.6) * u, a0 = -Math.PI / 2;
    if (full || finale) stamp(g, glow(GOLD, R * 2.2, dpr, 0.45), cx, cy, 1 + 0.08 * beatK, (full ? 0.55 : 0.3) + 0.35 * beatK);
    // what stays still (the strands' track to the orb, the orb's well, the set's ring and its ticks every four bars):
    // a sprite, made again only for a new size, set length or tempo
    const sx0 = Math.min(S.x0, S.x1) - 4 * u, sx1 = Math.max(S.x0, S.x1) + 4 * u, sy0 = Math.min(y, cy) - Ra - 8 * u, sy1 = Math.max(y, cy) + Ra + 8 * u;
    const still = sprite(`shared2:${L.W}x${L.H}:${len0.toFixed(1)}:${spb.toFixed(4)}:${finale}`, dpr, sx1 - sx0, sy1 - sy0, cx - sx0, cy - sy0, (s) => {
      s.translate(-sx0, -sy0);
      s.lineCap = 'round';
      // the strands' track: a stem from each panel to the sun, small leaves along it in pairs
      for (const [x0, x1, , dir] of ends) {
        if (dir * (x1 - x0) <= 4 * u) continue;
        s.lineWidth = 3 * u; s.strokeStyle = 'rgba(14,10,4,0.3)';
        s.beginPath(); s.moveTo(x0, y); s.lineTo(x1, y); s.stroke();
        s.lineWidth = Math.max(1, 0.9 * u); s.strokeStyle = rgba(PALETTE.brass, 0.32); s.stroke();
        const span = Math.abs(x1 - x0), step = (L.compact ? 22 : 30) * u, n = Math.floor(span / step), lf = (L.compact ? 3.2 : 4.6) * u;
        s.beginPath();
        for (let i = 1; i < n; i++) {
          const lx = x0 + dir * i * step, up = i % 2 ? -1 : 1;
          leaf(s, lx, y, lf, lf * 0.55, (dir > 0 ? 0 : Math.PI) + up * (dir > 0 ? 1 : -1) * 0.75);
        }
        s.fillStyle = rgba(PALETTE.moss, 0.55); s.fill();
        s.lineWidth = Math.max(0.5, 0.5 * u); s.strokeStyle = rgba(PALETTE.leaf, 0.3); s.stroke();
      }
      // the sun: a crown of petals round a deep honey disc in gold leading
      s.beginPath();
      petals(s, cx, cy, R * 0.96, R + crownOf(u, L.compact), 12, -Math.PI / 2);
      s.fillStyle = leadGold(s, cy - R, R * 2, 0.8); s.fill();
      s.lineWidth = Math.max(0.5, 0.6 * u); s.strokeStyle = 'rgba(40,26,8,0.5)'; s.stroke();
      const well = s.createRadialGradient(cx, cy - R * 0.35, 0, cx, cy, R);
      well.addColorStop(0, 'rgba(74,55,26,0.9)'); well.addColorStop(1, 'rgba(18,13,6,0.88)');
      s.beginPath(); s.arc(cx, cy, R, 0, Math.PI * 2);
      s.fillStyle = well; s.fill();
      leaded(s, cy - R, R * 2, Math.max(1, 1.1 * u));
      s.lineWidth = 3.4 * u; s.strokeStyle = 'rgba(14,10,4,0.32)';
      s.beginPath(); s.arc(cx, cy, Ra, 0, Math.PI * 2); s.stroke();
      s.lineWidth = Math.max(1, 1.2 * u); s.strokeStyle = finale ? rgba(GOLD, 0.45) : rgba(PALETTE.brass, 0.32); s.stroke();
      const phrase = spb * 16;
      s.lineWidth = Math.max(1, 1.1 * u);
      s.strokeStyle = rgba(PALETTE.parchment, 0.42);
      s.beginPath();
      for (let q = phrase; q < len0 - 0.5; q += phrase) {
        const an = a0 + (Math.PI * 2 * q) / len0, c = Math.cos(an), sn = Math.sin(an);
        s.moveTo(cx + c * (Ra + 2.2 * u), cy + sn * (Ra + 2.2 * u)); s.lineTo(cx + c * (Ra + 4.8 * u), cy + sn * (Ra + 4.8 * u));
      }
      s.stroke();
    });
    stamp(g, still, cx, cy);
    // the sun opens as the merge grows: its petals brighten to full gold
    if (m > 0.01) stamp(g, sunPetals(R, u, L.compact, dpr), cx, cy, 1, Math.min(1, m * 1.15));

    // ---------------------------------------------------------------- the strands
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [x0, x1, col, dir] of ends) {
      const span = x1 - x0;
      if (dir * span <= 4 * u) continue;
      const len = span * e, head = x0 + len;
      if (Math.abs(len) > 1.5 * u) {
        const A = (1.2 + 3.6 * e) * u, k = (Math.PI * 2) / (96 * u), w = (2.4 + 4.5 * e) * (1 + 0.4 * beatK);
        // the soft band under the filaments
        g.lineWidth = (3 + 5 * e) * u * (1 + 0.25 * beatK);
        g.strokeStyle = rgba(col, 0.14 + 0.14 * e);
        g.beginPath(); g.moveTo(x0, y); g.lineTo(head, y); g.stroke();
        // two filaments braiding toward the orb: the ribbon's edge in its colour, and its light
        g.lineJoin = 'bevel';
        for (let f = 0; f < 2; f++) {
          g.beginPath();
          for (let i = 0; i <= N; i++) {
            const q = i / N, x = x0 + len * q;
            const taper = Math.pow(1 - q, 0.5) * Math.min(1, 0.4 + q * 4);
            const yy = y + A * taper * Math.sin(dir * (x - x0) * k * (1 + 0.15 * f) - t * w + f * Math.PI);
            if (i) g.lineTo(x, yy); else g.moveTo(x, yy);
          }
          g.lineWidth = (f ? 1.0 : 1.6) * u;
          g.strokeStyle = rgba(lift(col, f ? 0.7 : 0.3), (f ? 0.7 : 0.8) + 0.2 * e);
          g.stroke();
        }
        // the beat's pulse, running along to the head
        stamp(g, glow(lift(col, 0.55), (4 + 5 * e) * u, dpr, 0.85), x0 + len * ph, y, 1, 0.25 + 0.6 * e * (1 - ph * 0.5));
        // the head: a spark
        stamp(g, glow(lift(col, 0.7), (5 + 6 * e) * u, dpr, 0.9), head, y, 1 + 0.3 * beatK, 0.7 + 0.3 * e);
      }
      // the set's peak
      if (peak > 0.01) {
        const px = x0 + span * peak, hh = 6.5 * u;
        g.lineWidth = Math.max(1, 1.2 * u);
        g.strokeStyle = rgba(GOLD_HI, 0.75);
        g.beginPath(); g.moveTo(px, y - hh); g.lineTo(px, y + hh); g.stroke();
        g.beginPath(); g.moveTo(px, y - hh - 2.6 * u); g.lineTo(px + 2 * u, y - hh - 0.6 * u); g.lineTo(px, y - hh + 1.4 * u); g.lineTo(px - 2 * u, y - hh - 0.6 * u); g.closePath();
        g.fillStyle = GOLD; g.fill();
      }
    }
    g.lineCap = 'butt';

    // ---------------------------------------------------------------- the orb: the merge in it, the set round it
    // the merge: both colours turning, growing from a seed, its heart whitening as it fills
    const rc = R * (0.16 + 0.8 * Math.sqrt(m));
    if (m > 0.004 || e > 0.02) {
      stamp(g, glow(lift(ca, 0.3), rc * 1.6, dpr, 0.35), cx - rc * 0.25, cy, 1, 0.3 + 0.4 * m);
      stamp(g, glow(lift(cb, 0.3), rc * 1.6, dpr, 0.35), cx + rc * 0.25, cy, 1, 0.3 + 0.4 * m);
      const cg = g.createConicGradient(t * (0.7 + 2.4 * m), cx, cy);
      cg.addColorStop(0, lift(ca, 0.15)); cg.addColorStop(0.5, lift(cb, 0.15)); cg.addColorStop(1, lift(ca, 0.15));
      g.beginPath(); g.arc(cx, cy, rc * (1 + 0.06 * beatK), 0, Math.PI * 2);
      g.fillStyle = cg; g.fill();
      g.lineWidth = Math.max(1, u); g.strokeStyle = rgba(PALETTE.sunHi, 0.35 + 0.4 * m); g.stroke();
      stamp(g, glow(PALETTE.sunHi, Math.max(2, rc * 0.9), dpr, 0.9), cx, cy, 1, 0.3 + 0.7 * m * m);
    }
    // the set's time on the music: the arc so far, its head swelling on the beat
    const k = clamp01(Se.time / len0);
    g.lineCap = 'round';
    if (k > 0.002) {
      g.lineWidth = 2 * u;
      g.strokeStyle = finale ? GOLD_HI : rgba(PALETTE.cream, 0.92);
      g.beginPath(); g.arc(cx, cy, Ra, a0, a0 + Math.PI * 2 * k); g.stroke();
      const ah = a0 + Math.PI * 2 * k;
      stamp(g, glow(finale ? GOLD : PALETTE.sunHi, 4.5 * u, dpr, 0.9), cx + Math.cos(ah) * Ra, cy + Math.sin(ah) * Ra, 1 + 0.6 * beatK, 0.7 + 0.3 * beatK);
    }
    g.lineCap = 'butt';
    // the time left, under it
    if (Se.phase !== 'done') {
      const fs = (L.compact ? 9 : 12) * u, ty = cy + Ra + (L.compact ? 5 : 8) * u;
      stampLabel(g, label(mmss(len0 - (Se.phase === 'intro' ? 0 : Se.time)), fs, 600, 0.08, finale ? GOLD_HI : INK, 0.5, Math.max(2, 2.6 * u), dpr), cx + fs * 0.04, ty + fs * 0.95, 'center');
      if (!L.compact && (finale || full)) stampLabel(g, label(full ? 'FUSION' : 'FINALE', 7.5 * u, 700, 0.3, rgba(GOLD, 0.85), 0, 0, dpr), cx + 7.5 * u * 0.15, ty + fs * 1.3 + 7.5 * u * 0.95, 'center');
    }
    const bx0 = Math.min(S.x0, S.x1) - 10 * u, bx1 = Math.max(S.x0, S.x1) + 10 * u;
    const top = Math.min(y - 14 * u, cy - R * 2.3), bottom = Math.max(y + 14 * u, cy + Ra + 46 * u);
    out.push({ x: Math.min(bx0, cx - R * 2.3), y: top, w: Math.max(bx1, cx + R * 2.3) - Math.min(bx0, cx - R * 2.3), h: bottom - top });
  }
}

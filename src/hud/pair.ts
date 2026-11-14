// The pair combo (phase 3: the two's chain of contact links, shared by both: shared/duel.ts PairCombo), drawn as one
// thing under the set's orb, between the two panels: a small chip with a dot of each dancer's colour either side of
// the count ("×9"), the word of its tier once it has one (DUET, CURRENT, MURMURATION, AURORA) in the tier's colour,
// a line under it running from one dancer's colour to the other's. It breathes on the beat, bumps as each link comes,
// and when the chain ends it rises into the orb (banked) or greys and sinks (dropped by a fall). A tier reached is
// the HUD's one flash: a soft wash of each dancer's colour in from its own side of the screen and a ring of the tier's
// colour opening from the orb, over about a second (the game slows a beat there: src/duel/weight.ts; the HUD runs on
// the page's own time, so none of this hangs in the slow motion).
import type { HudState } from './state';
import type { Layout, Box } from './layout';
import { INK, glow, label, lift, rgba, stamp, stampLabel, clamp01, easeOut, type Ctx } from './style';

const FLASH = 1.1, END = 0.7;

export class PairChain {
  private t = 0;
  private n = 0;
  private bumpAt = -9;
  private tier = 0;
  private flashAt = -9;
  private flashCol = '#ffffff';
  /** the last chain shown, kept while it goes (banked or dropped) */
  private shown: { text: string; color: string; tier: number } | null = null;
  private endAt = -9;
  private endHow: 'cashed' | 'dropped' = 'cashed';

  update(st: HudState, dt: number) {
    this.t += dt;
    const P = st.pair;
    if (!P) return;
    if (P.live) {
      if (P.n > this.n) this.bumpAt = this.t;
      if (P.tier > this.tier && P.tierColor) { this.flashAt = this.t; this.flashCol = P.tierColor; }
      this.n = P.n; this.tier = P.tier;
      this.shown = { text: `${P.tierName ?? ''}${P.tierName ? ' ' : ''}×${P.n}`, color: P.tierColor ?? INK, tier: P.tier };
      this.endAt = -9;
    } else if (this.n > 0 || P.ended) {
      if (this.endAt < 0 && this.shown) { this.endAt = this.t; this.endHow = P.ended === 'dropped' ? 'dropped' : 'cashed'; }
      this.n = 0; this.tier = 0;
    }
  }

  draw(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[]) {
    const P = st.pair;
    if (!P || st.mode !== 'duel') return;
    const u = L.u, O = L.orb, t = this.t;
    const [ca, cb] = P.colors;
    // ---- the flash of a tier: each one's colour washing in from its side, a ring from the orb
    const fk = (t - this.flashAt) / FLASH;
    if (fk >= 0 && fk < 1) {
      const a = Math.sin(Math.PI * clamp01(fk * 1.6)) * (1 - fk) * 0.8, R = L.H * 0.6;
      // (gradients drawn for the second it lasts: a sprite this big would not fit the HUD's atlas)
      for (const [x0, c] of [[0, ca], [L.W, cb]] as const) {
        const gr = g.createRadialGradient(x0, L.H * 0.5, 0, x0, L.H * 0.5, R);
        gr.addColorStop(0, rgba(lift(c, 0.25), 0.6 * a)); gr.addColorStop(0.5, rgba(c, 0.24 * a)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr;
        g.fillRect(x0 === 0 ? 0 : L.W - R, L.H * 0.5 - R, R, R * 2);
      }
      const rr = O.r * (1.4 + 9 * easeOut(fk));
      g.lineWidth = Math.max(1, 2.4 * u * (1 - fk));
      g.strokeStyle = rgba(lift(this.flashCol, 0.3), 0.7 * (1 - fk));
      g.beginPath(); g.arc(O.x, O.y, rr, 0, Math.PI * 2); g.stroke();
      out.push({ x: 0, y: 0, w: L.W, h: L.H });
    }
    // ---- the chip
    const ek = this.endAt >= 0 ? (t - this.endAt) / END : 0;
    if (!this.shown || ek >= 1 || (P.live && P.n < 3)) return;
    const S = this.shown, fs = (L.compact ? 9 : 13) * u;
    const Ra = O.r + 5.5 * u, y0 = O.y + Ra + (L.compact ? 5 : 8) * u + (L.compact ? 9 : 12) * u * 1.3 + (L.compact ? 10 : 22) * u;
    const spb = 60 / Math.max(30, st.beat.bpm || 120), ph = ((st.beat.phase % 1) + 1) % 1, beatK = Math.exp(-ph * spb * 6);
    const bump = clamp01((t - this.bumpAt) / 0.2), bk = 1 + 0.12 * Math.sin(Math.PI * bump) * (1 - bump);
    const gone = this.endAt >= 0, drop = gone && this.endHow === 'dropped';
    const a = gone ? 1 - easeOut(ek) : 1, y = y0 - (gone && !drop ? 18 * u * easeOut(ek) : 0) + (drop ? 6 * u * ek : 0);
    const col = drop ? '#8c879a' : S.tier ? lift(S.color, 0.1) : INK;
    const lab = label(S.text, fs, 800, 0.14, col, 0.6, Math.max(2, 2.4 * u), dpr);
    const x = O.x, half = lab.w / 2;
    if (S.tier && !drop) stamp(g, glow(S.color, fs * 2.2, dpr, 0.3), x, y - fs * 0.35, 1 + 0.05 * beatK, (0.35 + 0.25 * beatK) * a);
    g.save();
    g.translate(x, y - fs * 0.35); g.scale(bk, bk); g.translate(-x, -(y - fs * 0.35));
    stampLabel(g, lab, x, y, 'center', a);
    g.restore();
    // a dot of each one's colour either side, and the line under it from one to the other
    const dx = half + 7 * u, dr = (L.compact ? 2.2 : 3) * u * (1 + 0.2 * beatK);
    for (const [cx, c] of [[x - dx, ca], [x + dx, cb]] as const) {
      stamp(g, glow(lift(c, 0.4), dr * 3, dpr, 0.8), cx, y - fs * 0.35, 1, a * (drop ? 0.4 : 0.9));
    }
    const ly = y + fs * 0.35, lw = half + 4 * u;
    const gr = g.createLinearGradient(x - lw, 0, x + lw, 0);
    gr.addColorStop(0, rgba(lift(ca, 0.3), 0.85 * a)); gr.addColorStop(0.5, rgba('#ffffff', 0.6 * a)); gr.addColorStop(1, rgba(lift(cb, 0.3), 0.85 * a));
    g.fillStyle = drop ? rgba('#8c879a', 0.5 * a) : gr;
    g.fillRect(x - lw, ly, lw * 2, Math.max(1, 1.2 * u));
    const bw = dx + dr * 3 + 6 * u;
    out.push({ x: x - bw, y: y - fs * 2.6 - 20 * u, w: bw * 2, h: fs * 3.4 + 28 * u });
  }
}

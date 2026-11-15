// The pair combo (phase 3: the two's chain of contact links, shared by both: shared/duel.ts PairCombo), drawn as one
// thing under the set's orb, between the two panels: a small chip with a dot of each dancer's colour either side of
// the count ("×9"), the word of its tier once it has one (DUET, CURRENT, MURMURATION, AURORA) in the tier's colour,
// a line under it running from one dancer's colour to the other's. It breathes on the beat, bumps as each link comes,
// and when the chain ends it rises into the orb (banked) or greys and sinks (dropped by a fall). At a moment of
// contact the pops show one word, the biggest (src/duel/hud-state.ts RANK); the chip echoes the last word folded into
// it, small under its line (`pair.echo`). A tier reached is the HUD's one flash, dappled sunlight (phase 4): a warm
// light from above, spots of sun as through leaves on each dancer's side in its colour, and a few leaves of the
// tier's colour turning out from the orb, none of it on the bodies, over about a second (the game slows a beat there:
// src/duel/weight.ts; the HUD runs on the page's own time, so none of this hangs in the slow motion).
import type { HudState } from './state';
import type { Layout, Box } from './layout';
import { INK, glow, label, lift, rgba, rgbOf, stamp, stampLabel, clamp01, easeOut, type Ctx } from './style';
import { SUNLIT, leaf as leafAt } from './pops';

const FLASH = 1.1, END = 0.7;
/** the tier flash's spots of sun, and its colours */
const DAPPLES = 16, SUN = SUNLIT.sun, LEAF = SUNLIT.leaf;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** two CSS colours mixed (u of the way to b), as hex */
const mixCss = (a: string, b: string, u: number) => {
  const A = rgbOf(a), B = rgbOf(b), h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(A[0] + (B[0] - A[0]) * u)}${h(A[1] + (B[1] - A[1]) * u)}${h(A[2] + (B[2] - A[2]) * u)}`;
};

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
  /** the tier flash's light drawn last frame, as circles (px: x, y, r, the ring's width; 0 width a filled wash), for
   *  the moments probe */
  cover: { x: number; y: number; r: number; w: number }[] = [];

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
    this.cover = [];
    // ---- the flash of a tier: dappled sunlight (phase 4's solarpunk pass). A warm light from above, spots of sun
    // through leaves on each dancer's side in its colour drifting as a canopy would, and a few leaves of the tier's
    // colour turning out from the orb; none of it on the bodies (their bounds), over the slowed beat
    const fk = (t - this.flashAt) / FLASH;
    if (fk >= 0 && fk < 1) {
      const a = Math.sin(Math.PI * clamp01(fk * 1.4)) * (1 - fk * 0.6), drift = t - this.flashAt;
      const bodies = st.players.map((p) => p.bounds).filter((b): b is [number, number, number, number] => !!b).map((b) => ({ x: b[0] * L.W, y: b[1] * L.H, w: (b[2] - b[0]) * L.W, h: (b[3] - b[1]) * L.H }));
      const onBody = (x: number, y: number, r: number) => bodies.some((b) => x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h);
      // (the light from above: a soft warm band down from the top)
      const top = g.createLinearGradient(0, 0, 0, L.H * 0.45);
      top.addColorStop(0, rgba(SUN, 0.16 * a)); top.addColorStop(1, rgba(SUN, 0));
      g.fillStyle = top; g.fillRect(0, 0, L.W, L.H * 0.45);
      // (the dapples: where they fall is the flash's own, the same each frame of it)
      const seed = Math.floor(this.flashAt * 997);
      for (let i = 0; i < DAPPLES; i++) {
        const h1 = hash(seed + i * 3), h2 = hash(seed + i * 3 + 1), h3 = hash(seed + i * 3 + 2), side = i % 2;
        const x = (side ? 0.62 + 0.36 * h1 : 0.02 + 0.36 * h1) * L.W + Math.sin(drift * 0.9 + i) * 10 * u;
        const y = (0.14 + 0.72 * h2) * L.H + Math.cos(drift * 0.7 + i * 1.7) * 6 * u;
        const r = (h3 < 0.4 ? 26 : h3 < 0.8 ? 40 : 60) * u, tw = 0.75 + 0.25 * Math.sin(drift * 5 + i * 2.3);
        if (onBody(x, y, r * 0.6)) continue;
        const col = lift(side ? cb : ca, 0.55), k = a * tw * (0.22 + 0.18 * h3);
        stamp(g, glow(mixCss(col, SUN, 0.55), r, dpr, 0.45), x, y, 1, k);
        if (k > 0.25) this.cover.push({ x, y, r: r * 0.5, w: 0 });
      }
      // (leaves of the tier's colour, turning out from the orb and drifting down)
      const lc = lift(this.flashCol, 0.35);
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2 + fk * 1.3, rr = O.r * (1.6 + 7 * easeOut(fk)) * (0.8 + 0.4 * hash(seed + 50 + i));
        const x = O.x + Math.cos(ang) * rr, y = O.y + Math.sin(ang) * rr * 0.75 + 40 * u * fk * fk;
        if (onBody(x, y, 8 * u)) continue;
        const la = 0.75 * (1 - fk);
        leafAt(g, x, y, 9 * u, ang + Math.PI / 2 + fk * 2, rgba(i % 3 ? lc : LEAF, la));
        if (la > 0.25) this.cover.push({ x, y, r: 5 * u, w: 0 });
      }
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
    // the moment's folded word (it showed a bigger one): echoed small under the line, fading as it rises into it
    let below = 0;
    if (P.echo && !gone && P.echo.age < 0.8) {
      const ea = clamp01(P.echo.age / 0.08) * (1 - clamp01((P.echo.age - 0.45) / 0.35)), es = fs * 0.62;
      const el = label(P.echo.text, es, 700, 0.18, lift(INK, 0.1), 0.5, Math.max(1.5, 1.6 * u), dpr);
      stampLabel(g, el, x, ly + es * 1.5 - 3 * u * clamp01(P.echo.age / 0.8), 'center', 0.7 * ea);
      below = es * 1.8;
    }
    const bw = Math.max(dx + dr * 3 + 6 * u, 70 * u);
    out.push({ x: x - bw, y: y - fs * 2.6 - 20 * u, w: bw * 2, h: fs * 3.4 + 28 * u + below });
  }
}

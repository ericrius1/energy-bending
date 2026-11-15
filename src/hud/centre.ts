// The middle of the screen: the set's intro countdown big in the middle ("3", "2", "1", then "DANCE" as play starts),
// "FINALE" once as the set's last stretch begins (high, over the two's duet: src/duel/finale.ts), and the winner's
// banner when the set is done (the finale is about a bar long, then this; a set that didn't fuse says how nearly it
// did: `nearly`). A dance battle's win:
// a garland opens from the centre (garland.ts: a leaf-tipped pane of honey glass, gold stems, leaves and flowers) and
// its words open with it, clipped to the same window: the name tracks in over "TAKES THE SET", and under it the
// battle's numbers: each dancer's style in its colour and the peak the two reached together. The big words are
// sprites (a glyph and its glow made once) stamped with a little motion. `last` is what was drawn, as one box: the
// pops (pops.ts) keep off it.
import type { HudState } from './state';
import type { Layout, Box } from './layout';
import { DISPLAY, FONT, GOLD, GOLD_HI, glow, haloText, lift, measure, rgba, sprite, stamp, easeOut, clamp01, type Ctx } from './style';
import { PALETTE } from './theme';
import { drawGarland } from './garland';

const fmt = (v: number) => { const s = String(Math.max(0, Math.round(v))); return s.length <= 3 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); };

/** the countdown's word or digit as a sprite: thin, big, light, with a soft glow behind */
function bigWord(text: string, size: number, dpr: number, colour: string) {
  const w = size * (text.length > 1 ? 0.78 * text.length + 0.8 : 1.6), h = size * 1.7;
  return sprite(`big:${text}:${size.toFixed(1)}:${colour}`, dpr, w, h, w / 2, h / 2, (s) => {
    stamp(s, glow(colour, size * 0.85, dpr, 0.3), w / 2, h / 2);
    const word = text.length > 1;
    s.font = `${word ? 600 : 300} ${size}px ${DISPLAY}`;
    s.letterSpacing = word ? `${(size * 0.22).toFixed(1)}px` : '0px';
    s.textAlign = 'center'; s.textBaseline = 'middle';
    const gr = s.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, word ? colour : PALETTE.sunHi);
    // (the tracking adds space after the last letter too: half of it back)
    const x = w / 2 + (word ? size * 0.11 : 0);
    s.lineJoin = 'round';
    s.lineWidth = size * 0.05; s.strokeStyle = 'rgba(6,4,12,0.35)'; s.strokeText(text, x, h / 2 + size * 0.04);
    s.fillStyle = gr; s.fillText(text, x, h / 2 + size * 0.04);
  });
}

const GO = 'DANCE', FIN = 'FINALE';
/** the banner's garland opens over this long (s), its words with it */
const OPEN_S = 0.7;

/** the banner's "nearly", for a set that didn't fuse: "NEARLY · HELD 2.1 S OF 3 AT THE TOP" (and "· NO MERGE YET"
 *  when it never merged); a set never at the top says what the fusion asks ("FUSION · HOLD 90% FOR 3 S"); null when
 *  it fused or the game says nothing of it */
export function nearly(st: HudState): string | null {
  const S = st.set, H = st.shared;
  if (S.fused !== false || H.high == null || !H.highFor) return null;
  const held = Math.min(H.high, H.highFor);
  const of = Number.isInteger(H.highFor) ? String(H.highFor) : H.highFor.toFixed(1);
  const merge = H.merges === 0 ? '  ·  NO MERGE YET' : '';
  if (held < 0.05) return `FUSION  ·  HOLD ${Math.round((H.highAt ?? 0.9) * 100)}% FOR ${of} S${H.merges === 0 ? '  ·  AND MERGE' : ''}`;
  return held >= H.highFor ? `NEARLY  ·  HELD ${of} S AT THE TOP${merge}` : `NEARLY  ·  HELD ${held.toFixed(1)} S OF ${of} AT THE TOP${merge}`;
}

/** the winner's name for the banner, at its size or smaller till it fits the screen, its glow behind (a sprite) */
function winName(text: string, col: string, L: Layout, dpr: number) {
  let fs = (L.compact ? 30 : 52) * L.u;
  const tw = measure(text, fs, 600, 0.16, DISPLAY);
  if (tw > L.W * 0.8) fs *= (L.W * 0.8) / tw;
  const w = Math.min(L.W, measure(text, fs, 600, 0.16, DISPLAY) + fs * 3);
  const spr = sprite(`win2:${text}:${col}:${fs.toFixed(1)}`, dpr, w, fs * 2, w / 2, fs, (s) => {
    stamp(s, glow(col, fs * 1.3, dpr, 0.35), w / 2, fs);
    s.font = `600 ${fs}px ${DISPLAY}`;
    s.letterSpacing = `${(fs * 0.16).toFixed(1)}px`;
    s.textAlign = 'center'; s.textBaseline = 'middle';
    const gr = s.createLinearGradient(0, fs * 0.5, 0, fs * 1.5);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, lift(col, 0.25));
    s.fillStyle = gr;
    s.fillText(text, w / 2 + fs * 0.08, fs);
  });
  return { spr, fs };
}

/** the countdown's sprites, to make ahead (Hud's warm-up) */
export function warmCentre(L: Layout, dpr: number, st?: HudState): (() => void)[] {
  const size = (L.compact ? 92 : 150) * L.u;
  return [...(st?.players ?? []).map((p) => () => { winName(p.name.toUpperCase(), p.color, L, dpr); }), ...['3', '2', '1'].map((d) => () => { bigWord(d, size, dpr, PALETTE.sky); }), () => { bigWord(GO, size * 0.42, dpr, GOLD); }, () => { bigWord(FIN, size * 0.36, dpr, GOLD); }];
}

export class Centre {
  /** what the centre drew last frame (its word and ring, or the banner), for the pops to keep off; null: nothing */
  last: Box | null = null;
  private t = 0;
  private lastPhase = '';
  private goAt = -1;
  private armed = false;
  private finAt = -1;
  private doneAt = -1;

  update(st: HudState, dt: number) {
    this.t += dt;
    const ph = st.set.phase;
    // "DANCE" once, as the countdown reaches 0 or play starts after it, whichever the game shows first
    const left = st.set.countdown ?? 0;
    if (ph === 'intro' && left > 0.0001) this.armed = true;
    const go = (ph === 'intro' && left <= 0.0001) || (ph !== 'intro' && this.lastPhase === 'intro');
    if (go && this.armed) { this.goAt = this.t; this.armed = false; }
    if (ph === 'finale' && this.lastPhase === 'play') this.finAt = this.t;
    if (ph === 'done' && this.lastPhase !== 'done') this.doneAt = this.t;
    if (ph !== 'done') this.doneAt = -1;
    this.lastPhase = ph;
  }

  /** the countdown, the finale's word and the winner's banner; returns the boxes drawn */
  draw(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[]) {
    const u = L.u, { x: cx, y: cy0 } = L.centre, S = st.set;
    const n0 = out.length;
    let cy = cy0;
    const size = (L.compact ? 92 : 150) * u;
    // the countdown: each digit drops in and settles, a ring opening behind it
    let text: string | null = null, k = 0;
    if (S.phase === 'intro' && (S.countdown ?? 0) > 0.0001) { const left = S.countdown!, d = Math.ceil(left); text = String(Math.min(9, d)); k = d - left; }
    else if (this.goAt >= 0 && this.t - this.goAt < 0.9) { text = GO; k = (this.t - this.goAt) / 0.9; }
    else if (this.finAt >= 0 && this.t - this.finAt < 1.3) { text = FIN; k = (this.t - this.finAt) / 1.3; }
    if (text) {
      const word = text.length > 1;
      // (the finale's word stands high, over the two's duet, which happens about the middle: finale.ts)
      cy = text === FIN ? L.top + (cy0 - L.top) * 0.32 : cy0;
      const s = word ? size * (text === FIN ? 0.36 : 0.42) : size;
      const spr = bigWord(text, s, dpr, word ? GOLD : PALETTE.sky);
      const sc = word ? 0.92 + 0.08 * easeOut(k * 3) + 0.06 * k : 1.28 - 0.28 * easeOut(k * 3.2);
      const a = clamp01(k * 7) * (1 - clamp01((k - (word ? 0.55 : 0.72)) / (word ? 0.45 : 0.28)));
      // the ring: opens out from the digit and fades
      const rr = s * (0.5 + 0.55 * easeOut(k)) * (text === FIN ? 1.15 : 1);
      g.lineWidth = Math.max(1, 1.5 * u);
      g.strokeStyle = word ? rgba(GOLD, 0.5 * (1 - k)) : rgba(PALETTE.sky, 0.35 * (1 - k));
      g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
      stamp(g, spr, cx, cy, sc, a);
      const half = Math.max(spr.w * sc, rr * 2 + 8) / 2 + 4, halfH = Math.max(spr.h * sc, rr * 2 + 8) / 2 + 4;
      out.push({ x: cx - half, y: cy - halfH, w: half * 2, h: halfH * 2 });
      cy = cy0;
    }
    // the winner: a garland across the middle (garland.ts) opening from the centre with its words: the name, what it
    // means and the battle's numbers are clipped to the same window as it opens, so the band is never seen empty
    if (S.phase === 'done' && this.doneAt >= 0) {
      const w = S.winner != null ? (st.players.find((p) => p.seat === S.winner) ?? st.players[S.winner]) : undefined;
      const col = w?.color ?? PALETTE.parchment;
      const e = this.t - this.doneAt, open = easeOut(e / OPEN_S), H = (L.compact ? 104 : 168) * u, half = (L.W / 2) * open;
      const y0 = cy - H / 2;
      const seats = [0, 1].map((k) => st.players.find((p) => p.seat === k)?.color ?? '');
      drawGarland(g, cx, cy, L.W, H, half, L.compact ? u * 0.75 : u, dpr, seats);
      // (the words in the same window, a little inside the garland's growing tips)
      g.save();
      g.beginPath(); g.rect(cx - Math.max(0, half - 10 * u), y0, Math.max(0, half - 10 * u) * 2, H); g.clip();
      const a = clamp01(open * 1.6);
      if (a > 0) {
        // (the name at the banner's size, or smaller till it fits the screen)
        const label = w ? w.name.toUpperCase() : 'EVEN';
        const { spr: name, fs } = winName(label, col, L, dpr);
        // the name tracks in: from wide and faint to its place
        const ny0 = cy - H * 0.17;
        stamp(g, name, cx, ny0, 1.06 - 0.06 * easeOut(a), a);
        // what it means, small and tracked, under the name
        const ts = (L.compact ? 8.5 : 12) * u;
        g.font = `700 ${ts}px ${FONT}`;
        g.letterSpacing = `${(ts * 0.42).toFixed(1)}px`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.globalAlpha = a;
        g.fillStyle = rgba(GOLD, 0.95);
        g.fillText(w ? 'TAKES THE SET' : 'THE SET IS EVEN', cx + ts * 0.21, ny0 + fs * 0.78);
        // the numbers: each one's style in its colour either side of the word, the peak they reached together under
        const b = clamp01((e - OPEN_S * 0.45) / 0.35);
        g.globalAlpha = b;
        const ns = (L.compact ? 12 : 18) * u, ny = cy + H * 0.25, [p0, p1] = [st.players.find((p) => p.seat === 0), st.players.find((p) => p.seat === 1)];
        const sp = (L.compact ? 46 : 62) * u;
        g.font = `650 ${ns}px ${FONT}`;
        g.letterSpacing = `${(ns * 0.04).toFixed(1)}px`;
        g.textAlign = 'right';
        if (p0) haloText(g, fmt(p0.style), cx - sp, ny, lift(p0.color, 0.45), 0.5, 2.6 * u);
        g.textAlign = 'left';
        if (p1) haloText(g, fmt(p1.style), cx + sp, ny, lift(p1.color, 0.45), 0.5, 2.6 * u);
        const ls = (L.compact ? 6.5 : 8.5) * u;
        g.font = `700 ${ls}px ${FONT}`;
        g.letterSpacing = `${(ls * 0.34).toFixed(1)}px`;
        g.textAlign = 'center';
        g.fillStyle = rgba(PALETTE.parchment, 0.78);
        g.fillText('STYLE', cx + ls * 0.17, ny);
        g.fillStyle = rgba(GOLD_HI, 0.8);
        g.fillText(`TOGETHER  ${Math.round(st.shared.peak * 100)}%  AT PEAK`, cx + ls * 0.17, ny + ns * 1.05);
        // a set that didn't fuse says how near it came: the longest stretch held near the top, of what the fusion
        // needs (and that it needs a merge too, when there was none), so the next set knows what to reach for
        const nb = nearly(st);
        if (nb) {
          g.fillStyle = rgba(PALETTE.parchment, 0.68);
          g.fillText(nb, cx + ls * 0.17, ny + ns * 1.05 + ls * 1.7);
        }
        g.globalAlpha = 1;
        g.letterSpacing = '0px';
      }
      g.restore();
      out.push({ x: 0, y: y0 - 34 * u, w: L.W, h: H + 68 * u });
    }
    // (what was drawn, as one box: the pops keep off it next frame)
    if (out.length > n0) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = n0; i < out.length; i++) { const b = out[i]; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
      this.last = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else this.last = null;
  }
}

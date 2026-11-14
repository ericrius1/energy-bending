// The middle of the screen: the round's score and clock in a small glass at the top centre (each seat's KOs in its
// colour either side of the time, the target under it), the countdown big in the middle ("3", "2", "1", then "BEND"
// as play starts) and the winner's banner across it. The score is drawn only when a number changes; the countdown
// and the banner are sprites (a big glyph and its glow made once) stamped with a little motion.
import type { HudState } from './state';
import type { Layout, Box } from './layout';
import { FONT, GOLD, GOLD_HI, INK, glass, glow, haloText, lift, rgba, sprite, stamp, easeOut, clamp01, type Ctx } from './style';

const mmss = (s: number) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** the score's signature: what it shows (it is drawn again only when this changes) */
export function scoreSig(st: HudState) {
  const [a, b] = st.players;
  return `${a?.kos}|${b?.kos}|${a?.color}|${b?.color}|${st.round.koTarget}|${Math.floor(Math.max(0, st.round.time))}`;
}

export function drawScore(g: Ctx, st: HudState, L: Layout, dpr: number) {
  const B = L.score, u = L.u, [a, b] = st.players;
  const still = sprite(`score:${L.compact}:${B.w.toFixed(1)}:${u.toFixed(3)}:${st.round.koTarget}`, dpr, B.w + 8, B.h + 8, 4, 4, (s) => {
    s.translate(4, 4);
    glass(s, 0, 0, B.w, B.h, (L.compact ? 11 : 16) * u);
    if (!L.compact) {
      s.font = `600 ${8 * u}px ${FONT}`;
      s.letterSpacing = `${(8 * u * 0.24).toFixed(2)}px`;
      s.textAlign = 'center'; s.textBaseline = 'alphabetic';
      s.fillStyle = 'rgba(236,230,244,0.5)';
      s.fillText(`FIRST TO ${st.round.koTarget}`, B.w / 2 + 8 * u * 0.12, B.h - 11 * u);
    }
    // hairlines between the scores and the clock
    s.fillStyle = 'rgba(255,255,255,0.1)';
    const dx = B.w * (L.compact ? 0.3 : 0.28);
    s.fillRect(dx, B.h * 0.24, 1, B.h * 0.52);
    s.fillRect(B.w - dx, B.h * 0.24, 1, B.h * 0.52);
  });
  stamp(g, still, B.x, B.y);
  const cy = B.y + B.h * (L.compact ? 0.53 : 0.47);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  // the KOs either side
  g.font = `700 ${(L.compact ? 15 : 25) * u}px ${FONT}`;
  g.letterSpacing = '0px';
  const side = B.w * (L.compact ? 0.15 : 0.14);
  if (a) haloText(g, String(a.kos), B.x + side, cy + u, lift(a.color, 0.35), 0.4, 2.5 * u);
  if (b) haloText(g, String(b.kos), B.x + B.w - side, cy + u, lift(b.color, 0.35), 0.4, 2.5 * u);
  // the clock
  g.font = `600 ${(L.compact ? 10 : 15.5) * u}px ${FONT}`;
  g.letterSpacing = `${((L.compact ? 10 : 15.5) * u * 0.06).toFixed(2)}px`;
  haloText(g, mmss(st.round.time), B.x + B.w / 2, L.compact ? cy : cy - 3 * u, INK, 0.4, 2.2 * u);
  g.letterSpacing = '0px';
}

// ---------------------------------------------------------------- the countdown and the banner (the live layer)

/** the countdown's word or digit as a sprite: thin, big, light, with a soft glow behind */
function bigWord(text: string, size: number, dpr: number, colour: string) {
  const w = size * (text.length > 1 ? 0.78 * text.length + 0.8 : 1.6), h = size * 1.7;
  return sprite(`big:${text}:${size.toFixed(1)}:${colour}`, dpr, w, h, w / 2, h / 2, (s) => {
    stamp(s, glow(colour, size * 0.85, dpr, 0.3), w / 2, h / 2);
    const word = text.length > 1;
    s.font = `${word ? 650 : 300} ${size}px ${FONT}`;
    s.letterSpacing = word ? `${(size * 0.22).toFixed(1)}px` : '0px';
    s.textAlign = 'center'; s.textBaseline = 'middle';
    const gr = s.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, word ? GOLD : '#e6defa');
    // (the tracking adds space after the last letter too: half of it back)
    const x = w / 2 + (word ? size * 0.11 : 0);
    s.lineJoin = 'round';
    s.lineWidth = size * 0.05; s.strokeStyle = 'rgba(6,4,12,0.35)'; s.strokeText(text, x, h / 2 + size * 0.04);
    s.fillStyle = gr; s.fillText(text, x, h / 2 + size * 0.04);
  });
}

/** the countdown's sprites, to make ahead (Hud's warm-up) */
export function warmCentre(L: Layout, dpr: number): (() => void)[] {
  const size = (L.compact ? 92 : 150) * L.u;
  return [...['3', '2', '1'].map((d) => () => { bigWord(d, size, dpr, '#b9a8ff'); }), () => { bigWord('BEND', size * 0.42, dpr, GOLD); }];
}

export class Centre {
  private t = 0;
  private lastPhase = '';
  private bendAt = -1;
  private armed = false;
  private wonAt = -1;

  update(st: HudState, dt: number) {
    this.t += dt;
    const ph = st.round.phase;
    // "BEND" once, as the countdown reaches 0 or play starts after it, whichever the duel shows first
    const left = st.round.countdown ?? 0;
    if (ph === 'countdown' && left > 0.0001) this.armed = true;
    const go = (ph === 'countdown' && left <= 0.0001) || (ph !== 'countdown' && this.lastPhase === 'countdown');
    if (go && this.armed) { this.bendAt = this.t; this.armed = false; }
    if (ph === 'won' && this.lastPhase !== 'won') this.wonAt = this.t;
    if (ph !== 'won') this.wonAt = -1;
    this.lastPhase = ph;
  }

  /** the countdown and the winner's banner; returns the boxes drawn */
  draw(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[]) {
    const u = L.u, { x: cx, y: cy } = L.centre, R = st.round;
    const size = (L.compact ? 92 : 150) * u;
    // the countdown: each digit drops in and settles, a ring opening behind it
    let text: string | null = null, k = 0;
    if (R.phase === 'countdown' && (R.countdown ?? 0) > 0.0001) { const left = R.countdown!, d = Math.ceil(left); text = String(Math.min(9, d)); k = d - left; }
    else if (this.bendAt >= 0 && this.t - this.bendAt < 0.9) { text = 'BEND'; k = (this.t - this.bendAt) / 0.9; }
    if (text) {
      const word = text.length > 1;
      const s = word ? size * 0.42 : size;
      const spr = bigWord(text, s, dpr, word ? GOLD : '#b9a8ff');
      const sc = word ? 0.92 + 0.08 * easeOut(k * 3) + 0.06 * k : 1.28 - 0.28 * easeOut(k * 3.2);
      const a = clamp01(k * 7) * (1 - clamp01((k - (word ? 0.55 : 0.72)) / (word ? 0.45 : 0.28)));
      // the ring: opens out from the digit and fades
      const rr = s * (0.5 + 0.55 * easeOut(k));
      g.lineWidth = Math.max(1, 1.5 * u);
      g.strokeStyle = word ? rgba(GOLD, 0.5 * (1 - k)) : `rgba(220,210,255,${(0.35 * (1 - k)).toFixed(3)})`;
      g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
      stamp(g, spr, cx, cy, sc, a);
      const half = Math.max(spr.w * sc, rr * 2 + 8) / 2 + 4, halfH = Math.max(spr.h * sc, rr * 2 + 8) / 2 + 4;
      out.push({ x: cx - half, y: cy - halfH, w: half * 2, h: halfH * 2 });
    }
    // the winner: a band across the middle opening from the centre, the name tracking in, the score under it
    if (R.phase === 'won' && R.winner != null && this.wonAt >= 0) {
      const w = st.players.find((p) => p.seat === R.winner) ?? st.players[R.winner];
      if (!w) return;
      const e = this.t - this.wonAt, open = easeOut(e / 0.45), H = (L.compact ? 78 : 128) * u, half = (L.W / 2) * open;
      const y0 = cy - H / 2;
      const band = g.createLinearGradient(cx - L.W / 2, 0, cx + L.W / 2, 0);
      band.addColorStop(0, 'rgba(10,8,18,0)'); band.addColorStop(0.22, 'rgba(10,8,18,0.6)');
      band.addColorStop(0.5, 'rgba(14,10,24,0.72)'); band.addColorStop(0.78, 'rgba(10,8,18,0.6)'); band.addColorStop(1, 'rgba(10,8,18,0)');
      g.fillStyle = band;
      g.fillRect(cx - half, y0, half * 2, H);
      // hairlines in the winner's colour along the band's edges
      const line = g.createLinearGradient(cx - half, 0, cx + half, 0);
      line.addColorStop(0, rgba(w.color, 0)); line.addColorStop(0.5, rgba(lift(w.color, 0.4), 0.9)); line.addColorStop(1, rgba(w.color, 0));
      g.fillStyle = line;
      g.fillRect(cx - half, y0, half * 2, Math.max(1, u));
      g.fillRect(cx - half, y0 + H - Math.max(1, u), half * 2, Math.max(1, u));
      const a = clamp01((e - 0.15) / 0.35);
      if (a > 0) {
        // (the name at the banner's size, or smaller till it fits the screen)
        let fs = (L.compact ? 30 : 50) * u;
        const label = `${w.name.toUpperCase()} WINS`;
        g.font = `650 ${fs}px ${FONT}`;
        g.letterSpacing = `${(fs * 0.16).toFixed(1)}px`;
        const tw = g.measureText(label).width;
        if (tw > L.W * 0.9) fs *= (L.W * 0.9) / tw;
        const name = sprite(`win:${w.name}:${w.color}:${fs.toFixed(1)}`, dpr, L.W, fs * 2, L.W / 2, fs, (s) => {
          stamp(s, glow(w.color, fs * 1.3, dpr, 0.35), L.W / 2, fs);
          s.font = `650 ${fs}px ${FONT}`;
          s.letterSpacing = `${(fs * 0.16).toFixed(1)}px`;
          s.textAlign = 'center'; s.textBaseline = 'middle';
          const gr = s.createLinearGradient(0, fs * 0.5, 0, fs * 1.5);
          gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, lift(w.color, 0.25));
          s.fillStyle = gr;
          s.fillText(label, L.W / 2 + fs * 0.08, fs);
        });
        stamp(g, name, cx, cy - H * 0.1, 1.06 - 0.06 * easeOut(a), a);
        const [p0, p1] = st.players;
        g.font = `600 ${(L.compact ? 10 : 13) * u}px ${FONT}`;
        g.letterSpacing = `${((L.compact ? 10 : 13) * u * 0.3).toFixed(1)}px`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.globalAlpha = a * 0.75;
        g.fillStyle = GOLD_HI;
        g.fillText(`${p0?.kos ?? 0}  —  ${p1?.kos ?? 0}`, cx, cy + H * 0.3);
        g.globalAlpha = 1;
        g.letterSpacing = '0px';
      }
      out.push({ x: 0, y: y0 - 2, w: L.W, h: H + 4 });
    }
  }

  /** true while something here moves */
  busy(st: HudState) {
    return st.round.phase === 'countdown' || (this.bendAt >= 0 && this.t - this.bendAt < 0.9) || st.round.phase === 'won';
  }
}

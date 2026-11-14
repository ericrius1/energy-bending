// Words that rise from where something happened ("PERFECT", "PARRY", "KO", a reaction, a note), and the small tag
// over each player's head so a body is never lost in its own matter. Each word is a sprite made once per text, kind
// and colour (its glow and halo baked in) and stamped with its motion: it pops in a little large, settles, rises and
// fades. A tag is a sprite too; off the screen's edge it is held at the edge and points to where its player is.
import type { HudState, HudPop, HudPlayer } from './state';
import type { Layout, Box } from './layout';
import { FONT, GOLD, INK, glow, lift, rgba, sprite, stamp, clamp01, easeOutBack, easeOut, type Ctx } from './style';

const LIFE: Record<HudPop['kind'], number> = { perfect: 1.0, parry: 1.0, ko: 1.3, react: 1.1, info: 1.6 };

interface Look { size: number; weight: number; top: string; bottom: string; glow: string | null; track: number; streak?: string }
function lookOf(p: HudPop, st: HudState): Look {
  const seat = p.seat != null ? st.players.find((q) => q.seat === p.seat) : undefined;
  const col = seat?.color ?? '#ff6a5a';
  switch (p.kind) {
    case 'perfect': return { size: 17, weight: 700, top: '#fff6dc', bottom: '#ffbf4a', glow: GOLD, track: 0.16 };
    case 'parry': return { size: 17, weight: 700, top: '#ffffff', bottom: '#9fe8ff', glow: '#6fd6ff', track: 0.16 };
    case 'ko': return { size: 42, weight: 800, top: '#ffffff', bottom: lift(col, 0.2), glow: col, track: 0.1, streak: col };
    case 'react': return { size: 19, weight: 700, top: '#ffffff', bottom: lift(col, 0.45), glow: col, track: 0.12 };
    default: return { size: 13, weight: 600, top: INK, bottom: INK, glow: null, track: 0.1 };
  }
}

function word(text: string, L: Look, u: number, dpr: number) {
  const fs = L.size * u, w = fs * (0.78 + L.track) * Math.max(2, text.length) + fs * (L.streak ? 4 : 2), h = fs * 2.6;
  return sprite(`pop:${text}:${L.size}:${L.weight}:${L.top}:${L.bottom}:${L.glow}:${L.streak}:${u.toFixed(3)}`, dpr, w, h, w / 2, h / 2, (s) => {
    if (L.glow) stamp(s, glow(L.glow, fs * 1.15, dpr, 0.32), w / 2, h / 2);
    if (L.streak) {
      // a KO's slash of light through the word, thinning to nothing at both ends
      const gr = s.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, rgba(L.streak, 0)); gr.addColorStop(0.5, rgba(lift(L.streak, 0.6), 0.95)); gr.addColorStop(1, rgba(L.streak, 0));
      s.fillStyle = gr;
      s.beginPath();
      s.moveTo(0, h / 2 + fs * 0.06); s.lineTo(w / 2, h / 2 - fs * 0.05); s.lineTo(w, h / 2 - fs * 0.16); s.lineTo(w / 2, h / 2 + fs * 0.03);
      s.closePath(); s.fill();
    }
    s.font = `${L.weight} ${fs}px ${FONT}`;
    s.letterSpacing = `${(fs * L.track).toFixed(2)}px`;
    s.textAlign = 'center'; s.textBaseline = 'middle';
    const x = w / 2 + fs * L.track * 0.5, y = h / 2 + fs * 0.05;
    s.lineJoin = 'round';
    s.lineWidth = Math.max(2, fs * 0.16); s.strokeStyle = 'rgba(6,4,12,0.55)'; s.strokeText(text, x, y);
    const gr = s.createLinearGradient(0, y - fs / 2, 0, y + fs / 2);
    gr.addColorStop(0, L.top); gr.addColorStop(1, L.bottom);
    s.fillStyle = gr; s.fillText(text, x, y);
  });
}

export function drawPops(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[]) {
  const u = L.u * (L.compact ? 0.85 : 1);
  for (const p of st.pops) {
    const life = LIFE[p.kind] ?? 1.1, t = p.age / life;
    if (t < 0 || t >= 1) continue;
    const look = lookOf(p, st), spr = word(p.text, look, u, dpr);
    const sc = (p.kind === 'ko' ? 0.5 : 0.65) + (p.kind === 'ko' ? 0.5 : 0.35) * easeOutBack(clamp01(p.age / 0.16));
    const rise = (p.kind === 'ko' ? 30 : 42) * u * easeOut(t);
    const a = clamp01(p.age / 0.05) * (1 - clamp01((t - 0.62) / 0.38));
    const m = L.margin + spr.w * 0.38;
    const x = Math.max(m, Math.min(L.W - m, p.at[0] * L.W));
    // (held below the panels: a word never lands on them)
    const y = Math.max(L.panels[0].y + L.panels[0].h + spr.h * 0.35 + rise, Math.min(L.H - L.margin, p.at[1] * L.H)) - rise;
    stamp(g, spr, x, y, sc, a);
    out.push({ x: x - spr.ox * sc - 2, y: y - spr.oy * sc - 2, w: spr.w * sc + 4, h: spr.h * sc + 4 });
  }
}

/** the words a duel will surely need, to make ahead (one a frame: Hud's warm-up) so the first KO costs nothing */
export function warmPops(st: HudState, L: Layout, dpr: number): (() => void)[] {
  const u = L.u * (L.compact ? 0.85 : 1), out: (() => void)[] = [];
  const pop = (text: string, kind: HudPop['kind'], seat?: number) => () => { word(text, lookOf({ text, kind, seat, at: [0, 0], age: 0 }, st), u, dpr); };
  out.push(pop('PERFECT', 'perfect'), pop('PARRY', 'parry'));
  for (const p of st.players) {
    out.push(pop('KO', 'ko', p.seat));
    out.push(() => { tag(p, L.u * (L.compact ? 0.9 : 1), dpr); });
  }
  return out;
}

/** the tag over a player's head: "P1" in its colour over a small pointer */
function tag(p: HudPlayer, u: number, dpr: number) {
  const fs = 10.5 * u, w = 40 * u, h = 34 * u;
  return sprite(`tag:${p.seat}:${p.color}:${u.toFixed(3)}`, dpr, w, h, w / 2, h - 2 * u, (s) => {
    const cx = w / 2, by = h - 2 * u;
    s.font = `700 ${fs}px ${FONT}`;
    s.letterSpacing = `${(fs * 0.14).toFixed(2)}px`;
    s.textAlign = 'center'; s.textBaseline = 'alphabetic';
    s.lineJoin = 'round';
    s.lineWidth = Math.max(2, 3 * u); s.strokeStyle = 'rgba(6,4,12,0.6)';
    const tx = cx + fs * 0.07, ty = by - 9 * u;
    s.strokeText(`P${p.seat + 1}`, tx, ty);
    s.fillStyle = lift(p.color, 0.45); s.fillText(`P${p.seat + 1}`, tx, ty);
    // the pointer
    s.beginPath(); s.moveTo(cx - 4.5 * u, by - 6 * u); s.lineTo(cx + 4.5 * u, by - 6 * u); s.lineTo(cx, by); s.closePath();
    s.lineWidth = Math.max(1.5, 2 * u); s.strokeStyle = 'rgba(6,4,12,0.5)'; s.stroke();
    s.fillStyle = lift(p.color, 0.3); s.fill();
  });
}

/** each player's tag: over its head, or held at the screen's edge pointing to it (out of frame, or behind the
 *  camera in the free view). The tag also keeps the beat where the eyes are: a thin ring closes on it once a beat and
 *  it lights gold through the perfect window, so a player can time a move without looking down at the beat ring */
export function drawTags(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[]) {
  const u = L.u * (L.compact ? 0.9 : 1);
  const b = st.beat, spb = 60 / Math.max(30, b.bpm || 120), ph = ((b.phase % 1) + 1) % 1;
  const inWindow = (1 - ph) * spb <= b.window || ph * spb <= b.window;
  for (const p of st.players) {
    if (!p.screen) continue;
    const spr = tag(p, u, dpr);
    const lift0 = 16 * u;
    const px = p.screen[0] * L.W, py = p.screen[1] * L.H - lift0;
    // (the panels hold the top: a tag under them is held below them)
    const top = L.panels[0].y + L.panels[0].h + 4 * u + spr.h;
    const m = L.margin + 22 * u;
    const x = Math.max(m, Math.min(L.W - m, px)), y = Math.max(top, Math.min(L.H - m, py));
    const a = p.reforming > 0 ? 0.45 : 1;
    const held = Math.abs(x - px) > 1 || Math.abs(y - py) > 1;
    // the label's middle (the beat ring's centre)
    const cx = x, cy = y - 13 * u;
    stamp(g, spr, x, y, 1, a);
    if (held) {
      // an arrow beside the label, toward the player
      const ang = Math.atan2(py - cy, px - cx), r = 6.5 * u, d = 25 * u;
      g.save();
      g.translate(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d); g.rotate(ang);
      g.beginPath(); g.moveTo(r, 0); g.lineTo(-r * 0.6, -r * 0.75); g.lineTo(-r * 0.6, r * 0.75); g.closePath();
      g.lineWidth = Math.max(1.5, 2 * u); g.strokeStyle = 'rgba(6,4,12,0.5)'; g.stroke();
      g.fillStyle = rgba(lift(p.color, 0.35), 0.95 * a); g.fill();
      g.restore();
    }
    // the beat, at the tag
    const R0 = 11 * u, rr = R0 + R0 * 1.3 * (1 - ph), ca = Math.min(1, ph / 0.3);
    if (inWindow) {
      g.lineWidth = Math.max(1.2, 1.6 * u);
      g.strokeStyle = rgba(GOLD, 0.85 * a);
      g.beginPath(); g.arc(cx, cy, R0, 0, Math.PI * 2); g.stroke();
    } else if (ca > 0.02) {
      g.lineWidth = Math.max(1, 1.1 * u);
      g.strokeStyle = rgba(lift(p.color, 0.5), 0.5 * ca * a);
      g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
    }
    const half = Math.max(spr.w / 2, spr.h, R0 * 2.3, 34 * u) + 4;
    out.push({ x: cx - half, y: cy - half, w: half * 2, h: half * 2 });
  }
}

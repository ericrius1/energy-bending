// Words that pop from where a named move happened, and the small tag over each player's head so a body is never
// lost in its own matter. Each kind moves its own way:
//   CATCH      snaps in: from large and faint to its size in a tenth of a second, a ring closing on it like a hand
//   SWING      hangs from a point above it and swings, a pendulum dying away
//   FLING ×n   flies off on its tangent (the way the flung body is going on screen; with no motion to read, away from
//              the partner and up), stretched, a ghost or two trailing
//   PERFECT    gold, springs in with a ring of light opening, rises
//   COMBO ×n   punches in, bigger the longer the combo, a shiver, rises
//   MERGE      two halves in the two dancers' colours slide together and become one word with a flash
//   info       a plain note rising
// Each word is a sprite made once per text, kind and colour (its glow and halo baked in) and stamped with its motion.
// A tag is a sprite too; off the screen's edge it is held at the edge and points to where its player is.
import type { HudState, HudPop, HudPlayer, PopKind } from './state';
import type { Layout, Box } from './layout';
import { LINK_KINDS } from './state';
import { linkIcon } from './icons';
import { FONT, GOLD, GOLD_HI, INK, glow, lift, rgba, sprite, stamp, clamp01, easeOutBack, easeOut, type Ctx } from './style';

const LIFE: Record<PopKind, number> = { catch: 0.95, swing: 1.05, fling: 1.0, perfect: 1.0, combo: 1.2, merge: 1.4, info: 1.6 };
export const popLife = (k: PopKind) => LIFE[k] ?? 1.1;

interface Look { size: number; weight: string; top: string; bottom: string; glow: string | null; track: number; across?: [string, string] }
function lookOf(p: HudPop, st: HudState): Look {
  const seat = p.seat != null ? st.players.find((q) => q.seat === p.seat) : undefined;
  const col = seat?.color ?? '#b9a8ff';
  switch (p.kind) {
    case 'catch': return { size: 20, weight: '800', top: '#ffffff', bottom: lift(col, 0.45), glow: col, track: 0.14 };
    case 'swing': return { size: 18, weight: '700', top: '#ffffff', bottom: lift(col, 0.5), glow: col, track: 0.2 };
    case 'fling': return { size: 22, weight: 'italic 800', top: '#ffffff', bottom: lift(col, 0.35), glow: col, track: 0.08 };
    case 'perfect': return { size: 17, weight: '700', top: '#fff6dc', bottom: '#ffbf4a', glow: GOLD, track: 0.16 };
    case 'combo': {
      const n = Number(/(\d+)/.exec(p.text)?.[1] ?? 0);
      return { size: 18 + Math.min(10, n) * 1.1, weight: '800', top: '#ffffff', bottom: GOLD, glow: GOLD, track: 0.1 };
    }
    case 'merge': {
      const [a, b] = [st.players.find((q) => q.seat === 0)?.color ?? '#ff7a4a', st.players.find((q) => q.seat === 1)?.color ?? '#4ab0ff'];
      return { size: 22, weight: '800', top: '#ffffff', bottom: '#ffffff', glow: '#ffffff', track: 0.22, across: [lift(a, 0.4), lift(b, 0.4)] };
    }
    default: return { size: 13, weight: '600', top: INK, bottom: INK, glow: null, track: 0.1 };
  }
}

function word(text: string, L: Look, u: number, dpr: number) {
  const fs = L.size * u, w = fs * (0.78 + L.track) * Math.max(2, text.length) + fs * 2, h = fs * 2.6;
  return sprite(`pop2:${text}:${L.size}:${L.weight}:${L.top}:${L.bottom}:${L.glow}:${L.across?.join('/')}:${u.toFixed(3)}`, dpr, w, h, w / 2, h / 2, (s) => {
    if (L.glow) stamp(s, glow(L.glow, fs * 1.15, dpr, L.across ? 0.22 : 0.32), w / 2, h / 2);
    s.font = `${L.weight} ${fs}px ${FONT}`;
    s.letterSpacing = `${(fs * L.track).toFixed(2)}px`;
    s.textAlign = 'center'; s.textBaseline = 'middle';
    const x = w / 2 + fs * L.track * 0.5, y = h / 2 + fs * 0.05;
    s.lineJoin = 'round';
    s.lineWidth = Math.max(2, fs * 0.16); s.strokeStyle = 'rgba(6,4,12,0.55)'; s.strokeText(text, x, y);
    let gr: CanvasGradient;
    if (L.across) {
      const tw = s.measureText(text).width;
      gr = s.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
      gr.addColorStop(0, L.across[0]); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, L.across[1]);
    } else {
      gr = s.createLinearGradient(0, y - fs / 2, 0, y + fs / 2);
      gr.addColorStop(0, L.top); gr.addColorStop(1, L.bottom);
    }
    s.fillStyle = gr; s.fillText(text, x, y);
  });
}

export class Pops {
  private t = 0;
  /** each seat's head on screen last frame, and its smoothed velocity (px/s) */
  private prev: ([number, number] | null)[] = [null, null];
  private vel: [number, number][] = [[0, 0], [0, 0]];
  /** a fling's direction, fixed when it is first seen */
  private dirs = new Map<string, [number, number]>();

  update(st: HudState, L: Layout, dt: number) {
    this.t += dt;
    for (const p of st.players) {
      const s = p.seat, sc = p.screen;
      if (!sc || dt <= 0) { this.prev[s] = null; continue; }
      const x = sc[0] * L.W, y = sc[1] * L.H, pv = this.prev[s];
      if (pv) {
        const k = 1 - Math.exp(-12 * dt);
        this.vel[s][0] += ((x - pv[0]) / dt - this.vel[s][0]) * k;
        this.vel[s][1] += ((y - pv[1]) / dt - this.vel[s][1]) * k;
      }
      this.prev[s] = [x, y];
    }
    if (this.dirs.size > 24) for (const [k] of this.dirs) { this.dirs.delete(k); if (this.dirs.size <= 12) break; }
  }

  /** the way a fling pop flies: the faster body's motion on screen, or away from the far one and up */
  private dirOf(p: HudPop, st: HudState, L: Layout): [number, number] {
    const key = `${p.text}|${p.seat}|${Math.round((this.t - p.age) * 20)}`;
    const had = this.dirs.get(key);
    if (had) return had;
    let best: [number, number] | null = null, bs = 220 * L.u;
    for (const v of this.vel) { const s = Math.hypot(v[0], v[1]); if (s > bs) { bs = s; best = [v[0] / s, v[1] / s]; } }
    if (!best) {
      const ax = p.at[0] * L.W, ay = p.at[1] * L.H;
      let far: [number, number] | null = null, fd = 0;
      for (const q of st.players) if (q.screen) { const d = Math.hypot(q.screen[0] * L.W - ax, q.screen[1] * L.H - ay); if (d > fd) { fd = d; far = [q.screen[0] * L.W, q.screen[1] * L.H]; } }
      let dx = far && fd > 8 ? ax - far[0] : p.seat === 1 ? -1 : 1, dy = far && fd > 8 ? (ay - far[1]) : 0;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy = dy / l - 0.9;
      const m = Math.hypot(dx, dy) || 1;
      best = [dx / m, dy / m];
    }
    this.dirs.set(key, best);
    return best;
  }

  draw(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[]) {
    const u = L.u * (L.compact ? 0.82 : 1);
    // a newer word near an older one pushes it away (sliding, as the newer one pops in: up if it was above, down if
    // below), so two never sit on each other; a fling, flying off, pushes but isn't pushed
    const live = st.pops.filter((p) => p.age >= 0 && p.age < popLife(p.kind)).sort((a, b) => a.age - b.age);
    const placed: { x: number; y: number; h: number; age: number }[] = [];
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      const life = popLife(p.kind), k = p.age / life, age = p.age;
      const look = lookOf(p, st), spr = word(p.text, look, u, dpr);
      const m = L.margin + spr.w * 0.36;
      const x0 = Math.max(m, Math.min(L.W - m, p.at[0] * L.W));
      const yMin = L.top + spr.h * 0.3;
      let y0 = Math.max(yMin, Math.min(L.H - L.margin - spr.h * 0.3, p.at[1] * L.H));
      const h = look.size * u * 1.5;
      if (p.kind !== 'fling') for (const q of placed) {
        if (Math.abs(q.x - x0) > 150 * u) continue;
        const sep = (q.h + h) * 0.55, d = y0 - q.y;
        if (Math.abs(d) >= sep) continue;
        // (pushed up unless that would put it over the panels and their combos: then down)
        const e = easeOut(q.age / 0.15), side = d > 0 || q.y - sep < yMin ? 1 : -1;
        y0 += (q.y + side * sep - y0) * e;
      }
      placed.push({ x: x0, y: y0, h, age });
      const fade = 1 - clamp01((k - 0.62) / 0.38);
      let x = x0, y = y0, sc = 1, a = clamp01(age / 0.05) * fade, rot = 0, sx = 1;
      const col = st.players.find((q) => q.seat === p.seat)?.color ?? '#ffffff';
      switch (p.kind) {
        case 'catch': {
          // snaps in, a ring closing on it
          const s = clamp01(age / 0.11);
          sc = s < 1 ? 1.75 - 0.83 * easeOut(s) : 0.92 + 0.08 * easeOut(clamp01((age - 0.11) / 0.12));
          a = clamp01(age / 0.07) * fade;
          y -= 14 * u * easeOut(clamp01((age - 0.4) / 0.6));
          const r = clamp01(age / 0.16);
          if (r < 1) {
            g.lineWidth = Math.max(1, 2.4 * u * (1 - r));
            g.strokeStyle = rgba(lift(col, 0.5), 0.85 * (1 - r));
            g.beginPath(); g.arc(x, y, spr.h * (0.95 - 0.55 * easeOut(r)), 0, Math.PI * 2); g.stroke();
          }
          break;
        }
        case 'swing': {
          // hangs from a point above it and swings
          const d = 30 * u, th = 0.55 * Math.exp(-2.6 * age) * Math.cos(age * 8.5);
          const px = x0, py = y0 - d;
          x = px + Math.sin(th) * d; y = py + Math.cos(th) * d - 10 * u * easeOut(k);
          rot = -th * 0.8;
          sc = 0.7 + 0.3 * easeOutBack(clamp01(age / 0.18));
          break;
        }
        case 'fling': {
          // off on its tangent, stretched, trailing ghosts
          const [dx, dy] = this.dirOf(p, st, L);
          const D = 190 * u, q = k, go = D * (0.55 * q + 0.45 * (1 - Math.pow(1 - q, 3)));
          x = x0 + dx * go; y = y0 + dy * go;
          sc = 0.8 + 0.2 * easeOutBack(clamp01(age / 0.12));
          sx = 1 + 0.25 * (1 - clamp01(age / 0.35));
          rot = Math.max(-0.3, Math.min(0.3, Math.atan2(dy, Math.abs(dx)) * Math.sign(dx || 1) * 0.35));
          a = clamp01(age / 0.04) * (1 - clamp01((k - 0.5) / 0.5));
          for (let i = 2; i >= 1; i--) {
            const gq = Math.max(0, q - i * 0.07), gg = D * (0.55 * gq + 0.45 * (1 - Math.pow(1 - gq, 3)));
            drawWord(g, spr, x0 + dx * gg, y0 + dy * gg, sc * sx, sc, rot, a * (0.32 - i * 0.1));
          }
          break;
        }
        case 'perfect': {
          sc = 0.65 + 0.35 * easeOutBack(clamp01(age / 0.16));
          y -= 38 * u * easeOut(k);
          const r = clamp01(age / 0.4);
          if (r < 1) {
            g.lineWidth = Math.max(1, 1.6 * u * (1 - r));
            g.strokeStyle = rgba(GOLD_HI, 0.8 * (1 - r));
            g.beginPath(); g.ellipse(x, y, spr.w * 0.18 + 40 * u * easeOut(r), spr.h * 0.2 + 12 * u * easeOut(r), 0, 0, Math.PI * 2); g.stroke();
          }
          break;
        }
        case 'combo': {
          const s = clamp01(age / 0.14);
          sc = s < 1 ? 1.55 - 0.6 * easeOut(s) : 0.95 + 0.05 * easeOutBack(clamp01((age - 0.14) / 0.2));
          const shiver = Math.exp(-age * 9) * 2.2 * u;
          x += Math.sin(age * 70) * shiver;
          y -= 30 * u * easeOut(clamp01((age - 0.2) / 0.8));
          break;
        }
        case 'merge': {
          // two halves sliding together, then one with a flash
          const c = clamp01(age / 0.32), off = 46 * u * (1 - easeOut(c));
          y -= 18 * u * easeOut(k);
          if (c < 1) {
            drawWord(g, spr, x - off, y, 1, 1, 0, a * 0.55);
            drawWord(g, spr, x + off, y, 1, 1, 0, a * 0.55);
            a = 0;
          } else {
            const f = clamp01((age - 0.32) / 0.35);
            if (f < 1) stamp(g, glow('#ffffff', spr.h * 0.9, dpr, 0.6), x, y, 1 + 0.5 * f, 0.8 * (1 - f));
            sc = 1.08 - 0.08 * easeOut(f);
          }
          break;
        }
        default:
          sc = 0.8 + 0.2 * easeOutBack(clamp01(age / 0.16));
          y -= 34 * u * easeOut(k);
      }
      // (rising, a word stops under the panels and their combos; a fling may fly over them)
      if (p.kind !== 'fling') y = Math.max(y, yMin);
      if (a > 0.003) drawWord(g, spr, x, y, sc * sx, sc, rot, a);
      const reach = p.kind === 'fling' ? 200 * u : p.kind === 'merge' ? 50 * u : 4;
      const hw = spr.w * 0.62 * Math.max(sc * sx, 1.75) + reach, hh = spr.h * 0.62 * Math.max(sc, 1.75) + reach + 40 * u;
      out.push({ x: x0 - hw, y: y0 - hh, w: hw * 2, h: hh * 2 });
    }
  }
}

/** a word stamped at x, y, scaled (sx, sy) and turned by rot */
function drawWord(g: Ctx, s: ReturnType<typeof word>, x: number, y: number, sx: number, sy: number, rot: number, a: number) {
  if (a <= 0.003) return;
  if (rot === 0 && sx === sy) { stamp(g, s, x, y, sx, a); return; }
  g.save();
  g.translate(x, y); g.rotate(rot); g.scale(sx, sy);
  stamp(g, s, 0, 0, 1, a);
  g.restore();
}

/** the words, tags and icons a dance battle will surely need, to make ahead (one a frame: Hud's warm-up) so the
 *  first catch costs nothing */
export function warmPops(st: HudState, L: Layout, dpr: number): (() => void)[] {
  const u = L.u * (L.compact ? 0.82 : 1), out: (() => void)[] = [];
  const pop = (text: string, kind: PopKind, seat?: number) => () => { word(text, lookOf({ text, kind, seat, at: [0, 0], age: 0 }, st), u, dpr); };
  out.push(pop('PERFECT', 'perfect'), pop('MERGE', 'merge'), pop('COMBO ×4', 'combo'), pop('COMBO ×6', 'combo'));
  for (const p of st.players) {
    out.push(pop('CATCH', 'catch', p.seat), pop('SWING', 'swing', p.seat), pop('FLING', 'fling', p.seat), pop('FLING ×2', 'fling', p.seat));
    out.push(() => { tag(p, L.u * (L.compact ? 0.9 : 1), dpr); });
    const isz = (L.compact ? 14 : 22) * L.u;
    for (const k of LINK_KINDS) out.push(() => { linkIcon(k, isz, lift(p.color, 0.45), false, dpr); });
  }
  const isz = (L.compact ? 14 : 22) * L.u;
  for (const k of LINK_KINDS) out.push(() => { linkIcon(k, isz, '', true, dpr); });
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

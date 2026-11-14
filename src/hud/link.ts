// The link on screen: while the two are joined (`link.on`, its ends `from`, the holder's contact point, and `to`, the
// held body's), the holder's grip drawn so who holds whom reads at a glance (phase 2's fix 5): a tether in the
// holder's colour all the way, a tapering ribbon wide and bright at the grip and fading into the held body, a ring
// closed at the holder's end like a hand, and only a faint glow of the held one's own colour at the other. Drawn
// additively ('lighter'), with a slight bow that sways and a swell on the beat; no beads or filaments (the contact
// was a ball of light with words on it). The world's matter carries the rest (src/duel/fx.ts lights the holder's arm
// too). It comes on and goes off over a tenth of a second.
import type { HudState } from './state';
import type { Layout, Box } from './layout';
import { glow, lift, rgba, stamp, approach, clamp01, type Ctx } from './style';

const N = 18;

export class LinkLine {
  private t = 0;
  private on = 0;
  private e = 0;
  private last: { a: [number, number]; b: [number, number]; ca: string; cb: string } | null = null;

  update(st: HudState, dt: number) {
    this.t += dt;
    const L = st.link, has = L.on && !!L.from && !!L.to;
    this.on = approach(this.on, has ? 1 : 0, has ? 22 : 12, dt);
    this.e = approach(this.e, clamp01(L.energy), 8, dt);
  }

  draw(g: Ctx, st: HudState, Ly: Layout, dpr: number, out: Box[]) {
    const L = st.link;
    if (L.on && L.from && L.to) {
      // the holder's end is `from`: colour it by whoever holds
      const holder = st.players.find((p) => p.holding) ?? st.players[0];
      const held = st.players.find((p) => p !== holder) ?? holder;
      this.last = { a: [L.from[0] * Ly.W, L.from[1] * Ly.H], b: [L.to[0] * Ly.W, L.to[1] * Ly.H], ca: holder?.color ?? '#ffffff', cb: held?.color ?? '#ffffff' };
    }
    const k = this.on;
    if (k < 0.02 || !this.last) return;
    const { a, b, ca, cb } = this.last, u = Ly.u, t = this.t, e = this.e;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 2) return;
    // (a line across the whole screen is a bad reading of the state: not drawn)
    if (len > Math.hypot(Ly.W, Ly.H) * 0.8) return;
    const nx = -dy / len, ny = dx / len;
    const spb = 60 / Math.max(30, st.beat.bpm || 120), ph = ((st.beat.phase % 1) + 1) % 1;
    const beatK = Math.exp(-ph * spb * 6);
    const bow = len * (0.03 + 0.015 * Math.sin(t * 2.1));
    const pt = (q: number): [number, number] => {
      const s = Math.sin(Math.PI * q);
      return [a[0] + dx * q + nx * bow * s, a[1] + dy * q + ny * bow * s];
    };
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round'; g.lineJoin = 'round';
    const swell = 1 + 0.35 * beatK;
    // the holder's colour all the way, bright at its grip and fading into the held body
    const grad = (al: number, l: number) => {
      const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
      gr.addColorStop(0, rgba(lift(ca, l), al)); gr.addColorStop(0.7, rgba(lift(ca, l * 0.6), al * 0.55)); gr.addColorStop(1, rgba(ca, al * 0.2));
      return gr;
    };
    // the tether: a tapering ribbon, wide at the grip
    const w0 = (2.2 + 1.4 * e) * u * swell;
    g.beginPath();
    for (let i = 0; i <= N; i++) { const q = i / N, [x, y] = pt(q), w = w0 * (1 - 0.75 * q); if (i) g.lineTo(x + nx * w, y + ny * w); else g.moveTo(x + nx * w, y + ny * w); }
    for (let i = N; i >= 0; i--) { const q = i / N, [x, y] = pt(q), w = w0 * (1 - 0.75 * q); g.lineTo(x - nx * w, y - ny * w); }
    g.closePath();
    g.fillStyle = grad(k * (0.55 + 0.3 * e + 0.15 * beatK), 0.45);
    g.fill();
    // its breath: wide and faint
    g.beginPath();
    for (let i = 0; i <= N; i++) { const [x, y] = pt(i / N); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.lineWidth = (6 + 5 * e) * u * swell;
    g.strokeStyle = grad(0.06 * k * (0.6 + 0.6 * e), 0.1);
    g.stroke();
    // the grip: a ring closed at the holder's end, its light inside
    const gr = (6 + 2 * e) * u * (1 + 0.15 * beatK);
    stamp(g, glow(lift(ca, 0.45), (9 + 6 * e) * u * swell, dpr, 0.65), a[0], a[1], 1, k * (0.7 + 0.25 * e));
    g.lineWidth = Math.max(1.2, 1.8 * u);
    g.strokeStyle = rgba(lift(ca, 0.6), k * 0.85);
    g.beginPath(); g.arc(a[0], a[1], gr, 0, Math.PI * 2); g.stroke();
    // the held end: only a faint glow of its own colour
    stamp(g, glow(lift(cb, 0.3), (5 + 3 * e) * u, dpr, 0.5), b[0], b[1], 1, k * 0.35);
    g.globalCompositeOperation = prev;
    g.lineCap = 'butt';
    const pad = Math.abs(bow) + 26 * u;
    out.push({ x: Math.min(a[0], b[0]) - pad, y: Math.min(a[1], b[1]) - pad, w: Math.abs(dx) + pad * 2, h: Math.abs(dy) + pad * 2 });
  }
}

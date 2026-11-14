// The link on screen: while the two are joined (`link.on`, its ends `from` and `to` on screen), a thin line of light
// between the contact points. It is meant to read as energy passing between two bodies, not as a UI line: drawn
// additively ('lighter'), a faint wide breath round a bright core shading from the holder's colour to the held's,
// two filaments twisting round it, a slight bow that sways, beads of light running both ways (faster with the
// link's energy), the whole thing swelling on the beat, and a small glow at each contact. It stays light on purpose:
// the world's matter carries the real effect. It comes on and goes off over a tenth of a second.
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
    const bow = len * (0.05 + 0.03 * Math.sin(t * 2.1)) * (0.6 + 0.4 * e);
    const pt = (q: number, off: number): [number, number] => {
      const s = Math.sin(Math.PI * q);
      return [a[0] + dx * q + nx * (bow * s + off), a[1] + dy * q + ny * (bow * s + off)];
    };
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round'; g.lineJoin = 'round';
    const grad = (al: number, l: number) => {
      const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
      gr.addColorStop(0, rgba(lift(ca, l), al)); gr.addColorStop(1, rgba(lift(cb, l), al));
      return gr;
    };
    const path = (off: (q: number) => number) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) { const q = i / N, [x, y] = pt(q, off(q)); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    };
    const swell = 1 + 0.5 * beatK;
    // the breath: wide and faint
    path(() => 0);
    g.lineWidth = (5 + 7 * e) * u * swell;
    g.strokeStyle = grad(0.07 * k * (0.6 + 0.6 * e), 0.1);
    g.stroke();
    // the core
    g.lineWidth = (1 + 0.8 * e) * u * swell;
    g.strokeStyle = grad(k * (0.45 + 0.4 * e + 0.15 * beatK), 0.45);
    g.stroke();
    // two filaments twisting round it, thinning to the contacts
    for (let f = 0; f < 2; f++) {
      const amp = (1.6 + 3.2 * e) * u, w = 6 + 8 * e, ph0 = f * Math.PI;
      path((q) => amp * Math.sin(Math.PI * q) * Math.sin(q * Math.PI * 5 - t * w + ph0));
      g.lineWidth = Math.max(0.8, 0.85 * u);
      g.strokeStyle = grad(k * (0.3 + 0.35 * e), 0.6);
      g.stroke();
    }
    // beads running both ways
    const speed = 0.45 + 1.3 * e;
    for (let i = 0; i < 4; i++) {
      const fwd = i % 2 === 0, q0 = ((t * speed + i * 0.27) % 1 + 1) % 1, q = fwd ? q0 : 1 - q0;
      const [x, y] = pt(q, 0);
      const fade = Math.sin(Math.PI * q);
      stamp(g, glow(lift(fwd ? ca : cb, 0.6), (2.6 + 2.4 * e) * u, dpr, 0.95), x, y, 1, k * fade * (0.5 + 0.5 * e));
    }
    // the contacts
    stamp(g, glow(lift(ca, 0.4), (7 + 7 * e) * u * swell, dpr, 0.6), a[0], a[1], 1, k * (0.55 + 0.3 * e));
    stamp(g, glow(lift(cb, 0.4), (7 + 7 * e) * u * swell, dpr, 0.6), b[0], b[1], 1, k * (0.55 + 0.3 * e));
    g.globalCompositeOperation = prev;
    g.lineCap = 'butt';
    const pad = Math.abs(bow) + 24 * u;
    out.push({ x: Math.min(a[0], b[0]) - pad, y: Math.min(a[1], b[1]) - pad, w: Math.abs(dx) + pad * 2, h: Math.abs(dy) + pad * 2 });
  }
}

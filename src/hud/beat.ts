// The beat indicator at the bottom centre, so players can play on the music: a still ring (the beat) and a ring
// closing on it once a beat, landing on it exactly on the beat, with the perfect window drawn as a soft gold band
// round the still ring (the band's width is the window: the closing ring is inside it for exactly the window's time
// either side of the beat). While the closing ring is in the window the band and the still ring light; on the beat
// itself the ring flashes outward. Strokes only (a few arcs a frame) and one glow sprite.
import type { HudBeat } from './state';
import type { Layout, Box } from './layout';
import { GOLD, GOLD_HI, glow, rgba, stamp, clamp01, easeOut, type Ctx } from './style';

export function drawBeat(g: Ctx, b: HudBeat, L: Layout, dpr: number, out: Box[]) {
  const { x, y, r: R, rMax } = L.beat, u = L.u;
  const spb = 60 / Math.max(30, b.bpm || 120);
  const ph = ((b.phase % 1) + 1) % 1;
  const toNext = (1 - ph) * spb, since = ph * spb, w = Math.max(0, b.window);
  const inWindow = toNext <= w || since <= w;
  const perSec = (rMax - R) / spb;
  const d = Math.min(R * 0.8, perSec * w);

  // the well: a faint dark disc so the rings read over a bright sky
  g.beginPath(); g.arc(x, y, rMax + 3 * u, 0, Math.PI * 2);
  const well = g.createRadialGradient(x, y, R * 0.4, x, y, rMax + 3 * u);
  well.addColorStop(0, 'rgba(8,6,14,0.34)'); well.addColorStop(0.6, 'rgba(8,6,14,0.18)'); well.addColorStop(1, 'rgba(8,6,14,0)');
  g.fillStyle = well; g.fill();

  // the perfect window: a band round the still ring, its edges drawn as hairlines so its width reads at a glance;
  // in the window the heart fills gold too (the whole mark changes colour: seen from the corner of the eye)
  g.lineWidth = d * 2;
  g.strokeStyle = rgba(GOLD, inWindow ? 0.42 : 0.14);
  g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = Math.max(1, 0.9 * u);
  g.strokeStyle = rgba(GOLD, inWindow ? 0.9 : 0.4);
  g.beginPath(); g.arc(x, y, R + d, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(x, y, Math.max(1, R - d), 0, Math.PI * 2); g.stroke();
  if (inWindow) {
    g.beginPath(); g.arc(x, y, Math.max(1, R - d), 0, Math.PI * 2);
    g.fillStyle = rgba(GOLD, 0.2); g.fill();
  }

  // the beat's flash, outward from the still ring
  if (since < 0.28) {
    const e = since / 0.28;
    stamp(g, glow(GOLD, R * 2.2, dpr, 0.55), x, y, 1, (1 - e) * 0.8);
    g.lineWidth = Math.max(1, 2 * u * (1 - e));
    g.strokeStyle = rgba(GOLD_HI, 0.8 * (1 - e));
    g.beginPath(); g.arc(x, y, R + 9 * u * easeOut(e), 0, Math.PI * 2); g.stroke();
  }

  // the still ring (dark under light, for contrast)
  g.lineWidth = 3.2 * u; g.strokeStyle = 'rgba(6,4,12,0.4)';
  g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.6 * u; g.strokeStyle = inWindow ? GOLD_HI : 'rgba(255,255,255,0.6)';
  g.stroke();

  // the closing ring: it fades in as it starts, far out, and lands on the still ring on the beat
  const rr = R + (rMax - R) * (1 - ph);
  const a = clamp01(ph / 0.3) * (inWindow ? 1 : 0.8);
  if (a > 0.01 && rr > R + 0.5) {
    g.lineWidth = 3.4 * u; g.strokeStyle = `rgba(6,4,12,${(0.35 * a).toFixed(3)})`;
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.8 * u; g.strokeStyle = inWindow ? rgba(GOLD_HI, a) : `rgba(236,230,244,${a.toFixed(3)})`;
    g.stroke();
  }

  // the heart: a dot that swells on the beat
  const pulse = Math.exp(-since * 9);
  g.beginPath(); g.arc(x, y, (2.2 + 2.2 * pulse) * u, 0, Math.PI * 2);
  g.fillStyle = rgba(pulse > 0.3 ? GOLD_HI : '#ece6f4', 0.55 + 0.45 * pulse); g.fill();

  const e = rMax + 6 * u;
  out.push({ x: x - Math.max(e, R * 2.2), y: y - Math.max(e, R * 2.2), w: 2 * Math.max(e, R * 2.2), h: 2 * Math.max(e, R * 2.2) });
}

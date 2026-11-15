// The winner's banner as a garland (phase 5, report 17: "the banner is a dark band that arrives empty a few frames
// before its words"; the art bible: "the banner is a garland"). A pane of the HUD's smoked honey glass drawn to a leaf's
// tip at each end, two gold stems along its edges swelling and tapering like an art-nouveau whiplash, leaves along them
// and small flowers in both seats' colours, coral and sun, a sun of gold petals at the top's middle and a curl at each
// stem's end. Made once as a sprite (by size, ratio and colours) and opened from the middle: `drawGarland` shows the
// part within `half` of the centre, a bud of light at each stem's growing tip, so the words (clipped to the same
// window by centre.ts) open with it and the band is never seen empty.
import { GLASS, PALETTE } from './theme';
import { glow, leaf, petals, rgba, sprite, stamp, type Ctx } from './style';

/** the garland's pane: its ends are a leaf's tip this long (× its height), and the leaves and flowers reach this far
 *  past its edges (× u) */
export const GARLAND = { TIP: 0.42, PAD: 40, LEAF_EVERY: 19, FLOWER_EVERY: 86, AMP: 6 };

/** the pane's outline, a band whose ends draw to a leaf's tip (x0 … x1 the band, y0 … y1 its edges) */
function pane(g: Ctx, x0: number, x1: number, y0: number, y1: number, tip: number) {
  const m = (y0 + y1) / 2;
  g.beginPath();
  g.moveTo(x0 - tip, m);
  g.bezierCurveTo(x0 - tip * 0.55, y0 + (m - y0) * 0.1, x0 - tip * 0.2, y0, x0, y0);
  g.lineTo(x1, y0);
  g.bezierCurveTo(x1 + tip * 0.2, y0, x1 + tip * 0.55, y0 + (m - y0) * 0.1, x1 + tip, m);
  g.bezierCurveTo(x1 + tip * 0.55, y1 - (y1 - m) * 0.1, x1 + tip * 0.2, y1, x1, y1);
  g.lineTo(x0, y1);
  g.bezierCurveTo(x0 - tip * 0.2, y1, x0 - tip * 0.55, y1 - (y1 - m) * 0.1, x0 - tip, m);
  g.closePath();
}

/** a stem's height at x along it: the top's (s = 1) a gentle wave either side of its edge `y`, the bottom's (s = -1)
 *  swags hanging from the edge between its flowers, each `period` long */
const stemY = (x: number, cx: number, y: number, amp: number, period: number, s: number) => {
  const d = Math.abs(x - cx) / period, w = Math.sin(Math.PI * d);
  return s > 0 ? y - amp * 0.9 * w : y + amp * 2.2 * Math.abs(w);
};

/** the garland whole, as a sprite W × (H + 2 PAD) anchored at its middle */
function garlandSprite(W: number, H: number, u: number, dpr: number, seats: readonly string[]) {
  const pad = GARLAND.PAD * u, SH = H + pad * 2;
  return sprite(`garland:${W.toFixed(0)}x${H.toFixed(0)}:${u.toFixed(2)}:${seats.join(',')}`, dpr, W, SH, W / 2, SH / 2, (g) => {
    const cx = W / 2, y0 = pad, y1 = pad + H, tip = H * GARLAND.TIP, span = W * 0.5 - tip - 6 * u;
    const x0 = cx - span, x1 = cx + span;
    // the glass: smoked honey, warm light pooled along the top, darker toward the tips
    pane(g, x0, x1, y0, y1, tip);
    const bg = g.createLinearGradient(0, y0, 0, y1);
    bg.addColorStop(0, rgba(GLASS.top, 0.8));
    bg.addColorStop(1, rgba(GLASS.foot, 0.84));
    g.fillStyle = bg; g.fill();
    const sheen = g.createLinearGradient(x0 - tip, 0, x1 + tip, 0);
    sheen.addColorStop(0, rgba(PALETTE.sun, 0)); sheen.addColorStop(0.5, rgba(PALETTE.sun, 0.13)); sheen.addColorStop(1, rgba(PALETTE.sun, 0));
    g.fillStyle = sheen; g.fill();
    const pool = g.createRadialGradient(cx, (y0 + y1) / 2, 0, cx, (y0 + y1) / 2, span * 0.55);
    pool.addColorStop(0, rgba(PALETTE.honey, 0.22)); pool.addColorStop(1, rgba(PALETTE.honey, 0));
    g.fillStyle = pool; g.fill();
    // its came: dark lead under thin gold, and a cream hairline inside
    g.lineJoin = 'round';
    g.lineWidth = 3.2 * u; g.strokeStyle = GLASS.lead; g.stroke();
    const gold = g.createLinearGradient(0, y0, 0, y1);
    gold.addColorStop(0, rgba(PALETTE.sunHi, 0.95)); gold.addColorStop(0.5, rgba(PALETTE.sun, 0.9)); gold.addColorStop(1, rgba(PALETTE.honey, 0.9));
    g.lineWidth = 1.3 * u; g.strokeStyle = gold; g.stroke();
    pane(g, x0 + 4 * u, x1 - 4 * u, y0 + 4 * u, y1 - 4 * u, tip * 0.9);
    g.lineWidth = Math.max(0.6, 0.6 * u); g.strokeStyle = rgba(PALETTE.cream, 0.22); g.stroke();
    // the two stems along the edges, swelling from their ends to the middle, gold
    const amp = GARLAND.AMP * u, period = GARLAND.FLOWER_EVERY * u, cols = [seats[0] ?? PALETTE.coral, PALETTE.sun, seats[1] ?? PALETTE.leaf, PALETTE.coral];
    for (const [ey, s] of [[y0, 1], [y1, -1]] as const) {
      // (each half drawn from the middle out, thinner toward its end)
      for (const dir of [-1, 1]) {
        const steps = 48, len = span + tip * 0.75;
        let px = cx, py = stemY(cx, cx, ey, amp, period, s);
        for (let i = 1; i <= steps; i++) {
          const x = cx + dir * (len * i) / steps, y = stemY(x, cx, ey, amp, period, s), k = 1 - i / steps;
          g.beginPath(); g.moveTo(px, py); g.lineTo(x, y);
          g.lineCap = 'round'; g.lineWidth = (0.9 + 2.2 * k) * u;
          g.strokeStyle = rgba(k > 0.5 ? PALETTE.sun : PALETTE.honey, 0.95);
          g.stroke();
          px = x; py = y;
        }
        // the curl at its end: a small spiral turning back toward the pane
        g.beginPath();
        for (let j = 0; j <= 20; j++) {
          const a = (j / 20) * Math.PI * 1.7, r = 9 * u * (1 - 0.6 * j / 20);
          const x = px + dir * (Math.sin(a) * r), y = py - s * (r - Math.cos(a) * r);
          if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.lineWidth = 0.9 * u; g.strokeStyle = rgba(PALETTE.honey, 0.9); g.stroke();
        // leaves along it, out of the pane and into it in turn, and flowers at intervals
        let n = 0;
        for (let d = 22 * u; d < len - 10 * u; d += GARLAND.LEAF_EVERY * u, n++) {
          const x = cx + dir * d, y = stemY(x, cx, ey, amp, period, s), out = n % 2 ? 1 : -1;
          // (along the stem, outward, tilted up and down in turn)
          const L = (17 + 5 * ((n * 7) % 3)) * u * (1 - 0.3 * (d / len)), ang = (dir > 0 ? 0 : Math.PI) + dir * out * 0.8;
          g.beginPath(); leaf(g, x, y, L, L * 0.48, ang);
          const lg = g.createLinearGradient(x, y, x + Math.cos(ang) * L, y + Math.sin(ang) * L);
          lg.addColorStop(0, PALETTE.moss); lg.addColorStop(1, PALETTE.leaf);
          g.fillStyle = lg; g.fill();
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * L * 0.8, y + Math.sin(ang) * L * 0.8);
          g.lineWidth = 0.6 * u; g.strokeStyle = rgba(PALETTE.sunHi, 0.55); g.stroke();
        }
        // (the bottom's flowers where its swags hang from, the top's on its wave's crests between them)
        for (let d = (s > 0 ? 0.5 : 1) * period, k = 0; d < len - 24 * u; d += period, k++) {
          const x = cx + dir * d, y = stemY(x, cx, ey, amp, period, s), r = (11.5 - 2.5 * (d / len)) * u;
          g.beginPath(); petals(g, x, y, r * 0.3, r, 5, k * 0.7 + (dir > 0 ? 0.3 : 0), 0.95);
          const fc = cols[(k + (s > 0 ? 0 : 2) + (dir > 0 ? 1 : 0)) % cols.length];
          const pg = g.createRadialGradient(x, y, 0, x, y, r);
          pg.addColorStop(0, rgba(PALETTE.sunHi, 1)); pg.addColorStop(0.45, fc); pg.addColorStop(1, fc);
          g.fillStyle = pg; g.fill();
          g.lineWidth = 0.6 * u; g.strokeStyle = rgba(PALETTE.honey, 0.8); g.stroke();
          g.beginPath(); g.arc(x, y, r * 0.28, 0, Math.PI * 2); g.fillStyle = PALETTE.sun; g.fill();
        }
      }
    }
    // the sun at the top's middle: a crown of gold petals round a honey disc
    const sy = stemY(cx, cx, y0, amp, period, 1);
    stamp(g, glow(PALETTE.sun, 36 * u, dpr, 0.45), cx, sy);
    g.beginPath(); petals(g, cx, sy, 8 * u, 21 * u, 14, 0, 0.8);
    g.fillStyle = PALETTE.sun; g.fill();
    g.lineWidth = 0.7 * u; g.strokeStyle = rgba(PALETTE.honey, 0.9); g.stroke();
    g.beginPath(); g.arc(cx, sy, 8.5 * u, 0, Math.PI * 2);
    const dg = g.createRadialGradient(cx - 2 * u, sy - 2 * u, 0, cx, sy, 8.5 * u);
    dg.addColorStop(0, PALETTE.sunHi); dg.addColorStop(1, PALETTE.honey);
    g.fillStyle = dg; g.fill();
    // and a sprig of two leaves under the bottom's middle
    const by = stemY(cx, cx, y1, amp, period, -1);
    for (const sd of [-1, 1]) { g.beginPath(); leaf(g, cx, by, 13 * u, 6 * u, Math.PI / 2 + sd * 0.7); g.fillStyle = PALETTE.leaf; g.fill(); }
  });
}

/** the garland across the screen at its middle (cx, cy), H tall, shown `half` px either side of the middle (its full
 *  width is W): the sprite clipped to that window and a bud of light at each stem's growing tip. Returns the box it
 *  covers (for the pops to keep off) */
export function drawGarland(g: Ctx, cx: number, cy: number, W: number, H: number, half: number, u: number, dpr: number, seats: readonly string[], a = 1) {
  const spr = garlandSprite(W, H, u, dpr, seats), pad = GARLAND.PAD * u;
  if (half <= 0.5 || a <= 0.003) return;
  g.save();
  g.beginPath(); g.rect(cx - half, cy - H / 2 - pad, half * 2, H + pad * 2); g.clip();
  stamp(g, spr, cx, cy, 1, a);
  g.restore();
  // the growing tips: a bud of sun where each stem has reached, while it grows
  const full = W * 0.5;
  if (half < full - 2) {
    const k = 1 - half / full, amp = GARLAND.AMP * u, period = GARLAND.FLOWER_EVERY * u;
    for (const dir of [-1, 1]) for (const [ey, s] of [[cy - H / 2, 1], [cy + H / 2, -1]] as const) {
      const x = cx + dir * half, y = stemY(x, cx, ey, amp, period, s);
      stamp(g, glow(PALETTE.sunHi, 14 * u, dpr, 0.8), x, y, 1, a * Math.min(1, 0.4 + k));
    }
  }
}

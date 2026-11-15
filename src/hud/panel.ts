// A dancer's panel in its top corner (a slim bar on a phone): the matter's emblem in a dark well, the name, the
// **style** (the battle's score: a number that rolls up, and flares gold as a combo cashes into it), the dash's
// readiness; and on the live layer, the **combo** hanging under the panel while it goes (its count, the whole combo's
// however few icons fit, its multiplier (past ×4 its tier's word instead, in the tier's colour, the row's rim in it), and
// the last few links as small icons, those landed on the beat in gold; a new link pops in), the combo's end (cashed:
// the row gathers and flies up into the style, which flares, "+n" rising from it; dropped by a fall: the icons sink
// and fade), and the **link** while the two are joined (a ring round the emblem in the partner's colour and a
// "HOLDING" / "HELD" chip); and the duel's **powers** (phase 2): the flow as a bar along the panel's foot (marks where
// each power's cost falls; gold when full, the power form running it down), and the two powers as icons at the inner
// end, ready in the matter's colour (gold-ringed in the form: free) or grey with the flow's way toward their cost, the
// key under each. Seat 1's panel is seat 0's mirrored: the emblem always on the outer edge. What never
// changes (the glass, the emblem, the name) is a sprite made once; the rest of the base is drawn only when a value
// changes or a piece of it is moving (the style rolling, the dash recharging).
import type { HudPlayer, HudState } from './state';
import type { Box, Layout } from './layout';
import { linkIcon } from './icons';
import { DISPLAY, FONT, GOLD, GOLD_HI, INK, glass, glyph, glyphLines, glow, haloText, label, leaded, leadGold, leaf, lift, matterOf, measure, petals, rgba, roundRect, sprite, stamp, stampDigits, stampLabel, approach, easeOut, easeOutBack, clamp01, type Ctx } from './style';
import { PALETTE } from './theme';

interface Metrics {
  em: { cx: number; cy: number; disc: number; glyph: number; ring: number; ringW: number; petal: number };
  name: { x: number; y: number; size: number; seat: number; display: boolean };
  style: { x: number; y: number; size: number; label: number };
  dash: { x: number; cy: number; size: number };
  chip: { cy: number; h: number; font: number; inset: number };
  combo: { inset: number; count: number; mult: number; icon: number; gap: number };
  r: number;
  /** the cartouche's leaf tip at the inner end: how far it runs in from the inner edge */
  tip: number;
  /** the sprig of leaves on the top edge where the tip begins (0: none) */
  sprig: number;
}
const DESKTOP: Metrics = {
  em: { cx: 42, cy: 42, disc: 24, glyph: 29, ring: 30, ringW: 2.6, petal: 6.5 },
  name: { x: 82, y: 28, size: 15, seat: 9.5, display: true },
  style: { x: 81, y: 63, size: 29, label: 9 },
  dash: { x: 38, cy: 58, size: 14 },
  chip: { cy: 24, h: 18, font: 9, inset: 26 },
  combo: { inset: 12, count: 21, mult: 12.5, icon: 22, gap: 5 },
  r: 18,
  tip: 30,
  sprig: 10,
};
const COMPACT: Metrics = {
  em: { cx: 20, cy: 20, disc: 13, glyph: 15.5, ring: 15.5, ringW: 1.7, petal: 3 },
  name: { x: 39, y: 14.5, size: 9.5, seat: 7, display: false },
  style: { x: 38.5, y: 33.5, size: 15, label: 0 },
  dash: { x: 16, cy: 11.5, size: 8 },
  chip: { cy: 12, h: 12, font: 7, inset: 9 },
  combo: { inset: 6, count: 12.5, mult: 8.5, icon: 14, gap: 2.5 },
  r: 12,
  tip: 14,
  sprig: 0,
};

/** the panel's pane: a cartouche, round at the outer end behind the medallion, a leaf's tip at the inner end. `x` maps
 *  units from the outer edge to canvas px (it mirrors seat 2's), `y` units from the top */
function cartouche(g: Ctx, M: Metrics, W: number, H: number, x: (v: number) => number, y: (v: number) => number) {
  const c = M.em.cx, T = M.tip, R = H / 2;
  g.beginPath();
  g.moveTo(x(c), y(0));
  g.lineTo(x(W - T), y(0));
  g.bezierCurveTo(x(W - T * 0.6), y(0), x(W - T * 0.32), y(H * 0.42), x(W), y(R));
  g.bezierCurveTo(x(W - T * 0.32), y(H * 0.58), x(W - T * 0.6), y(H), x(W - T), y(H));
  g.lineTo(x(c), y(H));
  g.bezierCurveTo(x(c - R * 0.56), y(H), x(c - R), y(H - R * 0.44), x(c - R), y(R));
  g.bezierCurveTo(x(c - R), y(R * 0.44), x(c - R * 0.56), y(0), x(c), y(0));
  g.closePath();
}

/** the player's own panel lit (report 18-you): its pane's outline in the seat's colour, a thin line all through play,
 *  wide and glowing in the set's opening and at the first press's answer */
function youRim(g: Ctx, p: HudPlayer, box: Box, M: Metrics, u: number, flip: boolean, out: Box[]) {
  const Y = p.you!, k = Math.max(Y.intro, Y.pulse);
  const x = (v: number) => (flip ? box.x + box.w - v * u : box.x + v * u), y = (v: number) => box.y + v * u;
  g.save();
  cartouche(g, M, box.w / u, box.h / u, x, y);
  g.lineJoin = 'round';
  if (k > 0.01) {
    g.shadowColor = rgba(p.color, 0.9 * k); g.shadowBlur = 16 * u * k;
    g.lineWidth = (1.6 + 2.4 * k) * u; g.strokeStyle = rgba(lift(p.color, 0.25), 0.55 + 0.45 * k); g.stroke();
    g.shadowBlur = 0;
  }
  g.lineWidth = Math.max(1, 1.5 * u); g.strokeStyle = rgba(lift(p.color, 0.35), 0.8); g.stroke();
  g.restore();
  const m = 24 * u;
  out.push({ x: box.x - m, y: box.y - m, w: box.w + 2 * m, h: box.h + 2 * m });
}

/** seconds: a new link popping in; a cashed combo gathering into the style; a dropped one sinking; the "+n" rising */
const POP_IN = 0.28, CASH = 0.62, DROP = 0.7, PLUS = 1.3;

interface Item { kind: string; gold: boolean; at: number }
interface Tier { n: number; name: string; color: string; at: number }
interface Ended { items: Item[]; n: number; mult: number; perfect: number; at: number; drop: boolean; style0: number; width: number; tier: Tier | null }

const fmt = (v: number) => {
  const s = String(Math.max(0, Math.round(v)));
  return s.length <= 3 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
/** the style's weight (the display face) */
const STYLE_W = 600;
const fmtMult = (m: number) => `×${Math.abs(m - Math.round(m)) < 0.05 ? Math.round(m) : m.toFixed(1)}`;

export class PlayerPanel {
  // what is shown (eased toward the state) and the motion in flight
  private styleShown = 0;
  private styleSeen = -1;
  private dashShown = 1;
  private reformShown = 0;
  private lastDashReady = true;
  private readyAt = -1;
  private flareAt = -9;
  private plus = 0;
  private plusAt = -9;
  private holdShown = 0;
  private holdWord = 'HOLDING';
  private items: Item[] = [];
  private wasLive = false;
  private lastN = 0;
  private lastPerfect = 0;
  private lastMult = 1;
  /** the live combo's tier (past ×4), and since when it shows (its word pops in) */
  private tier: Tier | null = null;
  private ended: Ended | null = null;
  private rowW = 0;
  private t = 0;
  private dt = 1 / 60;
  private sig = '';
  /** what the base drew last: where the style's number ends (the "+n" rises from there) and the room left for the chip */
  private styleEnd = 0;
  private chipRoom = 0;

  constructor(readonly seat: 0 | 1) {}

  /** advance the motion; true if the base must be drawn again this frame */
  update(p: HudPlayer, dt: number): boolean {
    this.t += dt;
    this.dt = dt;
    const t = this.t;
    const ready = p.dash >= 0.999;
    if (ready && !this.lastDashReady) this.readyAt = t;
    this.lastDashReady = ready;
    const d0 = this.dashShown, r0 = this.reformShown;
    // (the dash's recharge is shown as it is: it is already a smooth ramp; only a refill jumps, and that eases)
    this.dashShown = p.dash < d0 ? p.dash : Math.abs(p.dash - d0) < 0.004 ? p.dash : approach(d0, p.dash, 22, dt);
    this.reformShown = Math.abs(p.reforming - r0) < 0.003 ? p.reforming : approach(r0, p.reforming, 16, dt);
    this.holdShown = approach(this.holdShown, p.holding || p.held ? 1 : 0, 14, dt);
    // (the combo first: a combo ending this frame and the style it cashes in come together)
    this.track(p);

    // the style: rolls up toward the score (a big gain faster), straight down for a loss; the first value is taken as is
    if (this.styleSeen < 0) this.styleShown = p.style;
    else if (p.style > this.styleSeen + 0.5) {
      const gain = p.style - this.styleSeen;
      // a gain while a combo's end is fresh is that combo cashing in: the flare and "+n"
      if (this.ended && !this.ended.drop && t - this.ended.at < 0.6) {
        this.flareAt = t;
        this.plus = (t - this.plusAt < 0.5 ? this.plus : 0) + gain;
        this.plusAt = t;
      }
    }
    this.styleSeen = p.style;
    const s0 = this.styleShown;
    if (p.style < s0) this.styleShown = p.style;
    else if (p.style - s0 < 0.5) this.styleShown = p.style;
    else this.styleShown = s0 + Math.max(0.5, (p.style - s0) * (1 - Math.exp(-11 * dt)), Math.min(p.style - s0, 60 * dt));

    const flare = clamp01(1 - (t - this.flareAt) / 0.8);
    const moving = t - this.readyAt < 0.4 || flare > 0;
    const sig = [p.name, p.color, p.matter, Math.round(this.styleShown), this.dashShown.toFixed(3), this.reformShown.toFixed(3)].join('|');
    const changed = sig !== this.sig;
    this.sig = sig;
    return changed || moving;
  }

  /** follow the combo: which icons are new, which landed on the beat, and how the combo ended */
  private track(p: HudPlayer) {
    const c = p.combo, t = this.t, links = c.links ?? [];
    if (!c.live) {
      if (this.wasLive && this.items.length) {
        this.ended = { items: this.items, n: this.lastN, mult: this.lastMult, perfect: this.lastPerfect, at: t, drop: p.reforming > 0, style0: p.style, width: this.rowW, tier: this.tier };
      }
      this.items = []; this.lastN = 0; this.lastPerfect = 0; this.lastMult = 1; this.wasLive = false; this.tier = null;
      return;
    }
    // the tier: a new one pops its word in
    const tn = c.tier ?? 0;
    if (tn > 0 && c.tierName) { if (!this.tier || this.tier.n !== tn) this.tier = { n: tn, name: c.tierName, color: c.tierColor ?? GOLD, at: t }; }
    else this.tier = null;
    const fresh = !this.wasLive || c.n < this.lastN;
    if (fresh) this.ended = this.ended && t - this.ended.at < 0.25 ? this.ended : null;
    const dn = fresh ? c.n : c.n - this.lastN, dp = Math.max(0, c.perfect - (fresh ? 0 : this.lastPerfect));
    let items = this.items;
    if (dn > 0 && dn <= links.length && (fresh || this.aligned(links.slice(0, links.length - dn), items))) {
      // the new links are the last dn: the last dp of them landed on the beat
      const add = links.slice(links.length - dn).map((k, i) => ({ kind: k, gold: i >= dn - dp, at: fresh && c.n > 2 ? t - 1 : t }));
      items = [...(fresh ? [] : items), ...add].slice(-links.length);
    } else if (!this.aligned(links, items)) {
      // a jump (a still, a resync): can't tell which were on the beat, so the newest `perfect` of them
      const g = Math.min(c.perfect, links.length);
      items = links.map((k, i) => ({ kind: k, gold: i >= links.length - g, at: t - 1 }));
    }
    this.items = items;
    this.lastN = c.n; this.lastPerfect = c.perfect; this.lastMult = c.mult; this.wasLive = true;
  }

  private aligned(links: string[], items: Item[]) {
    // (items are the links' tail, kept the same length)
    const off = items.length - links.length;
    if (off < 0) return false;
    for (let i = 0; i < links.length; i++) if (items[off + i].kind !== links[i]) return false;
    return true;
  }

  /** forget the drawn state (a resize: everything is drawn again) */
  invalidate() { this.sig = ''; }

  // ---------------------------------------------------------------- the base: glass, emblem, name, style, dash
  draw(g: Ctx, p: HudPlayer, box: Box, compact: boolean, u: number, dpr: number) {
    const M = compact ? COMPACT : DESKTOP, flip = this.seat === 1;
    /** x within the panel from its outer edge, in units → canvas px */
    const X = (x: number) => (flip ? box.x + box.w - x * u : box.x + x * u);
    const Y = (y: number) => box.y + y * u;
    const t = this.t, col = p.color, [deep, light] = matterOf(p.matter);

    // the still part (a sprite)
    const key = `panel3:${this.seat}:${compact}:${box.w.toFixed(1)}:${box.h.toFixed(1)}:${u.toFixed(3)}:${p.name}:${col}:${p.matter}`;
    let nameEnd = 0;
    const still = sprite(key, dpr, box.w + 24 * u, box.h + 24 * u, 12 * u, 12 * u, (s) => {
      s.translate(12 * u, 12 * u);
      const x = (v: number) => (flip ? box.w - v * u : v * u), y = (v: number) => v * u;
      const W = box.w / u, H = box.h / u;
      // the pane: a cartouche of honey glass in gold leading, the seat's colour washing in from the medallion's side
      glass(s, 0, 0, box.w, box.h, M.r * u, col, flip ? 'right' : 'left', 1, () => cartouche(s, M, W, H, x, y));
      // a second came echoing the leaf tip inside it (a leaded pane's line), and a sprig of two leaves where it begins
      // (the desktop's only: on a phone the powers sit in the tip)
      const T = M.tip;
      if (M.sprig) {
        s.beginPath();
        s.moveTo(x(W - T * 1.1), y(H * 0.16));
        s.bezierCurveTo(x(W - T * 0.82), y(H * 0.16), x(W - T * 0.62), y(H * 0.42), x(W - T * 0.4), y(H / 2));
        s.bezierCurveTo(x(W - T * 0.62), y(H * 0.58), x(W - T * 0.82), y(H * 0.84), x(W - T * 1.1), y(H * 0.84));
        s.globalAlpha = 0.55;
        leaded(s, 0, box.h, Math.max(0.8, 0.9 * u));
        s.globalAlpha = 1;
      }
      if (M.sprig) {
        const sx0 = x(W - T - 4), sy0 = y(0.5), d = flip ? -1 : 1, L = M.sprig * u;
        const m = (a: number) => (flip ? Math.PI - a : a);
        s.beginPath();
        leaf(s, sx0, sy0, L, L * 0.5, m(-Math.PI * 0.2));
        leaf(s, sx0, sy0, L * 0.8, L * 0.45, m(-Math.PI * 0.86));
        const lg = s.createLinearGradient(sx0, sy0 - L, sx0 + d * L, sy0);
        lg.addColorStop(0, lift(PALETTE.leaf, 0.2)); lg.addColorStop(1, PALETTE.moss);
        s.fillStyle = lg; s.fill();
        leaded(s, sy0 - L, L, Math.max(0.6, 0.7 * u));
      }
      // the medallion: a crown of gold petals (a sun), a dark lead ring with a came of the seat's colour, the deep
      // honey well with the matter's glyph in it and its glow behind
      const ecx = x(M.em.cx), ecy = y(M.em.cy);
      stamp(s, glow(deep, M.em.ring * u * 1.2, dpr, 0.32), ecx, ecy);
      s.beginPath();
      petals(s, ecx, ecy, M.em.ring * u * 0.86, (M.em.ring + M.em.petal) * u, compact ? 10 : 12, -Math.PI / 2);
      s.fillStyle = leadGold(s, ecy - M.em.ring * u, M.em.ring * u * 2, 0.95); s.fill();
      s.lineWidth = Math.max(0.6, 0.7 * u); s.strokeStyle = 'rgba(40,26,8,0.55)'; s.stroke();
      s.beginPath(); s.arc(ecx, ecy, M.em.ring * u, 0, Math.PI * 2);
      s.fillStyle = 'rgba(26,19,9,0.96)'; s.fill();
      leaded(s, ecy - M.em.ring * u, M.em.ring * u * 2, Math.max(1, 1.3 * u));
      s.beginPath(); s.arc(ecx, ecy, (M.em.disc + (M.em.ring - M.em.disc) * 0.5) * u, 0, Math.PI * 2);
      s.lineWidth = Math.max(1, (M.em.ring - M.em.disc) * u * 0.42); s.strokeStyle = rgba(col, 0.85); s.stroke();
      const well = s.createRadialGradient(ecx, ecy - M.em.disc * u * 0.35, 0, ecx, ecy, M.em.disc * u);
      well.addColorStop(0, 'rgba(66,50,26,0.97)');
      well.addColorStop(1, 'rgba(16,11,5,0.97)');
      s.beginPath(); s.arc(ecx, ecy, M.em.disc * u, 0, Math.PI * 2);
      s.fillStyle = well; s.fill();
      s.lineWidth = 1; s.strokeStyle = rgba(light, 0.3); s.stroke();
      s.save();
      s.translate(ecx, ecy);
      const gs = M.em.glyph * u;
      const gg = s.createLinearGradient(0, -gs / 2, 0, gs / 2);
      gg.addColorStop(0, light); gg.addColorStop(0.55, lift(deep, 0.25)); gg.addColorStop(1, deep);
      glyph(s, p.matter, gs);
      s.fillStyle = gg; s.fill();
      glyphLines(s, p.matter, gs);
      s.lineWidth = Math.max(0.8, u * (compact ? 0.7 : 1.1)); s.strokeStyle = 'rgba(255,255,255,0.5)'; s.stroke();
      s.restore();
      // the seat ("P1", in its colour) and the name in caps after it; a name that already starts with its seat ("P1 ·
      // LEAD") is not told it twice
      s.textBaseline = 'alphabetic';
      s.textAlign = flip ? 'right' : 'left';
      const tag = `P${this.seat + 1}`, d = flip ? -1 : 1;
      let full = p.name.toUpperCase();
      if (full.startsWith(tag)) full =full.slice(tag.length).replace(/^[\s·:.-]+/, '');
      s.font = `800 ${M.name.seat * u}px ${FONT}`;
      s.letterSpacing = `${(M.name.seat * u * 0.1).toFixed(2)}px`;
      const tw0 = s.measureText(tag).width, gap = 5 * u;
      haloText(s, tag, x(M.name.x), y(M.name.y), lift(col, 0.25), 0.5, Math.max(2, 2.4 * u));
      const nx = x(M.name.x) + d * (tw0 + gap);
      s.font = M.name.display ? `600 ${M.name.size * u}px ${DISPLAY}` : `700 ${M.name.size * u}px ${FONT}`;
      s.letterSpacing = `${(M.name.size * u * (M.name.display ? 0.07 : 0.05)).toFixed(2)}px`;
      let name = full;
      const room = box.w - M.name.x * u - tw0 - gap - (compact ? (M.dash.x + M.dash.size * 0.7 + 3) * u : (M.dash.x + 14) * u);
      while (name.length > 1 && s.measureText(name).width > room) name = name.slice(0, -1);
      if (name !== full) name = name.slice(0, -1) + '…';
      haloText(s, name, nx, y(M.name.y), PALETTE.cream, 0.45, Math.max(2, 2.6 * u));
      nameEnd = M.name.x * u + tw0 + gap + s.measureText(name).width;
    });
    if (nameEnd) this.chipRoom = box.w - nameEnd - M.chip.inset * u - 6 * u;
    stamp(g, still, box.x, box.y);

    const ecx = X(M.em.cx), ecy = Y(M.em.cy);
    g.lineCap = 'round';
    // reforming (after a fall): the glyph dims and a thin arc fills inside the ring
    if (this.reformShown > 0.003) {
      g.beginPath(); g.arc(ecx, ecy, M.em.disc * u - 0.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(16,11,5,0.62)'; g.fill();
      g.lineWidth = Math.max(1.2, 1.6 * u);
      g.beginPath(); g.arc(ecx, ecy, M.em.disc * u - 3 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.reformShown);
      g.strokeStyle = rgba(light, 0.9); g.stroke();
    }
    g.lineCap = 'butt';

    // ---------------------------------------------------------------- the style
    const flare = clamp01(1 - (t - this.flareAt) / 0.8);
    const S = M.style, sx = X(S.x), sy = Y(S.y), haloW = Math.max(2.5, 3.2 * u * (S.size / 28));
    // (digit by digit from sprites, in the display face: the number rolls every frame while a combo cashes in; on a
    // phone a long one steps down a size rather than run under the powers)
    const txt = fmt(this.styleShown);
    let size = S.size * u;
    const roomS = compact ? box.w - S.x * u - (POW.compact.ix[0] + POW.compact.size * 0.62 + 3) * u : Infinity;
    const want = measure(txt, size, STYLE_W, 0.01, DISPLAY);
    if (want > roomS) size = Math.max(size * 0.6, Math.floor(size * (roomS / want) * 2) / 2);
    const tw = stampDigits(g, txt, size, STYLE_W, 0.01, PALETTE.cream, 0.5, haloW, dpr, sx, sy, flip ? 'right' : 'left', 1, DISPLAY);
    if (flare > 0) {
      stamp(g, glow(GOLD, Math.min(size * 1.1, box.h * 0.5), dpr, 0.5), flip ? sx - tw / 2 : sx + tw / 2, sy - size * 0.33, 1, flare * 0.85);
      stampDigits(g, txt, size, STYLE_W, 0.01, lift(GOLD, 0.35), 0.5, haloW, dpr, sx, sy, flip ? 'right' : 'left', flare, DISPLAY);
    }
    this.styleEnd = flip ? sx - tw : sx + tw;
    if (S.label) stampLabel(g, label('STYLE', S.label * u, 800, 0.24, rgba(PALETTE.parchment, 0.62), 0, 0, dpr), flip ? sx - tw - 8 * u : sx + tw + 8 * u, sy - 1.5 * u, flip ? 'right' : 'left');

    // ---------------------------------------------------------------- the dash, at the inner end
    const D = M.dash.size, ready = this.dashShown >= 0.999;
    const dcx = flip ? box.x + M.dash.x * u : box.x + box.w - M.dash.x * u, dcy = Y(M.dash.cy);
    const flash = this.readyAt >= 0 ? clamp01(1 - (t - this.readyAt) / 0.4) : 0;
    if (ready) stamp(g, glow(lift(col, 0.3), D * u * 1.6, dpr, 0.45), dcx, dcy, 1, 0.55 + 0.6 * flash);
    chevrons(g, dcx, dcy - D * u * 0.12, D * u, flip, ready ? lift(col, 0.55 + 0.45 * flash) : rgba(PALETTE.parchment, 0.32), Math.max(1.3, 1.9 * u * (D / 13)));
    const bw = D * u * 1.5, by = dcy + D * u * 0.62, bh = Math.max(1, 1.6 * u * (D / 13));
    g.fillStyle = rgba(PALETTE.parchment, 0.14);
    g.fillRect(dcx - bw / 2, by, bw, bh);
    if (!ready && this.dashShown > 0) {
      g.fillStyle = rgba(lift(col, 0.3), 0.9);
      const fw = bw * this.dashShown;
      g.fillRect(flip ? dcx + bw / 2 - fw : dcx - bw / 2, by, fw, bh);
    }
  }

  // ---------------------------------------------------------------- the live layer: link, combo, the combo's end
  drawLive(g: Ctx, p: HudPlayer, st: HudState, L: Layout, dpr: number, out: Box[]) {
    const M = compact(L), box = L.panels[this.seat], row = L.combo[this.seat], u = L.u, flip = this.seat === 1, t = this.t;
    const col = p.color;
    const other = st.players.find((q) => q.seat !== p.seat);
    const ocol = other?.color ?? '#ffffff';
    const X = (x: number) => (flip ? box.x + box.w - x * u : box.x + x * u);
    const spb = 60 / Math.max(30, st.beat.bpm || 120), ph = ((st.beat.phase % 1) + 1) % 1;
    const beatK = Math.exp(-ph * spb * 6);
    drawPowers(g, p, box, L.compact, u, dpr, this.seat, t, out);
    if (p.you) youRim(g, p, box, M, u, flip, out);

    // ---- the link: a ring round the emblem in the partner's colour, turning, and the chip
    const h = this.holdShown;
    if (h > 0.01) {
      const ecx = X(M.em.cx), ecy = box.y + M.em.cy * u, R = M.em.ring * u, e = clamp01(st.link.energy);
      const spin = t * (1.2 + 2.2 * e) * (flip ? -1 : 1);
      stamp(g, glow(lift(ocol, 0.2), R * 1.5, dpr, 0.4), ecx, ecy, 1, h * (0.35 + 0.4 * e + 0.25 * beatK));
      g.lineCap = 'round';
      g.lineWidth = M.em.ringW * u * (1 + 0.5 * beatK);
      for (let k = 0; k < 2; k++) {
        const a = spin + k * Math.PI;
        g.strokeStyle = rgba(lift(k ? col : ocol, 0.35), h * (0.75 + 0.25 * e));
        g.beginPath(); g.arc(ecx, ecy, R, a, a + Math.PI * (0.55 + 0.35 * e)); g.stroke();
      }
      g.lineCap = 'butt';
      out.push({ x: ecx - R * 1.6, y: ecy - R * 1.6, w: R * 3.2, h: R * 3.2 });
      // the chip: HOLDING (the base) or HELD (the flyer), at the name row's inner end
      if (p.holding || p.held) this.holdWord = p.holding ? 'HOLDING' : 'HELD';
      const word = this.holdWord;
      const fs = M.chip.font * u, ch = M.chip.h * u, icon = ch * 0.78;
      const wl = label(word, fs, 700, 0.2, '#ffffff', 0, 0, dpr), tw = wl.w, cw = tw + icon + ch * 0.95;
      const room = this.chipRoom || box.w * 0.4;
      const showWord = cw <= room;
      const w = showWord ? cw : ch * 1.1;
      const x1 = flip ? box.x + M.chip.inset * u : box.x + box.w - M.chip.inset * u;
      const x0 = flip ? x1 : x1 - w, cy = box.y + M.chip.cy * u, y0 = cy - ch / 2;
      const pop = easeOutBack(h);
      g.save();
      g.globalAlpha = h;
      g.translate(x0 + w / 2, cy); g.scale(0.8 + 0.2 * pop, 0.8 + 0.2 * pop); g.translate(-(x0 + w / 2), -cy);
      roundRect(g, x0, y0, w, ch, ch / 2);
      const bg = g.createLinearGradient(x0, 0, x0 + w, 0);
      bg.addColorStop(0, rgba(flip ? ocol : col, 0.42)); bg.addColorStop(1, rgba(flip ? col : ocol, 0.42));
      g.fillStyle = 'rgba(28,20,9,0.62)'; g.fill();
      g.fillStyle = bg; g.fill();
      g.lineWidth = Math.max(1, 1.1 * u);
      g.strokeStyle = `rgba(255,255,255,${(0.3 + 0.35 * e + 0.3 * beatK).toFixed(3)})`; g.stroke();
      const ic = linkIcon(word === 'HOLDING' ? 'catch' : 'lift', icon, '#ffffff', false, dpr);
      stamp(g, ic, showWord ? x0 + ch * 0.45 + icon / 2 - ch * 0.1 : x0 + w / 2, cy);
      if (showWord) stampLabel(g, wl, x0 + ch * 0.4 + icon, cy + fs * 0.38);
      g.restore();
      g.letterSpacing = '0px';
      out.push({ x: x0 - 6 * u, y: y0 - 6 * u, w: w + 12 * u, h: ch + 12 * u });
    }

    // ---- the combo row under the panel
    const c = p.combo, C = M.combo, cy = row.y + row.h / 2;
    if (c.live && this.items.length) {
      const wide = this.drawRow(g, p, this.items, c.n, c.mult, c.perfect > 0, row, C, u, dpr, { tier: this.tier }, out);
      this.rowW = approach(this.rowW || wide, wide, 18, this.dt);
    } else this.rowW = 0;

    // ---- the combo's end
    const E = this.ended;
    if (E) {
      const k = (t - E.at) / (E.drop ? DROP : CASH);
      if (k >= 1 && (E.drop || t - this.plusAt > PLUS)) this.ended = null;
      else if (k < 1) {
        if (E.drop) {
          // dropped: the row sinks, greys and fades
          this.drawRow(g, p, E.items, E.n, E.mult, false, row, C, u, dpr, { a: 1 - k, dy: 16 * u * k * k, grey: true, tier: E.tier }, out);
        } else {
          // cashed: the glass goes, the icons gather into the count, and the count flies up into the style, shrinking
          const fly = easeOut(clamp01((k - 0.15) / 0.85));
          const dy = -(cy - (box.y + M.style.y * u - M.style.size * u * 0.35)) * fly;
          this.drawRow(g, p, E.items, E.n, E.mult, E.perfect > 0, row, C, u, dpr, {
            a: 1 - clamp01((k - 0.3) / 0.3), pill: 1 - clamp01(k / 0.25), gather: easeOut(k / 0.4), dy, fly,
            toX: (X(M.style.x) + this.styleEnd) / 2,
            text: (1 + 0.2 * Math.sin(Math.PI * clamp01(k / 0.3))) * (1 - 0.35 * fly), tier: E.tier,
          }, out);
        }
      }
    }
    // the "+n" rising from the style, gold
    const pa = t - this.plusAt;
    if (this.plus > 0 && pa < PLUS) {
      const fs = (L.compact ? 10 : 15) * u, a = clamp01(pa / 0.08) * (1 - clamp01((pa - 0.75) / 0.55));
      const x = this.styleEnd + (flip ? -1 : 1) * 10 * u, y = box.y + M.style.y * u - M.style.size * u * 0.42 - 16 * u * easeOut(pa / PLUS);
      stampLabel(g, label(`+${fmt(this.plus)}`, fs, 700, 0.04, GOLD_HI, 0.55, Math.max(2, 3 * u), dpr), x, y + fs * 0.36, flip ? 'right' : 'left', a);
      out.push({ x: Math.min(x, x + (flip ? -1 : 1) * fs * 5) - 4 * u, y: y - fs, w: fs * 5 + 8 * u, h: fs * 2 });
    } else if (pa >= PLUS) this.plus = 0;
  }

  /** the combo's row: count, multiplier, the tier's word (past ×4), icons (oldest outermost, newest toward the centre).
   *  `o.a` fades it all, `o.pill` the glass under it; `o.gather` 0 … 1 pulls the icons into the count (fading them);
   *  `o.dy` moves it; `o.text` scales the count; `o.grey` draws it dropped; `o.tier` the tier reached. Returns its width */
  private drawRow(g: Ctx, p: HudPlayer, items: Item[], n: number, mult: number, goldMult: boolean, row: Box, C: Metrics['combo'], u: number, dpr: number,
    o: { a?: number; pill?: number; gather?: number; dy?: number; text?: number; grey?: boolean; toX?: number; fly?: number; tier?: Tier | null }, out: Box[]): number {
    const a = o.a ?? 1, gather = o.gather ?? 0, dy = o.dy ?? 0, grey = !!o.grey, pill = (o.pill ?? 1) * a;
    if (a <= 0.01) return 0;
    const flip = this.seat === 1, t = this.t, col = grey ? '#8c879a' : lift(p.color, 0.45);
    const cy = row.y + row.h / 2 + dy;
    const at = (x: number) => (flip ? row.x + row.w - x : row.x + x);
    // the count and the multiplier
    const cs = C.count * u, ms = C.mult * u;
    const nl = label(String(n), cs, 700, 0, grey ? '#9a95a8' : '#ffffff', 0.5, Math.max(2, 2.6 * u), dpr), nw = nl.w;
    const ml = label(fmtMult(mult), ms, 650, 0.04, grey ? '#8c879a' : goldMult ? GOLD : INK, 0.5, Math.max(2, 2.4 * u), dpr), mw = ml.w;
    // past ×4 the tier's word, in its colour, in the multiplier's place (past the cap it is always ×4)
    const T = o.tier ?? null, tl = T ? label(T.name, ms, 800, 0.14, grey ? '#8c879a' : lift(T.color, 0.1), 0.6, Math.max(2, 2.4 * u), dpr) : null;
    const tw = tl ? tl.w : 0, mShow = tl ? 0 : mw;
    const textW = nw + 4 * u + mShow + tw;
    const icons = Math.min(items.length, Math.max(1, Math.floor((row.w - C.inset * u * 2 - textW - 10 * u) / ((C.icon + C.gap) * u))));
    const shown = items.slice(items.length - icons);
    const i0 = C.inset * u + textW + 10 * u, step = (C.icon + C.gap) * u;
    const width = i0 + icons * step - C.gap * u + C.inset * u * 0.8;
    const w = this.rowW && o.a == null ? this.rowW : width;
    // the glass under it
    if (pill > 0.01) {
      g.globalAlpha = pill;
      const ry = row.y + (grey ? dy : 0);
      roundRect(g, flip ? row.x + row.w - w : row.x, ry, w, row.h, row.h / 2);
      const rg = g.createLinearGradient(0, ry, 0, ry + row.h);
      rg.addColorStop(0, 'rgba(50,38,20,0.6)'); rg.addColorStop(1, 'rgba(18,13,7,0.55)');
      g.fillStyle = rg; g.fill();
      // (gold leading round it; the rim in the tier's colour once there is one, brighter as its word pops in)
      const tin = T && !grey ? clamp01(1 - (t - T.at) / 0.8) : 0;
      if (T && !grey) {
        g.lineWidth = Math.max(1, (1.4 + 1.6 * tin) * u);
        g.strokeStyle = rgba(T.color, 0.55 + 0.4 * tin);
        g.stroke();
      } else if (grey) { g.lineWidth = 1; g.strokeStyle = 'rgba(230,215,184,0.1)'; g.stroke(); }
      else leaded(g, ry, row.h, Math.max(0.8, 0.9 * u));
    }
    g.globalAlpha = a;
    // the icons
    const isz = C.icon * u, ax = at(C.inset * u + nw / 2);
    for (let i = 0; i < shown.length; i++) {
      const it = shown[i];
      let x = at(i0 + i * step + isz / 2);
      if (gather > 0) x = x + (ax - x) * gather;
      const age = t - it.at, pin = clamp01(age / POP_IN);
      const sc = (grey ? 1 : 0.35 + 0.65 * easeOutBack(pin)) * (1 - 0.5 * gather);
      // older icons a little quieter (the newest is what you're reading)
      const quiet = (0.6 + 0.4 * ((i + 1) / shown.length)) * (1 - gather);
      const gold = it.gold && !grey;
      stamp(g, linkIcon(it.kind, isz, col, gold, dpr), x, cy, sc, quiet * (gold ? 1 : 0.95));
      if (pin < 1 && !grey && !gather) {
        // a new link: a ring opening round it (gold on the beat)
        g.lineWidth = Math.max(1, 1.3 * u * (1 - pin));
        g.strokeStyle = gold ? rgba(GOLD, 0.95 * (1 - pin)) : `rgba(255,255,255,${(0.7 * (1 - pin)).toFixed(3)})`;
        g.beginPath(); g.arc(x, cy, isz * (0.45 + 0.5 * easeOut(pin)), 0, Math.PI * 2); g.stroke();
      }
    }
    // count and multiplier over them (the count pulses with each new link)
    const newest = items[items.length - 1], bump = newest && !grey && o.a == null ? clamp01(1 - (t - newest.at) / POP_IN) : 0;
    const base = cy + cs * 0.36, k = (o.text ?? 1) * (1 + 0.22 * bump);
    g.save();
    // (flying into the style, the count also slides across to under its number)
    g.translate(o.toX != null ? (o.toX - ax) * (o.fly ?? 0) : 0, 0);
    g.translate(ax, cy); g.scale(k, k); g.translate(-ax, -cy);
    stampLabel(g, nl, at(C.inset * u), base, flip ? 'right' : 'left');
    if (!tl) stampLabel(g, ml, at(C.inset * u + nw + 4 * u), base - 0.5 * u, flip ? 'right' : 'left');
    g.restore();
    if (tl && T) {
      // the tier's word pops in (from small, settling) after the count, and goes with it into the style
      const pin = grey || o.a != null ? 1 : clamp01((t - T.at) / POP_IN), sc = (0.4 + 0.6 * easeOutBack(pin)) * (o.text ?? 1);
      const tx = at(C.inset * u + nw + 4 * u);
      g.save();
      g.translate(o.toX != null ? (o.toX - ax) * (o.fly ?? 0) : 0, 0);
      g.translate(tx, cy); g.scale(sc, sc); g.translate(-tx, -cy);
      stampLabel(g, tl, tx, base - 0.5 * u, flip ? 'right' : 'left', 1 - 0.5 * gather);
      g.restore();
    }
    g.letterSpacing = '0px';
    g.globalAlpha = 1;
    const bw = o.fly ? Math.max(width, row.w) : width, bx = flip ? row.x + row.w - bw - 10 * u : row.x - 10 * u;
    out.push({ x: bx, y: Math.min(row.y, row.y + dy) - 14 * u, w: bw + 20 * u, h: row.h + Math.abs(dy) + 28 * u });
    return width;
  }
}

const compact = (L: Layout) => (L.compact ? COMPACT : DESKTOP);

/** the labels a battle will surely want (the style's digits, white and gold; the combo's first counts and multipliers;
 *  the chip's words; the clock's times), to make ahead one a frame (Hud's warm-up) */
export function warmPanel(L: Layout, dpr: number): (() => void)[] {
  const M = compact(L), u = L.u, out: (() => void)[] = [];
  const S = M.style, size = S.size * u, haloW = Math.max(2.5, 3.2 * u * (S.size / 28));
  for (const ch of '0123456789,') {
    out.push(() => { label(ch, size, STYLE_W, 0.01, PALETTE.cream, 0.5, haloW, dpr, DISPLAY); });
    out.push(() => { label(ch, size, STYLE_W, 0.01, lift(GOLD, 0.35), 0.5, haloW, dpr, DISPLAY); });
  }
  const C = M.combo, cs = C.count * u, ms = C.mult * u;
  for (let n = 1; n <= 12; n++) out.push(() => { label(String(n), cs, 700, 0, '#ffffff', 0.5, Math.max(2, 2.6 * u), dpr); });
  for (let m = 1; m <= 4; m += 0.5) for (const c of [GOLD, INK]) out.push(() => { label(fmtMult(m), ms, 650, 0.04, c, 0.5, Math.max(2, 2.4 * u), dpr); });
  for (const w of ['HOLDING', 'HELD']) out.push(() => { label(w, M.chip.font * u, 700, 0.2, '#ffffff', 0, 0, dpr); });
  if (S.label) out.push(() => { label('STYLE', S.label * u, 800, 0.24, rgba(PALETTE.parchment, 0.62), 0, 0, dpr); });
  return out;
}

/** the dash: two chevrons pointing the way the panel faces (inward) */
function chevrons(g: Ctx, cx: number, cy: number, s: number, flip: boolean, col: string, lw: number) {
  const d = flip ? -1 : 1;
  g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = col;
  g.beginPath();
  for (const o of [-0.38, 0.12]) {
    const x = cx + d * o * s;
    g.moveTo(x - d * s * 0.22, cy - s * 0.38); g.lineTo(x + d * s * 0.2, cy); g.lineTo(x - d * s * 0.22, cy + s * 0.38);
  }
  g.stroke();
  g.lineCap = 'butt';
}

// ---------------------------------------------------------------- the powers (the duel's phase 2): flow and two icons
/** where the powers sit in a panel: the two icons at the inner end, left of the dash (their middles, from the inner
 *  edge, and their size), the keys under them, the flow bar along the panel's foot (from x0 to the inner edge less x1) */
const POW = {
  desk: { ix: [92, 62], cy: 43, size: 20, key: 11.5, bar: { x0: 82, x1: 32, y: 77, h: 3.4 } },
  compact: { ix: [34, 19], cy: 27.5, size: 11, key: 0, bar: { x0: 39, x1: 15, y: 37.2, h: 2 } },
};
const pdot = (g: Ctx, x: number, y: number, r: number) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); };
/** each power's glyph in a 24-unit box centred on 0, y down: strokes, and what is filled */
const POWER_GLYPH: Record<string, { line: (g: Ctx) => void; fill?: (g: Ctx) => void }> = {
  // a bloom opening under a rising body
  flare: { line: (g) => { g.moveTo(-9, 9); g.quadraticCurveTo(-4, 3, 0, 8); g.quadraticCurveTo(4, 3, 9, 9); g.moveTo(0, 5); g.lineTo(0, -6); g.moveTo(-4, -2); g.lineTo(0, -7); g.lineTo(4, -2); }, fill: (g) => pdot(g, 0, -9.5, 2.2) },
  // a ribbon swaying up
  ribbon: { line: (g) => { g.moveTo(-10, 8); g.bezierCurveTo(-4, 8, -6, -1, 0, -1); g.bezierCurveTo(6, -1, 4, -9, 10, -9); g.moveTo(-5, 3); g.lineTo(-5, -4); g.moveTo(3, -4); g.lineTo(3, -10); } },
  // a lash out to a hand
  whip: { line: (g) => { g.moveTo(-10, 7); g.bezierCurveTo(-4, -6, 2, 8, 9, -6); }, fill: (g) => { pdot(g, -10, 7, 2.2); pdot(g, 9.3, -6.5, 2.6); } },
  // a crest curling over
  wave: { line: (g) => { g.moveTo(-11, 8); g.bezierCurveTo(-6, 8, -4, -8, 3, -8); g.bezierCurveTo(8, -8, 9, -2, 5, -1); g.moveTo(-11, 11); g.lineTo(11, 11); } },
  // a block in the air, a body over it
  step: { line: (g) => { g.rect(-8, 1, 16, 6); g.moveTo(-5, 10); g.lineTo(-5, 7); g.moveTo(1, 11); g.lineTo(1, 7); g.moveTo(6, 9); g.lineTo(6, 7); }, fill: (g) => pdot(g, 0, -5, 3) },
  // a path, fast along it
  slide: { line: (g) => { g.moveTo(-11, 9); g.lineTo(11, 3); g.moveTo(-6, 0); g.lineTo(4, -3); g.moveTo(-2, -6); g.lineTo(6, -8); } },
  // a jump through space: here, then there
  blink: { line: (g) => { g.arc(-6, 0, 4, 0, Math.PI * 2); g.moveTo(0, 0); g.lineTo(2, 0); g.moveTo(4, 0); g.lineTo(5, 0); }, fill: (g) => pdot(g, 8.5, 0, 3.4) },
  // lightning between two
  arc: { line: (g) => { g.moveTo(-8, 6); g.lineTo(-2, -2); g.lineTo(1, 3); g.lineTo(8, -6); }, fill: (g) => { pdot(g, -9.5, 8, 2.4); pdot(g, 9.5, -8, 2.4); } },
  // a column rising, a body launched off it
  pillar: { line: (g) => { g.moveTo(-4, 11); g.lineTo(-4, -1); g.lineTo(0, -4); g.lineTo(4, -1); g.lineTo(4, 11); g.moveTo(-3, -7); g.lineTo(0, -10); g.lineTo(3, -7); } },
  // a facet turning a flight
  prism: { line: (g) => { g.moveTo(0, -8); g.lineTo(7, 0); g.lineTo(0, 8); g.lineTo(-7, 0); g.closePath(); g.moveTo(-12, -6); g.lineTo(-3, -1); g.moveTo(3, 1); g.lineTo(11, -7); } },
};
/** a power's icon, ready (its colour, a glow) or not (grey) */
function powerIcon(id: string, size: number, col: string, ready: boolean, dpr: number) {
  const s = size, pad = s * 0.35;
  return sprite(`pow:${id}:${s.toFixed(1)}:${col}:${ready}`, dpr, s + pad * 2, s + pad * 2, s / 2 + pad, s / 2 + pad, (g) => {
    const G = POWER_GLYPH[id] ?? POWER_GLYPH.flare;
    g.translate(s / 2 + pad, s / 2 + pad); g.scale(s / 24, s / 24);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, c] of [[4.6, 'rgba(14,10,4,0.6)'], [2.1, ready ? lift(col, 0.35) : rgba(PALETTE.parchment, 0.45)]] as const) {
      g.beginPath(); G.line(g); g.lineWidth = w; g.strokeStyle = c; g.stroke();
      if (G.fill) { g.beginPath(); G.fill(g); g.fillStyle = c; g.fill(); }
    }
  });
}

/** the flow bar and the two powers, over the panel's glass (the live layer: every frame) */
export function drawPowers(g: Ctx, p: HudPlayer, box: Box, compactL: boolean, u: number, dpr: number, seat: 0 | 1, t: number, out: Box[]) {
  if (p.flow == null || !p.powers) return;
  const P = compactL ? POW.compact : POW.desk, flip = seat === 1, col = p.color;
  const inner = (x: number) => (flip ? box.x + x * u : box.x + box.w - x * u);
  const outer = (x: number) => (flip ? box.x + box.w - x * u : box.x + x * u);
  const form = p.form ?? 0, inForm = form > 0, full = !inForm && p.flow >= 0.999;
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  // ---- the flow bar: a track along the foot, the flow in the matter's colour, marks where each power's cost falls;
  // full, it glows gold; in the form it runs down, gold and white
  const B = P.bar, bx0 = outer(B.x0), bx1 = inner(B.x1), x0 = Math.min(bx0, bx1), w = Math.abs(bx1 - bx0), y = box.y + B.y * u, h = Math.max(1.5, B.h * u);
  // (the track: a slim channel of dark glass in gold leading, like a stem the flow climbs)
  roundRect(g, x0, y - h / 2, w, h, h / 2);
  g.fillStyle = 'rgba(14,10,4,0.5)'; g.fill();
  if (!compactL) leaded(g, y - h, h * 2, Math.max(0.7, 0.75 * u), 0.7);
  const f = clamp01(p.flow), fw = w * f;
  if (fw > 0.5) {
    const fx = flip ? x0 + w - fw : x0;
    const gr = g.createLinearGradient(flip ? x0 + w : x0, 0, flip ? x0 : x0 + w, 0);
    gr.addColorStop(0, rgba(col, 0.75)); gr.addColorStop(1, inForm || full ? GOLD_HI : lift(col, 0.45));
    roundRect(g, fx, y - h / 2, fw, h, h / 2);
    g.fillStyle = gr; g.fill();
    // its leading edge, bright
    stamp(g, glow(inForm || full ? GOLD : lift(col, 0.3), h * 3.2, dpr, 0.55), flip ? fx : fx + fw, y, 1, inForm || full ? 0.6 + 0.4 * pulse : 0.45);
  }
  if (full || inForm) {
    // (full: a soft gold light along the stem, flattened to it; drawn inside the box the live layer clears, or it would
    // be left behind frame after frame)
    const R = Math.min(w, 120 * u) * 0.5;
    g.save(); g.translate(x0 + w / 2, y); g.scale(1, 0.22);
    stamp(g, glow(GOLD, R, dpr, 0.22), 0, 0, 1, (full ? 0.4 + 0.35 * pulse : 0.35) * (compactL ? 0.6 : 1));
    g.restore();
  }
  const cost = p.powers[0]?.cost || 0.25;
  // (where each power's cost falls: a small leaf on the stem, gold once the flow has reached it)
  if (!inForm) {
    g.beginPath();
    const reached: number[] = [];
    for (let c = cost; c < 0.999; c += cost) {
      const mx = flip ? x0 + w - w * c : x0 + w * c, L = (compactL ? 3.2 : 5) * u;
      if (f >= c) reached.push(mx);
      else leaf(g, mx, y - h * 0.3, L, L * 0.55, -Math.PI / 2 + (flip ? -0.5 : 0.5));
    }
    g.fillStyle = rgba(PALETTE.parchment, 0.35); g.fill();
    if (reached.length) {
      g.beginPath();
      for (const mx of reached) { const L = (compactL ? 3.2 : 5) * u; leaf(g, mx, y - h * 0.3, L, L * 0.55, -Math.PI / 2 + (flip ? -0.5 : 0.5)); }
      g.fillStyle = PALETTE.leaf; g.fill();
    }
  }
  out.push({ x: x0 - 10 * u, y: y - 14 * u, w: w + 20 * u, h: 28 * u });
  // ---- the two powers, each a cabochon in a gold setting: ready in the matter's colour (in the form, ringed gold:
  // free), else dim with the flow's way toward their cost round them; the key under each on a cream keycap
  p.powers.forEach((q, i) => {
    const cx = inner(P.ix[i]), cy = box.y + P.cy * u, s = P.size * u, R = s * 0.62;
    if (q.ready) stamp(g, glow(inForm ? GOLD : lift(col, 0.25), R * 1.7, dpr, 0.4), cx, cy, 1, inForm ? 0.6 + 0.3 * pulse : 0.5);
    stamp(g, cabochon(R, compactL, dpr), cx, cy);
    stamp(g, powerIcon(q.id, s, col, q.ready, dpr), cx, cy);
    g.lineCap = 'round';
    g.lineWidth = Math.max(1, 1.5 * u * (compactL ? 0.7 : 1));
    if (inForm) { g.strokeStyle = rgba(GOLD, 0.9); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke(); }
    else if (q.ready) { g.strokeStyle = rgba(lift(col, 0.4), 0.8); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke(); }
    else {
      const k = clamp01(q.cost > 0 ? f / q.cost : 1);
      if (k > 0.01) { g.strokeStyle = rgba(lift(col, 0.3), 0.8); g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); g.stroke(); }
    }
    g.lineCap = 'butt';
    if (q.key && P.key) {
      const cap = keyCap(q.key, P.key * u, q.ready, dpr);
      stamp(g, cap, cx, cy + R + P.key * u * 0.85);
    }
    out.push({ x: cx - R * 2, y: cy - R * 2, w: R * 4, h: R * 4 + P.key * u * 2.2 });
  });
}

/** a power's setting: a disc of dark honey glass in a ring of gold leading (a sprite per size) */
function cabochon(R: number, small: boolean, dpr: number) {
  const pad = 3;
  return sprite(`cab:${R.toFixed(2)}:${small}`, dpr, R * 2 + pad * 2, R * 2 + pad * 2, R + pad, R + pad, (g) => {
    const c = R + pad;
    const well = g.createRadialGradient(c, c - R * 0.4, 0, c, c, R);
    well.addColorStop(0, 'rgba(60,45,22,0.9)'); well.addColorStop(1, 'rgba(16,11,5,0.88)');
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2);
    g.fillStyle = well; g.fill();
    leaded(g, c - R, R * 2, small ? 0.8 : 1.1);
  });
}

/** a key's letter on a small cream keycap (ready) or a dim one, dark ink on it: the panel's keys read at 720p */
function keyCap(text: string, size: number, ready: boolean, dpr: number) {
  const tw = measure(text, size, 800, 0.02), h = size * 1.42, w = Math.max(h, tw + size * 0.95), pad = 2;
  return sprite(`key:${text}:${size.toFixed(2)}:${ready}`, dpr, w + pad * 2, h + pad * 2, w / 2 + pad, h / 2 + pad, (g) => {
    roundRect(g, pad, pad, w, h, h * 0.36);
    g.fillStyle = ready ? rgba(PALETTE.cream, 0.95) : 'rgba(30,22,10,0.7)';
    g.fill();
    g.lineWidth = 1; g.strokeStyle = ready ? rgba(PALETTE.honey, 0.9) : rgba(PALETTE.parchment, 0.55); g.stroke();
    g.font = `800 ${size.toFixed(2)}px ${FONT}`;
    g.letterSpacing = `${(size * 0.02).toFixed(2)}px`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = ready ? '#2b1e0b' : rgba(PALETTE.parchment, 0.9);
    g.fillText(text, pad + w / 2, pad + h / 2 + size * 0.06);
  });
}

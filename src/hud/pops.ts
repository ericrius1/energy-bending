// Words that pop for a named move, and the small tag over each player's head so a body is never lost in its own
// matter. The words keep off the bodies and off each other (phase 2's fix 5): each dancer has a lane beside its body,
// on the side away from the other (kept while the two are close, so a swing turning them round each other leaves the
// lanes where they are), the newest word at the lane's foot about the shoulders and the older above it, at most
// LANE_MAX at once (the oldest goes as another comes); the words that are nobody's (MERGE) stand above the pair. A
// pop with the same `id` as one on screen is that one, updated in place (SWING ×2, ×3: a bump, not a new word), and
// the same word coming again while it shows in its lane counts up on it (the older stream, one SWING a swing). The
// finale and the banner are the centre's (centre.ts): every word goes as the finale starts, and none is drawn over
// the centre's word. Each kind moves its own way, a little, in its lane:
//   CATCH      snaps in: from large and faint to its size in a tenth of a second, a ring closing on it like a hand
//   SWING      hangs from a point above it and swings, a pendulum dying away
//   FLING ×n   leans off along the flight (the game's `dir`, else the faster body's motion on screen), a ghost trailing
//   PERFECT    gold, springs in with a ring of light opening
//   COMBO ×n   punches in, bigger the longer the combo, a shiver
//   MERGE      two halves in the two dancers' colours slide together and become one word with a flash
//   DUET ×n    a pair tier (the two's chain): as MERGE, bigger, glowing in the tier's colour
//   info       a plain note
// Each word is a sprite made once per text, kind and colour (its glow and halo baked in) and stamped with its motion.
// A tag is a sprite too; off the screen's edge it is held at the edge and points to where its player is.
import type { HudState, HudPop, HudPlayer, PopKind } from './state';
import type { Layout, Box } from './layout';
import { LINK_KINDS } from './state';
import { linkIcon } from './icons';
import { FONT, GOLD, GOLD_HI, INK, glow, lift, measure, rgba, sprite, stamp, clamp01, easeOutBack, easeOut, type Ctx } from './style';

const LIFE: Record<PopKind, number> = { catch: 0.95, swing: 1.05, fling: 1.0, perfect: 1.0, combo: 1.2, merge: 1.4, info: 1.6, power: 1.0, react: 1.4, pair: 1.6 };
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
    // (the pair's tier: the two's word, bigger, across both their colours with the tier's in the middle)
    case 'pair': {
      const [a, b] = [st.players.find((q) => q.seat === 0)?.color ?? '#ff7a4a', st.players.find((q) => q.seat === 1)?.color ?? '#4ab0ff'];
      const tc = st.pair?.tierColor ?? '#ffffff';
      return { size: 24, weight: '800', top: '#ffffff', bottom: '#ffffff', glow: tc, track: 0.2, across: [lift(a, 0.35), lift(b, 0.35)] };
    }
    // (the powers: a cast in the caster's colour, light; a reaction white over cyan, bigger)
    case 'power': return { size: 15, weight: '700', top: '#ffffff', bottom: lift(col, 0.55), glow: col, track: 0.18 };
    case 'react': return { size: 21, weight: '800', top: '#ffffff', bottom: '#9fe8ff', glow: '#bff4ff', track: 0.14 };
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

/** a word on screen, fed by the state's pops: one per `id` (updated in place as its text changes), or several of the
 *  same word in a row merged into one that counts up */
interface Entry {
  /** the state's pops it has taken (their ids, or for a pop without one its text and birth) */
  ids: Set<string>;
  /** the lane: a seat, or -1 for the words that are nobody's (MERGE) */
  lane: number;
  kind: PopKind;
  seat?: number;
  /** what it says, what its feed says (a repeat of exactly that counts it up), and the count */
  text: string;
  src: string;
  count: number;
  age: number;
  /** the HUD's clock when it came, last changed (a bump), and was let go (or -1) */
  born: number;
  bump: number;
  gone: number;
  seen: boolean;
  order: number;
  /** where it is drawn: its slot's height, eased (px), and its side's x kept while it fades */
  y: number | null;
  x: number | null;
  at: [number, number];
  dir?: [number, number];
}

/** pops a lane shows at once (the oldest goes as another comes) */
export const LANE_MAX = 3;
/** how long a word let go takes to fade (s) */
const GONE = 0.16;
type Pop2 = HudPop & { id?: number; dir?: [number, number] };
const keyOf = (p: Pop2, lane: number, born: number) => (p.id != null ? `#${p.id}` : `${lane}|${p.text}|${born.toFixed(2)}`);
/** a pop without an id is the same pop on a later frame when its text and lane match and it was born within a frame */
const sameNoId = (ids: Set<string>, p: Pop2, lane: number, born: number) => {
  if (p.id != null) return false;
  for (const k of ids) {
    if (k[0] === '#') continue;
    const i = k.lastIndexOf('|'), head = k.slice(0, i);
    if (head === `${lane}|${p.text}` && Math.abs(Number(k.slice(i + 1)) - born) < 0.05) return true;
  }
  return false;
};

export class Pops {
  private t = 0;
  /** each seat's head on screen last frame, and its smoothed velocity (px/s) */
  private prev: ([number, number] | null)[] = [null, null];
  private vel: [number, number][] = [[0, 0], [0, 0]];
  private entries: Entry[] = [];
  private order = 0;
  /** each seat's lane side (-1 left of its body, +1 right), kept while the two are close (a swing turns them round
   *  each other: the lanes stay put) */
  private side = [-1, 1];
  private phase = '';
  /** drawn last frame: in all, per seat, nobody's; and the most since `most` was reset */
  shown = { total: 0, seats: [0, 0], centre: 0 };
  most = { total: 0, seats: [0, 0], centre: 0 };
  /** the words drawn last frame (alpha over 0.3), each its own box (px): what the moments probe tests the bodies
   *  against */
  cover: Box[] = [];

  private dt = 1 / 60;

  /** the words standing now (not fading out), by lane: what they say (for the tests and bend.hud) */
  get words(): { text: string; lane: number }[] {
    return this.entries.filter((e) => e.gone < 0).sort((a, b) => a.order - b.order).map((e) => ({ text: e.text, lane: e.lane }));
  }

  update(st: HudState, L: Layout, dt: number) {
    this.t += dt; this.dt = dt;
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
    // the finale and the banner are the centre's: every pop goes as the finale starts, none comes till the next set
    const ph = st.set.phase, quiet = ph === 'finale' || ph === 'done';
    if (quiet && this.phase !== ph) for (const e of this.entries) if (e.gone < 0) e.gone = this.t;
    this.phase = ph;
    for (const e of this.entries) e.seen = false;
    if (!quiet) {
      const live = (st.pops as Pop2[]).filter((p) => p.age >= 0 && p.age < popLife(p.kind)).sort((a, b) => b.age - a.age);
      for (const p of live) {
        // (BEND, FINALE and the like are the centre's words: nobody's plain notes are not drawn as pops)
        if (p.seat == null && p.kind === 'info') continue;
        const lane = p.seat === 0 || p.seat === 1 ? p.seat : -1, born = this.t - p.age, key = keyOf(p, lane, born);
        // the same pop as last frame: updated in place (a new text is a bump, not a new word); one already let go (a
        // lane's oldest, pushed out) stays gone while its feed lasts, or it would come back as a new word every frame
        let e = this.entries.find((q) => q.ids.has(key) || sameNoId(q.ids, p, lane, born));
        if (e && e.gone >= 0) { e.seen = true; continue; }
        if (e) {
          if (p.text !== e.src) { e.src = p.text; e.text = p.text; e.count = 1; e.bump = this.t; }
          e.age = e.seen ? Math.min(e.age, p.age) : p.age; e.seen = true; e.at = p.at;
          if (p.dir) e.dir = p.dir;
          continue;
        }
        // the same word again while it shows in its lane: counted up on it (SWING, SWING ×2, SWING ×3)
        e = this.entries.find((q) => q.gone < 0 && q.lane === lane && q.kind === p.kind && q.src === p.text);
        if (e) {
          e.ids.add(key); e.count++; e.text = `${p.text} ×${e.count}`; e.bump = this.t;
          e.age = p.age; e.seen = true; e.at = p.at;
          continue;
        }
        // a new word: the lane's oldest goes if it would hold more than LANE_MAX
        const inLane = this.entries.filter((q) => q.lane === lane && q.gone < 0).sort((a, b) => a.order - b.order);
        while (inLane.length >= LANE_MAX) inLane.shift()!.gone = this.t;
        this.entries.push({
          ids: new Set([key]), lane, kind: p.kind, seat: p.seat, text: p.text, src: p.text, count: 1, age: p.age, born,
          bump: -1, gone: -1, seen: true, order: ++this.order, y: null, x: null, at: p.at, ...(p.dir ? { dir: p.dir } : {}),
        });
      }
    }
    // a word whose feed is gone fades out; one faded is dropped once its feed is gone too, one past its life at once
    for (const e of this.entries) {
      if (e.gone < 0 && !e.seen) e.gone = this.t;
      if (e.gone >= 0 || !e.seen) e.age += dt;
    }
    this.entries = this.entries.filter((e) => (e.gone < 0 || this.t - e.gone < GONE || e.seen) && e.age < popLife(e.kind) + GONE);
  }

  /** the way a fling pop flies: the game's (pops[].dir), else the faster body's motion on screen, else out of its lane */
  private dirOf(e: Entry, side: number, u: number): [number, number] {
    if (e.dir) return e.dir;
    let best: [number, number] | null = null, bs = 220 * u;
    for (const v of this.vel) { const s = Math.hypot(v[0], v[1]); if (s > bs) { bs = s; best = [v[0] / s, v[1] / s]; } }
    best ??= [side * 0.75, -0.66];
    e.dir = best;
    return best;
  }

  /** draw the pops, each lane beside its dancer (off the bodies), nobody's above the pair, none over another or in
   *  `avoid` (the centre's word) */
  draw(g: Ctx, st: HudState, L: Layout, dpr: number, out: Box[], avoid: Box | null = null) {
    const u = L.u * (L.compact ? 0.82 : 1);
    this.shown = { total: 0, seats: [0, 0], centre: 0 };
    this.cover = [];
    if (!this.entries.length) return;
    // the lanes' anchors: beside each head, on the side away from the other (kept while the two are close), and the
    // middle lane above them both
    const head: ([number, number] | null)[] = [0, 1].map((s) => {
      const p = st.players.find((q) => q.seat === s)?.screen;
      return p ? [Math.max(-0.1, Math.min(1.1, p[0])) * L.W, Math.max(-0.1, Math.min(1.1, p[1])) * L.H] : null;
    });
    const near = 170 * u, gap = 54 * u, row = 27 * u;
    const both = head[0] && head[1];
    if (both) {
      const dx = head[0]![0] - head[1]![0];
      if (Math.abs(dx) > near * 0.75) { this.side[0] = Math.sign(dx); this.side[1] = -this.side[0]; }
      else if (this.side[0] === this.side[1]) { this.side[0] = dx >= 0 ? 1 : -1; this.side[1] = -this.side[0]; }
    }
    const close = !!both && Math.abs(head[0]![0] - head[1]![0]) < near;
    const yMin = L.top + 8 * u, yMax = L.H - L.margin - 14 * u;
    const lanes: { x: number; y: number; side: number; up: number }[] = [0, 1].map((s) => {
      const h = head[s] ?? head[1 - s] ?? [L.W / 2, L.H * 0.45];
      let side = this.side[s];
      const xs = close ? [head[0]![0], head[1]![0]] : [h[0]];
      let edge = side < 0 ? Math.min(...xs) - gap : Math.max(...xs) + gap;
      // (no room on its side of the screen: the other side)
      if ((side < 0 && edge < L.margin + 90 * u) || (side > 0 && edge > L.W - L.margin - 90 * u)) {
        side = -side; edge = side < 0 ? Math.min(...xs) - gap : Math.max(...xs) + gap;
      }
      const y = Math.max(yMin + row * (LANE_MAX - 1), Math.min(yMax, (close ? Math.max(head[0]![1], head[1]![1]) : h[1]) + 30 * u));
      return { x: edge, y, side, up: 0 };
    });
    // (both lanes on one side: the second stands over the first)
    if (lanes[0].side === lanes[1].side && Math.abs(lanes[0].x - lanes[1].x) < 160 * u) lanes[1].up = row * LANE_MAX;
    const hs = head.filter((h): h is [number, number] => !!h);
    const mid = {
      x: hs.length ? hs.reduce((a, h) => a + h[0], 0) / hs.length : L.W / 2,
      y: Math.max(yMin + row * (LANE_MAX - 1), Math.min(yMax, (hs.length ? Math.min(...hs.map((h) => h[1])) : L.H * 0.4) - 46 * u)),
    };
    const placed: Box[] = [];
    if (avoid) placed.push(avoid);
    const ease = 1 - Math.exp(-30 * Math.max(0, this.dt));
    for (const lane of [0, 1, -1]) {
      const list = this.entries.filter((e) => e.lane === lane).sort((a, b) => b.order - a.order);
      let slot = 0;
      for (const e of list) {
        const look = lookOf({ text: e.text, kind: e.kind, seat: e.seat, at: e.at, age: e.age }, st), spr = word(e.text, look, u, dpr);
        const fs = look.size * u, tw = measure(e.text, fs, look.weight, look.track), h = fs * 1.35;
        // (a word going fades where it is)
        if (e.gone >= 0 && this.t - e.gone >= GONE) continue;
        if (e.gone >= 0 && e.x != null && e.y != null) { this.one(g, e, spr, e.x, e.y, u, dpr, lane < 0 ? 1 : lanes[lane].side, st, out); continue; }
        // the slot: the newest at the lane's foot, the older above it
        const s = slot++;
        let x: number, y: number;
        if (lane < 0) { x = mid.x; y = mid.y - s * row; }
        else { const Ln = lanes[lane]; x = Ln.x + Ln.side * tw / 2; y = Ln.y - Ln.up - s * row; }
        x = Math.max(L.margin + tw / 2, Math.min(L.W - L.margin - tw / 2, x));
        y = Math.max(yMin, Math.min(yMax, y));
        // (off the words already placed and the centre's: moved up past them, or down when there is no room above)
        for (let i = 0; i < 6; i++) {
          const hit = placed.find((b) => Math.abs(b.x + b.w / 2 - x) < b.w / 2 + tw / 2 + 6 * u && Math.abs(b.y + b.h / 2 - y) < b.h / 2 + h / 2);
          if (!hit) break;
          const upY = hit.y - h / 2 - 2 * u, downY = hit.y + hit.h + h / 2 + 2 * u;
          y = upY >= yMin ? upY : downY;
        }
        // eased into its slot (a new word starts there; an older one slides up as another comes under it)
        if (e.y == null || e.x == null) { e.y = y; e.x = x; }
        else { e.y += (y - e.y) * ease; e.x += (x - e.x) * ease; }
        placed.push({ x: x - tw / 2, y: y - h / 2, w: tw, h });
        const a = this.one(g, e, spr, e.x, e.y, u, dpr, lane < 0 ? 1 : lanes[lane].side, st, out);
        if (a > 0.3) { this.shown.total++; if (lane >= 0) this.shown.seats[lane]++; else this.shown.centre++; this.cover.push({ x: e.x - tw / 2, y: e.y - h / 2, w: tw, h }); }
      }
    }
    const M = this.most, S = this.shown;
    M.total = Math.max(M.total, S.total); M.centre = Math.max(M.centre, S.centre);
    M.seats = [Math.max(M.seats[0], S.seats[0]), Math.max(M.seats[1], S.seats[1])];
  }

  /** one word at its place, moving its kind's way (small: it stays in its lane); returns its alpha */
  private one(g: Ctx, e: Entry, spr: ReturnType<typeof word>, x0: number, y0: number, u: number, dpr: number, side: number, st: HudState, out: Box[]) {
    // (the entrance runs on the word's own time since it came: a pop updated in place keeps its age low, and must not
    // pop in again; the fade runs on its feed's age)
    const life = popLife(e.kind), age = Math.max(0, this.t - e.born), k = Math.min(1, e.age / life);
    const fadeLife = 1 - clamp01((k - 0.72) / 0.28), fadeGone = e.gone >= 0 ? 1 - clamp01((this.t - e.gone) / GONE) : 1;
    let x = x0, y = y0, sc = 1, a = clamp01(age / 0.05) * fadeLife * fadeGone, rot = 0, sx = 1;
    const col = st.players.find((q) => q.seat === e.seat)?.color ?? '#ffffff';
    switch (e.kind) {
      case 'catch': {
        // snaps in, a ring closing on it
        const s = clamp01(age / 0.11);
        sc = s < 1 ? 1.6 - 0.68 * easeOut(s) : 0.92 + 0.08 * easeOut(clamp01((age - 0.11) / 0.12));
        a = clamp01(age / 0.07) * fadeLife * fadeGone;
        const r = clamp01(age / 0.16);
        if (r < 1) {
          g.lineWidth = Math.max(1, 2.2 * u * (1 - r));
          g.strokeStyle = rgba(lift(col, 0.5), 0.8 * (1 - r) * fadeGone);
          g.beginPath(); g.arc(x, y, spr.h * (0.8 - 0.45 * easeOut(r)), 0, Math.PI * 2); g.stroke();
        }
        break;
      }
      case 'swing': {
        // hangs from a point above it and swings a little, dying away
        const d = 16 * u, th = 0.4 * Math.exp(-2.6 * age) * Math.cos(age * 8.5);
        x = x0 + Math.sin(th) * d; y = y0 - d + Math.cos(th) * d;
        rot = -th * 0.6;
        sc = 0.75 + 0.25 * easeOutBack(clamp01(age / 0.18));
        break;
      }
      case 'fling': {
        // off along the flight, a little way, stretched, a ghost trailing
        const [dx, dy] = this.dirOf(e, side, u);
        const D = 34 * u, go = D * easeOut(k * 1.6);
        x = x0 + dx * go; y = y0 + dy * go * 0.6;
        sc = 0.85 + 0.15 * easeOutBack(clamp01(age / 0.12));
        sx = 1 + 0.22 * (1 - clamp01(age / 0.35));
        rot = Math.max(-0.25, Math.min(0.25, Math.atan2(dy, Math.abs(dx)) * Math.sign(dx || 1) * 0.3));
        drawWord(g, spr, x0 + dx * go * 0.55, y0 + dy * go * 0.33, sc * sx, sc, rot, a * 0.22);
        break;
      }
      case 'perfect': {
        sc = 0.65 + 0.35 * easeOutBack(clamp01(age / 0.16));
        const r = clamp01(age / 0.4);
        if (r < 1) {
          g.lineWidth = Math.max(1, 1.4 * u * (1 - r));
          g.strokeStyle = rgba(GOLD_HI, 0.7 * (1 - r) * fadeGone);
          g.beginPath(); g.ellipse(x, y, spr.w * 0.16 + 22 * u * easeOut(r), spr.h * 0.18 + 7 * u * easeOut(r), 0, 0, Math.PI * 2); g.stroke();
        }
        break;
      }
      case 'combo': {
        const s = clamp01(age / 0.14);
        sc = s < 1 ? 1.45 - 0.5 * easeOut(s) : 0.95 + 0.05 * easeOutBack(clamp01((age - 0.14) / 0.2));
        x += Math.sin(age * 70) * Math.exp(-age * 9) * 2 * u;
        break;
      }
      case 'merge': case 'pair': {
        // two halves sliding together, then one with a flash
        const c = clamp01(age / 0.32), off = 30 * u * (1 - easeOut(c));
        if (c < 1) {
          drawWord(g, spr, x - off, y, 1, 1, 0, a * 0.55);
          drawWord(g, spr, x + off, y, 1, 1, 0, a * 0.55);
          a = 0;
        } else {
          const f = clamp01((age - 0.32) / 0.35);
          if (f < 1) stamp(g, glow('#ffffff', spr.h * 0.7, dpr, 0.6), x, y, 1 + 0.4 * f, 0.6 * (1 - f) * fadeGone);
          sc = 1.06 - 0.06 * easeOut(f);
        }
        break;
      }
      default:
        sc = 0.8 + 0.2 * easeOutBack(clamp01(age / 0.16));
    }
    // a count going up (SWING ×2 → ×3) or a text changed in place: a bump, not a new word
    if (e.bump >= 0) { const b = clamp01((this.t - e.bump) / 0.22); sc *= 1 + 0.2 * Math.sin(Math.PI * b) * (1 - b * 0.3); }
    if (a > 0.003) drawWord(g, spr, x, y, sc * sx, sc, rot, a);
    const reach = e.kind === 'fling' ? 40 * u : e.kind === 'merge' || e.kind === 'pair' ? 34 * u : 6 * u;
    const hw = spr.w * 0.6 * Math.max(sc * sx, 1.6) + reach, hh = spr.h * 0.6 * Math.max(sc, 1.6) + reach + 18 * u;
    out.push({ x: x0 - hw, y: y0 - hh, w: hw * 2, h: hh * 2 });
    return a;
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

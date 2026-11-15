// The fused finale's bloom (phase 5, report 17's fifth issue; the art bible: "a fusion is a bloom, a flower or a tree
// of light opening over the pair, a finale is the sun at its height"). A tree of light grows round the lift and opens
// a flower over it, all of it the glow list's light (play/glow.ts; glow.wgsl's petals and leaves), kept off the bodies:
//   vines   two stems of light, one in each seat's colour (rose, fern) with a sunlit gold core, rise from the floor
//           either side of the pair and a little behind it as the flyer is drawn in and lifted, curving out and back
//           in like an art-nouveau whiplash, leaves unfurling along them, and meet over the flyer's head
//   flower  where they meet, as the lift reaches its top, a flower opens on the page's own clock (so it opens through
//           the lift's held frames, which slow the bodies' time: weight.ts): a fan of petals over the pair in both
//           seats' colours with gold rims, an inner crown of gold, stamens, the sun's disc behind its heart and faint
//           rays of sun turning slowly out from it. It never reaches down onto the bodies (a fan, not a full circle)
//   floor   a flower of light lying round the base's feet, petals in both colours opening as the flyer rises
//   petals  falling from the crown as the flyer comes down, through the banner, swaying
// Phase 6 (report 20, report 19's second issue: "the fused bloom is small and pastel"): the flower opens over the whole
// stage, its petals 2.5 m long (the frame holds its heart; its petals run off the frame's top and sides), a crown of long
// gold sepals and rays of sun fanning out behind it, the vines a hand's width, the floor's flower as wide as the pair;
// its light falls on the world round it through the world's answer (answer.ts: a lamp at the flower's heart, the sun's
// shafts from it, an aurora).
// Then it all fades under the banner. Pure: positions and timing in, glows out; fx.ts calls it and keeps it off the
// bodies (its glows are one range: `keepOff`, and the moments probe measures it: moments.ts `bloomCover`).
import type { Glows, RGB } from '../play/glow';
import { mixRGB } from '../play/feel';
import { FINALE, type FinaleLook } from './finale';

type V3 = [number, number, number];

export const BLOOM = {
  /** the vines rise over this much of the duet (u), the flower opens over OPEN_S of the page's time from OPEN_U */
  RISE: [0.2, 0.52] as const,
  OPEN_U: 0.47,
  OPEN_S: 0.75,
  /** the flower's heart over the base's feet with no camera (m); with one, straight up from the flyer's head: at most
   *  UP and at least MIN_UP metres, SCREEN_UP of the screen's height over the head and never above SCREEN_TOP of it
   *  (the HUD's panels); and how far behind that, away from the eye (m; below 0 toward it: the glow is depth-tested,
   *  and a piece of the arena standing behind the pair would hide a flower set back) */
  HIGH: FINALE.TOP + 2.6,
  UP: 2.6,
  MIN_UP: 0.9,
  SCREEN_UP: 0.2,
  SCREEN_TOP: 0.24,
  BACK: -0.3,
  /** the camera frames a point this far over the flyer's head through a fused finale (index.ts), room for the flower's
   *  heart; once it opens, FRAME_TOP over its heart (fx.ts flowerTop): the petals run off the frame */
  FRAME_UP: 1.7,
  FRAME_TOP: 0.8,
  /** the vines' feet either side of the base (m) */
  SPAN: 1.7,
  /** the outer petals' length when open, and their half width (m); how many; the rays of sun behind them (how many, and
   *  how long at the most, m) */
  PETAL: 2.5,
  PETAL_W: 0.46,
  PETALS: 13,
  RAYS: 26,
  RAY: 4.8,
  /** after the duet, the bloom holds this long, then fades over FADE_S (s) */
  HOLD_S: 1.6,
  FADE_S: 1.8,
  /** how much of its light keeps off the bodies' cores (fx.ts keepOff) */
  KEEP_OFF: 0.95,
};

/** the bloom's light: gold, cream, leaf (HDR, as fx.ts's SUNLIT_RGB) */
const GOLD: RGB = [1.75, 1.3, 0.5], CREAM: RGB = [1.55, 1.42, 1.15], SUN: RGB = [1.6, 1.15, 0.45], LEAF: RGB = [0.55, 1.15, 0.4], GLINT: RGB = [1.85, 1.62, 1.15];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const seg = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));
const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const add = (p: V3, d: V3, k: number): V3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const bez = (p: V3[], s: number): V3 => {
  const a = 1 - s, w = [a * a * a, 3 * a * a * s, 3 * a * s * s, s * s * s];
  return [0, 1, 2].map((i) => w[0] * p[0][i] + w[1] * p[1][i] + w[2] * p[2][i] + w[3] * p[3][i]) as V3;
};
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export interface BloomIn {
  look: FinaleLook;
  /** seconds of the page's time since the flower began to open (negative before) */
  open: number;
  /** the base's feet (the stage the bloom stands on), and the eye */
  foot: V3;
  eye: V3 | null;
  /** the base's and the flyer's colours (seat.ts) */
  ca: RGB;
  cb: RGB;
  /** the page's time (s): the slow turning and swaying */
  t: number;
  /** the flyer's head (the flower stands over it on screen), and the camera's view-projection (column-major) */
  head?: V3;
  viewProj?: ArrayLike<number> | null;
  /** the flower's heart, when the caller holds it still (fx.ts: it follows the rising head until the flower opens) */
  heart?: V3;
}

/** the point the duel's camera frames over the flyer's head through a fused finale until the flower's heart is set
 *  (index.ts camBody; then fx.ts `flowerTop`, the flower's own top) */
export const bloomFrame = (head: V3): V3 => [head[0], head[1] + BLOOM.FRAME_UP, head[2]];

/** a point on screen (0 … 1, y down), or null behind the eye */
function onScreen(m: ArrayLike<number>, p: V3): [number, number] | null {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (!(w > 1e-3)) return null;
  return [((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w) * 0.5 + 0.5, 0.5 - ((m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w) * 0.5];
}

/** where the flower's heart stands: over the flyer's head as the duel's camera sees it, as high on screen as SCREEN_TOP allows (the HUD's panels hold the top), at
 *  least MIN_UP over the head; with no camera, BLOOM.HIGH over the base's feet */
export function flowerAt(foot: V3, head: V3 | undefined, eye: V3 | null, vp: ArrayLike<number> | null | undefined): V3 {
  if (!head || !eye || !vp) return [foot[0], foot[1] + BLOOM.HIGH, foot[2]];
  // (straight up from the head: up the screen from any camera that doesn't look straight down, and never off behind the
  // pair where the arena's pieces stand, as the screen's own up is from a camera looking down)
  const ux = 0, uy = 1, uz = 0;
  const at = (d: number): V3 => [head[0] + ux * d, head[1] + uy * d, head[2] + uz * d];
  const h = onScreen(vp, head);
  if (!h) return at(BLOOM.UP);
  const want = Math.max(BLOOM.SCREEN_TOP, h[1] - BLOOM.SCREEN_UP);
  // (the distance up the screen's up that lands the heart at `want`: bisected, it grows monotonically)
  let lo = BLOOM.MIN_UP, hi = BLOOM.UP;
  const yAt = (d: number) => onScreen(vp, at(d))?.[1] ?? -1;
  if (yAt(lo) <= want) return at(lo);
  if (yAt(hi) >= want) return at(hi);
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (yAt(m) > want) lo = m; else hi = m; }
  return at((lo + hi) / 2);
}

/** how far the bloom shows (0 … 1): grown with the lift, held through the duet and the banner's start, then gone */
export function bloomFade(f: FinaleLook) {
  const after = Math.max(0, f.t - f.len);
  return f.fused ? 1 - smooth((after - BLOOM.HOLD_S) / BLOOM.FADE_S) : 0;
}

/** the bloom, into the glow list (returns the glows it added) */
export function drawBloom(G: Glows, b: BloomIn): number {
  const f = b.look, fade = bloomFade(f);
  if (fade <= 0.003) return 0;
  const g0 = G.count;
  const B = b.foot;
  // the frame's axes: right across the screen, back away from the eye, up
  let bx = B[0] - (b.eye?.[0] ?? B[0]), bz = B[2] - (b.eye?.[2] ?? B[2] - 1);
  const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
  const back: V3 = [bx, 0, bz], right: V3 = [-bz, 0, bx], up: V3 = [0, 1, 0];
  const C = add(b.heart ?? flowerAt(B, b.head, b.eye, b.viewProj), back, BLOOM.BACK);
  const rise = smooth(seg(f.u, BLOOM.RISE[0], BLOOM.RISE[1]));
  const open = smooth(b.open / BLOOM.OPEN_S), bloomed = b.open > 0 ? 1 : 0;
  const cols = [b.ca, b.cb];

  // ---- the vines: one each side, the base's colour on the left, the flyer's on the right, a gold core
  if (rise > 0.005) {
    for (const side of [-1, 1]) {
      const col = cols[side < 0 ? 0 : 1], core = mixRGB(col, GOLD, 0.55);
      const P: V3[] = [
        add(add(B, right, side * BLOOM.SPAN), up, 0.02),
        add(add(B, right, side * (BLOOM.SPAN + 0.5)), up, 1.05),
        add(add(lerp3(B, C, 0.8), right, side * 1.05), up, -0.7),
        add(add(C, right, side * 0.08), up, -0.06),
      ];
      const N = 24, n = Math.max(1, Math.ceil(N * rise));
      let prev = bez(P, 0);
      for (let i = 1; i <= n; i++) {
        const s = Math.min(rise, i / N), q = bez(P, s), w = 0.12 - 0.05 * s;
        G.seg(prev, q, w * 1.6, col, 0.5 * fade, 'soft');
        G.seg(prev, q, w * 0.45, core, 1.3 * fade, 'soft');
        prev = q;
      }
      // the growing tip: a bud of light, while it grows
      if (rise < 0.999) G.dot(prev, 0.1, GLINT, 1.6 * fade, 'spark');
      // leaves unfurling along it, alternating, turned out from the stem
      for (let k = 0; k < 11; k++) {
        const s = 0.08 + k * 0.078, grow = smooth((rise - s) / 0.12);
        if (grow <= 0.01) continue;
        const p = bez(P, s), d = bez(P, Math.min(1, s + 0.02)), tx = d[0] - p[0], ty = d[1] - p[1], tz = d[2] - p[2], tl = Math.hypot(tx, ty, tz) || 1;
        const out = k % 2 ? 1 : -1, sway = 0.12 * Math.sin(b.t * 1.7 + k * 1.3);
        // (the leaf's direction: the stem's, turned 55° in the screen's plane, outward and inward in turn)
        const ang = out * (0.95 + sway), c = Math.cos(ang), sn = Math.sin(ang);
        const ux = tx / tl, uy = ty / tl, uz = tz / tl;
        // rotate the tangent within the plane spanned by up and right (screen plane): its right and up parts
        const tr = ux * right[0] + uz * right[2], tu = uy;
        const lr = tr * c - tu * sn, lu = tr * sn + tu * c;
        const L = (0.36 + 0.1 * hash(k + side * 7)) * grow, tip = add(add(p, right, lr * L), up, lu * L);
        G.petal(p, tip, 0.1 * grow, mixRGB(LEAF, col, 0.18), 0.9 * fade, true);
        // (every third leaf a small blossom of five petals in the stem's colour, a bead of pollen at its heart)
        if (k % 3 === 1 && grow > 0.3) {
          const bo = smooth((grow - 0.3) / 0.7), bc = add(add(p, right, -lr * 0.09), up, -lu * 0.09);
          for (let j = 0; j < 5; j++) {
            const ba = (j / 5) * Math.PI * 2 + b.t * 0.3 + k, br = 0.13 * bo;
            G.petal(bc, add(add(bc, right, Math.cos(ba) * br), up, Math.sin(ba) * br), 0.05 * bo, col, 0.85 * fade, false);
          }
          G.dot(bc, 0.03, GOLD, 1.4 * fade * bo, 'spark');
        }
      }
      // a curl of tendril near the foot and one high on the stem: a small spiral (art nouveau's whiplash ends in one)
      for (const [s0, r0] of [[0.3, 0.09], [0.68, 0.07]] as const) {
        const grow = smooth((rise - s0) / 0.15);
        if (grow <= 0.01) continue;
        const p = bez(P, s0);
        let last: V3 = p;
        for (let j = 1; j <= 10; j++) {
          const a = (j / 10) * Math.PI * 2.2 * grow, r = r0 * (1 - 0.55 * (j / 10));
          const q = add(add(p, right, side * (r0 - Math.cos(a) * r)), up, Math.sin(a) * r);
          G.seg(last, q, 0.014, core, 0.9 * fade, 'soft');
          last = q;
        }
      }
    }
  }

  // ---- the floor's flower: lying petals round the base's feet, opening as the flyer rises
  const fl = smooth(seg(f.u, 0.28, 0.62));
  if (fl > 0.01) {
    const n = 18, foot: V3 = [B[0], B[1] + 0.03, B[2]];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.15 * Math.sin(b.t * 0.4), dx = Math.cos(a), dz = Math.sin(a);
      const r0 = 0.55, r1 = r0 + (0.4 + 1.1 * fl) * (i % 2 ? 0.78 : 1);
      G.petal([foot[0] + dx * r0, foot[1], foot[2] + dz * r0], [foot[0] + dx * r1, foot[1], foot[2] + dz * r1], 0.26 * fl, cols[i % 2], 0.36 * fl * fade, false, true);
    }
  }

  // ---- the flower over the pair: a fan of petals opening upward, the sun behind its heart
  if (bloomed || rise > 0.85) {
    // (the flower's plane faces the eye: across the screen and up it)
    const e = b.eye ?? add(C, back, -6), dx = e[0] - C[0], dy = e[1] - C[1], dz = e[2] - C[2], dl = Math.hypot(dx, dy, dz) || 1;
    const nz: V3 = [dx / dl, dy / dl, dz / dl];
    const ax: V3 = right, ay: V3 = [nz[1] * ax[2] - nz[2] * ax[1], nz[2] * ax[0] - nz[0] * ax[2], nz[0] * ax[1] - nz[1] * ax[0]];
    // (ay up the screen)
    if (ay[1] < 0) { ay[0] = -ay[0]; ay[1] = -ay[1]; ay[2] = -ay[2]; }
    const inPlane = (a: number, r: number): V3 => [C[0] + r * (Math.cos(a) * ax[0] + Math.sin(a) * ay[0]), C[1] + r * (Math.cos(a) * ax[1] + Math.sin(a) * ay[1]), C[2] + r * (Math.cos(a) * ax[2] + Math.sin(a) * ay[2])];
    const bud = 0.25 + 0.75 * open, breathe = 1 + 0.035 * Math.sin(b.t * 1.85);
    // the sun at its height: a warm disc behind the heart, and rays turning slowly out of it over the fan
    G.dot(add(C, back, 0.05), (0.24 + 0.26 * open) * breathe, SUN, (0.08 + 0.06 * open) * fade, 'soft');
    if (open > 0.02) {
      const nr = BLOOM.RAYS;
      for (let i = 0; i < nr; i++) {
        const a = -0.4 + (i / (nr - 1)) * (Math.PI + 0.8) + 0.05 * Math.sin(b.t * 0.5 + i), L = (0.45 + 0.55 * hash(i * 3.1)) * BLOOM.RAY * open;
        const fl2 = 0.6 + 0.4 * Math.sin(b.t * 2.2 + i * 1.9), r0 = 0.9 * open;
        G.seg(inPlane(a, r0), inPlane(a, r0 + L), 0.03, SUN, 0.05 * fade * fl2, 'soft');
        G.seg(inPlane(a, r0), inPlane(a, r0 + L * 0.8), 0.01, GLINT, 0.15 * fade * fl2, 'soft');
      }
    }
    // behind the fan: long gold sepals between the petals, faint, the sun's own crown
    for (let i = 0; i < BLOOM.PETALS; i++) {
      const fan = -0.3 + ((i + 0.5) / BLOOM.PETALS) * (Math.PI + 0.6), a = Math.PI / 2 + (fan - Math.PI / 2) * open;
      const s0 = 0.15 + 0.45 * open;
      G.petal(inPlane(a, s0), inPlane(a, s0 + (0.3 + (BLOOM.PETAL * 1.0) * open) * breathe), 0.12, SUN, 0.12 * fade * bud, false);
    }
    // the outer fan: 9 petals from a little below level on each side to straight up, in the two colours
    const n = BLOOM.PETALS;
    for (let i = 0; i < n; i++) {
      const fan = -0.42 + (i / (n - 1)) * (Math.PI + 0.84), budA = Math.PI / 2 + (i / (n - 1) - 0.5) * 0.5;
      const a = budA + (fan - budA) * open + 0.025 * Math.sin(b.t * 1.3 + i);
      const L = (0.3 + (BLOOM.PETAL - 0.3) * open) * (i % 2 ? 0.84 : 1) * breathe;
      // (the seat's colour, its most saturated: added over a bright sky or water it whitens on its own, so the petal's
      // body is the colour alone and the gold is only its rim and heart)
      const c0 = cols[i % 2], col: RGB = [c0[0] * 0.95, c0[1] * 0.95, c0[2] * 0.95];
      // (from a ring round the heart, not its middle: thirteen golden petal bases laid over each other were a white blot)
      const r0 = 0.1 + 0.5 * open;
      G.petal(inPlane(a, r0), inPlane(a, r0 + L), BLOOM.PETAL_W * (0.5 + 0.5 * open), col, 0.72 * fade * bud, false);
    }
    // the inner crown: gold petals between them, shorter
    for (let i = 0; i < 8; i++) {
      const fan = -0.12 + (i / 7) * (Math.PI + 0.24), a = Math.PI / 2 + (fan - Math.PI / 2) * open;
      G.petal(inPlane(a, 0.05), inPlane(a, 0.07 + (0.2 + 0.45 * open) * breathe), 0.12, GOLD, 0.16 * fade * bud, false);
    }
    // the heart and its stamens: a glint of sun, a few beads on short stems over it
    G.dot(C, 0.08 + 0.05 * open, GLINT, 1.3 * fade, 'spark');
    for (let i = 0; i < 7; i++) {
      const a = Math.PI / 2 + (i - 3) * 0.28, tip = inPlane(a, 0.3 * open + 0.04);
      G.seg(C, tip, 0.01, CREAM, 0.9 * fade * open, 'soft');
      G.dot(tip, 0.035, GOLD, 1.7 * fade * open, 'spark');
    }
    // pollen drifting up and out of the open flower, glinting
    if (open > 0.05) {
      for (let i = 0; i < 40; i++) {
        const v = (b.t * 0.22 + hash(i * 4.1)) % 1, a = 0.1 + hash(i * 2.3) * (Math.PI - 0.2), r = (0.4 + 3.2 * v) * open;
        const p = add(inPlane(a, r), up, 0.4 * v);
        G.dot(p, 0.03, i % 3 ? GOLD : cols[i % 2], 1.4 * fade * Math.sin(Math.PI * v) * open, 'spark');
      }
    }
    // petals falling from the crown as the flyer comes down and through the banner, swaying as they sink
    const since = b.open - BLOOM.OPEN_S * 0.6;
    if (since > 0) {
      for (let i = 0; i < 36; i++) {
        const born = hash(i * 5.3) * 2.6, age = since - born;
        if (age <= 0) continue;
        const life = 3.2, v = age / life;
        if (v >= 1) continue;
        const a = -0.2 + hash(i * 1.7) * (Math.PI + 0.4), start = inPlane(a, 0.5 + 1.6 * hash(i * 2.9));
        const sw = Math.sin(age * 2.1 + i) * 0.22 * Math.min(1, age);
        const p: V3 = add(add(start, right, sw + Math.cos(a) * 0.25 * age), up, -0.42 * age - 0.04 * age * age);
        const tw = age * 2.4 + i, dir: V3 = add(add([0, 0, 0], right, Math.cos(tw) * 0.11), up, Math.sin(tw) * 0.11);
        G.petal(add(p, dir, -1), add(p, dir, 1), 0.06, mixRGB(cols[i % 2], CREAM, 0.3), 0.9 * fade * Math.sin(Math.PI * Math.min(1, v * 1.15)), false);
      }
    }
  }
  return G.count - g0;
}

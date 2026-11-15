// The steam probe (phase 5, report 17's issue 3: "steam and the geyser are still white blots on the bodies"). How much
// of each body steam's matter (the wisps, the fronts) and the geyser's light (its column, its rings, the STEAM! bloom)
// cover, read off the rendered pixels: after a sampled frame is stepped, it is grabbed twice a hair of time on (nothing
// moves), once as the player sees it and once with steam and the geyser hidden, and the difference over each body's
// core on screen is how far they took it toward white. Pure readback; nothing is drawn for the player.
// scripts/steam-cap.mjs drives it.
//   veil    a pixel's veil: (luma with − luma without) / (1 − luma without), clamped 0 … 1: the share of the way to white
//           steam took it (a translucent veil 0.2 to 0.4; an opaque white puff over 0.6)
//   covered a body whose core (hips to head, a torso's width either side, as the moments probe has it) has more than
//           COVERED of its pixels under a veil over OPAQUE
import { Capture, type Kit } from '@ericrius1/weft';
import { bodyBox, CORE_JOINTS, type Box } from './moments';

type V3 = [number, number, number];
type Proj = (p: V3) => [number, number];

/** a pixel this far toward white is under an opaque veil */
export const OPAQUE = 0.5;
/** a body is covered when more than this share of its core is under an opaque veil (report 16-moments' 15 %) */
export const COVERED = 0.15;
/** steam is on screen when more than this share of the frame is veiled past 0.1 */
const ON_SCREEN = 0.005;
/** the two grabs of a sample are this far apart (s): a dt of 0 divides by zero in places (fire's voice) */
const EPS = 1e-4;

const luma = (d: Uint8ClampedArray, i: number) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

export interface SteamSample {
  /** the share of the frame veiled past 0.1, and past OPAQUE */
  screen: number;
  opaque: number;
  /** each body's core: the share of its pixels under an opaque veil, and its mean veil (null: off screen) */
  core: ({ opaque: number; mean: number } | null)[];
  /** the veil's mean over the frame's veiled pixels (how thick steam is where it is) */
  thick: number;
}

/** one frame's veil over the bodies: `on` as drawn, `off` the same frame without steam */
export function veilOf(on: ImageData, off: ImageData, boxes: (Box | null)[]): SteamSample {
  const W = on.width, H = on.height, a = on.data, b = off.data;
  let veiled = 0, opaque = 0, sum = 0;
  for (let i = 0; i < a.length; i += 16) {
    // (the frame's share on every 4th pixel)
    const y0 = luma(b, i), v = Math.max(0, Math.min(1, (luma(a, i) - y0) / Math.max(1 - y0, 0.04)));
    if (v > 0.1) { veiled++; sum += v; }
    if (v > OPAQUE) opaque++;
  }
  const n = a.length / 16;
  const core = boxes.map((B) => {
    if (!B) return null;
    const x0 = Math.max(0, Math.floor(B.x)), x1 = Math.min(W, Math.ceil(B.x + B.w)), y0 = Math.max(0, Math.floor(B.y)), y1 = Math.min(H, Math.ceil(B.y + B.h));
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    let c = 0, o = 0, m = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4, l0 = luma(b, i), v = Math.max(0, Math.min(1, (luma(a, i) - l0) / Math.max(1 - l0, 0.04)));
      c++; m += v; if (v > OPAQUE) o++;
    }
    return { opaque: o / c, mean: m / c };
  });
  return { screen: veiled / n, opaque: opaque / n, core, thick: veiled ? sum / veiled : 0 };
}

interface Tally { frames: number; covered: number; core: number[]; mean: number[]; screen: number[]; thick: number[] }
const tally = (): Tally => ({ frames: 0, covered: 0, core: [], mean: [], screen: [], thick: [] });
const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
const pct = (x: number[], p: number) => { if (!x.length) return 0; const s = [...x].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };

/** the probe joined to the page's duel (index.ts: bend.duel.steam) */
export function steamHook(c: {
  kit: Kit; dancer: (k: number) => { skeleton: { world: Float32Array } } | null; project: Proj;
  /** hide steam's matter and the geyser's light (true) or show them again */
  hide: (on: boolean, part?: 'all' | 'glow' | 'matter') => void;
  /** is a geyser live now; did a reaction make steam this frame (STEAM!) */
  geyser: () => boolean; steamed: () => boolean;
}) {
  let capture: Capture | null = null;
  let T = { steam: tally(), geyser: tally(), event: tally() };
  let eventLeft = 0;
  const add = (X: Tally, s: SteamSample) => {
    const cores = s.core.filter((x): x is { opaque: number; mean: number } => !!x);
    const top = cores.length ? Math.max(...cores.map((x) => x.opaque)) : 0, mean = cores.length ? Math.max(...cores.map((x) => x.mean)) : 0;
    X.frames++; X.core.push(top); X.mean.push(mean); X.screen.push(s.screen); X.thick.push(s.thick);
    if (top > COVERED) X.covered++;
  };
  let hiding: 'all' | 'glow' | 'matter' | null = null;
  return {
    /** keep steam hidden until set back to null (stills without it): 'all', its light ('glow': the geyser's) or its
     *  matter ('matter': the wisps and the fronts) */
    hidden(part: 'all' | 'glow' | 'matter' | null) { if (hiding) c.hide(false, hiding); hiding = part; if (part) c.hide(true, part); },
    reset() { T = { steam: tally(), geyser: tally(), event: tally() }; eventLeft = 0; },
    /** step one frame (dt) as the player sees it, then grab it twice more a hair of time on (EPS: nothing moves), as
     *  drawn and without steam; tally it. `t` the duel's time (s); `windowS` how long after a STEAM! its frames count
     *  as the event's; `control` hides nothing (the probe's own noise: what two frames a hair apart differ by) */
    async sample(dt = 1 / 60, t = 0, windowS = 1.0, control = false) {
      capture ??= new Capture(c.kit);
      c.kit.step(dt);
      if (c.steamed()) eventLeft = windowS;
      const live = c.geyser();
      const on = await capture.step(EPS);
      const W = on.width, H = on.height;
      const boxes = [0, 1].map((k) => { const d = c.dancer(k); return d ? bodyBox(d.skeleton.world, CORE_JOINTS, c.project, W, H, 0.2, 0.06) : null; });
      if (!control) c.hide(true);
      let off: ImageData;
      try { off = await capture.step(EPS); } finally { if (!control) c.hide(false); }
      const s = veilOf(on, off, boxes);
      const event = eventLeft > 0;
      eventLeft -= dt;
      const seen = s.screen > ON_SCREEN;
      if (seen) add(T.steam, s);
      if (live) add(T.geyser, s);
      if (event) add(T.event, s);
      const core = Math.max(0, ...s.core.map((x) => x?.opaque ?? 0));
      return { ...s, seen, live, event, worst: core, t };
    },
    /** a frame as drawn (no second pass), for the frames between samples */
    async step(dt = 1 / 60) {
      capture ??= new Capture(c.kit);
      c.kit.step(dt);
      if (c.steamed()) eventLeft = 1.0;
      eventLeft -= dt;
      await c.kit.device.queue.onSubmittedWorkDone();
    },
    result() {
      const sum = (X: Tally) => ({
        frames: X.frames, covered: +(X.covered / Math.max(1, X.frames)).toFixed(3), coreOpaque: +avg(X.core).toFixed(3), coreP90: +pct(X.core, 0.9).toFixed(3),
        coreVeil: +avg(X.mean).toFixed(3), screen: +avg(X.screen).toFixed(3), thick: +avg(X.thick).toFixed(3),
      });
      return { steam: sum(T.steam), geyser: sum(T.geyser), event: sum(T.event) };
    },
  };
}

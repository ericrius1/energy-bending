// Who each body is, worn inside its matter (report 17 issue 4, report 18-bodies): a colour per dancer slot that the
// matter carries in its own light (water's light inside and its rising caustic, ice's inner glow and facet edges, the
// flames' cool licks and plasma's haze, a gem's glow), so two bodies of pale matter read as two even where the seat's
// halo (src/duel/seat.ts) is only a rim. The duel sets it every frame from its seats' colours; anything else leaves it
// at zero (no tint), and it falls back to zero a few frames after nobody sets it (the duel stopped). The shared body
// uniform carries it to the shaders that include matter/core/body.wgsl (`bodies.seat[d]`); the kinds whose shaders
// don't (fire, gems, ice's shards) copy it into their own uniforms in their update.
import { LIMITS } from '../../engine/limits';

/** per dancer slot: rgb the seat's hue (linear, brightest channel 1), w how strongly the matter wears it (0 … 1) */
const TINT = new Float32Array(LIMITS.dancers * 4);
const NONE = new Float32Array(LIMITS.dancers * 4);
let fresh = 0;

/** dancer slot d wears `rgb` (any brightness: only its hue is kept) at strength k (0 … 1) this frame */
export function setSeatTint(d: number, rgb: readonly number[], k: number) {
  if (d < 0 || d >= LIMITS.dancers) return;
  const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
  TINT[d * 4] = rgb[0] / m; TINT[d * 4 + 1] = rgb[1] / m; TINT[d * 4 + 2] = rgb[2] / m; TINT[d * 4 + 3] = Math.max(0, Math.min(1, k));
  fresh = 4;
}

/** what the matter wears this frame: one vec4 per dancer slot (zero when nobody has set it lately) */
export function seatTints(): Float32Array { return fresh > 0 ? TINT : NONE; }

/** once a frame (BodyBuffers.upload): a tint nobody has set for a few frames goes back to none */
export function tickSeatTints() { if (fresh > 0 && --fresh === 0) TINT.fill(0); }

/** the tints as two colours and a side per dancer slot (for matter drawn as one field, fire's: one channel can say
 *  "this much A, that much B"): a the first colour worn, b the next different one; side[d] + toward a, − toward b,
 *  × the strength */
export function seatPair() {
  const T = seatTints(), side = new Array<number>(LIMITS.dancers).fill(0);
  let a: number[] | null = null, b: number[] | null = null;
  const same = (c: number[], d: number) => Math.abs(c[0] - T[d * 4]) + Math.abs(c[1] - T[d * 4 + 1]) + Math.abs(c[2] - T[d * 4 + 2]) < 1e-3;
  for (let d = 0; d < LIMITS.dancers; d++) {
    const k = T[d * 4 + 3];
    if (k <= 0) continue;
    const c = [T[d * 4], T[d * 4 + 1], T[d * 4 + 2]];
    if (!a || same(a, d)) { a ??= c; side[d] = k; } else { b ??= c; if (same(b, d)) side[d] = -k; }
  }
  return { side, a: [...(a ?? [0, 0, 0]), 1], b: [...(b ?? [0, 0, 0]), 1] };
}

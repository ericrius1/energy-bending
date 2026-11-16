// The space's soft edge, shared by the duel (match.ts) and, since phase 7 (report 24-feel), the dance in open 3D
// (dancer/play.ts): a newcomer from the front who held W walked out through the geode's glass into the blur 28 m off,
// with nothing to say where the world had gone. The same skater's curve round the edge the duel has, the lanes to the
// mirrors left open.
import type { Character } from '../dancer/character';
import type { Arena } from './arena';

/** the band inside the radius where a way out is turned along it (m), how fast (a share of the way out a frame at the
 *  radius, eased in over the band), the share of the turned speed kept along the edge, how far past the radius a body
 *  is eased back each frame, and past how far it is stopped outright */
export const EDGE = { band: 1.6, turn: 0.22, keep: 0.85, ease: 0.2, hard: 1.4 };

/** the space's soft edge (phase 5, report 18-flow: it was a wall that took a body's outward speed at the radius,
 *  a stop): from EDGE.band inside the radius a body's way out is turned along the edge, more the further out, its
 *  speed kept (most of it), so a run at the edge curves round it as a skater's would; past the radius it is eased back
 *  in as before; far past it (a fling at full speed), stopped as before. Returns the speed taken (m/s) */
export function softEdge(c: Character, A: Pick<Arena, 'space' | 'exits'>, radius = A.space.radius) {
  const S = { center: A.space.center, radius }, dx = c.root[0] - S.center[0], dz = c.root[2] - S.center[2], d = Math.hypot(dx, dz);
  const E = EDGE, inner = S.radius - E.band;
  if (d <= inner || d < 1e-6) return 0;
  // (in the lane of a way out (a gate or a mirror, arena.ts exits), up to its disc and a little past: open. Two
  // gates stand past their space's radius, the geode's to the redwoods and the redwoods' to the hub, and the edge
  // kept every body from them: report 19, src/duel/test/edge.test.ts)
  for (const e of A.exits ?? []) {
    const rx = c.root[0] - e.at[0], rz = c.root[2] - e.at[2], along = rx * e.dir[0] + rz * e.dir[1];
    if (along < 0.6 && along > -E.band - 2 && Math.abs(-rx * e.dir[1] + rz * e.dir[0]) < e.r) return 0;
  }
  const nx = dx / d, nz = dz / d, over = d - S.radius;
  if (over > 0) { c.root[0] -= nx * over * E.ease; c.root[2] -= nz * over * E.ease; }
  const out = c.v[0] * nx + c.v[2] * nz;
  if (out <= 0) return 0;
  if (over > E.hard) { c.v[0] -= nx * out; c.v[2] -= nz * out; return out; }
  // (how much of the way out is turned this frame: none at the band's inner edge, all of it at the radius)
  const k = Math.min(1, (d - inner) / E.band), turn = out * Math.min(1, k * k * E.turn + (over > 0 ? 1 : 0));
  let tx = c.v[0] - nx * out, tz = c.v[2] - nz * out, tl = Math.hypot(tx, tz);
  // (straight out: turned toward the way the body faces, else either way)
  if (tl < 0.3) { const f = Math.sin(c.yaw) * -nz + Math.cos(c.yaw) * nx >= 0 ? 1 : -1; tx = -nz * f; tz = nx * f; tl = 0; } else { tx /= tl; tz /= tl; }
  const along = tl + turn * E.keep;
  c.v[0] = tx * along + nx * (out - turn); c.v[2] = tz * along + nz * (out - turn);
  return turn * (1 - E.keep);
}

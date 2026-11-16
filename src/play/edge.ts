// The dance's soft edge (report 24-newcomer). In open 3D the dance had no edge: a newcomer holding W walked off the
// stage, through the geode's balustrade and out past its glass, the follow camera after them inside the wall. This is
// the duel's soft edge (src/duel/match.ts softWall, report 18-flow) on the dance's bodies, about the world's duel arena
// space (src/duel/arena.ts: each world registers one): from EDGE.band inside the radius a body's way out is turned along
// the edge (most of its speed kept, so a run at the edge curves round it), past the radius it is eased back in, far
// past it stopped; the lanes of the ways out (the mirrors and the hub's gates, Arena.exits) stay open. Free bodies
// only: the side view has its own walls. Pure (plain numbers): test/edge.test.ts.
import { EDGE } from '../duel/match';
import type { Arena } from '../duel/arena';

export interface EdgeBody { root: number[] | Float32Array; v: number[] | Float32Array; yaw: number }

/** one body's step at the edge (a frame); returns the speed it took (m/s) */
export function softEdge(c: EdgeBody, A: Pick<Arena, 'space' | 'exits'>) {
  const S = A.space, dx = c.root[0] - S.center[0], dz = c.root[2] - S.center[2], d = Math.hypot(dx, dz);
  const E = EDGE, inner = S.radius - E.band;
  if (d <= inner || d < 1e-6) return 0;
  for (const e of A.exits ?? []) {
    const rx = c.root[0] - e.at[0], rz = c.root[2] - e.at[2], along = rx * e.dir[0] + rz * e.dir[1];
    if (along < 0.6 && along > -E.band - 2 && Math.abs(-rx * e.dir[1] + rz * e.dir[0]) < e.r) return 0;
  }
  const nx = dx / d, nz = dz / d, over = d - S.radius;
  if (over > 0) { c.root[0] -= nx * over * E.ease; c.root[2] -= nz * over * E.ease; }
  const out = c.v[0] * nx + c.v[2] * nz;
  if (out <= 0) return 0;
  if (over > E.hard) { c.v[0] -= nx * out; c.v[2] -= nz * out; return out; }
  const k = Math.min(1, (d - inner) / E.band), turn = out * Math.min(1, k * k * E.turn + (over > 0 ? 1 : 0));
  let tx = c.v[0] - nx * out, tz = c.v[2] - nz * out;
  const tl0 = Math.hypot(tx, tz);
  let tl = tl0;
  if (tl0 < 0.3) { const f = Math.sin(c.yaw) * -nz + Math.cos(c.yaw) * nx >= 0 ? 1 : -1; tx = -nz * f; tz = nx * f; tl = 0; } else { tx /= tl0; tz /= tl0; }
  const along = tl + turn * E.keep;
  c.v[0] = tx * along + nx * (out - turn); c.v[2] = tz * along + nz * (out - turn);
  return turn * (1 - E.keep);
}

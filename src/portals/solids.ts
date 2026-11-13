// The solid things of each world as the camera sees them: rough capsules and boxes (engine/camera.ts `Solid`) that
// the rig keeps its eye out of and the lock looks past. A world that says its own (`solids()`, the shape asked of the
// worlds in docs/extending/camera.md) is taken at its word; until each does, this reads them from what the worlds
// already lay out (read only, never changed): the temple's stones, the geode's blades and crystal points, the
// redwoods' trunks, limbs, lanterns and stage logs, the forge's stage columns. The Pool has nothing solid. Made once
// per world, on first use, in that world's own coordinates (the rig's while it is there).
import { Solids, boxOn, type Solid } from '../engine/camera';
import type { World } from '../worlds/world';

type V3 = [number, number, number];

/** the request to the worlds: an optional `solids()` on World, the rough shapes of its big solid things (static, in its
 *  own coordinates; a thing that moves a little, a bobbing slab or a swinging lantern, given where it can be) */
export type WithSolids = World & { solids?(): readonly Solid[] };

const made = new WeakMap<World, Solids | null>();

/** a world's solids (null: none known) */
export function solidsOf(w: World): Solids | null {
  if (made.has(w)) return made.get(w)!;
  let list: readonly Solid[] | null = null;
  try {
    list = (w as WithSolids).solids?.() ?? READ[w.id]?.(w as unknown as Record<string, unknown>) ?? null;
  } catch (e) {
    // (a world laid out differently from what this reads: the camera goes without, and says so once)
    console.warn(`camera: could not read ${w.id}'s solids (${(e as Error).message}); the eye avoids only gates there`);
  }
  const s = list && list.length ? new Solids(list) : null;
  made.set(w, s);
  return s;
}

const cap = (a: V3, b: V3, r: number): Solid => ({ kind: 'capsule', a, b, r });

/** an upright cylinder (radius r, from y0 to y1) as a capsule when it is tall, a box when it is squat */
function cylinder(x: number, z: number, y0: number, y1: number, r: number, yaw = 0): Solid {
  return y1 - y0 > 2 * r ? cap([x, y0 + r, z], [x, y1 - r, z], r) : boxOn([x, y0, z], [2 * r, y1 - y0, 2 * r], yaw);
}

/** each world's reader, by id (the fields named are the worlds' own; see their layout files) */
const READ: Record<string, (w: Record<string, unknown>) => Solid[]> = {
  // stones (temple/layout.ts Stone): a block stands on `at`, turned `yaw`; a drum stands, or lies along its yaw's z
  // resting on the floor; the platform (open) is the floor itself
  temple(w) {
    const out: Solid[] = [];
    type Stone = { kind: string; at: V3; size: V3; yaw: number; tilt: number; open?: boolean };
    for (const s of (w.layout as { stones: Stone[] }).stones) {
      if (s.open) continue;
      if (s.kind === 'block') { out.push(boxOn(s.at, s.size, s.yaw)); continue; }
      const r = Math.max(s.size[0], s.size[2]), H = s.size[1];
      if (!s.tilt) { out.push(cylinder(s.at[0], s.at[2], s.at[1], s.at[1] + H, r, s.yaw)); continue; }
      const c: V3 = [s.at[0], s.at[1] + r, s.at[2]], ax: V3 = [Math.sin(s.yaw), 0, Math.cos(s.yaw)], h = Math.max(0, H / 2 - r);
      out.push(H > 2 * r ? cap([c[0] - ax[0] * h, c[1], c[2] - ax[2] * h], [c[0] + ax[0] * h, c[1], c[2] + ax[2] * h], r)
        : boxOn(s.at, [2 * r, 2 * r, H], s.yaw));
    }
    return out;
  },
  // blades (geode/shelves.ts Blade, drawn by shelves.wgsl): a box from its top's root, across ±w/2, down `thick`,
  // along `len`, turned `yaw` and tipped `pitch`; crystal points (crystals.wgsl): a hexagonal prism from `at` along
  // the same axis, about w/2 round (the small ones round the gates are left to the gates' own clearance)
  geode(w) {
    const out: Solid[] = [];
    type Blade = { at: V3; yaw: number; pitch: number; w: number; thick: number; len: number };
    const axes = (b: Blade) => {
      const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw), cp = Math.cos(b.pitch), sp = Math.sin(b.pitch);
      return { x: [cy, 0, -sy] as V3, y: [-sp * sy, cp, -sp * cy] as V3, z: [cp * sy, sp, cp * cy] as V3 };
    };
    for (const b of w.blades as Blade[]) {
      const { x, y, z } = axes(b);
      const c: V3 = [0, 1, 2].map((k) => b.at[k] - y[k] * b.thick / 2 + z[k] * b.len / 2) as V3;
      out.push({ kind: 'box', c, x, y, z, h: [b.w / 2, b.thick / 2, b.len / 2] });
    }
    for (const b of w.points as Blade[]) {
      if (b.len < 0.45) continue;
      const { z } = axes(b), r = b.w * 0.6;
      out.push(cap([...b.at], [b.at[0] + z[0] * (b.len - r), b.at[1] + z[1] * (b.len - r), b.at[2] + z[2] * (b.len - r)], r));
    }
    return out;
  },
  // the redwoods (redwoods/layout.ts, trunks.wgsl): a trunk flares to twice its radius at the foot; a limb sags by
  // `droop` u² along its length and tapers to 22 %; the stage's log, plate, roots and boughs are capsules already
  // (redwoods/stage.ts Piece); a lantern hangs `cord` below its anchor and swings
  redwoods(w) {
    const out: Solid[] = [];
    const woods = w.woods as { layout: { logs: Float32Array; near: number; far: number; limbs: number; lanterns: { anchor: V3; cord: number; size: number }[] } };
    const L = woods.layout, N = L.near + L.far, room = (w.room as number) + 8;
    for (let i = 0; i < N; i++) {
      const o = i * 12, x = L.logs[o], z = L.logs[o + 2], r = L.logs[o + 3], y = L.logs[o + 1];
      if (Math.hypot(x, z) - 2 * r > room) continue;
      out.push(cap([x, y, z], [x, y + 1.2, z], r * 2.1), cap([x, y + 1.2, z], [x, y + 4, z], r * 1.45), cap([x, y + 4, z], [x, y + 40, z], r));
    }
    for (let i = N; i < N + L.limbs; i++) {
      const o = i * 12, f: V3 = [L.logs[o], L.logs[o + 1], L.logs[o + 2]], r = L.logs[o + 3];
      const ax: V3 = [L.logs[o + 4], L.logs[o + 5], L.logs[o + 6]], len = L.logs[o + 7], droop = L.logs[o + 10];
      const at = (u: number): V3 => [f[0] + ax[0] * len * u, f[1] + ax[1] * len * u - droop * u * u, f[2] + ax[2] * len * u];
      for (let k = 0; k < 4; k++) out.push(cap(at(k / 4), at((k + 1) / 4), r * (1 - 0.78 * (k / 4)) + 0.03));
    }
    for (const l of L.lanterns) out.push(cap([l.anchor[0], l.anchor[1] - l.cord, l.anchor[2]], [l.anchor[0], l.anchor[1] - l.cord, l.anchor[2]], l.size * 1.6 + 0.15));
    for (const p of (w.stage as { pieces: { a: V3; b: V3; ra: number; rb: number }[] }).pieces) out.push(cap([...p.a], [...p.b], Math.max(p.ra, p.rb)));
    return out;
  },
  // the forge's stage (forge/layout.ts): columns of hexagons, each from its flat top down `hang`; the bobbing ones
  // (the floats and the crown) as high as they rise. The far islands are out of the camera's reach
  forge(w) {
    const out: Solid[] = [];
    const L = w.layout as { columns: Float32Array; stageColumns: number; slabs: { bob: number }[] };
    for (let i = 0; i < L.stageColumns; i++) {
      const o = i * 8, x = L.columns[o], z = L.columns[o + 1], top = L.columns[o + 2], R = L.columns[o + 3], hang = L.columns[o + 4];
      const bob = L.slabs[L.columns[o + 5]]?.bob ?? 0;
      out.push(boxOn([x, top - hang - bob, z], [Math.sqrt(3) * R, hang + 2 * bob, 2 * R]));
    }
    return out;
  },
  pool: () => [],
};

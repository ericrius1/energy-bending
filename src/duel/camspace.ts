// The duel camera's world and its judge (camera.ts reads the world through a CamSpace; phase 3's clean eye, report 13
// issue 4). `spaceOf` is the one CamSpace the page and Node both use: how far a point stands from the nearest solid, a
// sweep along a segment (sight lines, the frame's rays) and the floor, over whatever solids are given (World.solids:
// the world's own, the arena's pieces, the powers' temporary ones), rebuilt when that list changes. `judge` measures a
// pose the way a player would see it: the eye inside a solid or nearer one than the near fade, a piece standing in the
// near part of the frame (a grid of rays through the lens, each looking for a solid nearer than halfway to the bodies),
// a body hidden behind one, both bodies in frame. Pure (camworlds.ts: the four worlds in Node, for the measures).
import { Solids, distTo } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import { DUEL_CAM, nearReach, raysAt, screenOf, short, type CamBody, type CamPose, type CamSpace, type V3 } from './camera';

/** the camera's space over a list of solids (null: none). `sweep` is the share of a → b a sphere of radius r moves
 *  before it touches one (1: clear) */
export function spaceOf(list: readonly Solid[], ground: (x: number, z: number) => number): (CamSpace & { solids: Solids }) | null {
  if (!list.length) return null;
  const S = new Solids(list), B = S.bounds;
  return {
    solids: S,
    clear: (p) => {
      let d = Infinity;
      for (let i = 0; i < list.length; i++) {
        const o = i * 4, c = Math.hypot(p[0] - B[o], p[1] - B[o + 1], p[2] - B[o + 2]) - B[o + 3];
        if (c >= d) continue;
        d = Math.min(d, distTo(list[i], p));
      }
      return d;
    },
    blocked: (a, b) => S.sweep(a, b, 0.12) < 0.98,
    sweep: (a, b, r) => S.sweep(a, b, r),
    // (only the solids within reach of the eye are swept: most frames there are none)
    fg: (eye, rays, reach, r = 0.04) => {
      const near: Solid[] = [];
      for (let i = 0; i < list.length; i++) {
        const o = i * 4;
        if (Math.hypot(eye[0] - B[o], eye[1] - B[o + 1], eye[2] - B[o + 2]) - B[o + 3] <= reach + r) near.push(list[i]);
      }
      if (!near.length || reach <= 0.05) return 0;
      const L = new Solids(near);
      let n = 0;
      for (const d of rays) if (L.sweep(eye, [eye[0] + d[0] * reach, eye[1] + d[1] * reach, eye[2] + d[2] * reach], r) < 1) n++;
      return n / Math.max(1, rays.length);
    },
    // (the solids within r of p, as their own space, kept while p stays within a metre and a half of where it was made:
    // the redwoods' far wood and the geode's far shelves are never near the eye)
    local: (() => {
      let at: V3 | null = null, R = -1, sub: CamSpace | null = null;
      return (p: V3, r: number) => {
        if (at && R === r && Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) < 1.5) return sub;
        at = [p[0], p[1], p[2]]; R = r;
        const keep: Solid[] = [];
        for (let i = 0; i < list.length; i++) { const o = i * 4; if (Math.hypot(p[0] - B[o], p[1] - B[o + 1], p[2] - B[o + 2]) - B[o + 3] <= r + 1.5) keep.push(list[i]); }
        sub = keep.length === list.length ? null : spaceOf(keep, ground) ?? { clear: () => Infinity, blocked: () => false, sweep: () => 1, fg: () => 0, ground };
        return sub;
      };
    })(),
    ground,
  };
}

/** a CamSpace kept for a list that may change (World.solids: a power's step or pillar comes and goes): rebuilt when the
 *  list is a different one */
export function spaceFor(ground: (x: number, z: number) => number) {
  let list: readonly Solid[] | null = null, space: ReturnType<typeof spaceOf> = null;
  return (now: readonly Solid[]) => {
    if (now !== list) { list = now; space = spaceOf(now, ground); }
    return space;
  };
}

/** what a frame shows, as judged */
export interface CamJudged {
  /** the eye's distance from the nearest solid (m; negative inside one) */
  clear: number;
  /** the share of the frame (a 9 × 5 grid of rays) where a solid stands in its near part (camera.ts nearReach: halfway to
   *  the nearer body, at most DUEL_CAM.fgMax): a piece across the lens */
  fg: number;
  /** per body, the share of its sight points (hips, chest, head) a solid hides */
  hidden: [number, number];
  /** both bodies' heads and hips inside the frame */
  whole: boolean;
}

export const JUDGE = { cols: 9, rows: 5 };

const inFrame = (s: [number, number] | null, top = 0.04) => !!s && s[0] >= 0 && s[0] <= 1 && s[1] >= top && s[1] <= 1;

/** a pose judged against the world and the bodies */
export function judge(pose: CamPose, bodies: readonly CamBody[], space: CamSpace | null, aspect: number): CamJudged {
  const eye = pose.eye, f: V3 = [pose.look[0] - eye[0], pose.look[1] - eye[1], pose.look[2] - eye[2]], L = Math.hypot(...f) || 1;
  const yaw = Math.atan2(-f[0], -f[2]), pitch = Math.asin(Math.max(-1, Math.min(1, -f[1] / L)));
  let whole = true;
  for (const b of bodies) for (const p of [b.head, b.pts[0]]) if (!inFrame(screenOf(p, eye, pose.look, pose.fov, aspect), 0)) whole = false;
  if (!space) return { clear: Infinity, fg: 0, hidden: [0, 0], whole };
  const hidden = bodies.map((b) => {
    const pts = [b.sight[0], b.sight[1] ?? b.sight[0], b.head];
    let n = 0;
    for (const p of pts) if (space.sweep ? space.sweep(eye, short(eye, p, DUEL_CAM.shortOf), 0.05) < 1 : space.blocked(eye, short(eye, p, DUEL_CAM.shortOf))) n++;
    return n / pts.length;
  }) as [number, number];
  return { clear: space.clear(eye), fg: space.fg ? space.fg(eye, raysAt(yaw, pitch, pose.fov, aspect, JUDGE.cols, JUDGE.rows), nearReach(eye, bodies)) : 0, hidden, whole };
}

// The dance's first view (report 24-newcomer; report 23's issue 4: "a selenite slab and a planter block filled the left
// of the frame in the first second"). As the dance begins from the front, the follow camera keeps the front's turn, and
// the geode's rim of slabs and planters stood between it and the dancers. This picks the turn nearest the one it has
// whose view is clear: the boom to the eye clear of the world's solids, and nothing solid in the near part of the frame
// (points over the view, out to `near` m, inside a solid). Pure but for the solids it is given (camera.ts Solids), so
// it runs in Node (test/opening.test.ts).
type V3 = [number, number, number];

export interface SolidsLike {
  sweep(a: V3, b: V3, r: number): number;
  inside(p: V3, r: number): boolean;
}

export const OPENING = {
  /** the turns tried either side of the one it has (rad) */
  step: 0.15, most: 2.4,
  /** how far into the view the frame must be clear (m), the boom's own margin (m) */
  near: 2.6, boom: 0.35,
  /** a turn away from the one it has costs this much per radian, in blocked points (so a nearer turn wins a tie) */
  cost: 1.5,
};

/** the points of the view's near part a solid must not hold: a grid over the frame at a few depths */
export function nearPoints(eye: V3, look: V3, fovDeg: number, aspect: number, near = OPENING.near): V3[] {
  const f: V3 = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], fl = Math.hypot(f[0], f[1], f[2]) || 1;
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  // right and up of the view
  let r: V3 = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[2]) || 1;
  r = [r[0] / rl, 0, r[2] / rl];
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const ty = Math.tan((fovDeg * Math.PI) / 360), tx = ty * aspect;
  const out: V3[] = [];
  for (const d of [0.6, 1.2, 1.9, near]) for (const sx of [-0.9, -0.45, 0, 0.45, 0.9]) for (const sy of [-0.8, 0, 0.8]) {
    const k = d, x = sx * tx * k, y = sy * ty * k;
    out.push([eye[0] + f[0] * k + r[0] * x + u[0] * y, eye[1] + f[1] * k + r[1] * x + u[1] * y, eye[2] + f[2] * k + r[2] * x + u[2] * y]);
  }
  return out;
}

/** the follow camera's eye for a turn: `dist` m back from the look point T, `pitch` up (engine/camera.ts updateFollow) */
export const eyeAt = (T: V3, yaw: number, pitch: number, dist: number): V3 =>
  [T[0] + Math.sin(yaw) * Math.cos(pitch) * dist, T[1] + Math.sin(pitch) * dist, T[2] + Math.cos(yaw) * Math.cos(pitch) * dist];

/** the turn nearest `yaw0` whose view of T is clear (or the least blocked), and how blocked each was */
export function clearTurn(S: SolidsLike, T: V3, yaw0: number, pitch: number, dist: number, fovDeg: number, aspect: number, room = Infinity) {
  let best = yaw0, bestScore = Infinity, n0 = -1;
  const O = OPENING;
  for (let i = 0; i <= Math.round(O.most / O.step) * 2; i++) {
    const d = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * O.step, yaw = yaw0 + d;
    const eye = eyeAt(T, yaw, pitch, dist);
    let n = 0;
    // (the boom itself, from the look point to the eye: a solid across it hides the dancers)
    if (S.sweep(T, eye, O.boom) < 0.98) n += 6;
    // (the eye out past the world's room: the camera would come in for the wall)
    if (Math.hypot(eye[0], eye[2]) > room) n += 6;
    for (const p of nearPoints(eye, T, fovDeg, aspect)) if (S.inside(p, 0.12)) n++;
    if (i === 0) n0 = n;
    const score = n + Math.abs(d) * O.cost;
    if (score < bestScore) { bestScore = score; best = yaw; }
    if (Math.abs(d) * O.cost >= bestScore) break;
  }
  return { yaw: best, blocked: n0, score: bestScore };
}

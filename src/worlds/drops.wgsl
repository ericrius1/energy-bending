// Drops in a floor a world's backdrop draws (the duel's arenas, src/duel/arena.ts: the temple's court, the geode's
// agate, the redwoods' meadow). While an arena is shown, up to two rectangles of the floor, given in its stage plane's
// coordinates (s along the plane, t toward the camera), open into pits: a view ray that meets the floor inside one goes
// on down to where it leaves the pit, its far side or its bottom, and the world shades that face its own way. Off, the
// rectangles are empty and nothing changes.

struct DropHit {
  /** the ray met the floor inside a drop */
  inside: bool,
  /** where along the ray it leaves the pit (from the eye, as the floor's t) */
  t: f32,
  /** the face it meets: its normal (world), and how far below the floor that point is */
  n: vec3f,
  below: f32,
  /** 1 on the pit's bottom, 0 on a side */
  floor: f32,
}

/** the ray from `o` along `d` (d.y < 0) met the floor (height `floorY`) at `t0`: is that in drop `r0` or `r1` (s0, t0,
 *  s1, t1 in the plane `pf`: its origin's x, z and its right's x, z), and if so where does it leave the pit, `deep` m
 *  deep */
fn dropHit(o: vec3f, d: vec3f, t0: f32, floorY: f32, deep: f32, pf: vec4f, r0: vec4f, r1: vec4f) -> DropHit {
  var h: DropHit;
  h.inside = false;
  h.t = t0;
  h.n = vec3f(0.0, 1.0, 0.0);
  h.below = 0.0;
  h.floor = 0.0;
  let R = pf.zw;
  let N = vec2f(-pf.w, pf.z);
  let p = o.xz + d.xz * t0 - pf.xy;
  let q = vec2f(dot(p, R), dot(p, N));
  var r = r0;
  if (!(q.x > r0.x && q.x < r0.z && q.y > r0.y && q.y < r0.w)) {
    if (!(q.x > r1.x && q.x < r1.z && q.y > r1.y && q.y < r1.w)) { return h; }
    r = r1;
  }
  h.inside = true;
  // in the plane's frame, the box [s0, s1] × [t0, t1] × [floor - deep, floor]: the ray leaves it through the side it
  // heads for first, or the bottom
  let oq = vec2f(dot(o.xz - pf.xy, R), dot(o.xz - pf.xy, N));
  let dq = vec2f(dot(d.xz, R), dot(d.xz, N));
  var t = (floorY - deep - o.y) / d.y;
  var nq = vec2f(0.0);
  h.floor = 1.0;
  if (abs(dq.x) > 1e-6) {
    let ts = (select(r.x, r.z, dq.x > 0.0) - oq.x) / dq.x;
    if (ts < t) { t = ts; nq = vec2f(-sign(dq.x), 0.0); h.floor = 0.0; }
  }
  if (abs(dq.y) > 1e-6) {
    let tt = (select(r.y, r.w, dq.y > 0.0) - oq.y) / dq.y;
    if (tt < t) { t = tt; nq = vec2f(0.0, -sign(dq.y)); h.floor = 0.0; }
  }
  h.t = t;
  if (h.floor < 0.5) { h.n = vec3f(R.x * nq.x + N.x * nq.y, 0.0, R.y * nq.x + N.y * nq.y); }
  h.below = floorY - (o.y + d.y * t);
  return h;
}

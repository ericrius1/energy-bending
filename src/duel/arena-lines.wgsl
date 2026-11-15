// The duel arena's lines (arena-layer.ts), each segment a ribbon facing the eye, in the glow pass (additive, never the
// opaque distance). Two uses, one shader:
//   RIM 1: the rim light on what can be stood on and slid on, in the world's palette: a soft ribbon along each platform's
//          top where it crosses the stage plane and up each wall's face, depth-tested, so the part inside the stone (or
//          the trunk, or the crystal) is hidden and what shows is a faint light along the edge the body uses. Its ends
//          fade, and it breathes a little with the beat.
//   RIM 0: the debug view (?arena&arenaDebug): every ledge, wall, spawn, the kill floor and the bounds as crisp lines in
//          their own colours, drawn over everything, to check the data against the drawn geometry.
#include "weft/frame"

struct Seg {
  a: vec4f,   // one end (world); w: its kind
  b: vec4f,   // the other end; w: its width (m)
}

struct Look {
  rim: vec4f,    // the rim light's colour; w: its strength
  beat: vec4f,   // x: the beat's phase (0 … 1), y: how much it breathes, z: how locked the view is, w: the water's
                 // height over the arena (a tide; very low: none): a rim under it is drowned, and fades out
  hole: array<vec4f, 64>,  // the pieces the near fade dissolves (worlds/fade.ts NearFade.holes), four rows each: a.xyz,
                           // its strength; x.xyz, 1 a capsule (to x.xyz); y.xyz, how much of its rim to keep; h.xyz half
                           // sizes, w a capsule's radius
}

/** how much of the rim at p is left by the pieces the near fade dissolves: a rim on a dissolved piece goes with it
 *  (it was a gold box or a gold stick floating where the block or the bough had been: report 17), but a top near the
 *  pair, a floor it needs to see, keeps most of its rim */
fn holeKeep(p: vec3f) -> f32 {
  var keep = 1.0;
  for (var j = 0u; j < 16u; j++) {
    let A = look.hole[j * 4u];
    if (A.w <= 0.0) { continue; }
    let X = look.hole[j * 4u + 1u];
    let Y = look.hole[j * 4u + 2u];
    let H = look.hole[j * 4u + 3u];
    var out = 0.0;
    if (X.w > 0.5) {
      let ab = X.xyz - A.xyz;
      let t = clamp(dot(p - A.xyz, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      out = length(p - A.xyz - ab * t) - H.w;
    } else {
      let l = p - A.xyz;
      let q = H.xyz - abs(vec3f(dot(l, X.xyz), dot(l, Y.xyz), dot(l, cross(X.xyz, Y.xyz))));
      out = -min(q.x, min(q.y, q.z));
    }
    // (a rim runs a centimetre over its top: within a few of the piece is on it)
    if (out < 0.06) { keep = min(keep, 1.0 - A.w * (1.0 - 0.6 * Y.w)); }
  }
  return keep;
}

@group(1) @binding(0) var<storage, read> segs: array<Seg>;
@group(1) @binding(1) var<uniform> look: Look;

override RIM: u32 = 1u;

struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,                         // x: across the ribbon (-1 … 1), y: along it (0 … 1)
  @location(1) @interpolate(flat) info: vec4f,    // kind, its length (m), -, -
  @location(2) y: f32,                            // its height (world)
  @location(3) keep: f32,                         // how much of it the near fade's dissolved pieces leave (holeKeep)
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  let s = segs[ii];
  let corner = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  let d = s.b.xyz - s.a.xyz;
  let L = max(length(d), 1e-4);
  let p0 = s.a.xyz + d * corner.y;
  // across: square to the segment and to the eye, so the ribbon faces it
  var side = cross(d / L, normalize(frame.camPos - p0));
  if (length(side) < 1e-3) { side = vec3f(0.0, 1.0, 0.0); }
  let p = p0 + normalize(side) * corner.x * s.b.w * 0.5;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.uv = corner;
  o.info = vec4f(s.a.w, L, 0.0, 0.0);
  o.y = p.y;
  o.keep = 1.0;
  if (RIM == 1u) { o.keep = holeKeep(p0); }
  return o;
}

/** the debug colours by kind: 0 a one-way ledge, 1 a solid ledge or a top, 2 a wall, 3 a wall that can't be climbed,
 *  4 a spawn, 5 the kill floor, 6 the bounds (the ends, the top, the space's circle), 7 a spawn's body (1.7 m), 8 a drop */
fn kindColour(k: u32) -> vec3f {
  switch (k) {
    case 0u: { return vec3f(0.2, 1.0, 0.3); }
    case 1u: { return vec3f(1.0, 0.85, 0.1); }
    case 2u: { return vec3f(0.1, 0.8, 1.0); }
    case 3u: { return vec3f(0.5, 0.5, 0.6); }
    case 4u: { return vec3f(1.0, 0.2, 0.9); }
    case 5u: { return vec3f(1.0, 0.1, 0.05); }
    case 6u: { return vec3f(0.9, 0.9, 0.9); }
    case 7u: { return vec3f(0.7, 0.3, 0.8); }
    default: { return vec3f(1.0, 0.4, 0.1); }
  }
}

@fragment fn fs(i: LOut) -> @location(0) vec4f {
  // (a kind of 16 and up is the stage plane's: it comes in with the lock)
  let kind = u32(i.info.x + 0.5);
  let k = kind % 16u;
  let lock = select(1.0, look.beat.z, kind >= 16u);
  if (lock <= 0.002) { discard; }
  if (RIM == 0u) {
    // crisp, bright enough to read over any world (the glow pass adds it; the lens blooms it a little)
    let a = 1.0 - smoothstep(0.55, 1.0, abs(i.uv.x));
    return vec4f(kindColour(k) * a * 2.5 * lock, 0.0);
  }
  // the rim: brightest at its middle line, falling off across; its ends soft (edges meet edges at the corners); a
  // little breath on the beat
  let across = exp(-i.uv.x * i.uv.x * 5.0);
  let along = i.uv.y * i.info.y;
  let fade = select(0.0, 0.05, i.info.y > 0.8);
  let ends = select(1.0, smoothstep(0.0, fade, along) * smoothstep(0.0, fade, i.info.y - along), fade > 0.0);
  let breath = 1.0 + look.beat.y * (pow(1.0 - look.beat.x, 3.0) - 0.25);
  // (walls a little fainter than the tops: the tops are where a body lands)
  let w = select(1.0, 0.7, k >= 2u);
  // under the tide a rim is drowned: a trace just under the surface, gone a hand's depth down (the glow is laid over
  // the water, so a drowned court's rims floated as gold lines over it: report 15, issue 5)
  let drowned = 1.0 - 0.85 * smoothstep(look.beat.w + 0.03, look.beat.w - 0.04, i.y) - 0.15 * smoothstep(look.beat.w - 0.04, look.beat.w - 0.2, i.y);
  if (drowned <= 0.002 || i.keep <= 0.002) { discard; }
  return vec4f(look.rim.rgb * look.rim.w * across * ends * breath * w * lock * drowned * i.keep, 0.0);

}

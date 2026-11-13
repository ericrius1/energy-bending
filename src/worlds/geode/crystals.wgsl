// The geode's crystal points (shelves.ts `points`): the druses the stage's shelves grow from, the clusters standing out
// from the wall, the rings round the gates. Each a six-sided prism (its faces a little uneven) rising from its root to a
// six-faced point, made from the vertex index. Clear and dark in the body (what shows is what its faces mirror: the
// studio and the wall's veins), lit from within toward its point in its own colour (the wall's vein where it grew, or
// its gate's world), its edges catching a line of that light, a glint where a face turns the softbox to the eye.
#include "weft/frame"
#include "../light"

struct Point {
  at: vec4f,     // its root; w: its turn about up
  size: vec4f,   // width, -, length; w: its tilt up from level
  look: vec4f,   // x: how long its point is, y: a seed, z: its tint (-1 selenite, 0 … 3 a gate's world, 4 the wall's veins), w: its glow
}

@group(1) @binding(0) var<storage, read> points: array<Point>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) face: vec2f,                     // x: across the face (0 … 1), y: along the crystal (0 root … 1 point)
  @location(2) @interpolate(flat) look: vec4f,  // the seed, the tint, the glow, -
  @location(3) @interpolate(flat) axis: vec3f,
}

/** corner k of the six round the crystal's axis (radius r, each a little in or out by the seed) */
fn ring(k: u32, r: f32, seed: f32) -> vec2f {
  let a = f32(k % 6u) * 1.0471976 + seed * 6.0;
  let rr = r * (0.82 + 0.36 * fract(sin(f32(k % 6u) * 12.9898 + seed * 78.233) * 43758.5453));
  return vec2f(cos(a), sin(a)) * rr;
}

fn toWorld(b: Point, q: vec3f) -> vec3f {
  let cp = cos(b.size.w);
  let sp = sin(b.size.w);
  let t = vec3f(q.x, q.y * cp + q.z * sp, -q.y * sp + q.z * cp);
  let cy = cos(b.at.w);
  let sy = sin(b.at.w);
  return b.at.xyz + vec3f(t.x * cy + t.z * sy, t.y, -t.x * sy + t.z * cy);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let b = points[ii];
  let r = b.size.x * 0.5;
  let len = b.size.z;
  let tip = min(b.look.x, len * 0.6);
  let seed = b.look.y;
  var q = vec3f(0.0);
  var face = vec2f(0.0);
  if (vi < 36u) {
    // the six sides, root to shoulder
    let k = vi / 6u;
    let cr = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi % 6u];
    let c = ring(k + u32(cr.x), r, seed);
    q = vec3f(c.x, c.y, cr.y * (len - tip));
    face = vec2f(cr.x, cr.y * (len - tip) / len);
  } else {
    // the point: six faces from the shoulder to the apex (a little off the axis)
    let j = vi - 36u;
    let k = j / 3u;
    let w = j % 3u;
    if (w == 2u) {
      q = vec3f((fract(seed * 7.1) - 0.5) * r * 0.4, (fract(seed * 3.3) - 0.5) * r * 0.4, len);
      face = vec2f(0.5, 1.0);
    } else {
      let c = ring(k + w, r, seed);
      q = vec3f(c.x, c.y, len - tip);
      face = vec2f(f32(w), (len - tip) / len);
    }
  }
  let wp = toWorld(b, q);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.face = face;
  o.look = vec4f(seed, b.look.z, b.look.w, 0.0);
  o.axis = normalize(toWorld(b, vec3f(0.0, 0.0, 1.0)) - b.at.xyz);
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  let L = worldLight.geode;
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  if (dot(N, V) < 0.0) { N = -N; }
  let seed = i.look.x;
  let along = i.face.y;
  // its colour: milky quartz, a gate's world, or the wall's vein where it grew
  var tc = vec3f(0.78, 0.76, 1.0);
  if (i.look.y > -0.5) { tc = geodeGateTint(i.look.y); }
  if (i.look.y > 3.5) { tc = geodeVein(i.wp - i.axis * along * 2.0); }
  let faceH = fract(sin(dot(floor(N * 6.0 + 0.5), vec3f(12.9898, 78.233, 37.719)) + seed * 17.0) * 43758.5453);
  let key = worldKey(i.wp, true, 0.0);
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.06 + 0.94 * pow(1.0 - cosV, 5.0);
  let R = reflect(-V, N);
  // the body: dark and clear, a little of the room's light on it, a lot of what it mirrors at a glance
  var col = tc * 0.03 * (geodeAmbient(N, 0.8) + key.col * max(dot(N, key.dir), 0.0)) * (0.6 + 0.8 * faceH);
  col += (studio(R) * 0.5 + geodeWallSoft(i.wp, R) * 1.5) * fres * (0.5 + 0.8 * faceH);
  col += tc * worldFire(i.wp, N) * 0.3;
  // the light inside: gathering toward the point, strongest seen through its length (edge on), breathing slowly
  let through = 0.3 + 0.7 * pow(1.0 - cosV, 1.5);
  let breathe = 0.8 + 0.2 * sin(frame.time * (0.3 + 0.4 * fract(seed * 5.0)) + seed * 40.0);
  let glow = (0.15 + i.look.z) * L.cave.w * breathe;
  col += tc * glow * (0.04 + 0.5 * along * along) * through;
  // its edges, a line of that light (brighter toward the point), and the point itself
  let edge = smoothstep(0.1, 0.0, min(i.face.x, 1.0 - i.face.x));
  col += tc * edge * glow * (0.1 + 0.6 * along);
  col += mix(tc, vec3f(1.0), 0.4) * smoothstep(0.9, 1.0, along) * glow * 0.8;
  // a glint where a face turns the softbox to the eye
  col += vec3f(1.0, 0.97, 0.92) * pow(max(dot(R, key.dir), 0.0), 200.0) * key.glint * 1.5 * step(0.55, faceH);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

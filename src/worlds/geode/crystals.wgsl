// The geode's crystal points (shelves.ts `points`): the druses the stage's shelves grow from, the clusters standing out
// from the wall, the rings round the gates. Each a six-sided prism (its faces a little uneven) rising from its root to a
// six-faced point, made from the vertex index. Clear and dark in the body (what shows is what its faces mirror: the
// studio and the wall's veins), lit from within toward its point in its own colour (the wall's vein where it grew, or
// its gate's world), its edges catching a line of that light, a glint where a face turns the softbox to the eye. Seen
// at a glance its faces split the light like a prism (a soft rainbow along the fresnel). Tint 5 is not a crystal: a
// brass-and-glass lantern hung under a shelf (phase 4's greenhouse), its six panes of warm light in a brass frame gone
// a little green, a brass cap and finial, made from the same prism (its point hanging down).
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
  if (i.look.y > 4.5) {
    // a lantern: brass at its cap (the root, up) and finial (the point), a brass frame round each pane, warm glass
    let key = worldKey(i.wp, false, 0.0);
    let brassC = vec3f(0.78, 0.56, 0.26);
    let frameEdge = smoothstep(0.16, 0.06, min(i.face.x, 1.0 - i.face.x));
    let cap = 1.0 - smoothstep(0.12, 0.16, along);
    let finial = smoothstep(0.66, 0.7, along);
    let metal = max(max(frameEdge, cap), finial);
    let R = reflect(-V, N);
    let flicker = 0.9 + 0.1 * sin(frame.time * 7.0 + seed * 50.0) * sin(frame.time * 3.1 + seed * 13.0);
    let glass = vec3f(1.0, 0.62, 0.26) * (0.7 + 0.5 * (1.0 - abs(along - 0.4) * 2.0)) * 0.75 * i.look.z * flicker;
    let brass = brassC * (geodeAmbient(N, 0.8) * 0.3 + key.col * max(dot(N, key.dir), 0.0) * 0.4 + studio(R) * 0.25)
      + mix(brassC, vec3f(0.35, 0.6, 0.45), 0.25 * vnoise(i.wp * 30.0)) * 0.15 * i.look.z * (1.0 - cap);
    return vec4f(sightLit(mix(glass, brass, metal)), dot(i.wp - frame.camPos, frame.camFwd));
  }
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
  // (phase 7, report 24: a crystal in the greenhouse is coloured glass in the sun, not a dark stone: the sun through
  // its body, deepest in its colour where it is seen through its length, and a little of the room's warm light inside)
  // (a gem's colour, a little deeper than the stone's vein it grew from, so honey calcite reads as citrine and not as wood)
  let gem = clamp(mix(vec3f(luma(tc)), tc, 1.5), vec3f(0.0), vec3f(1.2));
  let sunL = -geodeSunDir();
  let sunIn = (0.2 + 0.8 * max(-dot(N, sunL), 0.0)) * through * through;
  col += gem * gem * GEO_SUN * L.sun.w * sunIn * 0.12 * (0.4 + 0.6 * along);
  col += gem * smoothstep(0.12, 0.0, min(i.face.x, 1.0 - i.face.x)) * L.sun.w * 0.05 * (0.4 + 0.6 * along);
  // its edges, a line of that light (brighter toward the point), and the point itself
  let edge = smoothstep(0.1, 0.0, min(i.face.x, 1.0 - i.face.x));
  col += tc * edge * glow * (0.1 + 0.6 * along);
  col += mix(tc, vec3f(1.0), 0.4) * smoothstep(0.9, 1.0, along) * glow * 0.8;
  // a glint where a face turns the softbox to the eye
  col += vec3f(1.0, 0.97, 0.92) * pow(max(dot(R, key.dir), 0.0), 200.0) * key.glint * 1.5 * step(0.55, faceH);
  // a prism: at a glance its faces split the sun into a soft rainbow (the hue running with the angle)
  col += geodeSpectrum(fract(cosV * 2.2 + faceH * 0.35)) * fres * 0.18 * L.sun.w * (0.4 + 0.6 * along);
  return vec4f(sightLit(col), dot(i.wp - frame.camPos, frame.camFwd));
}

// What hangs in the redwoods' air (garden.ts lays it out): cloth pennants on strings slung between the ring's trees and
// along the duel's boughs, wind chimes at the boughs' tips, and the strings themselves. Each hangs from a point and
// moves in the air: a slow sway and a flutter, and with a gust (forest.near.xyz: its direction and strength, from the
// duel's wind) every pennant streams out along it. A pennant is a triangle of dyed cloth (sun gold, coral, leaf, teal,
// cream) with a paler border, the sun glowing through it from behind; a chime's tube bronze gone green; a string a thin
// cord sagging between its ends. Lit as the woods light everything (the sun through the leaves and past the trunks,
// the light under the trees, the lanterns). Opaque, its alpha the view distance. Not a solid: the near fade leaves it.
#include "weft/frame"
#include "../light"

struct Hang {
  at: vec4f,     // where it hangs from; w: its kind (0 a pennant, 2 a chime's tube, 3 a string)
  n: vec4f,      // xy: its face (outward, in xz); z: its length (m); w: its width (m)
  look: vec4f,   // x: seed, y: its colour (0 … 4), z, w: -
  b: vec4f,      // a string's far end; w: how far it sags in the middle (m)
}

@group(1) @binding(0) var<storage, read> hangs: array<Hang>;

override FIRST: u32 = 0u;
override SEG: u32 = 6u;

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) info: vec4f,     // kind, seed, colour, length
}

/** the air's push on something hanging at s of the way down it: the woods' own wind, and a gust along its direction
 *  (out along `face` and across it, m) */
fn airPush(s: f32, t: f32, seed: f32, face: vec2f, kind: f32) -> vec2f {
  let g = worldLight.forest.near;
  let gust = clamp(g.z, 0.0, 1.0);
  let wind = worldLight.forest.wind;
  let k = select(1.0, 0.4, kind > 1.5);
  let reach = pow(s, 1.3) * k;
  let calm = (sin(t * 1.3 + seed * 6.28 + s * 2.0) * 0.12 + sin(t * 3.1 + seed * 3.0 + s * 5.0) * 0.04) * (0.4 + wind);
  // a gust lifts it out along the wind's way (the part of it across the face swings, the part along it flutters)
  let along = dot(g.xy, face);
  let stream = gust * (0.55 + 0.15 * sin(t * 9.0 + seed * 20.0 + s * 8.0));
  return vec2f(calm + stream * along, (sin(t * 0.9 + seed * 9.0) * 0.06 * (0.4 + wind) + stream * dot(g.xy, vec2f(-face.y, face.x)) * 0.6)) * reach;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  let H = hangs[FIRST + ii];
  let seg = vi / 6u;
  let c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi % 6u];
  let s = (f32(seg) + c.y) / f32(SEG);
  let kind = H.at.w;
  let t = worldLight.forest.clock.x;
  let face = normalize(H.n.xy + vec2f(1e-5, 0.0));
  let nOut = vec3f(face.x, 0.0, face.y);
  let u = c.x * 2.0 - 1.0;
  var p = vec3f(0.0);
  var N = nOut;
  if (kind > 2.5) {
    // a string: along from one end to the other, sagging, swaying a little in the middle; its thin side to the eye
    let q = mix(H.at.xyz, H.b.xyz, s) - vec3f(0.0, 4.0 * H.b.w * s * (1.0 - s), 0.0);
    let w = airPush(1.0, t, H.look.x, face, 0.0) * 0.4 * 4.0 * s * (1.0 - s);
    let toEye = normalize(frame.camPos - q);
    let along = normalize(H.b.xyz - H.at.xyz);
    let side = normalize(cross(along, toEye) + vec3f(0.0, 1e-5, 0.0));
    p = q + nOut * w.x + side * u * 0.012;
    N = toEye;
  } else {
    var across = vec3f(-nOut.z, 0.0, nOut.x);
    if (kind > 1.5) {
      let toEye = frame.camPos - H.at.xyz;
      across = normalize(vec3f(-toEye.z, 0.0, toEye.x) + vec3f(1e-5, 0.0, 0.0));
      N = normalize(vec3f(across.z, 0.0, -across.x));
    }
    // (the world answering a moment streams the pennants out and swings the chimes: worlds/answer.wgsl, report 20)
    let w = airPush(s, t, H.look.x, face, kind) + vec2f(answerLift(1u, H.at.xyz) * s * H.n.z * select(0.9, 0.3, kind > 1.5), 0.0);
    // (a pennant narrows to its point; streamed out by a gust it lifts toward level)
    let width = select(H.n.w * (1.0 - s), H.n.w, kind > 1.5);
    let lift = length(w) / max(H.n.z, 1e-3);
    p = H.at.xyz - vec3f(0.0, s * H.n.z * (1.0 - 0.35 * min(lift, 1.0)), 0.0) + across * u * width * 0.5 + nOut * w.x + across * w.y;
    if (kind < 1.5) {
      let w2 = airPush(min(s + 0.1, 1.0), t, H.look.x, face, kind);
      N = normalize(nOut + vec3f(0.0, (w2.x - w.x) / max(0.1 * H.n.z, 1e-3), 0.0));
    }
  }
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.wp = p;
  o.n = N;
  o.uv = vec2f(u, s);
  o.info = vec4f(kind, H.look.x, H.look.y, H.n.z);
  return o;
}

/** a pennant's dye (0 … 4: sun gold, coral, leaf, teal, cream) */
fn dye(k: f32) -> vec3f {
  let i = u32(k + 0.5) % 5u;
  if (i == 0u) { return vec3f(0.95, 0.66, 0.18); }
  if (i == 1u) { return vec3f(0.92, 0.38, 0.3); }
  if (i == 2u) { return vec3f(0.4, 0.66, 0.22); }
  if (i == 3u) { return vec3f(0.16, 0.58, 0.6); }
  return vec3f(0.93, 0.87, 0.72);
}

@fragment fn fs(i: GOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let kind = i.info.x;
  var albedo = vec3f(0.5);
  var through = 0.0;
  var gloss = 0.0;
  if (kind < 1.5) {
    // a pennant: a paler border along its top and sides
    let base = dye(i.info.z);
    let edge = step(i.uv.y, 0.08) + step(0.8, abs(i.uv.x));
    albedo = mix(base, mix(base, vec3f(1.0, 0.96, 0.85), 0.55), min(edge, 1.0));
    through = 0.5;
  } else if (kind < 2.5) {
    albedo = mix(vec3f(0.5, 0.36, 0.18), vec3f(0.25, 0.55, 0.45), smoothstep(0.3, 0.7, vnoise2(vec2f(i.uv.x * 3.0, i.uv.y * 12.0 + i.info.y * 20.0))));
    albedo *= 0.75 + 0.5 * (1.0 - i.uv.x * i.uv.x);
    gloss = 0.8;
  } else {
    albedo = vec3f(0.42, 0.34, 0.22);
  }
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let p = i.wp;
  let L = worldLight.forest.key.xyz;
  let key = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(p) * 0.3;
  let diff = max(dot(N, L), 0.0);
  let back = max(-dot(N, L), 0.0) * through;
  var col = albedo * (key * (diff + back) + woodsAmbient(N) * 1.6 + lampLight(p, N, 0.3) * 0.5);
  let V = normalize(frame.camPos - p);
  col += key * pow(max(dot(reflect(-V, N), L), 0.0), 40.0) * gloss;
  return vec4f(col, dot(p - frame.camPos, frame.camFwd));
}

// The last step of the water surface, a fullscreen pass over the view's resolved scene (one pipeline per world: its
// light). Where the smoothed water is nearer than the scene (the scene's alpha is its view distance), it rebuilds the
// surface's position and normal from the smoothed depth and shades it as water: the scene behind refracted through
// it (bent by the normal, by how thick the water is, with a little dispersion), absorbed with thickness toward a deep
// blue and lit from within by the world's light, the world reflected by Fresnel, sharp glints of the key and rim
// lights, a cyan rim where it is thin, and foam where it is thin and fast. It writes the water's distance into
// alpha, so the air, the depth of field and the bloom treat it as part of the scene.
#include "weft/frame"
#include "weft/fullscreen"
#include "../../worlds/light"

struct Surf {
  absorb: vec4f,       // rgb: how fast each colour is absorbed (1/m); w: how much the splat's thickness counts
  deep: vec4f,         // rgb: the colour light takes deep in the water; w: how bright it is lit from within
  refract: f32,        // how far the scene behind is bent (uv per m of thickness)
  dispersion: f32,     // how far apart red and blue are bent
  glint: f32,          // the key and rim lights' sharp reflections
  foam: f32,           // how white the foam is
  edge: f32,           // thickness (m) over which the outline fades in
  frost: f32,          // how white freezing water turns
  reflect: f32,        // the world's reflection
  pad0: f32,
}

@group(1) @binding(0) var<uniform> surf: Surf;
@group(1) @binding(1) var scene: texture_2d<f32>;    // the view's scene, resolved (a copy: this pass writes over it)
@group(1) @binding(2) var water: texture_2d<f32>;    // the smoothed water: distance, thickness, foam, frost

/** the eye-to-point vector of a pixel of the water texture (uv of its centre) at view distance d */
fn atDist(uv: vec2f, d: f32) -> vec3f {
  let r = viewRay(uv);
  return r * (d / dot(r, frame.camFwd));
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let sdims = vec2i(textureDimensions(scene));
  let wdims = vec2i(textureDimensions(water));
  let px = vec2i(i.uv * vec2f(sdims));
  let q = clamp(vec2i(i.uv * vec2f(wdims)), vec2i(0), wdims - 1);
  let W = textureLoad(water, q, 0);
  let s = textureLoad(scene, px, 0);
  let thickness = W.y * surf.absorb.w;
  if (W.x <= 0.0 || thickness <= 1e-4) { discard; }
  // something solid in front of the water hides it
  if (s.a < W.x - 0.03) { discard; }

  // ---------------------------------------------------------------- the surface: where, and which way it faces
  let wduv = 1.0 / vec2f(wdims);
  let uv0 = (vec2f(q) + 0.5) * wduv;
  let P = atDist(uv0, W.x);
  var dx = vec3f(0.0);
  var dy = vec3f(0.0);
  // each way, the neighbour nearer in depth (so an edge doesn't bend the normal toward what's behind it)
  let xr = textureLoad(water, clamp(q + vec2i(1, 0), vec2i(0), wdims - 1), 0).x;
  let xl = textureLoad(water, clamp(q - vec2i(1, 0), vec2i(0), wdims - 1), 0).x;
  let yd = textureLoad(water, clamp(q + vec2i(0, 1), vec2i(0), wdims - 1), 0).x;
  let yu = textureLoad(water, clamp(q - vec2i(0, 1), vec2i(0), wdims - 1), 0).x;
  let useR = xr > 0.0 && (xl <= 0.0 || abs(xr - W.x) < abs(xl - W.x));
  let useD = yd > 0.0 && (yu <= 0.0 || abs(yd - W.x) < abs(yu - W.x));
  if (useR) { dx = atDist(uv0 + vec2f(wduv.x, 0.0), xr) - P; } else if (xl > 0.0) { dx = P - atDist(uv0 - vec2f(wduv.x, 0.0), xl); }
  if (useD) { dy = atDist(uv0 + vec2f(0.0, wduv.y), yd) - P; } else if (yu > 0.0) { dy = P - atDist(uv0 - vec2f(0.0, wduv.y), yu); }
  let ray = normalize(P);
  var N = -ray;
  if (dot(dx, dx) > 0.0 && dot(dy, dy) > 0.0) { N = normalize(cross(dy, dx)); }
  if (dot(N, ray) > 0.0) { N = -N; }
  let wp = frame.camPos + P;
  let V = -ray;

  // ---------------------------------------------------------------- the scene behind, refracted and absorbed
  let cosV = clamp(dot(N, V), 0.0, 1.0);
  let bend = vec2f(dot(N, frame.camRight), -dot(N, frame.camUp)) * surf.refract * min(thickness, 0.35) / max(W.x * 0.25, 0.4);
  var behind = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    let k = 1.0 + (f32(c) - 1.0) * surf.dispersion;
    var t = textureLoad(scene, clamp(vec2i((i.uv + bend * k) * vec2f(sdims)), vec2i(0), sdims - 1), 0);
    // what was bent in from in front of the water isn't behind it: take the straight view instead
    if (t.a < W.x) { t = s; }
    behind[c] = t[c];
  }
  let trans = exp(-surf.absorb.rgb * thickness);
  let key = worldKey(wp, true, 0.0);
  let lit = worldAmbient(N, 1.0, wp) + key.col * (0.35 + 0.65 * max(dot(N, key.dir), 0.0));
  let inside = surf.deep.rgb * lit * surf.deep.w;
  var col = behind * trans + inside * (1.0 - trans);

  // ---------------------------------------------------------------- the surface: reflection, glints, the thin rim
  let F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  let R = reflect(ray, N);
  let env = worldEnv(R, wp) * surf.reflect;
  col = mix(col, env, F);
  let rim = worldRim();
  let rimDir = normalize(vec3f(-0.75, 0.35, -0.55));
  col += (key.col * pow(max(dot(R, key.dir), 0.0), 400.0) * 60.0 * key.glint + rim.rgb * rim.w * pow(max(dot(R, rimDir), 0.0), 120.0) * 4.0) * surf.glint;
  // thin water is cyan where the light comes through it
  let thin = 1.0 - smoothstep(0.004, 0.05, thickness);
  col += vec3f(0.30, 0.80, 1.0) * thin * 0.12 * (0.3 + length(lit));

  // ---------------------------------------------------------------- foam and frost
  let foamy = clamp(W.z / max(W.y, 1e-5), 0.0, 1.0) * (1.0 - smoothstep(0.02, 0.2, thickness));
  let n = vnoise(wp * 140.0) * 0.6 + vnoise(wp * 37.0) * 0.4;
  let foam = smoothstep(0.45, 1.0, foamy * (0.6 + 0.8 * n)) * surf.foam;
  col = mix(col, vec3f(0.85, 0.93, 1.0) * (lit * 0.8 + 0.05), foam);
  let frosty = clamp(W.w / max(W.y, 1e-5), 0.0, 1.0);
  col = mix(col, vec3f(0.75, 0.88, 1.0) * (lit * 0.7 + 0.04) + key.col * pow(max(dot(R, key.dir), 0.0), 8.0) * 0.5, frosty * surf.frost * (0.5 + 0.5 * n));

  // the outline fades in over the first few millimetres, so the edge isn't one hard pixel
  let cover = smoothstep(0.0, surf.edge, thickness);
  return vec4f(mix(s.rgb, col, cover), select(s.a, W.x, cover > 0.5));
}

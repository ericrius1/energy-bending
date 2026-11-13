// Steam's draw: each puff a soft, billowing, camera-facing blob that grows as it rises and fades as it ages. It is
// pale and a little luminous of its own, lit by the world from above, warmed orange by the field's heat where it is
// (flame nearby lights it), and white-hot where steam is being made right there (the clash front). Premultiplied
// "over" blending into the scene colour; the scene's alpha (the view distance the air and the depth of field read)
// is left alone.
#include "weft/frame"
#include "../field/field"
#include "../../worlds/light"
#include "./steam"

@group(1) @binding(0) var<uniform> steam: Steam;
@group(1) @binding(1) var<storage, read> puffs: array<Puff>;

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) a: f32,
  @location(3) seed: vec2f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= steam.count) { return o; }
  let q = puffs[ii];
  if (q.age >= q.life) { return o; }
  let u = clamp(q.age / q.life, 0.0, 1.0);
  let size = mix(steam.sizeBirth, steam.sizeEnd, sqrt(u)) * (0.75 + 0.5 * rnd(ii * 7u + 1u));
  // a slow turn of each blob, so the noise inside it rolls
  let ang = rnd(ii * 13u + 5u) * 6.2831853 + q.age * (rnd(ii * 3u + 2u) - 0.5) * 1.2;
  let c = CORNERS[vi];
  let rc = vec2f(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  let wp = q.pos + (frame.camRight * rc.x + frame.camUp * rc.y) * size;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.seed = vec2f(rnd(ii * 11u + 3u), rnd(ii * 17u + 9u)) * 40.0;
  // light: the world's from above and its key, the steam's own soft glow, the field's heat, the clash where it is
  let up = worldAmbient(vec3f(0.0, 1.0, 0.0), 1.0, q.pos);
  let key = worldKey(q.pos, false, 0.0);
  let heat = fieldHeat(q.pos);
  let making = fieldSteam(q.pos);
  let pale = vec3f(0.80, 0.84, 0.88);
  var col = pale * (up * 0.55 + key.col * 0.45 + steam.glow);
  col += vec3f(1.0, 0.5, 0.2) * max(heat, 0.0) * steam.warmth * (1.0 - 0.5 * u);
  col += vec3f(1.0, 0.95, 0.9) * min(making, 2.0) * steam.glow * 1.5 * (1.0 - u);
  col += vec3f(0.25, 0.4, 0.6) * max(-heat, 0.0) * 0.3;
  o.col = col;
  o.a = steam.density * smoothstep(0.0, 0.12, u) * pow(1.0 - u, 1.6);
  return o;
}

@fragment fn fs(i: SOut) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  // three soft lobes at the puff's own offsets (cheaper than noise: steam's fill is the cost), so a puff is a lumpy
  // cauliflower rather than a disc and neighbouring puffs read as one billowing cloud
  let o1 = (fract(i.seed * 0.137) - 0.5) * 0.9;
  let o2 = (fract(i.seed.yx * 0.291) - 0.5) * 0.9;
  let o3 = -(o1 + o2) * 0.6;
  let l = exp(-dot(i.uv - o1, i.uv - o1) * 6.0) + exp(-dot(i.uv - o2, i.uv - o2) * 7.0) + exp(-dot(i.uv - o3, i.uv - o3) * 5.0);
  let a = i.a * (1.0 - r2) * min(l * 0.7, 1.0);
  return vec4f(i.col * a, a);
}

// Sparkles: camera-facing four-point stars, drawn additively over the gems. They twinkle and shrink as they die.
#include "weft/frame"
#include "./gem"

@group(1) @binding(0) var<uniform> look: Look;
@group(1) @binding(1) var<storage, read> sparks: array<Spark>;

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  let s = sparks[ii];
  if (s.life <= 0.0) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let t = clamp(s.life / max(s.col.w, 1e-3), 0.0, 1.0);
  let tw = 0.55 + 0.45 * sin(frame.time * 38.0 + f32(ii) * 1.7);
  let size = 0.022 * s.size * look.sparkSize * sqrt(t) * (0.6 + 0.6 * tw);
  let c = CORNERS[vi];
  let a = f32(ii) * 2.399;
  let rc = vec2f(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
  let wp = s.pos + (frame.camRight * rc.x + frame.camUp * rc.y) * size;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.col = s.col.rgb * look.sparkle * (0.4 + 0.6 * t) * tw;
  return o;
}

@fragment fn fs(i: SOut) -> @location(0) vec4f {
  let u = abs(i.uv);
  let r2 = dot(i.uv, i.uv);
  let core = exp(-r2 * 14.0) * 2.0;
  let star = exp(-u.x * 30.0) * pow(max(0.0, 1.0 - u.y), 3.0) + exp(-u.y * 30.0) * pow(max(0.0, 1.0 - u.x), 3.0);
  let k = core + star * 0.9;
  return vec4f(i.col * k, 0.0);
}

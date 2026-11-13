// The field made visible (?field, or fieldParams.overlay): every cell drawn as a soft dot coloured by what it holds
// (orange hot, blue cold, cyan wet, white where steam is being made), and every other cell's wind as a streak from
// the cell along where the air is going (a quarter second of travel), bright as it is fast. Additive, in the glow
// phase, depth-tested against the scene so it sits among the dancers.
#include "weft/frame"
#include "./field"

/** the wind streaks' stride (every n-th cell), brightness, the streaks' length in seconds of travel */
struct FieldDebug { stride: u32, gain: f32, streak: f32, pad: f32 }
@group(1) @binding(0) var<uniform> look: FieldDebug;

/** 0: the cells' contents as dots; 1: the wind as streaks */
override MODE: u32 = 0u;

struct DOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DOut {
  var o: DOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let st = select(1u, max(look.stride, 1u), MODE == 1u);
  let n = (vec3u(fieldBox.dims) + st - 1u) / st;
  let cid = vec3u(ii % n.x, (ii / n.x) % n.y, ii / (n.x * n.y)) * st;
  if (any(cid >= vec3u(fieldBox.dims)) || fieldBox.on < 0.5) { return o; }
  let a = textureLoad(fieldA, cid, 0);
  let b = textureLoad(fieldB, cid, 0);
  let p = fieldBox.origin + (vec3f(cid) + 0.5) * fieldBox.cell;
  let c = CORNERS[vi];
  o.uv = c;
  if (MODE == 0u) {
    let col = vec3f(1.0, 0.42, 0.08) * b.x + vec3f(0.2, 0.45, 1.0) * b.y + vec3f(0.05, 0.8, 0.75) * a.w + vec3f(1.0) * b.z * 0.5;
    let amount = b.x + b.y + a.w + b.z;
    if (amount < 0.03) { return o; }
    let size = fieldBox.cell * 0.22 * clamp(0.5 + amount, 0.5, 1.5);
    let wp = p + (frame.camRight * c.x + frame.camUp * c.y) * size;
    o.pos = frame.viewProj * vec4f(wp, 1.0);
    o.col = col * look.gain * 0.35;
    return o;
  }
  // a streak along the wind: a thin quad from p to where the air will be in look.streak seconds
  let w = a.xyz;
  let speed = length(w);
  if (speed < 0.05) { return o; }
  let e = p + w * look.streak;
  let along = select(p, e, c.x > 0.0);
  let side = normalize(cross(e - p, frame.camPos - along) + vec3f(0.0, 1e-5, 0.0));
  let wp = along + side * c.y * fieldBox.cell * 0.035;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  // white for moving air, tinted by what it carries
  o.col = (vec3f(0.55, 0.6, 0.65) + vec3f(1.0, 0.4, 0.1) * b.x + vec3f(0.1, 0.8, 0.8) * a.w) * clamp(speed * 0.5, 0.0, 2.0) * look.gain * (0.35 + 0.65 * (c.x * 0.5 + 0.5));
  o.uv = vec2f(0.0, c.y);
  return o;
}

@fragment fn fs(i: DOut) -> @location(0) vec4f {
  if (MODE == 0u) {
    let k = exp(-dot(i.uv, i.uv) * 3.0);
    return vec4f(i.col * k, 0.0);
  }
  return vec4f(i.col * (1.0 - abs(i.uv.y)), 0.0);
}

// The motes drawn (mist.wgsl says what they are): additive camera-facing sprites in the glow phase.
#include "weft/frame"
#include "./mist"

@group(1) @binding(0) var<uniform> mist: Mist;
@group(1) @binding(1) var<storage, read> motes: array<Mote>;

struct MOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) @interpolate(flat) kind: f32,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MOut {
  var o: MOut;
  let m = motes[ii];
  if (m.life <= 0.0) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let age = 1.0 - m.life / max(m.span, 1e-3);
  let c = CORNERS[vi];
  var size: f32;
  if (isMist(ii)) {
    // a puff grows as it ages and fades in and out
    size = mist.mistSize * (0.4 + 1.6 * age);
    o.col = vec3f(0.24, 0.36, 0.50) * mist.mist * 0.00245 * smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.6, 1.0, age));
    o.kind = 0.0;
  } else {
    size = mist.dustSize * (0.5 + rnd(ii) * 1.2);
    let sparkle = 0.32 + 2.2 * pow(0.5 + 0.5 * sin(rnd(ii ^ 9u) * 211.0 + mist.time * 53.0 * (0.5 + rnd(ii ^ 7u))), 14.0);
    o.col = vec3f(0.68, 0.86, 1.0) * sparkle * mist.dust * 0.5 * (1.0 - smoothstep(0.7, 1.0, age)) * smoothstep(0.0, 0.1, age);
    o.kind = 1.0;
  }
  let wp = m.pos + (frame.camRight * c.x + frame.camUp * c.y) * size;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  return o;
}

@fragment fn fs(i: MOut) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  // mist: a soft round puff; dust: a sharp point (falloff squared)
  let f = select(pow(1.0 - r2, 2.0), pow(max(1.0 - sqrt(r2), 0.0), 4.0), i.kind > 0.5);
  return vec4f(i.col * f, 0.0);
}

// Embers rising out of the fire below, past the slabs and away into the dark: procedural (no buffer), each knowing
// where it is from its index and the time, curling as they rise, flickering, dimming as they cool. Additive.
#include "weft/frame"
#include "../light"

struct EOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EOut {
  var o: EOut;
  let h = rnd3(ii * 9u + 3u);
  let t = forge.heat.y;
  // a column of rising air twenty metres across round the stage, from far below to well above
  let speed = 0.6 + 1.4 * h.y;
  let span = 46.0;
  let life = fract(h.z + t * speed / span);
  let y = -30.0 + life * span;
  let a = h.x * 6.2831853;
  let r = 3.0 + 16.0 * sqrt(rnd(ii * 5u + 1u));
  let curl = vec3f(sin(t * 0.7 + h.x * 30.0 + y * 0.3), 0.0, cos(t * 0.6 + h.y * 20.0 + y * 0.25)) * (0.6 + life);
  let centre = vec3f(cos(a) * r, y, sin(a) * r) + curl;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let size = 0.018 + 0.03 * h.y;
  o.pos = frame.viewProj * vec4f(centre + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  o.uv = c;
  // white-yellow when it leaves the fire, deep red as it cools, gone by the top
  let cool = smoothstep(0.0, 1.0, life);
  let flick = 0.6 + 0.4 * sin(t * (6.0 + 9.0 * h.z) + h.x * 50.0);
  o.col = mix(vec3f(1.0, 0.75, 0.35), vec3f(0.9, 0.18, 0.04), cool) * (1.0 - cool * cool) * flick * forge.seam.w * 0.5;
  return o;
}

@fragment fn fs(i: EOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.0);
  return vec4f(i.col * k, 0.0);
}

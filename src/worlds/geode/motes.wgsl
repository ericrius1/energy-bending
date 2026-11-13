// Dust in the light: motes drifting down through the shaft from above, slow, twinkling. Procedural (no buffer): each
// knows where it is from its index and the time. Additive; out of focus they open into soft discs.
#include "weft/frame"
#include "../light"

struct MOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) bright: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MOut {
  var o: MOut;
  let h = rnd3(ii * 7u + 1u);
  let top = geode.shaftCol.w;
  let fall = 0.012 + 0.03 * h.x;
  let y = top * fract(h.z - frame.time * fall / top * 3.0);
  let up = y / top;
  let rad = geode.shaft.z * mix(1.0, 0.45, up) * sqrt(h.y) * 1.1;
  let a = h.x * 6.2831853 + sin(frame.time * 0.11 + h.z * 9.0) * 0.4;
  let wob = vec3f(sin(frame.time * 0.37 + h.y * 17.0), 0.0, cos(frame.time * 0.29 + h.x * 13.0)) * 0.08;
  let centre = vec3f(geode.shaft.x + cos(a) * rad, y, geode.shaft.y + sin(a) * rad) + wob;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let size = geode.moteSize * (0.5 + h.y);
  o.pos = frame.viewProj * vec4f(centre + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  o.uv = c;
  // lit only inside the light, faint at the edge of it, twinkling as they turn
  let edge = smoothstep(1.0, 0.3, length(centre.xz - geode.shaft.xy) / (geode.shaft.z * mix(1.0, 0.45, up)));
  o.bright = geode.shaft.w * edge * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(frame.time * (1.0 + 3.0 * h.z) + h.x * 40.0), 4.0));
  return o;
}

@fragment fn fs(i: MOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.5);
  return vec4f(vec3f(1.0, 0.95, 0.88) * i.bright * k * 0.12, 0.0);
}

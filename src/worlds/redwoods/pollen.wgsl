// Pollen and dust adrift over the clearing on the wind, rising and sinking slowly, lit only where the sun gets
// through to them (in its rays). Procedural, additive.
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
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let ring = light.forest.clock.w;
  let t = light.forest.clock.x;
  let w = windAt(vec2f(0.0), t) * 6.0;
  let span = vec3f(ring * 1.4, 9.0, ring * 1.4);
  let home = (h - vec3f(0.5, 0.0, 0.5)) * span + vec3f(w.x * t * 0.15, 0.4 + sin(t * 0.05 + h.x * 20.0) * 0.6, w.y * t * 0.15);
  let p = vec3f(fract(home.x / span.x + 0.5) - 0.5, 0.0, fract(home.z / span.z + 0.5) - 0.5) * span + vec3f(0.0, fract(home.y / span.y) * span.y + 0.2, 0.0)
    + vec3f(sin(t * 0.37 + h.y * 17.0), sin(t * 0.23 + h.z * 11.0) * 0.5, cos(t * 0.29 + h.x * 13.0)) * 0.12;
  let size = light.forest.march.y * (0.6 + h.y) * 1.3;
  o.pos = frame.viewProj * vec4f(p + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  o.uv = c;
  let glint = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * (1.0 + 3.0 * h.z) + h.x * 40.0), 3.0);
  o.bright = light.forest.key.w * keyLight(p) * (1.0 - light.forest.night) * glint * 0.5;
  return o;
}

@fragment fn fs(i: MOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.5);
  return vec4f(vec3f(1.0, 0.95, 0.88) * i.bright * k * 0.12, 0.0);
}

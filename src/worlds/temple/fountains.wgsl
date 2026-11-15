// The Tide Temple's fountains: jets of clean water rising from the channels' corners (backdrop.wgsl templeChannel) and
// falling back in arcs, each droplet a soft point catching the sun and the sky; and the spray where they land. In the
// glow pass, additive (never the opaque distance). Procedural: every droplet is a function of its index and the time.
#include "weft/frame"
#include "../light"

/** droplets a jet throws */
override PER: u32 = 160u;

/** the jets: x, z, how high they rise (m), how far they lean toward the court's middle */
const JETS = array<vec4f, 4>(vec4f(-10.3, 7.4, 2.4, 0.5), vec4f(10.3, 7.4, 2.4, 0.5), vec4f(-10.3, -8.5, 2.9, 0.4), vec4f(10.3, -8.5, 2.9, 0.4));

struct JOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) bright: vec3f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> JOut {
  var o: JOut;
  let J = JETS[(ii / PER) % 4u];
  let h = rnd3(ii * 13u + 5u);
  let g = 9.8;
  let vy = sqrt(2.0 * g * J.z) * (0.9 + 0.12 * h.x);
  let life = 2.0 * vy / g;
  let t = worldLight.temple.fire.y;
  let age = fract(t / life + h.y) * life;
  // up and out in a narrow plume, leaning toward the middle; a little wind
  let toMid = normalize(-vec2f(J.x, J.y * 0.3));
  let a = h.z * 6.2831853;
  let spread = vec2f(cos(a), sin(a)) * (0.12 + 0.18 * h.x) + toMid * J.w;
  let base = vec3f(J.x, -0.02, J.y);
  let p = base + vec3f(spread.x * age, vy * age - 0.5 * g * age * age, spread.y * age) + vec3f(worldLight.temple.water.w * age * 2.0, 0.0, 0.0);
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let size = 0.018 + 0.02 * h.x;
  // (stretched along its flight: a streak, not a dot)
  let vel = vec3f(spread.x, vy - g * age, spread.y);
  let sv = normalize(vel - frame.camFwd * dot(vel, frame.camFwd) + vec3f(0.0, 1e-4, 0.0));
  let sx = normalize(cross(sv, frame.camFwd));
  o.pos = frame.viewProj * vec4f(p + sx * c.x * size + sv * c.y * size * 2.5, 1.0);
  o.uv = c;
  let up = vec3f(0.0, 1.0, 0.0);
  let sun = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w * templeShadow(p);
  // (a droplet glints where the sun is near the line to the eye, softly lit by the sky everywhere)
  let V = normalize(frame.camPos - p);
  let glint = pow(max(dot(normalize(V + worldLight.temple.moon.xyz), V), 0.0), 8.0);
  o.bright = (sun * (0.12 + 0.5 * glint) + templeAmbient(up, 1.0, p, 0.0) * 0.18) * smoothstep(0.0, 0.05, age) * select(1.0, 0.0, p.y < -0.05);
  return o;
}

@fragment fn fs(i: JOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.0);
  return vec4f(i.bright * k * vec3f(0.85, 0.97, 1.0), 0.0);
}

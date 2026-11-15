// Pollen and dust adrift over the clearing on the wind, rising and sinking slowly, lit only where the sun gets
// through to them (in its rays); and the dust a landing kicks up (vs_kick). Procedural, additive.
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
  let ring = worldLight.forest.clock.w;
  let t = worldLight.forest.clock.x;
  let w = windAt(vec2f(0.0), t) * 6.0;
  let span = vec3f(ring * 1.4, 9.0, ring * 1.4);
  let home = (h - vec3f(0.5, 0.0, 0.5)) * span + vec3f(w.x * t * 0.15, 0.4 + sin(t * 0.05 + h.x * 20.0) * 0.6, w.y * t * 0.15);
  let p = vec3f(fract(home.x / span.x + 0.5) - 0.5, 0.0, fract(home.z / span.z + 0.5) - 0.5) * span + vec3f(0.0, fract(home.y / span.y) * span.y + 0.2, 0.0)
    + vec3f(sin(t * 0.37 + h.y * 17.0), sin(t * 0.23 + h.z * 11.0) * 0.5, cos(t * 0.29 + h.x * 13.0)) * 0.12;
  let size = worldLight.forest.march.y * (0.6 + h.y) * 1.3;
  o.pos = frame.viewProj * vec4f(p + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  o.uv = c;
  let glint = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * (1.0 + 3.0 * h.z) + h.x * 40.0), 3.0);
  // (the world answering a moment lights the pollen where its wave has passed, sun or no: report 20)
  o.bright = worldLight.forest.key.w * keyLight(p) * (1.0 - worldLight.forest.night) * glint * 0.5 + answerReach(1u, p) * glint * 4.0;
  return o;
}

@fragment fn fs(i: MOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.5);
  return vec4f(vec3f(1.0, 0.95, 0.88) * i.bright * k * 0.12, 0.0);
}

// ---------------------------------------------------------------- dust kicked up by a landing

override KICK: u32 = 40u;   // motes a landing throws

/** a dancer's landing throws a puff of dust and bits of needle out low over the ground round its feet: each mote flies
 *  out and up, slows in the air and settles, catching the light it passes through (the sun's shafts, the lanterns, the
 *  fire) and fading in about a second. Where and when each dancer last landed is in the light (forest.kicks) */
@vertex fn vs_kick(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MOut {
  var o: MOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let kick = worldLight.forest.kicks[ii / KICK];
  let age = worldLight.forest.clock.x - kick.w;
  let h = rnd3(ii * 11u + 17u);
  let life = 0.7 + 0.8 * h.z;
  if (age < 0.0 || age > life) { return o; }
  // out along the ground and up, slowed by the air (the drag's closed form), and down under its weight
  let a = h.x * 6.2831853;
  let v = vec3f(cos(a) * (0.6 + 1.6 * h.y), 0.5 + 1.4 * h.z * h.z, sin(a) * (0.6 + 1.6 * h.y));
  let k = 3.2;
  let drift = (1.0 - exp(-k * age)) / k;
  let fall = (age - drift) / k * 2.2;
  let p = kick.xyz + vec3f(cos(a), 0.0, sin(a)) * 0.12 + v * drift - vec3f(0.0, fall, 0.0) + vec3f(0.0, 0.03, 0.0);
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let size = 0.008 + 0.02 * h.y * h.y;
  o.pos = frame.viewProj * vec4f(p + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  o.uv = c;
  let up = vec3f(0.0, 1.0, 0.0);
  let lit = worldLight.forest.key.w * keyLight(p) * 0.25 + luma(woodsAmbient(up)) * 2.0 + luma(lampLight(p, up, 1.0)) * 0.6;
  o.bright = lit * smoothstep(life, life * 0.4, age) * smoothstep(0.0, 0.05, age) * 6.0;
  return o;
}

// The lights of the wood. Paper lanterns (vs, fs): round, ribbed with bamboo, hanging on cords from the low limbs
// (forest.ts swings them and lights them one by one as the sun goes down), glowing through the paper brightest where you
// look through it at the flame; by day just paper in the light. Their cords (vs_cord). And fireflies (vs_fly, fs_fly)
// once it's dark: warm sparks drifting low over the meadow, each flashing on its own rhythm.
#include "weft/frame"
#include "../light"

override AROUND: u32 = 18u;
override DOWN: u32 = 12u;


struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) lat: f32,     // 0 at the top of the lantern … 1 at the bottom
  @location(3) @interpolate(flat) k: u32,
}

/** the lantern's paper: the latitude (0 top … 1 bottom) its rim and ribs fall at, as a radius and height (× its radius) */
fn shapeAt(lat: f32) -> vec2f {
  // the paper runs between a ring at the top and one at the bottom; between them it bulges out round, with ribs
  let th = mix(0.2, 0.86, lat) * 3.14159265;
  let rib = 1.0 - 0.03 * pow(abs(cos(lat * 3.14159265 * 7.0)), 10.0);
  return vec2f(sin(th) * rib, cos(th) * 1.08);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let a = f32(quad % AROUND + c.x) / f32(AROUND) * 6.2831853;
  let lat = f32(quad / AROUND + c.y) / f32(DOWN);
  let l = worldLight.forest.lamps[ii];
  let anchor = worldLight.forest.anchors[ii];
  let up = normalize(anchor.xyz - l.xyz);
  let e1 = normalize(cross(up, vec3f(0.0, 0.0, 1.0)));
  let e2 = cross(up, e1);
  let sh = shapeAt(lat);
  let radial = e1 * cos(a) + e2 * sin(a);
  let wp = l.xyz + (radial * sh.x + up * sh.y) * anchor.w;
  o.wp = wp;
  o.n = normalize(radial * sh.x + up * sh.y * 0.9);
  o.lat = lat;
  o.k = ii;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs(i: LOut) -> @location(0) vec4f {
  let V = normalize(frame.camPos - i.wp);
  let N = normalize(i.n);
  let l = worldLight.forest.lamps[i.k];
  let h = rnd3(i.k * 9u + 2u);
  // each its own paper: cream, warm white, amber, a pale rose
  let paper = array<vec3f, 4>(vec3f(1.0, 0.86, 0.66), vec3f(1.0, 0.93, 0.82), vec3f(1.0, 0.68, 0.38), vec3f(1.0, 0.74, 0.66))[u32(h.x * 3.99)];
  // the bamboo ribs show as fine dark rings, the paper's fibres as a faint mottle, the wire rings top and bottom
  let rib = 1.0 - 0.55 * pow(abs(cos(i.lat * 3.14159265 * 7.0)), 18.0);
  let fibres = 0.9 + 0.2 * vnoise(i.wp * 140.0);
  let rim = smoothstep(0.035, 0.0, i.lat) + smoothstep(0.965, 1.0, i.lat);
  // lit from inside: brightest looking through the paper at the flame, dimmer at its edge (more paper to go through)
  let through = 0.4 + 0.6 * pow(max(dot(N, V), 0.0), 0.7);
  var c = paper * worldLight.forest.lampCol.rgb * l.w * 1.4 * through * rib * fibres;
  // and from outside: paper in the daylight (thin: the sun glows through it from behind too)
  let L = worldLight.forest.key.xyz;
  let ndl = dot(N, L);
  let sky = mix(vec3f(luma(woodsAmbient(N))), woodsAmbient(N), 0.4) * 3.0;
  c += paper * 0.6 * (worldLight.forest.keyCol.rgb * worldLight.forest.key.w * (max(ndl, 0.0) + 0.5 * max(-ndl, 0.0)) * leafLight(i.wp) + sky) * rib * fibres;
  c = mix(c, vec3f(0.02, 0.018, 0.016) * (1.0 + worldLight.forest.key.w * 0.1), rim);
  return vec4f(c, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- the cords

struct COut { @builtin(position) pos: vec4f, @location(0) wp: vec3f }

@vertex fn vs_cord(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> COut {
  var o: COut;
  let l = worldLight.forest.lamps[ii];
  let anchor = worldLight.forest.anchors[ii];
  let up = normalize(anchor.xyz - l.xyz);
  let top = l.xyz + up * anchor.w * 1.08 * cos(0.2 * 3.14159265);
  let c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi];
  let p = mix(top, anchor.xyz, c.y);
  let across = normalize(cross(up, frame.camPos - p) + vec3f(1e-5, 0.0, 0.0));
  o.wp = p + across * (c.x - 0.5) * 0.008;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

@fragment fn fs_cord(i: COut) -> @location(0) vec4f {
  let c = vec3f(0.03, 0.025, 0.02) * (woodsAmbient(vec3f(0.0, 1.0, 0.0)) * 2.0 + worldLight.forest.keyCol.rgb * worldLight.forest.key.w * 0.15 + lampLight(i.wp, vec3f(0.0, -1.0, 0.0), 1.0) * 0.6);
  return vec4f(c, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- fireflies

struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) bright: f32,
}

@vertex fn vs_fly(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  var o: FOut;
  let h = rnd3(ii * 7u + 1u);
  let h2 = rnd3(ii * 13u + 5u);
  let t = worldLight.forest.clock.x;
  // a home over the meadow (most low among the flowers), and a slow wander round it
  let r = 1.2 + (worldLight.forest.clock.w - 1.5) * sqrt(h.x);
  let a = h.y * 6.2831853;
  let home = vec3f(cos(a) * r, 0.12 + 2.4 * h.z * h.z, sin(a) * r);
  let p = home + vec3f(sin(t * 0.21 + h.x * 40.0) * 0.9 + sin(t * 0.53 + h2.x * 20.0) * 0.25,
                       sin(t * 0.33 + h.y * 30.0) * 0.3,
                       cos(t * 0.17 + h.z * 50.0) * 0.9 + cos(t * 0.47 + h2.y * 20.0) * 0.25);
  // a flash every few seconds: up quickly, a slower fade
  let period = 2.4 + 3.6 * h2.z;
  let ph = fract(t / period + h2.x);
  let flash = smoothstep(0.0, 0.035, ph) * (1.0 - smoothstep(0.05, 0.16, ph));
  o.bright = worldLight.forest.night * (flash + 0.04);
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  o.uv = c;
  let size = 0.035 + 0.02 * h2.y;
  o.pos = select(frame.viewProj * vec4f(p + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0), vec4f(2.0, 2.0, 2.0, 1.0), o.bright <= 0.0);
  return o;
}

@fragment fn fs_fly(i: FOut) -> @location(0) vec4f {
  let d = dot(i.uv, i.uv);
  let k = exp(-d * 28.0) * 1.0 + exp(-d * 4.0) * 0.12;
  return vec4f(vec3f(1.0, 0.82, 0.3) * i.bright * k * 9.0, 0.0);
}

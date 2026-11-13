// The geode's crystal shelves (shelves.ts): blades of selenite grown out of the wall, each a long prism of eight faces
// (a flat top, its long edges bevelled) running from its root in the wall to a chisel tip, made from the vertex index.
// Faceted (the normal is each face's own), milky and fibrous along their length: a satin sheen across the fibres, the
// studio and the light from above in their faces, the cave's glow inside them, darker where they leave the wall.
#include "weft/frame"
#include "../light"

struct Blade {
  at: vec4f,     // where its top's middle leaves the wall; w: its turn about up
  size: vec4f,   // width, thickness, length; w: its tilt up from level
  look: vec4f,   // x: how long its chisel tip is, y: a seed
}

@group(1) @binding(0) var<storage, read> blades: array<Blade>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) local: vec3f,
  @location(2) @interpolate(flat) axis: vec3f,
  @location(3) @interpolate(flat) seed: f32,
}

const SECTIONS: u32 = 6u;

/** the cross-section's corners (top at 0, flat; long edges bevelled), for width w, thickness t, bevel c */
fn corner(k: u32, w: f32, t: f32) -> vec2f {
  let c = min(0.05, w * 0.12);
  let h = w * 0.5;
  switch (k % 8u) {
    case 0u: { return vec2f(-h + c, 0.0); }
    case 1u: { return vec2f(h - c, 0.0); }
    case 2u: { return vec2f(h, -c); }
    case 3u: { return vec2f(h, -t + c); }
    case 4u: { return vec2f(h - c, -t); }
    case 5u: { return vec2f(-h + c, -t); }
    case 6u: { return vec2f(-h, -t + c); }
    default: { return vec2f(-h, -c); }
  }
}

/** a point of a blade: corner k of section j (the bottom rises into a chisel over the tip; the top stays flat) */
fn bladePoint(b: Blade, k: u32, j: u32) -> vec3f {
  let len = b.size.z;
  let tip = min(b.look.x, len * 0.5);
  var z = 0.0;
  if (j < SECTIONS - 2u) { z = (len - tip) * f32(j) / f32(SECTIONS - 2u); }
  else { z = len - tip + tip * f32(j - (SECTIONS - 2u)) / 2.0; }
  var c = corner(k, b.size.x, b.size.y);
  let into = clamp((z - (len - tip)) / max(tip, 1e-3), 0.0, 1.0);
  c.y = mix(c.y, 0.0, into * 0.88);
  return vec3f(c.x, c.y, z);
}

fn toWorld(b: Blade, q: vec3f) -> vec3f {
  let cp = cos(b.size.w);
  let sp = sin(b.size.w);
  // tilt up about the blade's own x, then turn about up
  let t = vec3f(q.x, q.y * cp + q.z * sp, -q.y * sp + q.z * cp);
  let cy = cos(b.at.w);
  let sy = sin(b.at.w);
  return b.at.xyz + vec3f(t.x * cy + t.z * sy, t.y, -t.x * sy + t.z * cy);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let b = blades[ii];
  var q = vec3f(0.0);
  let sides = 8u * SECTIONS * 6u;
  if (vi < sides) {
    let quad = vi / 6u;
    let cr = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
    q = bladePoint(b, quad % 8u + cr.x, quad / 8u + cr.y);
  } else {
    // the two ends, each a fan from its middle
    let e = vi - sides;
    let end = e / 24u;
    let k = (e % 24u) / 3u;
    let w = e % 3u;
    let j = select(0u, SECTIONS, end == 1u);
    if (w == 0u) { q = 0.5 * (bladePoint(b, 0u, j) + bladePoint(b, 4u, j)); }
    else { q = bladePoint(b, k + w - 1u, j); }
  }
  let wp = toWorld(b, q);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.local = q;
  o.axis = normalize(toWorld(b, vec3f(0.0, 0.0, 1.0)) - b.at.xyz);
  o.seed = b.look.y;
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  if (dot(N, V) < 0.0) { N = -N; }
  let T = i.axis;
  // the fibres: fine streaks along the blade, a few cloudier bands
  // (fine across the blade, long along it: streaks down its faces, a speckle on its ends)
  let fib = 0.35 + 0.3 * vnoise(vec3f(i.local.x * 22.0, i.local.y * 22.0, i.local.z * 0.35 + i.seed * 20.0)) + 0.35 * vnoise(vec3f(i.local.x * 7.0, i.local.y * 7.0, i.local.z * 0.15 + i.seed * 9.0));
  let cloud = vnoise(vec3f(i.local.x * 3.0, i.local.y * 3.0, i.local.z * 0.8 + i.seed * 7.0));
  let body = mix(vec3f(0.78, 0.72, 0.62), vec3f(0.92, 0.84, 0.74), fib) * (0.75 + 0.35 * cloud);
  let key = worldKey(i.wp, true, 0.0);
  let L = key.dir;
  let diff = max(dot(N, L), 0.0);
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.05 + 0.95 * pow(1.0 - cosV, 5.0);
  let R = reflect(-V, N);
  // where it leaves the wall it's in the dark; out over the stage it's in the light
  let out = smoothstep(0.0, 1.8, i.local.z);
  // little lit on its faces (it's clear stone, not paint): most of what shows is what it reflects and what glows in it
  var col = body * (key.col * diff * 0.12 + geodeAmbient(N, 0.6 + 0.4 * out) * 0.12) * (0.35 + 0.65 * out);
  // the dancers' fire on the selenite (worlds/light.wgsl worldFire)
  col += body * worldFire(i.wp, N) * 0.5;
  // the satin sheen across the fibres (anisotropic: brightest where the half-way vector is across them)
  let H = normalize(L + V);
  let th = dot(T, H);
  col += key.col * pow(sqrt(max(1.0 - th * th, 0.0)), 90.0) * 0.25 * (0.5 + 0.5 * fib) * out;
  col += studio(R) * fres * 0.9;
  // the cave's glow inside it, brightest where it's seen edge on (a long way through it) and along its fibres to the
  // tip, and the light from above caught in it
  let through = 0.25 + 0.75 * pow(1.0 - cosV, 2.0);
  col += geode.cave.rgb * geode.cave.w * mix(body, vec3f(1.0), 0.3) * through * (0.35 + 0.65 * cloud) * (0.25 + 0.75 * smoothstep(0.0, 1.0, i.local.z / 3.0)) * 0.8;
  col += key.col * body * 0.05 * (0.5 + fib) * out;
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

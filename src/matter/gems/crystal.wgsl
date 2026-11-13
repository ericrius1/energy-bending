// The large crystals (crystals.ts): one instance per crystal, its shape's vertices (shapes.ts) scaled to its capsule,
// placed where its bone and spring put it. Shaded with the stones' materials, the crystal pushed further: light
// refracts in with more dispersion than a small stone's, bounces twice off the far facets, and is tinted by how far
// it travelled inside (Beer's law over the crystal's depth); a glow from its core, and a heart's glow in the geode's
// hollow. One pipeline per world, and one mirrored under a mirroring floor. Drawn where this view sees its dancer.
#include "weft/frame"
#include "./gem"
#include "../../worlds/light"
#include "../../engine/seen"
#include "./hearts"

override MIRROR: f32 = 0.0;

/** one crystal: pos (xyz, grown 0 … 1), rot, size (half extents, dancer), look (mineral, heart glow, flash, shape) */
struct Crystal { pos: vec4f, rot: vec4f, size: vec4f, look: vec4f }
struct Crystals { c: array<Crystal, MAX_DANCERS * 16u> }

@group(1) @binding(0) var<uniform> crystals: Crystals;
@group(1) @binding(1) var<uniform> look: Look;
@group(1) @binding(2) var<uniform> minerals: Minerals;
@group(1) @binding(3) var<storage, read> verts: array<vec4f>;
@group(1) @binding(4) var<uniform> seen: ViewSeen;
@group(1) @binding(5) var<uniform> hearts: Hearts;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec3f,
  @location(3) ao: f32,
  @location(4) @interpolate(flat) rot: vec4f,
  @location(5) @interpolate(flat) kind: u32,
  @location(6) @interpolate(flat) mat: u32,
  @location(7) @interpolate(flat) facet: f32,
  @location(8) @interpolate(flat) glow: f32,
  @location(9) @interpolate(flat) flash: f32,
  @location(10) clip: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let c = crystals.c[ii];
  if (c.pos.w <= 0.0) { return o; }
  // the floor mirrors only what's near it (decided for the whole crystal: a triangle cut part way would streak)
  if (MIRROR > 0.5 && c.pos.y - max(c.size.x, max(c.size.y, c.size.z)) > 0.9) { return o; }
  let a = verts[vi * 2u];
  let b = verts[vi * 2u + 1u];
  let sd = seen.d[min(u32(c.size.w), MAX_DANCERS - 1u)];
  let s = c.size.xyz * c.pos.w * seen.grow;
  let rot = seenRot(sd, c.rot);
  var wp = seenPos(sd, c.pos.xyz) + qrot(rot, a.xyz * s);
  var n = qrot(rot, normalize(b.xyz / max(c.size.xyz, vec3f(1e-3))));
  o.clip = seenClip(sd, wp);
  let floorY = 0.0;
  if (MIRROR > 0.5) {
    wp.y = 2.0 * floorY - wp.y; n.y = -n.y;
  }
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = n;
  o.local = a.xyz;
  o.ao = floor(a.w) / 15.0;
  o.rot = rot;
  o.kind = u32(c.look.x);
  o.mat = u32(b.w + 0.5) % 8u;
  o.facet = fract(a.w) + f32(ii) * 0.37;
  o.glow = c.look.y;
  o.flash = c.look.z;
  return o;
}

fn hue(c: vec3f) -> vec3f { return c / max(max(c.r, max(c.g, c.b)), 1e-3); }
fn ambient(N: vec3f, ao: f32, p: vec3f) -> vec3f { return worldAmbient(N, ao, p) * look.envIntensity; }

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (i.clip < 0.0) { discard; }
  let K = minerals.k[i.kind];
  var cam = frame.camPos;
  if (MIRROR > 0.5) {
    if (i.wp.y > 0.002) { discard; }
    cam.y = -cam.y;
  }
  let N = normalize(i.n);
  let V = normalize(cam - i.wp);
  let key = worldKey(i.wp, true, 0.0);
  let rim = worldRim();
  let fh = fract(i.facet * 13.37);
  let body = K.crystal.rgb;
  let cosV = clamp(dot(N, V), 0.0, 1.0);
  let R = reflect(-V, N);
  var col = vec3f(0.0);
  // the reflection under a mirroring floor: dim and soft
  if (MIRROR > 0.5) {
    let base = select(body, mix(K.crust.rgb, K.crust2.rgb, 0.5), i.mat == 0u);
    var c = base * (ambient(N, i.ao, i.wp) + key.plain * max(dot(N, key.dir), 0.0));
    c += hue(body) * K.crystal.w * look.emissive * 0.4;
    let glance = 1.0 - abs(normalize(i.wp - frame.camPos).y);
    return vec4f(c * look.reflect * exp(i.wp.y * 2.5) * (0.25 + 0.75 * pow(max(glance, 0.0), 3.0)) * 1.3, 0.0);
  }
  if (i.mat == 0u) {
    // the geode's rough outside
    let q = i.local * K.crust2.w * 1.6;
    let nz = fbm(q);
    let e = 0.08;
    let g = vec3f(vnoise(q + vec3f(e, 0.0, 0.0)), vnoise(q + vec3f(0.0, e, 0.0)), vnoise(q + vec3f(0.0, 0.0, e))) - vnoise(q);
    let Nb = normalize(N - qrot(i.rot, g / e) * K.crust.w * 0.25);
    var albedo = mix(K.crust.rgb, K.crust2.rgb, smoothstep(0.3, 0.75, nz)) * (0.75 + 0.5 * vnoise(q * 3.1 + 5.0));
    col = albedo * (ambient(Nb, i.ao, i.wp) + key.col * max(dot(Nb, key.dir), 0.0));
    col += rim.rgb * pow(1.0 - max(dot(Nb, V), 0.0), 4.0) * rim.w * 0.05;
  } else if (i.mat == 1u) {
    // the cut rim: polished bands, as a sliced geode
    let r = length(i.local.xy) + fbm(i.local * 3.0) * 0.12;
    var st = 0.5 + 0.5 * sin((r * K.band.w * 2.5 + fbm(i.local * 6.0) * 1.2) * 6.2831853);
    st = smoothstep(0.5 - K.band2.w * 0.5, 0.5 + K.band2.w * 0.5, st);
    let albedo = mix(K.band.rgb, mix(K.band2.rgb, body, 0.5), st);
    let fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
    col = albedo * (ambient(N, i.ao, i.wp) + key.col * max(dot(N, key.dir), 0.0)) * (1.0 - fres) + worldEnv(R, i.wp) * look.envIntensity * fres;
    col += hue(body) * K.crystal.w * look.emissive * 0.12 * (1.0 - st);
  } else {
    // crystal: Fresnel reflection, and the light inside: in with dispersion, two bounces off the far facets, out
    let ior = K.extra.z;
    let clarity = K.extra.x;
    let disp = look.dispersion * K.fx.w * look.crystal;
    let f0 = select(0.05, 0.17, ior > 2.0);
    let fres = f0 + (1.0 - f0) * pow(1.0 - cosV, 5.0);
    var refl = worldEnv(R, i.wp) * look.envIntensity * mix(vec3f(1.0), hue(body), 0.5);
    refl = mix(refl, refl * thinFilm(cosV * 1.4 + fh * 0.6) * 2.0, K.extra.w);
    let t1 = normalize(-N + (vec3f(fh, fract(fh * 7.1), fract(fh * 3.3)) - 0.5) * 1.1);
    let t2 = normalize(N + (vec3f(fract(fh * 5.3), fh, fract(fh * 2.9)) - 0.5) * 1.4);
    var inside = vec3f(0.0);
    for (var c = 0; c < 3; c++) {
      let T = refract(-V, N, 1.0 / (ior + (f32(c) - 1.0) * disp));
      let b1 = reflect(T, t1);
      let b2 = reflect(b1, t2);
      inside[c] = (worldEnv(normalize(b1), i.wp)[c] * 0.6 + worldEnv(normalize(b2), i.wp)[c] * 0.5);
    }
    // the deeper the light went (thick in the middle, thin at the points), the more of the mineral's colour it takes
    let depth = clamp(1.0 - length(i.local) * 0.75, 0.15, 1.0);
    let tint = pow(max(body, vec3f(0.002)), vec3f(0.5 + depth * 1.2));
    inside *= tint * look.envIntensity * 1.3;
    let lit = body * (ambient(N, i.ao, i.wp) + key.col * max(dot(N, key.dir), 0.0));
    col = refl * fres + mix(lit, inside, clarity) * (1.0 - fres);
    // facet glints, sharper and brighter than a small stone's
    let rimDir = normalize(vec3f(-0.75, 0.35, -0.55));
    let g = pow(max(dot(R, key.dir), 0.0), 900.0) * 60.0 + pow(max(dot(R, rimDir), 0.0), 240.0) * 8.0 * rim.rgb;
    col += g * look.glint * key.glint * step(0.4, fh) * mix(vec3f(1.0), hue(body), 0.35);
    // its core's glow, and deep in a hollow the most
    col += hue(body) * K.crystal.w * look.emissive * (0.25 + 0.75 * depth) * mix(0.5, 1.4, 1.0 - i.ao) * (0.5 + 0.5 * fh) * 0.3;
    // the minerals' traits (as on the stones)
    if (K.fx.x > 0.0) {
      let q = i.local * 2.4;
      let crack = 1.0 - smoothstep(0.0, 0.03, abs(vnoise(q) - 0.5));
      let crack2 = 1.0 - smoothstep(0.0, 0.02, abs(vnoise(q * 2.3 + 11.0) - 0.5));
      col += vec3f(1.0, 0.32, 0.06) * (crack + crack2 * 0.5) * K.fx.x * 1.8 * (0.75 + 0.25 * sin(frame.time * 1.7 + i.local.y * 6.0));
    }
    if (K.fx.y > 0.0) {
      let cell = floor(i.local * 4.0 + vec3f(fbm(i.local * 2.0)) * 2.0);
      let blot = smoothstep(0.35, 0.6, hash3(cell + 7.0));
      col += thinFilm(hash3(cell) * 3.0 + cosV * 1.6) * blot * K.fx.y * (0.35 + 0.65 * pow(1.0 - cosV, 1.5));
    }
    if (K.fx.z > 0.0) {
      let rust = K.fx.z * smoothstep(0.42, 0.62, fbm(i.local * 2.0 + 3.0));
      col = mix(col, vec3f(0.09, 0.035, 0.012) * (ambient(N, i.ao, i.wp) + key.col * max(dot(N, key.dir), 0.0)) * 2.2, rust);
    }
  }
  // a heart's light: the geode's hollow fills with it
  let hl = heartLight(hearts, i.wp);
  col += hl * look.heart * mix(vec3f(0.5), hue(body), 0.5) * (0.4 + 1.6 * i.glow * (1.0 - i.ao));
  // a crystal re-forming flashes as it grows
  col += hue(body) * i.flash * 1.5 + vec3f(i.flash * 0.4);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

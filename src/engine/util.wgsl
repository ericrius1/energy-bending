// Small shared WGSL helpers with no bindings: hashing and random numbers, quaternions, a flowing field, value noise,
// and a couple of colour helpers. Any shader may include it; weft sends the browser only what a shader reaches.

// ---------------------------------------------------------------- random
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(v: u32) -> f32 { return f32(pcg(v)) * (1.0 / 4294967295.0); }
fn rnd3(v: u32) -> vec3f { return vec3f(rnd(v), rnd(v ^ 0x9e3779b9u), rnd(v ^ 0x85ebca6bu)); }
/** a random direction on the unit sphere */
fn sphereDir(v: u32) -> vec3f {
  let r = rnd3(v);
  let z = r.x * 2.0 - 1.0;
  let a = r.y * 6.2831853;
  let s = sqrt(max(0.0, 1.0 - z * z));
  return vec3f(cos(a) * s, sin(a) * s, z);
}

// ---------------------------------------------------------------- quaternions (x, y, z, w)
fn qmul(a: vec4f, b: vec4f) -> vec4f { return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
fn qaxis(axis: vec3f, ang: f32) -> vec4f { return vec4f(axis * sin(ang * 0.5), cos(ang * 0.5)); }
fn qnlerp(a: vec4f, b: vec4f, t: f32) -> vec4f {
  let s = select(1.0, -1.0, dot(a, b) < 0.0);
  return normalize(mix(a, b * s, t));
}
/** the rotation taking +y to n */
fn qFromUp(n: vec3f) -> vec4f {
  let d = n.y;
  if (d < -0.9999) { return vec4f(1.0, 0.0, 0.0, 0.0); }
  return normalize(vec4f(n.z, 0.0, -n.x, 1.0 + d));
}

// ---------------------------------------------------------------- fields and noise
/** a smooth flowing field (sums of sines: cheap, divergence-light, no texture) */
fn flow(p: vec3f, t: f32) -> vec3f {
  let q = p + vec3f(sin(p.y * 1.3 + t * 0.7), sin(p.z * 1.7 - t * 0.5), sin(p.x * 1.1 + t * 0.6)) * 0.6;
  return vec3f(
    sin(q.y * 2.1 + t) + sin(q.z * 1.3 - t * 0.8),
    sin(q.z * 1.9 - t * 1.1) + sin(q.x * 2.3 + t * 0.6),
    sin(q.x * 1.7 + t * 0.9) + sin(q.y * 1.5 - t * 0.7)) * 0.5;
}
fn hash3(p: vec3f) -> f32 {
  let q = vec3u(vec3i(floor(p)) + vec3i(4096));
  return rnd((q.x * 73856093u) ^ (q.y * 19349663u) ^ (q.z * 83492791u));
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), u.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), u.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}
fn fbm(p: vec3f) -> f32 { return vnoise(p) * 0.55 + vnoise(p * 2.07 + 13.1) * 0.3 + vnoise(p * 4.3 + 7.7) * 0.15; }
/** value noise in two dimensions (half the cost of vnoise, for flat patterns) */
fn hash2i(c: vec2i) -> f32 { return rnd((u32(c.x + 8192) * 73856093u) ^ (u32(c.y + 8192) * 19349663u)); }
fn vnoise2(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2i(i), hash2i(i + vec2i(1, 0)), u.x), mix(hash2i(i + vec2i(0, 1)), hash2i(i + vec2i(1, 1)), u.x), u.y);
}

// ---------------------------------------------------------------- colour
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
/** thin-film tint (opal: the play of colour on a facet as the angle changes) */
fn thinFilm(x: f32) -> vec3f { return 0.5 + 0.5 * cos(6.2831853 * (vec3f(0.0, 0.33, 0.67) + x)); }

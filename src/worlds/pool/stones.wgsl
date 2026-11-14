// The Pool's duel arena (arena.ts): stepping stones, standing stones and an arch of the same dark stone, and ice floes,
// rising out of the black water. Each instance a rounded box made from the vertex index: a grid on each face of a cube,
// pushed out onto a box with rounded edges (so a stone is worn, a floe is soft-edged), turned about up. The stone is
// near black and wet: it mirrors the sky and the moon (poolEnv) more than it shows itself, its worn top a little paler,
// lichen-grey in patches; ice is pale and cold, lit through (brighter where it is thin, toward its edges), with cracks
// and a glassy sheen. Both take the dancers' light. Solid things: the near fade first (worlds/light.wgsl).
#include "weft/frame"
#include "../light"

struct Stone {
  at: vec4f,     // the middle of its foot; w: its turn about up
  size: vec4f,   // width, height, depth; w: 0 stone, 1 ice
  look: vec4f,   // x: a seed, y: how round its edges (m), z, w: -
}

@group(1) @binding(0) var<storage, read> stones: array<Stone>;

/** quads a face is cut into, each way */
override N: u32 = 6u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec3f,                     // the point in the box's own frame over its half size (-1 … 1)
  @location(3) @interpolate(flat) info: vec4f,   // seed, ice, height, -
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let s = stones[ii];
  let per = N * N * 6u;
  let face = vi / per;
  let k = vi % per;
  let quad = k / 6u;
  let cr = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[k % 6u];
  let g = (vec2f(f32(quad % N), f32(quad / N)) + cr) / f32(N) * 2.0 - 1.0;
  var p = vec3f(0.0);
  switch (face) {
    case 0u: { p = vec3f(1.0, g.y, -g.x); }
    case 1u: { p = vec3f(-1.0, g.y, g.x); }
    case 2u: { p = vec3f(g.x, 1.0, -g.y); }
    case 3u: { p = vec3f(g.x, -1.0, g.y); }
    case 4u: { p = vec3f(g.x, g.y, 1.0); }
    default: { p = vec3f(-g.x, g.y, -1.0); }
  }
  // onto the rounded box: the cube's point at the half size, pulled in to the inner box and pushed out by the radius
  let half = vec3f(s.size.x, s.size.y, s.size.z) * 0.5;
  let r = min(s.look.y, min(half.x, min(half.y, half.z)) * 0.95);
  let q = p * half;
  let inner = clamp(q, -(half - r), half - r);
  var dir = q - inner;
  let dl = length(dir);
  var n = select(normalize(p), dir / dl, dl > 1e-5);
  // (a flat top stays flat where a body stands: the radius only rounds its rim)
  var lp = inner + n * r;
  // a little unevenness on a stone's sides, none on its top
  if (s.size.w < 0.5 && n.y < 0.7) {
    let w = vnoise(lp * 2.3 + s.look.x * 17.0) - 0.5;
    lp += n * w * 0.05;
  }
  let c = cos(s.at.w);
  let sn = sin(s.at.w);
  let wp = s.at.xyz + vec3f(lp.x * c + lp.z * sn, lp.y + half.y, -lp.x * sn + lp.z * c);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = vec3f(n.x * c + n.z * sn, n.y, -n.x * sn + n.z * c);
  o.local = lp / half;
  o.info = vec4f(s.look.x, s.size.w, s.size.y, 0.0);
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  let N = normalize(i.n);
  let V = normalize(frame.camPos - i.wp);
  let seed = i.info.x;
  let ice = i.info.y > 0.5;
  let R = reflect(-V, N);
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  // the faint light from above (the pool's key)
  let kdir = normalize(worldLight.pool.key.xyz);
  let kcol = worldLight.pool.keyCol.rgb * worldLight.pool.key.w;
  let kd = max(dot(N, kdir), 0.0);
  var col = vec3f(0.0);
  if (!ice) {
    // dark wet stone: grain, a paler worn top, lichen-grey patches; it mirrors more than it shows itself
    let n1 = vnoise(i.wp * 3.7 + seed * 11.0);
    var albedo = vec3f(0.035, 0.038, 0.045) * (0.7 + 0.6 * n1);
    let top = smoothstep(0.6, 0.95, N.y);
    albedo = mix(albedo, vec3f(0.07, 0.072, 0.075), top * smoothstep(0.4, 0.8, vnoise(i.wp * 1.3 + seed * 5.0)));
    albedo = mix(albedo, vec3f(0.11, 0.115, 0.1), smoothstep(0.68, 0.8, vnoise(i.wp * 2.1 + seed * 3.0)) * (0.4 + 0.6 * top));
    // wet below a line a little over the water, dry above it
    let wet = smoothstep(0.35, 0.05, i.wp.y);
    col = albedo * (kcol * kd + poolAmbient(N, 1.0) * 0.5 + worldFire(i.wp, N));
    col += poolEnv(R, i.wp) * mix(fres * 0.35, 0.03 + fres * 0.9, wet);
  } else {
    // ice: pale and cold, lit through (more at its thin rim than its thick middle), cracks, a glassy sheen
    let thin = 1.0 - smoothstep(0.55, 0.95, max(abs(i.local.x), abs(i.local.z)));
    let crack = 1.0 - smoothstep(0.0, 0.03, abs(vnoise(i.wp * 1.6 + seed * 9.0) - 0.5));
    let albedo = mix(vec3f(0.32, 0.42, 0.5), vec3f(0.55, 0.68, 0.78), 0.5 + 0.5 * vnoise(i.wp * 0.9 + seed));
    col = albedo * (kcol * kd * 0.8 + poolAmbient(N, 1.0) * 0.55 + worldFire(i.wp, N) * 0.8);
    col += vec3f(0.05, 0.11, 0.15) * (0.4 + 0.6 * (1.0 - thin)) * (worldLight.pool.moonCol.rgb * worldLight.pool.moonCol.w * 0.06 + 0.02);
    col *= 1.0 - 0.45 * crack;
    col += poolEnv(R, i.wp) * (0.05 + fres * 0.8);
  }
  // the glow behind the stage round every silhouette
  let rim = pow(1.0 - cosV, 4.0) * max(dot(-V, worldLight.pool.glowDir.xyz) * 0.5 + 0.5, 0.0);
  col += worldLight.pool.glow.rgb * worldLight.pool.glow.w * rim * 0.5;
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

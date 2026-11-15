// The Pool's duel arena (arena.ts): stepping stones, standing stones and an arch, and the floating rafts (the floes of
// phase 3), rising out of the water garden. Each instance a rounded box made from the vertex index: a grid on each face
// of a cube, pushed out onto a box with rounded edges (so a stone is worn, a raft is soft-edged), turned about up.
// (Phase 4, report 16-pool: they were near-black wet stone and pale ice, white slabs that drowned the pale bodies.)
// A stone is warm terracotta, darker and wet toward the water with a line of weed at the waterline, moss over its top
// with small flowers in it, a brass inlay running round its sides in a slow art-nouveau wave, and on the standing
// stones a flowering vine climbing out of the water. A raft is woven reed bound with brass, carpeted in moss and
// flowers. Under the water the sun's caustics play on them. Both take the dancers' light. Solid things: the near fade
// first (worlds/light.wgsl).
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
  let raft = i.info.y > 0.5;
  let R = reflect(-V, N);
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  // the low sun (the pool's key), and the sky's soft light, darker toward the water and in the crevices
  let K = worldLight.pool.key;
  let kcol = worldLight.pool.keyCol.rgb * K.w;
  let kd = max(dot(N, K.xyz), 0.0);
  let spec = pow(max(dot(R, K.xyz), 0.0), 40.0);
  let ao = smoothstep(-0.6, 0.5, i.wp.y);
  let amb = poolAmbient(N, ao);
  // where on the piece: how far under its top (m), along its side (m, round the face it is on), up out of the water
  let dTop = (1.0 - i.local.y) * 0.5 * i.info.z;
  let tang = normalize(vec2f(-N.z, N.x) + vec2f(1e-4, 0.0));
  let along = dot(i.wp.xz, tang) + seed * 13.0;
  let top = smoothstep(0.6, 0.92, N.y);
  let side = 1.0 - smoothstep(0.35, 0.7, abs(N.y));
  var albedo = vec3f(0.0);
  var metal = 0.0;
  if (!raft) {
    // terracotta: warm, in layers and grains, darker and wet toward the water
    let n1 = vnoise(i.wp * vec3f(2.2, 6.0, 2.2) + seed * 11.0);
    let n2 = vnoise(i.wp * 9.0 + seed * 3.0);
    albedo = mix(vec3f(0.14, 0.066, 0.042), vec3f(0.2, 0.098, 0.06), n1) * (0.85 + 0.3 * n2);
    let wet = smoothstep(0.45, 0.02, i.wp.y);
    albedo *= 1.0 - 0.35 * wet;
    // a line of weed just at the waterline
    albedo = mix(albedo, vec3f(0.06, 0.12, 0.04), smoothstep(0.16, 0.0, abs(i.wp.y - 0.04)) * smoothstep(0.3, 0.6, n2 + 0.2));
    // moss over the top and spilling a little down the sides, small flowers in it
    let mossN = vnoise(i.wp * 1.7 + seed * 5.0) * 0.65 + n2 * 0.35;
    let moss = clamp(top * smoothstep(0.18, 0.4, mossN) + side * smoothstep(0.25, 0.0, dTop) * smoothstep(0.45, 0.7, mossN), 0.0, 1.0) * step(0.1, i.wp.y);
    let mossCol = mix(vec3f(0.026, 0.05, 0.016), vec3f(0.062, 0.09, 0.026), vnoise(i.wp * 5.0 + seed)) * (0.75 + 0.5 * vnoise(i.wp * 14.0));
    albedo = mix(albedo, mossCol, moss);
    let fc = floor(i.wp.xz * 7.0);
    let fh = hash2i(vec2i(fc) + vec2i(i32(seed * 97.0), 3));
    let fd = length(fract(i.wp.xz * 7.0) - 0.5 - (vec2f(hash2i(vec2i(fc) + vec2i(5, 1)), hash2i(vec2i(fc) + vec2i(2, 8))) - 0.5) * 0.5);
    let flower = smoothstep(0.12, 0.06, fd) * step(0.94, fh) * moss * top;
    albedo = mix(albedo, select(vec3f(0.85, 0.78, 0.62), vec3f(0.9, 0.32, 0.22), fh > 0.975), flower);
    // the brass inlay: a slow wave round the sides under the top, and arches hanging from it, above the water
    let wave = 0.22 + 0.05 * sin(along * 2.2);
    let arch = wave + 0.32 * pow(abs(sin(along * 1.1)), 1.5);
    let line = max(1.0 - smoothstep(0.012, 0.022, abs(dTop - wave)), (1.0 - smoothstep(0.01, 0.019, abs(dTop - arch))) * step(dTop, 0.62));
    metal = line * side * step(0.15, i.wp.y) * (1.0 - moss);
    // the standing stones (their tops well over a jump): a flowering vine climbing out of the water
    if (i.wp.y + dTop > 2.9) {
      let up = i.wp.y;
      let path = along * 1.6 - (seed * 6.0 + up * 0.9 + sin(up * 2.3 + seed) * 0.5);
      let off = abs(fract(path / 6.2831853) - 0.5) * 6.2831853 / 1.6;
      let grow = smoothstep(2.6, 1.2, up) * step(0.0, up);
      let stem = (1.0 - smoothstep(0.012, 0.025, off)) * grow;
      let leafN = vnoise(vec3f(along * 6.0, up * 6.0, seed));
      let leaves = smoothstep(0.11, 0.04, off - leafN * 0.06) * smoothstep(0.45, 0.65, leafN) * grow;
      albedo = mix(albedo, vec3f(0.08, 0.18, 0.04), max(stem, leaves));
      let bloom = step(0.9, hash2i(vec2i(i32(floor(along * 5.0)), i32(floor(up * 5.0))))) * leaves;
      albedo = mix(albedo, vec3f(0.92, 0.38, 0.28), bloom);
      metal *= 1.0 - max(stem, leaves);
    }
  } else {
    // a raft: woven reed round its sides, bound with brass ties; on top, moss and flowers to its woven rim
    let rim = smoothstep(0.82, 0.92, max(abs(i.local.x), abs(i.local.z)));
    let u = along * 11.0;
    let v = i.wp.y * 16.0;
    let over = (i32(floor(u)) + i32(floor(v))) % 2 == 0;
    let strand = select(sin(fract(v) * 3.1415927), sin(fract(u) * 3.1415927), over);
    let reed = mix(vec3f(0.17, 0.1, 0.04), vec3f(0.32, 0.21, 0.09), vnoise(i.wp * 4.0 + seed)) * (0.55 + 0.45 * strand);
    let woven = max(side, rim * top);
    let mossN = vnoise(i.wp * 2.4 + seed * 7.0) * 0.6 + vnoise(i.wp * 8.0) * 0.4;
    let mossCol = mix(vec3f(0.026, 0.052, 0.016), vec3f(0.065, 0.1, 0.028), mossN);
    albedo = mix(mossCol, reed, woven);
    let fc = floor(i.wp.xz * 9.0);
    let fh = hash2i(vec2i(fc) + vec2i(i32(seed * 61.0), 7));
    let fd = length(fract(i.wp.xz * 9.0) - 0.5 - (vec2f(hash2i(vec2i(fc) + vec2i(1, 4)), hash2i(vec2i(fc) + vec2i(6, 2))) - 0.5) * 0.5);
    let flower = smoothstep(0.13, 0.07, fd) * step(0.8, fh) * (1.0 - woven) * top;
    let fcol = select(select(vec3f(0.88, 0.8, 0.62), vec3f(0.92, 0.36, 0.26), fh > 0.88), vec3f(0.95, 0.7, 0.18), fh > 0.95);
    albedo = mix(albedo, fcol, flower);
    albedo *= 1.0 - 0.3 * smoothstep(0.1, -0.05, i.wp.y);
    metal = (1.0 - smoothstep(0.03, 0.06, abs(fract(along * 0.9) - 0.5))) * side * step(0.0, i.wp.y);
  }
  // lit: the sun, the sky, the dancers' fire; the sun's caustics on what is under the water
  var col = albedo * (kcol * kd + amb + worldFire(i.wp, N));
  col += albedo * kcol * poolCaustics(i.wp, -i.wp.y) * (0.4 + 0.6 * max(N.y, 0.0));
  // a little wet sheen near the water, more on the stone
  let wetSheen = smoothstep(0.3, 0.0, i.wp.y) * select(0.5, 0.2, raft);
  col += poolEnv(R, i.wp) * fres * (0.15 + wetSheen);
  // the brass: the sky and the sun mirrored in warm metal
  let brass = vec3f(0.9, 0.62, 0.26);
  let shine = brass * (poolEnv(R, i.wp) * 0.7 + kcol * (spec * 3.0 + kd * 0.25) + amb * 0.2);
  col = mix(col, shine, metal);
  // the sun behind the stage round every silhouette
  let rimL = pow(1.0 - cosV, 4.0) * max(dot(-V, worldLight.pool.glowDir.xyz) * 0.5 + 0.5, 0.0);
  col += worldLight.pool.glow.rgb * worldLight.pool.glow.w * rimL * 0.25;
  return vec4f(sightLit(col), dot(i.wp - frame.camPos, frame.camFwd));
}

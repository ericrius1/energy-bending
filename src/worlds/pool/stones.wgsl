// The Pool's duel arena (arena.ts): stepping stones, standing stones and an arch, and the floating rafts (the floes of
// phase 3), rising out of the water garden. Each instance a rounded box made from the vertex index: a grid on each face
// of a cube, pushed out onto a box with rounded edges (so a stone is worn, a raft is soft-edged), turned about up; the
// low ones rounded at their corners too, so from above they are pads, not tiles (the solid stays the box).
// (Phase 4, report 16-pool: they were near-black wet stone and pale ice, white slabs that drowned the pale bodies.
// Phase 5, report 18: they read as square turf tiles with white sprinkles on terracotta boxes. Now each is a crafted
// thing that answers the low sun with a glaze or a metal's highlight, its planting a real silhouette, beds.wgsl.)
//   a planter (a low stone a body steps on): glazed ceramic, amber over terracotta, a band of teal and cream tile under
//     a brass rim, a brass whiplash inlaid in the glaze; a lawn of moss on top
//   a block (a jump high): terracotta, a band of glazed tile under its top, the brass inlay round its sides
//   a standing stone: terracotta and brass, a flowering vine climbing out of the water
//   a raft: woven fibre bound with brass ties, a woven rim round its moss
// Under the water the sun's caustics play on them. All take the dancers' light. Solid things: the near fade first
// (worlds/light.wgsl).
#include "weft/frame"
#include "../light"

struct Stone {
  at: vec4f,     // the middle of its foot; w: its turn about up
  size: vec4f,   // width, height, depth; w: 0 stone, 1 ice
  look: vec4f,   // x: a seed, y: how round its edges (m), z: how round its corners seen from above (m), w: what it is
                 // (arena.ts ROCK_LOOK: 0 a planter, 1 a block, 2 a standing stone, 3 a raft)
}

@group(1) @binding(0) var<storage, read> stones: array<Stone>;

/** quads a face is cut into, each way */
override N: u32 = 8u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec3f,                     // the point in the box's own frame over its half size (-1 â€¦ 1)
  @location(3) @interpolate(flat) info: vec4f,   // seed, ice, height, what it is (arena.ts ROCK_LOOK)
  @location(4) @interpolate(flat) shape: vec4f,  // its half width and depth (m), its corners' radius seen from above, -
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
  // onto the rounded box: the cube's point at the half size, pulled in to the inner shape and pushed out by the radius.
  // Seen from above its corners are rounded by `rp` (a low stone or a raft reads as a round pad, not a square tile), its
  // rim by `r`: the inner shape is a rectangle with corners of rp - r, a point's plan offset past the core rectangle
  // clamped to that, then the usual push out by r (continuous over the cube's faces, so the mesh stays closed)
  let half = vec3f(s.size.x, s.size.y, s.size.z) * 0.5;
  let r = min(s.look.y, min(half.x, min(half.y, half.z)) * 0.95);
  let rp = clamp(s.look.z, r, min(half.x, half.z) * 0.95);
  let q = p * half;
  let core = half.xz - rp;
  let c2 = clamp(q.xz, -core, core);
  let d2 = q.xz - c2;
  let dl2 = length(d2);
  // (the outer outline: the box's plan pulled in to the rounded rectangle at its corners)
  let outerXZ = c2 + d2 * min(1.0, rp / max(dl2, 1e-6));
  let innerXZ = c2 + d2 * min(1.0, (rp - r) / max(dl2, 1e-6));
  let inner = vec3f(innerXZ.x, clamp(q.y, -(half.y - r), half.y - r), innerXZ.y);
  var dir = vec3f(outerXZ.x, q.y, outerXZ.y) - inner;
  let dl = length(dir);
  var n = select(normalize(p), dir / dl, dl > 1e-5);
  // (a flat top stays flat where a body stands: the radius only rounds its rim)
  var lp = inner + n * r;
  // a little unevenness on a stone's sides, none on its top (the glaze and the weave are smooth)
  if ((s.look.w > 0.5 && s.look.w < 1.5) && n.y < 0.7) {
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
  o.info = vec4f(s.look.x, s.size.w, s.size.y, s.look.w);
  o.shape = vec4f(half.x, half.z, rp, 0.0);
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  var N = normalize(i.n);
  let V = normalize(frame.camPos - i.wp);
  // (a pixel's size on the piece, in uniform control flow: the crafted pieces' edges are a pixel soft)
  let pxw = max(length(fwidth(i.wp)), 0.002);
  let seed = i.info.x;
  let look = u32(i.info.w + 0.5);
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  // the low sun (the pool's key), and the sky's soft light, darker toward the water and in the crevices
  let K = worldLight.pool.key;
  let kcol = worldLight.pool.keyCol.rgb * K.w;
  let ao = smoothstep(-0.6, 0.5, i.wp.y);
  // where on the piece: how far under its top (m), round it (m, continuous round a rounded outline), how far in from
  // its outline seen from above (m, on the top), up out of the water
  let dTop = (1.0 - i.local.y) * 0.5 * i.info.z;
  let lxz = i.local.xz * i.shape.xy;
  let rp = i.shape.z;
  let cc = clamp(lxz, -(i.shape.xy - rp), i.shape.xy - rp);
  let inward = rp - length(lxz - cc) + min(i.shape.x - rp - abs(cc.x), i.shape.y - rp - abs(cc.y)) * step(length(lxz - cc), 1e-4);
  let along = atan2(lxz.y, lxz.x) * (i.shape.x + i.shape.y) * 0.5 + seed * 13.0;
  let top = smoothstep(0.6, 0.92, N.y);
  let side = 1.0 - smoothstep(0.35, 0.7, abs(N.y));
  let wet = smoothstep(0.45, 0.02, i.wp.y);
  var albedo = vec3f(0.0);
  var metal = 0.0;
  var glaze = 0.0;
  var glazeCol = vec3f(0.0);
  // the moss: a lawn over the top, mounded and sun-catching, no sprinkles (the flowers are the beds', beds.wgsl)
  let mossN = vnoise(i.wp * 2.1 + seed * 5.0) * 0.6 + vnoise(i.wp * 7.0) * 0.4;
  let mossCol = mix(vec3f(0.03, 0.06, 0.018), vec3f(0.085, 0.13, 0.03), mossN) * (0.8 + 0.4 * vnoise(i.wp * 23.0));
  if (look == 0u) {
    // a planter: a brass rim round its top's edge; under it a band of teal and gold tile; below that white glazed
    // ceramic with a brass whiplash inlaid, wet and weeded at the water
    let rimTop = top * smoothstep(0.06, 0.035, inward);
    let rimSide = side * smoothstep(0.05, 0.03, dTop);
    let rim = max(rimTop, max(rimSide, (1.0 - top) * (1.0 - side) * step(dTop, 0.12)));
    let band = side * smoothstep(0.045, 0.055, dTop) * smoothstep(0.17, 0.16, dTop);
    // (the band's tiles: squares with gold joints, a leaf in every other one)
    let tu = along / 0.11;
    let tv = (dTop - 0.05) / 0.11;
    let tf = vec2f(fract(tu) - 0.5, fract(tv) - 0.5);
    let joint = 1.0 - smoothstep(0.42, 0.46, max(abs(tf.x), abs(tf.y)));
    let leafT = select(0.0, 1.0 - smoothstep(0.16, 0.2, length(vec2f(tf.x * 1.8 - tf.y * 0.6, tf.y * 0.9))), (i32(floor(tu)) & 1) == 0);
    let tile = mix(vec3f(0.03, 0.26, 0.27), vec3f(0.66, 0.6, 0.45), leafT);
    // the white body and its inlay: a slow wave and arches hanging from it, as a whiplash
    let wave = 0.24 + 0.05 * sin(along * 2.2);
    let arch = wave + 0.26 * pow(abs(sin(along * 1.1)), 1.5);
    let inlay = max(1.0 - smoothstep(0.008, 0.016, abs(dTop - wave)), (1.0 - smoothstep(0.007, 0.014, abs(dTop - arch))) * step(dTop, 0.56)) * side * step(0.12, i.wp.y) * step(0.17, dTop);
    // (the body: terracotta under an amber glaze, warm against the teal water and darker than the pale bodies; the glaze
    // pools darker low on the side and runs thin and paler at the shoulder, a fine crackle in it)
    let craq = smoothstep(0.035, 0.0, abs(vnoise(i.wp * 9.0 + seed) - 0.5)) * 0.12;
    let pooled = smoothstep(0.15, 0.5, dTop) * (0.7 + 0.3 * vnoise(vec3f(along * 3.0, i.wp.y * 8.0, seed)));
    let amber = mix(vec3f(0.36, 0.17, 0.065), vec3f(0.2, 0.075, 0.03), pooled) * (1.0 - craq) * (1.0 - 0.3 * wet);
    glazeCol = mix(amber, tile, band * joint);
    glazeCol = mix(glazeCol, vec3f(0.55, 0.42, 0.18), band * (1.0 - joint));
    glaze = (1.0 - top) * (1.0 - rim);
    albedo = mix(mossCol, glazeCol, 1.0 - top);
    // a line of weed just at the waterline
    albedo = mix(albedo, vec3f(0.05, 0.1, 0.035), smoothstep(0.1, 0.0, abs(i.wp.y - 0.03)) * smoothstep(0.35, 0.6, mossN + 0.2) * side);
    metal = max(rim, inlay * (1.0 - band));
  } else if (look == 3u) {
    // a raft: woven reed round its sides, bound with brass ties; on top, moss to its woven rim
    let wrim = top * smoothstep(0.16, 0.1, inward);
    let u = along * 11.0;
    let v = i.wp.y * 16.0 + select(0.0, inward * 16.0, top > 0.5);
    let over = (i32(floor(u)) + i32(floor(v))) % 2 == 0;
    let strand = select(sin(fract(v) * 3.1415927), sin(fract(u) * 3.1415927), over);
    let reed = mix(vec3f(0.2, 0.12, 0.045), vec3f(0.42, 0.28, 0.11), vnoise(i.wp * 4.0 + seed)) * (0.5 + 0.5 * strand);
    let woven = max(side, wrim);
    albedo = mix(mossCol, reed, woven);
    albedo *= 1.0 - 0.3 * smoothstep(0.1, -0.05, i.wp.y);
    // (the weave's strands catch the light: the normal tipped across each strand)
    let T = normalize(vec3f(-N.z, 0.0, N.x) + vec3f(1e-4, 0.0, 0.0));
    N = normalize(N + T * (select(fract(u), fract(v), over) - 0.5) * 0.5 * woven);
    metal = (1.0 - smoothstep(0.025, 0.05, abs(fract(along * 0.9) - 0.5))) * side * step(0.0, i.wp.y);
    metal = max(metal, top * smoothstep(0.035, 0.02, inward));
  } else if (look != 1u) {
    // (report 24) a standing stone, the gate's pillars: a column of white glaze over a dado of deep teal majolica that
    // rises out of the water to an edge of lotus scallops, a green-glazed whiplash with broad leaves winding up it, a
    // copper band under its top (the gate's pillars a copper capital); its top planted inside a copper rim (beds.wgsl
    // plants its edge). The gate's lintel a beam of copper gone green, a gold whiplash along it; its capstone a lantern of
    // stained glass in a copper frame (lit through below)
    let body = vec3f(0.7, 0.68, 0.62) * (0.96 + 0.08 * vnoise(i.wp * 7.0 + seed));
    let perim = 3.14159265 * (i.shape.x + i.shape.y);
    let verd = mix(vec3f(0.12, 0.4, 0.32), vec3f(0.28, 0.58, 0.46), vnoise(i.wp * 13.0 + seed)) * (0.9 + 0.2 * vnoise(i.wp * 41.0));
    let rimTop = top * smoothstep(0.09, 0.07, inward);
    let aa = max(pxw, 0.004);
    var copper = 0.0;
    var gold = 0.0;
    if (look == 2u || look == 4u) {
      let scal = 0.5 + 0.08 * (1.0 - pow(abs(fract(along / 0.32) * 2.0 - 1.0), 1.6));
      let dado = smoothstep(scal + aa, scal - aa, i.wp.y) * (1.0 - top);
      albedo = mix(body, vec3f(0.035, 0.24, 0.24) * (0.9 + 0.2 * vnoise(i.wp * 6.0)), dado);
      gold = smoothstep(0.012 + aa, 0.012, abs(i.wp.y - scal - 0.014)) * side;
      // the whiplash: two stems winding up, a broad leaf off them every 0.4 m
      var leafG = 0.0;
      var edgeL = 0.0;
      for (var m = 0; m < 2; m++) {
        let fm = f32(m);
        let ac = seed * perim + fm * perim * 0.5 + 0.35 * sin(i.wp.y * 1.5 + seed * 3.0 + fm) + 0.15 * sin(i.wp.y * 3.7 + fm * 2.0);
        var dm = along - ac;
        dm = dm - perim * round(dm / perim);
        let w = 0.022 + 0.01 * sin(i.wp.y * 2.3 + fm);
        leafG = max(leafG, 1.0 - smoothstep(w, w + aa, abs(dm)));
        edgeL = max(edgeL, 1.0 - smoothstep(0.006, 0.006 + aa, abs(abs(dm) - w - 0.006)));
        let k = floor(i.wp.y / 0.4 + fm * 0.5);
        let sd = select(-1.0, 1.0, (i32(k) & 1) == 0);
        let ly = (i.wp.y - (k + 0.5 - fm * 0.5) * 0.4) / 0.17;
        let lx = (dm - sd * 0.075) / 0.06;
        let lq = vec2f(lx * cos(0.7 * sd) - ly * sin(0.7 * sd), lx * sin(0.7 * sd) + ly * cos(0.7 * sd));
        let lf = abs(lq.x) + lq.y * lq.y * 0.9;
        leafG = max(leafG, 1.0 - smoothstep(1.0, 1.0 + aa / 0.06, lf));
        edgeL = max(edgeL, (1.0 - smoothstep(0.1, 0.1 + aa / 0.03, abs(lf - 1.1))) * step(abs(lq.y), 1.05));
      }
      let onShaft = side * step(scal + 0.04, i.wp.y) * step(0.12, dTop);
      albedo = mix(albedo, mix(vec3f(0.05, 0.26, 0.1), vec3f(0.2, 0.46, 0.12), vnoise(i.wp * 9.0 + seed)), leafG * onShaft);
      gold = max(gold, edgeL * onShaft * (1.0 - leafG));
      copper = side * smoothstep(select(0.09, 0.32, look == 4u) + aa, select(0.09, 0.32, look == 4u), dTop);
      // (a capital's lotus petals: their edges rubbed bright)
      if (look == 4u) { gold = max(gold, copper * smoothstep(0.012 + aa, 0.012, abs(dTop - (0.06 + 0.2 * pow(abs(fract(along / 0.18) * 2.0 - 1.0), 1.4))))); }
      glaze = (1.0 - top) * (1.0 - copper) * (1.0 - gold);
    } else if (look == 5u) {
      // the beam: copper gone green, a gold whiplash along its faces (a slow wave and arches hanging from it)
      albedo = verd;
      copper = 1.0 - top;
      let wave = 0.14 + 0.03 * sin(along * 2.2);
      let arch = wave + 0.18 * pow(abs(sin(along * 1.1)), 1.5);
      gold = max(1.0 - smoothstep(0.012, 0.012 + aa, abs(dTop - wave)), (1.0 - smoothstep(0.01, 0.01 + aa, abs(dTop - arch))) * step(dTop, 0.4)) * side;
      gold = max(gold, side * smoothstep(0.03 + aa, 0.03, dTop));
    } else {
      // the lantern: on each side a pane of stained glass (a lotus in lead), a copper frame round it
      copper = 1.0 - top;
    }
    albedo = mix(albedo, verd, copper);
    metal = gold;
    // a top: moss inside a copper rim
    albedo = mix(albedo, mossCol, top * (1.0 - rimTop));
    albedo = mix(albedo, verd, rimTop);
    metal *= 1.0 - top;
    glaze *= 1.0 - top;
  } else {
    // terracotta: warm, in layers and grains, darker and wet toward the water
    let n1 = vnoise(i.wp * vec3f(2.2, 6.0, 2.2) + seed * 11.0);
    let n2 = vnoise(i.wp * 9.0 + seed * 3.0);
    // (report 24: a warmer, lighter fired clay, so a block reads as terracotta in the low sun, not a dark post)
    albedo = mix(vec3f(0.3, 0.12, 0.06), vec3f(0.42, 0.19, 0.1), n1) * (0.85 + 0.3 * n2);
    albedo *= 1.0 - 0.35 * wet;
    albedo = mix(albedo, vec3f(0.06, 0.12, 0.04), smoothstep(0.16, 0.0, abs(i.wp.y - 0.04)) * smoothstep(0.3, 0.6, n2 + 0.2));
    // moss over the top and spilling a little down the sides
    let moss = clamp(top * smoothstep(0.18, 0.4, mossN) + side * smoothstep(0.25, 0.0, dTop) * smoothstep(0.5, 0.75, mossN), 0.0, 1.0) * step(0.1, i.wp.y);
    albedo = mix(albedo, mossCol, moss);
    // the brass inlay: a slow wave round the sides under the top, and arches hanging from it, above the water
    let off = select(0.22, 0.3, look == 1u);
    let wave = off + 0.05 * sin(along * 2.2);
    let arch = wave + 0.32 * pow(abs(sin(along * 1.1)), 1.5);
    let line = max(1.0 - smoothstep(0.012, 0.022, abs(dTop - wave)), (1.0 - smoothstep(0.01, 0.019, abs(dTop - arch))) * step(dTop, 0.66));
    metal = line * side * step(0.15, i.wp.y) * (1.0 - moss);
    if (look == 1u) {
      // a block: a band of glazed tile under its top, teal and cream in a running bond with gold joints
      let band = side * smoothstep(0.06, 0.07, dTop) * smoothstep(0.22, 0.21, dTop) * (1.0 - moss);
      let tu = along / 0.15 + select(0.0, 0.5, fract((dTop - 0.07) / 0.075) > 0.5);
      let tv = (dTop - 0.07) / 0.075;
      let tf = vec2f(fract(tu) - 0.5, fract(tv) - 0.5);
      let joint = 1.0 - smoothstep(0.4, 0.46, max(abs(tf.x), abs(tf.y) * 1.0));
      let h = hash2i(vec2i(i32(floor(tu)), i32(floor(tv))) + vec2i(i32(seed * 50.0), 0));
      glazeCol = mix(mix(vec3f(0.035, 0.28, 0.28), vec3f(0.62, 0.57, 0.46), step(0.55, h)), vec3f(0.55, 0.42, 0.18), 1.0 - joint);
      glaze = band;
      albedo = mix(albedo, glazeCol, band);
      metal *= 1.0 - band;
    }
    // the standing stones (their tops well over a jump): a flowering vine climbing out of the water
    if (look == 2u && i.wp.y + dTop > 2.9) {
      let up = i.wp.y;
      let path = along * 1.6 - (seed * 6.0 + up * 0.9 + sin(up * 2.3 + seed) * 0.5);
      let o = abs(fract(path / 6.2831853) - 0.5) * 6.2831853 / 1.6;
      let grow = smoothstep(2.6, 1.2, up) * step(0.0, up);
      let stem = (1.0 - smoothstep(0.012, 0.025, o)) * grow;
      let leafN = vnoise(vec3f(along * 6.0, up * 6.0, seed));
      let leaves = smoothstep(0.11, 0.04, o - leafN * 0.06) * smoothstep(0.45, 0.65, leafN) * grow;
      albedo = mix(albedo, vec3f(0.08, 0.18, 0.04), max(stem, leaves));
      let bloom = step(0.9, hash2i(vec2i(i32(floor(along * 5.0)), i32(floor(up * 5.0))))) * leaves;
      albedo = mix(albedo, vec3f(0.92, 0.38, 0.28), bloom);
      metal *= 1.0 - max(stem, leaves);
    }
  }
  let R = reflect(-V, N);
  let kd = max(dot(N, K.xyz), 0.0);
  let amb = poolAmbient(N, ao);
  // lit: the sun, the sky, the dancers' fire; the sun's caustics on what is under the water
  var col = albedo * (kcol * kd + amb + worldFire(i.wp, N));
  col += albedo * kcol * poolCaustics(i.wp, -i.wp.y) * (0.4 + 0.6 * max(N.y, 0.0));
  // the glaze: a clear coat over its colour (the sky and the sun in it)
  let env = poolEnv(R, i.wp);
  if (glaze > 0.0) {
    col = mix(col, poolGlaze(col, N, V, env, 0.85), glaze);
  } else {
    // a little wet sheen near the water, more on the stone
    let wetSheen = wet * select(0.4, 0.2, look == 3u);
    col += env * fres * (0.12 + wetSheen);
  }
  // the brass: the sky and the sun mirrored in warm metal
  col = mix(col, poolBrass(N, V, env, amb, kd), metal);
  // (report 24) the lantern's panes: on each side a lotus of stained glass in lead, coral petals round a gold sun on
  // sky teal, lit through by the low sun behind it and by a warm light of its own, the sky in its face
  if (look == 6u && side > 0.5) {
    let L = i.local;
    let xFace = abs(L.x) > abs(L.z);
    let hw = select(i.shape.x, i.shape.y, xFace);
    let hh = i.info.z * 0.5;
    let fu = select(L.x, L.z, xFace) * hw;
    let fv = L.y * hh;
    let pane = step(abs(fu), hw - 0.1) * step(abs(fv), hh - 0.12);
    if (pane > 0.5) {
      let R = min(hw, hh) - 0.12;
      let q = vec2f(fu, fv) / R;
      let r = length(q);
      let a = atan2(q.y, q.x);
      let px = pxw / R;
      let s = fract(a * 8.0 / 6.2831853) - 0.5;
      var gc = mix(vec3f(0.03, 0.38, 0.5), vec3f(0.3, 0.7, 0.78), smoothstep(0.3, 1.4, r));
      var lead = smoothstep(px * 1.6, px * 0.4, abs(r - 1.0)) + smoothstep(px * 1.6, px * 0.4, abs(r - 0.3));
      let half = 0.4 * sin(3.1415927 * clamp((r - 0.3) / 0.68, 0.0, 1.0));
      if (r < 0.3) { gc = vec3f(1.0, 0.55, 0.06); }
      else if (r < 1.0 && abs(s) < half) {
        gc = mix(vec3f(0.95, 0.22, 0.2), vec3f(1.0, 0.55, 0.55), r);
        lead = max(lead, smoothstep(px * 1.6 / max(r * 0.785, 0.05), 0.0, half - abs(s)));
      } else if (r >= 1.0) {
        // (the corners: sun rays of gold glass between teal)
        let ray = fract(a * 12.0 / 6.2831853) - 0.5;
        gc = mix(gc, vec3f(1.0, 0.78, 0.3), smoothstep(0.12, 0.04, abs(ray)));
        lead = max(lead, smoothstep(px * 1.4 / max(r * 0.52, 0.05), 0.0, abs(abs(ray) - 0.12)));
      }
      let Ks = worldLight.pool.key.xyz;
      let sunL = worldLight.pool.keyCol.rgb * worldLight.pool.key.w;
      let back = pow(max(dot(-V, Ks), 0.0), 3.0) * 1.6 + max(-dot(N, Ks), 0.0) * 0.6 + 0.45;
      var glass = gc * (sunL * back * 0.7 + amb * 0.5);
      glass = glass * (1.0 - fres * 0.7) + env * fres * 0.7;
      glass = mix(glass, vec3f(0.05, 0.04, 0.03) + sunL * vec3f(0.05, 0.035, 0.015), clamp(lead, 0.0, 1.0));
      col = glass;
    }
  }
  // the sun behind the stage round every silhouette
  let rimL = pow(1.0 - cosV, 4.0) * max(dot(-V, worldLight.pool.glowDir.xyz) * 0.5 + 0.5, 0.0);
  col += worldLight.pool.glow.rgb * worldLight.pool.glow.w * rimL * 0.25;
  return vec4f(sightLit(col), dot(i.wp - frame.camPos, frame.camFwd));
}

// What hangs in the Tide Temple's air (garden.ts lays it out): banners of dyed cloth, strands of flowering vine and wind
// chimes, each a ribbon hanging from a stone's edge, moving in the sea air. A banner is a sheet facing out of the face it
// hangs from, swaying and rippling (more toward its foot), cut swallowtail, dyed in the palette (sun gold, coral, leaf,
// teal, cream) with a leaf in a paler tint up its middle and a gold border, the sun glowing through it from behind; a
// strand turns to the eye, leaves alternating down a stem and a flower here and there (the rest of the ribbon dropped);
// a chime's tube is bronze gone green, swinging a little. Lit as the stones are: the sun (the pillars' shadows, the
// stained glass's colour), the sky, the court's bounce. Opaque, its alpha the view distance (the depth contract). Not a
// solid: the near fade's CPU never sees it, so it fades itself near the eye and across the line of sight to a body
// (decorDrop, worlds/light.wgsl).
#include "weft/frame"
#include "../light"

struct Hang {
  at: vec4f,     // where it hangs from; w: its kind (0 a banner, 1 a vine's strand, 2 a chime's tube)
  n: vec4f,      // xy: the face it hangs from (outward, in xz); z: its length (m); w: its width (m)
  look: vec4f,   // x: seed, y: its colour (a banner's: 0 … 4), z, w: -
}

@group(1) @binding(0) var<storage, read> hangs: array<Hang>;

override FIRST: u32 = 0u;
/** segments down a ribbon */
override SEG: u32 = 14u;

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                          // x: across (-1 … 1), y: down it (0 at the top … 1 its foot)
  @location(3) @interpolate(flat) info: vec4f,     // kind, seed, colour, length
}

/** the air's push on a ribbon at s of the way down it (0 … 1), at time t: a slow sway and a quicker flutter, more toward
 *  its foot (m, along the face's outward normal and across it) */
fn sway(s: f32, t: f32, seed: f32, kind: f32) -> vec2f {
  let reach = pow(s, 1.5);
  let gust = 0.6 + 0.4 * sin(t * 0.31 + seed * 5.0);
  let k = select(1.0, 0.45, kind > 1.5);
  let out = (sin(t * 1.1 + seed * 6.28 + s * 2.2) * 0.16 + sin(t * 2.7 + seed * 3.0 + s * 6.0) * 0.04) * gust;
  let side = sin(t * 0.83 + seed * 9.0 + s * 1.3) * 0.07 * gust;
  return vec2f(out, side) * reach * k;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  let H = hangs[FIRST + ii];
  let seg = vi / 6u;
  let c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi % 6u];
  let s = (f32(seg) + c.y) / f32(SEG);
  let kind = H.at.w;
  let t = worldLight.temple.fire.y;
  let nOut = normalize(vec3f(H.n.x, 0.0, H.n.y));
  var across = vec3f(-nOut.z, 0.0, nOut.x);
  // a strand and a tube turn to the eye about their own hanging line
  if (kind > 0.5) {
    let toEye = frame.camPos - H.at.xyz;
    across = normalize(vec3f(-toEye.z, 0.0, toEye.x) + vec3f(1e-5, 0.0, 0.0));
  }
  let w = sway(s, t, H.look.x, kind);
  let u = c.x * 2.0 - 1.0;
  // (a banner ripples across too: its edges a little behind its middle as the air moves it)
  let ripple = select(0.0, sin(t * 2.1 + s * 7.0 + H.look.x * 4.0) * 0.05 * s * u, kind < 0.5);
  // (the world answering a moment lifts the banners out on the air and swings the chimes: worlds/answer.wgsl, report 20)
  let lift = answerLift(3u, H.at.xyz) * s * H.n.z * select(0.65, 0.3, kind > 0.5);
  let p = H.at.xyz - vec3f(0.0, s * H.n.z - lift * 0.45, 0.0) + across * u * H.n.w * 0.5 + nOut * (w.x + ripple + lift) + across * w.y * (1.0 + 2.0 * lift);
  // the sheet's normal: out of its face, tipped by the slope of its sway down it
  let w2 = sway(min(s + 0.05, 1.0), t, H.look.x, kind);
  let slope = (w2.x - w.x) / max(0.05 * H.n.z, 1e-3);
  var N = normalize(nOut + vec3f(0.0, slope, 0.0));
  if (kind > 0.5) { N = normalize(vec3f(across.z, 0.0, -across.x)); }
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.wp = p;
  o.n = N;
  o.uv = vec2f(u, s);
  o.info = vec4f(kind, H.look.x, H.look.y, H.n.z);
  return o;
}

/** leaves on a column's vine (one stem a draw instance) */
override VLEAVES: u32 = 56u;

/** a vine round a column (report 18: real leaves and flowers in place of a green coat): one of the two stems that
 *  stones.wgsl draws as a thin line winding up the shaft, at.xyz the shaft's foot, n: x its radius, y, z the stem's
 *  lowest and highest point (m), w the stem's turn at y = 0 (rad, world); look: x a seed, y how it turns per m up.
 *  Leaves either side of the stem, each a card standing out from the stone and hanging a little, cut to a leaf's shape;
 *  one in seven a flower */
@vertex fn vs_vine(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  let H = hangs[FIRST + ii];
  let k = vi / 6u;
  let c = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  let seed = H.look.x;
  let hk = fract(sin(f32(k) * 12.9898 + seed * 78.233) * 43758.5453);
  let hk2 = fract(hk * 7.13 + 0.37);
  // where up the stem (with a little scatter), and round the shaft there
  let y = mix(H.n.y, H.n.z, (f32(k) + 0.3 + 0.4 * hk) / f32(VLEAVES));
  let th = H.n.w + H.look.y * y;
  let radial = vec3f(cos(th), 0.0, sin(th));
  let tang = normalize(vec3f(-sin(th), 0.0, cos(th)) * H.n.x * H.look.y + vec3f(0.0, 1.0, 0.0));
  let side = select(-1.0, 1.0, (k % 2u) == 0u);
  let flower = (k % 7u) == 3u;
  let t = worldLight.temple.fire.y;
  let flutter = sin(t * 2.1 + seed * 20.0 + f32(k) * 1.7) * 0.15;
  // a leaf: from the stem out from the stone and to its side, tipped down; a flower: a disc facing out
  let foot = H.at.xyz + vec3f(0.0, y, 0.0) + radial * (H.n.x + 0.015);
  let size = select(0.075 + 0.05 * hk2, 0.05 + 0.025 * hk2, flower);
  var along = normalize(radial * (0.8 + flutter) + cross(vec3f(0.0, 1.0, 0.0), radial) * side * 0.9 + vec3f(0.0, -0.55 + 0.3 * hk, 0.0));
  var across = normalize(cross(along, radial) + vec3f(1e-4, 0.0, 0.0));
  var p = foot + along * c.y * size * 1.7 + across * c.x * size * 0.6;
  var N = normalize(cross(across, along));
  if (dot(N, radial) < 0.0) { N = -N; }
  if (flower) {
    N = normalize(radial + vec3f(0.0, 0.35, 0.0));
    across = normalize(cross(N, vec3f(0.0, 1.0, 0.0)));
    along = cross(N, across);
    p = foot + radial * 0.03 + (across * c.x + along * (c.y * 2.0 - 1.0)) * size;
  }
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.wp = p;
  o.n = N;
  o.uv = vec2f(c.x, select(c.y, c.y * 2.0 - 1.0, flower));
  o.info = vec4f(select(3.0, 4.0, flower), seed + f32(k) * 0.01, hk2, 0.0);
  return o;
}

/** a stained-glass screen (report 18: the temple's landmark at its edge, at the height of the bodies, the canopy's
 *  glass brought down into the duel's frame): at.xyz the middle of its foot; n: xy its face (outward, toward the court),
 *  z its height, w its width; look: x a seed. One quad, its arched outline, brass frame, leading and panes cut in the
 *  fragment shader */
@vertex fn vs_screen(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  let H = hangs[FIRST + ii];
  let c = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  let nOut = normalize(vec3f(H.n.x, 0.0, H.n.y));
  let across = vec3f(-nOut.z, 0.0, nOut.x);
  let p = H.at.xyz + across * c.x * H.n.w * 0.5 + vec3f(0.0, c.y * H.n.z, 0.0);
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.wp = p;
  o.n = nOut;
  o.uv = vec2f(c.x, c.y);
  o.info = vec4f(5.0, H.look.x, H.n.w / H.n.z, H.n.z);
  return o;
}

/** a pane's glass by a hash (sun gold, teal, coral, leaf, cream, and a deep amber) */
fn paneTint(h: f32) -> vec3f {
  if (h < 0.2) { return vec3f(0.2, 0.8, 0.75); }
  if (h < 0.36) { return vec3f(1.0, 0.42, 0.3); }
  if (h < 0.54) { return vec3f(0.45, 0.85, 0.25); }
  if (h < 0.64) { return vec3f(1.0, 0.94, 0.8); }
  if (h < 0.74) { return vec3f(0.95, 0.5, 0.12); }
  return vec3f(1.0, 0.78, 0.3);
}

/** a screen at uv (x across -1 … 1, y up 0 … 1; aspect: width over height): its pane's tint, how much is lead, how much is
 *  its brass frame, whether uv is inside its arched outline */
struct Glass { tint: vec3f, lead: f32, brass: f32, inside: bool }
fn screenGlass(uv: vec2f, aspect: f32, seed: f32) -> Glass {
  var g: Glass;
  // (in metres-ish: x across from its middle, y up; the arch a half circle on the top)
  let hw = aspect * 0.5;
  let p = vec2f(uv.x * hw, uv.y);
  let springY = 1.0 - hw;
  var outside = abs(p.x) / hw;
  if (p.y > springY) { outside = length(vec2f(p.x, p.y - springY)) / hw; }
  g.inside = outside <= 1.0;
  if (!g.inside) { return g; }
  // the brass frame round it, and a transom where the arch springs
  let frameW = 0.035 / max(hw, 0.1);
  g.brass = max(smoothstep(1.0 - frameW * 1.2, 1.0 - frameW, outside), smoothstep(0.006, 0.003, abs(p.y - springY) / max(hw, 0.1)));
  // the rose in the arch: petals round a sun disc
  var cell = vec2f(0.0);
  var lead = 1.0;
  if (p.y > springY) {
    let q = vec2f(p.x, p.y - springY) / hw;
    let r = length(q);
    let a = atan2(q.y, q.x);
    let ring = floor(r * 3.0);
    let n = 3.0 + ring * 4.0;
    let u = a / 3.1415927 * n + ring * 0.5;
    cell = vec2f(floor(u) + 50.0, ring);
    let fu = fract(u);
    let fr = fract(r * 3.0);
    lead = min(min(fu, 1.0 - fu) * r * 3.0 * 1.2, min(fr, 1.0 - fr) * 1.3);
    if (r < 0.2) { cell = vec2f(99.0, 0.0); lead = (0.2 - r) * 6.0; }
  } else {
    // below: whiplash stems rising (the panes' seams bow), leaves at their sides; panes by a curved grid
    let sx = p.x / hw * 2.0 + 0.22 * sin(p.y * 5.0 + seed * 9.0) * (1.0 - p.y / springY * 0.3);
    let sy = p.y * 3.2 / max(springY, 0.3) + 0.25 * sin(p.x / hw * 3.0 + seed * 4.0);
    cell = vec2f(floor(sx), floor(sy));
    let fx = fract(sx);
    let fy = fract(sy);
    lead = min(min(fx, 1.0 - fx) * hw * 0.9, min(fy, 1.0 - fy) * 0.3);
    // (a leaf in a pane: an oval across it, its own glass)
    let lq = vec2f((fx - 0.5) * 1.3, (fy - 0.5) * 1.0 - (fx - 0.5) * 0.6);
    let leafD = length(lq * vec2f(1.0, 2.2));
    if (hash2i(vec2i(cell) + vec2i(7, 3)) > 0.55 && leafD < 0.42) { cell = cell + vec2f(200.0, 0.0); lead = min(lead, (0.42 - leafD) * 0.35); }
  }
  let h = hash2i(vec2i(cell) + vec2i(i32(seed * 50.0), 1));
  var tint = paneTint(h);
  if (cell.x > 150.0) { tint = select(vec3f(0.35, 0.8, 0.2), vec3f(0.6, 0.9, 0.3), h > 0.5); }
  if (cell.x > 98.0 && cell.x < 100.0) { tint = vec3f(1.0, 0.85, 0.4); }
  g.tint = tint;
  g.lead = 1.0 - smoothstep(0.004, 0.012, lead);
  return g;
}

/** a banner's dye (0 … 4: sun gold, coral, leaf, teal, cream) */
fn dye(k: f32) -> vec3f {
  let i = u32(k + 0.5) % 5u;
  if (i == 0u) { return vec3f(0.95, 0.66, 0.18); }
  if (i == 1u) { return vec3f(0.92, 0.38, 0.3); }
  if (i == 2u) { return vec3f(0.36, 0.62, 0.22); }
  if (i == 3u) { return vec3f(0.16, 0.58, 0.6); }
  return vec3f(0.92, 0.86, 0.72);
}

@fragment fn fs(i: GOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let kind = i.info.x;
  let u = i.uv.x;
  let v = i.uv.y;
  let L = i.info.w;
  if (kind > 4.5) {
    // a stained-glass screen: the light through its panes (the sun when it is behind the glass from the eye, else the
    // sky behind it), the sky and the sun mirrored on its face, the lead dark, the frame brass
    let g = screenGlass(i.uv, i.info.z, i.info.y);
    if (!g.inside) { discard; }
    let V = normalize(frame.camPos - i.wp);
    let n0 = normalize(i.n);
    let nV = select(-n0, n0, dot(V, n0) > 0.0);
    let Ls = worldLight.temple.moon.xyz;
    let sunC = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w;
    let behind = max(-dot(Ls, nV), 0.0);
    let through = templeSky(normalize(vec3f(-V.x, max(-V.y, 0.06), -V.z)), 0.0);
    let swirl = 0.82 + 0.18 * vnoise2(i.uv * vec2f(i.info.w * i.info.z, i.info.w) * 3.0 + i.info.y * 7.0);
    // (deep glass: its colour squared, so a pane is rich, not pastel, in the bright sky behind it)
    let deep = g.tint * g.tint;
    var col = deep * swirl * (through * 0.95 + sunC * (behind * 0.6 + pow(max(dot(-V, Ls), 0.0), 6.0) * 1.6 * behind) + sunC * 0.1);
    let R = reflect(-V, nV);
    let F = 0.04 + 0.96 * pow(1.0 - max(dot(nV, V), 0.0), 5.0);
    let env = templeSky(normalize(vec3f(R.x, abs(R.y), R.z)), 0.0);
    col = col * (1.0 - F) + env * F + sunC * pow(max(dot(R, Ls), 0.0), 400.0) * 4.0;
    let leadCol = vec3f(0.04, 0.03, 0.02) * (sunC * max(dot(nV, Ls), 0.0) + templeAmbient(nV, 1.0, i.wp, 1.0)) + env * F * 0.5;
    col = mix(col, leadCol, g.lead);
    let brass = vec3f(0.95, 0.68, 0.3) * (env * 0.7 + sunC * (pow(max(dot(R, Ls), 0.0), 40.0) * 3.0 + max(dot(nV, Ls), 0.0) * 0.3) + templeAmbient(nV, 1.0, i.wp, 1.0) * 0.25);
    col = mix(col, brass, g.brass);
    col = templeUnder(col, i.wp, vec3f(0.0));
    // (the glass brightens as the answer's light passes: report 20)
    col += deep * swirl * sunC * 1.4 * answerGlow(3u, i.wp) * (1.0 - g.lead);
    return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
  }
  var albedo = vec3f(0.5);
  var gloss = 0.0;
  var through = 0.0;
  if (kind < 0.5) {
    // a banner: cut swallowtail at its foot; a gold border; a leaf up its middle in a paler tint, its veins
    if (v > 0.9 + 0.1 * abs(u)) { discard; }
    let base = dye(i.info.z);
    let border = step(0.84, abs(u)) + step(v * L, 0.06);
    let lv = (v - 0.18) / 0.62;
    let leafW = 0.55 * sin(clamp(lv, 0.0, 1.0) * 3.14159) * (1.0 - 0.3 * lv);
    let inLeaf = step(abs(u), leafW) * step(0.0, lv) * step(lv, 1.0);
    let vein = smoothstep(0.05, 0.0, abs(u)) + smoothstep(0.04, 0.0, abs(fract(lv * 5.0 + abs(u) * 1.6) - 0.5) - 0.42) * step(abs(u), leafW * 0.9);
    albedo = mix(base, mix(vec3f(1.0, 0.97, 0.88), base, 0.45), inLeaf * 0.8);
    albedo = mix(albedo, base * 0.7, inLeaf * min(vein, 1.0) * 0.5);
    albedo = mix(albedo, vec3f(1.0, 0.78, 0.32), min(border, 1.0));
    albedo *= 0.92 + 0.08 * vnoise2(vec2f(u * 20.0, v * L * 30.0));
    through = 0.45;
  } else if (kind < 1.5) {
    // a strand: a thin stem, leaves alternating down it, a flower now and then; the rest of the ribbon isn't there
    let y = v * L;
    let cell = floor(y / 0.07);
    let fy = fract(y / 0.07) - 0.5;
    let sideL = select(-1.0, 1.0, (u32(cell) % 2u) == 0u);
    let h = hash3(vec3f(cell, i.info.y * 97.0, 3.0));
    // (a leaf: an ellipse out to one side, tipped down)
    let q = vec2f(u * sideL - 0.45, fy + (u * sideL) * 0.3);
    let leaf = (q.x * q.x) / 0.22 + (q.y * q.y) / 0.16;
    let stem = abs(u) < 0.12;
    let flower = h > 0.82 && length(vec2f(u * sideL - 0.35, fy)) < 0.42;
    // (the tip: thinner, the last leaf small)
    if (!stem && leaf > 1.0 && !flower) { discard; }
    if (v > 0.985) { discard; }
    albedo = mix(vec3f(0.08, 0.24, 0.05), vec3f(0.3, 0.5, 0.12), h);
    if (flower) {
      albedo = select(select(vec3f(1.0, 0.55, 0.45), vec3f(0.98, 0.52, 0.7), h > 0.9), vec3f(1.0, 0.95, 0.85), h > 0.96);
    }
    through = 0.25;
  } else if (kind > 2.5 && kind < 3.5) {
    // a vine's leaf: a pointed oval from its stalk, a paler midrib, glossy, lit through by the sun behind it
    let w = pow(sin(3.1415927 * min(v * 0.95 + 0.05, 1.0)), 0.8);
    if (abs(u) > w) { discard; }
    albedo = mix(vec3f(0.05, 0.17, 0.035), vec3f(0.2, 0.38, 0.07), i.info.z) * (1.0 + 0.5 * smoothstep(0.12, 0.0, abs(u)));
    through = 0.6;
    gloss = 0.25;
  } else if (kind > 3.5 && kind < 4.5) {
    // a vine's flower: five petals round a gold eye (jasmine cream, coral, sun gold, peach)
    let r = length(vec2f(u, v));
    let a = atan2(v, u);
    if (r > 0.55 + 0.45 * pow(abs(cos(a * 2.5)), 0.6)) { discard; }
    let k = i.info.z;
    var petal = vec3f(1.0, 0.96, 0.88);
    if (k > 0.75) { petal = vec3f(1.0, 0.5, 0.38); } else if (k > 0.55) { petal = vec3f(1.0, 0.76, 0.28); } else if (k > 0.4) { petal = vec3f(1.0, 0.68, 0.52); }
    albedo = mix(petal, vec3f(0.95, 0.6, 0.1), smoothstep(0.28, 0.2, r));
    through = 0.7;
  } else {
    // a chime's tube: bronze gone green, a bright line down it where the sky catches its curve
    albedo = mix(vec3f(0.5, 0.36, 0.18), vec3f(0.25, 0.55, 0.45), smoothstep(0.3, 0.7, vnoise2(vec2f(u * 3.0, v * 12.0 + i.info.y * 20.0))));
    albedo *= 0.75 + 0.5 * (1.0 - u * u);
    gloss = 0.8;
  }
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let V = normalize(frame.camPos - i.wp);
  let Ls = worldLight.temple.moon.xyz;
  let sun = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w * templeShadow(i.wp) * templeCanopy(i.wp);
  let diff = max(dot(N, Ls), 0.0);
  // (the sun behind it shining through the cloth or the leaf)
  let back = max(-dot(N, Ls), 0.0) * through;
  var col = albedo * (sun * (diff * 0.85 + back) + templeAmbient(N, 1.0, i.wp, 1.0));
  let R = reflect(-V, N);
  col += sun * pow(max(dot(R, Ls), 0.0), 40.0) * gloss;
  col = templeUnder(col, i.wp, albedo * sun * diff);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

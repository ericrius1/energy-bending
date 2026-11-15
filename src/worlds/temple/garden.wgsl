// What hangs in the Tide Temple's air (garden.ts lays it out): banners of dyed cloth, strands of flowering vine and wind
// chimes, each a ribbon hanging from a stone's edge, moving in the sea air. A banner is a sheet facing out of the face it
// hangs from, swaying and rippling (more toward its foot), cut swallowtail, dyed in the palette (sun gold, coral, leaf,
// teal, cream) with a leaf in a paler tint up its middle and a gold border, the sun glowing through it from behind; a
// strand turns to the eye, leaves alternating down a stem and a flower here and there (the rest of the ribbon dropped);
// a chime's tube is bronze gone green, swinging a little. Lit as the stones are: the sun (the pillars' shadows, the
// stained glass's colour), the sky, the court's bounce. Opaque, its alpha the view distance (the depth contract). Not a
// solid: the near fade leaves it alone, as it does the redwoods' ferns.
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
  let p = H.at.xyz - vec3f(0.0, s * H.n.z, 0.0) + across * u * H.n.w * 0.5 + nOut * (w.x + ripple) + across * w.y;
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
  let kind = i.info.x;
  let u = i.uv.x;
  let v = i.uv.y;
  let L = i.info.w;
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

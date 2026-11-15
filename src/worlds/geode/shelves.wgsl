// The geode's great crystals (shelves.ts): the stage's blades of selenite, the druses they grow from, the clusters round
// the wall and the rings round the gates. Each a long prism of eight faces (a flat top, its long edges bevelled) running
// from its root to a chisel tip, made from the vertex index. Faceted (the normal is each face's own, each face shaded a
// little its own way), milky and fibrous along their length: a satin sheen across the fibres, the studio and the wall's
// veins in their faces, light gathering inside them toward the tip and along their long edges. Selenite glows honey;
// a gate's crystals glow in its world's colour, the wall's great crystals in its veins'. The greenhouse (phase 4): moss
// grown over the selenite's tops with small flowers in it (cream, coral, gold), and vines hanging from their edges down
// their faces, more of both on the bigger blades.
#include "weft/frame"
#include "../light"

struct Blade {
  at: vec4f,     // where its top's middle leaves the wall; w: its turn about up
  size: vec4f,   // width, thickness, length; w: its tilt up from level
  look: vec4f,   // x: how long its chisel tip is, y: a seed, z: its tint (-1 selenite, 0 … 3 a gate's world, 4 the wall's veins), w: its glow
}

@group(1) @binding(0) var<storage, read> blades: array<Blade>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) local: vec3f,
  @location(2) @interpolate(flat) axis: vec3f,
  @location(3) @interpolate(flat) look: vec4f,   // its length, the seed, the tint, the glow
  @location(4) @interpolate(flat) size: vec2f,   // width, thickness
  @location(5) @interpolate(flat) pitch: f32,     // its tilt up from level (a beam stands at a quarter turn)
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
  o.look = vec4f(b.size.z, b.look.y, b.look.z, b.look.w);
  o.size = b.size.xy;
  o.pitch = b.size.w;
  return o;
}


@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  let L = worldLight.geode;
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  if (dot(N, V) < 0.0) { N = -N; }
  let T = i.axis;
  let seed = i.look.y;
  let along = clamp(i.local.z / max(i.look.x, 1e-3), 0.0, 1.0);
  // the fibres: fine streaks along the blade, a few cloudier bands
  // (fine across the blade, long along it: streaks down its faces, a speckle on its ends)
  let fib = 0.35 + 0.3 * vnoise(vec3f(i.local.x * 22.0, i.local.y * 22.0, i.local.z * 0.35 + seed * 20.0)) + 0.35 * vnoise(vec3f(i.local.x * 7.0, i.local.y * 7.0, i.local.z * 0.15 + seed * 9.0));
  let cloud = vnoise(vec3f(i.local.x * 3.0, i.local.y * 3.0, i.local.z * 0.8 + seed * 7.0));
  // its stone: selenite's milky honey, or a crystal in its gate's colour (or the wall's vein where it grew)
  var body = mix(vec3f(0.7, 0.64, 0.56), vec3f(0.95, 0.87, 0.76), fib) * (0.55 + 0.6 * cloud) * (0.6 + 0.8 * fib);
  var glowCol = mix(L.cave.rgb, vec3f(1.0, 0.8, 0.55), 0.35);
  if (i.look.z > -0.5) {
    var tc = geodeGateTint(i.look.z);
    if (i.look.z > 3.5) { tc = geodeVein(i.wp - T * i.local.z); }
    body = mix(vec3f(0.8), tc, 0.75) * (0.65 + 0.35 * fib) * (0.8 + 0.3 * cloud);
    glowCol = tc;
  }
  // each face its own shade (they're turned a little differently), and the long edges a line of light
  let faceH = fract(sin(dot(floor(N * 6.0 + 0.5), vec3f(12.9898, 78.233, 37.719)) + seed * 17.0) * 43758.5453);
  let ex = max(i.size.x * 0.5 - abs(i.local.x), 0.0);
  let ey = max(min(-i.local.y, i.size.y + i.local.y), 0.0);
  let edge = smoothstep(0.1, 0.02, ex + ey);
  let key = worldKey(i.wp, true, 0.0);
  let Ld = key.dir;
  let diff = max(dot(N, Ld), 0.0);
  let cosV = max(dot(N, V), 0.0);
  let fres = 0.05 + 0.95 * pow(1.0 - cosV, 5.0);
  let R = reflect(-V, N);
  // where it leaves the wall (or the floor) it's in the shade; further out it's in the light
  let out = smoothstep(0.0, 1.8, i.local.z);
  // little lit on its faces (it's clear stone, not paint): most of what shows is what it reflects and what glows in it
  var col = body * (key.col * diff * 0.07 + geodeAmbient(N, 0.6 + 0.4 * out) * 0.06) * (0.35 + 0.65 * out) * (0.6 + 0.8 * faceH);
  // the dancers' fire on the stone (worlds/light.wgsl worldFire)
  col += body * worldFire(i.wp, N) * 0.5;
  // the satin sheen across the fibres (anisotropic: brightest where the half-way vector is across them)
  let H = normalize(Ld + V);
  let th = dot(T, H);
  col += key.col * pow(sqrt(max(1.0 - th * th, 0.0)), 90.0) * 0.25 * (0.5 + 0.5 * fib) * out;
  // what its faces mirror: the studio, and the wall's veins round it
  col += (studio(R) * 0.3 + geodeWallSoft(i.wp, R) * 2.0) * fres * (0.5 + 0.8 * faceH);
  // the glow inside it, brightest where it's seen edge on (a long way through it), along its fibres toward the tip,
  // gathering in its long edges and its tip; a coloured crystal glows more, and breathes
  let through = 0.25 + 0.75 * pow(1.0 - cosV, 2.0);
  let breathe = 0.8 + 0.2 * sin(frame.time * 0.5 + seed * 40.0);
  let inner = L.cave.w * (0.35 + 0.65 * cloud) * (0.25 + 0.75 * along) * through * 0.8 + i.look.w * 0.22 * breathe * (0.3 + 0.7 * through);
  col += glowCol * mix(body, vec3f(1.0), 0.3) * inner * 0.7;
  col += glowCol * edge * (0.15 + 0.6 * along) * (L.cave.w * 0.6 + i.look.w * 0.35) * breathe;
  col += glowCol * smoothstep(0.82, 1.0, along) * (0.25 + i.look.w * 0.4) * L.cave.w;
  // a glint where a face turns the softbox to the eye
  col += vec3f(1.0, 0.97, 0.92) * pow(max(dot(R, Ld), 0.0), 120.0) * key.glint * 0.8 * step(0.5, faceH);
  // the greenhouse (selenite only, and blades big enough to hold soil): moss over what faces up, flowers in it; vines
  // hanging from the top edge down the faces (how far below the top: a shelf's own depth, a beam's from its flat top)
  if (i.look.z < -0.5 && L.green > 0.0 && i.size.x > 0.25) {
    let sp = sin(i.pitch);
    let below = -i.local.y * cos(i.pitch) + (i.look.x - i.local.z) * sp;
    let up = max(N.y, 0.0);
    let lightUp = (geodeAmbient(vec3f(0.0, 1.0, 0.0), 0.8) * 0.12 + key.col * 0.08 + GEO_SUN * 0.03 * L.sun.w);
    // (in cushions: thick in places, thin to the stone at their edges, never a felt over the whole top)
    let cushion = vnoise(i.wp * 2.3 + vec3f(seed * 9.0)) * 0.7 + vnoise(i.wp * 7.0) * 0.3;
    let mossy = smoothstep(0.6, 0.9, up) * smoothstep(0.42, 0.62, cushion) * L.green;
    var moss = GEO_MOSS * (0.35 + 0.9 * vnoise(i.wp * 18.0)) * (0.6 + 0.6 * cushion) * lightUp * 1.5;
    // flowers: a few cells of a fine grid on the moss hold one, cream, coral or gold
    let fc = floor(i.wp.xz / 0.11);
    let fh = fract(sin(vec3f(dot(fc, vec2f(12.9898, 78.233)), dot(fc, vec2f(39.35, 11.13)), dot(fc, vec2f(73.1, 51.7))) + seed) * 43758.5453);
    let bloom = step(0.9, fh.x) * smoothstep(0.32, 0.12, length(fract(i.wp.xz / 0.11) - 0.5));
    let petal = select(select(vec3f(1.0, 0.94, 0.82), vec3f(1.0, 0.5, 0.42), fh.y > 0.55), vec3f(1.0, 0.78, 0.3), fh.y > 0.85);
    moss = mix(moss, petal * (lightUp * 3.0 + 0.02), bloom * smoothstep(0.7, 0.95, up));
    col = mix(col, moss, mossy);
    // vines: strands along the top edge, each its own length, wavering as they hang
    let u = mix(i.local.z + i.local.x * 1.7, i.local.x + i.local.y * 1.7, sp) / 0.16;
    let vh = fract(sin(floor(u) * 91.7 + seed * 37.0) * 43758.5453);
    let hangs = 0.12 + 0.9 * fract(vh * 7.31);
    let wig = 0.5 + 0.18 * sin(below * 6.0 + vh * 30.0);
    // (a strand of leaves: its stem's line, the leaves either side in a broken chain)
    let leaves = smoothstep(0.35, 0.65, vnoise(vec3f(u * 1.3, below * 13.0, seed * 5.0)));
    let vine = step(0.72, vh) * smoothstep(0.16 + 0.22 * leaves, 0.06 + 0.12 * leaves, abs(fract(u) - wig)) * smoothstep(hangs, hangs - 0.15, below) * step(0.01, below)
      * (1.0 - up) * L.green;
    let leaf = 0.5 + 0.7 * leaves;
    col = mix(col, GEO_LEAF * lightUp * 1.1 * leaf, vine * (0.55 + 0.45 * leaves));
  }
  return vec4f(sightLit(col), dot(i.wp - frame.camPos, frame.camFwd));
}

// The cave behind the dancers: the hollow's wall all round and over (geode.wgsl geodeWall: faces of crystal in veins
// of colour, glowing from within, the vault's opening over the stage), and the floor, a polished slab of banded agate
// with a pool of light under the shaft from above; under the shaft the light lands as a net of caustics (it came down
// through water). The polish mirrors the wall's glow (softly) and the key, so no part of the floor is a black hole, and
// a path worn smooth runs from the middle to each gate, lit at its end by the world beyond. Drawn first, with no
// depth; the wall's own gem crystals and the mirrored stones are drawn on top of it. Alpha carries the distance along
// the view, for the light in the air and the depth of field. In the duel, its arena's drops crack the agate
// (worlds/drops.wgsl): the slab's bands run on down their sides into the dark, fungi and a druse glowing far below.
// The greenhouse (phase 4): the light wells' sun lands in warm pools on the agate, each with a prism's rainbow beside
// it, and moss has grown in over the floor's edge round the wall's foot.
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"
#include "../drops"

/** how much of a worn path to a gate lies under floor point q (1 on it), and that gate's tint × how near its end */
fn geodePaths(q: vec2f) -> vec4f {
  var on = 0.0;
  var tint = vec3f(0.0);
  for (var k = 0; k < 3; k++) {
    let g = worldLight.geode.gates[k];
    if (g.z <= 0.0) { continue; }
    // from near the middle of the floor to the foot of the gate
    let a = g.xy * 0.3;
    let b = g.xy * 0.97;
    let ab = b - a;
    let s = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
    let dist = length(q - a - ab * s);
    // (ragged at its edges, wider where feet turned toward the door)
    let w = g.z * (0.8 + 0.4 * s) * (0.85 + 0.3 * vnoise2(q * 2.3));
    let p = smoothstep(w, w * 0.35, dist) * smoothstep(0.0, 0.25, s);
    on = max(on, p);
    let near = exp(-dot(q - g.xy, q - g.xy) / 2.2);
    tint += geodeGateTint(g.w) * (p * s * s * 0.6 + near);
  }
  return vec4f(tint, on);
}

// ---------------------------------------------------------------- the mosaic (phase 5, report 18)
// The floor is no longer a texture of agate rings (it read as brown and cream wood grain at 720p): it is a glazed
// mosaic, a material that answers the light. A petal mandala round the stage's middle in small tesserae laid along its
// rings (a sun disc of gold glaze, a crown of coral and sun-gold petals, a ring of leaves in leaf green and sky teal, a
// band of cream lotus petals with terracotta tips), brass inlaid between the rings and round the petals, then a field
// of larger cream tiles and, toward the wall, honey terracotta. Each tile is set a little askew (its own small tilt), so
// the glaze catches the softbox, the wells and the great window tile by tile; grout between them, which the distance
// blurs into an even tone rather than shimmer.

struct Mosaic { col: vec3f, brass: f32, grout: f32, tilt: vec2f }

const MO_CREAM = vec3f(0.93, 0.88, 0.78);
const MO_CORAL = vec3f(0.9, 0.42, 0.3);
const MO_GOLD = vec3f(0.95, 0.7, 0.26);
const MO_LEAF = vec3f(0.34, 0.6, 0.26);
const MO_TEAL = vec3f(0.24, 0.6, 0.6);
const MO_TERRA = vec3f(0.78, 0.44, 0.28);

/** a tile's random numbers (three) from its cell */
fn moRand(c: vec2f) -> vec3f { return causticRand(vec2i(c) + vec2i(77, 13)); }

/** how much grout at a tile's local coordinate f (0 … 1 across it), size m (metres), fw the pixel's size (m): 1 in the
 *  grout, and a flat mean once the tiles are smaller than a few pixels */
fn moGrout(f: vec2f, m: f32, fw: f32) -> f32 {
  let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * m;
  let g = (1.0 - smoothstep(0.002, 0.002 + fw * 0.7, e)) * smoothstep(m * 0.25, m * 0.06, fw);
  return mix(g, 0.06, smoothstep(m * 0.06, m * 0.25, fw));
}

fn geodeMosaic(xz: vec2f, fw: f32) -> Mosaic {
  var o: Mosaic;
  let r = length(xz);
  let th = atan2(xz.y, xz.x);
  let u = th / 6.2831853 + 0.5;
  // the brass rings between the bands, and the bands themselves
  let rings = array<f32, 5>(0.78, 2.45, 4.3, 6.5, 7.6);
  var bd = 9.0;
  for (var k = 0; k < 5; k++) { bd = min(bd, abs(r - rings[k])); }
  let ringW = 0.022;
  var brass = 1.0 - smoothstep(ringW, ringW + fw * 1.5, bd);
  var col = MO_CREAM;
  var tile = 0.055;
  if (r < 7.6) {
    // tesserae along the rings: rows `tile` deep, each row cut into a whole number of tiles round
    let row = floor(r / tile);
    let n = max(round(6.2831853 * (row + 0.5) * tile / tile), 6.0);
    let cell = vec2f(row, floor(u * n));
    let f = vec2f(fract(r / tile), fract(u * n));
    let h = moRand(cell);
    o.grout = moGrout(f, tile, fw);
    o.tilt = (h.xy - 0.5) * 0.09;
    let jit = 0.92 + 0.14 * h.z;
    if (r < 0.78) {
      // the sun disc: gold glaze, its rays coral and gold
      let rays = abs(fract(u * 16.0) - 0.5) * 2.0;
      col = select(MO_GOLD * 1.1, mix(MO_CORAL, MO_GOLD, step(0.5, fract(u * 8.0))), r > 0.32 + 0.3 * (1.0 - rays));
      brass = max(brass, 1.0 - smoothstep(0.015, 0.015 + fw * 1.5, abs(r - 0.32)));
    } else if (r < 2.45) {
      // twelve petals, coral and sun gold in turn, on cream
      let a = (fract(u * 12.0) - 0.5) * 6.2831853 / 12.0 * r;
      let t = (r - 0.78) / (2.45 - 0.78);
      let w = 0.48 * sin(3.14159 * pow(t, 0.75)) * (r / 2.45 + 0.35);
      let pd = abs(a) - w;
      col = select(MO_CREAM, select(MO_CORAL, MO_GOLD, fract(u * 6.0) > 0.5), pd < 0.0);
      brass = max(brass, 1.0 - smoothstep(0.012, 0.012 + fw * 1.5, abs(pd)) * step(0.02, t));
    } else if (r < 4.3) {
      // a ring of 24 leaves, leaf green and sky teal, each with its midrib
      let a = (fract(u * 24.0) - 0.5) * 6.2831853 / 24.0 * r;
      let t = (r - 2.45) / (4.3 - 2.45);
      let w = 0.36 * sin(3.14159 * t);
      let pd = abs(a) - w;
      col = select(MO_CREAM, select(MO_LEAF, MO_TEAL, fract(u * 12.0) > 0.5), pd < 0.0);
      col = mix(col, MO_CREAM * 0.95, (1.0 - smoothstep(0.012, 0.024, abs(a))) * step(pd, 0.0) * step(0.15, t));
      brass = max(brass, 1.0 - smoothstep(0.012, 0.012 + fw * 1.5, abs(pd)));
    } else if (r < 6.5) {
      // a band of cream lotus petals, their tips terracotta, gold between them
      let a = (fract(u * 32.0) - 0.5) * 6.2831853 / 32.0 * r;
      let t = (r - 4.3) / (6.5 - 4.3);
      let w = 0.6 * sqrt(max(sin(3.14159 * min(t * 1.1, 1.0)), 0.0));
      let pd = abs(a) - w;
      col = select(mix(MO_GOLD, MO_CREAM, 0.35), mix(vec3f(0.98, 0.95, 0.88), MO_TERRA, smoothstep(0.6, 0.9, t)), pd < 0.0);
      brass = max(brass, 1.0 - smoothstep(0.012, 0.012 + fw * 1.5, abs(pd)));
    } else {
      // a ring of small flowers on cream: a coral heart every metre or so
      let a = (fract(u * 40.0) - 0.5) * 6.2831853 / 40.0 * r;
      let fl = length(vec2f(a, r - 7.05));
      col = select(MO_CREAM, select(MO_CORAL, MO_GOLD, fl < 0.08), fl < 0.2);
    }
    col *= jit;
  } else {
    // the field: cream tiles 30 cm square, then honey terracotta toward the wall
    let terra = smoothstep(8.6, 9.6, r + (vnoise2(xz * 0.4) - 0.5) * 1.2);
    tile = mix(0.3, 0.42, terra);
    let q = xz / tile + vec2f(0.5 * step(0.5, fract(floor(xz.y / tile) * 0.5)), 0.0) * terra;
    let cell = floor(q);
    let h = moRand(cell + 300.0);
    o.grout = moGrout(fract(q), tile, fw) * 0.6;
    o.tilt = (h.xy - 0.5) * 0.05;
    col = mix(MO_CREAM * (0.94 + 0.1 * h.z), MO_TERRA * (0.85 + 0.25 * h.z), terra);
    // (now and then a tile painted with a leaf, in the cream field)
    col = mix(col, MO_LEAF, step(0.93, h.x) * (1.0 - terra) * smoothstep(0.32, 0.18, length(fract(q) - 0.5)));
  }
  o.col = col;
  o.brass = brass;
  return o;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let L = worldLight.geode;
  let d = viewRay(i.uv);
  let cam = frame.camPos;
  let horizon = mix(L.bgBottom.rgb, L.bgTop.rgb, 0.35);
  // the wall, unless the floor comes first
  let tw = geodeWallT(cam, d);
  var t = tw;
  var floorHit = false;
  if (d.y < 0.0) {
    let tf = (L.floorY - cam.y) / d.y;
    if (tf > 0.0 && tf < tw) { t = tf; floorHit = true; }
  }
  let p = cam + d * t;
  // (a floor pixel's size in metres, for the mosaic's grout: here, in uniform control flow)
  let fw = length(fwidth(p.xz));
  var c = vec3f(0.0);
  let dh = dropHit(cam, d, t, L.floorY, 2.4, L.dropFrame, L.drops[0], L.drops[1]);
  if (!floorHit) {
    c = geodeWall(p, d);
  } else if (dh.inside) {
    // a drop: the agate's bands seen in section down its sides, darkening into the hollow under the floor, where a druse
    // glows violet; its bottom a bed of small points catching that light
    t = dh.t;
    let q = cam + d * t;
    let along = dot(q.xz, vec2f(-dh.n.z, dh.n.x));
    let bands = 0.5 + 0.5 * sin(dh.below * 9.0 + fbm(vec3f(along * 0.8, dh.below * 2.0, 1.7)) * 3.0);
    let slab = mix(L.floorCol.rgb * 0.05, L.floorBand.rgb, bands * L.floorBand.w);
    let deep = exp(-dh.below * 1.4);
    let glow = mix(L.cave.rgb, GEO_FUNGI, 0.45) * L.cave.w * 0.35 * smoothstep(0.6, 2.4, dh.below) * (0.6 + 0.4 * vnoise2(vec2f(along, dh.below) * 4.0));
    let bed = select(0.0, smoothstep(0.55, 0.9, vnoise2(q.xz * 9.0)), dh.floor > 0.5);
    c = slab * (0.1 + 0.25 * deep) + glow * (1.0 + bed * 2.0) + L.rim.rgb * 0.02 * deep;
    c = mix(c, horizon, 1.0 - exp(-t * L.fog));
  } else {
    let r = length(p.xz - L.pool.xy);
    let pool = exp(-r * r / (L.pool.w * L.pool.w));
    // the mosaic (geodeMosaic): its tile's glaze colour, brass inlay, grout and tilt
    let M = geodeMosaic(p.xz, fw);
    let band = 0.6;
    // the paths to the gates: worn smooth (the polish brighter), lit by the gate at its end
    let path = geodePaths(p.xz);
    let grout = M.grout * (1.0 - M.brass);
    let brassCol = vec3f(0.95, 0.68, 0.32);
    var slab = mix(M.col * 0.85, vec3f(0.3, 0.25, 0.18), grout);
    slab = mix(slab, brassCol * 0.35, M.brass);
    // under the shaft the pool's light comes through the water, gathered into a net, and the light itself lands
    // there as a soft warm net of its own
    let u = causticU(p, L.shaft, L.shaftCol.w);
    let under = smoothstep(1.15, 0.5, length(u)) * L.caustic.x;
    var net = 1.0;
    var lines = 0.0;
    if (under > 0.0) {
      let cl = causticLight(u, L.caustic.y, frame.time * L.caustic.z, true);
      net = mix(1.0, cl, under);
      lines = max(cl - 1.0, 0.0) * under;
    }
    // (the greenhouse's daylight on the whole floor, not only the pool under the shaft)
    var f = slab * (0.09 + 0.12 * L.sun.w + pool * 0.7 * net) + L.floorCol.rgb * pool * 0.08 * net * (1.0 - grout);
    // the dancers' fire on the glaze (worlds/light.wgsl worldFire)
    f += (slab + L.floorCol.rgb * 0.05) * worldFire(p, vec3f(0.0, 1.0, 0.0));
    f += vec3f(1.0, 0.95, 0.88) * lines * 0.06 * (1.0 - grout);
    // the great window's light coming in along the sun: its colours laid on the floor in front of it
    f += (slab * 1.6 + vec3f(0.02)) * geodeWindowFloor(p) * 0.55;
    // the glaze: each tile set a little askew mirrors the softbox, the wall's glow and the great window, a lot at a
    // glance along it, less looking straight down (Fresnel); brass mirrors them warm and sharper; grout mirrors nothing
    let N = normalize(vec3f(M.tilt.x, 1.0, M.tilt.y));
    let kd = normalize(L.key.xyz);
    let refl = reflect(d, N);
    let cosV = max(-dot(d, N), 0.0);
    let fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
    let gloss = L.floorGloss * (1.0 + path.w * 0.5) * (1.0 - grout);
    let env = studio(refl) * 0.045 + geodeWallSoft(p, refl);
    let glint = vec3f(1.0, 0.96, 0.9) * (pow(max(dot(refl, kd), 0.0), 220.0) * 0.6 + pow(max(dot(refl, kd), 0.0), 24.0) * 0.04);
    let glaze = (env + glint) * fres * gloss * (1.0 - M.brass);
    let metal = (env * 2.2 + glint * 2.0) * brassCol * (0.35 + 0.65 * fres) * M.brass;
    f += glaze + metal;
    // each gate's own light spilling onto its path
    f += path.rgb * 0.035 * (1.0 - grout);
    // the light wells' sun on the agate: a warm pool where each beam lands, and beside it the rainbow a crystal in the
    // beam lays down as a prism would
    for (var k = 0; k < 4; k++) {
      let W = L.wells[k];
      if (W.w <= 0.0) { continue; }
      let F = geodeWellFloor(k);
      let q = p.xz - F.xz;
      let rr = length(q) / (W.w * 1.25);
      f += (slab * 1.4 + vec3f(0.035)) * GEO_SUN * exp(-rr * rr * 2.2) * L.sun.w * 1.6;
      let a = f32(k) * 2.1 + 0.6;
      let dir = vec2f(cos(a), sin(a));
      let o = q - dir * W.w * 2.0;
      let h = dot(o, vec2f(-dir.y, dir.x)) / (W.w * 0.75) * 0.5 + 0.5;
      let along = dot(o, dir) / (W.w * 1.2);
      f += geodeSpectrum(h) * exp(-along * along) * 0.035 * L.sun.w * (0.7 + 0.3 * band);
    }
    // moss grown in over the agate at the edge of the floor, round the wall's foot
    let rr = length(p.xz);
    let edge = smoothstep(8.6, 11.0, rr + (vnoise2(p.xz * 0.6) - 0.5) * 2.4) * L.green;
    f = mix(f, GEO_MOSS * (0.012 + 0.02 * vnoise2(p.xz * 5.0)) * (1.0 + L.sun.w), edge * 0.9);
    // the water channel round the floor's edge at the crystal's foot (phase 6): clear water over pale stones in a channel
    // of cream stone, mirroring the glass vault and the sun, the light netting its bed
    let inCh = smoothstep(11.0, 11.06, rr) * smoothstep(11.9, 11.84, rr);
    if (inCh > 0.0) {
      let tw = frame.time;
      let wn = normalize(vec3f(0.04 * sin(p.x * 3.1 + tw * 1.3) + 0.03 * sin(p.z * 4.3 - tw * 1.1), 1.0, 0.04 * sin(p.z * 2.7 + tw * 1.2) + 0.03 * sin(p.x * 5.1 + tw * 0.9)));
      let wr = reflect(d, wn);
      let wf = 0.03 + 0.97 * pow(1.0 - max(-dot(d, wn), 0.0), 5.0);
      let bed = vec3f(0.55, 0.62, 0.52) * (0.6 + 0.4 * vnoise2(p.xz * 7.0));
      let net = causticLight(p.xz * 0.5, 3.0, tw * 0.6, false);
      let below = bed * vec3f(0.55, 0.85, 0.8) * (0.06 + 0.12 * L.sun.w) * net;
      let above = geodeSky(normalize(vec3f(wr.x, max(wr.y, 0.05), wr.z))) * (0.55 + 0.45 * L.sun.w);
      f = mix(f, mix(below, above, wf * 0.9 + 0.08), inCh);
    }
    let coping = max(smoothstep(0.09, 0.05, abs(rr - 10.98)), smoothstep(0.09, 0.05, abs(rr - 11.92)));
    f = mix(f, vec3f(0.9, 0.84, 0.7) * (0.12 + 0.16 * L.sun.w) * (0.85 + 0.15 * vnoise2(p.xz * 9.0)), coping);
    c = mix(f, horizon, 1.0 - exp(-t * L.fog));
  }
  // a soft halo round the stage, over the wall and the floor alike
  let toStage = normalize(vec3f(L.pool.x, L.floorY + 1.0, L.pool.y) - cam);
  c += L.rim.rgb * pow(max(dot(d, toStage), 0.0), 12.0) * 0.012;
  return vec4f(c, min(t * dot(d, frame.camFwd), 30000.0));
}

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
    // agate: rings round the middle of the slab, wandering, with finer bands inside the broad ones
    let q = p.xz * 0.55;
    let warp = fbm(vec3f(q * 0.7, 3.1)) * 2.2 + fbm(vec3f(q * 2.3, 7.7)) * 0.35;
    let rr = length(p.xz) * 0.9 + warp;
    let broad = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(rr * 3.1));
    let fine = 0.5 + 0.5 * sin(rr * 23.0 + warp * 4.0);
    var band = mix(broad, fine, 0.3);
    // the paths to the gates: worn smooth (the fine bands rubbed out, the polish brighter), lit by the gate at its end
    let path = geodePaths(p.xz);
    band = mix(band, broad * 0.6 + 0.2, path.w * 0.7);
    // (honey and cream: the dark between the bands a warm brown, not black, since phase 4)
    let slab = mix(L.floorCol.rgb * 0.22, L.floorBand.rgb, band * L.floorBand.w);
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
    // (the greenhouse's daylight on the whole slab, not only the pool under the shaft)
    var f = slab * (0.12 + 0.16 * L.sun.w + pool * 0.8 * net) + L.floorCol.rgb * pool * 0.12 * (0.6 + 0.4 * band) * net;
    // the dancers' fire on the polished slab (worlds/light.wgsl worldFire)
    f += (slab + L.floorCol.rgb * 0.05) * worldFire(p, vec3f(0.0, 1.0, 0.0));
    f += vec3f(1.0, 0.95, 0.88) * lines * 0.06 * (0.6 + 0.4 * band);
    // the key's long highlight on the polish, and what the polish reflects: the studio and the wall's glow, a lot at a
    // glance along it, less looking straight down (Fresnel), more on the worn paths
    let kd = normalize(L.key.xyz);
    let refl = vec3f(d.x, -d.y, d.z);
    let fres = 0.04 + 0.96 * pow(max(1.0 - abs(d.y), 0.0), 5.0);
    let gloss = L.floorGloss * (1.0 + path.w * 0.8);
    f += vec3f(1.0, 0.96, 0.92) * pow(max(dot(refl, kd), 0.0), 160.0) * gloss * 0.25 * fres;
    f += studio(refl) * gloss * 0.015 * (0.6 + 0.4 * band) * fres * 3.0;
    f += geodeWallSoft(p, refl) * gloss * (0.25 + 0.75 * fres) * (0.5 + 0.5 * band);
    // each gate's own light spilling onto its path
    f += path.rgb * 0.035 * (0.5 + 0.5 * band);
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
    let edge = smoothstep(8.6, 11.0, length(p.xz) + (vnoise2(p.xz * 0.6) - 0.5) * 2.4) * L.green;
    f = mix(f, GEO_MOSS * (0.012 + 0.02 * vnoise2(p.xz * 5.0)) * (1.0 + L.sun.w), edge * 0.9);
    c = mix(f, horizon, 1.0 - exp(-t * L.fog));
  }
  // a soft halo round the stage, over the wall and the floor alike
  let toStage = normalize(vec3f(L.pool.x, L.floorY + 1.0, L.pool.y) - cam);
  c += L.rim.rgb * pow(max(dot(d, toStage), 0.0), 12.0) * 0.012;
  return vec4f(c, min(t * dot(d, frame.camFwd), 30000.0));
}

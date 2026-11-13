// The cave behind the dancers: the dark of a hollow geode (its crystal walls are stones of their own, drawn after
// this), and the floor, a polished slab of banded agate with a pool of light under the shaft from above, fading into
// the dark; under the shaft the light lands as a net of caustics (it came down through water, geode.wgsl). Drawn first, with no
// depth; the mirrored stones are added on top of it for the reflection. Alpha carries
// the distance along the view, for the light in the air and the depth of field.
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  let horizon = mix(worldLight.geode.bgBottom.rgb, worldLight.geode.bgTop.rgb, 0.35);
  var c = mix(horizon, worldLight.geode.bgTop.rgb, smoothstep(0.0, 0.7, d.y));
  var depth = 80.0;
  if (d.y < 0.0) {
    let t = (worldLight.geode.floorY - frame.camPos.y) / d.y;
    if (t > 0.0) {
      let p = frame.camPos + d * t;
      depth = t * dot(d, frame.camFwd);
      let r = length(p.xz - worldLight.geode.pool.xy);
      let pool = exp(-r * r / (worldLight.geode.pool.w * worldLight.geode.pool.w));
      // agate: rings round the middle of the slab, wandering, with finer bands inside the broad ones
      let q = p.xz * 0.55;
      let warp = fbm(vec3f(q * 0.7, 3.1)) * 2.2 + fbm(vec3f(q * 2.3, 7.7)) * 0.35;
      let rr = length(p.xz) * 0.9 + warp;
      let broad = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(rr * 3.1));
      let fine = 0.5 + 0.5 * sin(rr * 23.0 + warp * 4.0);
      let band = mix(broad, fine, 0.3);
      let slab = mix(worldLight.geode.floorCol.rgb * 0.05, worldLight.geode.floorBand.rgb, band * worldLight.geode.floorBand.w);
      // under the shaft the pool's light comes through the water, gathered into a net, and the light itself lands
      // there as a soft warm net of its own
      let u = causticU(p, worldLight.geode.shaft, worldLight.geode.shaftCol.w);
      let under = smoothstep(1.15, 0.5, length(u)) * worldLight.geode.caustic.x;
      var net = 1.0;
      var lines = 0.0;
      if (under > 0.0) {
        let L = causticLight(u, worldLight.geode.caustic.y, frame.time * worldLight.geode.caustic.z, true);
        net = mix(1.0, L, under);
        lines = max(L - 1.0, 0.0) * under;
      }
      var f = slab * (0.12 + pool * 0.8 * net) + worldLight.geode.floorCol.rgb * pool * 0.12 * (0.6 + 0.4 * band) * net;
      // the dancers' fire on the polished slab (worlds/light.wgsl worldFire)
      f += (slab + worldLight.geode.floorCol.rgb * 0.05) * worldFire(p, vec3f(0.0, 1.0, 0.0));
      f += vec3f(1.0, 0.95, 0.88) * lines * 0.06 * (0.6 + 0.4 * band);
      // the key's long highlight on the polish, and what the polish reflects: a lot at a glance along it, next to
      // nothing looking straight down (Fresnel)
      let kd = normalize(worldLight.geode.key.xyz);
      let refl = vec3f(d.x, -d.y, d.z);
      let fres = 0.04 + 0.96 * pow(max(1.0 - abs(d.y), 0.0), 5.0);
      f += vec3f(1.0, 0.96, 0.92) * pow(max(dot(refl, kd), 0.0), 160.0) * worldLight.geode.floorGloss * 0.25 * fres;
      f += studio(refl) * worldLight.geode.floorGloss * 0.015 * (0.6 + 0.4 * band) * fres * 3.0;
      c = mix(f, horizon, 1.0 - exp(-t * worldLight.geode.fog));
    }
  }
  // a soft halo round the stage, over the dark and the floor alike
  let toStage = normalize(vec3f(worldLight.geode.pool.x, worldLight.geode.floorY + 1.0, worldLight.geode.pool.y) - frame.camPos);
  c += worldLight.geode.rim.rgb * pow(max(dot(d, toStage), 0.0), 12.0) * 0.012;
  return vec4f(c, depth);
}

// The woods behind everything: the forest floor (moss, sorrel and needles, ground.jpg, at two scales turned against each
// other so it never repeats) lit through the leaves and dark round the trunks' feet; the canopy far overhead, dark with
// the light in its edges; and the sky through the gaps, with the sun, the moon and the stars. Drawn first, with no
// depth; alpha carries the distance along the view (the air and the depth of field read it). The trunks, the meadow and
// the lanterns are drawn over it.
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"

@group(1) @binding(0) var groundTex: texture_2d<f32>;

const TILE: f32 = 2.6;

fn groundAt(p: vec3f, uv: vec2f, dx: vec2f, dy: vec2f) -> vec3f {
  let a = textureSampleGrad(groundTex, samp_repeat, uv, dx, dy).rgb;
  // the second scale, turned, blended in patches
  let m2 = mat2x2f(0.8, -0.6, 0.6, 0.8) * (1.0 / 2.7);
  let b = textureSampleGrad(groundTex, samp_repeat, m2 * uv + 0.37, m2 * dx, m2 * dy).rgb;
  let patches = smoothstep(0.3, 0.75, vnoise2(p.xz * 0.11 + 3.0));
  var albedo = mix(a, b, patches * 0.6);
  // more moss out in the open, more needles and duff round the trunks' feet (and darker there: their shade)
  var ao = 1.0;
  var duff = 0.0;
  let n = min(u32(worldLight.forest.air.w), 16u);
  for (var k = 0u; k < n; k++) {
    let tr = worldLight.forest.trunks[k];
    let gap = length(p.xz - tr.xy) - tr.z * 1.85;
    ao *= mix(0.4, 1.0, smoothstep(-0.2, 2.8, gap));
    duff = max(duff, smoothstep(5.0, 0.3, gap));
  }
  // the fallen log's shade on the ground along its sides, and the duff it has gathered
  let off = offLog(p.xz);
  ao *= mix(0.35, 1.0, smoothstep(-0.1, 1.2, off));
  duff = max(duff, smoothstep(1.0, 0.0, off) * 0.7);
  albedo = mix(albedo, albedo * vec3f(0.85, 0.6, 0.45), duff * 0.55);
  let open = smoothstep(worldLight.forest.clock.w * 0.85, worldLight.forest.clock.w * 0.3, length(p.xz));
  albedo *= mix(vec3f(1.0), vec3f(0.9, 1.08, 0.82), open * 0.5);
  let up = vec3f(0.0, 1.0, 0.0);
  let key = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(p) * max(worldLight.forest.key.y, 0.0);
  return albedo * (key + woodsAmbient(up) * ao + lampLight(p, up, 0.0));
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  let cam = frame.camPos;
  // where the view meets the ground, for every pixel (its derivatives need uniform control): the ground's uv there
  let tg = -cam.y / min(d.y, -1e-4);
  let uv = (cam.xz + d.xz * tg) / TILE;
  let dx = dpdx(uv);
  let dy = dpdy(uv);
  var c = vec3f(0.0);
  var depth = 400.0;
  if (d.y < -1e-4) {
    let p = cam + d * tg;
    depth = tg * dot(d, frame.camFwd);
    c = groundAt(p, uv, dx, dy);
  } else {
    // the canopy's underside overhead, or the sky through a gap in it
    let H = worldLight.forest.keyCol.w;
    let t = (H - cam.y) / max(d.y, 1e-4);
    let q = cam.xz + d.xz * t;
    let dens = canopyAt(q);
    let sky = skyAt(d) + heavens(d);
    // leaves lit from above: dark undersides, glowing where the light comes through them towards you
    let through = pow(max(dot(d, worldLight.forest.key.xyz), 0.0), 4.0);
    let fleck = smoothstep(0.75, 0.95, vnoise2(q * 0.9 + 2.0));
    let leaves = (worldLight.forest.shade.rgb * 0.05 + worldLight.forest.keyCol.rgb * worldLight.forest.key.w * (0.0015 + 0.025 * through + 0.008 * fleck)) * vec3f(0.5, 0.8, 0.35);
    c = mix(sky, leaves, dens);
    depth = mix(400.0, min(t, 400.0), step(0.5, dens)) * dot(d, frame.camFwd);
    // low down, the wood goes on: trunk after trunk into the mist (darker the lower you look)
    let far = worldLight.forest.mist.rgb * 1.1 + worldLight.forest.shade.rgb * vec3f(0.12, 0.16, 0.18);
    let level = smoothstep(0.42, 0.08, d.y);
    c = mix(c, far, level);
    depth = mix(depth, 140.0 * dot(d, frame.camFwd), level);
  }
  return vec4f(c, max(depth, 0.05));
}

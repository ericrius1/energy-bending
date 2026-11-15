// The woods behind everything: the forest floor (moss, sorrel and needles, ground.jpg, at two scales turned against each
// other so it never repeats) lit through the leaves and dark round the trunks' feet; the canopy far overhead, dark with
// the light in its edges; and the sky through the gaps, with the sun, the moon and the stars. Drawn first, with no
// depth; alpha carries the distance along the view (the air and the depth of field read it). The trunks, the meadow and
// the lanterns are drawn over it. In the duel, its arena's drops open in the meadow (worlds/drops.wgsl): earth walls
// laced with roots going down into the dark.
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"
#include "../drops"

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
  // the path from the gate: trodden bare, the moss worn through to dark earth and needles
  let worn = pathAt(p.xz);
  albedo = mix(albedo, vec3f(0.07, 0.045, 0.03) * (0.7 + 0.6 * vnoise2(p.xz * 6.0)), worn * 0.85);
  let open = smoothstep(worldLight.forest.clock.w * 0.85, worldLight.forest.clock.w * 0.3, length(p.xz));
  albedo *= mix(vec3f(1.0), vec3f(0.9, 1.08, 0.82), open * 0.5);
  let up = vec3f(0.0, 1.0, 0.0);
  let key = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(p) * max(worldLight.forest.key.y, 0.0);
  return albedo * (key + woodsAmbient(up) * ao + lampLight(p, up, 0.0));
}

/** the wood going on past the last drawn trunks (phase 6, report 20): three tiers of trunks as silhouettes against the
 *  warm glow of the low sky between them, each further tier paler in the mist, so the view out is layered depth rather
 *  than a flat wall of fog; the glow warmest toward the sun's bearing (it lingers there after the sun is down) */
fn woodsDeep(d: vec3f, far: vec3f) -> vec3f {
  let F = worldLight.forest;
  let az = atan2(d.z, d.x);
  let sunAz = normalize(F.sunDisc.xz + vec2f(1e-4, 0.0));
  let toward = max(dot(normalize(d.xz + vec2f(1e-4, 0.0)), sunAz), 0.0);
  let low = smoothstep(0.32, 0.0, d.y);
  // the glow behind the trunks: the low sky's colour, warmed toward the sun, brightest just over the ground
  let dusk = clamp(F.horizon.w * 1.3, 0.0, 1.0);
  let warm = vec3f(1.0, 0.62, 0.32) * (0.35 + 0.65 * pow(toward, 3.0)) * (0.25 + 0.75 * dusk) * (1.0 - F.night * 0.8);
  var c = mix(far, F.horizon.rgb * 0.9 + warm * 0.55, 0.55 * low);
  // the tiers, far to near: each a row of trunks round the view, the nearer ones wider, darker and less misted
  for (var k = 0; k < 3; k++) {
    let kf = f32(k);
    let dens = 120.0 - kf * 35.0;
    let x = az / 6.2831853 * dens + kf * 17.3;
    let cell = floor(x);
    let h = hash2i(vec2i(i32(cell), 40 + k));
    let w = 0.12 + 0.18 * hash2i(vec2i(i32(cell), 50 + k));
    let off = (hash2i(vec2i(i32(cell), 60 + k)) - 0.5) * 0.5;
    let trunk = step(0.3, h) * smoothstep(w, w * 0.65, abs(fract(x) - 0.5 - off));
    let mistK = 0.78 - 0.24 * kf;
    let bark = F.shade.rgb * vec3f(0.2, 0.12, 0.09) + warm * 0.04 * (1.0 - kf * 0.3);
    // (each tier's trunks lit faintly on the glow's side)
    let col = mix(bark, c, mistK);
    c = mix(c, col, trunk);
  }
  return c;
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
  // the wood going on into the mist, trunk after trunk (what the far ground and the low sky both become: the same
  // colour and distance either side of the horizon, so nothing drawn over it with its own distance shows a seam there)
  let far = worldLight.forest.mist.rgb * 1.1 + worldLight.forest.shade.rgb * vec3f(0.12, 0.16, 0.18);
  if (d.y < -1e-4) {
    let p = cam + d * tg;
    depth = min(tg, 140.0) * dot(d, frame.camFwd);
    c = far;
    if (tg < 140.0) { c = mix(groundAt(p, uv, dx, dy), far, smoothstep(50.0, 140.0, tg)); }
    // the duel's drops: down an earth wall, roots hanging out of its top, into the dark
    let dh = dropHit(cam, d, tg, 0.0, 2.6, worldLight.forest.dropFrame, worldLight.forest.drops[0], worldLight.forest.drops[1]);
    if (dh.inside) {
      let q = cam + d * dh.t;
      let along = dot(q.xz, vec2f(-dh.n.z, dh.n.x));
      let strata = 0.6 + 0.4 * vnoise2(vec2f(along * 1.5, dh.below * 7.0));
      let roots = smoothstep(0.75, 0.95, vnoise2(vec2f(along * 6.0, dh.below * 1.2))) * smoothstep(1.4, 0.0, dh.below);
      let earth = vec3f(0.09, 0.06, 0.04) * strata + vec3f(0.12, 0.08, 0.05) * roots;
      let light = worldLight.forest.shade.rgb * 0.5 + worldLight.forest.keyCol.rgb * worldLight.forest.key.w * 0.02 * max(dot(dh.n, worldLight.forest.key.xyz), 0.0);
      c = earth * light * exp(-dh.below * 1.1);
      depth = dh.t * dot(d, frame.camFwd);
    }
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
    // low down, the wood goes on: trunk after trunk into the mist, tier on tier against the glow (phase 6)
    let level = smoothstep(0.42, 0.08, d.y);
    c = mix(c, woodsDeep(d, far), level);
    depth = mix(depth, 140.0 * dot(d, frame.camFwd), level);
  }
  return vec4f(c, max(depth, 0.05));
}

// The meadow's grass: tufts over the clearing (short and soft where they dance, longer towards the trees and against the
// fallen log, worn down along the path from the gate, thin in the trees' shade), each blade a strip of five segments fanned out of its tuft's root, curling over, leaning in the wind
// and pushed aside by any foot that comes down near it. Made from the instance index alone (no buffers): the tufts sit
// on a jittered grid, the blades of one share its root. Lit per vertex; the fragment adds the light through the blade
// when the sun is behind it.
#include "weft/frame"
#include "../light"
#include "../../matter/core/body"

override BLADES: u32 = 10u;   // blades a tuft
override GRID: u32 = 200u;    // tufts along a side of the grid
override REACH: f32 = 15.0;   // the grid covers ±REACH metres


struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,     // lit by the shade and the lanterns
  @location(1) key: vec3f,     // the key light reaching it (before the angle)
  @location(2) wp: vec3f,
  @location(3) n: vec3f,
  @location(4) f: f32,         // how far up the blade
}

/** feet near a root push the grass aside: (push xz, how hard) */
fn trodden(root: vec2f) -> vec3f {
  var push = vec3f(0.0);
  let feet = array<u32, 4>(4u, 6u, 10u, 12u);
  for (var d = 0u; d < min(bodies.dancers, 8u); d++) {
    for (var k = 0u; k < 4u; k++) {
      let j = joints[d * MAXJ + feet[k]].pos.xyz;
      if (j.y > 0.32) { continue; }
      let o = root - j.xz;
      let r = length(o);
      if (r > 0.42) { continue; }
      let w = (1.0 - r / 0.42) * (1.0 - j.y / 0.32);
      push += vec3f(o / max(r, 1e-3) * w, w);
    }
  }
  return push;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let tuft = ii / BLADES;
  let h = rnd3(tuft * 7u + 3u);
  let cell = 2.0 * REACH / f32(GRID);
  let root0 = (vec2f(f32(tuft % GRID), f32(tuft / GRID)) + h.xy) * cell - REACH;
  let r = length(root0);
  let ring = worldLight.forest.clock.w;
  // the meadow is the clearing and a little way into the trees, thinning out under them
  if (r > REACH || h.z > smoothstep(ring + 3.5, ring - 1.5, r) * 0.92 + 0.08 * step(r, ring + 3.5)) { return o; }
  if (!onScreen(vec3f(root0.x, 0.2, root0.y), 0.6)) { return o; }
  // further from the eye, fewer tufts (each a little wider, so the meadow stays as full). (The cheap tests first: a
  // tuft thinned away never pays for the loop over the trunks)
  let far = length(root0 - frame.camPos.xz);
  let thin = 1.0 + smoothstep(6.0, 10.0, far) + smoothstep(11.0, 16.0, far);
  if (fract(h.z * 7.13) * thin > 1.0 || !clearOfTrunks(root0, 0.15)) { return o; }
  let b = rnd3(ii * 13u + 5u);
  let b2 = rnd3(ii * 29u + 11u);
  // short where they dance, longer by the trees; a few long stems everywhere
  var tall = mix(0.09, 0.36, smoothstep(ring * 0.42, ring * 0.72, r)) * (0.55 + 0.9 * b.x * b.x) * (1.0 + step(0.93, b2.z) * 1.4) * worldLight.forest.clock.z;
  // grown up long against the fallen log's side (out of reach of the mower that is the dancing); trodden short and
  // bare in places along the path from the gate
  let byLog = smoothstep(0.8, 0.05, offLog(root0));
  let worn = pathAt(root0);
  if (worn > 0.15 && fract(h.z * 3.7) < worn * 0.8) { return o; }
  tall *= (1.0 + 1.7 * byLog) * (1.0 - 0.75 * worn);
  let yaw = b.y * 6.2831853;
  let outward = vec2f(cos(yaw), sin(yaw));
  let root = root0 + outward * 0.035 * b.z;
  let lean = 0.15 + 0.55 * b.z;
  let width = mix(0.0045, 0.009, b2.x) * mix(0.8, 1.25, smoothstep(ring * 0.4, ring * 0.8, r)) * sqrt(thin);
  // the wind, and anyone dancing on it
  let t = worldLight.forest.clock.x;
  let wind = windAt(root, t + b2.y * 0.4);
  let foot = trodden(root);
  // the strip: two vertices a level, five levels, then the tip
  let level = min(vi / 2u, 5u);
  let f = f32(level) / 5.0;
  let bend = outward * lean * pow(f, 1.6) + (wind + foot.xy * 0.9) * pow(f, 1.8);
  let lift = tall * f * (1.0 - 0.25 * lean * f) * (1.0 - 0.55 * foot.z);
  let spine = vec3f(root.x + bend.x * tall, lift, root.y + bend.y * tall);
  let sideDir = vec3f(-outward.y, 0.0, outward.x);
  let w = width * (1.0 - pow(f, 1.4)) * select(1.0, 0.0, vi >= 10u);
  let s = select(-1.0, 1.0, (vi & 1u) == 1u);
  let wp = spine + sideDir * w * s;
  // the blade's face: towards its lean, tipped up as it curls
  let along = normalize(vec3f(bend.x * tall * 1.6 / max(f, 0.2), tall, bend.y * tall * 1.6 / max(f, 0.2)));
  let nrm = normalize(cross(sideDir, along));
  o.n = nrm;
  o.f = f;
  o.wp = wp;
  // colour: dark at the root, fresher towards the tip, each tuft its own green (some yellowing, some bluer)
  let tint = rnd3(tuft * 3u + 1u);
  let green = mix(vec3f(0.028, 0.075, 0.012), vec3f(0.11, 0.2, 0.03), tint.x);
  let tip = mix(green * 2.2, vec3f(0.3, 0.3, 0.07), tint.y * 0.45);
  let albedo = mix(green * 0.35, tip, pow(f, 0.8));
  let ao = mix(0.35, 1.0, f);
  o.col = albedo * (woodsAmbient(nrm) * ao + lampLight(wp, nrm, 0.6) * mix(0.5, 1.0, f));
  o.key = albedo * worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(wp) * ao;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs(i: GOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let V = normalize(frame.camPos - i.wp);
  let L = worldLight.forest.key.xyz;
  var N = normalize(i.n);
  if (!front) { N = -N; }
  // light on the face (wrapped: a blade is thin), through it from behind, and a sheen along it
  let diff = (max(dot(N, L), 0.0) + 0.35) / 1.35;
  let through = pow(max(dot(-V, L), 0.0), 4.0) * 1.8 * (0.4 + 0.6 * i.f);
  let H = normalize(L + V);
  let sheen = pow(max(dot(N, H), 0.0), 40.0) * 0.25;
  let c = i.col + i.key * (diff + through) + worldLight.forest.keyCol.rgb * worldLight.forest.key.w * sheen * length(i.key) * 0.6;
  return vec4f(c, dot(i.wp - frame.camPos, frame.camFwd));
}

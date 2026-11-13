// The hearts: a mixed body's gem heart (ember, gemwater, geodeheart: gems on the torso inside fire, water or ice) as
// one glowing sphere per dancer, for the matter round it to honour. No bindings here: a shader that wants the hearts
// includes this file, declares `@group(1) @binding(n) var<uniform> hearts: Hearts;` and binds `hearts:
// heartsOf(kit)` (matter/gems/hearts.ts), which the gems fill every frame (zeros when nobody has a heart).
//
//   heartVeil(hearts, wp, cam)  1 … down to about 0.15: how much of a point of outer matter to keep (multiply a
//                               flame's or a splat's brightness and alpha by it). Below 1 only where the point sits
//                               between the camera and a heart, within the heart's outline, so the heart shows
//                               through the flame in front of it; matter beside or behind the heart is untouched.
//   heartLight(hearts, wp)     the hearts' light reaching wp (linear rgb, already × strength): add it to the outer
//                               matter's colour near the heart (fire: tint the flame; water: light the surface).
//   heartDepth(hearts, d, cam) the heart's view distance along the camera's forward axis (what the scene's alpha holds),
//                               for a kind that compares against the depth it reads.
#include "../../engine/limits"

/** at: the centre (xyz) and radius (w, 0: no heart); glow: its colour (linear, brightest channel 1) and strength (w,
 *  0 … ~1.5, with the heartbeat in it) */
struct Heart { at: vec4f, glow: vec4f }
struct Hearts { h: array<Heart, MAX_DANCERS> }

/** how much of a point of outer matter to keep, seen from `cam` (1 where no heart is behind it) */
fn heartVeil(hs: Hearts, wp: vec3f, cam: vec3f) -> f32 {
  var keep = 1.0;
  for (var d = 0u; d < MAX_DANCERS; d++) {
    let h = hs.h[d];
    if (h.at.w <= 0.0) { continue; }
    let toP = wp - cam;
    let dist = length(toP);
    let dir = toP / max(dist, 1e-4);
    let toH = h.at.xyz - cam;
    let along = dot(toH, dir);
    // only in front of the heart's far side (behind it the heart's own stones hide the flame anyway)
    if (dist > along + h.at.w * 0.6) { continue; }
    let off = length(toH - dir * along);
    let inside = 1.0 - smoothstep(h.at.w * 0.7, h.at.w * 1.9, off);
    keep = min(keep, 1.0 - inside * clamp(h.glow.w, 0.0, 1.0) * 0.85);
  }
  return keep;
}

/** the hearts' light at wp: soft, falling off over a few radii */
fn heartLight(hs: Hearts, wp: vec3f) -> vec3f {
  var c = vec3f(0.0);
  for (var d = 0u; d < MAX_DANCERS; d++) {
    let h = hs.h[d];
    if (h.at.w <= 0.0) { continue; }
    let r = length(wp - h.at.xyz) / h.at.w;
    c += h.glow.rgb * h.glow.w / (1.0 + r * r * 1.5);
  }
  return c;
}

/** dancer d's heart along the camera's forward axis (0 when it has none) */
fn heartDepth(hs: Hearts, d: u32, cam: vec3f, fwd: vec3f) -> f32 {
  let h = hs.h[min(d, MAX_DANCERS - 1u)];
  return select(0.0, dot(h.at.xyz - cam, fwd), h.at.w > 0.0);
}

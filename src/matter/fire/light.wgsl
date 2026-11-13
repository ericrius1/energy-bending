// The light a body of fire (or plasma) gives the world: one point light per dancer wearing flame, a FireLights the
// fire kind fills each frame (matter/fire/lights.ts). It rides in the worlds' one light uniform as its `fire` member
// (WorldLight, worlds/light.wgsl), so plasma, which is fire's violet form, and any later kind of light-giving matter
// add no buffer of their own. This file has no bindings; a shader that includes worlds/light.wgsl reads it as:
//
//   col += albedo * fireLightAt(worldLight.fire, worldPos, normal);     // or worldFire(worldPos, normal)
//
// Each light sits in its dancer's middle, a little above the hips (where the flame is densest), with a radius the size
// of a body; its colour is warm for fire and violet-white for plasma, and its intensity flickers with the flame and
// falls to 0 when the dancer's fire is out.
#include "../../engine/limits"

/** pos.xyz: where (world, m); pos.w: the body's radius (m), within which the light no longer grows.
 *  col.rgb: linear colour, already times the intensity; col.w: the intensity alone (0: off) */
struct FireLight { pos: vec4f, col: vec4f }
/** count: how many of `lights` are in use (the first `count`) */
struct FireLights { count: u32, pad0: u32, pad1: u32, pad2: u32, lights: array<FireLight, MAX_DANCERS> }

/** the fire's light reaching a surface at p with normal n (wrap-lit: a body of flame lights round corners); multiply
 *  by the surface's albedo */
fn fireLightAt(L: FireLights, p: vec3f, n: vec3f) -> vec3f {
  var sum = vec3f(0.0);
  // a function-scope copy: an array value can only be indexed by a constant, a variable by anything
  var lights = L.lights;
  for (var k = 0u; k < min(L.count, MAX_DANCERS); k++) {
    let l = lights[k];
    let v = l.pos.xyz - p;
    let d2 = dot(v, v);
    let r = l.pos.w;
    let wrap = clamp((dot(n, v * inverseSqrt(max(d2, 1e-6))) + 0.4) / 1.4, 0.0, 1.0);
    sum += l.col.rgb * wrap / (d2 + r * r);
  }
  return sum;
}

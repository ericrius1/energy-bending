// The pool behind everything: the sky (pool.wgsl poolSky: dark overhead, a few stars, the glow along the horizon) and,
// below the horizon, the black floor seen through the water. The water's surface itself (its reflections) is laid over
// the scene in the air pass (pool.wgsl poolScene). Drawn first, with no depth; alpha is the view distance: for the
// floor, the distance to the surface, so the air pass can tell the water's pixels from what stands in it (half floats:
// kept under 30 km).
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  let cam = frame.camPos;
  if (d.y < -1e-4 && cam.y > worldLight.pool.water.x) {
    let t = (worldLight.pool.water.x - cam.y) / d.y;
    // the floor a hand's depth down: black, with the faintest sheen of the glow on it
    let p = cam + d * t;
    let sheen = worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.002 * vnoise2(p.xz * 0.7);
    return vec4f(worldLight.pool.deep.rgb + sheen, min(t * dot(d, frame.camFwd), 30000.0));
  }
  return vec4f(poolSky(d, 1.0), 30000.0);
}

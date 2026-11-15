// The pool behind everything: the sky (pool.wgsl poolSky: teal overhead, gold on the horizon, the low sun, the far
// garden shore) and, below the horizon, the open water's own deep teal. The water's surface itself (its reflections)
// is laid over the scene in the air pass (pool.wgsl poolScene). Drawn first, with no depth; alpha is the view
// distance: for the water, the distance to the surface, so the air pass can tell the water's pixels from what stands
// in it (half floats: kept under 30 km).
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  let cam = frame.camPos;
  if (d.y < -1e-4 && cam.y > worldLight.pool.water.x) {
    let t = (worldLight.pool.water.x - cam.y) / d.y;
    // the open water: its own deep teal (what is under it is too deep to see), the faintest sheen of the glow on it
    let p = cam + d * t;
    let sheen = worldLight.pool.glow.rgb * worldLight.pool.glow.w * 0.002 * vnoise2(p.xz * 0.7);
    return vec4f(worldLight.pool.deep.rgb + sheen, min(t * dot(d, frame.camFwd), 30000.0));
  }
  // the sky, and the far world on it at its own distance, so the air's haze lies over it by that much (report 20)
  let v = poolVista(d, 1.0);
  return vec4f(poolSkyWith(d, 1.0, v), min(v.dist * max(dot(d, frame.camFwd), 0.05), 30000.0));
}

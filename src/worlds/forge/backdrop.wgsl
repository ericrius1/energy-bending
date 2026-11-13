// The Sky Forge behind everything: no ground, only sky (forge.wgsl forgeSky): the stars and the aurora overhead, the
// haze round the horizon, and far below the sea of cloud lit through from beneath by the fire. Drawn first, with no
// depth; alpha the view distance (the cloud sea's, below; half floats: under 30 km).
#include "weft/frame"
#include "weft/fullscreen"
#include "../light"

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let d = viewRay(i.uv);
  var depth = 30000.0;
  if (d.y < -0.01) { depth = min(forgeClouds(d).w * dot(d, frame.camFwd), 30000.0); }
  return vec4f(forgeSky(d, 1.0), depth);
}

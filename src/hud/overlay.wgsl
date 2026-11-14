// The HUD laid over a film's graded frame, before it is brought down to YUV (post/post.ts, the film's grade pass):
// the HUD's two canvases flattened and uploaded with their alpha premultiplied, drawn with premultiplied blending,
// which is what the browser does when it lays the HUD's canvases over the WebGPU canvas on screen. Both are display
// values (the grade wrote sRGB-encoded colour into an rgba8unorm target), so they mix as the page does.
#include "weft/frame"
#include "weft/fullscreen"

@group(1) @binding(0) var hudTex: texture_2d<f32>;

@fragment fn fs_hud(i: FullscreenOut) -> @location(0) vec4f {
  return textureSampleLevel(hudTex, samp_linear, i.uv, 0.0);
}

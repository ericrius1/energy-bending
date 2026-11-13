// A heart's halo: the glow round a gem heart (hearts.wgsl), a soft camera-facing disc in front of it, added over the
// scene in the glow phase. Close, it is the light spilling out of the crystal; at game distance it is what tells a
// player there is a heart in that body. Drawn where this view sees its dancer (engine/seen.wgsl).
#include "weft/frame"
#include "./hearts"
#include "../../engine/seen"

@group(1) @binding(0) var<uniform> hearts: Hearts;
@group(1) @binding(1) var<uniform> seen: ViewSeen;
struct Halo { bright: f32, size: f32, pad0: f32, pad1: f32 }
@group(1) @binding(2) var<uniform> halo: Halo;

struct HOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) clip: f32,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) d: u32) -> HOut {
  var o: HOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let h = hearts.h[d];
  if (h.at.w <= 0.0 || h.glow.w <= 0.0) { return o; }
  let sd = seen.d[d];
  let at = seenPos(sd, h.at.xyz);
  if (seenClip(sd, at) < -h.at.w) { return o; }
  // in front of the heart by its radius, so its own stones don't hide it; a little bigger far away (a pixel floor)
  let toCam = normalize(frame.camPos - at);
  let dist = length(frame.camPos - at);
  let size = h.at.w * halo.size * (1.0 + smoothstep(3.0, 9.0, dist) * 0.6);
  let c = CORNERS[vi];
  let wp = at + toCam * h.at.w * 1.05 + (frame.camRight * c.x + frame.camUp * c.y) * size;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.col = h.glow.rgb * h.glow.w * halo.bright;
  o.clip = seenClip(sd, at);
  return o;
}

@fragment fn fs(i: HOut) -> @location(0) vec4f {
  if (i.clip < 0.0) { discard; }
  let r2 = dot(i.uv, i.uv);
  // a bright core and a wide soft skirt
  let k = exp(-r2 * 10.0) * 0.9 + exp(-r2 * 4.0) * 0.3;
  return vec4f(i.col * k * (1.0 - smoothstep(0.6, 1.0, r2)), 0.0);
}

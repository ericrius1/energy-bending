// The meeting's sharp parts, drawn at full resolution over the focused image (after the steam's composite, in the
// post chain's lens pass), added: fronts, drips and sparks (steam.wgsl). A front is a short white-hot streak lying
// along the contact between two bodies, alive a tenth of a second; hundreds of them, born again each frame where the
// bodies touch, make a crisp hissing line that hugs the boundary and is gone the moment they part. Flame on ice makes
// it a harder, longer, blue-white crack; plasma tints it violet-white. A drip is a falling bead of meltwater; a spark
// a tiny jagged arc, flickering, where plasma meets water. These are the only parts of steam allowed past maxBright.
//
// Each is a screen-space ribbon between its two ends, at least `minPx` wide so it never breaks up, tested by hand
// against the scene's view distance with some slack (a front lies on a body's surface, inside a flame's soft edge).
#include "weft/frame"
#include "./steam"

@group(1) @binding(0) var<uniform> steam: Steam;
@group(1) @binding(1) var<storage, read> puffs: array<Puff>;
@group(1) @binding(2) var sceneTex: texture_2d<f32>;

struct FOut {
  @builtin(position) pos: vec4f,
  /** along (0 … 1) and across (-1 … 1) the ribbon */
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  /** view distance, which sort (1 front, 2 drip, 3 spark), the seed */
  @location(2) info: vec3f,
}

const CORNERS = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  var o: FOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii < steam.wispEnd || ii >= steam.count) { return o; }
  let q = puffs[ii];
  if (q.age >= q.life) { return o; }
  let sort = select(select(3u, 2u, ii < steam.dripEnd), 1u, ii < steam.frontEnd);
  let u = clamp(q.age / q.life, 0.0, 1.0);
  let plasma = q.info.x;
  let ice = q.info.y;
  let crack = ice * (1.0 - plasma);
  // its two ends and its width (m)
  var A = q.pos - q.vel;
  var B = q.pos + q.vel;
  var width = 0.0035 + 0.002 * crack;
  // a flicker that changes every frame (the hiss)
  let flick = 0.55 + 0.45 * rnd(ii * 31u + steam.frameNo * 7u);
  var col = vec3f(0.0);
  if (sort == 1u) {
    let hot = mix(mix(vec3f(1.0, 0.86, 0.66), vec3f(0.78, 0.9, 1.0), ice), vec3f(0.9, 0.78, 1.0), plasma);
    col = hot * steam.frontGlow * (1.0 + 0.8 * crack) * min(0.4 + q.info.z, 1.5) * flick * (1.0 - u * u);
  } else if (sort == 2u) {
    // a bead of meltwater, drawn out along its fall
    A = q.pos;
    B = q.pos - q.vel * 0.025;
    width = 0.003;
    col = vec3f(0.55, 0.78, 1.0) * 0.9 * (1.0 - u);
  } else {
    width = 0.0018;
    col = vec3f(0.85, 0.72, 1.0) * steam.frontGlow * 0.8 * step(0.35, flick);
  }
  // a fusion tints the front: steam white with orange and cyan, prism a rainbow, storm a violet flash, aurora green
  let F = steam.fusion;
  let hue = fract(q.info.w + steam.time * 0.2);
  let rainbow = clamp(abs(fract(hue + vec3f(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
  col = mix(col, length(col) * 0.58 * rainbow, fusionIs(F, 1.0));
  col = mix(col, length(col) * 0.58 * vec3f(0.75, 0.6, 1.0), fusionIs(F, 2.0));
  col = mix(col, length(col) * 0.58 * vec3f(0.3, 1.0, 0.6), fusionIs(F, 3.0));
  o.col = col;

  // a ribbon in screen space between the two ends, at least minPx wide
  let ca = frame.viewProj * vec4f(A, 1.0);
  let cb = frame.viewProj * vec4f(B, 1.0);
  if (ca.w <= 0.05 || cb.w <= 0.05) { return o; }
  let sa = ca.xy / ca.w;
  let sb = cb.xy / cb.w;
  let res = frame.res;
  var d = (sb - sa) * res;
  d = select(vec2f(1.0, 0.0), normalize(d), length(d) > 1e-3);
  let nrm = vec2f(-d.y, d.x);
  let c = CORNERS[vi];
  let focal = res.y * 0.5 * frame.proj[1][1];
  let wpx = max(width * focal / max(mix(ca.w, cb.w, c.x), 0.05), 1.3);
  let cc = mix(ca, cb, c.x);
  let off = (nrm * c.y * wpx + d * (c.x * 2.0 - 1.0) * wpx) * 2.0 / res;
  o.pos = vec4f(cc.xy + off * cc.w, cc.z, cc.w);
  // dimmed where it is thinner than a pixel (so a far front is a faint line, not a fat one)
  o.col *= min(width * focal / max(cc.w, 0.05) / 1.3, 1.0) * 0.6 + 0.4;
  o.uv = vec2f(c.x, c.y);
  o.info = vec3f(dot(q.pos - frame.camPos, frame.camFwd), f32(sort), q.info.w * 40.0);
  return o;
}

@fragment fn fs(i: FOut) -> @location(0) vec4f {
  var v = i.uv.y;
  // a spark is jagged: its centre line zigzags along it
  if (i.info.y > 2.5) { v -= 0.6 * sin(i.uv.x * 11.0 + i.info.z) * sin(i.uv.x * 3.14159); }
  let across = exp(-v * v * 3.5);
  let ends = smoothstep(0.0, 0.2, i.uv.x) * smoothstep(1.0, 0.8, i.uv.x);
  let scene = textureLoad(sceneTex, vec2i(i.pos.xy), 0).a;
  let shown = smoothstep(-0.18, 0.02, scene - i.info.x);
  let k = across * ends * shown;
  return vec4f(i.col * k, 0.0);
}

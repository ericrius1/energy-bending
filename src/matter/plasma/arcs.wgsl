// Plasma arcs drawn: every segment of every bolt (built on the CPU each frame, matter/plasma/arcs.ts) as a
// camera-facing capsule added into the scene: a white-hot core and a violet glow round it (docs/element-looks.md,
// "Lightning arcs"). The core is kept at least about a pixel wide whatever the distance, so a far bolt still reads as a
// line and blooms.
#include "weft/frame"

/** a: one end (xyz) and the core's half width (m); b: the other end and the intensity */
struct ArcSeg { a: vec4f, b: vec4f }
struct ArcLook { glow: f32, minPx: f32, count: u32, pad: f32 }

@group(1) @binding(0) var<uniform> look: ArcLook;
@group(1) @binding(1) var<storage, read> segs: array<ArcSeg>;

struct AOut {
  @builtin(position) pos: vec4f,
  // along the segment (m from end a), across (m), the segment's length, the core's half width
  @location(0) at: vec4f,
  @location(1) @interpolate(flat) intensity: f32,
}

const CORNERS = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
/** how far the glow reaches, in core widths */
const REACH = 9.0;

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> AOut {
  var o: AOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= look.count) { return o; }
  let s = segs[ii];
  let a = s.a.xyz;
  let b = s.b.xyz;
  let len = length(b - a);
  if (len < 1e-5) { return o; }
  let dir = (b - a) / len;
  let mid = (a + b) * 0.5;
  // the core no thinner than look.minPx pixels where it is
  let dist = max(dot(mid - frame.camPos, frame.camFwd), 0.05);
  let px = dist * 2.0 * tan(frame.fovY * 0.5) / max(frame.res.y, 1.0);
  let w = max(s.a.w, px * look.minPx);
  let toCam = normalize(frame.camPos - mid);
  var side = cross(dir, toCam);
  let sl = length(side);
  side = select(frame.camRight, side / max(sl, 1e-5), sl > 1e-3);
  let r = w * REACH;
  let c = CORNERS[vi];
  let along = mix(-r, len + r, c.x);
  let wp = a + dir * along + side * (c.y * r);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.at = vec4f(along, c.y * r, len, w);
  // a thinner core than the minimum still carries its light: spread it
  o.intensity = s.b.w * min(1.0, s.a.w / w);
  return o;
}

@fragment fn fs(i: AOut) -> @location(0) vec4f {
  let along = clamp(i.at.x, 0.0, i.at.z);
  let d = length(vec2f(i.at.x - along, i.at.y)) / i.at.w;
  let col = vec3f(1.0, 0.92, 1.0) * exp(-1.5 * d * d) * 2.6 + vec3f(0.55, 0.22, 1.0) * exp(-0.55 * d) * 0.35 * look.glow;
  // fade the quad's edge so the glow ends softly
  let edge = smoothstep(REACH, REACH * 0.6, d);
  return vec4f(col * i.intensity * edge, 0.0);
}

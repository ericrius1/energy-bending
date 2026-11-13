// The field at a few points the CPU asked about (field.ts probe / updraft): a thread a point, two vec4s each, copied
// back to the CPU after the frame. The updraft is the rising air averaged up a short column over the point (what
// would lift someone jumping there), so one cell's flicker doesn't decide a jump.
#include "./field"

struct Probes { at: array<vec4f, FIELD_PROBES>, count: u32, pad0: u32, pad1: u32, pad2: u32 }

@group(1) @binding(0) var<uniform> probes: Probes;
@group(1) @binding(1) var<storage, read_write> readings: array<vec4f>;

@compute @workgroup_size(16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= probes.count) { return; }
  let p = probes.at[i].xyz;
  let s = fieldAt(p);
  var up = 0.0;
  for (var k = 0; k < 4; k++) { up += max(fieldWind(p + vec3f(0.0, f32(k) * 0.25, 0.0)).y, 0.0); }
  // wind; heat (signed), wet, steam, updraft (m/s)
  readings[i * 2u] = vec4f(s.a.xyz, 0.0);
  readings[i * 2u + 1u] = vec4f(s.b.x - s.b.y, s.a.w, s.b.z, up * 0.25);
}

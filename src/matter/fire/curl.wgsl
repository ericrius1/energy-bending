// The tongues' curl: a small velocity grid round each fire dancer (32 × 64 × 32 cells of 5 cm, following its hips;
// 16 × 32 × 16 of 10 cm on `coarse`) that measures the flames' own flow and pushes it to curl (vorticity
// confinement, Fedkiw et al. 2001). Four steps a frame, before the flames' step:
//
//   scatter    each flame adds its velocity into the 8 cells round it (fixed point: WGSL has no float atomics)
//   resolve    each cell's mean velocity; a cell no flame reached takes the field's wind (the grid's boundary)
//   vorticity  ω = ∇ × v, by central differences
//   confine    f = ε h (N × ω), N = ∇|ω| / |∇|ω||: a push round each eddy that makes it tighter, written over the
//              velocity (which is no longer needed); the flames read it in their step (sim.wgsl, curlAt)
//
// The grid keeps no history: the flames carry the flow from frame to frame and the grid only reads it, so a box that
// jumps with a fast limb or a dancer through a gate loses nothing. A flame outside every box gets no push.
#include "./flame"
#include "../core/body"
#include "../field/field"
#include "./curlgrid"

@group(1) @binding(0) var<uniform> curl: Curl;
@group(1) @binding(1) var<storage, read> homes: array<Home>;
@group(1) @binding(2) var<storage, read> flames: array<Flame>;
@group(1) @binding(3) var<storage, read_write> acc: array<atomic<i32>>;
@group(1) @binding(4) var<storage, read_write> vel: array<vec4f>;
@group(1) @binding(5) var<storage, read_write> omega: array<vec4f>;

/** fixed point for the velocity sums (m/s × weight); a cell holds at most a few hundred flames at < 20 m/s */
const FIX: f32 = 4096.0;

fn deposit(base: u32, c: vec3i, w: f32, v: vec3f) {
  let d = vec3i(curl.dims.xyz);
  if (any(c < vec3i(0)) || any(c >= d) || w < 1e-3) { return; }
  let k = (base + u32(c.x + d.x * (c.y + d.y * c.z))) * 4u;
  atomicAdd(&acc[k], i32(v.x * w * FIX));
  atomicAdd(&acc[k + 1u], i32(v.y * w * FIX));
  atomicAdd(&acc[k + 2u], i32(v.z * w * FIX));
  atomicAdd(&acc[k + 3u], i32(w * FIX));
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= curl.count) { return; }
  let f = flames[i];
  if (!alive(f) || f.look.z < 0.0) { return; }
  let g = gridOf(dancerOf(homes[i]));
  if (g < 0) { return; }
  let box = curl.boxes[g];
  let x = (f.pos - box.xyz) / box.w - 0.5;
  let c0 = vec3i(floor(x));
  let t = x - floor(x);
  let base = u32(g) * cellsOf();
  // weighted by heat: the hot flames are the flow; a cooling tip barely counts
  let h = clamp(flameT(f), 0.05, 2.0);
  for (var k = 0u; k < 8u; k++) {
    let o = vec3i(i32(k & 1u), i32((k >> 1u) & 1u), i32((k >> 2u) & 1u));
    let wv = select(1.0 - t, t, vec3<bool>(o == vec3i(1)));
    deposit(base, c0 + o, wv.x * wv.y * wv.z * h, f.vel);
  }
}

fn cellPos(g: i32, c: vec3i) -> vec3f { let b = curl.boxes[g]; return b.xyz + (vec3f(c) + 0.5) * b.w; }

@compute @workgroup_size(64)
fn resolve(@builtin(global_invocation_id) gid: vec3u) {
  let n = cellsOf();
  let i = gid.x;
  if (i >= n * curl.grids) { return; }
  let k = i * 4u;
  let w = f32(atomicLoad(&acc[k + 3u])) / FIX;
  let s = vec3f(f32(atomicLoad(&acc[k])), f32(atomicLoad(&acc[k + 1u])), f32(atomicLoad(&acc[k + 2u]))) / FIX;
  atomicStore(&acc[k], 0); atomicStore(&acc[k + 1u], 0); atomicStore(&acc[k + 2u], 0); atomicStore(&acc[k + 3u], 0);
  let g = i32(i / n);
  let j = i % n;
  let d = curl.dims.xyz;
  let c = vec3i(i32(j % d.x), i32((j / d.x) % d.y), i32(j / (d.x * d.y)));
  let wind = fieldWind(cellPos(g, c));
  // a cell with little flame in it leans to the wind (the boundary), so the edge of the fire shears against the air
  let a = smoothstep(0.0, 0.6, w);
  vel[i] = vec4f(mix(wind, s / max(w, 1e-4), a), a);
}

fn velAt(base: u32, c: vec3i) -> vec3f {
  let d = vec3i(curl.dims.xyz);
  let q = clamp(c, vec3i(0), d - 1);
  return vel[base + u32(q.x + d.x * (q.y + d.y * q.z))].xyz;
}

@compute @workgroup_size(64)
fn vorticity(@builtin(global_invocation_id) gid: vec3u) {
  let n = cellsOf();
  let i = gid.x;
  if (i >= n * curl.grids) { return; }
  let g = i / n;
  let j = i % n;
  let base = g * n;
  let d = curl.dims.xyz;
  let c = vec3i(i32(j % d.x), i32((j / d.x) % d.y), i32(j / (d.x * d.y)));
  let h2 = 2.0 * curl.boxes[g].w;
  let dx = (velAt(base, c + vec3i(1, 0, 0)) - velAt(base, c - vec3i(1, 0, 0))) / h2;
  let dy = (velAt(base, c + vec3i(0, 1, 0)) - velAt(base, c - vec3i(0, 1, 0))) / h2;
  let dz = (velAt(base, c + vec3i(0, 0, 1)) - velAt(base, c - vec3i(0, 0, 1))) / h2;
  let w = vec3f(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
  omega[i] = vec4f(w, length(w));
}

fn omegaLen(base: u32, c: vec3i) -> f32 {
  let d = vec3i(curl.dims.xyz);
  let q = clamp(c, vec3i(0), d - 1);
  return omega[base + u32(q.x + d.x * (q.y + d.y * q.z))].w;
}

@compute @workgroup_size(64)
fn confine(@builtin(global_invocation_id) gid: vec3u) {
  let n = cellsOf();
  let i = gid.x;
  if (i >= n * curl.grids) { return; }
  let g = i / n;
  let j = i % n;
  let base = g * n;
  let d = curl.dims.xyz;
  let c = vec3i(i32(j % d.x), i32((j / d.x) % d.y), i32(j / (d.x * d.y)));
  let h = curl.boxes[g].w;
  let grad = vec3f(
    omegaLen(base, c + vec3i(1, 0, 0)) - omegaLen(base, c - vec3i(1, 0, 0)),
    omegaLen(base, c + vec3i(0, 1, 0)) - omegaLen(base, c - vec3i(0, 1, 0)),
    omegaLen(base, c + vec3i(0, 0, 1)) - omegaLen(base, c - vec3i(0, 0, 1)));
  let gl = length(grad);
  let N = select(vec3f(0.0), grad / gl, gl > 1e-5);
  let o = omega[i];
  // only where there is flame (vel.w: how much), and never more than a strong gust
  var f = curl.strength * h * cross(N, o.xyz) * vel[i].w;
  let fl = length(f);
  f = select(f, f * (curl.maxForce / fl), fl > curl.maxForce);
  vel[i] = vec4f(f, 0.0);
}

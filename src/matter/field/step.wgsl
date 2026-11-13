// One step of the matter field, a thread per cell. Last frame's contents (fieldA, fieldB, laid out at last frame's
// origin) are read at the point the air carried here (semi-Lagrangian advection, two-stage back trace), blurred a
// little toward their neighbours, faded toward calm, and the heat makes the air rise (cold makes it sink); then
// what is here this frame is laid on top: every dancer's capsules (they drag the air at their own velocity and
// warm, chill or wet it by what that part wears: FieldSim.auras), the CPU's point deposits and the vortex sources.
// It writes nextA and nextB; field.ts copies them over fieldA and fieldB before anything samples the field.
//
// Every rate is applied as 1 - exp(-rate dt), and the advection only ever samples, so the step is stable at any dt.
#include "../core/body"
#include "./field"

/** a point deposit (field.ts Deposit): p and radius; the wind there and how much it takes; the heat and wet levels */
struct Deposit { at: vec4f, wind: vec4f, levels: vec4f }
/** a vortex source: centre and radius; axis and strength (m/s at the radius); inflow and lift (m/s), height (m) */
struct Vortex { at: vec4f, axis: vec4f, flow: vec4f }

struct FieldSim {
  dt: f32, time: f32, deposits: u32, vortices: u32,
  capsules: u32, windDecay: f32, hotDecay: f32, coldDecay: f32,
  wetDecay: f32, diffuse: f32, buoyancy: f32, sink: f32,
  drag: f32, auraRate: f32, reach: f32, exchange: f32,
  melt: f32, steamGain: f32, windMax: f32, vortexRate: f32,
  /** per capsule slot (dancer × SEGS + capsule): heat (signed), wet, dry, how much it stirs the air */
  auras: array<vec4f, 256>,
  deposit: array<Deposit, FIELD_DEPOSITS>,
  vortex: array<Vortex, FIELD_VORTICES>,
}

@group(1) @binding(0) var<uniform> sim: FieldSim;
@group(1) @binding(1) var nextA: texture_storage_3d<rgba16float, write>;
@group(1) @binding(2) var nextB: texture_storage_3d<rgba16float, write>;

/** last frame's contents at p (world), zero outside last frame's box */
fn prevAt(p: vec3f) -> FieldSample {
  let size = fieldBox.dims * fieldBox.cell;
  let uvw = (p - fieldBox.prev) / size;
  let edge = min(min(uvw, 1.0 - uvw) * fieldBox.dims, vec3f(1.0));
  let w = clamp(min(edge.x, min(edge.y, edge.z)), 0.0, 1.0);
  var s: FieldSample;
  if (w <= 0.0) { return s; }
  s.a = textureSampleLevel(fieldA, samp_linear, uvw, 0.0) * w;
  s.b = textureSampleLevel(fieldB, samp_linear, uvw, 0.0) * w;
  return s;
}

/** the air a vortex source moves at p: round its axis, in toward it, up along it */
fn vortexWind(v: Vortex, p: vec3f) -> vec4f {
  let axis = normalize(v.axis.xyz + vec3f(0.0, 1e-5, 0.0));
  let r = p - v.at.xyz;
  let h = dot(r, axis);
  let radial = r - axis * h;
  let rho = length(radial);
  let R = max(v.at.w, 0.05);
  // a Rankine core (solid turning inside R, falling as R/rho outside), faded well beyond it and along the axis
  let swirl = select(R / max(rho, 1e-3), rho / R, rho < R);
  let reach = exp(-pow(rho / (3.0 * R), 2.0)) * exp(-pow(h / max(v.flow.z, 0.1), 2.0));
  let around = cross(axis, radial / max(rho, 1e-4));
  let inward = -radial / max(rho, 1e-4) * smoothstep(0.0, R, rho);
  let wind = around * (v.axis.w * swirl) + inward * v.flow.x + axis * v.flow.y;
  return vec4f(wind, reach);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec3u(fieldBox.dims);
  if (any(id >= dims)) { return; }
  let dt = sim.dt;
  let cell = fieldBox.cell;
  let p = fieldBox.origin + (vec3f(id) + 0.5) * cell;

  // ---------------------------------------------------------------- carried by the air (from last frame's box)
  let w0 = prevAt(p).a.xyz;
  let w1 = prevAt(p - w0 * (0.5 * dt)).a.xyz;
  let back = p - w1 * dt;
  let here = prevAt(back);
  var a = here.a;
  var b = here.b;
  // a little diffusion: toward the average of the six neighbours of where it came from
  var na = vec4f(0.0);
  var nb = vec4f(0.0);
  for (var k = 0u; k < 6u; k++) {
    var o = vec3f(0.0);
    o[k / 2u] = select(-cell, cell, (k & 1u) == 1u);
    let s = prevAt(back + o);
    na += s.a;
    nb += s.b;
  }
  let kd = 1.0 - exp(-sim.diffuse * dt);
  a = mix(a, na / 6.0, kd);
  b = mix(b, nb / 6.0, kd);

  var wind = a.xyz;
  var wet = max(a.w, 0.0);
  var hot = max(b.x, 0.0);
  var cold = max(b.y, 0.0);

  // ---------------------------------------------------------------- toward calm; heat meets cold; hot air rises
  wind *= exp(-sim.windDecay * dt);
  hot *= exp(-sim.hotDecay * dt);
  cold *= exp(-sim.coldDecay * dt);
  wet *= exp(-sim.wetDecay * dt);
  // where flame and ice share a cell they use each other up, and the ice melts into wet
  let met = min(hot, cold) * (1.0 - exp(-sim.exchange * dt));
  hot -= met;
  cold -= met;
  wet += met * sim.melt;
  wind.y += (sim.buoyancy * hot - sim.sink * cold) * dt;

  // ---------------------------------------------------------------- the bodies: wind from their limbs, their auras
  var stirW = 0.0;
  var stirV = vec3f(0.0);
  var hotT = 0.0;
  var coldT = 0.0;
  var wetT = 0.0;
  var dryT = 0.0;
  let reach = max(sim.reach, 1e-3);
  for (var d = 0u; d < bodies.dancers; d++) {
    // (a dancer is at most ~1.3 m from its hips to a raised fingertip)
    if (distance(p, joints[d * MAXJ].pos.xyz) > 1.5 + 2.5 * reach) { continue; }
    for (var s = 0u; s < sim.capsules; s++) {
      let slot = d * SEGS + s;
      let seg = segs[slot];
      let j = joints[d * MAXJ + u32(seg.info.x)];
      let c = joints[d * MAXJ + u32(seg.info.y)];
      let ab = c.pos.xyz - j.pos.xyz;
      let t = clamp(dot(p - j.pos.xyz, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      let dist = length(p - (j.pos.xyz + ab * t));
      let r = mix(max(seg.b1.w, seg.b2.w), max(seg.info.z, seg.info.w), t);
      let x = max(dist - r, 0.0) / reach;
      if (x > 2.5) { continue; }
      let w = exp(-x * x);
      let aura = sim.auras[slot];
      stirW += w * aura.w;
      stirV += w * aura.w * mix(j.vel.xyz, c.vel.xyz, t);
      hotT = max(hotT, w * max(aura.x, 0.0));
      coldT = max(coldT, w * max(-aura.x, 0.0));
      wetT = max(wetT, w * aura.y);
      dryT = max(dryT, w * aura.z);
    }
  }
  if (stirW > 1e-4) { wind = mix(wind, stirV / stirW, min(stirW, 1.0) * (1.0 - exp(-sim.drag * dt))); }
  let ka = 1.0 - exp(-sim.auraRate * dt);
  hot += max(hotT - hot, 0.0) * ka;
  cold += max(coldT - cold, 0.0) * ka;
  wet += max(wetT - wet, 0.0) * ka;
  wet -= wet * dryT * ka;

  // ---------------------------------------------------------------- the CPU's deposits, the vortex sources
  for (var i = 0u; i < sim.deposits; i++) {
    let dp = sim.deposit[i];
    let x = distance(p, dp.at.xyz) / max(dp.at.w, 1e-3);
    if (x > 2.5) { continue; }
    let w = exp(-x * x);
    wind = mix(wind, dp.wind.xyz, w * clamp(dp.wind.w, 0.0, 1.0));
    hot = max(hot, w * max(dp.levels.x, 0.0));
    cold = max(cold, w * max(-dp.levels.x, 0.0));
    wet = max(wet, w * dp.levels.y);
  }
  let kv = 1.0 - exp(-sim.vortexRate * dt);
  for (var i = 0u; i < sim.vortices; i++) {
    let v = vortexWind(sim.vortex[i], p);
    wind = mix(wind, v.xyz, v.w * kv);
  }

  // ---------------------------------------------------------------- bounds, and what reactions read
  let speed = length(wind);
  if (speed > sim.windMax) { wind *= sim.windMax / speed; }
  hot = clamp(hot, 0.0, 4.0);
  cold = clamp(cold, 0.0, 4.0);
  wet = clamp(wet, 0.0, 4.0);
  // steam is made where heat meets wet, and (more) where a flame is melting ice
  let steam = sim.steamGain * (min(hot, 2.0) * min(wet, 2.0) + 6.0 * min(hot, cold) + met / max(dt, 1e-4) * 0.5);
  textureStore(nextA, id, vec4f(wind, wet));
  textureStore(nextB, id, vec4f(hot, cold, steam, stirW));
}

// One step of the matter field, a thread per cell. Last frame's contents (fieldA, fieldB, laid out at last frame's
// origin) are read at the point the air carried here (semi-Lagrangian advection, two-stage back trace), blurred a
// little toward their neighbours, faded toward calm, and the heat makes the air rise (cold makes it sink); then
// what is here this frame is laid on top: every dancer's capsules (they drag the air at their own velocity and
// warm, chill or wet it by what that part wears: FieldSim.auras), the CPU's point deposits and the vortex sources.
// Heat and cold also radiate a faint tail past a body's near falloff (so the body beside it feels it: water thinning in
// heat, ice melting, water freezing), a fast limb drags the air further (the wake behind a kick), plasma's dryness is
// kept in B.w (reactions tell plasma from fire by it), and a fusion winds its two matters into a double helix.
// Whose heat it is goes in C: the dancer laying the most heat in a cell owns its hot, the one laying the most cold owns
// its cold (a flame and an ice body touching: each its own), and the part of the cell's hot and cold that is its
// owner's own is carried with the air beside B's (so water can tell its own flame's heat from a partner's: field.wgsl
// fieldHeatFrom). The helix, the deposits and anything carried in from another owner's cells are nobody's own.
// It writes nextA, nextB and nextC; field.ts copies them over fieldA, fieldB and fieldC before anything samples the field.
//
// Every rate is applied as 1 - exp(-rate dt), and the advection only ever samples, so the step is stable at any dt.
#include "../core/body"
#include "./field"

/** a point deposit (field.ts Deposit): p and radius; the wind there and how much it takes; the heat and wet levels */
struct Deposit { at: vec4f, wind: vec4f, levels: vec4f }
/** a vortex source: centre and radius; axis and strength (m/s at the radius); inflow and lift (m/s), height (m) */
struct Vortex { at: vec4f, axis: vec4f, flow: vec4f }
/** the fusion's double helix (field.ts fuse): two strands of the two matters' auras wound round a shared axis.
 *  at: centre, radius of the strands; axis: direction, turns per metre; auraA/auraB: heat, wet, dry, and the strand's
 *  width (m); shape: phase (rad), half height (m), amount 0 … 1, how much steam the strands make */
struct Helix { at: vec4f, axis: vec4f, auraA: vec4f, auraB: vec4f, shape: vec4f }

struct FieldSim {
  dt: f32, time: f32, deposits: u32, vortices: u32,
  capsules: u32, windDecay: f32, hotDecay: f32, coldDecay: f32,
  wetDecay: f32, diffuse: f32, buoyancy: f32, sink: f32,
  drag: f32, auraRate: f32, reach: f32, exchange: f32,
  melt: f32, steamGain: f32, windMax: f32, vortexRate: f32,
  /** the radiant tail of heat and cold past a body's near falloff: its level and its length (m); a fast limb's drag
   *  reaches further: reach × (1 + wake × speed) */
  radiate: f32, radiateLen: f32, wake: f32, dryDecay: f32,
  helix: Helix,
  /** per dancer slot (d: [d / 4][d % 4]): 1 when its heat is nobody's own (a fused body: play/fusion.ts dresses both
   *  dancers in one flame, and the water resting on its feet is meant to boil thin under it), 0 otherwise */
  unowned: array<vec4f, 2>,
  /** per capsule slot (dancer × SEGS + capsule): heat (signed), wet, dry, how much it stirs the air */
  auras: array<vec4f, 256>,
  deposit: array<Deposit, FIELD_DEPOSITS>,
  vortex: array<Vortex, FIELD_VORTICES>,
}

@group(1) @binding(0) var<uniform> sim: FieldSim;
@group(1) @binding(1) var nextA: texture_storage_3d<rgba16float, write>;
@group(1) @binding(2) var nextB: texture_storage_3d<rgba16float, write>;
@group(1) @binding(3) var nextC: texture_storage_3d<rgba16float, write>;

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

/** last frame's C (whose heat: field.wgsl) at p, zero outside last frame's box */
fn prevC(p: vec3f) -> vec4f {
  let size = fieldBox.dims * fieldBox.cell;
  let uvw = (p - fieldBox.prev) / size;
  let edge = min(min(uvw, 1.0 - uvw) * fieldBox.dims, vec3f(1.0));
  let w = clamp(min(edge.x, min(edge.y, edge.z)), 0.0, 1.0);
  if (w <= 0.0) { return vec4f(0.0); }
  return textureSampleLevel(fieldC, samp_linear, uvw, 0.0) * w;
}

/** one half of C (hot or cold) in a cell: the owner's share carried here and its slot, against the dancer laying the
 *  most this frame (its slot and level) and the cell's total after laying. The owner keeps the cell and lays its share
 *  as the total takes it; another dancer takes the cell over once it lays more than the owner's carried share, and
 *  claims the cell's heat up to what it lays (so its own matter doesn't see its own heat ramping up as someone else's).
 *  Returns (share, owner) */
fn claim(own: f32, owner: f32, bestD: u32, best: f32, total: f32, ka: f32) -> vec2f {
  if (best <= 1e-3) { return vec2f(own, owner); }
  if (own > 1e-4 && abs(owner - f32(bestD)) < 0.5) { return vec2f(own + max(best - own, 0.0) * ka, owner); }
  if (best >= own) { return vec2f(min(total, best), f32(bestD)); }
  return vec2f(own, owner);
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
  var c = prevC(back);
  // a little diffusion: toward the average of the six neighbours of where it came from
  var na = vec4f(0.0);
  var nb = vec4f(0.0);
  var nc = vec4f(0.0);
  for (var k = 0u; k < 6u; k++) {
    var o = vec3f(0.0);
    o[k / 2u] = select(-cell, cell, (k & 1u) == 1u);
    let s = prevAt(back + o);
    na += s.a;
    nb += s.b;
    nc += prevC(back + o);
  }
  let kd = 1.0 - exp(-sim.diffuse * dt);
  a = mix(a, na / 6.0, kd);
  b = mix(b, nb / 6.0, kd);
  c = mix(c, nc / 6.0, kd);

  var wind = a.xyz;
  var wet = max(a.w, 0.0);
  var hot = max(b.x, 0.0);
  var cold = max(b.y, 0.0);
  // B.w: how dry the air is (plasma's aura boils wet away): reactions tell plasma from fire by it
  var dry = max(b.w, 0.0);
  // C: the owners' shares of hot and cold, and the owners (their slots, premultiplied by those shares)
  var ownHot = max(c.x, 0.0);
  var ownCold = max(c.y, 0.0);
  var hotOwner = c.z / max(ownHot, 1e-4);
  var coldOwner = c.w / max(ownCold, 1e-4);

  // ---------------------------------------------------------------- toward calm; heat meets cold; hot air rises
  wind *= exp(-sim.windDecay * dt);
  hot *= exp(-sim.hotDecay * dt);
  cold *= exp(-sim.coldDecay * dt);
  ownHot *= exp(-sim.hotDecay * dt);
  ownCold *= exp(-sim.coldDecay * dt);
  wet *= exp(-sim.wetDecay * dt);
  dry *= exp(-sim.dryDecay * dt);
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
  // the dancers laying the most heat and the most cold here, and what they lay (whose heat: C)
  var hotD = 0u;
  var coldD = 0u;
  var bestHot = 0.0;
  var bestCold = 0.0;
  let reach = max(sim.reach, 1e-3);
  let tailLen = max(sim.radiateLen, 1e-3);
  // how far the radiant tail is worth following (where it falls under 1 % of its level)
  let tailMax = select(0.0, tailLen * 4.6, sim.radiate > 0.0);
  for (var d = 0u; d < bodies.dancers; d++) {
    // (a dancer is at most ~1.3 m from its hips to a raised fingertip)
    if (distance(p, joints[d * MAXJ].pos.xyz) > 1.5 + max(2.5 * reach * (1.0 + sim.wake * 8.0), tailMax)) { continue; }
    var hotHere = 0.0;
    var coldHere = 0.0;
    for (var s = 0u; s < sim.capsules; s++) {
      let slot = d * SEGS + s;
      let seg = segs[slot];
      let j = joints[d * MAXJ + u32(seg.info.x)];
      let c = joints[d * MAXJ + u32(seg.info.y)];
      let ab = c.pos.xyz - j.pos.xyz;
      let t = clamp(dot(p - j.pos.xyz, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      let dist = length(p - (j.pos.xyz + ab * t));
      let r = mix(max(seg.b1.w, seg.b2.w), max(seg.info.z, seg.info.w), t);
      let past = max(dist - r, 0.0);
      let vel = mix(j.vel.xyz, c.vel.xyz, t);
      // a fast limb drags the air further: the wake behind a kick (wake 0.08: 6 m/s reaches 1.5 × as far)
      let xs = past / (reach * (1.0 + sim.wake * min(length(vel), 8.0)));
      let x = past / reach;
      if (xs > 2.5 && past > tailMax) { continue; }
      let w = exp(-x * x);
      let ws = exp(-xs * xs);
      // heat and cold also radiate: a long, faint tail past the near falloff (so water feels a flame 30 cm away)
      let wr = max(w, sim.radiate * exp(-past / tailLen));
      let aura = sim.auras[slot];
      stirW += ws * aura.w;
      stirV += ws * aura.w * vel;
      hotHere = max(hotHere, wr * max(aura.x, 0.0));
      coldHere = max(coldHere, wr * max(-aura.x, 0.0));
      wetT = max(wetT, w * aura.y);
      dryT = max(dryT, w * aura.z);
    }
    hotT = max(hotT, hotHere);
    coldT = max(coldT, coldHere);
    // (a fused body's heat is nobody's own: it lays the totals and claims nothing)
    if (sim.unowned[d / 4u][d % 4u] < 0.5) {
      if (hotHere > bestHot) { bestHot = hotHere; hotD = d; }
      if (coldHere > bestCold) { bestCold = coldHere; coldD = d; }
    }
  }
  if (stirW > 1e-4) { wind = mix(wind, stirV / stirW, min(stirW, 1.0) * (1.0 - exp(-sim.drag * dt))); }
  let ka = 1.0 - exp(-sim.auraRate * dt);
  hot += max(hotT - hot, 0.0) * ka;
  cold += max(coldT - cold, 0.0) * ka;
  wet += max(wetT - wet, 0.0) * ka;
  wet -= wet * dryT * ka;
  dry += max(dryT - dry, 0.0) * ka;
  // whose (claim, above)
  let ch = claim(ownHot, hotOwner, hotD, bestHot, hot, ka);
  ownHot = ch.x;
  hotOwner = ch.y;
  let cc = claim(ownCold, coldOwner, coldD, bestCold, cold, ka);
  ownCold = cc.x;
  coldOwner = cc.y;

  // ---------------------------------------------------------------- the fusion's double helix
  var helixSteam = 0.0;
  let hx = sim.helix;
  if (hx.shape.z > 0.0) {
    let axis = normalize(hx.axis.xyz + vec3f(0.0, 1e-5, 0.0));
    let rel = p - hx.at.xyz;
    let h = dot(rel, axis);
    let along = exp(-pow(max(abs(h) - hx.shape.y, 0.0) / 0.25, 2.0));
    if (along > 0.01) {
      // a frame round the axis, and the two strands' points at this height (half a turn apart)
      let e1 = normalize(cross(axis, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(axis.x) > 0.9)));
      let e2 = cross(axis, e1);
      let ang = hx.shape.x + 6.2831853 * hx.axis.w * h;
      let R = hx.at.w;
      let sa = hx.at.xyz + axis * h + (e1 * cos(ang) + e2 * sin(ang)) * R;
      let sb = hx.at.xyz + axis * h - (e1 * cos(ang) + e2 * sin(ang)) * R;
      let wa = exp(-pow(distance(p, sa) / max(hx.auraA.w, 0.02), 2.0)) * along * hx.shape.z;
      let wb = exp(-pow(distance(p, sb) / max(hx.auraB.w, 0.02), 2.0)) * along * hx.shape.z;
      for (var k = 0u; k < 2u; k++) {
        let au = select(hx.auraA, hx.auraB, k == 1u);
        let w = select(wa, wb, k == 1u);
        hot += max(w * max(au.x, 0.0) - hot, 0.0) * ka;
        cold += max(w * max(-au.x, 0.0) - cold, 0.0) * ka;
        wet += max(w * au.y - wet, 0.0) * ka;
        dry += max(w * au.z - dry, 0.0) * ka;
      }
      // the strands themselves breathe steam, so the helix reads in it whatever the two matters are
      helixSteam = (wa + wb) * hx.shape.w;
    }
  }

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
  dry = clamp(dry, 0.0, 2.0);
  // the owner's share is never more than the cell holds (melting, the exchange and the fade take from both)
  ownHot = clamp(ownHot, 0.0, hot);
  ownCold = clamp(ownCold, 0.0, cold);
  // steam is made where heat meets wet, and (more) where a flame is melting ice; the faint overlap of two auras'
  // tails a metre apart makes none (a threshold), so steam marks where they really meet
  let contact = min(hot, 2.0) * min(wet, 2.0) + 2.0 * min(hot, cold);
  let steam = sim.steamGain * (max(contact - 0.06, 0.0) * 2.0 + met / max(dt, 1e-4) * 0.3) + helixSteam;
  textureStore(nextA, id, vec4f(wind, wet));
  textureStore(nextB, id, vec4f(hot, cold, steam, dry));
  textureStore(nextC, id, vec4f(ownHot, ownCold, hotOwner * ownHot, coldOwner * ownCold));
}

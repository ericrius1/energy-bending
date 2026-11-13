// One step for every flame. A flame that has died (or was never born) is born again at its home on its dancer's
// capsules, with that limb's velocity, so the body always reads as a figure and its motion throws fire: a kick leaves
// the flames born along its path behind it as a sheet, a spin leaves a helix, a dancer standing still burns upward
// like a torch. Alive, it rises (buoyancy, stronger the hotter it is), is stirred (two scales of flow plus the field's
// wind), slows to the air's speed and cools. A few particle slots are embers instead: thrown off fast limbs, they
// live longer and drift up on the air. Plasma (form → 1) is tighter: a spring holds it to its home, it barely rises,
// is stirred harder and dies faster, and its embers are crackling sparks.
//
// The field: wet makes a flame die young, darker and smokier; cold (negative heat, near ice) makes it smaller and
// shorter-lived; the wind bends it. Nothing is written to the field (the field derives heat from where fire is).
#include "./flame"
#include "../core/body"
#include "../field/field"

@group(1) @binding(0) var<uniform> sim: FireSim;
@group(1) @binding(1) var<storage, read> homes: array<Home>;
@group(1) @binding(2) var<storage, read_write> flames: array<Flame>;

const UP = vec3f(0.0, 1.0, 0.0);

/** the stirring: two scales of a flow that climbs (so the eddies rise with the flame, as the reference's noise does) */
fn stir(p: vec3f, t: f32, fast: f32) -> vec3f {
  let a = flow(p * 2.3 + vec3f(0.31 * t, -1.7 * t, 0.0) * fast, t * 0.9 * fast);
  let b = flow(p * 6.1 + vec3f(-0.7 * t, -2.9 * t, 0.4 * t) * fast, t * 1.7 * fast);
  return a + 0.55 * b;
}

/** whether this part of the body is alight: the burn (a fixed share of the flames goes out as it falls), and during a
 *  rise the feet catch first and the head last */
fn alight(y: f32, seed: u32) -> bool {
  if (rnd(seed ^ 0xb012u) >= sim.burn) { return false; }
  if (sim.wake > 0.0) {
    let up = clamp((y - sim.body.floorY) / 1.9, 0.0, 1.0);
    return sim.time > sim.wake + sim.wakeSpread * up + 0.3 * rnd(seed ^ 0xb013u);
  }
  return true;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.count) { return; }
  let dt = sim.dt;
  if (dt <= 0.0) { return; }
  let home = homes[i];
  var f = flames[i];
  let d = dancerOf(home);
  let form = clamp(home.look.x + sim.form[d / 4u][d % 4u], 0.0, 1.0);
  let seed = pcg(i * 9781u + 17u);
  let rn = pcg(i ^ (sim.frameNo * 2654435761u));
  // a few slots throw embers (or sparks), the rest are flame
  let emberSlot = rnd(seed ^ 0xe0u) < 0.035 * min(sim.embers, 4.0);

  f.age += dt;
  if (f.age < 0.0) { flames[i] = f; return; }

  if (f.life <= 0.0 || f.age >= f.life) {
    let H = homeOf(home, i, sim.body);
    if (!alight(H.pos.y, seed)) { f.age = 0.0; f.life = 0.0; flames[i] = f; return; }
    if (f.life <= 0.0) {
      // never born, or out until now: wait a random part of a life first, so the flames don't all beat in step
      f.age = -rnd(rn ^ 0x3u) * sim.life * mix(1.0, 0.4, form);
      f.life = 1e-5;
      f.pos = H.pos;
      flames[i] = f;
      return;
    }
    // born again at home
    let speed = length(H.vel);
    let wet = clamp(fieldWet(H.pos), 0.0, 1.0);
    let cold = clamp(-fieldHeat(H.pos), 0.0, 1.0);
    let r1 = rnd(rn ^ 0xa1u);
    let r2 = rnd(rn ^ 0xa2u);
    let r3 = rnd(rn ^ 0xa3u);
    // embers fly mostly off fast limbs; a still dancer lets one go now and then
    let ember = emberSlot && rnd(rn ^ 0xa4u) < 0.06 + 0.94 * smoothstep(1.0, 4.0, speed);
    let core = 1.0 - home.place.w;            // 0 on the surface … ~0.65 deep inside: the inside burns hotter
    let torso = select(0.0, 1.0, home.look.z < 0.5);
    f.age = 0.0;
    f.pos = H.pos + H.out * (0.015 * r1 * (1.0 - 0.7 * form)) + sphereDir(rn ^ 0xa5u) * 0.008;
    let k = mix(1.0, 0.35, form) * (1.0 - 0.65 * wet) * (1.0 - 0.55 * cold);
    let T0 = sim.heat * mix(0.7, 1.3, r2) * (1.0 + 0.6 * core + 0.15 * torso) * (1.0 - 0.75 * wet) * (1.0 - 0.4 * cold);
    if (ember) {
      f.vel = H.vel * mix(0.9, 1.25, r1) + sphereDir(rn ^ 0xa6u) * mix(0.4, 1.0, r3) * (1.0 + form) + UP * 0.4 * (1.0 - form);
      f.life = mix(mix(0.7, 2.9, r3 * r3), mix(0.18, 0.58, r3), form) * (1.0 - 0.5 * wet);
      f.look = vec4f(form, 1.0, -sim.size * mix(0.12, 0.26, r2), wet);
    } else {
      f.vel = H.vel * sim.inherit + H.out * mix(0.03, 0.15, r1) * (1.0 - 0.8 * form) + UP * 0.2 * (1.0 - form);
      f.life = sim.life * mix(0.45, 1.25, r3 * r3) * k;
      f.look = vec4f(form, T0, sim.size * mix(0.6, 1.4, r1) * (1.0 - 0.45 * cold), wet);
    }
    flames[i] = f;
    return;
  }

  // alive
  let wind = fieldWind(f.pos);
  if (f.look.z < 0.0) {
    // an ember (or a spark): it follows the air, drifts up and jitters (a spark crackles, a lot)
    f.vel += (UP * (0.35 + 0.4 * rnd(seed ^ 0x51u)) * (1.0 - form) + sphereDir(rn ^ 0x52u) * mix(0.5, 2.4, form) * 3.0) * dt;
    f.vel = wind + (f.vel - wind) * exp(-mix(0.9, 2.5, form) * dt);
  } else {
    let T = flameT(f);
    var acc = UP * sim.buoyancy * (0.3 + min(T, 2.5)) * (1.0 - 0.75 * form);
    acc += stir(f.pos, sim.time, mix(1.0, 4.0, form)) * sim.turbulence * (0.35 + min(T, 1.6)) * (1.0 + 0.8 * form);
    f.vel = wind + (f.vel - wind) * exp(-sim.drag * dt);
    // plasma clings: an implicit spring to where its home is now (stable for any stiffness and step)
    let kc = sim.cling * form * form;
    if (kc > 0.0) {
      let H = homeOf(home, i, sim.body);
      let c = sqrt(kc) * 0.6;
      f.vel = (f.vel + dt * (kc * (H.pos + H.out * 0.02 - f.pos) + c * H.vel + acc)) / (1.0 + dt * c + dt * dt * kc);
    } else {
      f.vel += acc * dt;
    }
  }
  // a shatter: a shockwave from a point; flames caught in it fly and burn a little longer
  if (sim.blast.w > 0.0) {
    let bv = f.pos - sim.blast.xyz;
    let w = sim.blast.w * max(0.0, 1.0 - length(bv) / 2.5);
    f.vel += normalize(bv + vec3f(0.0, 1e-3, 0.0)) * w * 2.5;
    f.life += w * 0.25;
  }
  f.pos += f.vel * dt;
  if (f.pos.y < sim.body.floorY + 0.01) { f.pos.y = sim.body.floorY + 0.01; f.vel.y = abs(f.vel.y) * 0.3; }
  if (any(f.pos != f.pos) || any(f.vel != f.vel)) { f.life = 0.0; f.age = 0.0; f.vel = vec3f(0.0); f.pos = vec3f(0.0); }
  flames[i] = f;
}

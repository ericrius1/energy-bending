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
//
// The curl: a fire dancer's flames are pushed round the eddies of their own flow (curl.wgsl: a grid round the body,
// vorticity confinement), so the tongues curl and lick instead of only rising.
//
// A fusion's flames (a home whose form slot holds 2 + its side: play/fusion.ts dresses both bodies in them for the eight
// bars) move by the fusion's kind instead of by form (fusionMotion): steam swells and rises in a column, prism clings
// thin and quick, storm hangs heavy and some of it falls as rain, aurora rises slow and far. Some of each body's flames
// are the helix's: born on their body's strand of the field's double helix and held to it as they climb, so the two
// strands turn round the pair. Past the eighth bar (the release) they are thrown outward from the middle.
#include "./flame"
#include "../core/body"
#include "../field/field"
#include "./curlgrid"

@group(1) @binding(0) var<uniform> sim: FireSim;
@group(1) @binding(1) var<storage, read> homes: array<Home>;
@group(1) @binding(2) var<storage, read_write> flames: array<Flame>;
@group(1) @binding(3) var<uniform> curl: Curl;
@group(1) @binding(4) var<storage, read> curlForce: array<vec4f>;

const UP = vec3f(0.0, 1.0, 0.0);

/** the stirring: two scales of a flow that climbs (so the eddies rise with the flame, as the reference's noise does) */
fn stir(p: vec3f, t: f32, fast: f32) -> vec3f {
  let a = flow(p * 2.3 + vec3f(0.31 * t, -1.7 * t, 0.0) * fast, t * 0.9 * fast);
  let b = flow(p * 6.1 + vec3f(-0.7 * t, -2.9 * t, 0.4 * t) * fast, t * 1.7 * fast);
  return a + 0.55 * b;
}

/** the curl grid's push at p for dancer d's flames (trilinear; nothing outside its box, or without a grid) */
fn curlAt(d: u32, p: vec3f) -> vec3f {
  let g = gridOf(d);
  if (g < 0 || u32(g) >= curl.grids) { return vec3f(0.0); }
  let b = curl.boxes[g];
  let dims = vec3i(curl.dims.xyz);
  let x = (p - b.xyz) / b.w - 0.5;
  if (any(x < vec3f(0.0)) || any(x > vec3f(dims - 1))) { return vec3f(0.0); }
  let c0 = vec3i(floor(x));
  let t = x - floor(x);
  let base = u32(g) * cellsOf();
  var s = vec3f(0.0);
  for (var k = 0u; k < 8u; k++) {
    let o = vec3i(i32(k & 1u), i32((k >> 1u) & 1u), i32((k >> 2u) & 1u));
    let q = min(c0 + o, dims - 1);
    let wv = select(1.0 - t, t, o == vec3i(1));
    s += curlForce[base + u32(q.x + dims.x * (q.y + dims.y * q.z))].xyz * (wv.x * wv.y * wv.z);
  }
  return s;
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

/** a point on strand `side` (0 or 1, half a turn apart) of the fusion's helix, `h` m above its centre: the field's own
 *  strands (step.wgsl: e1, e2 the frame round an upright axis) */
fn strandAt(side: f32, h: f32) -> vec3f {
  let ang = sim.helixShape.x + 6.2831853 * sim.helixShape.z * h;
  let r = (vec3f(0.0, 0.0, -1.0) * cos(ang) + vec3f(-1.0, 0.0, 0.0) * sin(ang)) * sim.helixAt.w;
  return sim.helixAt.xyz + vec3f(0.0, h, 0.0) + select(r, -r, side > 0.5);
}

/** how a fusion kind's flames move, × fire's own: life, buoyancy, size, stirring */
fn fusionMotion(K: u32) -> vec4f {
  if (K == 1u) { return vec4f(0.65, 0.5, 0.8, 0.8); }     // prism: thin, quick, close to the body
  if (K == 2u) { return vec4f(1.0, 0.35, 1.45, 1.3); }    // storm: heavy, hanging, churning
  if (K == 3u) { return vec4f(2.3, 1.15, 1.3, 0.45); }    // aurora: slow, rising far
  return vec4f(1.5, 1.35, 1.5, 0.9);                       // steam: swelling, a rising column
}

/** a fusion flame's role, fixed by its slot: 0 the body, 1 the helix, 2 rain (storm) */
fn fusionRole(seed: u32, K: u32) -> u32 {
  let r = rnd(seed ^ 0xf00du);
  if (r < 0.18) { return 1u; }
  if (K == 2u && r < 0.3) { return 2u; }
  return 0u;
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
  let fus = isFusion(home.look.x);
  let form = select(clamp(home.look.x + sim.form[d / 4u][d % 4u], 0.0, 1.0), 0.0, fus);
  let seed = pcg(i * 9781u + 17u);
  let rn = pcg(i ^ (sim.frameNo * 2654435761u));
  // a few slots throw embers (or sparks), the rest are flame (a fusion's are all flame)
  let emberSlot = rnd(seed ^ 0xe0u) < 0.035 * min(sim.embers, 4.0) && !fus;
  let K = u32(sim.fusion.x + 0.5);
  let side = fusionSide(home.look.x);
  let role = select(0u, fusionRole(seed, K), fus);
  let fm = select(vec4f(1.0), fusionMotion(K), fus);
  // through the eight bars the column grows (aurora most), and past the eighth it is let go
  let grow = select(1.0, 1.0 + 0.06 * clamp(sim.fusion.z, 0.0, 8.0) * select(1.0, 2.0, K == 3u), fus);
  let released = fus && sim.fusion.z > 8.0;

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
    // the field's wet and cold, from where they start to tell (0.05: within ~30 cm of water or ice) to touching and
    // past (0.6 is a body's own surface; docs/reports/4-steam.md has the measured values)
    let wet = smoothstep(0.05, 0.6, fieldWet(H.pos));
    let cold = smoothstep(0.05, 0.6, -fieldHeat(H.pos));
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
      f.life = sim.life * mix(0.45, 1.25, r3 * r3) * k * fm.x * grow;
      f.look = vec4f(form, T0, sim.size * mix(0.6, 1.4, r1) * (1.0 - 0.45 * cold) * fm.z, wet);
    }
    if (fus) {
      // the flame keeps its side where its form would be (the field tells the two bodies' matter apart by it)
      f.look.x = 2.0 + side;
      f.look.w = 0.0;
      if (role == 1u) {
        // the helix: born on its body's strand, anywhere up it
        let h = (rnd(rn ^ 0xb1u) * 2.0 - 1.0) * sim.helixShape.y;
        f.pos = strandAt(side, h) + sphereDir(rn ^ 0xb2u) * 0.025;
        f.vel = UP * 0.3;
        f.life = sim.life * mix(0.9, 1.5, r3) * select(1.0, 1.6, K == 3u);
        f.look.y = sim.heat * mix(0.4, 0.6, r2);
        f.look.z = sim.size * mix(0.6, 0.9, r1);
      } else if (role == 2u) {
        // storm's rain: from above the pair, falling, thin and faint
        let a = rnd(rn ^ 0xb3u) * 6.2831853;
        let rr = 1.25 * sqrt(rnd(rn ^ 0xb4u));
        f.pos = sim.helixAt.xyz + vec3f(cos(a) * rr, 0.9 + 1.4 * rnd(rn ^ 0xb5u), sin(a) * rr);
        f.vel = vec3f(0.0, -3.2 - 1.5 * r1, 0.0);
        f.life = 0.45 + 0.35 * r3;
        f.look.y = sim.heat * 0.4;
        f.look.z = sim.size * 0.45;
      }
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
  } else if (role == 2u) {
    // rain falls through the air, barely stirred
    f.vel += (-UP * 5.0 + (wind - f.vel) * 0.6) * dt;
  } else if (role == 1u) {
    // a helix flame climbs its strand: an implicit spring to the strand's point at its own height, which turns
    let T = flameT(f);
    let goal = strandAt(side, f.pos.y - sim.helixAt.y);
    let acc = UP * sim.buoyancy * 0.35 * (0.3 + min(T, 2.0)) * select(1.0, 1.5, K == 3u) + stir(f.pos, sim.time * 0.5, 0.6) * 0.6;
    let kc = select(90.0, 4.0, released);
    let c = sqrt(kc) * 0.9;
    f.vel = (f.vel + dt * (kc * (goal - f.pos) + acc)) / (1.0 + dt * c + dt * dt * kc);
  } else {
    let T = flameT(f);
    var acc = UP * sim.buoyancy * (0.3 + min(T, 2.5)) * (1.0 - 0.75 * form) * fm.y;
    // aurora's stirring runs at half time
    acc += stir(f.pos, sim.time * select(1.0, 0.5, fus && K == 3u), mix(1.0, 4.0, form)) * sim.turbulence * (0.35 + min(T, 1.6)) * (1.0 + 0.8 * form) * fm.w;
    // plasma clings to its home, so it takes little of the curl
    acc += curlAt(d, f.pos) * (1.0 - 0.8 * form);
    f.vel = wind + (f.vel - wind) * exp(-sim.drag * dt);
    // plasma clings: an implicit spring to where its home is now (stable for any stiffness and step)
    let kc = sim.cling * form * form + select(0.0, 25.0, fus && K == 1u && !released);
    if (kc > 0.0) {
      let H = homeOf(home, i, sim.body);
      let c = sqrt(kc) * 0.6;
      f.vel = (f.vel + dt * (kc * (H.pos + H.out * 0.02 - f.pos) + c * H.vel + acc)) / (1.0 + dt * c + dt * dt * kc);
    } else {
      f.vel += acc * dt;
    }
  }
  // the release: the one body is let go, outward from the middle and up
  if (released) {
    let out = f.pos - sim.helixAt.xyz;
    let o = vec3f(out.x, 0.0, out.z);
    f.vel += (o / max(length(o), 0.05) * 5.0 + UP * 1.5) * dt * (1.0 - smoothstep(8.0, 8.6, sim.fusion.z) * 0.5);
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

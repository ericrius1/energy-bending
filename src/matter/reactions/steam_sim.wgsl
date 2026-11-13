// Steam's simulation, a thread a particle. A dead particle tries to be born where two bodies meet: it picks a random
// point on the axis of a random capsule of a random dancer, finds the nearest capsule of any other dancer, and if the
// two surfaces are within `gap` of each other (or cross) it takes a point on the contact: the ring where the two
// capsules' surfaces cross, or the middle of the gap between them. It is born there with a chance set by how much steam
// the field is making at that point (fieldSteam: heat meeting wet, flame meeting ice), so only reacting matter meets
// in steam. Which pair is meeting is read off the field at that point, not from the dancers: plasma's heat is dry (the
// field's dryness, or heat past fire's), ice's is cold. Wisps can also be born where the field makes steam away from
// any contact (a deposit, the fusion's helix), at the field's coarser grain.
//
// A live wisp follows the field's wind, rises on its own warmth (fading as it ages; plasma against ice sinks first),
// and is stirred by a slow curl. A front stays where it was born for its tenth of a second (the next ones are born on
// the contact as it moves, so the line follows the contact and is gone when the bodies part). A drip falls. A spark
// flickers where it was born. Births need no CPU and no counters: the pool is the cap.
#include "../core/body"
#include "../field/field"
#include "./steam"

@group(1) @binding(0) var<uniform> steam: Steam;
@group(1) @binding(1) var<storage, read_write> puffs: array<Puff>;

/** a point on the contact between two bodies: where, the direction between the bodies there (n), a direction along
 *  the contact line (t), outward from the contact's middle (out), whether one was found */
struct Contact { p: vec3f, ok: bool, n: vec3f, t: vec3f, out: vec3f }

fn capRadius(seg: Seg, t: f32) -> f32 { return mix(max(seg.b1.w, seg.b2.w), max(seg.info.z, seg.info.w), t); }

/** a random point on the contact between dancer d's random capsule and the nearest other body (see the opening note) */
fn contact(rn: u32) -> Contact {
  var c: Contact;
  let D = bodies.dancers;
  if (D < 2u) { return c; }
  let d = min(u32(rnd(rn ^ 0x11u) * f32(D)), D - 1u);
  let s = min(u32(rnd(rn ^ 0x22u) * f32(steam.capsules)), steam.capsules - 1u);
  let seg = segs[d * SEGS + s];
  let a = joints[d * MAXJ + u32(seg.info.x)].pos.xyz;
  let b = joints[d * MAXJ + u32(seg.info.y)].pos.xyz;
  let t = rnd(rn ^ 0x33u);
  let P = mix(a, b, t);
  let ra = capRadius(seg, t);
  var best = 1e9;
  var Q = P;
  for (var e = 0u; e < D; e++) {
    if (e == d || distance(joints[e * MAXJ].pos.xyz, P) > 1.6 + steam.gap) { continue; }
    for (var k = 0u; k < steam.capsules; k++) {
      let sg = segs[e * SEGS + k];
      let a2 = joints[e * MAXJ + u32(sg.info.x)].pos.xyz;
      let ab = joints[e * MAXJ + u32(sg.info.y)].pos.xyz - a2;
      let tt = clamp(dot(P - a2, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      let q = a2 + ab * tt;
      let g = distance(P, q) - ra - capRadius(sg, tt);
      if (g < best) { best = g; Q = q; }
    }
  }
  if (best > steam.gap) { return c; }
  let toQ = Q - P;
  let n = select(vec3f(0.0, 1.0, 0.0), normalize(toQ), length(toQ) > 1e-4);
  // the plane halfway between the two surfaces; where they cross, the ring on it where both surfaces are
  let half = max(ra + best * 0.5, -0.5 * ra);
  let rr = sqrt(max(ra * ra - half * half, 0.0));
  let e1 = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let e2 = cross(n, e1);
  let ang = rnd(rn ^ 0x44u) * 6.2831853;
  let radial = e1 * cos(ang) + e2 * sin(ang);
  c.p = P + n * half + radial * (rr + 0.015 * rnd(rn ^ 0x55u));
  c.n = n;
  c.t = cross(n, radial);
  c.out = radial;
  c.ok = true;
  return c;
}

/** a place for a wisp away from any contact: near a deposit, on the fusion's helix, or low in the field's box */
fn elsewhere(rn: u32) -> vec3f {
  let pick = rnd(rn);
  if (steam.hShape.z > 0.0 && pick < 0.6) {
    // a point on one of the two strands
    let axis = normalize(steam.hAxis.xyz + vec3f(0.0, 1e-5, 0.0));
    let e1 = normalize(cross(axis, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(axis.x) > 0.9)));
    let e2 = cross(axis, e1);
    let h = (rnd(rn ^ 0x12u) * 2.0 - 1.0) * steam.hShape.y;
    let side = select(1.0, -1.0, rnd(rn ^ 0x13u) < 0.5);
    let ang = steam.hShape.x + 6.2831853 * steam.hAxis.w * h;
    return steam.hAt.xyz + axis * h + (e1 * cos(ang) + e2 * sin(ang)) * steam.hAt.w * side + sphereDir(rn ^ 0x14u) * 0.05;
  }
  if (pick < 0.8 && steam.deposits > 0u) {
    let k = min(u32(rnd(rn ^ 0x66u) * f32(steam.deposits)), steam.deposits - 1u);
    let n = steam.near[k];
    return n.xyz + sphereDir(rn ^ 0x77u) * (n.w * sqrt(rnd(rn ^ 0x88u)));
  }
  let u = rnd3(rn ^ 0x99u) * vec3f(1.0, 0.6, 1.0);
  return fieldBox.origin + u * fieldBox.dims * fieldBox.cell;
}

/** which pair is meeting at p, from the field alone: x how plasma (dry, or heat past fire's), y how icy (cold) */
fn pairAt(p: vec3f) -> vec2f {
  let s = fieldAt(p);
  let plasma = max(smoothstep(0.06, 0.25, s.b.w), smoothstep(1.15, 1.45, s.b.x));
  let ice = smoothstep(0.03, 0.2, s.b.y);
  return vec2f(plasma, ice);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= steam.count) { return; }
  var q = puffs[i];
  let dt = steam.dt;
  if (dt <= 0.0) { return; }
  // 0 wisp, 1 front, 2 drip, 3 spark
  let sort = select(select(select(3u, 2u, i < steam.dripEnd), 1u, i < steam.frontEnd), 0u, i < steam.wispEnd);

  if (q.age >= q.life) {
    if (fieldBox.on < 0.5) { return; }
    let rn = pcg((i * 0x9e3779b9u) ^ pcg(steam.frameNo + 0x5157u));
    var c = contact(rn);
    if (!c.ok && sort == 1u) { c = contact(rn ^ 0xbeefu); }
    var p = c.p;
    var chance = 0.0;
    if (sort == 0u && (!c.ok || rnd(rn ^ 0x5u) < 0.12)) {
      // away from any contact (deposits, the helix, the box), at the field's own grain: rarer
      p = elsewhere(rn ^ 0x777u);
      c.ok = false;
      c.out = sphereDir(rn ^ 0x31u);
      c.t = c.out;
      chance = 1.0 - exp(-fieldSteam(p) * steam.birth * 0.5 * dt);
    } else if (c.ok) {
      let e = fieldSteam(p);
      if (sort == 0u) { chance = 1.0 - exp(-e * steam.birth * dt); }
      // fronts, drips and sparks are a contact's: inside a fusion's one body there is no contact, so none while one holds
      else if (sort == 1u) { chance = smoothstep(0.02, 0.35, e) * steam.frontRate * (1.0 - steam.fusion.y); }
      else { chance = (1.0 - exp(-e * steam.sparkRate * dt)) * (1.0 - steam.fusion.y); }
    }
    if (chance <= 0.0 || rnd(rn ^ 0xabcu) >= chance) { return; }
    let pair = pairAt(p);
    let plasma = pair.x;
    let ice = pair.y;
    // drips are meltwater (flame against ice), sparks are plasma's (against water most)
    if (sort == 2u && rnd(rn ^ 0xd1u) > ice * (1.0 - 0.6 * plasma)) { return; }
    if (sort == 3u && rnd(rn ^ 0xd2u) > plasma * (1.0 - 0.6 * ice)) { return; }
    let r = rnd(rn ^ 0xdefu);
    let crack = ice * (1.0 - plasma);
    q.pos = p;
    q.age = 0.0;
    q.info = vec4f(plasma, ice, min(fieldSteam(p), 2.0), rnd(rn ^ 0xfeu));
    if (sort == 0u) {
      // boils out of the contact and up; flame against ice throws a fast jet of vapour
      q.vel = fieldWind(p) + c.out * (0.25 + steam.jet * crack) + vec3f(0.0, steam.rise * 0.5 + 0.6 * crack, 0.0);
      q.life = mix(steam.lifeMin, steam.lifeMax, r) * (1.0 - 0.35 * crack);
    } else if (sort == 1u) {
      // half its length along the contact line (flame on ice: a longer, harder crack)
      q.vel = c.t * (0.018 + 0.022 * r) * (1.0 + 0.7 * crack);
      q.life = steam.frontLife * (0.6 + 0.8 * rnd(rn ^ 0x3fu));
    } else if (sort == 2u) {
      q.vel = fieldWind(p) * 0.3 + c.out * 0.35 + vec3f(0.0, -0.3, 0.0);
      q.life = 0.5 + 0.5 * r;
    } else {
      q.pos = p + sphereDir(rn ^ 0x61u) * 0.14 * sqrt(rnd(rn ^ 0x62u)) + vec3f(0.0, 0.12 * rnd(rn ^ 0x63u), 0.0);
      q.vel = sphereDir(rn ^ 0x64u) * (0.015 + 0.02 * r);
      q.life = 0.04 + 0.08 * rnd(rn ^ 0x65u);
    }
    puffs[i] = q;
    return;
  }

  q.age += dt;
  let u = clamp(q.age / q.life, 0.0, 1.0);
  if (sort == 0u) {
    // the air's own wind, its own lift (warm when born, cooling), a slow curl that grows as it spreads; plasma against
    // ice is cold vapour: it sinks for its first third before it rises
    let cold = q.info.x * q.info.y;
    let F = steam.fusion;
    var lift = steam.rise * (1.0 - 0.7 * u) + max(fieldHeat(q.pos), 0.0) * 0.4;
    lift *= mix(1.0, mix(-steam.sink, 1.0, smoothstep(0.25, 0.55, u)), cold);
    lift *= 1.0 - 0.45 * fusionIs(F, 2.0) - 0.3 * fusionIs(F, 3.0);
    let curl = flow(q.pos * 1.6 + f32(i % 61u) * 0.07, steam.time * 0.5) * steam.turbulence * (0.4 + u);
    let want = fieldWind(q.pos) + vec3f(0.0, lift, 0.0) + curl;
    q.vel = mix(want, q.vel, exp(-steam.follow * dt));
    q.pos += q.vel * dt;
    if (q.pos.y < steam.floorY + 0.03) { q.pos.y = steam.floorY + 0.03; q.vel.y = abs(q.vel.y) * 0.3; }
  } else if (sort == 2u) {
    q.vel.y -= 9.8 * dt;
    q.pos += q.vel * dt;
    if (q.pos.y < steam.floorY) { q.age = q.life; }
  } else {
    // fronts and sparks stay put; the air nudges them a little
    q.pos += fieldWind(q.pos) * dt * 0.15;
  }
  if (any(q.pos != q.pos)) { q.age = q.life; }
  puffs[i] = q;
}

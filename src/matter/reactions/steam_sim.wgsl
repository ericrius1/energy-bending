// Steam's simulation, a thread a puff. A dead puff tries to be born: it picks a place (near a random capsule of a
// random dancer most of the time, near a deposit some of the time, anywhere low in the field's box otherwise) and is
// born there with a chance set by how much steam the field is making at that place (fieldSteam: heat meeting wet,
// flame meeting ice). A live puff follows the field's wind, rises on its own warmth, which fades as it ages, and is
// stirred by a slow curl so it billows. Births need no CPU and no counters: the pool is the cap.
#include "../core/body"
#include "../field/field"
#include "./steam"

@group(1) @binding(0) var<uniform> steam: Steam;
@group(1) @binding(1) var<storage, read_write> puffs: array<Puff>;

/** a place to try a birth at */
fn candidate(rn: u32) -> vec3f {
  let pick = rnd(rn);
  let D = bodies.dancers;
  if (pick < 0.7 && D > 0u) {
    let d = min(u32(rnd(rn ^ 0x11u) * f32(D)), D - 1u);
    let s = min(u32(rnd(rn ^ 0x22u) * f32(steam.capsules)), steam.capsules - 1u);
    let seg = segs[d * SEGS + s];
    let a = joints[d * MAXJ + u32(seg.info.x)].pos.xyz;
    let b = joints[d * MAXJ + u32(seg.info.y)].pos.xyz;
    let r = max(seg.b1.w, seg.b2.w);
    return mix(a, b, rnd(rn ^ 0x33u)) + sphereDir(rn ^ 0x44u) * (r + 0.45 * sqrt(rnd(rn ^ 0x55u)));
  }
  if (pick < 0.85 && steam.deposits > 0u) {
    let k = min(u32(rnd(rn ^ 0x66u) * f32(steam.deposits)), steam.deposits - 1u);
    let n = steam.near[k];
    return n.xyz + sphereDir(rn ^ 0x77u) * (n.w * sqrt(rnd(rn ^ 0x88u)));
  }
  // anywhere in the box's lower part (where bodies and their auras are)
  let u = rnd3(rn ^ 0x99u) * vec3f(1.0, 0.6, 1.0);
  return fieldBox.origin + u * fieldBox.dims * fieldBox.cell;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= steam.count) { return; }
  var q = puffs[i];
  let dt = steam.dt;
  if (dt <= 0.0) { return; }
  if (q.age >= q.life) {
    if (fieldBox.on < 0.5) { return; }
    let rn = pcg((i * 0x9e3779b9u) ^ pcg(steam.frameNo + 0x5157u));
    let c = candidate(rn);
    let e = fieldSteam(c);
    if (e > 0.0 && rnd(rn ^ 0xabcu) < 1.0 - exp(-e * steam.birth * dt)) {
      q.pos = c;
      q.vel = fieldWind(c) + vec3f(0.0, steam.rise * 0.5, 0.0);
      q.age = 0.0;
      q.life = mix(steam.lifeMin, steam.lifeMax, rnd(rn ^ 0xdefu));
      puffs[i] = q;
    }
    return;
  }
  q.age += dt;
  let u = clamp(q.age / q.life, 0.0, 1.0);
  // the air's own wind, its own lift (warm when born, cooling), a slow curl that grows as it spreads
  let lift = steam.rise * (1.0 - 0.7 * u) + max(fieldHeat(q.pos), 0.0) * 0.4;
  let curl = flow(q.pos * 1.3 + f32(i % 61u) * 0.07, steam.time * 0.45) * steam.turbulence * (0.4 + u);
  let want = fieldWind(q.pos) + vec3f(0.0, lift, 0.0) + curl;
  q.vel = mix(want, q.vel, exp(-steam.follow * dt));
  q.pos += q.vel * dt;
  if (q.pos.y < steam.floorY + 0.05) { q.pos.y = steam.floorY + 0.05; q.vel.y = abs(q.vel.y) * 0.3; }
  if (any(q.pos != q.pos)) { q.age = q.life; }
  puffs[i] = q;
}

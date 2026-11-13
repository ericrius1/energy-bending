// The motes' step (mist.wgsl says what they are): rebirth at frozen particles, sinking mist, drifting dust.
#include "./mist"
#include "../field/field"

@group(1) @binding(0) var<uniform> mist: Mist;
@group(1) @binding(1) var<storage, read> state: array<Particle>;
@group(1) @binding(2) var<storage, read> aux: array<Aux>;
@group(1) @binding(3) var<storage, read_write> motes: array<Mote>;

@compute @workgroup_size(256)
fn step(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= mist.motes) { return; }
  let dt = mist.dt;
  if (dt <= 0.0) { return; }
  var m = motes[i];
  let rn = pcg(i ^ (mist.frameNo * 2654435761u));
  if (m.life <= 0.0) {
    if (mist.count == 0u || rnd(rn) > mist.birth) { motes[i] = m; return; }
    let j = pcg(rn ^ 0xbadu) % mist.count;
    let a = aux[j];
    if (a.ice < 0.7 || a.gone > 0.5) { motes[i] = m; return; }
    let p = state[j];
    m.pos = p.pos + sphereDir(rn ^ 0x11u) * 0.02;
    if (isMist(i)) {
      m.span = mix(2.5, 4.5, rnd(rn ^ 0x12u));
      m.vel = vec3f(0.0, -0.05, 0.0) + sphereDir(rn ^ 0x13u) * 0.04;
    } else {
      m.span = mix(1.0, 2.8, rnd(rn ^ 0x14u));
      m.vel = p.vel * 0.3 + sphereDir(rn ^ 0x15u) * 0.08;
    }
    m.life = m.span;
    motes[i] = m;
    return;
  }
  m.life -= dt;
  let wind = fieldWind(m.pos);
  if (isMist(i)) {
    // cold air sinks, then spreads along the floor
    m.vel += (vec3f(0.0, -0.12, 0.0) + (wind - m.vel) * 0.4) * dt;
    m.vel *= exp(-0.6 * dt);
    if (m.pos.y < mist.floorY + 0.06) {
      m.pos.y = mist.floorY + 0.06;
      m.vel.y = 0.0;
      let out = normalize(vec3f(m.pos.x, 0.0, m.pos.z) + vec3f(1e-3, 0.0, 0.0) + sphereDir(u32(m.span * 1e4)) * 0.6);
      m.vel += out * 0.05 * dt;
    }
  } else {
    // dust follows the air only loosely, sways, and settles slowly
    let seed = f32(i % 997u);
    m.vel += ((wind - m.vel) * 0.5 + vec3f(0.05 * sin(1.7 * mist.time + seed * 37.0), -0.06, 0.05 * cos(1.3 * mist.time + seed * 11.0))) * dt;
    if (m.pos.y < mist.floorY + 0.003) { m.pos.y = mist.floorY + 0.003; m.vel = vec3f(0.0); }
  }
  m.pos += m.vel * dt;
  motes[i] = m;
}

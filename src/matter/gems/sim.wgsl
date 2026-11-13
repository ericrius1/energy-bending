// One step for every stone on a dancer: the body's mode machine (matter/core/body.wgsl) does the motion; this adds
// what is the gems' own: their size on the floor, the sparkles they throw (grinding, breaking off, landing, the
// pointer's comet and a blast's nova), and the sound events (a stone landing, knocked off or clicking home is
// written to `events` for the score to ring).
#include "./gem"
#include "../core/body"

@group(1) @binding(0) var<uniform> sim: Sim;
@group(1) @binding(1) var<uniform> minerals: Minerals;
@group(1) @binding(2) var<storage, read> homes: array<Home>;
@group(1) @binding(3) var<storage, read_write> state: array<Particle>;
@group(1) @binding(4) var<storage, read_write> sparks: array<Spark>;
@group(1) @binding(5) var<storage, read_write> counter: array<atomic<u32>>;   // [0] sparkle ring, [1] events this frame
@group(1) @binding(6) var<storage, read_write> events: array<vec4f>;

fn emit(p: vec3f, v: vec3f, col: vec3f, size: f32, life: f32) {
  let k = atomicAdd(&counter[0], 1u) % SPARKS;
  sparks[k] = Spark(p, life, v, size, vec4f(col, life));
}

/** a sound: 1 landed, 2 knocked off, 3 clicked home */
fn ring(p: vec3f, what: f32, kind: u32, strength: f32) {
  let k = atomicAdd(&counter[1], 1u);
  if (k < MAXEV) {
    events[k * 2u] = vec4f(p, what);
    events[k * 2u + 1u] = vec4f(f32(kind), strength, 0.0, 0.0);
  }
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.count) { return; }
  let b = sim.body;
  let dt = b.dt;
  if (dt <= 0.0) { return; }
  let home = homes[i];
  var p = state[i];
  let spare = i >= sim.inUse;
  bodyBegin(&p, i, spare, b);
  let H = homeOf(home, i, b);
  let seed = pcg(i * 9781u + 17u);
  let rn = pcg(i ^ (sim.frameNo * 2654435761u));
  let kind = u32(home.look.x);
  let role = home.look.z;
  // sparks take the colour of the stone they came from (its crystal, or a warm white off plain rock)
  let kc = minerals.k[kind].crystal.rgb;
  let glow = mix(vec3f(1.0, 0.85, 0.7), kc / max(max(kc.r, max(kc.g, kc.b)), 1e-3), 0.7);
  let accent = mix(glow, vec3f(1.0), 0.3);

  // the pointer's comet: a few threads scatter sparkles along the path it just swept, and throw a nova where it bursts
  if (i < 64u) {
    let ck = minerals.k[u32(homes[pcg(rn ^ 0xc0e7u) % sim.count].look.x)].crystal.rgb;
    let cc = mix(vec3f(1.0), ck / max(max(ck.r, max(ck.g, ck.b)), 1e-3), 0.65);
    if (rnd(rn ^ 0xc0e8u) < touch.finger.w) {
      let at = mix(touch.fingerPrev.xyz, touch.finger.xyz, rnd(rn ^ 0xc0e9u)) + sphereDir(rn ^ 0xc0eau) * 0.04;
      emit(at, touch.pointerVel * 0.2 + sphereDir(rn ^ 0xc0ebu) * sim.sparkSpeed * 0.45, cc, 1.0, sim.sparkLife * mix(0.4, 1.2, rnd(rn ^ 0xc0ecu)));
    }
    if (touch.burst.w > 0.0) {
      let dir = sphereDir(rn ^ 0xb00u);
      emit(touch.burst.xyz + dir * 0.05, dir * sim.sparkSpeed * (0.8 + touch.burst.w * 0.6) * mix(0.4, 1.0, rnd(rn ^ 0xb02u)), cc, 1.2, sim.sparkLife * mix(0.5, 1.3, rnd(rn ^ 0xb01u)));
    }
  }

  let goal = goalOf(H, seed, b);
  let T = touchAt(p.pos);
  let size = stoneSize(i, home.look.y, sim.gemScale * sim.types[kind].z, sim.sizeVar);
  let rest = b.floorY + size * 0.6;
  let wasOn = modeIs(p.mode, ON_BODY);
  let hips = joints[dancerOf(home) * MAXJ].pos.xyz;
  let s = bodyStep(&p, H, goal, T, rest, role, spare, hips, rn, seed, b);

  if ((s.ev & EV_SHED) != 0u) {
    if (s.knock > 0.02 && rnd(rn ^ 0x61u) < 0.5) { ring(p.pos, 2.0, kind, T.swipe + T.bw); }
    if (rnd(rn ^ 0x33u) < 0.12 * sim.sparkRate) {
      emit(p.pos, p.vel * 0.5 + sphereDir(rn ^ 0x3u) * sim.sparkSpeed, mix(glow, vec3f(1.0), 0.4), 1.0, sim.sparkLife * mix(0.4, 1.0, rnd(rn ^ 0x8u)));
    }
  }
  if (wasOn) {
    // friction: fast limbs throw sparks; a fast swipe through them too
    let limbSpeed = length(H.vel);
    if (rnd(rn ^ 0x1234u) < sim.frictionSpark * max(0.0, limbSpeed - 2.2) * dt * 0.25) {
      emit(p.pos, H.vel * 0.4 + sphereDir(rn ^ 0x99u) * sim.sparkSpeed * 0.7, mix(accent, vec3f(1.0), 0.5), 0.8, sim.sparkLife * mix(0.3, 0.8, rnd(rn ^ 0x9u)));
    }
    if (T.swipe > 0.8 && rnd(rn ^ 0x4321u) < 0.004 * sim.sparkRate * min(T.swipe, 4.0)) {
      emit(p.pos, touch.pointerVel * 0.6 + sphereDir(rn ^ 0x98u) * sim.sparkSpeed, mix(glow, vec3f(1.0), 0.6), 1.0, sim.sparkLife * 0.7);
    }
  }
  if ((s.ev & EV_LANDED) != 0u) {
    if (rnd(rn ^ 0x777u) < 0.5 * sim.sparkRate) {
      let n = sphereDir(rn ^ 0x31u);
      emit(p.pos, vec3f(n.x, abs(n.y) + 0.6, n.z) * sim.sparkSpeed * min(s.impact, 4.0) * 0.4, mix(glow, vec3f(1.0), 0.7), 1.0, sim.sparkLife * mix(0.3, 0.9, rnd(rn ^ 0x32u)));
    }
    ring(p.pos, 1.0, kind, s.impact);
  }
  // sliding along the floor grinds out a few sparks
  if ((s.ev & EV_FLOOR) != 0u && s.slide > 1.2 && rnd(rn ^ 0x555u) < sim.frictionSpark * s.slide * dt * 0.5) {
    emit(p.pos, vec3f(p.vel.x * 0.4, 0.8, p.vel.z * 0.4) * sim.sparkSpeed * 0.5, mix(accent, vec3f(1.0), 0.6), 0.7, sim.sparkLife * 0.5);
  }
  if ((s.ev & EV_HOME) != 0u) {
    if (rnd(rn ^ 0x0e0eu) < 0.35) { ring(p.pos, 3.0, kind, 0.3); }
    if (rnd(rn ^ 0x0e0fu) < 0.08 * sim.sparkRate) { emit(p.pos, H.vel * 0.3 + sphereDir(rn ^ 0x0e10u) * 0.3, mix(glow, vec3f(1.0), 0.5), 0.6, sim.sparkLife * 0.5); }
  }
  bodyOrient(&p, H, goal, seed, b);
  state[i] = p;
}

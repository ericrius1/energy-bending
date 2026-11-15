// The body-of-matter core: what every matter kind's simulation shares. Bind group 3 is shared (kit.shareGroup in
// matter/core/bodies.ts): every shader that includes this file sees the dancers' joints and capsules, how many
// dancers there are, and the hand (the pointer's ray and blasts), without binding them itself.
//
// The motion is Gem Dancers', split out of its stone simulation:
//   homeOf     where a home on a capsule is this frame (position, velocity, rotation, outward normal);
//   touchAt    what the hand does to a point (push, swirl, drag, a blast);
//   bodyBegin  spares and the between-dances rules, before the step;
//   bodyStep   the mode machine: on the body (an implicit spring to its home, shedding), flying (gravity, drag, the
//              current, the floor), returning (a tightening spiral home), frozen (left hanging), resting (on the
//              floor until the dancers rise, feet first). It returns what happened (EV_* bits) so a kind can make
//              its own sparks and sounds;
//   bodyOrient a particle's rotation for its mode.
// A kind fills a BodyStep inside its own uniform (gems: Sim.body) and calls these from its compute shader.
// Fast motion (opt in with BodyStep.hold > 0; the gems do, every other kind leaves it 0 and moves exactly as before):
// on the body the spring is stiffer along the limb's travel than across it, fed the home's acceleration (Goal.acc,
// which the kind fills: homeOf leaves it zero) as the limb goes fast, and a particle never trails its home by more
// than trailCap, less the faster the limb. So a kick, a roll or a fall holds together and the slow dance keeps its lag.
#include "./particle"

/** how many dancers there are this frame (and the floor's height); each dancer's seat colour as its matter wears it
 *  (matter/core/seats.ts: rgb the hue, brightest channel 1; w how strongly, 0 outside the duel) */
struct Bodies { dancers: u32, floorY: f32, time: f32, pad: f32, seat: array<vec4f, MAX_DANCERS> }

/** the seat tint of the dancer a capsule (slot + 1, 0 none) belongs to */
fn seatOfSlot(s1: u32) -> vec4f {
  if (s1 == 0u) { return vec4f(0.0); }
  let d = (s1 - 1u) / SEGS;
  if (d >= MAX_DANCERS) { return vec4f(0.0); }
  return bodies.seat[d];
}

/** the hand: the pointer's ray through the scene, how it pushes, swirls and drags what it passes, and a blast */
struct Touch {
  rayOrigin: vec3f, radius: f32,
  rayDir: vec3f, push: f32,
  pointerVel: vec3f, swirl: f32,
  burst: vec4f,          // xyz centre, w strength (one frame)
  dragAmt: f32, attract: f32, hoverOn: f32, pad: f32,
  finger: vec4f,         // the pointer on the dancers' plane; w: the chance a comet thread throws a sparkle this frame
  fingerPrev: vec4f,     // where it was last frame
}

@group(3) @binding(0) var<storage, read> joints: array<Joint>;
@group(3) @binding(1) var<storage, read> segs: array<Seg>;
@group(3) @binding(2) var<uniform> bodies: Bodies;
@group(3) @binding(3) var<uniform> touch: Touch;

/** where a home is this frame (acc: its acceleration, zero unless the kind fills it; read only with BodyStep.hold) */
struct Goal { pos: vec3f, vel: vec3f, rot: vec4f, out: vec3f, acc: vec3f }

fn homeOf(h: Home, i: u32, b: BodyStep) -> Goal {
  let hp = h.place;
  let slot = u32(hp.x);
  let d = slot / SEGS;
  let s = segs[slot];
  let j = joints[d * MAXJ + u32(s.info.x)];
  let c = joints[d * MAXJ + u32(s.info.y)];
  let t = hp.y;
  let tc = clamp(t, 0.0, 1.0);
  let ra = mix(s.b1.w, s.info.z, tc);
  let rb = mix(s.b2.w, s.info.w, tc);
  // round caps past either end
  let over = max(-t, t - 1.0) * s.off.w;
  let r0 = max(ra, rb);
  let cap = select(1.0, sqrt(max(0.0, 1.0 - over * over / (r0 * r0))), over > 0.0);
  let depth = mix(1.0, pow(hp.w, 0.333), b.fill);
  let breath = 1.0 + b.breathe * sin(b.time * 1.7 + f32(i % 977u) * 0.05);
  let local = s.off.xyz * t + (s.b1.xyz * (cos(hp.z) * ra) + s.b2.xyz * (sin(hp.z) * rb)) * (cap * depth * breath);
  var o: Goal;
  o.pos = j.pos.xyz + qrot(j.rot, local);
  o.vel = mix(j.vel.xyz, c.vel.xyz, tc);
  o.rot = j.rot;
  // which way is out, in the joint's frame: the ellipse's normal, turning to the axis over a rounded end
  let axis = s.off.xyz / max(s.off.w, 1e-4);
  var nrm = s.b1.xyz * (cos(hp.z) / max(ra, 1e-3)) + s.b2.xyz * (sin(hp.z) / max(rb, 1e-3));
  nrm = normalize(nrm) * cap + axis * sign(t - 0.5) * select(0.0, sqrt(max(0.0, 1.0 - cap * cap)), over > 0.0);
  o.out = normalize(nrm);
  return o;
}

/** the home, swaying a little on its own slow flow */
fn goalOf(H: Goal, seed: u32, b: BodyStep) -> vec3f {
  return H.pos + flow(H.pos * b.noiseFreq + f32(seed % 97u) * 0.1, b.time * b.noiseSpeed) * b.noiseAmp;
}

/** what the hand does at a point: the force, how much the ray covers it (w), the swipe there, and a blast's reach */
struct Touched { force: vec3f, w: f32, bdir: vec3f, bw: f32, swipe: f32 }
fn touchAt(pos: vec3f) -> Touched {
  var o: Touched;
  let rv = pos - touch.rayOrigin;
  let along = dot(rv, touch.rayDir);
  let off = rv - touch.rayDir * along;
  let dist = length(off);
  o.w = 0.0;
  if (touch.hoverOn > 0.5 && along > 0.0) { o.w = pow(max(0.0, 1.0 - dist / touch.radius), 2.0); }
  let away = off / max(dist, 1e-4);
  o.force = away * (o.w * touch.push) - away * (o.w * touch.attract) + cross(touch.rayDir, away) * (o.w * touch.swirl) + touch.pointerVel * (o.w * touch.dragAmt);
  // a click (or letting go of a held finger): a shockwave from a point, wider the stronger it is
  let bv = pos - touch.burst.xyz;
  o.bw = touch.burst.w * max(0.0, 1.0 - length(bv) / (0.6 + 0.25 * touch.burst.w));
  o.bdir = normalize(bv + vec3f(0.0, 1e-3, 0.0));
  o.swipe = length(touch.pointerVel) * o.w;
  return o;
}

/** one implicit spring step towards `goal` (moving at `tv`): stable for any k, c and dt */
fn spring(p: ptr<function, Particle>, goal: vec3f, tv: vec3f, k: f32, c: f32, f: vec3f, dt: f32) {
  let v = ((*p).vel + dt * (k * (goal - (*p).pos) + c * tv + f)) / (1.0 + dt * c + dt * dt * k);
  (*p).vel = v;
  (*p).pos += v * dt;
}

/** the same step with one stiffness and damping along `d` (a unit vector) and another across it */
fn spring2(p: ptr<function, Particle>, goal: vec3f, tv: vec3f, d: vec3f, kA: f32, cA: f32, kB: f32, cB: f32, f: vec3f, dt: f32) {
  let v = (*p).vel;
  let e = goal - (*p).pos;
  let va = dot(v, d); let ea = dot(e, d); let ta = dot(tv, d); let fa = dot(f, d);
  let na = (va + dt * (kA * ea + cA * ta + fa)) / (1.0 + dt * cA + dt * dt * kA);
  let nb = (v - d * va + dt * (kB * (e - d * ea) + cB * (tv - d * ta) + (f - d * fa))) / (1.0 + dt * cB + dt * dt * kB);
  (*p).vel = d * na + nb;
  (*p).pos += (*p).vel * dt;
}

/** on the body with BodyStep.hold > 0: held harder the faster its limb goes (see the file's opening note) */
fn holdStep(p: ptr<function, Particle>, H: Goal, goal: vec3f, k: f32, c: f32, f: vec3f, b: BodyStep) {
  let speed = length(H.vel);
  let fast = smoothstep(1.2, 6.0, speed) * b.hold;
  let d = select(vec3f(0.0, 1.0, 0.0), H.vel / max(speed, 1e-4), speed > 1e-3);
  let kA = k * (1.0 + 7.0 * fast);
  let kB = k * (1.0 + 1.5 * fast);
  spring2(p, goal, H.vel, d, kA, c * sqrt(kA / k), kB, c * sqrt(kB / k), f + H.acc * fast, b.dt);
  // never further behind than the cap (and the velocity that would carry it further goes)
  let cap = b.trailCap * mix(1.0, 0.3, fast);
  let off = (*p).pos - goal;
  let dist = length(off);
  if (dist > cap) {
    let n = off / dist;
    (*p).pos = goal + n * cap;
    let away = dot((*p).vel - H.vel, n);
    if (away > 0.0) { (*p).vel -= n * away; }
  }
}

/** before the step: a spare (a particle no dancer needs now) comes off any body; between dances nothing flies home */
fn bodyBegin(p: ptr<function, Particle>, i: u32, spare: bool, b: BodyStep) {
  if (spare && (modeIs((*p).mode, ON_BODY) || modeIs((*p).mode, RETURNING))) { (*p).mode = FLYING; (*p).life = 1.0; (*p).vel += sphereDir(pcg(i ^ 0x5eedu)) * 0.4; }
  if (b.settle > 0.5 && modeIs((*p).mode, RETURNING)) { (*p).mode = FLYING; (*p).life = 1.0; }
}

// what happened in a step (Stepped.ev bits)
const EV_SHED: u32 = 1u;     // knocked off or shed (Stepped.knock: how hard it was knocked)
const EV_LANDED: u32 = 2u;   // hit the floor hard (Stepped.impact: m/s)
const EV_HOME: u32 = 4u;     // arrived home
const EV_FROZE: u32 = 8u;    // left hanging in the air
const EV_FLOOR: u32 = 16u;   // touching the floor this frame (Stepped.slide: how fast it slides)
struct Stepped { ev: u32, impact: f32, knock: f32, slide: f32 }

/**
 * one step of the mode machine. H: the home now; goal: where the spring pulls (goalOf); T: the hand here;
 * rest: the height it rests at on the floor; role: its part's role (accents, 2, can be left hanging); spare: no dancer
 * wants it; hips: its dancer's hips (the spiral home turns round them); rn: this frame's random; seed: its own.
 */
fn bodyStep(p: ptr<function, Particle>, H: Goal, goal: vec3f, T: Touched, rest: f32, role: f32, spare: bool, hips: vec3f, rn: u32, seed: u32, b: BodyStep) -> Stepped {
  var s: Stepped;
  let dt = b.dt;
  let stayDown = b.settle > 0.5 || spare;
  let limbSpeed = length(H.vel);
  let force = T.force;
  if (modeIs((*p).mode, ON_BODY)) {
    let k = b.stiffness * mix(1.0, 0.04, b.transition);
    let c = b.damping * mix(1.0, 0.3, b.transition);
    if (b.hold > 0.0) { holdStep(p, H, goal, k, c, force * 60.0, b); }
    else { spring(p, goal, H.vel, k, c, force * 60.0, dt); }
    (*p).life += dt;
    let knock = b.shatter * smoothstep(0.5, 2.5, T.swipe) * 0.35 + T.bw * 0.8;
    let chance = (b.shedRate + b.speedShed * max(0.0, limbSpeed - 1.6) * 0.4) * dt + knock;
    if (rnd(rn) < chance) {
      (*p).mode = FLYING;
      (*p).life = b.fallTime * mix(0.5, 1.5, rnd(rn ^ 0x51u));
      (*p).vel += sphereDir(rn ^ 0x77u) * (0.3 + b.scatter) + T.bdir * (T.bw * 5.0) + touch.pointerVel * (T.w * 0.8);
      s.ev |= EV_SHED;
      s.knock = knock;
    } else if (role > 1.5 && rnd(rn ^ 0x7a11u) < b.trail * dt) {
      // a hand, a foot or the head moves on and leaves this one hanging where it was
      (*p).mode = FROZEN;
      (*p).life = b.trailHold * mix(0.6, 1.4, rnd(rn ^ 0x7a12u));
      (*p).vel = vec3f(0.0);
      s.ev |= EV_FROZE;
    }
  } else if (modeIs((*p).mode, FLYING)) {
    (*p).vel.y -= b.gravity * dt;
    (*p).vel += force * dt * 60.0 + T.bdir * (T.bw * 5.0);
    // the water's slow current sways it as it sinks
    (*p).vel += flow((*p).pos * 0.55, b.time * 0.22) * (b.current * dt);
    (*p).vel *= exp(-b.drag * dt);
    (*p).pos += (*p).vel * dt;
    if ((*p).pos.y < rest) {
      (*p).pos.y = rest;
      let impact = -(*p).vel.y;
      if (impact > 0.8) { s.ev |= EV_LANDED; s.impact = impact; }
      (*p).vel.y = impact * b.bounce * select(0.0, 1.0, impact > 0.3);
      (*p).vel.x *= exp(-b.friction * 12.0 * dt);
      (*p).vel.z *= exp(-b.friction * 12.0 * dt);
      s.ev |= EV_FLOOR;
      s.slide = length((*p).vel.xz);
      // between dances, whatever comes down stays down (and spares always do)
      if (stayDown && length((*p).vel) < 0.4) { (*p).mode = RESTING; (*p).vel = vec3f(0.0); }
    }
    (*p).life -= dt;
    if ((*p).life <= 0.0 && !stayDown) {
      if (b.returnMode > 0.5) { (*p).mode = ON_BODY; (*p).pos = goal; (*p).vel = H.vel; (*p).life = 0.0; }
      else { (*p).mode = RETURNING; (*p).life = 0.0; }
    }
  } else if (modeIs((*p).mode, RETURNING)) {
    (*p).life += dt;
    // (in water, by its drag: the spring tightens later and the spiral turns slower)
    let calm = 1.0 / (1.0 + b.drag * 0.6);
    let k = b.stiffness * 0.08 * (1.0 + (*p).life * (*p).life * 4.0 * calm);
    // home in a spiral: a turn round the dancer's middle that fades as it arrives
    let rxz = (*p).pos.xz - hips.xz;
    let far = clamp(length(goal - (*p).pos), 0.0, 1.5);
    let turn = vec3f(-rxz.y, 0.0, rxz.x) / max(length(rxz), 0.2) * far * 3.5 * calm * exp(-(*p).life * 0.8);
    if (b.hold > 0.0) {
      // (hold) flying home in the body's moving frame: matched to its velocity and acceleration quickly, so a jump or
      // a roll doesn't leave a comet of returning matter behind, and never further than a body's length from home
      let fast = smoothstep(1.2, 6.0, length(H.vel)) * b.hold;
      spring(p, goal, H.vel, k, max(sqrt(k) * 1.4, 9.0 * fast), force * 60.0 + T.bdir * (T.bw * 300.0) + turn * k * 0.05 + H.acc * fast, dt);
      let off = (*p).pos - goal;
      let reach = mix(3.0, 0.3, fast);
      if (length(off) > reach) { (*p).pos = goal + normalize(off) * reach; }
    } else {
      spring(p, goal, H.vel, k, sqrt(k) * 1.4, force * 60.0 + T.bdir * (T.bw * 300.0) + turn * k * 0.05, dt);
    }
    // (with hold, close is home enough: the body's spring takes it from there, so none hang about just short of it)
    let arrive = select(0.02, 0.1, b.hold > 0.0);
    if (length(goal - (*p).pos) < arrive || (*p).life > 3.5) {
      (*p).mode = ON_BODY;
      (*p).life = 10.0;
      s.ev |= EV_HOME;
    }
  } else if (modeIs((*p).mode, FROZEN)) {
    // hanging in the water, drifting a little on the current; the hand or a blast still moves it (and frees it)
    (*p).life -= dt;
    (*p).pos += force * dt * 0.6 + flow((*p).pos * 0.55, b.time * 0.22) * (b.current * 0.06 * dt);
    if ((*p).life <= 0.0 || T.bw > 0.05 || T.w > 0.3) {
      (*p).mode = FLYING;
      (*p).life = b.fallTime * mix(0.5, 1.2, rnd(rn ^ 0x7a13u));
      (*p).vel = sphereDir(rn ^ 0x7a14u) * 0.25 + T.bdir * (T.bw * 5.0) + force * 0.5;
    }
  } else {
    // RESTING on the floor: the hand can still kick it about; when the dancers rise it goes up, feet first
    (*p).vel += force * dt * 30.0 + T.bdir * (T.bw * 2.0);
    (*p).vel *= exp(-6.0 * dt);
    (*p).pos += (*p).vel * dt;
    (*p).pos.y = max((*p).pos.y, rest);
    let up = clamp((H.pos.y - b.floorY) / 1.9, 0.0, 1.0);
    if (!spare && b.wake > 0.0 && b.time > b.wake + b.wakeSpread * up + 0.35 * rnd(seed ^ 0x3a3au)) {
      (*p).mode = RETURNING;
      (*p).life = 0.0;
      (*p).vel = (vec3f(0.0, 2.2 + 1.5 * rnd(seed ^ 0x3a3bu), 0.0) + sphereDir(seed ^ 0x3a3cu) * 0.4) / (1.0 + b.drag * 0.6);
    }
  }
  return s;
}

/** a particle's rotation: on the body a fixed pose in its bone's frame (facing out by `order`) and a slow spin;
 *  loose, it tumbles with its speed; hanging, it turns slowly. Then a NaN guard (it goes home whole). */
fn bodyOrient(p: ptr<function, Particle>, H: Goal, goal: vec3f, seed: u32, b: BodyStep) {
  let dt = b.dt;
  let axis = sphereDir(seed);
  if (modeIs((*p).mode, ON_BODY)) {
    let spinQ = qaxis(axis, b.time * b.spin * mix(0.2, 1.0, rnd(seed ^ 0x5u)));
    let loose = qmul(H.rot, qmul(qaxis(sphereDir(seed ^ 0xabcu), rnd(seed ^ 0xdefu) * 6.2831853), spinQ));
    let twist = qaxis(vec3f(0.0, 1.0, 0.0), rnd(seed ^ 0xdefu) * 6.2831853 + b.time * b.spin * mix(0.2, 1.0, rnd(seed ^ 0x5u)));
    let faced = qmul(H.rot, qmul(qFromUp(H.out), twist));
    (*p).rot = qnlerp((*p).rot, qnlerp(loose, faced, b.order), 1.0 - exp(-10.0 * dt));
  } else if (modeIs((*p).mode, FROZEN)) {
    (*p).rot = normalize(qmul(qaxis(axis, 0.5 * dt), (*p).rot));
  } else if (modeIs((*p).mode, RESTING)) {
    (*p).rot = normalize(qmul(qaxis(axis, length((*p).vel) * 3.0 * dt), (*p).rot));
  } else {
    (*p).rot = normalize(qmul(qaxis(axis, length((*p).vel) * dt * (3.0 + b.spin * 2.0)), (*p).rot));
  }
  if (any((*p).pos != (*p).pos)) { (*p).pos = goal; (*p).vel = vec3f(0.0); (*p).mode = ON_BODY; (*p).rot = vec4f(0.0, 0.0, 0.0, 1.0); }
}

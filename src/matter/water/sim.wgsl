// One step for every water (and ice) particle. The body's mode machine (matter/core/body.wgsl) does the motion, with
// its settings blended per particle between liquid and frozen: water runs along the body (its home slides down its
// capsule and comes round again at the top) under swells that travel down it, hangs loosely and ripples, peels off the
// trailing side of a fast limb in sheets, sheds
// drops as it moves and more where a limb is fast (a kick throws a sheet of them, a spin a spiral, because a shed drop
// keeps the limb's velocity), falls, splashes on the floor and flies home again, so the figure is always pouring and
// re-forming; ice holds its place and doesn't shed. What is the water's own here: the change of state (a dancer's
// form freezes it as a wave from the feet up; the field's cold freezes it, its heat melts ice to dripping water and
// boils water away), the field's wind on spray, the splash, and the foam that the screen-space surface draws white.
#include "./water"
#include "../core/body"
#include "../field/field"

@group(1) @binding(0) var<uniform> sim: WaterSim;
@group(1) @binding(1) var<storage, read> homes: array<Home>;
@group(1) @binding(2) var<storage, read_write> state: array<Particle>;
@group(1) @binding(3) var<storage, read_write> aux: array<Aux>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.count) { return; }
  let b = sim.body;
  let dt = b.dt;
  if (dt <= 0.0) { return; }
  var home = homes[i];
  var p = state[i];
  var a = aux[i];
  bodyBegin(&p, i, false, b);
  let seed = pcg(i * 9781u + 17u);

  // ---------------------------------------------------------------- the body runs
  // Liquid water slides along its capsule (toward the hands and feet on the limbs, down the torso and the head) and
  // wraps round to the top of the capsule, where the joints overlap and hide the jump, so a still dancer is always
  // pouring. A particle arriving back at the top is put there at once (its home is everywhere at the same density, so
  // the surface doesn't change: only what travels on it shows). Ice doesn't run: it eases back to its own home.
  let slot = u32(home.place.x);
  let len = max(segs[slot].off.w, 0.05);
  let t0 = home.place.y;
  let liquid = 1.0 - smoothstep(0.3, 0.7, a.ice);
  var wrapped = false;
  if (t0 >= 0.0 && t0 <= 1.0 && sim.flow.x > 0.0) {
    let dir = select(1.0, -1.0, (slot % SEGS) < 5u);
    let rate = sim.flow.x * (0.75 + 0.5 * rnd(seed ^ 0xf10u)) / len;
    let tNow = fract(t0 + dir * b.time * rate);
    let tWas = fract(t0 + dir * (b.time - dt) * rate);
    wrapped = abs(tNow - tWas) > 0.5;
    home.place.y = mix(t0, tNow, liquid);
  }
  let H = homeOf(home, i, b);
  // travelling bulges: narrow swells a few centimetres high that run down the body faster than the water, in
  // rivulets round it, so the highlights slide; only the outer shell swells
  let along = home.place.y * len;
  let dirB = select(1.0, -1.0, (slot % SEGS) < 5u);
  let phase = 6.2831853 * (along - dirB * sim.flow.x * 1.6 * b.time) / max(sim.flow.z, 0.02) + 1.3 * sin(home.place.z * 2.0 + f32(slot));
  let bump = pow(max(0.0, sin(phase)), 3.0);
  let rivulet = 0.5 + 0.5 * sin(home.place.z * 3.0 + along * 5.0 + f32(slot % SEGS) * 1.7);
  let swell = sim.flow.y * bump * rivulet * smoothstep(0.6, 1.0, home.place.w);
  let outW = qrot(H.rot, H.out);
  let rn = pcg(i ^ (sim.frameNo * 2654435761u));
  let d = dancerOf(home);

  // ---------------------------------------------------------------- the state of matter
  // a dancer's form freezes its water as a wave that climbs from the feet (and melts back down from the head)
  let up = clamp((H.pos.y - b.floorY) / 1.8, 0.0, 1.0);
  let front = formOf(sim, d) * 1.16 - 0.08;
  let wave = smoothstep(up - 0.05, up + 0.05, front);
  var goalIce = max(home.look.x, wave);
  let heat = fieldHeat(p.pos);
  if (heat > sim.meltHeat) { goalIce = 0.0; }
  // the field's cold freezes it all at once (a water dancer beside an ice one). A dancer's own form is cold too (its
  // aura, matter/field/auras.ts, at the form it was set to), so its own cold counts for less: its freeze climbs from
  // the feet (the wave above) instead of setting the whole body at once
  if (heat < -sim.freezeCold * (1.0 + 4.0 * formOf(sim, d))) { goalIce = 1.0; }
  a.was = a.ice;
  let rate = sim.freezeRate * dt * (0.7 + 0.6 * rnd(seed ^ 0x1ceu));
  a.ice = clamp(a.ice + clamp(goalIce - a.ice, -rate, rate), 0.0, 1.0);
  // water in heat thins and vanishes (the field makes the steam); it comes back, at home, once the air is cool
  if (heat > sim.boilHeat && a.ice < 0.5) { a.gone = min(1.0, a.gone + dt * (heat - sim.boilHeat) * 4.0); }
  else { a.gone = max(0.0, a.gone - dt * 0.6); }
  let ice = a.ice;

  // ---------------------------------------------------------------- the motion: water's, stiffened by ice
  var bb = b;
  bb.stiffness = mix(b.stiffness, sim.iceStiff, ice);
  bb.damping = mix(b.damping, sim.iceDamp, ice);
  bb.shedRate = b.shedRate * (1.0 - ice);
  // a fast limb peels sheets off its trailing side, more where a swell is passing
  let trailing = dot(outW, -H.vel / max(length(H.vel), 1e-3));
  let peel = mix(1.0, (0.15 + 2.2 * smoothstep(-0.1, 0.6, trailing)) * (0.4 + 1.4 * bump), sim.flow.w);
  bb.speedShed = b.speedShed * (1.0 - ice) * peel;
  bb.noiseAmp = b.noiseAmp * (1.0 - ice);
  bb.bounce = mix(b.bounce, 0.2, ice);
  bb.friction = mix(b.friction, 0.15, ice);
  bb.order = 1.0;
  bb.spin = 0.0;
  // water flies home quicker than gems do (its spring is looser on the body, so it would hang in the air)
  if (modeIs(p.mode, RETURNING)) { bb.stiffness = b.stiffness * 3.0; }
  // ice that melts drips: each melting particle is let go, now and then, as a drop
  if (a.was - a.ice > 0.0 && a.ice < 0.6 && modeIs(p.mode, ON_BODY)) { bb.shedRate += 3.0; }
  // the surface ripples: waves running along the body, out along each home's normal
  let ripple = sin(dot(H.pos, vec3f(0.3, 1.0, 0.2)) * sim.wobbleFreq - b.time * 5.0 + rnd(seed) * 1.5)
             + 0.6 * sin(dot(H.pos, vec3f(-0.8, 0.4, 0.5)) * sim.wobbleFreq * 1.7 + b.time * 3.7);
  let goal = goalOf(H, seed, bb) + outW * ((ripple * sim.wobble + swell) * (1.0 - ice));
  // back at the top of its capsule: there at once
  if (wrapped && liquid > 0.5 && modeIs(p.mode, ON_BODY)) { p.pos = goal; p.vel = H.vel; }
  var T = touchAt(p.pos);
  // the field's wind pushes water (spray most: on the body the spring holds it)
  T.force += fieldWind(p.pos) * (sim.wind / 60.0) * (1.0 - 0.8 * ice);
  let r = splatRadius(home, a, p, sim.radius);
  let rest = b.floorY + max(r, 0.004) * 0.7;
  let hips = joints[d * MAXJ].pos.xyz;
  let wasOn = modeIs(p.mode, ON_BODY);
  let s = bodyStep(&p, H, goal, T, rest, 2.0 * ice, false, hips, rn, seed, bb);

  // ---------------------------------------------------------------- water's own: spray, splashes, foam
  a.foam = max(0.0, a.foam - dt * 2.5);
  if ((s.ev & EV_SHED) != 0u && wasOn) {
    // a drop flung from a moving limb keeps going the way the limb went, and a little out from the body
    let fling = smoothstep(0.8, 3.5, length(H.vel));
    p.vel += H.vel * (sim.spray * fling) + H.out * (0.25 + 0.6 * fling) * (1.0 - ice);
    a.foam = max(a.foam, 0.4 + 0.6 * fling);
  }
  if ((s.ev & EV_LANDED) != 0u && ice < 0.5 && modeIs(p.mode, FLYING)) {
    // a splash: the drop bursts sideways and up, and foams
    let k = min(s.impact, 7.0);
    let ang = rnd(rn ^ 0x5a1u) * 6.2831853;
    let out = vec2f(cos(ang), sin(ang)) * k * sim.splash * mix(0.2, 1.0, rnd(rn ^ 0x5a2u));
    p.vel = vec3f(p.vel.x * 0.4 + out.x, k * sim.splash * mix(0.15, 0.8, rnd(rn ^ 0x5a3u)), p.vel.z * 0.4 + out.y);
    a.foam = 1.0;
    // a splashed drop soon gathers itself and flies home
    p.life = min(p.life, 0.3 + 0.4 * rnd(rn ^ 0x5a4u));
  }
  if (modeIs(p.mode, FLYING)) { a.foam = max(a.foam, smoothstep(2.0, 6.0, length(p.vel)) * 0.8); }
  bodyOrient(&p, H, goal, seed, bb);
  state[i] = p;
  aux[i] = a;
}

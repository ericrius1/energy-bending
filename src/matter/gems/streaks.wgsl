// Streaks: every loose stone in flight (knocked off, or flying home) drawn again as a thin line of light from where
// it is back along where it came from, so a blast or a swirl leaves light behind it the way a long exposure would.
// Additive, behind the stones' own faces. Where this view sees the stone's dancer (engine/seen.wgsl).
#include "weft/frame"
#include "./gem"
#include "../../engine/seen"

@group(1) @binding(0) var<uniform> sim: Sim;
@group(1) @binding(1) var<uniform> look: Look;
@group(1) @binding(2) var<uniform> minerals: Minerals;
@group(1) @binding(3) var<storage, read> state: array<Particle>;
@group(1) @binding(4) var<storage, read> homes: array<Home>;
@group(1) @binding(5) var<storage, read> homes2Prev: array<vec4f>;
@group(1) @binding(6) var<uniform> seen: ViewSeen;

fn looksOf(i: u32, p: Particle) -> vec4f {
  if (sim.prevLook > 0.5 && i < sim.envBase && (modeIs(p.mode, RESTING) || (modeIs(p.mode, FLYING) && sim.body.settle > 0.5))) { return homes2Prev[i]; }
  return homes[i].look;
}

struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) clip: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= sim.count) { return o; }
  let p = state[ii];
  let speed = length(p.vel);
  let fast = smoothstep(1.2, 4.5, speed);
  // only stones that are loose: on the body they'd smear a fast limb into a white blur
  if (fast <= 0.0 || !(modeIs(p.mode, FLYING) || modeIs(p.mode, RETURNING))) { return o; }
  let h2 = looksOf(ii, p);
  let kind = u32(h2.x);
  let size = stoneSize(ii, h2.y, sim.gemScale * sim.types[kind].z, sim.sizeVar) * spareScale(ii, sim.inUse, sim.spareFade);
  if (size <= 0.0) { return o; }
  let sd = seen.d[min(dancerOf(homes[ii]), MAX_DANCERS - 1u)];
  let pos = seenPos(sd, p.pos);
  if (seenClip(sd, pos) < -0.7) { return o; }
  let dir = seenDir(sd, p.vel / speed);
  let len = min(speed * look.streak.x, 0.6);
  // a ribbon from the stone back along its path, turned to face the camera
  let mid = pos - dir * len * 0.5;
  let side = normalize(cross(dir, frame.camPos - mid)) * size * 0.55;
  let corner = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi];
  let wp = pos - dir * len * corner.x + side * corner.y;
  o.clip = seenClip(sd, wp);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = corner;
  let kc = minerals.k[kind].crystal.rgb;
  let peak = max(kc.r, max(kc.g, kc.b));
  let hue = kc / max(peak, 1e-3);
  // a dark stone (obsidian) streaks dimly, a bright crystal brightly
  o.col = mix(hue, vec3f(1.0), 0.2) * fast * look.streak.y * mix(0.3, 1.0, sqrt(peak));
  return o;
}

@fragment fn fs(i: SOut) -> @location(0) vec4f {
  if (i.clip < 0.0) { discard; }
  let across = 1.0 - abs(i.uv.y);
  let head = 1.0 - i.uv.x;
  return vec4f(i.col * across * across * head * head, 0.0);
}

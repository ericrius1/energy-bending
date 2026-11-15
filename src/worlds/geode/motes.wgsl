// Dust in the light: motes drifting down through the shaft from above, slow, twinkling. Procedural (no buffer): each
// knows where it is from its index and the time. Additive; out of focus they open into soft discs. After the dust
// (index `dust` on), fireflies: drifting low in the shadows round the floor's edge and the druses, each glowing warm
// yellow-green for a moment and going dark again (phase 4's greenhouse).
#include "weft/frame"
#include "../light"

struct MOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) bright: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MOut {
  var o: MOut;
  let c6 = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  if (f32(ii) >= worldLight.geode.dust) {
    // a firefly: round the room in the shadows, wandering on slow loops, its light a blink now and then
    let g = rnd3(ii * 13u + 5u);
    let t = frame.time;
    let a = g.x * 6.2831853 + t * (0.03 + 0.05 * g.y) * select(-1.0, 1.0, g.z > 0.5) + 0.4 * sin(t * 0.21 + g.z * 9.0);
    let rr = 4.2 + 6.0 * g.y + 0.5 * sin(t * 0.33 + g.x * 11.0);
    let y = 0.3 + 2.6 * g.z * g.z + 0.35 * sin(t * (0.5 + 0.4 * g.x) + g.y * 17.0);
    let centre = vec3f(cos(a) * rr, y, sin(a) * rr - 1.0);
    let blink = pow(max(sin(t * (0.6 + 0.9 * g.x) + g.y * 40.0), 0.0), 5.0);
    let size = 0.022 + 0.012 * g.x;
    o.pos = frame.viewProj * vec4f(centre + (frame.camRight * c6.x + frame.camUp * c6.y) * size, 1.0);
    o.uv = c6;
    // (brighter, and blinking together, while the world answers a moment: worlds/answer.wgsl, report 20)
    o.bright = -(0.15 + 2.2 * blink + 2.0 * answerReach(0u, centre) * (0.5 + 0.5 * worldLight.answer.k.w));
    return o;
  }
  let h = rnd3(ii * 7u + 1u);
  let c0 = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  // (phase 6: half the dust is pollen drifting in the light wells' beams, the sun's slant through the glass vault)
  if ((ii & 1u) == 1u) {
    let k = i32((ii >> 1u) % 4u);
    let W = worldLight.geode.wells[k];
    let S = geodeSunDir();
    let sF = (worldLight.geode.floorY - W.y) / min(S.y, -0.2);
    let g = rnd3(ii * 11u + 3u);
    // along the beam, falling slowly down it; round its axis, a little wider low down; a slow drift
    let sb = sF * fract(g.x + frame.time * (0.004 + 0.006 * g.y));
    let ax = normalize(cross(S, vec3f(0.0, 1.0, 0.0)));
    let ay = cross(S, ax);
    let rr = W.w * (0.85 + 0.35 * sb / sF) * sqrt(g.y) * 0.9;
    let ang = g.z * 6.2831853 + frame.time * 0.05;
    let wob = vec3f(sin(frame.time * 0.31 + g.x * 17.0), sin(frame.time * 0.23 + g.y * 13.0), cos(frame.time * 0.27 + g.z * 11.0)) * 0.12;
    let centre = W.xyz + S * sb + (ax * cos(ang) + ay * sin(ang)) * rr + wob;
    let size = worldLight.geode.moteSize * (0.8 + 1.2 * h.y);
    o.pos = frame.viewProj * vec4f(centre + (frame.camRight * c0.x + frame.camUp * c0.y) * size, 1.0);
    o.uv = c0;
    let ends = smoothstep(0.0, 1.5, sb) * smoothstep(sF, sF * 0.7, sb);
    o.bright = worldLight.geode.sun.w * 0.5 * ends * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(frame.time * (0.8 + 2.0 * h.z) + h.x * 40.0), 3.0)) * step(0.0, W.w - 0.01);
    return o;
  }
  let top = worldLight.geode.shaftCol.w;
  let fall = 0.012 + 0.03 * h.x;
  let y = top * fract(h.z - frame.time * fall / top * 3.0);
  let up = y / top;
  let rad = worldLight.geode.shaft.z * mix(1.0, 0.45, up) * sqrt(h.y) * 1.1;
  let a = h.x * 6.2831853 + sin(frame.time * 0.11 + h.z * 9.0) * 0.4;
  let wob = vec3f(sin(frame.time * 0.37 + h.y * 17.0), 0.0, cos(frame.time * 0.29 + h.x * 13.0)) * 0.08;
  let centre = vec3f(worldLight.geode.shaft.x + cos(a) * rad, y, worldLight.geode.shaft.y + sin(a) * rad) + wob;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let size = worldLight.geode.moteSize * (0.5 + h.y);
  o.pos = frame.viewProj * vec4f(centre + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  o.uv = c;
  // lit only inside the light, faint at the edge of it, twinkling as they turn
  let edge = smoothstep(1.0, 0.3, length(centre.xz - worldLight.geode.shaft.xy) / (worldLight.geode.shaft.z * mix(1.0, 0.45, up)));
  o.bright = worldLight.geode.shaft.w * edge * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(frame.time * (1.0 + 3.0 * h.z) + h.x * 40.0), 4.0));
  return o;
}

@fragment fn fs(i: MOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.5);
  // (a firefly's brightness comes negative: its own colour, its glow wider)
  if (i.bright < 0.0) { return vec4f(vec3f(0.85, 1.0, 0.35) * (-i.bright) * exp(-dot(i.uv, i.uv) * 2.2) * 0.9, 0.0); }
  return vec4f(vec3f(1.0, 0.95, 0.88) * i.bright * k * 0.12, 0.0);
}

// Glints on flying water: a drop in the air catches the light as a tiny bright point that flickers as it tumbles.
// Drawn additively in the scene's glow phase over the surface's own spheres (which give each drop its body once the
// surface pass runs), one camera-facing sprite per flying liquid particle, lit by the world's key light.
#include "weft/frame"
#include "./water"
#include "../../worlds/light"

struct Drops { strength: f32, size: f32, pad0: f32, pad1: f32 }

@group(1) @binding(0) var<uniform> sim: WaterSim;
@group(1) @binding(1) var<uniform> drops: Drops;
@group(1) @binding(2) var<storage, read> state: array<Particle>;
@group(1) @binding(3) var<storage, read> aux: array<Aux>;

struct DOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DOut {
  var o: DOut;
  let p = state[ii];
  let a = aux[ii];
  // a third of the flying drops glint at a time (the rest are only the surface's spheres)
  let tw = rnd(ii * 2654435761u + u32(frame.time * 9.0 + rnd(ii) * 9.0) * 747796405u);
  if (!modeIs(p.mode, FLYING) || a.ice > 0.5 || a.gone > 0.5 || tw < 0.66 || ii >= sim.count) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let key = worldKey(p.pos, false, 0.0);
  let c = CORNERS[vi];
  let size = drops.size * (0.6 + 0.8 * rnd(ii ^ 0x77u));
  let wp = p.pos + (frame.camRight * c.x + frame.camUp * c.y) * size;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  let flash = smoothstep(0.66, 1.0, tw);
  o.col = (vec3f(0.55, 0.85, 1.0) * 0.2 + key.col * 6.0 * key.glint * flash) * drops.strength;
  return o;
}

@fragment fn fs(i: DOut) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  let k = exp(-r2 * 9.0) + 0.4 * exp(-abs(i.uv.x) * 22.0) * exp(-abs(i.uv.y) * 3.0) + 0.4 * exp(-abs(i.uv.y) * 22.0) * exp(-abs(i.uv.x) * 3.0);
  return vec4f(i.col * k, 0.0);
}

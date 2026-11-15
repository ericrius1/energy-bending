// The specimens. One pipeline per world (and a second, mirrored under the floor, where the world's floor mirrors),
// issued as an indirect draw per specimen × level of detail; each vertex carries its specimen, detail and material,
// and the instance index picks the stone from that draw's list (cull.wgsl). Materials: rough crust (mottled, bumped,
// matte, a few mica glints), a polished cut face (banded agate), crystal (refraction with fire, glints, a glow
// strongest deep in a geode), polished stone or glass, and metal. Everything that depends on where they are (what
// they reflect, the light on them, the soft light round them) comes from worlds/light.wgsl, chosen by the WORLD
// constant this pipeline was made with. A dancer's stones are drawn where this view sees them (engine/seen.wgsl:
// carried through a gate, cut at its door). Each mineral's trait is here too (obsidian's glowing fractures, opal's play
// of colour, iron's rust), and a heart (hearts.wgsl) lights the stones round it. A clap lights the hands that met (the
// flash per capsule rides in the Sim uniform's caps, so it costs no binding).
#include "weft/frame"
#include "./gem"
#include "../../worlds/light"
#include "../../engine/seen"
#include "./hearts"

override MIRROR: f32 = 0.0;

@group(1) @binding(0) var<uniform> sim: Sim;
@group(1) @binding(1) var<uniform> look: Look;
@group(1) @binding(2) var<uniform> minerals: Minerals;
@group(1) @binding(3) var<storage, read> state: array<Particle>;
@group(1) @binding(4) var<storage, read> verts: array<vec4f>;
@group(1) @binding(5) var<storage, read> list: array<u32>;
@group(1) @binding(6) var<storage, read> homes: array<Home>;
@group(1) @binding(7) var<storage, read> homes2Prev: array<vec4f>;
@group(1) @binding(8) var<uniform> seen: ViewSeen;
@group(1) @binding(9) var<uniform> hearts: Hearts;

fn looksOf(i: u32, p: Particle) -> vec4f {
  if (sim.prevLook > 0.5 && i < sim.envBase && (modeIs(p.mode, RESTING) || (modeIs(p.mode, FLYING) && sim.body.settle > 0.5))) { return homes2Prev[i]; }
  return homes[i].look;
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec3f,
  @location(3) ao: f32,
  @location(4) @interpolate(flat) rot: vec4f,
  @location(5) @interpolate(flat) kind: u32,
  @location(6) @interpolate(flat) mat: u32,
  @location(7) @interpolate(flat) facet: f32,
  @location(8) @interpolate(flat) heat: f32,
  @location(9) @interpolate(flat) lod: u32,
  @location(10) @interpolate(flat) env: f32,
  @location(11) clip: f32,
  @location(12) @interpolate(flat) clap: f32,
  /** its body's seat colour (matter/core/seats.ts): rgb, w how strongly */
  @location(13) @interpolate(flat) seat: vec4f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let a = verts[vi * 2u];
  let b = verts[vi * 2u + 1u];
  let code = u32(b.w + 0.5);
  let draw = code / 8u;
  let t = draw / LODS;
  let lod = draw % LODS;
  var pid = 0u;
  let base = u32(sim.types[t].x);
  if (MIRROR > 0.5) { pid = list[base + ii]; } else { pid = list[base * LODS + lod * u32(sim.types[t].y) + ii]; }
  let p = state[pid];
  let env = pid >= sim.envBase;
  var sd = seen.d[0];
  var pos = p.pos;
  var rot = p.rot;
  if (!env) { sd = seen.d[min(dancerOf(homes[pid]), MAX_DANCERS - 1u)]; pos = seenPos(sd, p.pos); rot = seenRot(sd, p.rot); }
  let floorY = sim.body.floorY;
  // the floor only shows what's near it
  if (MIRROR > 0.5 && pos.y - floorY > 0.8) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let h2 = looksOf(pid, p);
  var s = h2.y;
  // a clap: the stones of the hands that met, on the body, flash and swell a little (Sim.caps' w, set per capsule)
  var clap = 0.0;
  if (!env && modeIs(p.mode, ON_BODY)) { clap = sim.caps[min(u32(homes[pid].place.x), MAX_DANCERS * SEGS - 1u)].w; }
  if (!env) {
    s = stoneSize(pid, h2.y, sim.gemScale * sim.types[t].z, sim.sizeVar) * spareScale(pid, sim.inUse, sim.spareFade) * seen.grow * (1.0 + 0.3 * clap);
    if (sim.body.returnMode > 0.5) {
      if (p.mode < 0.5) { s *= smoothstep(0.0, 0.6, p.life); }
      else if (p.mode < 1.5) { s *= smoothstep(0.0, 0.5, p.life); }
    }
  }
  var wp = pos + qrot(rot, a.xyz * s);
  var n = qrot(rot, b.xyz);
  o.clip = select(seenClip(sd, wp), 1.0, env);
  if (MIRROR > 0.5) { wp.y = 2.0 * floorY - wp.y; n.y = -n.y; }
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = n;
  o.local = a.xyz;
  o.ao = floor(a.w) / 15.0;
  o.rot = rot;
  o.kind = t;
  o.mat = code % 8u;
  o.facet = fract(a.w) + rnd(pid * 2246822519u + 7u);
  o.heat = smoothstep(1.0, 5.0, length(p.vel));
  o.lod = lod;
  o.env = select(0.0, 1.0, env);
  o.clap = clap;
  o.seat = select(look.seat[min(dancerOf(homes[pid]), MAX_DANCERS - 1u)], vec4f(0.0), env);
  return o;
}

fn hue(c: vec3f) -> vec3f { return c / max(max(c.r, max(c.g, c.b)), 1e-3); }

/** a mineral's own trait on crystal and polished stone: obsidian's fractures glowing like embers, opal's patches of
 *  spectral colour that change as it turns */
fn traits(K: Kind, local: vec3f, N: vec3f, V: vec3f, cosV: f32) -> vec3f {
  var c = vec3f(0.0);
  if (K.fx.x > 0.0) {
    // the lines where a noise crosses its middle read as cracks; they breathe a little
    let q = local * 3.2;
    let crack = 1.0 - smoothstep(0.0, 0.035, abs(vnoise(q) - 0.5)) * 1.0;
    let crack2 = 1.0 - smoothstep(0.0, 0.025, abs(vnoise(q * 2.3 + 11.0) - 0.5));
    let breathe = 0.75 + 0.25 * sin(frame.time * 1.7 + local.x * 9.0);
    c += vec3f(1.0, 0.32, 0.06) * (crack + crack2 * 0.5) * K.fx.x * 1.6 * breathe;
  }
  if (K.fx.y > 0.0) {
    // play of colour: cells of one spectral colour each, which shifts with the angle it is seen at
    let cell = floor(local * 5.0 + vec3f(fbm(local * 2.0)) * 2.0);
    let h = hash3(cell);
    let blot = smoothstep(0.35, 0.6, hash3(cell + 7.0));
    c += thinFilm(h * 3.0 + cosV * 1.6) * blot * K.fx.y * (0.35 + 0.65 * pow(1.0 - cosV, 1.5)) * 0.9;
  }
  return c;
}

/** a clap's light in a stone: a warm white tinted by the stone's own crystal (× the flash, 1 at the meeting) */
fn clapLight(K: Kind) -> vec3f { return mix(vec3f(1.0, 0.93, 0.8), hue(K.crystal.rgb), 0.4) * look.clap; }

/** the soft light round a stone, as bright as the stones take it */
fn ambient(N: vec3f, ao: f32, p: vec3f) -> vec3f { return worldAmbient(N, ao, p) * look.envIntensity; }

@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // past the door this view's dancer has gone through (or is coming out of)
  if (i.clip < 0.0) { discard; }
  let K = minerals.k[i.kind];
  let floorY = sim.body.floorY;
  var cam = frame.camPos;
  if (MIRROR > 0.5) {
    if (i.wp.y > floorY + 0.002) { discard; }
    cam.y = 2.0 * floorY - cam.y;
  }
  var N = normalize(i.n);
  let key = worldKey(i.wp, i.lod < 2u, i.env);
  let rim = worldRim();
  // the reflection is dim and soft: flat colour, the key light and the glow are enough
  if (MIRROR > 0.5) {
    let below = floorY - i.wp.y;
    var base = select(K.crystal.rgb, mix(K.crust.rgb, K.crust2.rgb, 0.5), i.mat == 0u);
    if (i.mat == 1u) { base = mix(K.band.rgb, K.band2.rgb, 0.5); }
    var c = base * (ambient(N, i.ao, i.wp) + key.plain * max(dot(N, key.dir), 0.0));
    if (i.mat >= 2u && i.mat < 4u) { c += hue(K.crystal.rgb) * K.crystal.w * look.emissive * mix(0.35, 1.0, 1.0 - i.ao) * 0.35; }
    if (i.env > 0.5) { c *= worldFixtureTint(i.wp, false); }
    c += clapLight(K) * i.clap * 0.5;
    // the floor mirrors more at a glance along it than looking down into it (Fresnel)
    let glance = 1.0 - abs(normalize(i.wp - frame.camPos).y);
    let fres = 0.25 + 0.75 * pow(max(glance, 0.0), 3.0);
    // alpha 0: added onto the floor without touching the depth it wrote there
    return vec4f(c * look.reflect * exp(-below * 3.0) * fres * 1.3, 0.0);
  }
  let V = normalize(cam - i.wp);
  if (!front) { N = -N; }
  let Ld = key.dir;
  let keyCol = key.col;
  let glintK = key.glint;
  let rimDir = normalize(vec3f(-0.75, 0.35, -0.55));
  let fh = fract(i.facet * 13.37);
  var col = vec3f(0.0);

  switch (i.mat) {
    // ------------------------------------------------ rough crust
    case 0u: {
      let q = i.local * K.crust2.w;
      let nz = fbm(q);
      // bump: the noise's gradient, in the stone's frame, turned into the world (near stones only)
      if (i.lod < 2u) {
        let e = 0.08;
        let g = vec3f(vnoise(q + vec3f(e, 0.0, 0.0)), vnoise(q + vec3f(0.0, e, 0.0)), vnoise(q + vec3f(0.0, 0.0, e))) - vnoise(q);
        N = normalize(N - qrot(i.rot, g / e) * K.crust.w * 0.2);
      }
      var albedo = mix(K.crust.rgb, K.crust2.rgb, smoothstep(0.3, 0.75, nz));
      albedo *= 0.75 + 0.5 * vnoise(q * 3.1 + 5.0);
      let diff = max(dot(N, Ld), 0.0);
      col = albedo * (ambient(N, i.ao, i.wp) + keyCol * diff * (0.4 + 0.6 * i.ao));
      // a dusty sheen at grazing angles, and the odd mica glint
      let cosV = max(dot(N, V), 0.0);
      col += rim.rgb * pow(max(1.0 - cosV, 0.0), 4.0) * rim.w * 0.04 * i.ao;
      let sp = hash3(floor(i.local * 38.0) + f32(i.kind) * 17.0);
      let R = reflect(-V, N);
      col += vec3f(1.0, 0.95, 0.85) * step(1.0 - K.extra.y * 0.1, sp) * pow(max(dot(R, Ld), 0.0), 24.0) * 3.0 * look.glint * glintK;
    }
    // ------------------------------------------------ polished cut face, banded
    case 1u: {
      // rings round a wandering centre, pushed about by noise, so no two faces band alike
      let wob = vec2f(fbm(i.local * 1.7 + 3.0), fbm(i.local * 1.7 + 9.0)) - 0.5;
      let r = length(i.local.xz + wob * 0.7);
      let warp = fbm(i.local * 2.5 + f32(i.kind)) * 1.4 + fbm(i.local * 9.0) * 0.3;
      var st = 0.5 + 0.5 * sin((r * K.band.w + warp) * 6.2831853);
      st = smoothstep(0.5 - K.band2.w * 0.5, 0.5 + K.band2.w * 0.5, st);
      let albedo = mix(K.band.rgb, K.band2.rgb, st);
      let diff = max(dot(N, Ld), 0.0);
      let cosV = max(dot(N, V), 0.0);
      let fres = 0.04 + 0.96 * pow(max(1.0 - cosV, 0.0), 5.0);
      let R = reflect(-V, N);
      col = albedo * (ambient(N, i.ao, i.wp) + keyCol * diff) * (1.0 - fres);
      col += worldEnv(R, i.wp) * look.envIntensity * fres * 0.8;
      // light glows through the thin translucent bands
      col += albedo * K.crystal.w * look.emissive * 0.04 * (1.0 - st);
    }
    // ------------------------------------------------ crystal, polished stone and glass
    case 2u, 3u: {
      // polished stone is cloudy inside: milky veils and inclusions
      var body = K.crystal.rgb;
      if (i.mat == 3u) { body *= 0.6 + 0.8 * fbm(i.local * 3.5 + f32(i.kind) * 3.0); }
      let clarity = K.extra.x;
      let ior = K.extra.z;
      let cosV = clamp(dot(N, V), 0.0, 1.0);
      let f0 = select(0.05, 0.17, ior > 2.0);
      let fres = f0 + (1.0 - f0) * pow(max(1.0 - cosV, 0.0), 5.0);
      let R = reflect(-V, N);
      var refl = worldEnv(R, i.wp) * look.envIntensity * mix(vec3f(1.0), hue(body), 0.6);
      refl = mix(refl, refl * thinFilm(cosV * 1.4 + fh * 0.6) * 2.0, K.extra.w);
      let tilt = normalize(-N + (vec3f(fh, fract(fh * 7.1), fract(fh * 3.3)) - 0.5) * 1.3);
      var inside = vec3f(0.0);
      for (var c = 0; c < 3; c++) {
        let T = refract(-V, N, 1.0 / (ior + (f32(c) - 1.0) * look.dispersion * K.fx.w));
        inside[c] = worldEnv(normalize(reflect(T, tilt)), i.wp)[c];
      }
      inside *= body * look.envIntensity;
      let diff = max(dot(N, Ld), 0.0);
      let lit = body * (ambient(N, i.ao, i.wp) + keyCol * diff);
      col = refl * fres + mix(lit, inside, clarity) * (1.0 - fres);
      col += body * clarity * (0.05 + 0.15 * fh) * look.envIntensity * i.ao;
      let g = pow(max(dot(R, Ld), 0.0), 600.0) * 40.0 + pow(max(dot(R, rimDir), 0.0), 200.0) * 6.0 * rim.rgb;
      col += g * look.glint * glintK * step(0.55, fh) * mix(vec3f(1.0), hue(body), 0.4);
      // the glow: strongest deep in a cavity (low ambient occlusion), faint on points out in the open
      col += hue(body) * K.crystal.w * look.emissive * mix(0.35, 1.0, 1.0 - i.ao) * (0.4 + 0.6 * fh) * 0.5;
      col += traits(K, i.local, N, V, cosV);
    }
    // ------------------------------------------------ metal (pyrite; iron, rusting)
    default: {
      let rust = K.fx.z * smoothstep(0.42, 0.62, fbm(i.local * 2.6 + f32(i.kind) * 5.0));
      let m = mix(K.crystal.rgb, vec3f(0.09, 0.035, 0.012), rust);
      let st = sin(dot(i.local, vec3f(41.0, 3.0, 7.0))) * 0.08;
      let Nb = normalize(N + qrot(i.rot, vec3f(st, 0.0, 0.0)));
      let cosV = max(dot(Nb, V), 0.0);
      let F = m + (vec3f(1.0) - m) * pow(max(1.0 - cosV, 0.0), 5.0);
      let R = reflect(-V, Nb);
      col = worldEnv(R, i.wp) * look.envIntensity * F * 0.9 + m * ambient(Nb, i.ao, i.wp) * 0.15;
      col += F * pow(max(dot(R, Ld), 0.0), 120.0) * 8.0 * look.glint * glintK * (1.0 - rust);
      // rust is matte and warm, with the odd orange glint where a flake catches the light
      col = mix(col, m * (ambient(Nb, i.ao, i.wp) + keyCol * max(dot(Nb, Ld), 0.0)) * 2.2, rust);
      let flake = step(0.93, hash3(floor(i.local * 30.0) + f32(i.kind)));
      col += vec3f(1.0, 0.45, 0.12) * flake * rust * pow(max(dot(R, Ld), 0.0), 16.0) * 5.0 * look.glint * glintK;
    }
  }
  // who this body is: the seat's colour as light from inside the stone, strongest where it turns away from the eye
  // (light through the stone's edge, as a rose or fern glow round each gem) and a breath of it on the faces
  if (i.env < 0.5 && i.seat.w > 0.0) {
    let cs = clamp(dot(N, V), 0.0, 1.0);
    col += i.seat.rgb * i.seat.w * (0.1 + 0.8 * pow(1.0 - cs, 2.0)) * mix(0.6, 1.0, i.ao) * select(0.6, 1.0, i.mat >= 2u && i.mat < 4u);
  }
  // a heart's light on the stones round it (the heart's own stones most of all)
  if (i.env < 0.5) { col += heartLight(hearts, i.wp) * look.heart * mix(vec3f(0.6), hue(K.crystal.rgb), 0.6) * mix(0.5, 1.0, 1.0 - i.ao); }
  // fast stones run hot
  col += hue(K.crystal.rgb) * i.heat * look.speedGlow * 0.3;
  // a clap lights the hands from within
  col += clapLight(K) * i.clap;
  // a world's own crystals: lit mostly from within, as the world tints them
  if (i.env > 0.5) { col *= worldFixtureTint(i.wp, true); }
  // alpha: the distance along the view, for the light in the air and the depth of field
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

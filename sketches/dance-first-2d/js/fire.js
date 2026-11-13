// fire.js — WebGL2 fluid fire simulation and renderer.
// World space: x in [-aspect/2, aspect/2], y in [0, 1] (screen heights), floor at y = FLOOR.
//
// ---------------------------------------------------------------------------------------------
// EMIT API. Everything is in world units (1 = screen height; multiply stage units by K) and is
// queued for the next step(); call it every frame you want the effect to continue. Calls past a
// cap are dropped silently (the newest ones), never thrown. The looks are documented for the 3D
// port in docs/element-looks.md.
//
//   matter (the last "water" argument of seg/burst/ember): false/0 fire, true/1 water, 2 ice,
//     3 steam, 4 plasma (MATTER.*, or the strings 'fire'|'water'|'ice'|'steam'|'plasma').
//     Plasma is fire tagged with the PLASMA_CH chroma (any cx, cy given are replaced).
//
//   seg(ax, ay, bx, by, vax, vay, vbx, vby, r, heat, cx=0, cy=0, seed=0, matter=false)
//     A capsule from A to B, radius r. va/vb: velocity at each end (units/s) that it drags the air
//     with. heat: amount injected per second (fire ~5 for a dancer limb, water/ice ~3).
//     (cx, cy): flame tint as a unit hue vector (0,0 = classic fire; length 2 = plasma).
//     seed: any number, decorrelates flicker.                         Cap MAX_INST, shared with burst.
//   burst(x, y, r, strength, heat, cx=0, cy=0, lift=0, matter=false, width=0)
//     An expanding ring of radius r: pushes air outward at `strength` units/s plus `lift` upward,
//     ring thickness `width` (0 = default 0.36 of r). Negative strength sucks inward.
//   ember(x, y, radius, rate, matter=false)
//     Particles spawned inside a disc, `rate` per second. fire: embers that rise; water: droplets
//     that fall; ice: glinting dust that drifts down; steam: white sparks that rise; plasma:
//     crackling violet-white sparks.                                  Cap MAX_EM emitters a frame.
//   ripple(x, z, r, strength)      A push on the pool. z 0..1 (1 = horizon, POOL_Z = the dancers).
//   frost(x, radius, amount, z=POOL_Z)   Frost on the pool, fades over ~3 s, spreads toward the
//     viewer; ice on the floor frosts it by itself and fire near the floor melts it. Cap MAX_FROST.
//   arc(x0, y0, x1, y1, intensity=1)     A jagged, forking lightning arc for this frame (it re-forks
//     each call, which is its flicker). Drawn into the scene before bloom.  Cap MAX_ARCS a frame.
//   look.ice, look.plasma (0..1, animate freely): new water is emitted as ice / new fire as plasma
//     in that proportion. look.fusion = { kind: 'steam'|'prism'|'storm'|'aurora'|null, amount 0..1 }.
//   noteBody(x, y, r, element): emitDancer calls it; the fusion looks centre their rain, sparks
//     and lightning on the bodies noted that frame.
//   render(time, fx): glow, exposure, flash, shakeX/Y, bloom as before, plus optional hurt 0..1 +
//     hurtHue (0 fire red, 1 ice blue), zoom (1 = none) about zoomX/zoomY (uv), chroma 0..1.
//
// RECIPES (K = stage-to-world scale, (x, y) world position, d = +1/-1 direction, call per frame):
//   fire bolt at (x, y), speed s:
//     seg(x, y, x - d*0.07*K, y, d*s, 0, d*s*0.6, 0.3, 0.024*K, 26, 0, 0, seed);
//     seg(x, y, x, y, d*s, 0, d*s, 0, 0.03*K, 30, 0, 0, seed + 1);  ember(x, y, 0.025*K, 1500);
//   plasma bolt: the same two segs with matter MATTER.plasma and heat x1.2, ember(..., MATTER.plasma),
//     plus arc(x, y, x - d*0.08*K, y + 0.01, 0.6) for a crackling tail.
//   ice shard: a long thin capsule; the trail hangs and glints because ice barely falls
//     seg(x, y, x - d*0.09*K, y, d*s, 0, d*s*0.5, 0, 0.018*K, 16, 0, 0, seed, MATTER.ice);
//     seg(x, y, x, y, d*s, 0, d*s, 0, 0.024*K, 14, 0, 0, seed + 1, MATTER.ice);
//     ember(x, y, 0.03*K, 1200, MATTER.ice);
//   element throw from hand (hx, hy) along unit aim (ax, ay), speed s ~2.5, length L ~0.14*K:
//     seg(hx, hy, hx + ax*L, hy + ay*L, ax*s*0.5, ay*s*0.5, ax*s, ay*s, 0.016*K, heatOrWet*3, 0, 0,
//         seed, matter);  ember(hx + ax*L, hy + ay*L, 0.02*K, 900, matter);
//     (fire heat ~18, water/ice ~10; water falls in an arc by itself, fire curls up, ice hangs.)
//   arc between a plasma dancer's hands: arc(lwx, lwy, rwx, rwy, 0.8) every frame; to a target
//     within reach, arc(hand, target, 1.2) on a strike.
//   floor wave: seg(x - d*0.05*K, FLOOR+0.012, x + d*0.04*K, FLOOR+0.03*K, d*s, 0.8, d*s, 2.2, 0.02*K,
//     34, 0, 0, seed, matter) (ice: heat 18), ember on top, ripple(x, POOL_Z, 0.04*K, 0.08) every
//     few frames; ice: also frost(x, 0.06*K, 2.5*dt).
//   shield arc: five short segs on a circle of R = 0.16*K in front of the dancer, r 0.012*K, heat
//     6 (fire) or 4 (ice, it lingers).
//   steam clash at (x, y), ~0.25 s, u = age / 0.25:
//     burst(x, y, (0.03 + 0.25*u)*K, 3.2*(1 - u), 14*(1 - u), 0, 0, 0.6);
//     burst(x, y, (0.03 + 0.22*u)*K, 3.0*(1 - u), 5*(1 - u), 0, 0, 0.3, MATTER.ice);
//     burst(x, y, (0.02 + 0.30*u)*K, 1.0, 10*(1 - u), 0, 0, 1.4, MATTER.steam, 0.6);
//     first frame: ember fire 9000, ice 6000, steam 6000; fx flash 0.6, chroma 0.6, zoom 1.05.
//     Fire and ice that overlap also boil off steam by themselves.
//   fusion: emit both bodies as usual (each with its own element), then ramp
//     fire.look.fusion = { kind, amount } from 0 to 1 over about a beat and back down on release.
//     Keep look.ice / look.plasma as the forms were (prism wants look.ice = 1, storm look.plasma = 1,
//     aurora both). The fusion damps the mutual destruction of fire and water, so the merged body
//     survives, and adds its own rain / lightning / sparks around the noted bodies.
// ---------------------------------------------------------------------------------------------

export const FLOOR = 0.14;
export const MATTER = { fire: 0, water: 1, ice: 2, steam: 3, plasma: 4 };
const clamp01 = v => v > 0 ? (v < 1 ? v : 1) : 0; // NaN -> 0
const matterOf = m => m === true ? 1 : !m ? 0 : typeof m === 'string' ? (MATTER[m] ?? 0) : Math.max(0, Math.min(4, m | 0));

const TIERS = {
  high:   { sim: 256, fire: 640, iters: 22, embers: 160, maxPx: 2560 * 1440 },
  medium: { sim: 176, fire: 420, iters: 16, embers: 128, maxPx: 1920 * 1080 },
  low:    { sim: 120, fire: 288, iters: 11, embers: 96,  maxPx: 1280 * 720 },
};
const TIER_ORDER = ['high', 'medium', 'low'];
// A dancer is ~17-22 capsules and 4 ember emitters; a ghost ~17 and 2. Two dancers, three ghosts,
// a dozen projectiles (2-3 capsules, 1 emitter each) and a few bursts fit with room to spare.
const MAX_INST = 768;
const INST_FLOATS = 14;
const MAX_EM = 48;
const MAX_DROPS = 24;
const MAX_FROST = 8;
const MAX_ARCS = 24, MAX_ARC_SEGS = 768, ARC_FLOATS = 6;
// Chroma vector that tags fire as plasma: the hue is violet and the length 2 (> 1) marks it.
export const PLASMA_CH = [2 * Math.cos(0.78 * 2 * Math.PI), 2 * Math.sin(0.78 * 2 * Math.PI)];
const FUSION_KINDS = { steam: 0, prism: 1, storm: 2, aurora: 3 };
const WAVE_W = 256, WAVE_H = 128;
const WAVE_ZR = 1.3;        // world depth of the pool, in screen heights
export const POOL_Z = 0.93; // where the dancers stand in the pool (0 = nearest the viewer, 1 = horizon)

const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;
`;

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + vec2(17.1, 3.7); a *= .5; } return s; }
`;

const FS_CURL = HEAD + `
uniform sampler2D uVel; uniform vec2 uTexel;
void main(){
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.)).y;
  float R = texture(uVel, vUv + vec2(uTexel.x, 0.)).y;
  float B = texture(uVel, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uVel, vUv + vec2(0., uTexel.y)).x;
  o = vec4(0.5 * (R - L - T + B), 0., 0., 1.);
}`;

const FS_VORT = HEAD + `
uniform sampler2D uVel, uCurl; uniform vec2 uTexel; uniform float uDt, uStrength;
void main(){
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uCurl, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uCurl, vUv + vec2(0., uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= uStrength * C;
  f.y *= -1.0;
  vec2 v = texture(uVel, vUv).xy + f * uDt;
  o = vec4(clamp(v, vec2(-12.), vec2(12.)), 0., 1.);
}`;

const FS_ADVECT_VEL = HEAD + NOISE + `
uniform sampler2D uVel, uFire, uWater;
uniform float uDt, uAspect, uDamp, uBuoy, uTime, uTurb, uFloor, uGrav, uIceGrav, uMistSink, uSteamBuoy;
vec2 curlN(vec2 p){ float e = 0.06;
  float n1 = vnoise(p + vec2(0, e)), n2 = vnoise(p - vec2(0, e));
  float n3 = vnoise(p + vec2(e, 0)), n4 = vnoise(p - vec2(e, 0));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e); }
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec2 p = vUv - uDt * v * vec2(1.0 / uAspect, 1.0);
  vec2 nv = texture(uVel, p).xy * uDamp;
  vec4 f = texture(uFire, vUv);
  float T = f.r;
  // plasma is tagged by a chroma vector longer than 1 (see PLASMA_CH); it barely rises
  float pl = T > 1e-3 ? clamp(length(f.ba) / T - 1.0, 0., 1.) : 0.;
  nv.y += uDt * uBuoy * min(T, 2.5) * (1.0 - 0.7 * pl);
  // water: r amount, g the part of it that is ice, b cold mist, a steam
  vec4 wv = texture(uWater, vUv);
  float W = wv.r, ice = clamp(wv.g / max(W, 1e-4), 0., 1.);
  nv.y -= uDt * mix(uGrav, uIceGrav, ice) * min(W, 1.6);
  nv.y -= uDt * uMistSink * min(wv.b, 2.0);   // cold air sinks (and rises in an aurora)
  nv.y += uDt * uSteamBuoy * min(wv.a, 2.5);  // steam billows up
  vec2 w = vec2((vUv.x - 0.5) * uAspect, vUv.y);
  vec2 n = curlN(w * 7.0 + vec2(uTime * 0.31, -uTime * 1.7)) + 0.5 * curlN(w * 15.0 + vec2(-uTime * 0.7, -uTime * 2.9));
  nv += uDt * uTurb * (min(T, 1.6) * (1.0 + 0.8 * pl) + 0.7 * min(wv.a, 1.5) + 0.1 * min(wv.b, 1.0)) * n;
  nv *= smoothstep(uFloor - 0.012, uFloor + 0.004, vUv.y);
  o = vec4(nv, 0., 1.);
}`;

const FS_DIV = HEAD + `
uniform sampler2D uVel; uniform vec2 uTexel;
void main(){
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uVel, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uVel, vUv - vec2(0., uTexel.y)).y;
  float T = texture(uVel, vUv + vec2(0., uTexel.y)).y;
  o = vec4(0.5 * (R - L + T - B), 0., 0., 1.);
}`;

const FS_PRESSURE = HEAD + `
uniform sampler2D uP, uDiv; uniform vec2 uTexel;
void main(){
  float L = texture(uP, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uP, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uP, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uP, vUv + vec2(0., uTexel.y)).x;
  float d = texture(uDiv, vUv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0., 0., 1.);
}`;

const FS_GRAD = HEAD + `
uniform sampler2D uP, uVel; uniform vec2 uTexel;
void main(){
  float L = texture(uP, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uP, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uP, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uP, vUv + vec2(0., uTexel.y)).x;
  vec2 v = texture(uVel, vUv).xy - 0.5 * vec2(R - L, T - B);
  o = vec4(v, 0., 1.);
}`;

const FS_SCALE = HEAD + `
uniform sampler2D uTex; uniform float uK;
void main(){ o = texture(uTex, vUv) * uK; }`;

const FS_ADVECT_FIRE = HEAD + `
uniform sampler2D uVel, uFire, uWater;
uniform float uDt, uAspect, uCool0, uCool1, uCool2, uSmokeKeep, uSoot, uPlasmaCool, uCoexist;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec2 p = vUv - uDt * v * vec2(1.0 / uAspect, 1.0);
  vec4 f = texture(uFire, p);
  float inside = step(0., p.x) * step(p.x, 1.) * step(0., p.y) * step(p.y, 1.);
  f *= inside;
  float T = min(f.r, 6.0);
  float pl = f.r > 1e-3 ? clamp(length(f.ba) / f.r - 1.0, 0., 1.) : 0.;
  // plasma burns out faster, so it stays tight around its source
  float nT = max(0.0, T - uDt * (uCool0 + uCool1 * T + uCool2 * T * T) * (1.0 + uPlasmaCool * pl));
  vec2 wv = texture(uWater, vUv).rg;
  float W = wv.r, ice = clamp(wv.g / max(W, 1e-4), 0., 1.);
  float quench = min(nT, uDt * 10.0 * W * nT * (1.0 - 0.85 * uCoexist));
  // quenched by water it chokes into smoke; quenched by ice it goes up as steam (see the water pass)
  float smoke = f.g * uSmokeKeep + ((T - nT) * uSoot + quench * 2.2 * (1.0 - 0.85 * ice)) * (1.0 - 0.95 * pl);
  nT -= quench;
  float ratio = T > 1e-4 ? nT / T : 0.0;
  o = vec4(nT, min(smoke, 4.0), f.ba * ratio);
}`;

// Water field, RGBA: r = amount, g = the part of it that is ice (g <= r), b = cold mist, a = steam.
const FS_ADVECT_WATER = HEAD + `
uniform sampler2D uVel, uWater, uFire;
uniform float uDt, uAspect, uKeep, uFloor, uIceKeep, uIceMelt, uThaw, uIceSwallow;
uniform float uMistKeep, uMistRate, uSteamKeep, uSteamGain, uSteamQ, uCoexist, uVapor;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec2 p = vUv - uDt * v * vec2(1.0 / uAspect, 1.0);
  vec4 s = texture(uWater, p);
  s *= step(0., p.x) * step(p.x, 1.) * step(0., p.y) * step(p.y, 1.);
  float W = s.r, G = min(s.g, s.r);
  float ice = G / max(W, 1e-4);
  float keep = mix(uKeep, uIceKeep, ice);
  W *= keep; G *= keep;
  float T = texture(uFire, vUv).r;
  float nW = max(0.0, W - uDt * mix(4.0, uIceMelt, ice) * T * W * (1.0 - 0.85 * uCoexist));
  float lost = W - nW;
  G = W > 1e-5 ? G * (nW / W) : 0.0;
  G = max(0.0, G - uDt * uThaw * T * G);   // ice touched by flame turns to meltwater and drips
  W = nW;
  // the pool swallows whatever reaches it (ice sits on it a little longer)
  float sw = mix(mix(exp(-uDt * 16.0), exp(-uDt * uIceSwallow), ice), 1.0, smoothstep(uFloor - 0.004, uFloor + 0.022, vUv.y));
  W *= sw; G *= sw;
  // ice breathes out cold mist; fire and ice meeting boil off into steam
  float M = s.b * uMistKeep + uDt * uMistRate * min(G, 1.5);
  float St = s.a * uSteamKeep + lost * ice * uSteamGain + uDt * uSteamQ * min(T, 3.0) * min(G, 2.0)
           + uDt * uVapor * min(T, 3.0) * min(W, 2.0);   // a steam fusion boils the water too
  o = vec4(min(W, 4.0), min(G, 4.0), min(M, 3.0), min(St, 4.0));
}`;

// Shallow pool: a damped wave equation on a height field (x across the stage, y = depth toward the horizon).
// RGBA: r height, g vertical velocity, b frost (0..1.5).
const FS_WAVE = HEAD + `
uniform sampler2D uWave, uWater, uFire;
uniform vec2 uTexel, uCell;
uniform float uDt, uC2, uDamp, uFloor, uAspect, uLine, uZR, uPoolZ;
uniform float uFrostKeep, uFrostRate, uFrostMelt, uFrostDamp, uFrostDiff;
uniform vec4 uDrop[${MAX_DROPS}];
uniform int uDropCount;
uniform vec4 uFrost[${MAX_FROST}];
uniform int uFrostCount;
void main(){
  vec4 s = texture(uWave, vUv);
  vec4 nL = texture(uWave, vUv - vec2(uTexel.x, 0.)), nR = texture(uWave, vUv + vec2(uTexel.x, 0.));
  vec4 nD = texture(uWave, vUv - vec2(0., uTexel.y)), nU = texture(uWave, vUv + vec2(0., uTexel.y));
  float lap = (nL.x + nR.x - 2.0 * s.x) / (uCell.x * uCell.x) + (nD.x + nU.x - 2.0 * s.x) / (uCell.y * uCell.y);
  float v = s.y + uDt * uC2 * lap;
  vec2 w = vec2((vUv.x - 0.5) * uAspect, vUv.y * uZR);
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uDropCount) break;
    vec2 d = w - vec2(uDrop[i].x, uDrop[i].y * uZR);
    float r = uDrop[i].z;
    v -= uDrop[i].w * exp(-dot(d, d) / (r * r));
  }
  vec4 fw = texture(uWater, vec2(vUv.x, uFloor + 0.014));
  if (uLine > 0.0) {
    float fall = fw.r - min(fw.g, fw.r); // only liquid water splashes
    float band = (vUv.y - uPoolZ) / 0.035;
    v -= uLine * min(fall, 2.0) * exp(-band * band) * uDt;
  }
  // frost: spreads a little, fades, grows where ice (or its mist) touches the floor, melts under flame
  float fr = s.z;
  fr += min(1.0, uDt * uFrostDiff) * ((nL.z + nR.z) * 0.3 + (nD.z + nU.z) * 0.2 - fr);
  fr *= uFrostKeep;
  float dz = vUv.y - uPoolZ;
  float fb = exp(-dz * dz / (dz < 0.0 ? 0.15 : 0.002)); // the patch reaches toward the viewer
  fr += uDt * uFrostRate * (min(fw.g, 1.5) + 0.3 * min(fw.b, 1.5)) * fb;
  for (int i = 0; i < ${MAX_FROST}; i++) {
    if (i >= uFrostCount) break;
    vec2 d = w - vec2(uFrost[i].x, uFrost[i].y * uZR);
    d.y *= d.y < 0.0 ? 0.16 : 1.0;
    float r = uFrost[i].z;
    fr += uFrost[i].w * exp(-dot(d, d) / (r * r));
  }
  float fx = 0.025 / uAspect;
  float fT = max(texture(uFire, vec2(vUv.x, uFloor + 0.02)).r,
             0.7 * max(texture(uFire, vec2(vUv.x - fx, uFloor + 0.045)).r, texture(uFire, vec2(vUv.x + fx, uFloor + 0.045)).r));
  fr = max(0.0, fr - uDt * uFrostMelt * min(fT, 3.0) * (0.3 + fr) * exp(-dz * dz / 0.25));
  fr = min(fr, 1.5);
  // ice on the surface stiffens it: ripples die out under the frost
  v *= uDamp * exp(-uDt * uFrostDamp * min(fr, 1.0));
  float h = s.x + uDt * v;
  vec2 e = min(vUv, 1.0 - vUv);
  h *= smoothstep(0.0, 0.03, min(e.x, e.y * 0.5 + 0.02));
  o = vec4(clamp(h, -1.0, 1.0), clamp(v, -30.0, 30.0), fr, 1.);
}`;

// Instanced capsule / burst splats.
const VS_SPLAT = `#version 300 es
precision highp float;
layout(location=0) in vec2 iA;
layout(location=1) in vec2 iB;
layout(location=2) in vec2 iVa;
layout(location=3) in vec2 iVb;
layout(location=4) in vec4 iParams; // r, heat, kind, seed
layout(location=5) in vec2 iChroma;
uniform float uAspect, uRadK;
out vec2 vW; out vec2 vA; out vec2 vB; out vec2 vVa; out vec2 vVb; out vec4 vParams; out vec2 vChroma;
const vec2 C[6] = vec2[6](vec2(0,-1), vec2(1,-1), vec2(1,1), vec2(0,-1), vec2(1,1), vec2(0,1));
void main(){
  vec2 c = C[gl_VertexID];
  vec2 ab = iB - iA; float len = length(ab);
  vec2 ax = len > 1e-5 ? ab / len : vec2(1., 0.);
  vec2 n = vec2(-ax.y, ax.x);
  float r = iParams.x * uRadK;
  float pad = r * (mod(iParams.z, 2.0) > 0.5 ? 1.7 : 2.6);
  vec2 w = iA + ax * (c.x * len + (c.x * 2.0 - 1.0) * pad) + n * c.y * pad;
  vW = w; vA = iA; vB = iB; vVa = iVa; vVb = iVb; vParams = vec4(r, iParams.yzw); vChroma = iChroma;
  gl_Position = vec4(w.x / (0.5 * uAspect), w.y * 2.0 - 1.0, 0., 1.);
}`;

const FS_SPLAT = `#version 300 es
precision highp float;
in vec2 vW; in vec2 vA; in vec2 vB; in vec2 vVa; in vec2 vVb; in vec4 vParams; in vec2 vChroma;
uniform int uTarget; uniform float uDt, uTime, uVelK, uLookIce, uLookPlasma;
uniform vec2 uPlasmaCh;
out vec4 o;
` + NOISE + `
float matter;
// what a splat of amount q adds to its field
vec4 deposit(float q){
  if (uTarget == 1) return vec4(q, 0., mix(vChroma, uPlasmaCh, uLookPlasma) * q);
  if (matter > 2.5) return vec4(0., 0., 0., q);              // steam
  return vec4(q, q * (matter > 1.5 ? 1.0 : uLookIce), 0., 0.); // water, tagged as ice
}
void main(){
  vec2 pa = vW - vA, ba = vB - vA;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0., 1.);
  float d = length(pa - ba * h);
  float r = vParams.x, heat = vParams.y, kind = vParams.z, seed = vParams.w;
  matter = floor(kind * 0.5 + 0.01);  // 0 fire, 1 water, 2 ice, 3 steam
  bool water = matter > 0.5;
  if ((uTarget == 1 && water) || (uTarget == 2 && !water)) discard;
  if (mod(kind, 2.0) < 0.5) {
    float w = exp(-(d * d) / (r * r));
    if (uTarget == 0) {
      vec2 vv = mix(vVa, vVb, h);
      // a moving limb drags the air with it; a still one lets the flames rise freely
      o = vec4(vv + vec2(0., 0.25), 0., w * uVelK * clamp(length(vv) * 0.9, 0.04, 1.0));
    } else {
      float fl = 0.5 + 1.0 * vnoise(vW * 46.0 + vec2(seed * 17.3, uTime * 9.0 + seed * 5.1));
      float q = heat * w * fl * uDt;
      o = deposit(q);
    }
  } else {
    vec2 dir = d > 1e-5 ? pa / d : vec2(0., 1.);
    float wd = vVb.x > 0.0 ? vVb.x : 0.36;
    float rq = (d - r * 0.62) / (r * wd);
    float ring = exp(-rq * rq);
    if (uTarget == 0) {
      o = vec4(dir * vVa.x + vec2(0., vVa.y), 0., ring * 0.85);
    } else {
      float fl = 0.6 + 0.8 * vnoise(vW * 30.0 + vec2(seed * 9.1, uTime * 7.0));
      float q = heat * ring * fl * uDt;
      o = deposit(q);
    }
  }
}`;

const FS_EMBER_UPDATE = HEAD + `
uniform sampler2D uState, uVel;
uniform float uDt, uTime, uAspect, uFloor;
uniform vec4 uEm[${MAX_EM}];
uniform float uEmKind[${MAX_EM}];
uniform int uEmCount;
vec4 hash4(vec2 p){ vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, ij, 0);
  vec4 rnd = hash4(vec2(ij) + fract(uTime * 13.37) * 311.7);
  if (s.z <= 0.0) {
    float acc = 0.0; bool spawned = false; vec4 ns = vec4(-10., -10., 0., rnd.w);
    for (int i = 0; i < ${MAX_EM}; i++) {
      if (i >= uEmCount) break;
      acc += uEm[i].w;
      if (!spawned && rnd.x < acc) {
        float a = rnd.y * 6.2831853; float rr = sqrt(rnd.z) * uEm[i].z;
        ns = vec4(uEm[i].xy + vec2(cos(a), sin(a)) * rr, 1.0, rnd.w * 0.98 + uEmKind[i] * 2.0);
        spawned = true;
      }
    }
    o = ns;
  } else {
    vec2 uv = vec2(s.x / uAspect + 0.5, s.y);
    vec2 v = texture(uVel, uv).xy;
    // s.w = seed (0..0.98) + 2 * kind: 0 ember, 1 droplet, 2 ice dust, 3 steam spark
    float kind = floor(s.w * 0.5);
    float sd = s.w - kind * 2.0;
    vec2 jit, drift; float lifeT, vk = 0.95;
    if (kind < 0.5) { jit = (rnd.xy - 0.5) * 0.5; drift = vec2(0., 0.10 + 0.12 * sd); lifeT = 0.7 + 2.2 * sd * sd; }
    else if (kind < 1.5) { jit = (rnd.xy - 0.5) * 0.25; drift = vec2(0., -0.5 - 0.7 * sd); lifeT = 0.45 + 0.8 * sd; }
    else if (kind < 2.5) {
      // ice dust: hangs in the air, sways, settles slowly
      jit = (rnd.xy - 0.5) * 0.1; vk = 0.5;
      drift = vec2(0.05 * sin(uTime * 1.7 + sd * 37.0), -0.04 - 0.08 * sd); lifeT = 1.0 + 1.8 * sd;
    } else if (kind < 3.5) { jit = (rnd.xy - 0.5) * 0.7; drift = vec2(0., 0.3 + 0.4 * sd); lifeT = 0.3 + 0.5 * sd; }
    else { jit = (rnd.xy - 0.5) * 2.4; vk = 1.3; drift = vec2(0., 0.05); lifeT = 0.18 + 0.4 * sd; } // plasma: crackling, brief
    vec2 pos = s.xy + (v * vk + drift + jit) * uDt;
    float life = s.z - uDt / lifeT;
    if (pos.y > 1.05 || abs(pos.x) > uAspect * 0.55 || pos.y < uFloor - 0.01) life = 0.0;
    o = vec4(pos, life, s.w);
  }
}`;

const VS_EMBER = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uState; uniform int uN; uniform float uAspect, uPx;
out float vLife; out float vSeed;
void main(){
  ivec2 ij = ivec2(gl_VertexID % uN, gl_VertexID / uN);
  vec4 s = texelFetch(uState, ij, 0);
  vLife = s.z; vSeed = s.w;
  float kind = floor(s.w * 0.5);
  float sd = s.w - kind * 2.0;
  gl_Position = s.z > 0.0 ? vec4(s.x / (0.5 * uAspect), s.y * 2.0 - 1.0, 0., 1.) : vec4(-5., -5., 0., 1.);
  gl_PointSize = kind > 1.5 ? uPx * (0.7 + 1.5 * sd) * (0.55 + 0.45 * s.z) : uPx * (0.9 + 2.4 * sd) * (0.35 + 0.65 * s.z);
}`;

const FS_EMBER = `#version 300 es
precision highp float;
in float vLife; in float vSeed; out vec4 o;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.1, d);
  vec3 col = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.72, 0.32), vLife * vLife);
  float tw = 0.75 + 0.25 * sin(vSeed * 91.0 + vLife * 40.0);
  if (vSeed >= 8.0) {          // plasma spark: violet to white, flickering
    col = mix(vec3(0.6, 0.25, 1.0), vec3(1.0, 0.85, 1.0), vLife); tw = 0.6 + 0.8 * step(0.5, fract(vSeed * 97.0 + vLife * 23.0));
  } else if (vSeed >= 6.0) {   // steam spark
    col = vec3(0.85, 0.9, 0.95); tw = 0.45;
  } else if (vSeed >= 4.0) {   // ice dust: pale, and now and then a glint
    float g = 0.5 + 0.5 * sin(vSeed * 211.0 + vLife * 53.0);
    col = vec3(0.68, 0.86, 1.0); tw = 0.32 + 2.2 * pow(g, 14.0);
    a *= a;
  } else if (vSeed >= 2.0) { col = vec3(0.45, 0.8, 1.0); tw = 0.55; }
  o = vec4(col * a * vLife * 2.6 * tw, 1.0);
}`;

const FS_SCENE = HEAD + NOISE + `
uniform sampler2D uFire, uWater, uWave;
uniform float uAspect, uTime, uFloor, uGlow;
uniform vec2 uFireTexel, uWaveTexel, uCell;
uniform vec4 uFuse; // fusion amounts: steam, prism, storm, aurora
vec3 hue2rgb(float h){ return clamp(abs(fract(h + vec3(0., 2./3., 1./3.)) * 6. - 3.) - 1., 0., 1.); }
vec3 flame(float T, vec2 ch){
  vec3 col = pow(vec3(T), vec3(1.0, 2.0, 3.6)) * vec3(1.75, 0.95, 0.6);
  float sat = clamp(length(ch) * 1.1, 0., 1.);
  if (sat > 0.02) {
    float h = atan(ch.y, ch.x) / 6.2831853;
    vec3 c1 = hue2rgb(h);
    vec3 c2 = hue2rgb(h + 0.08) * 0.55 + 0.45;
    vec3 tinted = c1 * T * 1.25 + c2 * pow(T, 2.2) * 1.0 + vec3(1.) * pow(T, 3.8) * 0.5;
    col = mix(col, tinted, sat);
  }
  return col;
}
// plasma: a violet-magenta skin around a white-hot core
vec3 plasmaCol(float T){
  return vec3(0.42, 0.10, 1.0) * T * 1.5 + vec3(1.0, 0.30, 0.95) * pow(T, 2.0) * 0.6 + vec3(1.0) * pow(T, 3.0) * 1.1;
}
// voronoi: (distance to the nearest feature point, distance to the cell edge, cell id)
vec3 voro(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = i + g;
    vec2 r = g + vec2(hash12(c), hash12(c + 19.19)) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(c + 7.7); } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec3(d1, sqrt(d2) - d1, id);
}
// Everything that lives in the air: flame, steam, mist, and bodies of water and ice.
vec3 air(vec2 suv){
  vec4 f = texture(uFire, suv);
  vec2 w = vec2((suv.x - 0.5) * uAspect, suv.y);
  float n = fbm(w * vec2(11.0, 7.0) - vec2(0., uTime * 1.5));
  float T = max(0.0, f.r * (0.66 + 0.68 * n) - 0.035);
  T = min(T, 3.2);
  vec2 ch = f.ba / max(f.r, 1e-3);
  vec3 col = flame(T, ch);
  float pl = f.r > 1e-3 ? clamp(length(ch) - 1.0, 0., 1.) : 0.;
  if (pl > 0.003) {
    // thin fast filaments instead of billowing flame, with an electric flicker
    vec2 q = w * vec2(30.0, 13.0);
    float r1 = 1.0 - abs(2.0 * vnoise(q + vec2(uTime * 2.3, -uTime * 9.0) + n * 3.0) - 1.0);
    float r2 = 1.0 - abs(2.0 * vnoise(q * 2.1 + vec2(-uTime * 3.7, -uTime * 13.0)) - 1.0);
    float fil = pow(r1, 8.0) + 0.7 * pow(r2, 10.0);
    float flick = 0.75 + 0.5 * vnoise(vec2(uTime * 41.0, w.y * 4.0 + w.x * 2.0));
    float Tp = max(0.0, min(f.r * (0.25 + 3.2 * fil) * flick - 0.03, 3.6));
    vec3 pc = plasmaCol(Tp) + vec3(0.30, 0.06, 0.55) * smoothstep(0.02, 0.6, f.r) * 0.5;
    if (uFuse.w > 0.001) pc = mix(pc, vec3(pc.g * 0.5 + pc.b * 0.25, pc.r * 0.8 + pc.b * 0.35, pc.b * 0.8), uFuse.w * 0.6);
    col = mix(col, pc, pl);
    T = mix(T, Tp, pl);
  }
  col += vec3(0.055, 0.047, 0.047) * f.g * (0.6 + 0.4 * n);
  vec4 wv = texture(uWater, suv);
  float W = wv.r, ice = 0.0;
  if (W > 0.02) {
    vec2 e = uFireTexel * 1.5;
    float Wx = texture(uWater, suv + vec2(e.x, 0.)).r - texture(uWater, suv - vec2(e.x, 0.)).r;
    float Wy = texture(uWater, suv + vec2(0., e.y)).r - texture(uWater, suv - vec2(0., e.y)).r;
    float a = smoothstep(0.10, 0.30, W);
    vec3 nrm = normalize(vec3(-vec2(Wx, Wy) * 3.0, 1.0));
    float thick = smoothstep(0.2, 1.3, W);
    float rim = a * (1.0 - smoothstep(0.22, 0.62, W));
    float rp = fbm(w * 26.0 + nrm.xy * 0.7 + vec2(0., uTime * 2.2));
    vec3 body = mix(vec3(0.04, 0.42, 0.78), vec3(0.01, 0.13, 0.42), thick) * (0.45 + 1.0 * rp);
    float spec = pow(max(dot(nrm, normalize(vec3(-0.45, 0.65, 1.6))), 0.0), 56.0);
    vec3 wc = body + vec3(0.30, 0.80, 1.0) * rim * 0.75 + vec3(1.0) * spec * 1.5 * a;
    wc += col * 0.6; // firelight caught in the water
    float aw = a * 0.92;
    ice = clamp(wv.g / max(W, 1e-3), 0., 1.);
    if (ice > 0.004 || uFuse.y > 0.001) {
      // ice: faceted, a frosted rim, edges between facets, and facets that flash as they catch the light
      vec3 vr = voro(w * 30.0 + nrm.xy * 0.5);
      vec2 tilt = vec2(hash12(vec2(vr.z * 91.7, 3.1)), hash12(vec2(vr.z * 57.3, 8.3))) - 0.5;
      vec3 fn = normalize(vec3(-vec2(Wx, Wy) * 2.4 + tilt * 1.1, 1.0));
      float lit = max(dot(fn, normalize(vec3(-0.45, 0.65, 1.6))), 0.0);
      float ia = smoothstep(0.07, 0.22, W);
      float ith = smoothstep(0.18, 0.9, W);
      vec3 ic = mix(vec3(0.20, 0.46, 0.70), vec3(0.025, 0.09, 0.26), ith) * (0.25 + 1.3 * lit * lit * lit);
      float edge = 1.0 - smoothstep(0.0, 0.06, vr.y);
      ic += vec3(0.40, 0.72, 1.0) * edge * (0.10 + 0.25 * (1.0 - ith));
      float irim = ia * (1.0 - smoothstep(0.12, 0.34, W));
      ic += vec3(0.75, 0.90, 1.0) * irim * (0.35 + 0.9 * vnoise(w * 120.0));
      float tw = hash12(vec2(vr.z * 113.0, floor(uTime * 6.0 + vr.z * 17.0)));
      float glint = smoothstep(0.9, 1.0, tw) * (1.0 - smoothstep(0.0, 0.2, vr.x));
      ic += vec3(1.0) * (pow(lit, 40.0) * 1.4 + glint * 3.0) * ia;
      ic += col * 0.3;
      if (uFuse.y > 0.001) {
        // prism: firelight split into a spectrum by the facets
        vec3 sp = hue2rgb(fract(vr.z * 0.6 + dot(fn.xy, vec2(1.6, 1.1)) + w.y * 1.4 - uTime * 0.12));
        float fl = 0.35 + 1.4 * min(f.r, 1.5) + 0.5 * uGlow;
        ic = mix(ic, ic * 0.35 + sp * (0.3 + 1.1 * edge + 2.5 * glint + 0.7 * irim) * fl, uFuse.y);
        wc = mix(wc, wc * 0.4 + sp * (0.3 + 0.9 * rim + spec) * fl, uFuse.y);
      }
      wc = mix(wc, ic, ice);
      aw = mix(aw, ia * 0.96, ice);
    }
    if (uFuse.z > 0.001) wc = mix(wc, wc * vec3(0.22, 0.26, 0.40) + vec3(0.01, 0.015, 0.035), uFuse.z);
    col = mix(col, wc, aw);
    if (uFuse.z > 0.001) {
      // storm: dark, heavy water (it swallows the plasma glow) with lightning flickering inside it
      col *= 1.0 - 0.6 * uFuse.z * smoothstep(0.05, 0.4, W);
      float slot = floor(uTime * 9.0);
      float on = step(0.55, hash12(vec2(slot, 4.1)));
      float br = 1.0 - abs(2.0 * vnoise(w * vec2(9.0, 4.0) + slot * 7.31) - 1.0);
      float flash = pow(vnoise(vec2(uTime * 7.0, 2.3)), 5.0);
      col += vec3(0.70, 0.62, 1.0) * (pow(br, 26.0) * on * 3.5 + flash * 0.6) * a * uFuse.z;
    }
  }
  // fire inside ice: a white-hot hissing front where the two eat each other
  float clash = min(f.r, 2.0) * min(wv.g, 2.0);
  // (damped during a fusion, where the two are meant to be one body rather than a fight)
  if (clash > 0.01) col += vec3(1.0, 0.93, 0.86) * smoothstep(0.02, 1.0, clash) * 1.3 * (1.0 - 0.75 * min(1.0, dot(uFuse, vec4(1.0))));
  float mist = wv.b, steam = wv.a;
  if (mist > 0.003) {
    float m2 = vnoise(w * vec2(4.0, 9.0) + vec2(uTime * 0.21, uTime * 0.07));
    float ma = (1.0 - exp(-mist * 1.2)) * (0.3 + 0.7 * m2);
    col += vec3(0.24, 0.36, 0.50) * ma * 0.5 * (1.0 - uFuse.w);
    if (uFuse.w > 0.001) {
      // aurora: slow curtains, green near their source, violet where they thin out above
      float cx = w.x * 6.0 + 0.9 * sin(w.y * 2.6 + uTime * 0.35);
      float cur = vnoise(vec2(cx, w.y * 0.5 - uTime * 0.1));
      cur = cur * cur * (0.55 + 0.45 * vnoise(vec2(cx * 3.3, w.y * 1.5 - uTime * 0.4)));
      float rays = 0.55 + 0.45 * vnoise(vec2(w.x * 70.0 + 3.0 * sin(w.y * 3.0 + uTime * 0.2), w.y * 1.2 - uTime * 0.6));
      vec3 ac = mix(vec3(0.62, 0.18, 1.0), vec3(0.12, 1.0, 0.5), smoothstep(0.08, 0.9, mist));
      col += ac * (1.0 - exp(-mist * 1.6)) * (0.25 + 1.8 * cur) * rays * 0.9 * uFuse.w;
    }
  }
  if (steam > 0.003) {
    float sa = (1.0 - exp(-steam * 1.4)) * (0.45 + 0.55 * n);
    vec3 sc = vec3(0.80, 0.84, 0.88) + col * 0.5;
    sc += vec3(1.0, 0.97, 0.92) * uFuse.x * (0.5 + 0.9 * n); // luminous in a steam fusion
    col = mix(col, sc, sa * 0.8);
  }
  if (uFuse.x > 0.001) {
    // steam fusion: the shared body glows as soft white vapour where the two fields meet
    float ov = (1.0 - exp(-(min(f.r, 2.0) * 1.2 + steam * 0.8))) * smoothstep(0.02, 0.4, W + steam);
    vec3 vc = vec3(1.0, 0.95, 0.9) * (0.55 + 0.9 * n) * (0.7 + 0.5 * min(T, 1.5));
    col = mix(col, vc, ov * uFuse.x * 0.75);
  }
  return col;
}
void main(){
  vec2 uv = vUv;
  vec3 col;
  if (uv.y < uFloor) {
    // the pool, seen in perspective: d = 0 at the horizon, 1 at the bottom of the frame
    float d = (uFloor - uv.y) / uFloor;
    float Z = (1.0 - d) / (1.0 + 2.0 * d);
    float sc = (1.0 + 2.0 * Z) / 3.0;
    vec2 wuv = vec2(0.5 + (uv.x - 0.5) * sc, Z);
    vec4 tR = texture(uWave, wuv + vec2(uWaveTexel.x, 0.)), tL = texture(uWave, wuv - vec2(uWaveTexel.x, 0.));
    vec4 tU = texture(uWave, wuv + vec2(0., uWaveTexel.y)), tD = texture(uWave, wuv - vec2(0., uWaveTexel.y));
    float hx = tR.x - tL.x, hz = tU.x - tD.x;
    float frs = min(0.25 * (tR.z + tL.z + tU.z + tD.z), 1.0);
    vec2 slope = clamp(vec2(hx / (2.0 * uCell.x), hz / (2.0 * uCell.y)), vec2(-1.6), vec2(1.6));
    vec2 wp = vec2((wuv.x - 0.5) * uAspect, Z * 1.3);
    // a breath of wind, so the pool is never glass
    slope += (vec2(vnoise(wp * 19.0 + uTime * 0.5), vnoise(wp * 19.0 + 9.7 - uTime * 0.4)) - 0.5) * 0.05;
    slope *= 1.0 - 0.8 * frs;
    vec2 suv = vec2(uv.x + slope.x * 0.03, uFloor + (uFloor - uv.y) * 1.25 + slope.y * 0.085 * (0.25 + d));
    suv.y = max(suv.y, uFloor + 0.002);
    vec3 refl = air(suv);
    float fres = mix(0.10, 0.74, pow(1.0 - d, 2.2)) * (1.0 - 0.6 * frs);
    vec3 deep = vec3(0.003, 0.010, 0.019) * (1.0 - 0.5 * d);
    col = deep + refl * fres;
    float crest = smoothstep(0.03, 0.6, abs(slope.y) + abs(slope.x) * 0.5);
    col += (vec3(0.022, 0.04, 0.06) + vec3(0.15, 0.07, 0.035) * uGlow) * crest * (0.3 + 0.7 * (1.0 - d));
    col += vec3(0.05, 0.022, 0.01) * uGlow * exp(-d * 9.0);
    if (frs > 0.003) {
      // frost: a pale, dull crust with feathery veins and the odd glint
      float fa = smoothstep(0.0, 0.7, frs);
      float vein = 1.0 - abs(2.0 * vnoise(wp * 55.0) - 1.0);
      float vein2 = 1.0 - abs(2.0 * vnoise(wp * 140.0 + 3.7) - 1.0);
      vec3 fc = vec3(0.17, 0.22, 0.29) * (0.6 + 0.7 * vnoise(wp * 18.0))
              + vec3(0.45, 0.60, 0.75) * (pow(vein, 5.0) * 0.6 + pow(vein2, 7.0) * 0.4);
      fc += vec3(0.12, 0.06, 0.03) * uGlow * 0.6 + refl * 0.2;
      float gh = hash12(floor(wp * 110.0) + floor(uTime * 5.0) * 1.7);
      fc += vec3(0.85, 0.93, 1.0) * step(0.985, gh) * 1.6;
      col = mix(col, fc, fa * 0.88);
    }
  } else {
    vec2 c = vec2((uv.x - 0.5) * uAspect, uv.y - uFloor);
    vec3 bg = mix(vec3(0.010, 0.011, 0.020), vec3(0.022, 0.013, 0.024), smoothstep(0.0, 1.0, uv.y));
    bg += vec3(0.085, 0.032, 0.012) * uGlow * exp(-dot(c * vec2(0.9, 1.5), c * vec2(0.9, 1.5)) * 2.4);
    col = air(uv) + bg;
    col += vec3(0.06, 0.028, 0.014) * (0.4 + uGlow) * exp(-(uv.y - uFloor) * 240.0);
  }
  o = vec4(col, 1.);
}`;

const FS_PREFILTER = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec3 c = texture(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture(uTex, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture(uTex, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(0.12, 0.9, l);
  o = vec4(min(c * k, vec3(12.)), 1.);
}`;

const FS_DOWN = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec3 c = texture(uTex, vUv).rgb * 4.0;
  c += texture(uTex, vUv + uTexel * vec2(-1., -1.)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1., -1.)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(-1., 1.)).rgb;
  c += texture(uTex, vUv + uTexel * vec2(1., 1.)).rgb;
  o = vec4(c / 8.0, 1.);
}`;

const FS_UP = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec3 c = texture(uTex, vUv + uTexel * vec2(-1., 0.)).rgb + texture(uTex, vUv + uTexel * vec2(1., 0.)).rgb
         + texture(uTex, vUv + uTexel * vec2(0., -1.)).rgb + texture(uTex, vUv + uTexel * vec2(0., 1.)).rgb;
  c += 0.5 * (texture(uTex, vUv + uTexel * vec2(-1., -1.)).rgb + texture(uTex, vUv + uTexel * vec2(1., -1.)).rgb
            + texture(uTex, vUv + uTexel * vec2(-1., 1.)).rgb + texture(uTex, vUv + uTexel * vec2(1., 1.)).rgb);
  o = vec4(c / 6.0, 1.);
}`;

const FS_FINAL = HEAD + NOISE + `
uniform sampler2D uScene, uBloom;
uniform float uTime, uExposure, uBloomK, uFlash, uZoom, uChroma, uHurt;
uniform vec2 uShake, uRes, uZoomC;
uniform vec3 uHurtCol;
void main(){
  vec2 uv = uZoomC + (vUv + uShake - uZoomC) / uZoom;
  vec3 c;
  if (uChroma > 0.001) {
    // a chromatic split that grows toward the edges
    vec2 k = (uv - 0.5) * uChroma * 0.022;
    c = vec3(texture(uScene, uv + k).r, texture(uScene, uv).g, texture(uScene, uv - k).b);
  } else c = texture(uScene, uv).rgb;
  vec3 b = texture(uBloom, uv).rgb;
  c += b * uBloomK;
  c *= uExposure * (1.0 + uFlash * 0.9);
  c += vec3(1.0, 0.7, 0.42) * uFlash * 0.02;
  vec2 q = (vUv - 0.5) * vec2(1.05, 1.0);
  c *= 1.0 - 0.55 * pow(length(q) * 1.28, 2.4);
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  c = pow(clamp(c, 0., 1.), vec3(1.0 / 2.2));
  if (uHurt > 0.001) {
    // a soft damage vignette that licks in from the edges
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p * vec2(1.0, 0.92));
    float wob = vnoise(p * 3.5 + vec2(uTime * 0.7, -uTime * 1.1)) * 0.35 + vnoise(p * 9.0 - uTime * 1.9) * 0.15;
    float m = smoothstep(0.95 - 0.2 * uHurt, 1.5, r + wob * 0.5) * uHurt;
    c = mix(c, uHurtCol, clamp(m, 0., 1.) * 0.6);
    c += uHurtCol * m * 0.08;
  }
  c += (hash12(vUv * uRes + fract(uTime) * 91.7) - 0.5) * 0.022;
  o = vec4(c, 1.);
}`;

// Lightning arcs: thin additive capsules drawn straight into the scene (so they feed the bloom).
const VS_ARC = `#version 300 es
precision highp float;
layout(location=0) in vec4 iAB;
layout(location=1) in vec2 iWI; // width, intensity
uniform float uAspect;
out vec2 vW; out vec4 vAB; out vec2 vWI;
const vec2 C[6] = vec2[6](vec2(0,-1), vec2(1,-1), vec2(1,1), vec2(0,-1), vec2(1,1), vec2(0,1));
void main(){
  vec2 c = C[gl_VertexID];
  vec2 a = iAB.xy, b = iAB.zw, ab = b - a; float len = length(ab);
  vec2 ax = len > 1e-6 ? ab / len : vec2(1., 0.), n = vec2(-ax.y, ax.x);
  float pad = iWI.x * 9.0;
  vec2 w = a + ax * (c.x * len + (c.x * 2.0 - 1.0) * pad) + n * c.y * pad;
  vW = w; vAB = iAB; vWI = iWI;
  gl_Position = vec4(w.x / (0.5 * uAspect), w.y * 2.0 - 1.0, 0., 1.);
}`;

const FS_ARC = `#version 300 es
precision highp float;
in vec2 vW; in vec4 vAB; in vec2 vWI;
out vec4 o;
void main(){
  vec2 pa = vW - vAB.xy, ba = vAB.zw - vAB.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-10), 0., 1.);
  float d = length(pa - ba * h) / vWI.x;
  float core = exp(-d * d * 1.5);
  float glow = exp(-d * 0.55);
  vec3 col = vec3(1.0, 0.92, 1.0) * core * 2.6 + vec3(0.55, 0.22, 1.0) * glow * 0.35;
  o = vec4(col * vWI.y, 1.0);
}`;

export class Fire {
  constructor(canvas, tier = 'high') {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('This browser has no WebGL2.');
    this.gl = gl;
    const f32 = gl.getExtension('EXT_color_buffer_float');
    const f16 = gl.getExtension('EXT_color_buffer_half_float');
    if (!f32 && !f16) throw new Error('This device cannot render to float textures.');
    this.emberFloat32 = !!f32;
    this.tierName = tier;
    this.tier = TIERS[tier];
    this.inst = new Float32Array(MAX_INST * INST_FLOATS);
    this.nInst = 0;
    this.em = new Float32Array(MAX_EM * 4);
    this.emKind = new Float32Array(MAX_EM);
    this.nEm = 0;
    this.drops = new Float32Array(MAX_DROPS * 4);
    this.nDrops = 0;
    this.frosts = new Float32Array(MAX_FROST * 4);
    this.nFrost = 0;
    this.arcs = new Float32Array(MAX_ARC_SEGS * ARC_FLOATS);
    this.nArcSeg = 0; this.nArcs = 0;
    this.bodies = []; // filled by noteBody() each frame (emitDancer calls it), used by the fusion looks
    // look.ice / look.plasma 0..1 morph water toward ice and fire toward plasma (animate freely).
    // look.fusion = { kind: 'steam'|'prism'|'storm'|'aurora'|null, amount: 0..1 }.
    this.look = { ice: 0, plasma: 0, fusion: null };
    this.params = { buoy: 2.4, turb: 2.2, curl: 26, damp: 0.9, cool0: 0.55, cool1: 3.2, cool2: 0.3, soot: 0.2, smokeDecay: 1.2, grav: 4.2, waterDecay: 2.0, waveC: 0.6, waveDamp: 0.75, waveLine: 5.0,
      // ice: barely falls, lingers, melts slower than water, sheds cold mist
      iceGrav: 0.25, iceDecay: 3.4, iceMelt: 2.6, iceThaw: 1.6, iceSwallow: 5.0,
      mistDecay: 0.8, mistRate: 0.45, mistSink: 0.6,
      steamDecay: 0.9, steamGain: 1.4, steamQ: 2.2, steamBuoy: 3.2,
      plasmaCool: 1.4,
      frostLife: 3.0, frostRate: 4.0, frostMelt: 5.0, frostDamp: 14, frostDiff: 2.0 };
    this._build();
    this.resize(true);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._build(); this.resize(true); });
  }

  _compile(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log, '\n', src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
        throw new Error('Shader compile failed: ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  _build() {
    const gl = this.gl;
    this.P = {
      curl: this._compile(VERT, FS_CURL), vort: this._compile(VERT, FS_VORT),
      advVel: this._compile(VERT, FS_ADVECT_VEL), div: this._compile(VERT, FS_DIV),
      pressure: this._compile(VERT, FS_PRESSURE), grad: this._compile(VERT, FS_GRAD),
      scale: this._compile(VERT, FS_SCALE), advFire: this._compile(VERT, FS_ADVECT_FIRE),
      advWater: this._compile(VERT, FS_ADVECT_WATER), wave: this._compile(VERT, FS_WAVE),
      splat: this._compile(VS_SPLAT, FS_SPLAT),
      emberUp: this._compile(VERT, FS_EMBER_UPDATE), ember: this._compile(VS_EMBER, FS_EMBER),
      scene: this._compile(VERT, FS_SCENE), prefilter: this._compile(VERT, FS_PREFILTER),
      down: this._compile(VERT, FS_DOWN), up: this._compile(VERT, FS_UP), final: this._compile(VERT, FS_FINAL),
      arc: this._compile(VS_ARC, FS_ARC),
    };
    this.arcVao = gl.createVertexArray();
    this.arcBuf = gl.createBuffer();
    gl.bindVertexArray(this.arcVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arcBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.arcs.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, ARC_FLOATS * 4, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, ARC_FLOATS * 4, 16); gl.vertexAttribDivisor(1, 1);
    this.emptyVao = gl.createVertexArray();
    this.instVao = gl.createVertexArray();
    this.instBuf = gl.createBuffer();
    gl.bindVertexArray(this.instVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    const stride = INST_FLOATS * 4;
    const attr = (loc, size, off) => {
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(0, 2, 0); attr(1, 2, 2); attr(2, 2, 4); attr(3, 2, 6); attr(4, 4, 8); attr(5, 2, 12);
    gl.bindVertexArray(this.emptyVao);
    this.targets = null;
  }

  _target(w, h, internal, format, type, filter) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h };
  }

  _double(w, h, internal, format, type, filter) {
    const a = this._target(w, h, internal, format, type, filter);
    const b = this._target(w, h, internal, format, type, filter);
    return { read: a, write: b, w, h, swap() { const t = this.read; this.read = this.write; this.write = t; } };
  }

  _free() {
    if (!this.targets) return;
    const gl = this.gl;
    const kill = t => { if (!t) return; if (t.read) { kill(t.read); kill(t.write); return; } gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); };
    for (const k in this.targets) { const t = this.targets[k]; if (Array.isArray(t)) t.forEach(kill); else kill(t); }
    this.targets = null;
  }

  setTier(name) {
    if (!TIERS[name] || name === this.tierName) return;
    this.tierName = name; this.tier = TIERS[name];
    this.resize(true);
  }

  lowerTier() {
    const i = TIER_ORDER.indexOf(this.tierName);
    if (i < TIER_ORDER.length - 1) { this.setTier(TIER_ORDER[i + 1]); return true; }
    return false;
  }

  resize(force = false) {
    const gl = this.gl, c = this.canvas;
    const cw = Math.max(1, c.clientWidth), ch = Math.max(1, c.clientHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    const px = w * h;
    if (px > this.tier.maxPx) { const k = Math.sqrt(this.tier.maxPx / px); w = Math.round(w * k); h = Math.round(h * k); }
    if (!force && w === c.width && h === c.height) return;
    c.width = w; c.height = h;
    this.aspect = w / h;
    this._free();
    const short = (base) => this.aspect >= 1 ? [Math.round(base * this.aspect), base] : [base, Math.round(base / this.aspect)];
    const [sw, sh] = short(this.tier.sim);
    const [fw, fh] = short(this.tier.fire);
    const HF = gl.HALF_FLOAT, L = gl.LINEAR, N = gl.NEAREST;
    const T = this.targets = {};
    T.vel = this._double(sw, sh, gl.RG16F, gl.RG, HF, L);
    T.pressure = this._double(sw, sh, gl.R16F, gl.RED, HF, N);
    T.div = this._target(sw, sh, gl.R16F, gl.RED, HF, N);
    T.curl = this._target(sw, sh, gl.R16F, gl.RED, HF, N);
    T.fire = this._double(fw, fh, gl.RGBA16F, gl.RGBA, HF, L);
    T.water = this._double(fw, fh, gl.RGBA16F, gl.RGBA, HF, L); // amount, ice, mist, steam
    T.wave = this._double(WAVE_W, WAVE_H, gl.RGBA16F, gl.RGBA, HF, L); // height, velocity, frost
    const en = this.tier.embers;
    T.embers = this.emberFloat32
      ? this._double(en, en, gl.RGBA32F, gl.RGBA, gl.FLOAT, N)
      : this._double(en, en, gl.RGBA16F, gl.RGBA, HF, N);
    T.scene = this._target(w, h, gl.RGBA16F, gl.RGBA, HF, L);
    T.bloom = [];
    let bw = w >> 1, bh = h >> 1;
    for (let i = 0; i < 6 && bw >= 8 && bh >= 8; i++) { T.bloom.push(this._target(bw, bh, gl.RGBA16F, gl.RGBA, HF, L)); bw >>= 1; bh >>= 1; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- emitters (world units) ---
  seg(ax, ay, bx, by, vax, vay, vbx, vby, r, heat, cx = 0, cy = 0, seed = 0, water = false) {
    if (this.nInst >= MAX_INST) return;
    const o = this.nInst++ * INST_FLOATS, d = this.inst;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = bx; d[o + 3] = by; d[o + 4] = vax; d[o + 5] = vay; d[o + 6] = vbx; d[o + 7] = vby;
    let m = matterOf(water);
    if (m === 4) { m = 0; cx = PLASMA_CH[0]; cy = PLASMA_CH[1]; }
    d[o + 8] = r; d[o + 9] = heat; d[o + 10] = m * 2; d[o + 11] = seed; d[o + 12] = cx; d[o + 13] = cy;
  }

  burst(x, y, r, strength, heat, cx = 0, cy = 0, lift = 0, water = false, width = 0) {
    if (this.nInst >= MAX_INST) return;
    const o = this.nInst++ * INST_FLOATS, d = this.inst;
    d[o] = x; d[o + 1] = y; d[o + 2] = x; d[o + 3] = y; d[o + 4] = strength; d[o + 5] = lift; d[o + 6] = width; d[o + 7] = 0;
    let m = matterOf(water);
    if (m === 4) { m = 0; cx = PLASMA_CH[0]; cy = PLASMA_CH[1]; }
    d[o + 8] = r; d[o + 9] = heat; d[o + 10] = m * 2 + 1; d[o + 11] = Math.random(); d[o + 12] = cx; d[o + 13] = cy;
  }

  // Frost on the pool around world x; spreads toward the viewer. amount is added at once (see top).
  frost(x, radius, amount, z = POOL_Z) {
    if (this.nFrost >= MAX_FROST || !(radius > 0)) return;
    const o = this.nFrost++ * 4;
    this.frosts[o] = x; this.frosts[o + 1] = z; this.frosts[o + 2] = radius; this.frosts[o + 3] = amount;
  }

  // A jagged, branching lightning arc between two world points, for this frame only (call per frame;
  // it re-forks every frame, which is the flicker). intensity ~0.3 faint .. 1 normal .. 2 a big strike.
  arc(x0, y0, x1, y1, intensity = 1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (this.nArcs >= MAX_ARCS || !(intensity > 0) || !(len > 1e-4) || !isFinite(len)) return;
    this.nArcs++;
    const w = (0.0011 + 0.0007 * Math.min(intensity, 2)) * Math.min(1, 0.4 + len * 3);
    const tip = this._bolt(x0, y0, dx, dy, len, len > 0.08 ? 16 : 8, 0.22, w, intensity);
    // forks: shorter, thinner, off at an angle
    const forks = len > 0.1 ? 1 + (Math.random() < 0.6) : len > 0.04 ? (Math.random() < 0.5 ? 1 : 0) : 0;
    for (let f = 0; f < forks; f++) {
      const k = 1 + Math.floor(Math.random() * (tip.length - 2)), p = tip[k - 1];
      const t = k / tip.length, bx = x0 + dx * t + p[0], by = y0 + dy * t + p[1];
      const ang = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * (0.4 + 0.6 * Math.random());
      const bl = len * (0.18 + 0.25 * Math.random());
      this._bolt(bx, by, Math.cos(ang) * bl, Math.sin(ang) * bl, bl, 6, 0.3, w * 0.6, intensity * 0.6, true);
    }
    // a faint afterglow in the fire field, so the arc lights the air and shows in the pool
    this.seg(x0, y0, x1, y1, 0, 0, 0, 0, 0.005, 3 * Math.min(intensity, 2), PLASMA_CH[0], PLASMA_CH[1], 5.3);
  }

  // midpoint displacement along A->A+d, pinned at both ends (or free at the far end for a fork)
  _bolt(x0, y0, dx, dy, len, N, rough, w, I, freeEnd = false) {
    const off = this._boltOff || (this._boltOff = new Float32Array(17));
    off.fill(0);
    if (freeEnd) off[N] = (Math.random() - 0.5) * len * rough * 2;
    for (let step = N >> 1; step >= 1; step >>= 1) {
      const amp = len * rough * step / N;
      for (let i = step; i < N; i += step * 2) off[i] = (off[i - step] + off[i + step]) * 0.5 + (Math.random() - 0.5) * 2 * amp;
    }
    const nx = -dy / len, ny = dx / len, pts = [];
    let px = x0, py = y0;
    for (let i = 1; i <= N; i++) {
      const t = i / N, qx = x0 + dx * t + nx * off[i], qy = y0 + dy * t + ny * off[i];
      pts.push([nx * off[i], ny * off[i]]);
      if (this.nArcSeg < MAX_ARC_SEGS) {
        const o = this.nArcSeg++ * ARC_FLOATS, a = this.arcs;
        a[o] = px; a[o + 1] = py; a[o + 2] = qx; a[o + 3] = qy; a[o + 4] = w * (freeEnd ? 1 - 0.6 * t : 1); a[o + 5] = I;
      }
      px = qx; py = qy;
    }
    return pts;
  }

  // Tells the renderer where a body is this frame (emitDancer calls it), for the fusion looks.
  noteBody(x, y, r, element = 0) {
    if (this.bodies.length < 8) this.bodies.push({ x, y, r, element });
  }

  // A disturbance in the pool. x in world units, z in 0..1 (1 = horizon).
  ripple(x, z, r, strength) {
    if (this.nDrops >= MAX_DROPS) return;
    const o = this.nDrops++ * 4;
    this.drops[o] = x; this.drops[o + 1] = z; this.drops[o + 2] = r; this.drops[o + 3] = strength;
  }

  ember(x, y, radius, rate, water = false) {
    if (this.nEm >= MAX_EM) return;
    let m = matterOf(water);
    if (m === 1 && this.look.ice > 0 && Math.random() < this.look.ice) m = 2; // water turning to ice sheds ice dust
    else if (m === 0 && this.look.plasma > 0 && Math.random() < this.look.plasma) m = 4; // and fire to plasma, sparks
    this.emKind[this.nEm] = m;
    const o = this.nEm++ * 4;
    this.em[o] = x; this.em[o + 1] = y; this.em[o + 2] = radius; this.em[o + 3] = rate;
  }

  _quad(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    if (target) gl.viewport(0, 0, target.w, target.h); else gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _tex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit);
  }

  _splats(target, which, dt, time) {
    const gl = this.gl, S = this.P.splat;
    if (!this.nInst) return;
    gl.useProgram(S.p);
    gl.bindVertexArray(this.instVao);
    gl.uniform1f(S.u.uAspect, this.aspect);
    gl.uniform1f(S.u.uRadK, which === 0 ? 1.45 : 1.0);
    gl.uniform1i(S.u.uTarget, which);
    gl.uniform1f(S.u.uDt, dt);
    gl.uniform1f(S.u.uTime, time);
    gl.uniform1f(S.u.uVelK, 1.0 - Math.exp(-dt * 22.0));
    gl.uniform1f(S.u.uLookIce, clamp01(this.look.ice));
    gl.uniform1f(S.u.uLookPlasma, clamp01(this.look.plasma));
    gl.uniform2f(S.u.uPlasmaCh, PLASMA_CH[0], PLASMA_CH[1]);
    gl.enable(gl.BLEND);
    if (which === 0) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.nInst);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
  }

  // fusion amounts [steam, prism, storm, aurora] from look.fusion
  _fuse() {
    const F = this._fv || (this._fv = new Float32Array(4)), fu = this.look.fusion;
    F.fill(0);
    const i = fu && FUSION_KINDS[fu.kind];
    if (i != null) F[i] = clamp01(fu.amount ?? 1);
    return F;
  }

  // what a fusion does on its own: storm rain and lightning, steam sparks, aurora ice dust
  _fusionFx(F, dt) {
    if (!(F[0] + F[1] + F[2] + F[3] > 0) || !this.bodies.length) return;
    let x = 0, y = 0, r = 0;
    for (const b of this.bodies) { x += b.x; y += b.y; r = Math.max(r, b.r); }
    x /= this.bodies.length; y /= this.bodies.length;
    if (F[2] > 0) {
      this.ember(x, y + r * 0.9, r * 1.3, 2600 * F[2], MATTER.water);
      if (Math.random() < dt * 9 * F[2]) {
        const a = Math.random() * 6.283, b = a + 2 + Math.random() * 2.3, rr = r * (0.5 + 0.5 * Math.random());
        this.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, x + Math.cos(b) * rr, y + Math.sin(b) * rr, 0.6 + 0.8 * F[2]);
      }
    }
    if (F[0] > 0) this.ember(x, y, r * 0.8, 900 * F[0], MATTER.steam);
    if (F[1] > 0) this.ember(x, y, r * 0.9, 700 * F[1], MATTER.ice);
    if (F[3] > 0) this.ember(x, y + r * 0.4, r, 600 * F[3], MATTER.ice);
  }

  step(dt, time) {
    if (this.lost) { this.nInst = 0; this.nEm = 0; this.nDrops = 0; this.nFrost = 0; this.nArcs = 0; this.nArcSeg = 0; this.bodies.length = 0; return; }
    const gl = this.gl, T = this.targets, P = this.P, pr = this.params;
    dt = Math.min(dt, 1 / 30);
    const F = this._fuse(), fuseAll = Math.min(1, F[0] + F[1] + F[2] + F[3]);
    this._fusionFx(F, dt);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
    if (this.nInst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst.subarray(0, this.nInst * INST_FLOATS));
    }
    const stx = 1 / T.vel.w, sty = 1 / T.vel.h;

    this._splats(T.vel.read, 0, dt, time);

    gl.useProgram(P.curl.p);
    gl.uniform2f(P.curl.u.uTexel, stx, sty);
    this._tex(0, T.vel.read.tex, P.curl.u.uVel);
    this._quad(T.curl);

    gl.useProgram(P.vort.p);
    gl.uniform2f(P.vort.u.uTexel, stx, sty);
    gl.uniform1f(P.vort.u.uDt, dt);
    gl.uniform1f(P.vort.u.uStrength, pr.curl);
    this._tex(0, T.vel.read.tex, P.vort.u.uVel);
    this._tex(1, T.curl.tex, P.vort.u.uCurl);
    this._quad(T.vel.write); T.vel.swap();

    gl.useProgram(P.advVel.p);
    gl.uniform1f(P.advVel.u.uDt, dt);
    gl.uniform1f(P.advVel.u.uAspect, this.aspect);
    gl.uniform1f(P.advVel.u.uDamp, Math.exp(-dt * pr.damp));
    gl.uniform1f(P.advVel.u.uBuoy, pr.buoy);
    gl.uniform1f(P.advVel.u.uTime, time);
    gl.uniform1f(P.advVel.u.uTurb, pr.turb);
    gl.uniform1f(P.advVel.u.uFloor, FLOOR);
    this._tex(0, T.vel.read.tex, P.advVel.u.uVel);
    gl.uniform1f(P.advVel.u.uGrav, pr.grav * (1 + 0.6 * F[2]));
    gl.uniform1f(P.advVel.u.uIceGrav, pr.iceGrav);
    gl.uniform1f(P.advVel.u.uMistSink, pr.mistSink * (1 - 2.6 * F[3]));
    gl.uniform1f(P.advVel.u.uSteamBuoy, pr.steamBuoy);
    this._tex(1, T.fire.read.tex, P.advVel.u.uFire);
    this._tex(2, T.water.read.tex, P.advVel.u.uWater);
    this._quad(T.vel.write); T.vel.swap();

    gl.useProgram(P.div.p);
    gl.uniform2f(P.div.u.uTexel, stx, sty);
    this._tex(0, T.vel.read.tex, P.div.u.uVel);
    this._quad(T.div);

    gl.useProgram(P.scale.p);
    gl.uniform1f(P.scale.u.uK, 0.7);
    this._tex(0, T.pressure.read.tex, P.scale.u.uTex);
    this._quad(T.pressure.write); T.pressure.swap();

    gl.useProgram(P.pressure.p);
    gl.uniform2f(P.pressure.u.uTexel, stx, sty);
    this._tex(1, T.div.tex, P.pressure.u.uDiv);
    for (let i = 0; i < this.tier.iters; i++) {
      this._tex(0, T.pressure.read.tex, P.pressure.u.uP);
      this._quad(T.pressure.write); T.pressure.swap();
    }

    gl.useProgram(P.grad.p);
    gl.uniform2f(P.grad.u.uTexel, stx, sty);
    this._tex(0, T.pressure.read.tex, P.grad.u.uP);
    this._tex(1, T.vel.read.tex, P.grad.u.uVel);
    this._quad(T.vel.write); T.vel.swap();

    this._splats(T.fire.read, 1, dt, time);
    this._splats(T.water.read, 2, dt, time);

    gl.useProgram(P.advFire.p);
    gl.uniform1f(P.advFire.u.uDt, dt);
    gl.uniform1f(P.advFire.u.uAspect, this.aspect);
    gl.uniform1f(P.advFire.u.uCool0, pr.cool0);
    gl.uniform1f(P.advFire.u.uCool1, pr.cool1);
    gl.uniform1f(P.advFire.u.uCool2, pr.cool2);
    gl.uniform1f(P.advFire.u.uSmokeKeep, Math.exp(-dt * pr.smokeDecay));
    gl.uniform1f(P.advFire.u.uSoot, pr.soot);
    gl.uniform1f(P.advFire.u.uPlasmaCool, pr.plasmaCool);
    gl.uniform1f(P.advFire.u.uCoexist, fuseAll);
    this._tex(0, T.vel.read.tex, P.advFire.u.uVel);
    this._tex(1, T.fire.read.tex, P.advFire.u.uFire);
    this._tex(2, T.water.read.tex, P.advFire.u.uWater);
    this._quad(T.fire.write); T.fire.swap();

    const AW = P.advWater;
    gl.useProgram(AW.p);
    gl.uniform1f(AW.u.uDt, dt);
    gl.uniform1f(AW.u.uAspect, this.aspect);
    gl.uniform1f(AW.u.uKeep, Math.exp(-dt * pr.waterDecay));
    gl.uniform1f(AW.u.uFloor, FLOOR);
    gl.uniform1f(AW.u.uIceKeep, Math.exp(-dt * pr.iceDecay));
    gl.uniform1f(AW.u.uIceMelt, pr.iceMelt);
    gl.uniform1f(AW.u.uThaw, pr.iceThaw);
    gl.uniform1f(AW.u.uIceSwallow, pr.iceSwallow);
    gl.uniform1f(AW.u.uMistKeep, Math.exp(-dt * pr.mistDecay * (1 - 0.5 * F[3])));
    gl.uniform1f(AW.u.uMistRate, pr.mistRate * (1 + 4 * F[3]));
    gl.uniform1f(AW.u.uSteamKeep, Math.exp(-dt * pr.steamDecay));
    gl.uniform1f(AW.u.uSteamGain, pr.steamGain);
    gl.uniform1f(AW.u.uSteamQ, pr.steamQ);
    gl.uniform1f(AW.u.uCoexist, fuseAll);
    gl.uniform1f(AW.u.uVapor, 2.5 * F[0]);
    this._tex(0, T.vel.read.tex, AW.u.uVel);
    this._tex(1, T.water.read.tex, AW.u.uWater);
    this._tex(2, T.fire.read.tex, AW.u.uFire);
    this._quad(T.water.write); T.water.swap();

    // the pool: sub-step the wave equation so it stays stable at any frame rate
    const WV = P.wave;
    const cellX = this.aspect / WAVE_W, cellZ = WAVE_ZR / WAVE_H;
    const maxDt = 0.6 / (pr.waveC * Math.sqrt(1 / (cellX * cellX) + 1 / (cellZ * cellZ)));
    const sub = Math.min(8, Math.max(1, Math.ceil(dt / maxDt)));
    gl.useProgram(WV.p);
    gl.uniform2f(WV.u.uTexel, 1 / WAVE_W, 1 / WAVE_H);
    gl.uniform2f(WV.u.uCell, cellX, cellZ);
    gl.uniform1f(WV.u.uDt, dt / sub);
    gl.uniform1f(WV.u.uC2, pr.waveC * pr.waveC);
    gl.uniform1f(WV.u.uDamp, Math.exp(-dt / sub * pr.waveDamp));
    gl.uniform1f(WV.u.uFloor, FLOOR);
    gl.uniform1f(WV.u.uAspect, this.aspect);
    gl.uniform1f(WV.u.uZR, WAVE_ZR);
    gl.uniform1f(WV.u.uPoolZ, POOL_Z);
    gl.uniform1f(WV.u.uLine, pr.waveLine);
    gl.uniform4fv(WV.u.uDrop, this.drops);
    gl.uniform4fv(WV.u.uFrost, this.frosts);
    gl.uniform1f(WV.u.uFrostKeep, Math.exp(-dt / sub / pr.frostLife));
    gl.uniform1f(WV.u.uFrostRate, pr.frostRate);
    gl.uniform1f(WV.u.uFrostMelt, pr.frostMelt);
    gl.uniform1f(WV.u.uFrostDamp, pr.frostDamp);
    gl.uniform1f(WV.u.uFrostDiff, pr.frostDiff);
    this._tex(1, T.water.read.tex, WV.u.uWater);
    this._tex(2, T.fire.read.tex, WV.u.uFire);
    for (let i = 0; i < sub; i++) {
      gl.uniform1i(WV.u.uDropCount, i === 0 ? this.nDrops : 0);
      gl.uniform1i(WV.u.uFrostCount, i === 0 ? this.nFrost : 0);
      this._tex(0, T.wave.read.tex, WV.u.uWave);
      this._quad(T.wave.write); T.wave.swap();
    }

    // embers
    const E = P.emberUp;
    gl.useProgram(E.p);
    gl.uniform1f(E.u.uDt, dt);
    gl.uniform1f(E.u.uTime, time);
    gl.uniform1f(E.u.uAspect, this.aspect);
    gl.uniform1f(E.u.uFloor, FLOOR);
    const total = this.tier.embers * this.tier.embers;
    for (let i = 0; i < this.nEm; i++) this.em[i * 4 + 3] = Math.min(0.5, this.em[i * 4 + 3] * dt / total);
    gl.uniform4fv(E.u.uEm, this.em);
    gl.uniform1fv(E.u.uEmKind, this.emKind);
    gl.uniform1i(E.u.uEmCount, this.nEm);
    this._tex(0, T.embers.read.tex, E.u.uState);
    this._tex(1, T.vel.read.tex, E.u.uVel);
    this._quad(T.embers.write); T.embers.swap();

    this.nInst = 0; this.nEm = 0; this.nDrops = 0; this.nFrost = 0;
  }

  render(time, fx = {}) {
    if (this.lost) { this.nArcs = 0; this.nArcSeg = 0; this.bodies.length = 0; return; }
    const gl = this.gl, T = this.targets, P = this.P;
    const F = this._fuse();
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);

    gl.useProgram(P.scene.p);
    gl.uniform1f(P.scene.u.uAspect, this.aspect);
    gl.uniform1f(P.scene.u.uTime, time);
    gl.uniform1f(P.scene.u.uFloor, FLOOR);
    gl.uniform1f(P.scene.u.uGlow, fx.glow ?? 0.5);
    gl.uniform2f(P.scene.u.uFireTexel, 1 / T.fire.w, 1 / T.fire.h);
    gl.uniform2f(P.scene.u.uWaveTexel, 1 / WAVE_W, 1 / WAVE_H);
    gl.uniform2f(P.scene.u.uCell, this.aspect / WAVE_W, WAVE_ZR / WAVE_H);
    gl.uniform4fv(P.scene.u.uFuse, F);
    this._tex(0, T.fire.read.tex, P.scene.u.uFire);
    this._tex(1, T.water.read.tex, P.scene.u.uWater);
    this._tex(2, T.wave.read.tex, P.scene.u.uWave);
    this._quad(T.scene);

    gl.useProgram(P.ember.p);
    gl.uniform1i(P.ember.u.uN, this.tier.embers);
    gl.uniform1f(P.ember.u.uAspect, this.aspect);
    gl.uniform1f(P.ember.u.uPx, Math.max(1.2, this.canvas.height / 520));
    this._tex(0, T.embers.read.tex, P.ember.u.uState);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.POINTS, 0, this.tier.embers * this.tier.embers);
    if (this.nArcSeg) {
      gl.useProgram(P.arc.p);
      gl.uniform1f(P.arc.u.uAspect, this.aspect);
      gl.bindVertexArray(this.arcVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.arcBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.arcs.subarray(0, this.nArcSeg * ARC_FLOATS));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.nArcSeg);
      gl.bindVertexArray(this.emptyVao);
    }
    this.nArcs = 0; this.nArcSeg = 0; this.bodies.length = 0;
    gl.disable(gl.BLEND);

    const B = T.bloom;
    if (B.length) {
      gl.useProgram(P.prefilter.p);
      gl.uniform2f(P.prefilter.u.uTexel, 1 / T.scene.w, 1 / T.scene.h);
      this._tex(0, T.scene.tex, P.prefilter.u.uTex);
      this._quad(B[0]);
      gl.useProgram(P.down.p);
      for (let i = 1; i < B.length; i++) {
        gl.uniform2f(P.down.u.uTexel, 1 / B[i - 1].w, 1 / B[i - 1].h);
        this._tex(0, B[i - 1].tex, P.down.u.uTex);
        this._quad(B[i]);
      }
      gl.useProgram(P.up.p);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = B.length - 1; i > 0; i--) {
        gl.uniform2f(P.up.u.uTexel, 1 / B[i].w, 1 / B[i].h);
        this._tex(0, B[i].tex, P.up.u.uTex);
        this._quad(B[i - 1]);
      }
      gl.disable(gl.BLEND);
    }

    gl.useProgram(P.final.p);
    gl.uniform1f(P.final.u.uTime, time);
    gl.uniform1f(P.final.u.uExposure, fx.exposure ?? 1.0);
    gl.uniform1f(P.final.u.uBloomK, (fx.bloom ?? 0.55) / Math.max(1, B.length * 0.5));
    gl.uniform1f(P.final.u.uFlash, fx.flash ?? 0);
    gl.uniform2f(P.final.u.uShake, fx.shakeX ?? 0, fx.shakeY ?? 0);
    gl.uniform2f(P.final.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(P.final.u.uZoom, Math.max(0.2, fx.zoom ?? 1));
    gl.uniform2f(P.final.u.uZoomC, fx.zoomX ?? 0.5, fx.zoomY ?? 0.5);
    gl.uniform1f(P.final.u.uChroma, clamp01(fx.chroma ?? 0));
    const hurt = clamp01(fx.hurt ?? 0), hh = clamp01(fx.hurtHue ?? 0);
    gl.uniform1f(P.final.u.uHurt, hurt);
    gl.uniform3f(P.final.u.uHurtCol, 0.95 + (0.32 - 0.95) * hh, 0.2 + (0.66 - 0.2) * hh, 0.05 + (1.0 - 0.05) * hh);
    this._tex(0, T.scene.tex, P.final.u.uScene);
    this._tex(1, B.length ? B[0].tex : T.scene.tex, P.final.u.uBloom);
    this._quad(null);
  }
}

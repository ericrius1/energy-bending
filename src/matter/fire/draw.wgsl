// Flames drawn: each one a soft sprite facing the camera, stretched along its motion (a flame born on a fast limb is
// a streak; a slow one is a tongue standing up on its own buoyancy), its edge eaten by noise that climbs, so many of
// them added together merge into licking tongues with dark gaps. Colour is temperature through the ramp (fire: deep
// red → orange → white-hot; plasma: violet → magenta → white), and where hundreds overlap at the body the sum goes
// white and feeds bloom. Embers are small hot points; plasma's are flickering sparks.
//
// Three entries over the same particles: `fs` adds light (and writes the flame's distance into the scene's alpha with
// a min blend, so the depth of field and the air treat a body of fire as being where it is, not where the wall
// behind it is); `fs_smoke` darkens (premultiplied over, alpha left alone), for wet, dying flames; MIRROR draws the
// copy the geode's polished floor reflects.
#include "weft/frame"
#include "./flame"

@group(1) @binding(0) var<uniform> sim: FireSim;
@group(1) @binding(1) var<storage, read> flames: array<Flame>;
@group(1) @binding(2) var noiseTex: texture_2d<f32>;

override MIRROR: u32 = 0u;
override SMOKE: u32 = 0u;

struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  // temperature, form, life used (0 … 1), smoke
  @location(1) @interpolate(flat) look: vec4f,
  // a random number, ember (1) or flame (0), the view distance, the mirror's fade
  @location(2) @interpolate(flat) info: vec4f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn smokeOf(f: Flame, u: f32) -> f32 {
  // wet flames turn to smoke as they go (dry fire makes none: its smoke would be lost against the dark, and the smoke
  // draw's big sprites cost about a third of the fire's fill; with no wet in the field, every flame is culled here)
  return clamp(f.look.w * (0.3 + 0.9 * u), 0.0, 1.0);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  var o: FOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= sim.count) { return o; }
  let f = flames[ii];
  if (!alive(f)) { return o; }
  let u = clamp(f.age / max(f.life, 1e-3), 0.0, 1.0);
  let form = f.look.x;
  let ember = f.look.z < 0.0;
  let smoke = select(smokeOf(f, u), 0.0, ember);
  if (SMOKE == 1u && smoke < 0.02) { return o; }
  var p = f.pos;
  var v = f.vel;
  var fade = 1.0;
  if (MIRROR == 1u) {
    let below = p.y - sim.body.floorY;
    p.y = sim.body.floorY - below;
    v.y = -v.y;
    fade = sim.reflect * exp(-below * 1.6);
  }
  let size = abs(f.look.z);
  // a flame swells as it rises and cools; plasma stays thin; smoke billows
  var w = size * select(mix(0.55, 1.45, u) * mix(1.0, 0.4, form), 1.0, ember) * (1.0 + smoke * 1.5);
  let speed = length(v);
  let streak = min(speed * sim.stretch * mix(1.0, 2.2, form) * select(1.0, 1.6, ember), 0.18);
  // a streak gets thinner as it gets longer (the same light spread along it), so a fast limb leaves a sheet of thin
  // licks rather than a spray of fat petals
  w = w / (1.0 + select(streak / max(w, 1e-4) * 0.25, 0.0, ember));
  let along = w * select(mix(2.2, 2.6, form), 1.0, ember) + streak * 0.5;
  let dir = select(vec3f(0.0, 1.0, 0.0), v / max(speed, 1e-4), speed > 1e-3);
  let toCam = normalize(frame.camPos - p);
  var ax = dir - toCam * dot(dir, toCam);
  let al = length(ax);
  ax = select(frame.camUp, ax / max(al, 1e-4), al > 0.05);
  let side = normalize(cross(ax, toCam));
  // the streak trails behind the flame, along where it came from
  let centre = p - dir * streak * 0.5;
  let c = CORNERS[vi];
  let wp = centre + ax * (c.y * along) + side * (c.x * w);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  // tongues: a noise in the air, tall and thin, climbing at about a metre a second; where it is low the flames are
  // dim, so a body of thousands of sprites splits into licking tongues with dark gaps between (the 2D original's
  // display noise, in the world instead of on the screen). Embers and plasma don't take it.
  let q = f.pos * vec3f(4.5, 1.25, 4.5) - vec3f(0.0, sim.time * 1.3, 0.0);
  let tn = vnoise(q) * 0.62 + vnoise(q * 2.3 + vec3f(7.1, 3.3, 1.9)) * 0.38;
  let tongue = mix(1.0, 0.08 + 1.6 * smoothstep(0.38, 0.75, tn), sim.tongues);
  // plasma's filaments: ridged noise in the air, finer, stretched up and running fast (threads crawling over the
  // body), so only the flames that sit on a thread are bright: thin white-violet lines, not a glowing ghost
  let pq = f.pos * vec3f(15.0, 6.5, 15.0) + vec3f(sim.time * 1.2, -sim.time * 4.5, 0.0);
  let ra = 1.0 - abs(2.0 * vnoise(pq) - 1.0);
  let rb = 1.0 - abs(2.0 * vnoise(pq * 2.1 + vec3f(-sim.time * 1.8, -sim.time * 6.5, 3.7)) - 1.0);
  let fil = 0.12 + 3.2 * (pow(ra, 8.0) + 0.7 * pow(rb, 10.0));
  let shape = select(mix(tongue, fil, form), 1.0, ember);
  o.look = vec4f(flameT(f) * shape, form, u, smoke);
  o.info = vec4f(rnd(pcg(ii * 747796405u + 1u)), select(0.0, 1.0, ember), dot(p - frame.camPos, frame.camFwd), fade);
  return o;
}

/** the flame's light at a point of its sprite (rgb) and how solid it is there (a) */
fn flameLight(i: FOut) -> vec4f {
  let uv = i.uv;
  let T = i.look.x;
  let form = i.look.y;
  let u = i.look.z;
  let seed = i.info.x;
  let t = sim.time;
  if (i.info.y > 0.5) {
    // an ember: a hot point that twinkles; a spark flickers on and off
    let r2 = dot(uv, uv);
    let k = exp(-r2 * 5.0) * max(0.0, 1.0 - r2);
    let life = 1.0 - u;
    let tw = 0.75 + 0.25 * sin(seed * 91.0 + u * 40.0);
    let ec = mix(vec3f(1.0, 0.22, 0.03), vec3f(1.0, 0.72, 0.32), life * life) * 2.6 * life * tw;
    let on = 0.6 + 0.8 * step(0.5, fract(seed * 97.0 + u * 23.0));
    let sc = mix(vec3f(0.6, 0.25, 1.0), vec3f(1.0, 0.85, 1.0), life) * 2.4 * on;
    return vec4f(mix(ec, sc, form) * k * sim.emberGlow, k);
  }
  // the sprite's body: soft across, a tongue along (narrower towards its tip, which points back along its motion)
  let across = uv.x / mix(1.0, 0.75, 0.5 + 0.5 * uv.y);
  let r2 = across * across + uv.y * uv.y;
  let body = max(0.0, 1.0 - r2);
  let soft = body * body;
  // noise that climbs through the flame: its edge is eaten into tongues and holes
  let nuv = vec2f(uv.x * 0.22, uv.y * 0.32) + vec2f(seed * 7.13, seed * 3.71 + t * 0.9);
  let n = textureSampleLevel(noiseTex, samp_repeat, nuv, 0.0);
  let eaten = clamp(soft * (1.0 + sim.erode) - sim.erode * (1.0 - n.r) * (1.0 - 0.5 * soft), 0.0, 1.0);
  // fire: the display noise of the reference on the temperature, through the warm ramp
  let Tf = max(0.0, T * eaten * (0.66 + 0.68 * n.g) - 0.035);
  let fire = fireRamp(Tf);
  // plasma: a thread of white-hot down the middle of the streak in a violet haze, flickering at ~40 Hz
  let thread = exp(-uv.x * uv.x * 26.0) * smoothstep(1.0, 0.3, abs(uv.y));
  let flick = mix(1.0, 0.6 + 0.8 * rnd(u32(t * 41.0) * 1664525u + u32(seed * 65535.0)), sim.flicker);
  let Tp = clamp(T * (0.3 + 1.2 * thread * (0.6 + 0.8 * n.b)) * flick - 0.03, 0.0, 3.6) * soft;
  let plasma = (plasmaRamp(Tp) * 0.35 + vec3f(0.30, 0.06, 0.55) * 0.5 * smoothstep(0.02, 0.6, T * soft)) * sim.plasmaGlow;
  let col = mix(fire, plasma, form);
  return vec4f(col, mix(eaten, thread * soft, form) * min(T, 1.0));
}

@fragment fn fs(i: FOut) -> @location(0) vec4f {
  let l = flameLight(i);
  // the smoke takes over from the light as a flame goes to smoke
  let rgb = l.rgb * sim.intensity * i.info.w * (1.0 - i.look.w);
  // its distance where it is solid enough to be seen (min-blended into the scene's alpha); elsewhere far away
  let dist = select(1e5, i.info.z, MIRROR == 0u && l.a > 0.25);
  return vec4f(rgb, dist);
}

@fragment fn fs_smoke(i: FOut) -> @location(0) vec4f {
  let uv = i.uv;
  let r2 = dot(uv, uv);
  let body = max(0.0, 1.0 - r2);
  let n = textureSampleLevel(noiseTex, samp_repeat, uv * 0.18 + vec2f(i.info.x * 5.3, i.info.x * 2.9 + sim.time * 0.4), 0.0).r;
  let a = clamp(body * body * (0.45 + 0.55 * n) * i.look.w * sim.smoke * 0.55, 0.0, 1.0) * i.info.w;
  // a warm dark grey, faintly lit by the flame it was
  let c = vec3f(0.055, 0.047, 0.047) + fireRamp(i.look.x * 0.5) * 0.08;
  return vec4f(c * a, a);
}

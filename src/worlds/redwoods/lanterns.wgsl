// The lights of the wood. Paper lanterns (vs, fs): a tall round of washi on bamboo hoops, a dark lacquered lid and foot
// ring, hanging on cords from the low limbs (forest.ts swings them, turns them a little on their cords and lights them
// one by one as the sun goes down). Lit from inside by a candle low in the lantern: the paper glows brightest round
// the flame and dims toward the lid and the foot, the hoops and the panels' seams show dark against it, the flame's own
// hot spot shows through the paper's front, and the paper warms toward orange at its edge (more paper to look through).
// By day just paper in the light. Their halo in the mist (vs_halo, glow phase), their cords (vs_cord). And fireflies
// (vs_fly, fs_fly) once it's dark: warm sparks drifting low over the meadow, each flashing on its own rhythm, many of
// them gathering round the dancers.
#include "weft/frame"
#include "../light"

override AROUND: u32 = 24u;
/** the fireflies from NEAR on live out in the wood beyond the ring (phase 6): fireflies in volume, tier on tier back
 *  into the mist, up to the lowest decks */
override NEAR: u32 = 1000000u;
// rows down a lantern: LID across its lid, then the paper (HOOPS bays of BAY rows), then FOOT across its foot ring
override HOOPS: u32 = 9u;
override BAY: u32 = 4u;
const LID: u32 = 2u;
const FOOT: u32 = 2u;

struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) lat: f32,     // down the paper: 0 at the lid … 1 at the foot; < 0 the lid, > 1 the foot ring
  @location(3) @interpolate(flat) k: u32,
  @location(4) around: f32,  // the angle round it (turning with the lantern)
}

/** the paper's profile at lat (0 lid … 1 foot): radius and height, × the lantern's radius. Taller than round, the paper
 *  pulled in a little at every hoop and bellied out between them */
fn paperAt(lat: f32) -> vec2f {
  let th = mix(0.17, 0.87, lat) * 3.14159265;
  let bay = fract(lat * f32(HOOPS));
  let belly = 0.955 + 0.045 * sin(bay * 3.14159265);
  return vec2f(sin(th) * belly, cos(th) * 1.22);
}

/** where the candle burns, and the lantern's frame: up (towards the cord), and two across it, turned by `spin` */
struct LFrame { up: vec3f, e1: vec3f, e2: vec3f }
fn lanternFrame(k: u32) -> LFrame {
  var f: LFrame;
  let l = worldLight.forest.lamps[k];
  let anchor = worldLight.forest.anchors[k];
  f.up = normalize(anchor.xyz - l.xyz);
  let a0 = normalize(cross(f.up, vec3f(0.0, 0.0, 1.0)));
  let b0 = cross(f.up, a0);
  // each turns slowly on its cord, back and forth
  let spin = rnd(k * 31u + 7u) * 6.2831853 + sin(worldLight.forest.clock.x * 0.21 + f32(k)) * 0.6;
  f.e1 = a0 * cos(spin) + b0 * sin(spin);
  f.e2 = cross(f.up, f.e1);
  return f;
}
fn flameAt(k: u32) -> vec3f {
  let l = worldLight.forest.lamps[k];
  let f = lanternFrame(k);
  return l.xyz - f.up * worldLight.forest.anchors[k].w * 0.32;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let a = f32(quad % AROUND + c.x) / f32(AROUND) * 6.2831853;
  let row = quad / AROUND + c.y;
  let rowQ = quad / AROUND;
  let paperRows = HOOPS * BAY;
  let l = worldLight.forest.lamps[ii];
  let R = worldLight.forest.anchors[ii].w;
  let f = lanternFrame(ii);
  let radial = f.e1 * cos(a) + f.e2 * sin(a);
  let top = paperAt(0.0);
  let bot = paperAt(1.0);
  var rh = vec2f(0.0);
  var n = radial;
  var lat = 0.0;
  // (the part is the quad's, so a quad's corners all agree)
  if (rowQ < LID) {
    // the lid: a shallow lacquered dome over the top hoop
    let u = f32(row) / f32(LID);
    rh = vec2f(top.x * 1.06 * u, top.y + 0.07 * (1.0 - u * u) + 0.015);
    n = f.up;
    lat = -1.0;
  } else if (rowQ < LID + paperRows) {
    lat = f32(row - LID) / f32(paperRows);
    rh = paperAt(lat);
    n = normalize(radial * rh.x + f.up * rh.y * 0.67);
  } else {
    // the foot: a ring under the bottom hoop, open in the middle (seen from below, the light inside)
    let u = f32(row - LID - paperRows) / f32(FOOT);
    rh = vec2f(bot.x * mix(1.05, 0.55, u), bot.y - 0.05 * u);
    n = -f.up;
    lat = 2.0;
  }
  let wp = l.xyz + (radial * rh.x + f.up * rh.y) * R;
  o.wp = wp;
  o.n = n;
  o.lat = lat;
  o.k = ii;
  o.around = a;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs(i: LOut) -> @location(0) vec4f {
  // (the derivatives first, while every pixel of the quad is still here)
  let dLat = fwidth(i.lat);
  let dAround = fwidth(i.around);
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(i.n);
  let l = worldLight.forest.lamps[i.k];
  let R = worldLight.forest.anchors[i.k].w;
  let h = rnd3(i.k * 9u + 2u);
  let L = worldLight.forest.key.xyz;
  let day = worldLight.forest.keyCol.rgb * worldLight.forest.key.w;
  let flame = flameAt(i.k);
  // the lid and the foot ring: dark lacquer, catching the day and, from below, the candle
  if (i.lat < -0.5 || i.lat > 1.5) {
    let lac = vec3f(0.028, 0.012, 0.008);
    let inside = select(0.0, 1.0, i.lat > 1.5) * l.w;
    var c = lac * (woodsAmbient(N) * 2.0 + day * max(dot(N, L), 0.0) * 0.5 + worldLight.forest.lampCol.rgb * inside * 0.6);
    let H = normalize(L + V);
    c += day * pow(max(dot(N, H), 0.0), 40.0) * 0.06;
    return vec4f(sightLit(c), dot(i.wp - frame.camPos, frame.camFwd));
  }
  // each its own paper: cream, warm white, amber, a pale rose
  let paper = array<vec3f, 4>(vec3f(1.0, 0.86, 0.66), vec3f(1.0, 0.93, 0.82), vec3f(1.0, 0.68, 0.38), vec3f(1.0, 0.74, 0.66))[u32(h.x * 3.99)];
  // the bamboo hoops (dark lines where the paper meets them) and the seams of its panels (a doubled strip of paper)
  let hoopD = abs(fract(i.lat * f32(HOOPS) + 0.5) - 0.5) / f32(HOOPS);
  let hw = dLat * 0.9 + 0.0025;
  let hoop = smoothstep(hw + 0.004, 0.003, hoopD);
  let panels = 12.0;
  let seamD = abs(fract(i.around / 6.2831853 * panels + 0.5) - 0.5) / panels * 6.2831853;
  let seam = smoothstep(dAround + 0.012, 0.004, seamD);
  // the paper's fibres and a few darker flecks of bark pulp
  let fib = 0.86 + 0.18 * vnoise(i.wp * vec3f(160.0, 60.0, 160.0) / max(R, 0.1) * 0.2) + 0.08 * (vnoise(i.wp * 420.0) - 0.5);
  // lit from inside: by how near the candle the paper is (brightest round its height, dim at the lid and the foot)
  let toF = i.wp - flame;
  let near = R * R * 0.9 / (dot(toF, toF) + R * R * 0.15);
  // looking through more paper at its edge: dimmer and warmer there
  let cosV = max(abs(dot(N, V)), 0.05);
  let thick = 1.0 / mix(1.0, cosV, 0.8);
  let warm = exp(-(thick - 1.0) * vec3f(0.12, 0.45, 1.1));
  // the flame itself, seen through the front of the paper: a soft hot spot where the view passes near it
  let toEye = normalize(frame.camPos - flame);
  let off = length(cross(i.wp - flame, toEye));
  let front = smoothstep(-0.1, 0.3, dot(i.wp - flame, toEye));
  let hot = (exp(-pow(off / (R * 0.42), 2.0)) * 0.55 + exp(-pow(off / (R * 0.14), 2.0)) * 1.1) * front;
  let glow = l.w * worldLight.forest.lampCol.rgb * 0.62;
  var c = paper * glow * near * warm * fib * (1.0 - 0.55 * hoop) * (1.0 - 0.3 * seam);
  c += glow * vec3f(1.0, 0.82, 0.55) * hot * (1.0 - 0.6 * hoop) * fib;
  // and from outside: paper in the daylight (thin: the sun glows through it from behind too); the hoops darker
  let ndl = dot(N, L);
  let sky = mix(vec3f(luma(woodsAmbient(N))), woodsAmbient(N), 0.4) * 3.0;
  c += paper * 0.6 * (day * (max(ndl, 0.0) + 0.5 * max(-ndl, 0.0)) * leafLight(i.wp) + sky) * fib * (1.0 - 0.5 * hoop) * (1.0 - 0.15 * seam);
  return vec4f(sightLit(c), dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- their halo in the mist

struct HOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
}

/** a soft round glow round each lit lantern, as wide as the mist is thick there (the air pass lights the mist along the
 *  view in closed form; this is the near, tight part of it that the eye reads as the lantern's own halo) */
@vertex fn vs_halo(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  var o: HOut;
  let l = worldLight.forest.lamps[ii];
  let R = worldLight.forest.anchors[ii].w;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  o.uv = c;
  let thick = clamp(mistAt(l.xyz) / max(worldLight.forest.mist.w, 1e-4), 0.0, 2.0);
  o.col = worldLight.forest.lampCol.rgb * l.w * (0.25 + 0.45 * thick);
  // in front of the paper (towards the eye), so the lantern doesn't cut its own halo
  let toEye = normalize(frame.camPos - l.xyz);
  let size = R * 5.5;
  let p = l.xyz + toEye * R * 1.3 + (frame.camRight * c.x + frame.camUp * c.y) * size;
  o.pos = select(frame.viewProj * vec4f(p, 1.0), vec4f(2.0, 2.0, 2.0, 1.0), l.w <= 0.0);
  return o;
}

@fragment fn fs_halo(i: HOut) -> @location(0) vec4f {
  let d = dot(i.uv, i.uv);
  // a bright tight core (the paper's own bloom) inside a wide soft fall
  let k = exp(-d * 9.0) * 0.12 + exp(-d * 3.0) * 0.05 - exp(-3.0) * 0.05;
  return vec4f(i.col * max(k, 0.0), 0.0);
}

// ---------------------------------------------------------------- the cords

struct COut { @builtin(position) pos: vec4f, @location(0) wp: vec3f }

@vertex fn vs_cord(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> COut {
  var o: COut;
  let l = worldLight.forest.lamps[ii];
  let anchor = worldLight.forest.anchors[ii];
  let up = normalize(anchor.xyz - l.xyz);
  let top = l.xyz + up * anchor.w * (paperAt(0.0).y + 0.09);
  let c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi];
  let p = mix(top, anchor.xyz, c.y);
  let across = normalize(cross(up, frame.camPos - p) + vec3f(1e-5, 0.0, 0.0));
  o.wp = p + across * (c.x - 0.5) * 0.008;
  o.pos = frame.viewProj * vec4f(o.wp, 1.0);
  return o;
}

@fragment fn fs_cord(i: COut) -> @location(0) vec4f {
  let c = vec3f(0.03, 0.025, 0.02) * (woodsAmbient(vec3f(0.0, 1.0, 0.0)) * 2.0 + worldLight.forest.keyCol.rgb * worldLight.forest.key.w * 0.15 + lampLight(i.wp, vec3f(0.0, -1.0, 0.0), 1.0) * 0.6);
  return vec4f(c, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- fireflies

struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) bright: f32,
}

@vertex fn vs_fly(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  var o: FOut;
  let h = rnd3(ii * 7u + 1u);
  let h2 = rnd3(ii * 13u + 5u);
  let h3 = rnd3(ii * 17u + 9u);
  let t = worldLight.forest.clock.x;
  // a home over the meadow (most low among the flowers), and a slow wander round it
  let r = 1.2 + (worldLight.forest.clock.w - 1.5) * sqrt(h.x);
  let a = h.y * 6.2831853;
  var home = vec3f(cos(a) * r, 0.12 + 2.4 * h.z * h.z, sin(a) * r);
  var wander = 0.9;
  let deep = ii >= NEAR;
  if (deep) {
    let rd = worldLight.forest.clock.w + 1.5 + 34.0 * sqrt(h.x);
    home = vec3f(cos(a) * rd, 0.3 + 7.5 * pow(h.z, 1.6), sin(a) * rd);
    wander = 1.8;
  }
  // a third of them are drawn to a dancer near their home: they gather round it, circling at arm's length, low
  let n = u32(worldLight.forest.near.w);
  if (n > 0u && h3.x < 0.36 && !deep) {
    let d = worldLight.forest.dancers[ii % n];
    let pull = smoothstep(8.0, 2.5, length(d.xz - home.xz)) * d.w;
    let ang = h3.y * 6.2831853 + t * (0.25 + 0.35 * h3.z) * select(-1.0, 1.0, h3.z > 0.5);
    let ring = 0.55 + 1.1 * h3.z;
    let circling = vec3f(d.x + cos(ang) * ring, mix(0.2, 1.9, h.z), d.z + sin(ang) * ring);
    home = mix(home, circling, pull);
    wander = mix(0.9, 0.3, pull);
  }
  let p = home + vec3f(sin(t * 0.21 + h.x * 40.0) * wander + sin(t * 0.53 + h2.x * 20.0) * 0.25,
                       sin(t * 0.33 + h.y * 30.0) * 0.3,
                       cos(t * 0.17 + h.z * 50.0) * wander + cos(t * 0.47 + h2.y * 20.0) * 0.25);
  // a flash every few seconds: up quickly, a slower fade
  let period = 2.4 + 3.6 * h2.z;
  let ph = fract(t / period + h2.x);
  // (phase 5: a longer glow after each flash, and a faint one between, so at 720p a meadow of them reads at dusk)
  let flash = smoothstep(0.0, 0.035, ph) * (1.0 - smoothstep(0.05, 0.32, ph));
  o.bright = worldLight.forest.horizon.w * (flash + 0.1);
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  o.uv = c;
  // (a far one a little bigger, so at 720p it is a point of light and not lost under a pixel)
  let size = (0.05 + 0.03 * h2.y) * (1.0 + 0.02 * max(length(p - frame.camPos) - 10.0, 0.0));
  o.pos = select(frame.viewProj * vec4f(p + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0), vec4f(2.0, 2.0, 2.0, 1.0), o.bright <= 0.0);
  return o;
}

@fragment fn fs_fly(i: FOut) -> @location(0) vec4f {
  let d = dot(i.uv, i.uv);
  let k = exp(-d * 28.0) * 1.0 + exp(-d * 4.0) * 0.12;
  return vec4f(vec3f(1.0, 0.82, 0.3) * i.bright * k * 9.0, 0.0);
}

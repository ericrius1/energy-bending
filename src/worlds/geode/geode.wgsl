// The geode's light (included by worlds/light.wgsl, which declares `geode`, its uniform, in the shared light group).
// A dark hollow full of water: one big softbox overhead (the key), strip lights, coloured rims behind; a shaft of
// light from a hole in the roof that came down through rippling water, so it lands as a net of caustics on the floor
// and the stones and breaks into rays in the air; haze with distance.

struct Geode {
  bgTop: vec4f, bgBottom: vec4f, floorCol: vec4f,
  rim: vec4f,        // the rims' colour; w how strong
  key: vec4f,        // towards the softbox; w how strong
  pool: vec4f,       // xz the stage's middle, w the pool of light's radius
  cave: vec4f,       // the wall's crystals: rgb tint, w brightness
  floorBand: vec4f,  // the polished agate floor: rgb of its bands, w how strong
  shaft: vec4f,      // the light from above: xz where it lands, its radius there, its brightness
  shaftCol: vec4f,   // its colour; w the height it comes down from
  caustic: vec4f,    // how strongly it nets the floor, cells, speed, how strongly the shaft breaks into rays
  hazeCol: vec4f,    // the haze's colour; w how thick (per metre)
  rimPower: f32, floorGloss: f32, fog: f32, moteSize: f32,
  floorY: f32, pad0: f32, pad1: f32, pad2: f32,
}

// ---------------------------------------------------------------- caustics
// The net is the borders of a cellular pattern whose cells drift, drawn in the shaft's own frame: u is where a point
// sits across the shaft at its height (0 the middle, 1 its edge), so a ray keeps its u all the way down and the net
// on the floor lines up with the rays above it.

fn causticRand(c: vec2i) -> vec3f {
  let h = pcg((u32(c.x + 4096) * 73856093u) ^ (u32(c.y + 4096) * 19349663u));
  return vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 1023.0;
}
/** how far p is from the nearest border between drifting cells (0 on a border) */
fn causticEdge(p: vec2f, t: f32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2i(x, y);
      let h = causticRand(i + g);
      let o = 0.5 + 0.4 * sin(t * (0.5 + 0.6 * h.z) + 6.2831853 * h.xy);
      let d = length(vec2f(g) + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return f2 - f1;
}
/** how much light gets through at u across the shaft: about 1 on average, ~0.55 in the cells, up to ~4 on the
 *  lines. fine: the second, finer net as well (on the floor and the stones; the air takes the coarse one only) */
fn causticLight(u: vec2f, cells: f32, t: f32, fine: bool) -> f32 {
  let p = u * cells;
  let w = p + 0.42 * vec2f(sin(p.y * 0.9 + t * 0.35) + 0.5 * sin(p.y * 2.3 - p.x * 1.1 + t * 0.6),
                           sin(p.x * 0.8 - t * 0.3) + 0.5 * sin(p.x * 2.1 + p.y * 1.3 - t * 0.5));
  let da = causticEdge(w, t);
  var net = exp(-da * da * 160.0);
  if (fine) {
    let db = causticEdge(w * 1.85 + vec2f(5.1, 2.3), t * 1.27);
    let b = exp(-db * db * 220.0);
    net = net * 0.7 + b * 0.35 + net * b * 1.4;
  }
  let focus = 0.65 + 0.35 * sin(p.x * 0.7 + p.y * 0.5 + t * 0.4) * sin(p.y * 0.8 - p.x * 0.3 - t * 0.3);
  return 0.55 + net * 3.4 * focus;
}
/** u for a point: where it sits across the shaft at its height (it narrows to 0.45 of its width at the top) */
fn causticU(p: vec3f, shaft: vec4f, top: f32) -> vec2f {
  let rad = mix(shaft.z, shaft.z * 0.45, clamp(p.y / top, 0.0, 1.0));
  return (p.xz - shaft.xy) / max(rad, 1e-3);
}

// ---------------------------------------------------------------- what matter sees in the geode
/** the studio the gems reflect: a dark room, one big softbox, a ring of strip lights, two coloured rims, the floor */
fn studio(d: vec3f) -> vec3f {
  let L = geode;
  let up = d.y * 0.5 + 0.5;
  var c = mix(L.bgBottom.rgb * 0.6, L.bgTop.rgb, smoothstep(0.0, 1.0, up)) * 0.5;
  let kd = normalize(L.key.xyz);
  let kr = normalize(cross(kd, vec3f(0.0, 1.0, 0.0)));
  let ku = cross(kr, kd);
  let kz = dot(d, kd);
  if (kz > 0.0) {
    let uv = vec2f(dot(d, kr), dot(d, ku)) / kz;
    let box = smoothstep(0.42, 0.3, abs(uv.x)) * smoothstep(0.3, 0.2, abs(uv.y));
    c += vec3f(1.0, 0.97, 0.94) * box * L.key.w;
  }
  let az = atan2(d.z, d.x);
  let band = smoothstep(0.05, 0.0, abs(d.y - 0.22)) * smoothstep(0.55, 0.85, 0.5 + 0.5 * sin(az * 5.0 + 0.7));
  c += vec3f(0.9, 0.95, 1.0) * band * 2.2;
  let band2 = smoothstep(0.03, 0.0, abs(d.y + 0.08)) * smoothstep(0.7, 0.95, 0.5 + 0.5 * sin(az * 3.0 - 1.1));
  c += vec3f(1.0) * band2 * 1.6;
  c += L.rim.rgb * pow(max(dot(d, normalize(vec3f(-0.75, 0.35, -0.55))), 0.0), L.rimPower) * L.rim.w;
  c += L.floorCol.rgb * 1.2 * pow(max(dot(d, normalize(vec3f(0.8, 0.15, -0.5))), 0.0), L.rimPower * 0.7) * L.rim.w * 0.6;
  c += L.floorCol.rgb * smoothstep(0.0, -0.5, d.y) * 0.15;
  return c;
}

/** the soft light of the room on a surface facing N (sky above, the lit floor below), dimmed in crevices */
fn geodeAmbient(N: vec3f, ao: f32) -> vec3f {
  let sky = mix(geode.bgTop.rgb, vec3f(0.55, 0.58, 0.66), 0.35);
  let ground = geode.floorCol.rgb * 0.35 + geode.bgBottom.rgb;
  return mix(ground, sky, N.y * 0.5 + 0.5) * (0.25 + 0.75 * ao) * 1.6;
}

/** the key on matter at p: under the shaft it has come through water, so it shifts with the net on the floor below
 *  (fine: the finer net too; fixture: the wall's crystals, which are out of it) */
fn geodeKeyNet(p: vec3f, fine: bool, fixture: f32) -> f32 {
  let u = causticU(p, geode.shaft, geode.shaftCol.w);
  let under = smoothstep(1.15, 0.55, length(u)) * geode.caustic.x * (1.0 - fixture);
  if (under <= 0.0) { return 1.0; }
  return mix(1.0, causticLight(u, geode.caustic.y, frame.time * geode.caustic.z, fine), under);
}

/** the wall's crystals: in the dark round the stage, lit mostly from within, dimmer the further from the light */
fn geodeFixtureTint(p: vec3f, fade: bool) -> vec3f {
  var k = 1.0;
  if (fade) { k = mix(1.0, 0.35, smoothstep(3.0, 9.0, length(p.xz - geode.pool.xy))); }
  return geode.cave.rgb * geode.cave.w * k;
}

// ---------------------------------------------------------------- the air
fn geodeHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

/** the air in the geode: march the view ray through the cone of light that falls on the stage (it stops at whatever
 *  is in front), then fog what's far towards the haze. s: the scene (alpha its view distance); d: the view ray */
fn geodeAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  let along = max(dot(d, frame.camFwd), 1e-3);
  let tMax = min(s.a / along, 40.0);
  var c = s.rgb;
  let top = geode.shaftCol.w;
  let r0 = geode.shaft.z;
  // where the ray crosses the cylinder round the shaft (in xz), clipped to the floor below and the roof above
  let o = frame.camPos.xz - geode.shaft.xy;
  let a = dot(d.xz, d.xz);
  let b = dot(o, d.xz);
  let cc = dot(o, o) - r0 * r0;
  let disc = b * b - a * cc;
  if (disc > 0.0 && a > 1e-6 && geode.shaft.w > 0.0) {
    let sq = sqrt(disc);
    var t0 = max((-b - sq) / a, 0.0);
    var t1 = min((-b + sq) / a, tMax);
    if (abs(d.y) > 1e-4) {
      let tf = (-frame.camPos.y) / d.y;
      let tt = (top - frame.camPos.y) / d.y;
      if (d.y < 0.0) { t1 = min(t1, tf); t0 = max(t0, tt); } else { t1 = min(t1, tt); }
    }
    if (t1 > t0) {
      let n = 16;
      let dtm = (t1 - t0) / f32(n);
      var t = t0 + dtm * geodeHash(vec2f(px) + frame.time);
      var acc = 0.0;
      for (var k = 0; k < n; k++) {
        let p = frame.camPos + d * t;
        let h = clamp(p.y / top, 0.0, 1.0);
        let rad = mix(r0, r0 * 0.45, h);
        let rr = length(p.xz - geode.shaft.xy);
        let edge = smoothstep(rad, rad * 0.72, rr) * (0.55 + 0.45 * smoothstep(rad * 0.2, rad * 0.9, rr));
        // slow drifting veils of dust in it
        let dust = 0.65 + 0.35 * sin(p.y * 2.3 + sin(p.x * 3.1 + frame.time * 0.21) * 1.7 + frame.time * 0.13) * sin(p.z * 2.7 - frame.time * 0.17);
        // and rays: the water above gathers the light into the same net all the way down
        var ray = 1.0;
        if (geode.caustic.w > 0.0) { ray = mix(1.0, causticLight((p.xz - geode.shaft.xy) / rad, geode.caustic.y, frame.time * geode.caustic.z, false), geode.caustic.w); }
        acc += edge * dust * ray * (0.55 + 0.45 * (1.0 - h)) * dtm;
        t += dtm;
      }
      // the dust scatters forward (Henyey-Greenstein, g 0.35, as a multiple of looking across it)
      let g = 0.35;
      let phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * d.y, 1.5) / 0.738;
      c += geode.shaftCol.rgb * geode.shaft.w * acc * phase;
    }
  }
  return mix(geode.hazeCol.rgb, c, exp(-tMax * geode.hazeCol.w));
}

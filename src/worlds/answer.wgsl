// The world answers a moment (phase 6, report 20): at a pair tier (DUET, CURRENT, MURMURATION, AURORA) and at a fused
// finale, the world the duel is in responds, more with each tier: a wave of warm light runs out across the ground from
// the pair and the flowers open as it passes, the fountains leap on the beat, banners and chimes lift, stained glass
// and lanterns brighten, the sun breaks through over the pair in shafts, and at AURORA (and a fusion) an aurora opens
// in the sky. Then it all settles back, so the calm between moments stays calm.
//
// One hook, cheap: a member of the world light uniform (`worldLight.answer`, filled by worlds/answer.ts from
// src/duel/answer.ts), no binding of its own. Every world's shader that includes worlds/light.wgsl can read it with the
// functions below, each a uniform branch when nothing is answering. The air (worldAir, every world's) lays the light
// over the whole frame: the wave's ring on the ground, the warm lift where it has passed, a fusion's flower lighting the
// world round it, the sun's shafts, the aurora; its additive light keeps off the framed bodies (the near fade's body
// capsules, `sight.body`). A world's own pieces (flowers, fountains, banners, glass) take `answerReach`, `answerLift`,
// `answerGlow` and `answerBeat` with their own world's light number (0 the geode, 1 the redwoods, 2 the Pool, 3 the
// temple): their draws don't set WORLD.

/** the moment the world is answering (all zero: none) */
struct Answer {
  /** xyz: where it happened (the pair's middle on its floor; at a fusion, the base's feet); w: how strongly the world
   *  answers now (0 … 1, eased by the CPU: up with the moment, held, then down to nothing) */
  at: vec4f,
  /** x: which world answers (its light number + 1; 0: none), y: the moment's tier (1 DUET … 4 AURORA, 5 a fusion),
   *  z: seconds since the moment (its wave's age), w: the music's beat (1 on it, falling away before the next) */
  k: vec4f,
  /** xyz: where the light comes from (a fusion's flower; else the sun breaking through high over the pair); w: how
   *  strongly that light falls on the world round it (0 … 1: a fusion's flower) */
  sun: vec4f,
  /** rgb: the moment's colour (the tier's, warmed with sun gold); w: - */
  col: vec4f,
  /** x: the aurora (0 … 1), y: the shafts (0 … 1), z, w: - */
  more: vec4f,
}

/** how fast the wave runs out across the ground (m/s) */
const ANSWER_WAVE: f32 = 7.0;

/** how strongly world `w` (its light number) answers now (0: it isn't) */
fn answerOf(w: u32) -> f32 {
  let A = worldLight.answer;
  return select(0.0, A.at.w, u32(A.k.x + 0.5) == w + 1u);
}

/** how far the answer's wave has reached p (0 … 1, × the answer's strength): 1 behind its front, 0 ahead of it. A
 *  flower opens where it has reached */
fn answerReach(w: u32, p: vec3f) -> f32 {
  let lv = answerOf(w);
  if (lv <= 0.0) { return 0.0; }
  let A = worldLight.answer;
  let r = length(p.xz - A.at.xz);
  return lv * (1.0 - smoothstep(A.k.z * ANSWER_WAVE - 2.5, A.k.z * ANSWER_WAVE + 0.5, r));
}

/** the wave's front at p (0 … 1, × the strength): a ring of light passing */
fn answerFront(w: u32, p: vec3f) -> f32 {
  let lv = answerOf(w);
  if (lv <= 0.0) { return 0.0; }
  let A = worldLight.answer;
  let R = A.k.z * ANSWER_WAVE;
  let e = (length(p.xz - A.at.xz) - R) / (0.6 + 0.08 * R);
  return lv * exp(-e * e) * (1.0 - smoothstep(16.0, 45.0, R));
}

/** the beat in the answer (0 … 1, × the strength): a fountain's leap, a lantern's pulse */
fn answerBeat(w: u32) -> f32 { return answerOf(w) * worldLight.answer.k.w; }

/** how far a hanging or rising thing at p lifts (0 … 1): banners stream out, chimes swing, fountains leap; where the
 *  wave has reached, with the beat in it */
fn answerLift(w: u32, p: vec3f) -> f32 { return answerReach(w, p) * (0.7 + 0.3 * worldLight.answer.k.w); }

/** how much brighter something that gives light is at p (0 … ~1.5): stained glass, lanterns, a flower's heart */
fn answerGlow(w: u32, p: vec3f) -> f32 { return answerReach(w, p) * (0.65 + 0.35 * worldLight.answer.k.w) + answerFront(w, p) * 0.8; }

/** how much of the answer's added light a pixel along the view ray d (to distance t) keeps: none where it passes
 *  through a framed body standing before t (the near fade's capsules, sight.body: the main view's), so the light that
 *  fills the air never lies over the pair */
fn answerClear(d: vec3f, t: f32) -> f32 {
  if (frame.user.x < 0.5) { return 1.0; }
  var k = 1.0;
  for (var b = 0u; b < 2u; b++) {
    let B = worldLight.sight.body[b];
    if (B.lo.w <= 0.0) { continue; }
    let A = B.lo.xyz - frame.camPos - frame.camLo;
    let u = B.hi.xyz - B.lo.xyz;
    let bu = dot(d, u);
    let uu = max(dot(u, u), 1e-6);
    let den = uu - bu * bu;
    var s0 = 0.5;
    if (den > 1e-6) { s0 = clamp((bu * dot(d, A) - dot(u, A)) / den, 0.0, 1.0); }
    let q = A + u * s0;
    let s = dot(d, q);
    let off = length(q - d * max(s, 0.0));
    let r = B.lo.w;
    k = min(k, 1.0 - (1.0 - smoothstep(r * 1.0, r * 2.2, off)) * step(s - r * 1.5, t) * 0.92);
  }
  return k;
}

/** the aurora's light seen in direction d (curtains of fern and teal with a rose fringe, a little over the horizon,
 *  slowly moving) */
fn answerAurora(d: vec3f) -> vec3f {
  let az = atan2(d.x, -d.z);
  let h = d.y;
  let wave = 0.06 * sin(az * 2.3 + frame.time * 0.17) + 0.03 * sin(az * 5.1 - frame.time * 0.29);
  let base = 0.14 + wave;
  let band = smoothstep(base - 0.03, base + 0.02, h) * exp(-max(h - base, 0.0) * 3.5);
  let streak = 0.35 + 0.65 * pow(vnoise(vec3f(az * 9.0, h * 1.5, frame.time * 0.22)), 1.6);
  let fern = vec3f(0.37, 0.94, 0.64);
  let teal = vec3f(0.31, 0.75, 0.78);
  let rose = vec3f(1.0, 0.44, 0.64);
  let c = mix(fern, teal, smoothstep(0.0, 0.25, h - base)) + rose * smoothstep(0.15, 0.4, h - base) * 0.8;
  return c * band * streak;
}

/** how much the answer lifts the light of a surface at view distance `sa` along the view ray d (× its colour; 1: not
 *  at all): where the wave has passed a little of the moment's own colour, the ring of light at its front, a fusion's
 *  flower lighting the world round it. Phase 7 (report 24, report 23's "washed and veiled"): one colour accent per
 *  moment, not everything lifted: the warm lift where the wave has passed is the moment's colour at a third of what it
 *  was (it lifted the whole stage gold), the flower's lamp a third as strong and in its colour, and no lift past
 *  ANSWER_LIFT_MAX, so a sunlit wall lifted toward white keeps its own colour */
fn answerMul(sa: f32, d: vec3f) -> vec3f {
  let lv = answerOf(WORLD);
  if (lv <= 0.001 || sa > 20000.0) { return vec3f(1.0); }
  let A = worldLight.answer;
  let t = min(sa / max(dot(d, frame.camFwd), 1e-3), 4000.0);
  let p = frame.camPos + frame.camLo + d * t;
  let gold = vec3f(1.0, 0.7, 0.32);
  let accent = mix(gold, A.col.rgb, 0.7);
  let r = length(p.xz - A.at.xz);
  let R = A.k.z * ANSWER_WAVE;
  let passed = 1.0 - smoothstep(R - 3.0, R + 0.5, r);
  let low = 1.0 - smoothstep(A.at.y + 1.5, A.at.y + 5.0, p.y);
  let e = (r - R) / (0.6 + 0.08 * R);
  let ring = exp(-e * e) * low * (1.0 - smoothstep(16.0, 45.0, R));
  // (as a lamp would: falling off with the square of the distance)
  let q = p - A.sun.xyz;
  let lamp = A.sun.w * 2.2 / (4.0 + dot(q, q));
  // (the framed bodies take a third of it: they stay their own colours)
  let add = lv * (accent * (0.1 * passed * (0.85 + 0.15 * A.k.w) + lamp) + mix(gold, A.col.rgb, 0.55) * 2.4 * ring) * mix(0.35, 1.0, answerClear(d, t + 0.3));
  return 1.0 + min(add, vec3f(ANSWER_LIFT_MAX));
}

/** a fusion's flower's reach round its heart (m: bloom.ts, its petals' tips), the beams' hole */
const ANSWER_FLOWER_R: f32 = 3.3;

/** the most the answer lifts a surface's light (× 1 + this) */
const ANSWER_LIFT_MAX: f32 = 0.8;

/** the answer laid on the scene `s` (alpha its view distance) along the view ray d, before the world's air fogs it
 *  (answerMul). Linear in the colour. worldAir's first step */
fn answerAir(s: vec4f, d: vec3f) -> vec4f {
  if (answerOf(WORLD) <= 0.001 || s.a > 20000.0) { return s; }
  return vec4f(s.rgb * answerMul(s.a, d), s.a);
}

/** a fusion's flower is light, not a lit surface: the glow `g` laid over the scene at view distance `sa` (the air
 *  adds it to the scene before answerAir, which would lift it with the world) taken back off that lift, and its added
 *  light capped where the flower's petals overlap (its peak rolled off toward ANSWER_GLOW_CAP, the hue kept, so two
 *  rose petals over each other stay rose, not cream). Off the framed bodies (answerClear) the cap lets go, so fire's
 *  hot core on a body stays hot. Phase 7, report 24 */
fn answerGlowSeen(g: vec3f, sa: f32, d: vec3f) -> vec3f {
  let lv = answerOf(WORLD);
  if (lv <= 0.001) { return g; }
  var o = g / answerMul(sa, d);
  let A = worldLight.answer;
  let k = A.sun.w * lv;
  let peak = max(o.r, max(o.g, o.b));
  if (k <= 0.001 || peak <= ANSWER_GLOW_KNEE) { return o; }
  let t = min(sa / max(dot(d, frame.camFwd), 1e-3), 4000.0);
  let span = ANSWER_GLOW_CAP - ANSWER_GLOW_KNEE;
  let rolled = ANSWER_GLOW_KNEE + span * (1.0 - exp(-(peak - ANSWER_GLOW_KNEE) / span));
  return mix(o, o * (rolled / peak), min(1.0, k * 1.6) * answerClear(d, t));
}

/** how much of the world a fusion's flower hides where its light stands (0 … ANSWER_GLOW_OVER): its petals are laid
 *  over the world rather than only added to it, so over a bright sky or water they keep their rose and fern instead of
 *  whitening it (the glow `g` as answerGlowSeen gives it, at view distance `sa`); never over the framed bodies */
fn answerGlowOver(g: vec3f, sa: f32, d: vec3f) -> f32 {
  let lv = answerOf(WORLD);
  let k = worldLight.answer.sun.w * lv;
  if (k <= 0.001) { return 0.0; }
  let t = min(sa / max(dot(d, frame.camFwd), 1e-3), 4000.0);
  return ANSWER_GLOW_OVER * min(1.0, k * 1.6) * smoothstep(0.02, 0.2, max(g.r, max(g.g, g.b))) * answerClear(d, t);
}
const ANSWER_GLOW_OVER: f32 = 0.92;

/** the glow's peak passes untouched up to the knee, then rolls off toward the cap (linear light, before exposure) */
const ANSWER_GLOW_KNEE: f32 = 0.55;
const ANSWER_GLOW_CAP: f32 = 0.95;

/** how much of the world shows behind a fusion's flower (0 … 1, 1 all of it): the sky and the world in a cone round
 *  the flower's heart dimmed by up to a quarter (a half until report 24, whose petals are laid over the world:
 *  answerGlowOver), so its petals' rose and fern hold their colour where they would wash to
 *  cream over a white noon (the temple, the Pool's sky); never the framed bodies. The air (post/air.wgsl) takes it off
 *  the world it shows, never off the glow */
fn answerVeil(sa: f32, d: vec3f) -> f32 {
  let lv = answerOf(WORLD);
  let A = worldLight.answer;
  if (lv <= 0.001 || A.sun.w <= 0.001) { return 1.0; }
  let toS = normalize(A.sun.xyz - frame.camPos - frame.camLo);
  let cone = smoothstep(0.84, 0.98, dot(d, toS));
  let t = min(sa / max(dot(d, frame.camFwd), 1e-3), 4000.0);
  return 1.0 - 0.25 * cone * A.sun.w * lv * answerClear(d, t);
}

/** the sun breaking through: beams fanning from the source, with gaps between them, and its disc (answerLight's, its
 *  strength and its clearing of the bodies not yet in it) */
fn answerShaftsAt(sa: f32, d: vec3f, t: f32, sky: bool) -> vec3f {
  let A = worldLight.answer;
  let eye = frame.camPos + frame.camLo;
  let gold = vec3f(1.0, 0.7, 0.32);
  var add = vec3f(0.0);
  let shafts = A.more.y;
  if (shafts > 0.003) {
    let toS = normalize(A.sun.xyz - eye);
    let cs = dot(d, toS);
    let b1 = normalize(cross(toS, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-5, 0.0, 0.0));
    let b2 = cross(b1, toS);
    let ang = atan2(dot(d, b2), dot(d, b1));
    let tm = frame.time * 0.12;
    let rays = pow(0.5 + 0.5 * sin(ang * 9.0 + 1.6 * sin(ang * 4.0 + tm) + tm), 10.0);
    let fan = smoothstep(0.45, 0.97, cs);
    let core = pow(max(cs, 0.0), 60.0) * 1.8 + pow(max(cs, 0.0), 12.0) * 0.2;
    let deep = select(1.0 - exp(-t / 14.0), 1.0, sky);
    // (a fusion's flower stands at the source: the beams come out from behind its petals, none over them and no disc,
    // so its rose and fern are never washed to cream. Phase 7, report 24: the hole is the flower's own size as the eye
    // sees it, ANSWER_FLOWER_R round its heart; it was a fixed 13°, and the beams crossed its outer petals)
    let ds = length(A.sun.xyz - eye);
    let cR = ds / sqrt(ds * ds + ANSWER_FLOWER_R * ANSWER_FLOWER_R);
    let hole = 1.0 - A.sun.w * smoothstep(cR - 0.012, cR + 0.004, cs);
    add += gold * shafts * (rays * fan * 0.5 * deep * hole + core * (1.0 - A.sun.w));
  }
  return add;
}

/** the shafts' light at a pixel as answerLight adds it (its level and its clearing of the bodies in), so the air can
 *  take it off where a fusion's flower stands in front: the beams come out from behind the petals, never over them
 *  (post/air.wgsl, report 24) */
fn answerShafts(sa: f32, d: vec3f) -> vec3f {
  let lv = answerOf(WORLD);
  if (lv <= 0.001 || worldLight.answer.more.y <= 0.003) { return vec3f(0.0); }
  let t = min(sa / max(dot(d, frame.camFwd), 1e-3), 4000.0);
  return answerShaftsAt(sa, d, t, sa > 20000.0) * lv * answerClear(d, t);
}

/** the answer's light in the air along the view ray d to the view distance `sa`, added after the world's air (so the
 *  haze doesn't swallow it), kept off the framed bodies: the wave's ring glowing, the sun breaking through in shafts from
 *  its source over the pair, the aurora in the sky (and its light mirrored low round the pair), the sky warmed. Added
 *  light only (affine: the water's air and the glow's fog rely on it). worldAir's last step */
fn answerLight(sa: f32, d: vec3f) -> vec3f {
  let lv = answerOf(WORLD);
  if (lv <= 0.001) { return vec3f(0.0); }
  let A = worldLight.answer;
  let sky = sa > 20000.0;
  let t = min(sa / max(dot(d, frame.camFwd), 1e-3), 4000.0);
  let eye = frame.camPos + frame.camLo;
  let p = eye + d * t;
  let gold = vec3f(1.0, 0.7, 0.32);
  let clear = answerClear(d, t);
  var add = vec3f(0.0);
  if (!sky) {
    let r = length(p.xz - A.at.xz);
    let R = A.k.z * ANSWER_WAVE;
    let low = 1.0 - smoothstep(A.at.y + 1.5, A.at.y + 5.0, p.y);
    let e = (r - R) / (0.6 + 0.08 * R);
    add += mix(gold, A.col.rgb, 0.4) * 0.3 * exp(-e * e) * low * (1.0 - smoothstep(16.0, 45.0, R));
  }
  add += answerShaftsAt(sa, d, t, sky);
  // the aurora: curtains of light in the sky; under a roof (the geode) on what is high over the pair; mirrored in what
  // lies low and flat round the pair (the water, the floor); and the sky warmed, a sky of light
  let au = A.more.x;
  if (au > 0.003) {
    let high = select(smoothstep(A.at.y + 3.0, A.at.y + 8.0, p.y) * 0.5, 1.0, sky);
    add += answerAurora(d) * au * 1.3 * high;
    if (!sky && d.y < 0.0) {
      let flat = 1.0 - smoothstep(A.at.y + 0.3, A.at.y + 1.0, p.y);
      add += answerAurora(vec3f(d.x, -d.y, d.z)) * au * 0.5 * flat;
    }
    if (sky) { add += gold * au * 0.12 * smoothstep(-0.05, 0.4, d.y); }
  }
  return add * lv * clear;
}

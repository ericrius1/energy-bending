// What the flame shaders share (no bindings): a flame particle's state and the uniform that drives both the
// simulation and the draw. A flame is born at its home on a capsule, lives for a fraction of a second (rising,
// stirred, cooling) and is born again at its home, so a body of fire is always the figure of its dancer. `form`
// (0 fire … 1 plasma) is per particle: its layer's own (plasma layers are 1) plus its dancer's (FireSim.form, set by
// the game), so one dancer can turn to plasma while another stays fire.
#include "../core/particle"

/** one flame: where it is and how old (s; negative: not yet born), velocity and how long it lives; its form, its
 *  temperature at birth, its size (m; negative: an ember or a spark), how much of it is smoke (0 … 1) */
struct Flame { pos: vec3f, age: f32, vel: vec3f, life: f32, look: vec4f }

struct FireSim {
  body: BodyStep,        // homeOf reads time, fill and breathe from it
  count: u32,            // flames simulated
  frameNo: u32,
  dt: f32,
  time: f32,
  burn: f32,             // 0 … 1: how much of the body is alight (0 after a shatter until the next rise)
  wake: f32,             // dance time a rise began (0: no rise under way)
  wakeSpread: f32,       // seconds from the feet catching to the head
  life: f32,             // @range(0.2, 3) how long a flame lives (s, before its own variation)
  buoyancy: f32,         // @range(0, 12) m/s² at temperature 1
  turbulence: f32,       // @range(0, 12) the stirring (m/s² per unit of flow)
  drag: f32,             // @range(0, 6) how fast a flame takes the air's speed (1/s)
  inherit: f32,          // @range(0, 1.5) how much of its limb's velocity a flame is born with
  size: f32,             // @range(0.005, 0.2) a flame's half width at birth (m)
  embers: f32,           // @range(0, 4) embers thrown, per particle slot, at full limb speed
  heat: f32,             // @range(0.2, 3) temperature at birth
  cling: f32,            // @range(0, 400) plasma's spring to its home (1/s²)
  blast: vec4f,          // xyz centre, w strength: a shatter this frame
  // the embers' draw (draw.wgsl); the body of the flames is drawn by the field (field.wgsl FireField)
  stretch: f32,          // @range(0, 0.2) seconds of motion a spark is stretched along
  emberGlow: f32,        // @range(0, 8)
  pad0: f32, pad1: f32,
  form: array<vec4f, 2>, // per dancer slot (MAX_DANCERS = 8): the game's form, 0 fire … 1 plasma
  /** a fusion (the field's, field.ts fusionFront): kind (0 steam, 1 prism, 2 storm, 3 aurora), amount 0 … 1, where in
   *  its eight bars (0 … 8), the landing's pulse 0 … 1 */
  fusion: vec4f,
  /** the fusion's double helix (the field's): its centre (xyz) and the strands' radius (m) */
  helixAt: vec4f,
  /** its turn (rad), half height (m), turns per metre, and the pair's floor (m) */
  helixShape: vec4f,
  /** per dancer slot (MAX_DANCERS = 8): 0 solid flame body … 1 dissolved rushing ember comet */
  dissolve: array<vec4f, 2>,
  /** per dancer slot (MAX_DANCERS = 8): 0 idle … 1 overdrive hold-charge */
  charge: array<vec4f, 2>,
}

/** a fusion flame's home carries 2 + its side (0 the first seat's body, 1 the second's) where a flame's form would be */
fn fusionSide(look: f32) -> f32 { return clamp(look - 2.0, 0.0, 1.0); }
fn isFusion(look: f32) -> bool { return look > 1.5; }

/** temperature to colour, fire: deep red, orange at 1, yellow-white past 1.5 (docs/element-looks.md, 1) */
fn fireRamp(T: f32) -> vec3f {
  let t = clamp(T, 1e-4, 3.2);
  let c = pow(vec3f(t), vec3f(1.0, 2.0, 3.6)) * vec3f(1.75, 0.95, 0.6);
  // past T ~1.6 the reference's blue term overtakes the others: a hot core is held to a yellow-white (its hue, not
  // white: green under 0.86 of red, blue under 0.56 of green) instead of going blue-violet or flat white
  return shoulder(vec3f(c.r, min(c.g, c.r * 0.86), min(c.b, c.g * 0.56)));
}
/** a highlight shoulder: below 1 nothing changes; above, the brightest channel rolls off toward 1.6 and the others
 *  keep their ratio to it, so a hot core keeps its hue and its structure instead of clipping to a flat white disc (the
 *  grade's ACES takes 1.6 to about 0.9: still a highlight, still its colour) */
fn shoulder(c: vec3f) -> vec3f {
  let m = max(c.r, max(c.g, c.b));
  if (m <= 1.0) { return c; }
  let x = m - 1.0;
  return c * ((1.0 + 0.6 * (1.0 - exp(-x / 0.6))) / m);
}
/** temperature to colour, plasma: the aurora (the art bible's solar wind: report 18-bodies): violet where it is thin,
 *  teal through its threads, a cyan-white where it is hottest. (It was violet, magenta-pink and white: the pink was
 *  the rose seat's hue, and a violet-white body beside a violet gem body was one shape: report 17 issue 4) */
fn plasmaRamp(T: f32) -> vec3f {
  let t = clamp(T, 0.0, 3.6);
  let c = vec3f(0.40, 0.10, 1.0) * 1.35 * t + vec3f(0.05, 0.95, 0.80) * 0.6 * t * t + vec3f(0.85, 1.0, 1.0) * 0.55 * t * t * t;
  // its hottest is cyan-white, not white: red held under green
  return shoulder(vec3f(min(c.r, c.g * 0.8), c.g, c.b));
}

/** how hot a flame is now: hot at birth, cooling fast at first (the core survives ~0.3 s), the tips fading quickly */
fn flameT(f: Flame) -> f32 {
  let u = clamp(f.age / max(f.life, 1e-3), 0.0, 1.0);
  return f.look.y * pow(1.0 - u, 2.0) * smoothstep(0.0, 0.04, f.age + 0.02);
}

fn alive(f: Flame) -> bool { return f.age >= 0.0 && f.age < f.life && f.life > 0.0; }

// The data every body-of-matter shader shares, with no bindings: the joints and capsules of a dancer, a particle's
// state, its home on a body, and the modes a particle moves through. Draws include this; simulations include
// body.wgsl, which adds the shared buffers and the motion.
#include "../../engine/limits"
#include "../../engine/util"

/** a joint, as the CPU uploads it each frame (skeleton/rig.ts Skeleton.world): position + speed, rotation, velocity */
struct Joint { pos: vec4f, rot: vec4f, vel: vec4f }
/** a capsule hung on a joint (matter/core/capsules.ts): off.xyz the bone in the joint's frame, off.w its length;
 *  b1, b2 the two axes across it with the radii at the joint end in w; info: joint, child, the radii at the child end */
struct Seg { off: vec4f, b1: vec4f, b2: vec4f, info: vec4f }
/** a particle: where it is, how long it has been in its mode (or has left), velocity, mode, rotation */
struct Particle { pos: vec3f, life: f32, vel: vec3f, mode: f32, rot: vec4f }
/** where a particle lives on a body (matter/core/layout.ts), and how it looks there:
 *  place: capsule slot (dancer × SEGS + capsule), t along it, angle round it, depth (1 on the surface);
 *  look:  x is the kind's own (gems: the specimen), y its size (m), z the part's role (0 heart, 1 limb, 2 accent),
 *         w a random number */
struct Home { place: vec4f, look: vec4f }

// a particle's mode (Particle.mode)
const ON_BODY: f32 = 0.0;    // on its dancer, a stiff spring to its home
const FLYING: f32 = 1.0;     // knocked off: gravity, bounces
const RETURNING: f32 = 2.0;  // flying home on a spring that tightens
const FROZEN: f32 = 3.0;     // left in the air where a hand or foot passed, until it drops
const RESTING: f32 = 4.0;    // lying on the floor, waiting for the dancers to rise
fn modeIs(m: f32, k: f32) -> bool { return abs(m - k) < 0.5; }

/** which dancer a home belongs to */
fn dancerOf(h: Home) -> u32 { return u32(h.place.x) / SEGS; }

/** how a body of matter moves: each kind embeds one in its uniform and fills it from its parameters */
struct BodyStep {
  dt: f32, time: f32, floorY: f32, fill: f32,      // fill: 0 a shell on the capsules' surface … 1 solid
  stiffness: f32, damping: f32, transition: f32, breathe: f32,
  shedRate: f32, speedShed: f32, fallTime: f32, gravity: f32,
  bounce: f32, friction: f32, drag: f32, current: f32,
  returnMode: f32,   // 0 fly back home, 1 regrow at home
  settle: f32,       // 1: what falls stays down (RESTING) until the next rise
  trail: f32,        // chance a second a particle on a hand, foot or head is left hanging where it was
  trailHold: f32,    // seconds it hangs there
  wake: f32,         // when the resting particles began to rise (0: they don't)
  wakeSpread: f32,   // seconds from the first up (the feet) to the last (the head)
  shatter: f32, scatter: f32,   // how easily a swipe knocks them off, how hard they fly
  noiseAmp: f32, noiseFreq: f32, noiseSpeed: f32,
  spin: f32, order: f32,   // a slow spin on the body; 0 tumbling any which way … 1 facing out from the body
  hold: f32,         // 0 (every kind but the gems): the plain spring. > 0: fast limbs hold their matter (bodyStep)
  trailCap: f32,     // with hold: how far (m) matter may trail its home when the limb is slow (less when it's fast)
  pad0: f32,
}

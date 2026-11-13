// What ice breathes out: cold mist that sinks and spreads along the floor, and glittering ice dust that drifts down.
// A ring of motes, one thread each: a dead mote is reborn at a random particle of the pool if that particle is ice
// (so a body that is half frozen breathes from its frozen half only), lives a few seconds and dies. Mist is one mote
// in four's job, dust the rest. Drawn additively in the glow phase: a faint cold haze, never a fog bank, and points
// that glint now and then (docs/element-looks.md, "Cold mist", "Ice dust").
#include "../water/water"

struct Mist {
  count: u32,         // the pool's particles (where motes are born)
  motes: u32,         // motes in the ring
  frameNo: u32,
  pad0: u32,
  dt: f32, time: f32, floorY: f32, birth: f32,   // birth: the chance a dead mote is reborn this frame
  mist: f32, dust: f32, mistSize: f32, dustSize: f32,
}

struct Mote { pos: vec3f, life: f32, vel: vec3f, span: f32 }

fn isMist(i: u32) -> bool { return i % 4u == 0u; }

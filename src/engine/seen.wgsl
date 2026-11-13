// What a view sees of each dancer: whether it is drawn at all (the scene draws only the dancers of the world it
// shows), where (a dancer half way through a gate is also drawn in the other world, carried there by the gate's
// rigid move) and which side of a plane (the door: what has gone through is not drawn on this side). One small
// uniform per view (engine/views.ts `ViewCtx.seen`), filled each frame by the portals (src/portals/portals.ts).
//
// The hook every matter kind honours, in the shaders that draw or cull a dancer's particles (bind it by name,
// `seen: s.view.seen`; docs/extending/portal.md):
//   let s = seen.d[d];                    // d: the particle's dancer (dancerOf(home) for a body of matter)
//   let p = seenPos(s, worldPos);          // where to draw it in this view's world
//   let q = seenRot(s, rot);               // its orientation there
//   if (seenClip(s, p) < 0.0) { skip }     // beyond the door (and a dancer not in this world: always negative)
// Pass seenClip to the fragment shader and discard below 0 there too, so the cut at the door is clean.
// The view's matter counts are cut down by `seen.keep` (a gate's view is small): drop particles whose own random
// number is above it, and grow the rest by `seen.grow` so the body looks as full.
#include "./limits"

/** one dancer in one view: a rigid move (the rows of a 3×4 matrix: rotation | translation), its rotation as a
 *  quaternion, and a plane (n, d): drawn where dot(n, p) + d >= 0 (in this view's world, after the move) */
struct Seen { x: vec4f, y: vec4f, z: vec4f, q: vec4f, clip: vec4f }
struct ViewSeen {
  d: array<Seen, MAX_DANCERS>,
  keep: f32,   // the share of each body's particles this view draws (1 the main view, less through a gate)
  grow: f32,   // how much bigger each one drawn is, to make up for those left out
  pad0: f32, pad1: f32,
}

fn seenPos(s: Seen, p: vec3f) -> vec3f { return vec3f(dot(s.x.xyz, p) + s.x.w, dot(s.y.xyz, p) + s.y.w, dot(s.z.xyz, p) + s.z.w); }
fn seenDir(s: Seen, v: vec3f) -> vec3f { return vec3f(dot(s.x.xyz, v), dot(s.y.xyz, v), dot(s.z.xyz, v)); }
fn seenRot(s: Seen, q: vec4f) -> vec4f {
  let a = s.q;
  return vec4f(a.w * q.xyz + q.w * a.xyz + cross(a.xyz, q.xyz), a.w * q.w - dot(a.xyz, q.xyz));
}
/** >= 0: drawn. A dancer not in this view's world has the plane (0, 0, 0, -1): never drawn */
fn seenClip(s: Seen, p: vec3f) -> f32 { return dot(s.clip.xyz, p) + s.clip.w; }

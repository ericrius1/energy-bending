// What ice's shaders share, with no bindings: how ice looks (IceLook, ice/params.ts through ice/ice.ts), a shard of set
// ice as ice/setice.ts writes it, and where such a shard is now (grown in along its path, waning at the end of its
// life, shrunk as it melts, flying apart when shattered). The shards (ice/shards.wgsl) draw set ice's icicles and its
// broken pieces; the water's surface (water/splat.wgsl) splats the rest, so set ice has the bodies' facets.

/** how ice looks (ice/params.ts) */
struct IceLook {
  size: f32,          // a shard's size, × its particle's home size × √(particles per shard)
  frost: f32,         // the frosted rim
  glint: f32,         // facet glints and the key's sparkle
  edges: f32,         // the bright facet edges
  tint: vec4f,        // rgb: thin ice; w: refraction index
  deep: vec4f,        // rgb: thick ice; w: dispersion
  time: f32,          // seconds (the glints' clock, and set ice's)
  setTime: f32,       // set ice's clock (ice/setice.ts SetIce.now)
  inside: f32,        // how much of the world is seen refracted inside
  pad0: f32,
  /** who each body is (matter/core/seats.ts): per dancer slot, rgb its seat's hue, w how strongly its ice wears it */
  seat: array<vec4f, MAX_DANCERS>,
}

/** a shard of set ice (ice/setice.ts writes these) */
struct SetShard {
  pos: vec4f,         // xyz, w its size (m)
  rot: vec4f,
  info: vec4f,        // when it starts to grow, when it ends (0: never), how melted (0 … 1), when it shattered (0: not)
  more: vec4f,        // x its seed, yzw the way it flies when shattered
}

/** a set shard now: where, turned how, how big (0: not there), how fresh its frost, how wet, whether it is broken */
struct SetNow { centre: vec3f, size: f32, rot: vec4f, fresh: f32, wet: f32, broken: bool }

fn setShardNow(sh: SetShard, t: f32, floorY: f32) -> SetNow {
  var o: SetNow;
  var grow = smoothstep(sh.info.x, sh.info.x + 0.35, t);
  if (sh.info.y > 0.0) { grow *= 1.0 - smoothstep(sh.info.y - 1.0, sh.info.y, t); }
  grow *= 1.0 - sh.info.z;
  o.centre = sh.pos.xyz;
  o.rot = sh.rot;
  o.broken = sh.info.w > 0.0;
  if (o.broken) {
    let k = max(t - sh.info.w, 0.0);
    o.centre += sh.more.yzw * k + vec3f(0.0, -4.9 * k * k, 0.0);
    o.centre.y = max(o.centre.y, floorY + 0.01);
    o.rot = qmul(qaxis(normalize(sh.more.yzw + vec3f(0.01)), k * 9.0), o.rot);
    grow *= 1.0 - smoothstep(0.6, 1.4, k);
  }
  o.size = sh.pos.w * grow;
  o.fresh = 1.0 - smoothstep(sh.info.x + 0.2, sh.info.x + 1.2, t);
  o.wet = sh.info.z;
  return o;
}

/** an icicle hangs (its shard points down): drawn as a shard, not splatted */
fn setHangs(sh: SetShard) -> bool { return qrot(sh.rot, vec3f(0.0, 1.0, 0.0)).y < -0.3; }

// Where the depth of field should focus inside a live gate (post.ts PostChain.focusFrom, a window): the main view's
// disc writes its own plane's distance into the scene's alpha (the depth contract: the main world's air lies over the
// disc as over a window), so on its own the lens would take everything seen through a gate to be as far as the gate.
// This draws each live gate's screen rectangle once more (one draw for every gate, after the main view's scene) into
// an r16float target: where the open disc is what the eye sees, the far view's whole path from the eye (its air
// target's alpha, the gate camera being this one carried through: surface.wgsl farDist), or a flame's nearer one there
// (the far view's own focus texture); 0 elsewhere ("nothing": the air keeps the opaque distance). The air takes it in
// place of the opaque distance for the focus only, never for the fog.
#include "./surface"

/** the main view's opaque scene (alpha: its distance): a disc hidden by something in front of it isn't the window */
@group(1) @binding(5) var scene: texture_2d<f32>;
/** each slot's view's translucent focus (fire's: matter/fire focus), a 1×1 zero where it has none */
@group(1) @binding(6) var near0: texture_2d<f32>;
@group(1) @binding(7) var near1: texture_2d<f32>;
@group(1) @binding(8) var near2: texture_2d<f32>;

fn loadAt(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  let d = vec2i(textureDimensions(t));
  return textureLoad(t, clamp(vec2i(uv * vec2f(d)), vec2i(0), d - 1), 0);
}

@fragment fn fs_focus(i: DiscV) -> @location(0) vec4f {
  let G = gates.g[i.gate];
  let slot = i32(G.n.w);
  // only a live gate fully open (one weaving shut or showing a still keeps its plane's distance)
  if (slot < 0 || G.info.x < 0.75 || G.right.w < 0.95) { discard; }
  let uv = i.pos.xy * frame.invRes;
  let d = viewRay(uv);
  let eye = frame.camPos;
  let n = G.n.xyz;
  let dn = dot(d, n);
  if (abs(dn) < 1e-6) { discard; }
  let t = dot(G.at.xyz - eye, n) / dn;
  if (t <= 0.0) { discard; }
  let p = eye + d * t;
  let q = p - G.at.xyz;
  if (length(vec2f(dot(q, G.right.xyz), dot(q, G.up.xyz))) > G.at.w) { discard; }
  let here = dot(p - eye, frame.camFwd);
  // the disc is what is seen here (its alpha is its plane's distance, or more at the face: surface.wgsl fs_disc)
  if (loadAt(scene, uv).a < here * 0.985 - 0.02) { discard; }
  var far = farDist(slot, uv);
  var nf = loadAt(near0, uv).r;
  if (slot == 1) { nf = loadAt(near1, uv).r; }
  if (slot == 2) { nf = loadAt(near2, uv).r; }
  if (nf > 0.0 && nf < 5000.0) { far = min(far, nf); }
  return vec4f(max(far, here), 0.0, 0.0, 1.0);
}

// The matter field (a stub). A coarse 3D grid that follows the dancers and holds three things matter kinds deposit
// into and sample: the wind (limbs stir it, so flame and spray trail a kick), heat and wetness (how elements react:
// water in heat becomes steam, flame in wet dies to smoke, ice near heat melts, water near ice freezes).
//
// The stub answers "calm air" everywhere so kinds can be written against it now. Wave 1 (field + reactions) replaces
// the bodies with samples of 3D textures (sampled textures, not storage buffers: a simulation is already near the
// eight-storage-buffers-per-stage budget, see AGENTS.md) bound in a shared group, keeping these signatures.

/** the wind at p (m/s, world) */
fn fieldWind(p: vec3f) -> vec3f { return vec3f(0.0); }
/** how hot it is at p: 0 ambient … 1 flame (negative: cold, near ice) */
fn fieldHeat(p: vec3f) -> f32 { return 0.0; }
/** how wet it is at p: 0 dry … 1 in water */
fn fieldWet(p: vec3f) -> f32 { return 0.0; }

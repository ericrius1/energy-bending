// The curl grids' uniform and how to read them (no bindings): where each fire dancer's box is, its size in cells,
// (curl.wgsl makes the push in each cell, sim.wgsl reads it).
#include "../../engine/limits"

/** at most this many fire dancers have a grid (the rest burn without one) */
const CURL_GRIDS: u32 = 4u;

struct Curl {
  /** per grid: the box's low corner (xyz, m) and its cell size (w, m) */
  boxes: array<vec4f, CURL_GRIDS>,
  /** per dancer slot (MAX_DANCERS = 8): its grid, or -1 */
  grid: array<vec4i, 2>,
  dims: vec4u,         // cells along x, y, z (w unused)
  grids: u32,          // grids in use
  count: u32,          // flames
  strength: f32,       // ε, the confinement's strength
  maxForce: f32,       // m/s²: the most a cell pushes
}

// (these read the uniform `curl`, which every file that includes this one declares)
fn cellsOf() -> u32 { return curl.dims.x * curl.dims.y * curl.dims.z; }
fn gridOf(d: u32) -> i32 { let k = min(d, MAX_DANCERS - 1u); return curl.grid[k / 4u][k % 4u]; }

// Ice's parameters: how its shards look (size, the frosted rim, the facet edges, glints, the colour of thin and of
// thick ice), how much mist and dust it breathes out, and the set ice the game builds with. How it moves and how it
// freezes and melts are the water's (matter/water/params.ts): it is the same matter.
import { defineParams } from '../../engine/params';

/** the most shards of set ice at once (one storage buffer, 64 bytes a shard: 1 MB) */
export const SET_SHARDS_MAX = 16_384;
/** motes of mist and dust (32 bytes each) */
export const MOTES = 24_576;

export const iceParams = defineParams('ice', {
  /** one shard on every n-th particle (fewer, bigger facets as it rises) */
  shardEvery: 10,
  size: 1.6,
  frost: 1,
  edges: 1,
  glint: 1,
  inside: 0.55,
  thin: '#8fb8d8',
  thick: '#16305a',
  ior: 1.31,
  dispersion: 0.04,
  /** mist and dust */
  mist: 1,
  dust: 1,
  mistSize: 0.18,
  dustSize: 0.006,
  /** the chance a second that a dead mote is reborn (scaled per frame) */
  breath: 3,
  /** set ice: shards per metre of path per metre of width, a slab's thickness (m), how fast it melts in heat (1/s) */
  setDensity: 420,
  setThickness: 0.14,
  setMelt: 0.6,
  /** for captures and trying looks: lay a piece of set ice by name ('bridge', 'ramp'; 'clear' takes them all away) */
  demo: '',
}, {
  shardEvery: { min: 1, max: 40, step: 1, label: 'particles per shard' },
  size: { min: 0.3, max: 4, label: 'shard size' },
  frost: { min: 0, max: 3, label: 'frost' },
  glint: { min: 0, max: 4 },
  mist: { min: 0, max: 4, label: 'cold mist' },
  thin: { color: true, label: 'thin ice' },
  thick: { color: true, label: 'thick ice' },
});

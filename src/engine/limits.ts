// The hard caps, in one place, each with the reason it is the number it is. Buffers are sized from these once at
// start. The shaders that index those buffers need the same numbers as WGSL constants: they live in
// `engine/limits.wgsl`, and `npm test` (scripts/check-limits.mjs) fails if the two files disagree. To raise a cap,
// change it in both files; the cost is memory (noted beside each), not code.

export const LIMITS = {
  /** Dancers on stage at once. Each has a slot of `joints` joints and `capsules` capsules in the shared buffers. Eight
   *  holds the largest Gem Dancers programme (a mandala of eight) and the jogo's two players with room for NPCs. */
  dancers: 8,
  /** Joints per dancer slot. The CMU rig has 38; 40 keeps a slot a round number of 16-byte rows. */
  joints: 40,
  /** Capsules per dancer slot. The body is 25 capsules (matter/core/capsules.ts); 32 leaves room for a tail or wings. */
  capsules: 32,
  /** Specimen kinds the gems can draw. Two uniform arrays are this long (the minerals and the per-specimen draw
   *  table), 112 bytes a kind, so 32 costs 3.5 KB of uniforms. Gem Dancers had 12 (11 in use). */
  specimens: 32,
  /** Levels of detail per specimen (scripts/specimens.py writes three). */
  lods: 3,
  /** Gem particles across all dancers. Each costs about 150 bytes of GPU memory (state, homes, draw lists), so 300k is
   *  about 45 MB. A phone runs 9k, a desktop 15k to 28k; the cap is for the panel's "how many" slider. */
  stones: 300_000,
  /** Gems a world is built of (the geode's crystal wall is 2,600 of them). They sit after the dancers' stones. */
  fixtures: 4096,
  /** The sparkle pool, a ring buffer (48 bytes each: 3 MB). */
  sparks: 65_536,
  /** Sound events the GPU can report in one frame (stones landing, breaking off, clicking home). The score rings at
   *  most a couple of dozen; the rest are there so a shatter's count is right. */
  soundEvents: 1024,
  /** Paper lanterns in the redwoods: a uniform array, and each one is a loop iteration in every lit pixel. */
  lanterns: 16,
  /** Redwood trunks the light is tested against: a uniform array, and a loop in every lit pixel. */
  trunks: 48,
  /** Extra views drawn in a frame besides the main one (a portal's destination, the ?pip inset). Each has its own
   *  scene targets, its own LOD cull and its own draw lists (about 5 MB at 300k stones). */
  views: 3,
  /** Point deposits into the matter field in one frame (thrown streams, impacts): a uniform array of 48 bytes each,
   *  and a loop in every field cell, so a few dozen. */
  fieldDeposits: 32,
  /** Vortex sources in the field at once (the fusion's swirl, a whirlwind move): a uniform array and a loop per cell. */
  fieldVortices: 4,
  /** Points the CPU can ask the field about each frame (the updraft under a jumping dancer): read back a frame or
   *  three late through a 512-byte buffer. */
  fieldProbes: 16,
  /** Steam puffs (src/matter/reactions): 32 bytes each, so 2 MB; a desktop runs 12k to 24k, a phone 4k. */
  steam: 65_536,
  /** Flame particles across every fire and plasma dancer (matter/fire). 48 bytes of state and 32 of home each, so
   *  262k is about 21 MB. One fire dancer on a desktop runs ~150k; a mandala of fire dancers shares the cap. */
  flames: 262_144,
  /** Line segments of plasma arcs drawn in one frame (matter/plasma/arcs.ts): an arc with its forks is ~30, so this
   *  holds well over a hundred arcs. 32 bytes each. */
  arcSegments: 4096,
  /** Glows the jogo draws in one frame (src/play/glow.ts: the meters in the world, trails, threads, the results' gems).
   *  48 bytes each, written from the CPU every frame, so 8k is 384 KB a frame at most. */
  glows: 8192,
  /** Gates open in all the worlds at once (src/portals). Each is a row of a small uniform per view (208 bytes), and a
   *  ray test in the pixels its disc covers; eight is a few doors per world. */
  gates: 8,
} as const;

export type Limits = typeof LIMITS;

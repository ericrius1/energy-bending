// The hard caps the shaders are compiled with: the same numbers as engine/limits.ts (where each one's reason is
// written down). `npm test` checks the two files agree, so change them together.

const MAX_DANCERS: u32 = 8u;      // LIMITS.dancers
const MAXJ: u32 = 40u;            // LIMITS.joints: joints per dancer slot
const SEGS: u32 = 32u;            // LIMITS.capsules: capsules per dancer slot
const MAX_SPECIMENS: u32 = 32u;   // LIMITS.specimens
const LODS: u32 = 3u;             // LIMITS.lods
const SPARKS: u32 = 65536u;       // LIMITS.sparks
const MAXEV: u32 = 1024u;         // LIMITS.soundEvents
const MAXLAMP: u32 = 16u;         // LIMITS.lanterns
const MAXTRUNK: u32 = 48u;        // LIMITS.trunks
const FIELD_DEPOSITS: u32 = 32u;  // LIMITS.fieldDeposits
const FIELD_VORTICES: u32 = 4u;   // LIMITS.fieldVortices
const FIELD_PROBES: u32 = 16u;    // LIMITS.fieldProbes
const STEAM_MAX: u32 = 65536u;    // LIMITS.steam
const MAX_GATES: u32 = 8u;        // LIMITS.gates

// The jogo's tunables on the client: how an exchange is felt (the dodge's breath, the knock of a hit, the trails),
// how the forms ease, when building happens by itself, how the meters sit in the world, how fusion stands back. One
// typed group (`bend.params.jogo`, the panel's 'jogo'); the rules' own numbers (what an exchange is worth, the bars of a
// fusion) live in shared/rules.ts and are the server's.
import { defineParams } from '../engine/params';

export const jogoParams = defineParams('jogo', {
  /** the dodge's breath: the dance slows to this speed for `breath` seconds, then eases back over as long again */
  slowmo: 0.28,
  breath: 0.3,
  /** how long the bright trail along an attack's path stays (s) */
  trailLife: 1.1,
  /** a hit's knock (m/s along the stage, up) and the stagger it leaves (s) */
  knock: 3.0,
  knockUp: 3.2,
  stagger: 0.42,
  /** seconds for a dancer's form to ease between its two states (fire ↔ plasma, water ↔ ice) */
  formEase: 1.3,
  /** flow at which a building move sets a piece by itself when it lands perfect (the flourish); below it the build
   *  button (interact, tapped round the move) asks for it */
  autoBuild: 62,
  /** how long the build button stays armed after a tap (s) */
  buildArm: 0.7,
  /** the meters' brightness locked (the side view) and free (3D: out of the way) */
  hudLocked: 1,
  hudFree: 0.45,
  /** fusion: how far (m) the locked view stands back, and how fast the free camera orbits (rad/s) */
  fusionPad: 0.9,
  fusionOrbit: 0.12,
  /** how strongly the fusion turns the air: half of it is the field.fuse strength (m/s at the helix) */
  vortex: 4.5,
  /** how strongly a gamepad rumbles (× each exchange's own) */
  rumble: 1,
  /** the rings of light on the floor (exchanges, unisons, the count-in's pulses, the meters at the feet): 0 hides them
   *  (a film's `set: { jogo: { rings: 0 } }`) */
  rings: 1,
  /** the fusion's pull on the two roots while both hold merge and through the eight bars (0 off; fusion.ts) */
  fusionPull: 1,
}, {
  slowmo: { min: 0.05, max: 1 },
  breath: { min: 0, max: 1 },
  trailLife: { min: 0.1, max: 3 },
  knock: { min: 0, max: 8 },
  knockUp: { min: 0, max: 8 },
  formEase: { min: 0.1, max: 4, label: 'form ease (s)' },
  autoBuild: { min: 0, max: 101, label: 'auto build at flow' },
  hudLocked: { min: 0, max: 2 },
  hudFree: { min: 0, max: 2 },
  fusionPad: { min: 0, max: 4 },
  vortex: { min: 0, max: 12 },
  rumble: { min: 0, max: 2 },
  rings: { min: 0, max: 1 },
  fusionPull: { min: 0, max: 2 },
});

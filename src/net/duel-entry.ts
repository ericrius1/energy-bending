// The online duel's code as the room server and the Node tests load it: server/duel.ts bundles this file with esbuild
// at start-up (the duel's bodies and rules are the game's own TypeScript, which Node can't run as it stands: imports
// without extensions, parameter properties) and imports the bundle. The authority is the server's; the client, the
// brains and the worlds are what the tests drive two pages' worth of with.
export { DuelAuthority, duelWorld, ONLINE_WORLDS } from './duel-authority';
export { DuelClient, CLIENT } from './duel-client';
export { bodySnap, puppet, inputOf, intentOf, kitOf } from './duel-body';
export { DuelBrain } from '../ai/duel-brain';
export { BrainDriver } from '../ai/driver';
export { Scene } from '../ai/scene';
export { Character } from '../dancer/character';
export { duelPlane } from '../duel/match';
export { makeIntent } from '../input/intent';

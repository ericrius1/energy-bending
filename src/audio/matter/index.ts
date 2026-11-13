// Every matter kind's voice, registered by importing this folder (one file per kind; add yours to the list).
// sounds.ts is the contract a kind calls; the rest say how each kind sounds.
import './fire';
import './water';
import './ice';
import './plasma';
import './steam';
export { matterVoices, isVoiced, type MatterEars, type MatterSound, type MatterHold, type Voiced } from './sounds';

// The Sky Forge registers itself as a world (see forge.ts).
import { worlds } from '../world';
import { Forge } from './forge';

worlds.register({ id: 'forge', make: (ctx) => new Forge(ctx) });

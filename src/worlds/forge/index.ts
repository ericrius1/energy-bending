// The Sky Forge registers itself as a world (see forge.ts), and its duel arena (arena.ts).
import { worlds } from '../world';
import { Forge } from './forge';
import { registerForgeArena } from './arena';

worlds.register({ id: 'forge', make: (ctx) => new Forge(ctx) });
registerForgeArena();

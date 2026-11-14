// The Tide Temple registers itself as a world (see temple.ts), and its duel arena (arena.ts).
import { worlds } from '../world';
import { Temple } from './temple';
import { registerTempleArena } from './arena';

worlds.register({ id: 'temple', make: (ctx) => new Temple(ctx) });
registerTempleArena();

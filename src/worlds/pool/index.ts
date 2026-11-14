// The pool registers itself as a world (see pool.ts), and its duel arena (arena.ts).
import { worlds } from '../world';
import { Pool } from './pool';
import { registerPoolArena } from './arena';

worlds.register({ id: 'pool', make: (ctx) => new Pool(ctx) });
registerPoolArena();

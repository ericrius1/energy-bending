// The redwoods register themselves as a world (see redwoods.ts), and their duel arena (arena.ts).
import { worlds } from '../world';
import { Redwoods } from './redwoods';
import { registerRedwoodsArena } from './arena';

worlds.register({ id: 'redwoods', make: (ctx) => new Redwoods(ctx) });
registerRedwoodsArena();

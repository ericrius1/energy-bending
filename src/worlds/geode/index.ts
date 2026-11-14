// The geode registers itself as a world (see geode.ts), and its duel arena (arena.ts).
import { worlds } from '../world';
import { Geode } from './geode';
import { registerGeodeArena } from './arena';
// the hub is also the front of the game: what the first page does round the menu (front.ts; only on the plain page)
import './front';

worlds.register({ id: 'geode', make: (ctx) => new Geode(ctx) });
registerGeodeArena();

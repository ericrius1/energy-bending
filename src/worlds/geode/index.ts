// The geode registers itself as a world (see geode.ts).
import { worlds } from '../world';
import { Geode } from './geode';
// the hub is also the front of the game: what the first page does round the menu (front.ts; only on the plain page)
import './front';

worlds.register({ id: 'geode', make: (ctx) => new Geode(ctx) });

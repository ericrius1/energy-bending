// The geode registers itself as a world (see geode.ts).
import { worlds } from '../world';
import { Geode } from './geode';

worlds.register({ id: 'geode', make: (ctx) => new Geode(ctx) });

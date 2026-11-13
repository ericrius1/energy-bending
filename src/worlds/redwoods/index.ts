// The redwoods register themselves as a world (see redwoods.ts).
import { worlds } from '../world';
import { Redwoods } from './redwoods';

worlds.register({ id: 'redwoods', make: (ctx) => new Redwoods(ctx) });

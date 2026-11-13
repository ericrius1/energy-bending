// The pool registers itself as a world (see pool.ts).
import { worlds } from '../world';
import { Pool } from './pool';

worlds.register({ id: 'pool', make: (ctx) => new Pool(ctx) });

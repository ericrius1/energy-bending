// The Tide Temple registers itself as a world (see temple.ts).
import { worlds } from '../world';
import { Temple } from './temple';

worlds.register({ id: 'temple', make: (ctx) => new Temple(ctx) });

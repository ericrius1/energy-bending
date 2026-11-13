// Water registers itself as a matter kind: one face of the water pool it shares with ice (pool.ts says why). A dancer
// wears it with a loadout layer { kind: 'water', share, parts? }; the game sets a dancer's form (0 water … 1 ice) with
// `form(d, v)` and builds set ice with `setIce` on this kind's passes (or on ice's: they are the same).
import { matterKinds } from '../core/kind';
import { waterPool } from './pool';

matterKinds.register({ id: 'water', declare: (ctx) => waterPool(ctx).passes('water') });

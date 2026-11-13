// Ice registers itself as a matter kind. Ice is water's power form, so it is a face of the same pool of particles as
// water (matter/water/pool.ts): a loadout layer { kind: 'ice', share, parts? } lays out particles that start frozen
// and stay frozen until heat melts them. How ice looks is ice.ts; the set ice the game builds with is setice.ts,
// reached as `setIce` on this kind's passes.
import { matterKinds } from '../core/kind';
import { waterPool } from '../water/pool';

matterKinds.register({ id: 'ice', declare: (ctx) => waterPool(ctx).passes('ice') });

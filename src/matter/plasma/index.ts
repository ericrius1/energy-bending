// Plasma registers itself as a matter kind (a loadout layer `{ kind: 'plasma' }`). Its flames are the fire's pool at
// form 1 (matter/fire/fire.ts flameFor); this kind adds the arcs.
import { matterKinds } from '../core/kind';
import { flameFor } from '../fire/fire';
import { PlasmaPasses } from './plasma';

matterKinds.register({ id: 'plasma', declare: (ctx) => new PlasmaPasses(ctx, flameFor(ctx)) });

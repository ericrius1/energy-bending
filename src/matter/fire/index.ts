// Fire registers itself as a matter kind. Fire and plasma share one pool of flames (fire.ts), so the kind is made
// through flameFor: whichever of the two is declared first makes it.
import { matterKinds } from '../core/kind';
import { flameFor } from './fire';

matterKinds.register({ id: 'fire', declare: (ctx) => flameFor(ctx) });

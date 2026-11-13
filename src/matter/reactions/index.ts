// The reactions register as matter kinds: steam now (born where the field's heat meets its wet). Each is a kind with
// no homes on a body; nobody wears it, the field decides where it is.
import { matterKinds } from '../core/kind';
import { SteamPasses } from './steam';

matterKinds.register({ id: 'steam', declare: (ctx) => new SteamPasses(ctx) });

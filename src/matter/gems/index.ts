// The gems register themselves as a matter kind: their specimens are fetched, then the kind is made (see gems.ts).
import { matterKinds } from '../core/kind';
import { GemPasses } from './gems';

matterKinds.register({
  id: 'gems',
  async declare(ctx) {
    const [index, bin] = await Promise.all([
      fetch(`${ctx.base}specimens/specimens.json`).then((r) => r.json()),
      fetch(`${ctx.base}specimens/specimens.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new GemPasses(ctx, index, bin);
  },
});

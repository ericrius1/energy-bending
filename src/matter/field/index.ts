// The field as a registered matter kind, for what it draws and reports: the overlay that shows the field (?field,
// fieldParams.overlay) and its numbers in bend.stats().matter.field. The field itself (field.ts) is made by main.ts
// before any kind, because every kind's shaders are built against the bind group it shares; nobody wears 'field'.
import { matterKinds, type MatterPasses } from '../core/kind';
import type { ScenePass } from '../../engine/scene';
import debugShader from './debug.wgsl';
import { fieldParams } from './params';

matterKinds.register({
  id: 'field',
  declare(ctx): MatterPasses & { field: typeof ctx.field } {
    const field = ctx.field;
    const look = ctx.kit.uniforms(debugShader.structs.FieldDebug, 'field.debug');
    const [X, Y, Z] = field.dims;
    const cells = (st: number) => Math.ceil(X / st) * Math.ceil(Y / st) * Math.ceil(Z / st);
    return {
      id: 'field',
      /** the field itself (for probes and tests: bend.show.kinds.find((k) => k.id === 'field').field) */
      field,
      declareView(s: ScenePass) {
        if (s.phase !== 'glow') return;
        const enabled = () => s.on() && fieldParams.overlay;
        const common = { bind: { look }, count: 6, blend: 'add' as const, depthWrite: false, cull: 'none' as const, enabled };
        s.pass.draw(debugShader, { ...common, label: `field.debug.cells.${s.world.id}`, constants: { MODE: 0 }, instances: cells(1) });
        s.pass.draw(debugShader, { ...common, label: `field.debug.wind.${s.world.id}`, constants: { MODE: 1 }, instances: cells(2) });
      },
      layout() { /* nobody wears the field */ },
      update() { look.set({ stride: 2, gain: fieldParams.overlayGain, streak: 0.15 }); },
      stats: () => field.stats(),
    };
  },
});

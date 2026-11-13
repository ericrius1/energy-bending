// How hard the frame works: dynamic resolution (weft's AutoResolution holds a 14 ms GPU budget by moving the render
// scale between half and full) or a fixed render scale. A film or a capture turns it off so frames repeat exactly.
import { AutoResolution, type Kit } from '@ericrius1/weft';
import { defineParams, onParams } from './params';

export const perfParams = defineParams('perf', { autoRes: true, renderScale: 1 }, {
  autoRes: { label: 'dynamic resolution' },
  renderScale: { min: 0.25, max: 2, label: 'render scale' },
});

export function applyPerf(kit: Kit, fixed: boolean) {
  const auto = new AutoResolution(14, { min: 0.5, max: 1 });
  const apply = () => {
    kit.autoRes = perfParams.autoRes && !fixed ? auto : null;
    if (!kit.autoRes) kit.renderScale = perfParams.renderScale;
  };
  apply();
  onParams(perfParams, apply);
  return apply;
}

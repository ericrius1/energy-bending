// The plasma arcs' parameters (bend.params.plasma). Plasma's body is flames at form 1, so how it moves and looks is
// in the fire's parameters (matter/fire/params.ts: cling, flicker, plasmaGlow); these are the arcs.
import { defineParams } from '../../engine/params';

export const arcParams = defineParams('plasma', {
  /** arcs between a dancer's hands when the flame on them is plasma (form past 0.4) and they are this close (m) */
  handArcs: true,
  handReach: 1.5,
  /** chance a frame that a hand arc is on (the rest of the time it's between strokes) */
  handDuty: 0.82,
  /** the core's half width (m), before its intensity adds to it */
  width: 0.0035,
  /** the core never thinner than this many pixels */
  minPx: 0.9,
  roughness: 0.22,
  forks: 2,
  glow: 1,
}, {
  handArcs: { label: 'arcs between the hands' },
  handReach: { min: 0.2, max: 3, label: 'hand arc reach (m)' },
  width: { min: 0.0005, max: 0.02, step: 0.0005, label: 'arc width' },
  roughness: { min: 0, max: 0.6, label: 'arc roughness' },
});

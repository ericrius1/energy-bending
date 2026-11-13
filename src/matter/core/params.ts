// Settings every matter kind's body shares, whatever it is made of: how many particles a show runs (a programme
// sets it), and the trails (matter on the hands and feet left hanging in the air, which a programme also sets).
// Each kind reads these into its BodyStep (matter/core/body.wgsl).
import { defineParams } from '../../engine/params';
import { LIMITS } from '../../engine/limits';

export const matterParams = defineParams('matter', {
  /** particles when a programme doesn't say */
  count: 15000,
  /** chance a second that matter on a hand or foot is left hanging in the air */
  trail: 0,
  /** seconds it hangs there */
  trailHold: 4,
}, {
  count: { min: 1000, max: LIMITS.stones, step: 500, label: 'how many' },
  trail: { min: 0, max: 2, label: 'trails in the air' },
});

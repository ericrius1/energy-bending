// Where the hub's gates stand, apart from the geode's drawing (so the show and the front can read them without
// importing a shader). One gate to each world, round the floor facing the middle: the stage's shelves behind, the
// director's shots in front, the wall's crystals well clear of a 1.3 m disc.

import { defineParams } from '../../engine/params';

/** what the hub draws for the front of the game: the high blade (the shelf reaching out over the stage from behind
 *  it, a ledge in play) is left out while the front is up, where the camera stands low behind the stage and would see
 *  its underside as a flat slab over the dancers (dancer/show.ts turns it off and on) */
export const hubParams = defineParams('hub', { highBlade: true }, { highBlade: { label: 'high blade' } });

/** each gate's place on the floor (x, z), by the world it opens on, in the order of their tints (geode.wgsl
 *  geodeGateTint): the pool's and the temple's to either side in front, the redwoods' straight out in front of the
 *  stage, further than they are (past the locked camera, which stands about 7.4 m out on that line and must not stand
 *  behind a disc, and 2.2 m clear of the duel arena's front beam at z 7.4) */
export const HUB_GATES: Record<string, [number, number]> = { pool: [-6.0, 3.0], temple: [6.0, 3.0], redwoods: [0, 9.7] };

/** each hub gate as the geode stands it (its disc's middle 1.35 m up, 1.25 m round, facing the middle) and as the
 *  shelves' layout grows a crown of crystals round it (shelves.ts GateSite; `tint` its world's colour) */
export function hubGates() {
  return Object.entries(HUB_GATES).map(([world, [x, z]], tint) => {
    const l = Math.hypot(x, z);
    return { world, at: [x, 1.35, z] as [number, number, number], normal: [-x / l, 0, -z / l] as [number, number, number], radius: 1.25, tint };
  });
}

/** the gate the front opens on and how far off it the camera turns (rad): the temple's gate to one side of the pair and
 *  the redwoods' to the other, the two best worlds behind the two dancers, and the hub's high blade (which reaches out
 *  over the stage from behind it) above the frame. A chosen world's gate is turned to the same way, mirrored for the
 *  gates on the other side */
export const HUB_OPENING = { world: 'temple', side: -0.3 };

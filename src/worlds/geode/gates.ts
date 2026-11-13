// Where the hub's gates stand, apart from the geode's drawing (so the show and the front can read them without
// importing a shader). One gate to each world, round the floor facing the middle: the stage's shelves behind, the
// director's shots in front, the wall's crystals well clear of a 1.3 m disc.

/** each gate's place on the floor (x, z), by the world it opens on */
export const HUB_GATES: Record<string, [number, number]> = { pool: [-6.0, 3.0], temple: [6.0, 3.0], forge: [-2.9, 6.0], redwoods: [2.9, 6.0] };

/** the gate the front opens on and how far off it the camera turns (rad): the temple's gate to one side of the pair and
 *  the redwoods' to the other, the two best worlds behind the two dancers, and the hub's high blade (which reaches out
 *  over the stage from behind it) above the frame. A chosen world's gate is turned to the same way, mirrored for the
 *  gates on the other side */
export const HUB_OPENING = { world: 'temple', side: -0.3 };

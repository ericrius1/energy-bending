// stages.js — stage geometry as data. Read by physics (character.js), the sim's obstacle mask and the
// world renderer (world.js). World units: x in [-0.89, 0.89] for the 16:9 view, y in [0, 1], y up.
//
// ground:    world y of the ground's surface, or null for a pit (fall out and re-form at a spawn).
// ledges:    { x0, x1, y, solid?, bob?, id }. y is the top surface. One-way (jump up through, drop down
//            with crouch) unless solid. bob: vertical travel in world units, moving with the bass.
// spawns:    where seat 0 and seat 1 appear.
// twist:     'none' | 'tide' (the water level rises and falls over 8 bars) | 'bob' | 'slick'.
// mood:      index into MOODS in audio.js.
// blast:     how far outside the view a dancer may go before re-forming.

export const VIEW = { halfW: 0.89, top: 1.0 };

export const STAGES = [
  {
    id: 'void', name: 'Void', mood: 0, ground: 0.14, twist: 'none', blast: 0.25,
    ledges: [],
    spawns: [[-0.38, 0.14], [0.38, 0.14]],
  },
  {
    id: 'redwoods', name: 'Redwoods', mood: 1, ground: 0.14, twist: 'none', blast: 0.25,
    ledges: [
      { id: 'log', x0: -0.78, x1: -0.26, y: 0.31 },      // the fallen giant
      { id: 'bough', x0: 0.30, x1: 0.74, y: 0.43 },      // a low limb reaching in
      { id: 'high', x0: -0.20, x1: 0.18, y: 0.62 },      // a bough across the clearing
    ],
    spawns: [[-0.45, 0.14], [0.45, 0.14]],
  },
  {
    id: 'tide', name: 'Tide Temple', mood: 2, ground: 0.14, twist: 'tide', blast: 0.25,
    tide: { low: 0.14, high: 0.24, bars: 8 },
    ledges: [
      { id: 'pillarL', x0: -0.72, x1: -0.46, y: 0.35, solid: true },
      { id: 'altar', x0: -0.13, x1: 0.13, y: 0.49, solid: true },
      { id: 'pillarR', x0: 0.46, x1: 0.72, y: 0.35, solid: true },
      { id: 'lintel', x0: 0.22, x1: 0.40, y: 0.68 },
    ],
    spawns: [[-0.59, 0.35], [0.59, 0.35]],
  },
  {
    id: 'forge', name: 'Sky Forge', mood: 3, ground: null, twist: 'bob', blast: 0.3,
    ledges: [
      { id: 'anvil', x0: -0.58, x1: 0.58, y: 0.22, solid: true },
      { id: 'floatL', x0: -0.78, x1: -0.52, y: 0.47, bob: 0.03 },
      { id: 'floatR', x0: 0.52, x1: 0.78, y: 0.47, bob: 0.03 },
      { id: 'crown', x0: -0.15, x1: 0.15, y: 0.63, bob: 0.045 },
    ],
    spawns: [[-0.35, 0.22], [0.35, 0.22]],
  },
];

export const stageById = id => STAGES.find(s => s.id === id) || STAGES[0];

// Height of a bobbing ledge at a given beat position (shared by physics and drawing so they agree).
export function ledgeY(ledge, beat) {
  return ledge.bob ? ledge.y + ledge.bob * Math.sin(beat * Math.PI * 0.5) : ledge.y;
}

// Water level for tide stages at a given beat position.
export function tideY(stage, beat) {
  if (!stage.tide) return stage.ground;
  const t = stage.tide, ph = (beat / (t.bars * 4)) * Math.PI * 2;
  return t.low + (t.high - t.low) * (0.5 - 0.5 * Math.cos(ph));
}

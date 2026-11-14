// Where the music is heard. A world says how it sounds in two parts: its `tone()` (Gem Dancers' description of a
// place: how far under water, how much cave, a hearth, the depth of the sub, how much open wood) and, here, which of
// the engine's moods it plays in and the shape of its reverb (a long glassy cave, an open glade, a stone hall). The
// table covers the worlds (the geode, the redwoods, the pool, the temple); any
// other world gets a mood from its `mood` number and a room from its tone. engine.ts changes mood on a bar line when
// the world changes (a portal crossing), and the synth crossfades the room over that bar.
import { moodIndex } from './harmony';

/** where it's heard: how far under water (the low-pass over the world, Hz), how much cave (the reverb), the hearth
 *  (a fire's crackle off somewhere), the depth (the sub under the bed), the last three 0 … 1 or so; and how much in the
 *  redwoods (0 … 1: their short room, the wood's own sounds) */
export interface Tone { water: number; cave: number; hearth: number; depth: number; forest: number }

/** a reverb's shape: its impulse's length and decay (s), the pre-delay, how bright the tail stays (0 dark … 1),
 *  and how much it wavers (as if heard through moving water, 0 … 1) */
export interface Room { seconds: number; rt60: number; pre: number; bright: number; waver: number }

export interface WorldSound {
  /** the engine's mood (by name: Ember, Midnight, Sunrise, Neon, Roda) */
  mood: string;
  room: Room;
  /** how much of the groove goes into the room (0 … 1, × each sound's own send) */
  grooveWet: number;
}

/** the geode's cave (Gem Dancers' hall: 8 s, a 6.2 s decay, 45 ms before it answers, wavering through the water) */
export const CAVE: Room = { seconds: 8, rt60: 6.2, pre: 0.045, bright: 0.85, waver: 1 };
/** the redwoods' clearing: the trunks round it give a short bright answer */
export const GLADE: Room = { seconds: 3, rt60: 1.6, pre: 0.012, bright: 0.85, waver: 0 };

export const WORLD_SOUND: Record<string, WorldSound> = {
  geode: { mood: 'Ember', room: CAVE, grooveWet: 0.7 },
  redwoods: { mood: 'Midnight', room: GLADE, grooveWet: 1 },
  // still dark water: a long, soft, wavering hall
  pool: { mood: 'Sunrise', room: { seconds: 6, rt60: 4.5, pre: 0.03, bright: 0.6, waver: 0.6 }, grooveWet: 0.7 },
  // a stone temple at the tide line: the roda's home, a medium stone room
  temple: { mood: 'Roda', room: { seconds: 4, rt60: 2.6, pre: 0.02, bright: 0.65, waver: 0 }, grooveWet: 0.85 },
};

/** a world's sound: from the table, or for a world it doesn't know, a mood from its mood number (-1 still … 1 bright)
 *  and a room from its tone (more cave, a longer hall) */
export function worldSound(w: { id: string; mood: number; tone(): Tone }): WorldSound & { moodIndex: number } {
  const known = WORLD_SOUND[w.id];
  if (known) return { ...known, moodIndex: Math.max(0, moodIndex(known.mood)) };
  const m = w.mood;
  const mood = m < -0.35 ? 'Midnight' : m < 0.15 ? 'Ember' : m < 0.6 ? 'Sunrise' : 'Neon';
  const t = w.tone(), cave = Math.max(0, Math.min(1, t.cave));
  const room: Room = t.forest > 0.5 ? GLADE : { seconds: 2 + 5 * cave, rt60: 1 + 5 * cave, pre: 0.01 + 0.03 * cave, bright: 0.7, waver: t.water < 6000 ? 0.6 : 0 };
  return { mood, room, grooveWet: 0.85, moodIndex: moodIndex(mood) };
}

/** how loud the room answers, from the tone (Gem Dancers' cave and glade levels, summed into one room) */
export const wetOf = (t: Tone) => (0.25 + 0.6 * t.cave) * (1 - 0.85 * t.forest) + 0.5 * t.forest;

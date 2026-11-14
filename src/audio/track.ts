// A world's track (a Suno instrumental, shared/tracks.ts, measured by scripts/music-analyze.mjs) as the music's clock
// sees it. The clock's beat 0 is the track's bar 1 (its `downbeat` in the file); the track plays on from there and,
// past the end of its loop, round the loop for ever, so `trackPos` maps any beat on the clock to a place in the file.
// The tempo is the track's (the analysis brought each to one tempo), so a beat on the clock and a beat in the file are
// the same length and nothing drifts. The harmony the game's pitched sounds play in (the matter voices, the stones,
// the feet) is the track's key: its pentatonic for melodies, its seven diatonic triads as the chords, and each bar's
// chord the triad the analysis found in that bar.
import { trackFor, TRACKS, WORLD_TRACKS, type TrackInfo } from '../../shared/tracks.ts';
import { near, type Mood, type Chord } from './harmony';

export { trackFor, TRACKS, WORLD_TRACKS, type TrackInfo };

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const barOf = (t: TrackInfo) => 240 / t.bpm;
/** the loop's ends (s), from its bars (the rounded seconds in the manifest would drift a little each time round) */
export function loopOf(t: TrackInfo) {
  const bar = barOf(t);
  return { start: t.downbeat + t.loop.startBar * bar, end: t.downbeat + t.loop.endBar * bar };
}

/** where in the file (s) the track is at `beats` since its bar 1 (negative: before bar 1, the file's own lead-in, and
 *  before the file begins a negative time) */
export function trackPos(t: TrackInfo, beats: number) {
  // (in beats, so the loop's ends are whole numbers and a beat on its end is its start, not a hair before it)
  const b0 = t.loop.startBar * 4, b1 = t.loop.endBar * 4;
  let b = beats;
  if (b >= b1 - 1e-9) { b = b0 + ((b - b0) % (b1 - b0)); if (b >= b1 - 1e-9) b = b0; }
  return t.downbeat + (b * 60) / t.bpm;
}

/** the bar of the file (0 is bar 1) at `beats` since its bar 1 */
export function trackBar(t: TrackInfo, beats: number) {
  return Math.floor((trackPos(t, beats) - t.downbeat) / barOf(t) + 1e-6);
}

/** the chord (an index into the track's mood's chords) sounding at `beats` */
export function trackChord(t: TrackInfo, beats: number) {
  const b = trackBar(t, beats);
  return b >= 0 && b < t.chords.length ? t.chords[b] : 0;
}

/** the mood a track plays in: its key, tempo and swing, the key's pentatonic, and its seven triads as chords (the bass
 *  on the root in the first octave, four pad voices round the third octave, as harmony.ts's moods have them) */
export function trackMood(t: TrackInfo): Mood {
  const k = t.key.tonic, minor = t.key.mode === 'minor';
  const pent = (minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]).map((i) => (k + i) % 12);
  const chords: Chord[] = t.triads.map((pcs) => {
    const [r, a, b] = pcs, root = near(r, 52);
    const third = (a - r + 12) % 12, fifth = (b - r + 12) % 12;
    const q = third === 4 ? '' : fifth === 6 ? 'dim' : 'm';
    return { name: NOTE[r] + q, bass: near(r, 33), pad: [root, root + third, root + fifth, root + 12], tones: [r, a, b] };
  });
  return { name: t.title, key: t.key.name, bpm: t.bpm, swing: t.swing, pent, low: near(k, 55), chords };
}

// Direction: a film director's loose intentions for a brain, read from a timeline. Not a script that replaces the
// brain: a cue says what the dancer means to do around a moment ("circle left for two bars, offer an armada on 3.1,
// answer low"), and the brain still keeps the music, reads and answers what comes at it, stays generous and safe, and
// fills everything the timeline leaves out. A cue that can't be honoured where the dancers stand (an offer from too
// far away, a side change against a wall) is done as near to its moment as the dance allows, or let go.
//
// It is data on the brain's input (Sight.direction), set per dancer on the Scene:
//
//   scene.direct('seat.1', { cues: [
//     { at: '1.1', bars: 2, circle: 'left' },
//     { at: '3.1', offer: 'armada' },
//     { at: '3.1', bars: 2, answer: 'low' },
//     { at: '5.1', bars: 1, pause: true },
//   ] });
//
// `at` is "bar.beat" (both counted from 1; "3.1" is the first beat of the third bar, "3.2+" the 8th after its second
// beat) or a number of beats, from `origin` (a beat on the music's clock; left out, the beat the direction is first
// seen). The full format is in docs/extending/brain.md.
import type { Level } from './vocabulary';

export interface Cue {
  /** when it starts: "bar.beat" (1-based, "+" for the 8th after) or beats from the origin */
  at: number | string;
  /** how long it holds (bars of 4 beats, or beats); one-shot cues (offer, move, side) are a moment */
  bars?: number;
  beats?: number;
  /** circle the shared centre to this dancer's own left or right (free view), or stop circling */
  circle?: 'left' | 'right' | 'still';
  /** an attack to offer on the beat line nearest `at` (it still comes from the ginga's back step, from where it reads) */
  offer?: string;
  /** any move (a flourish, a clap, an inversion) on the line nearest `at` */
  move?: string;
  /** how to answer what comes during it: low (go under), inverted (over, aú), standing (block or step), clash, none */
  answer?: 'low' | 'inverted' | 'standing' | 'clash' | 'none';
  /** the level it plays at: the ginga low, more low or inverted moves */
  level?: Level;
  /** hold a look: no moves of its own, no circling, the ginga quiet, facing the other */
  pause?: boolean;
  /** the ginga's distance from the other (m) */
  distance?: number;
  /** change sides with the other (over or round them: an aú or a rolê) */
  side?: 'change';
  /** play as if the music were in this mood */
  mood?: 'still' | 'calm' | 'flow' | 'peak';
}

export interface Direction {
  /** the beat that "1.1" and beat 0 stand for (set to the beat it is first seen when left out) */
  origin?: number;
  cues: Cue[];
}

/** a cue's start, in beats from the origin */
export function cueBeat(c: Cue): number {
  if (typeof c.at === 'number') return c.at;
  const m = /^\s*(\d+)(?:\.(\d+(?:\.\d+)?))?(\+)?\s*$/.exec(c.at);
  if (!m) return NaN;
  return (Number(m[1]) - 1) * 4 + (m[2] ? Number(m[2]) - 1 : 0) + (m[3] ? 0.5 : 0);
}

/** how long a cue holds (beats); a one-shot is 0 */
export function cueLength(c: Cue): number {
  if (c.bars != null) return c.bars * 4;
  if (c.beats != null) return c.beats;
  return c.offer || c.move || c.side ? 0 : 4;
}

/** what the direction asks for at `beat` (music clock): the holding cues merged (a later cue over an earlier one), and
 *  the one-shots whose moment falls within `ahead` beats, with their lines */
export interface Asked {
  circle?: 'left' | 'right' | 'still';
  answer?: Cue['answer'];
  level?: Level;
  pause?: boolean;
  distance?: number;
  mood?: Cue['mood'];
  /** one-shots coming up (index in the cue list, the beat line on the music's clock) */
  shots: { i: number; cue: Cue; line: number }[];
}

export function asked(d: Direction, beat: number, ahead = 6): Asked {
  const o = d.origin ?? beat, out: Asked = { shots: [] };
  d.cues.forEach((c, i) => {
    const b = o + cueBeat(c);
    if (!Number.isFinite(b)) return;
    const len = cueLength(c);
    if (len === 0) { if (b >= beat - 1 && b <= beat + ahead) out.shots.push({ i, cue: c, line: b }); return; }
    if (beat < b || beat >= b + len) return;
    if (c.circle) out.circle = c.circle;
    if (c.answer) out.answer = c.answer;
    if (c.level) out.level = c.level;
    if (c.pause != null) out.pause = c.pause;
    if (c.distance != null) out.distance = c.distance;
    if (c.mood) out.mood = c.mood;
  });
  return out;
}

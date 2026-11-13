// A world's track as the music (audio/track.ts, the engine's track mode), written down by a Recorder: the file's place
// for a beat (bar 1, the loop, round it again), the mood made from the track (in its key), and the engine under a
// track: the clock at its tempo, no groove at any level, each bar's chord the track's, a new world's track on the next
// bar line with its bar 1 there, a drop that lands on a bar line without moving the grid, and a room's new epoch
// bringing its track.
import { Engine, grooveParams } from '../engine';
import { Recorder } from '../instrument';
import { pc } from '../harmony';
import { TRACKS, trackPos, trackBar, trackMood, loopOf, barOf } from '../track';
import { check, close, say, type Tests } from './check';

const ids = Object.keys(TRACKS);
const count = (rec: Recorder, ms: string[]) => rec.calls.filter(([k]) => ms.includes(k)).length;
const GROOVE = ['kick', 'clap', 'hat', 'bass', 'pad', 'padColour', 'berimbau', 'pandeiro', 'atabaque', 'tension', 'fusionStep', 'crackle'];

function play(seconds: number, id: string, each?: (e: Engine, t: number) => void) {
  const rec = new Recorder();
  let now = 0;
  const e = new Engine(rec.instrument, () => now, 0);
  e.setTrack(TRACKS[id], true);
  e.clock.anchor(0, 0, 0);
  e.begin(0);
  for (let f = 0; f < seconds * 60; f++) { now = f / 60; each?.(e, now); e.tick(now, now + 0.1); }
  return { rec, e };
}

export const tests: Tests = {
  'the file for a beat: bar 1 at the downbeat, round the loop in whole bars'() {
    for (const id of ids) {
      const t = TRACKS[id], L = loopOf(t), bar = barOf(t);
      close(trackPos(t, 0), t.downbeat, 1e-9, `${id}: beat 0`);
      close((L.end - L.start) / bar, t.loop.endBar - t.loop.startBar, 1e-9, `${id}: the loop is whole bars`);
      const endBeat = t.loop.endBar * 4;
      close(trackPos(t, endBeat), L.start, 1e-6, `${id}: the loop's end is its start`);
      close(trackPos(t, endBeat + 3 * (t.loop.endBar - t.loop.startBar) * 4 + 5), L.start + 5 * (60 / t.bpm), 1e-6, `${id}: three times round`);
      check(trackBar(t, endBeat + 1) === t.loop.startBar, `${id}: the bar after the loop`);
      check(t.loop.end <= t.duration && L.start >= t.downbeat, `${id}: the loop inside the file`);
    }
    say(ids.map((id) => `${id} ${TRACKS[id].bpm.toFixed(3)} bpm, loop bars ${TRACKS[id].loop.startBar}…${TRACKS[id].loop.endBar}`).join('; '));
  },

  'a track\'s mood: its key\'s pentatonic, triads of its scale, the bass on the root'() {
    for (const id of ids) {
      const t = TRACKS[id], m = trackMood(t);
      check(m.pent[0] === t.key.tonic, `${id}: the pentatonic's root`);
      const scale = new Set(t.triads.flat());
      check(scale.size === 7, `${id}: seven notes in the scale`);
      for (const c of m.chords) {
        check(c.tones.every((p) => scale.has(p)), `${id} ${c.name}: in the key`);
        check(pc(c.bass) === c.tones[0], `${id} ${c.name}: the bass on its root`);
        check(c.pad.every((n) => c.tones.includes(pc(n))), `${id} ${c.name}: the pad on its tones`);
      }
      check(m.pent.every((p) => scale.has(p)), `${id}: the pentatonic in the scale`);
      check(t.chords.length === t.bars && t.chords.every((i) => i >= 0 && i < 7), `${id}: a chord a bar`);
    }
  },

  'under a track: its tempo, no groove at any level, its chords bar by bar'() {
    for (const id of ids) {
      const t = TRACKS[id];
      grooveParams.level = 3;
      const { rec, e } = play(12, id);
      grooveParams.level = -1;
      close(e.clock.bpm, t.bpm, 1e-9, `${id}: the clock's tempo`);
      check(count(rec, GROOVE) === 0, `${id}: ${count(rec, GROOVE)} groove calls`);
      const bars = e.events.filter((x) => x.type === 'bar').length;
      check(bars >= 3, `${id}: bars`);
      // the chord at a beat is the track's chord of that bar
      const beat = 4 * 2 + 1, t2 = e.clock.stepTime(e.clock.origin + beat * 4);
      check(e.harmony.at(t2 + 0.001).chord.tones.join() === t.triads[t.chords[trackBar(t, beat)]].join(), `${id}: the third bar's chord`);
    }
  },

  'a new world\'s track: on the next bar line, its bar 1 there, at its tempo'() {
    const { e } = play(6, 'geode', (e, t) => { if (Math.abs(t - 2) < 1e-9) e.setTrack(TRACKS.temple); });
    const ev = e.events.find((x) => x.type === 'track');
    check(ev && ev.id === 'temple', 'the track event');
    const geodeBar = 240 / TRACKS.geode.bpm;
    close(((ev!.t as number) / geodeBar) % 1, 0, 1e-6, 'on a bar line of the old grid');
    check(ev!.t as number >= 2, 'after it was asked for');
    close(e.clock.bpm, TRACKS.temple.bpm, 1e-9, 'the new tempo');
    close(e.clock.beatAt(ev!.t as number), 0, 1e-6, 'its bar 1 on the bar line');
    close(e.trackAt, ev!.t as number, 1e-9, 'trackAt');
    say(`asked at 2 s, the temple's track from ${(ev!.t as number).toFixed(3)} s (the geode's bar line), ${e.clock.bpm.toFixed(3)} bpm`);
  },

  'a drop under a track lands on a bar line and leaves the grid where it was'() {
    let dropAt = -1, before = 0;
    const { e } = play(8, 'forge', (e, t) => { if (Math.abs(t - 3) < 1e-9) { before = e.clock.origin; e.drop(); } });
    const d = e.events.find((x) => x.type === 'drop');
    check(d, 'the drop');
    dropAt = d!.t as number;
    close(e.clock.beatAt(dropAt) % 4, 0, 1e-6, 'on a bar line');
    check(e.clock.origin === before, 'the origin unmoved');
  },

  'a room\'s new epoch brings its track (bar 1 on the epoch)'() {
    const rec = new Recorder();
    let now = 10;
    const e = new Engine(rec.instrument, () => now, 0);
    e.setTrack(TRACKS.geode, true);
    e.syncTo({ epoch: 20000, bpm: TRACKS.temple.bpm, track: TRACKS.temple });
    e.clock.measure(10, 10, 0.016);
    for (let f = 0; f < 600; f++) { now = 10 + f / 60; e.clock.measure(now, now, 1 / 60); e.tick(now, now + 0.1); }
    check(e.track?.id === 'temple', 'the temple\'s track');
    close(e.trackAt, 20, 1e-3, 'from the epoch');
    close(e.clock.beatAt(20), 0, 1e-6, 'its bar 1 on the epoch');
  },
};

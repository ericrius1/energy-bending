// The duel's sound (src/duel/sound.ts, synth/duel.ts): the map from the duel's events to cues (a name not in it is
// ignored; the phase 3 juice names slot in), the quantiser (the nearest line of the coarsest grid within a small window,
// else at once), a whole frame through DuelSound with a Recorder (one catch a moment, each seat's matter its colour,
// the tiers' levels), the set on the music (whole phrases, the phrase lines round a loop, the track placed so "go" is
// a downbeat, followed when it drifts, the set's clock nudged a few percent, nothing in a film), and that every cue
// has its timing, its make-up gain and a voice.
import { Recorder, DUEL_CUES, MOTION_CUES, type DuelCall } from '../instrument';
import { MusicClock } from '../clock';
import { Harmony } from '../harmony';
import { TRACKS, trackMood } from '../track';
import { originListener } from '../spatial';
import { DuelVoices, DUEL_GAIN, tierBright } from '../synth/duel';
import { onGrid, cuesOf, DUEL_SOUNDS, TIMING, DuelSound, SetMusic, phraseSetMs, phraseLine, type DuelSource, type MusicLike } from '../../duel/sound';
import { check, close, say, type Tests } from './check';

type V3 = [number, number, number];

/** a duel source whose frame lists the test fills */
function source(matter: [string, string] = ['fire', 'water']) {
  const f = { events: [] as object[], touches: [] as object[], powers: [] as object[], body: [[], []] as object[][] };
  const src: DuelSource = {
    events: () => f.events, touches: () => f.touches, powers: () => f.powers, body: (k) => f.body[k],
    matter: (k) => matter[k], chest: (k): V3 => [k ? 1 : -1, 1.1, 0],
  };
  return { f, src };
}
function sound(matter?: [string, string], bpm = 100) {
  const rec = new Recorder(), clock = new MusicClock(bpm, 0), H = new Harmony(0);
  H.setCustom(trackMood(TRACKS.temple));
  H.setChord(0, 0);
  let now = 0;
  const { f, src } = source(matter);
  const s = new DuelSound({ out: rec.instrument, now: () => now, clock, harmony: H, listener: originListener }, src);
  const calls = () => rec.calls.filter(([m]) => m === 'duel').map(([, a]) => ({ t: a[0] as number, ...(a[1] as DuelCall) }));
  return { rec, s, f, clock, calls, at: (t: number) => { now = t; } };
}

export const tests: Tests = {
  'the map: known names give their cues, an unknown name nothing, the juice names slot in'() {
    check(cuesOf('touch:aerial', { kind: 'aerial', seat: 1, other: 0, at: [0, 2, 0] })[0].cue === 'aerial', 'an air catch');
    check(cuesOf('duel:finale', { k: 'finale', fused: true })[0].cue === 'fusion', 'a fused finale');
    check(cuesOf('duel:finale', { k: 'finale', fused: false })[0].cue === 'finale', 'the lift');
    check(cuesOf('duel:tier', { k: 'tier', seat: 0, tier: 3 })[0].level === 3, 'a tier carries its level');
    check(cuesOf('duel:nothing-like-this', { k: 'nothing-like-this' }).length === 0, 'an unknown name is ignored');
    check(cuesOf('duel:link', { k: 'link' }).length === 0, 'a link is the touch\'s sound, not its own');
    check(cuesOf('touch:landed', { kind: 'landed', how: 'catch' }).length === 0, 'a flight caught: the catch is the sound');
    check(cuesOf('touch:landed', { kind: 'landed', seat: 0, other: 1, how: 'feet' })[0].seat === 1, 'a flight landed is the flyer\'s');
    check(cuesOf('body:land', { type: 'land', impact: 1 }).length === 0 && cuesOf('body:land', { type: 'land', impact: 8 }).length === 1, 'a landing heard only past a soft one');
    check(cuesOf('body:jump', { type: 'jump', air: false }).length === 0, 'a ground jump is silent');
    for (const p of ['flare', 'ribbon', 'whip', 'wave', 'step', 'slide', 'blink', 'arc', 'pillar', 'prism']) {
      const c = cuesOf('power:cast', { k: 'cast', seat: 0, power: p, at: [0, 1, 0] })[0];
      check(c.cue === 'cast' && c.power === p, `the ${p}'s cast`);
    }
    for (const r of ['geyser', 'melt', 'freeze']) check(cuesOf('power:react', { k: 'react', kind: r, seats: [0, 1], at: [0, 1, 0] })[0].power === r, `the ${r}`);
    // (phase 3's weight and pair combos: the juice's catches and fling and the finale's lift, the pair's tiers and combos)
    check(cuesOf('duel:juice', { k: 'juice', what: 'range', w: 1, hold: 4, seat: 0, other: 1, via: 'whip' })[0].cue === 'range', 'a catch at range');
    check(cuesOf('duel:juice', { k: 'juice', what: 'aerial', w: 0.2, hold: 3, seat: 1 })[0].vel! < cuesOf('duel:juice', { k: 'juice', what: 'aerial', w: 1, hold: 3, seat: 1 })[0].vel!, 'a bigger moment louder');
    check(cuesOf('duel:juice', { k: 'juice', what: 'fling', w: 0.5, hold: 2, seat: 0 })[0].cue === 'fling', 'a fling release');
    check(cuesOf('duel:juice', { k: 'juice', what: 'lift', w: 1, hold: 6 })[0].cue === 'lift', 'the finale lifted, at its top');
    for (const w of ['tier', 'pair', 'merge', 'fusion']) check(cuesOf('duel:juice', { k: 'juice', what: w, w: 1, hold: 3 }).length === 0, `the juice's ${w}: the rules' own event is the sound`);
    const pt = cuesOf('duel:pairTier', { k: 'pairTier', seat: 1, tier: 2, name: 'CURRENT' })[0];
    check(pt.cue === 'tier' && pt.level === 2 && pt.big && pt.other === 0, 'a pair tier, in both colours');
    check(cuesOf('duel:pairCombo', { k: 'pairCombo', n: 20, varied: 12, why: 'idle' })[0].cue === 'bank' && cuesOf('duel:pairCombo', { k: 'pairCombo', n: 20, varied: 12, why: 'fall' }).length === 0, 'a pair combo banked, not dropped');
    // a new name is a line in a map
    check(cuesOf('duel:newThing', { k: 'newThing' }, { ...DUEL_SOUNDS, 'duel:newThing': () => ({ cue: 'bank' }) })[0].cue === 'bank', 'a line added');
  },

  'the beat: the next line within the window is waited for, one just passed is on it, else at once'() {
    const spb = 0.6;
    let g = onGrid(10, 4.95, spb, [1, 0.5], 0.07);
    close(g.t, 10 + 0.05 * spb, 1e-9, 'waits 30 ms for the beat'); check(g.snapped && g.grid === 1, 'on the beat');
    g = onGrid(10, 5.02, spb, [1, 0.5], 0.07);
    check(g.t === 10 && g.snapped, 'just after the beat: at once, on it');
    g = onGrid(10, 5.42, spb, [1, 0.5], 0.07);
    close(g.t, 10 + 0.08 * spb, 1e-9, 'an 8th is nearer than the beat'); check(g.grid === 0.5, 'the 8th');
    g = onGrid(10, 5.2, spb, [1, 0.5], 0.07);
    check(g.t === 10 && !g.snapped, 'between lines: at once, free');
    g = onGrid(10, 5.2, spb, [], 0.07);
    check(g.t === 10 && !g.snapped, 'no grid: free');
    // swung 16ths: the odd one late by the swing
    g = onGrid(0, 0.24, 0.5, [0.25], 0.05, 0.025, 0.2);
    close(g.t, (0.25 + 0.2 * 0.25 - 0.24) * 0.5, 1e-9, 'the swung 16th');
    // over a uniform spread of event times: the share that waits and how long, for the catch's timing
    for (const name of ['catch', 'cast', 'merge'] as const) {
      const T = TIMING[name];
      let snapped = 0, waited = 0, n = 0, worst = 0;
      for (let b = 0; b < 64; b += 0.0137) { const r = onGrid(0, b, 60 / 94, T.grids, T.ahead); n++; if (r.snapped) { snapped++; waited += r.wait; worst = Math.max(worst, r.wait); } }
      check(worst <= T.ahead + 1e-9, `${name}: never waits past its window`);
      say(`${name} at 94 bpm (grids ${T.grids.join(', ')}, ${T.ahead * 1000} ms): ${(100 * snapped / n).toFixed(0)}% on the grid, mean wait ${(1000 * waited / Math.max(1, snapped)).toFixed(1)} ms`);
    }
  },

  'a frame heard: one catch a moment, each seat in its own matter, the tiers by level'() {
    const A = sound(['fire', 'water']);
    A.at(1);
    A.f.touches = [{ kind: 'catch', seat: 0, other: 1, perfect: false, at: [0, 1, 0] }];
    A.f.powers = [{ k: 'catch', seat: 0, other: 1, at: [0, 1, 0], power: 'whip' }];
    A.f.events = [{ k: 'link', seat: 0, kind: 'catch' }, { k: 'tier', seat: 1, tier: 2, name: 'BLOOM' }, { k: 'pairTier', seat: 1, tier: 1, name: 'DUET' }, { k: 'juice', what: 'tier', w: 1, hold: 3, seat: 1 }];
    A.s.frame();
    let c = A.calls();
    check(c.filter((x) => ['catch', 'aerial', 'range'].includes(x.cue)).length === 1, 'one catch');
    check(c.some((x) => x.cue === 'range' && x.matter === 'fire' && x.other === 'water'), 'at range, in fire with water');
    check(c.some((x) => x.cue === 'tier' && x.level === 2 && x.matter === 'water' && !x.big), 'the tier, the water seat\'s');
    check(c.some((x) => x.cue === 'tier' && x.level === 1 && x.big && x.other === 'fire'), 'the pair tier beside it, in both colours');
    check(c.filter((x) => x.cue === 'tier').length === 2, 'the juice tier adds nothing');
    check(A.s.stats().ignored === 1 && A.s.stats().unmapped['duel:link'] === 1, 'the link ignored and counted');
    // the same catch again a frame later is the same moment
    A.at(1 + 1 / 60); A.f.events = []; A.f.powers = [];
    A.s.frame();
    check(A.calls().filter((x) => x.cue === 'catch').length === 0, 'its twin a frame later dropped');
    // a water seat's catch is heard in water
    const B = sound(['water', 'fire']);
    B.at(2); B.f.touches = [{ kind: 'catch', seat: 0, other: 1, perfect: true, at: [0, 1, 0] }];
    B.s.frame();
    c = B.calls();
    check(c[0].matter === 'water' && c[0].other === 'fire', 'water\'s catch, fire caught');
    check(c[0].pan < 0 || c[0].pan === 0 || c[0].pan > 0, 'placed');
    // body events are their seat's, movement on its own (soft) bus
    const C = sound(['ice', 'plasma']);
    C.at(3); C.f.body = [[{ type: 'dash', x: 0, y: 0, z: 0 }], [{ type: 'wallJump', x: 0, y: 0, z: 0 }]];
    C.s.frame();
    c = C.calls();
    check(c.find((x) => x.cue === 'dash')?.matter === 'ice' && c.find((x) => x.cue === 'walljump')?.matter === 'plasma', 'each body in its matter');
    check(MOTION_CUES.has('dash') && MOTION_CUES.has('land') && !MOTION_CUES.has('catch'), 'movement on the motion bus');
  },

  'the tiers rise: higher and brighter each'() {
    for (let t = 1; t < 4; t++) check(tierBright(t + 1) > tierBright(t), `tier ${t + 1} brighter than ${t}`);
    say(`the tiers' brightness: ${[1, 2, 3, 4].map((t) => `${['FLOW', 'BLOOM', 'RADIANT', 'SUBLIME'][t - 1]} ${Math.round(tierBright(t))} Hz`).join(', ')}`);
  },

  'every cue has its timing, its make-up gain and a voice'() {
    const proto = DuelVoices.prototype as unknown as Record<string, unknown>;
    for (const c of DUEL_CUES) {
      check(!!TIMING[c], `${c}: timing`);
      check(DUEL_GAIN[c] > 0, `${c}: gain`);
      check(typeof proto[`c_${c}`] === 'function', `${c}: a voice`);
    }
    for (const [name, rule] of Object.entries(DUEL_SOUNDS)) {
      void rule;
      check(/^(duel|touch|power|body):/.test(name), `${name}: a source's name`);
    }
  },

  'a set of whole phrases, and the phrase lines round a loop'() {
    for (const id of Object.keys(TRACKS)) {
      const t = TRACKS[id], ms = phraseSetMs(60000, t.bpm), bars = ms / (240000 / t.bpm);
      close(bars, Math.round(bars / 4) * 4, 1e-9, `${id}: whole phrases`);
      check(Math.abs(ms - 60000) <= 240000 / t.bpm * 2, `${id}: the nearest to a minute`);
      say(`${id} (${t.bpm.toFixed(2)} bpm): a set of ${Math.round(bars)} bars, ${(ms / 1000).toFixed(2)} s`);
    }
    const g = TRACKS.geode; // its loop starts on bar 52 (startBar 51): the lines inside it from there
    check(phraseLine(7, g) === 0 && phraseLine(9, g) === 16, 'before the loop: every 16 beats from bar 1');
    check(phraseLine(g.loop.startBar * 4 + 7, g) === g.loop.startBar * 4 && phraseLine(g.loop.startBar * 4 + 9, g) === g.loop.startBar * 4 + 16, 'in the loop: from its start');
  },

  'the set on the music: "go" on a downbeat, followed, the set clock nudged, nothing in a film'() {
    const T = TRACKS.temple, clock = new MusicClock(T.bpm, 0);
    let now = 5;
    const placed: number[] = [], stops: number[] = [];
    const M: MusicLike = {
      engine: { clock, track: T, trackAt: 0, trackBeat0: 0, setTrack: () => {}, harmony: { setChord: () => {} } },
      deck: { stop: (f) => { stops.push(f ?? 0); } }, live: { ctx: { state: 'running' } }, loader: null, trackFixed: false, now: () => now,
    };
    const S = new SetMusic(M, () => 'temple', false), spb = 60 / T.bpm, count = spb * 1000;
    // set 1 at duel 0 ms: go 3 counts later is the track's bar 1
    S.set(0, 0, count);
    close(clock.beatAt(now + 3 * spb), 0, 1e-6, 'the first go on bar 1');
    check(stops.length === 1, 'the count-in before the file: the deck starts it on its first sample');
    close(M.engine.trackAt, now + 3 * spb - T.downbeat, 1e-6, 'its first sample');
    placed.push(clock.beatAt(now + 3 * spb));
    // 70 s later the next set: the phrase line nearest where the music got to
    now += 70; const duel = 70000;
    S.set(duel, duel, count);
    const go = clock.beatAt(now + 3 * spb);
    close(go, Math.round(go / 16) * 16, 1e-6, 'the next go on a phrase line');
    check(Math.abs(go - (70 + 3 * spb) / spb) <= 8 + 1e-6, 'the nearest one (at most two bars away)');
    // a context woken late: the music far from the set, put back
    now += 10;
    S.follow(duel + 5000, 'play');
    close(clock.beatAt(now), go + (5000 - 3 * count) / 1000 / spb, 1e-6, 'followed to where the set is');
    check(S.counts.follows === 1, 'once');
    // a small drift (a hold, a hitch) is the set's clock's to make up: a few percent a frame, never more
    S.follow(duel + 5000 - 600, 'play');
    check(S.counts.follows === 1, 'a 600 ms drift is not a jump');
    close(S.nudge(1 / 60, 1 / 60), 0.08 * 1000 / 60, 1e-9, 'nudged by at most 8%');
    // held (a hit-stop, slow motion): not pulled back while it lasts
    check(S.nudge(1 / 60, 0.06 / 60) === 0, 'nothing while the bodies are held');
    // a film: nothing moves
    const F = new SetMusic(M, () => 'temple', true);
    const o0 = clock.origin, g0 = clock.gridTime;
    F.set(0, 0, count); F.follow(1e6, 'play');
    check(clock.origin === o0 && clock.gridTime === g0 && F.nudge(1 / 60, 1 / 60) === 0, 'a film\'s clock is its own');
    void placed;
  },
};

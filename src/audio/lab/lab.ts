// The audio lab (a dev page: /energybending/src/audio/lab/index.html, driven by scripts/audio-lab.mjs). Each scenario
// assembles the real Music (engine, score, conductor, matter ears) in film mode around stand-in worlds and dancers,
// steps it at 60 frames a second like a film, and renders its recorded score offline: a WAV to listen to and the
// numbers of measure.ts for each stretch of it. No GPU: the stones' events are made up the way the GPU reports them.
import { Music } from '../music';
import { grooveParams } from '../engine';
import { renderOffline } from '../synth/synth';
import { wav } from '../instrument';
import { MOODS, moodIndex } from '../harmony';
import { WORLD_SOUND, type Tone, type Room } from '../sound';
import { SFX, FUSIONS, MOVES, type Element, type SfxName, type FusionKind, type DuelCue, type DuelCall } from '../instrument';
import { originListener } from '../spatial';
import type { MatterEars, Voiced } from '../matter';
import { measure, loudest, type Stats } from './measure';
import { labDancer, type LabDancer } from './body';
import type { World } from '../../worlds/world';
import { mulberry32 } from 'math/random';

const STONES = ['amethyst', 'celestite', 'agate', 'citrine', 'quartz', 'emerald', 'rose', 'obsidian', 'malachite', 'pyrite', 'brilliant'];
const GEODE: Tone = { water: 2600, cave: 0.8, hearth: 0.5, depth: 0.5, forest: 0 };
const REDWOODS: Tone = { water: 16000, cave: 0.1, hearth: 0, depth: 0.45, forest: 1 };
/** a plain place for comparing moods: open (no water), a little room */
const PLAIN: Tone = { water: 16000, cave: 0.35, hearth: 0, depth: 0.5, forest: 0 };
const PLAIN_ROOM: Room = { seconds: 3, rt60: 2, pre: 0.015, bright: 0.7, waver: 0 };

function stubWorld(id: string, tone: Tone, mood = 0, day = 0.8): World {
  return { id, mood, tone: () => tone, ambience: () => (tone.forest > 0.5 ? [day, 1 - day, 0.3, 0.5] : null) } as unknown as World;
}

/** a scripted stretch: the music, the world it is in, dancers, and a way to hand stones and matter to it */
interface Run {
  music: Music;
  now: () => number;
  /** a burst of stone events like the GPU's: n stones, of type 1 (landed) 2 (knocked off) 3 (home) */
  stones(n: number, type?: number): void;
  ears: MatterEars;
  /** mark where a measured stretch starts (s) */
  mark(name: string): void;
  /** move to another world (a portal crossing) */
  go(w: World): void;
}

interface Scenario {
  seconds: number;
  world: World;
  dancers?: LabDancer[];
  /** how hard each dancer dances at time t (0 … 1) */
  energy?: (t: number) => number;
  awake?: boolean;
  setup?(r: Run): void;
  each?(r: Run, t: number, frame: number): void;
}

export interface Result { name: string; seconds: number; stats: Stats; loudest: ReturnType<typeof loudest>; segments: Record<string, Stats>; census: Record<string, number>; info: Record<string, unknown>; wav: string }

async function simulate(name: string, sc: Scenario, tail = 3): Promise<Result> {
  let here = sc.world;
  const music = new Music(true, () => here, STONES, originListener, []);
  const marks: [string, number][] = [];
  const rng = mulberry32.create(4242), r = () => mulberry32.sample(rng);
  let listener: MatterEars | null = null;
  const kind: Voiced = { hear: (e) => { listener = e; } };
  kind.hear(music.ears);
  const run: Run = {
    music, now: () => music.filmClock,
    stones(n, type = 1) {
      const ev = new Float32Array(n * 8);
      for (let i = 0; i < n; i++) {
        const o = i * 8, a = r() * 6.283, d = 0.3 + r() * 2.2;
        ev.set([Math.cos(a) * d, 0.05 + r() * 1.6, Math.sin(a) * d, type, Math.floor(r() * STONES.length), 0.3 + r() * 3, 0, 0], o);
      }
      music.score.stones(music.now(), ev, n);
    },
    get ears() { return listener!; },
    mark(m) { marks.push([m, music.filmClock]); },
    go(w) { here = w; music.retone(); },
  };
  sc.setup?.(run);
  const dt = 1 / 60, frames = Math.round(sc.seconds * 60);
  const hand = { sweep: 0, charge: 0 };
  for (let f = 0; f < frames; f++) {
    const t = f * dt;
    music.filmClock = t;
    const e = sc.energy?.(t) ?? 0.5;
    for (const d of sc.dancers ?? []) d.pose(t, dt, e);
    sc.each?.(run, t, f);
    music.frame(dt, (sc.dancers ?? []).map((d) => d.dancer), sc.awake ?? true, hand);
  }
  (window as unknown as { labLast: unknown }).labLast = music.recorder;
  const timing = { build: 0, render: 0 };
  const buf = await renderOffline(music.recorder, sc.seconds + tail, 48000, undefined, timing);
  const L = buf.getChannelData(0), R = buf.getChannelData(1), rate = buf.sampleRate;
  const segments: Record<string, Stats> = {};
  marks.forEach(([m, t0], i) => {
    const t1 = i + 1 < marks.length ? marks[i + 1][1] : sc.seconds;
    segments[m] = measure(L, R, rate, Math.floor(t0 * rate), Math.floor(t1 * rate));
  });
  const bytes = new Uint8Array(wav(buf));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    name, seconds: sc.seconds + tail, stats: measure(L, R, rate), loudest: loudest(L, R, rate), segments, census: music.recorder.census(),
    info: { placed: { ...music.score.placed }, notes: music.conductor.notes, heard: { ...music.ears.heard }, mood: music.engine.mood.name, bpm: +music.engine.clock.bpm.toFixed(1), calls: music.recorder.calls.length, buildMs: Math.round(timing.build), renderMs: Math.round(timing.render) },
    wav: btoa(bin),
  };
}

const ELEMENTS: Element[] = ['fire', 'plasma', 'water', 'ice'];
const bars = (mood: number, n: number) => n * 16 * (60 / MOODS[mood].bpm / 4);

/** the scenarios, by name */
export const SCENARIOS: Record<string, () => Scenario> = {
  // (a) Gem Dancers: the geode, nobody playing, a dancer of gems, stones landing, a prelude, a rise and two blasts
  'ambient-geode': () => ({
    seconds: 36, world: stubWorld('geode', GEODE), dancers: [labDancer('npc', 'mocap', 0, 0)],
    energy: (t) => (t < 6 ? 0.2 : 0.6),
    setup(r) { grooveParams.level = -1; r.music.score.prelude(0.15); r.mark('ambient'); },
    each(r, t, f) {
      if (f === 120) r.music.score.rise(2, 3);
      if (f % 3 === 0) r.stones(2 + (f % 50 === 0 ? 30 : 0));
      if (f === 900 || f === 1680) r.music.score.blast(t, 3);
    },
  }),
  'ambient-redwoods': () => ({
    seconds: 30, world: stubWorld('redwoods', REDWOODS, 0.3, 0.8), dancers: [labDancer('npc', 'mocap', 0, 0)],
    setup(r) { grooveParams.level = -1; r.music.score.prelude(0.15); r.mark('ambient'); },
    each(r, t, f) { if (f % 3 === 0) r.stones(2); if (f === 900) r.music.score.blast(t, 3); },
  }),
  // (g) a portal crossing: the geode's groove, then the redwoods from the next bar line
  portal: () => {
    const sc: Scenario = {
      seconds: 24, world: stubWorld('geode', GEODE),
      setup(r) { grooveParams.level = 2; r.music.score.prelude(0.1); r.mark('geode L2'); },
      each(r, _t, f) {
        if (f === 600) { r.go(stubWorld('redwoods', REDWOODS, 0.3, 0.8)); r.mark('crossing'); }
        if (f === 900) r.mark('redwoods L2');
        if (f % 4 === 0) r.stones(2);
      },
    };
    return sc;
  },
  // (f) the body plays: a player's bending hand, rising from still to wild and back
  melody: () => ({
    seconds: 30, world: stubWorld('geode', GEODE), dancers: [labDancer('you', 'camera', 0, 0)],
    energy: (t) => (t < 4 ? 0.1 : t < 22 ? Math.min(1, (t - 4) / 10) : 0.05),
    setup(r) { grooveParams.level = -1; r.music.score.prelude(0.1); r.mark('still'); },
    each(r, t) { if (Math.abs(t - 4) < 1e-6) r.mark('rising'); if (Math.abs(t - 14) < 1e-6) r.mark('wild'); if (Math.abs(t - 22) < 1e-6) r.mark('let go'); },
  }),
  // (c) the jogo: every move and exchange over the groove, two dancers in the four elements
  barrage: () => ({
    seconds: 24, world: stubWorld('temple', PLAIN),
    setup(r) { grooveParams.level = 2; r.music.engine.setPlace(moodIndex('Roda'), PLAIN, WORLD_SOUND.temple.room, 0.85, true); r.music.engine.begin(0); r.music.engine.jogo = true; r.mark('barrage'); },
    each(r, t, f) {
      if (f < 60 || f % 9) return;
      const k = f / 9, name = SFX[k % SFX.length] as SfxName, el = ELEMENTS[k % 4];
      r.music.sfx(name, { element: el, perfect: k % 3 === 0, pan: Math.sin(k) * 0.7, vel: 0.8, move: MOVES[k % MOVES.length], count: k % 5, final: k % 7 === 0, dur: 1.5 });
      r.music.tension = Math.min(1, t / 20);
    },
  }),
  // (c) each effect alone, 1.6 s apart, nothing under it: their own peaks
  'sfx-solo': () => {
    const list: [SfxName, Element, string?][] = [];
    for (const n of SFX) {
      if (n === 'move') for (const m of MOVES) list.push(['move', m === 'throw' ? 'water' : 'fire', m]);
      else if (n === 'formOn' || n === 'formOff') { list.push([n, 'fire']); list.push([n, 'water']); }
      else list.push([n, 'fire']);
    }
    return {
      seconds: list.length * 1.6 + 1, world: stubWorld('plain', PLAIN),
      setup(r) { grooveParams.level = 0; r.music.engine.setPlace(0, PLAIN, PLAIN_ROOM, 1, true); },
      each(r, t, f) {
        const i = Math.round(t / 1.6 - 0.5);
        if (f % 96 === 48 && i < list.length) {
          const [n, el, move] = list[i];
          r.mark(`${n}${move ? ':' + move : ''}:${el}`);
          r.music.sfx(n, { element: el, move, vel: 0.8, count: 2, dur: 1.2 });
        }
      },
    };
  },
  // (e) every matter voice: held sounds rising and falling, events now and then, moving left to right
  matter: () => ({
    seconds: 40, world: stubWorld('plain', PLAIN),
    setup(r) { grooveParams.level = 0; r.music.engine.setPlace(0, PLAIN, PLAIN_ROOM, 1, true); r.music.engine.begin(0); },
    each(r, t, f) {
      const seg = Math.floor(t / 8), u = (t % 8) / 8, x = -4 + 8 * u, amount = Math.sin(Math.PI * u);
      const kinds = ['fire', 'water', 'ice', 'plasma', 'steam'];
      if (t % 8 < 1e-6) r.mark(kinds[seg]);
      const k = kinds[seg], e = r.ears;
      if (k === 'fire') { e.hold({ kind: 'fire', type: 'roar', key: 'a', x, y: 1, z: 0, amount, speed: 6 * amount }); if (f % 11 === 0) e.event({ kind: 'fire', type: 'crackle', x, y: 1, z: 0, strength: amount }); if (f === 240) e.event({ kind: 'fire', type: 'flare', x, y: 1, z: 0, strength: 1 }); }
      if (k === 'water') { e.hold({ kind: 'water', type: 'pour', key: 'a', x, y: 1, z: 0, amount, speed: 3 }); if (f % 40 === 0) e.event({ kind: 'water', type: 'splash', x, y: 0, z: 0, strength: amount }); if (f % 23 === 0) e.event({ kind: 'water', type: 'drip', x, y: 1.5, z: 0, strength: 0.6 }); }
      if (k === 'ice') { if (f % 13 === 0) e.event({ kind: 'ice', type: 'tick', x, y: 1, z: 0, strength: 0.6 }); if (f % 120 === 30) e.event({ kind: 'ice', type: 'crack', x, y: 1, z: 0, strength: 0.8 }); if (f === 18 * 60) e.event({ kind: 'ice', type: 'shatter', x, y: 1, z: 0, strength: 1 }); }
      if (k === 'plasma') { e.hold({ kind: 'plasma', type: 'buzz', key: 'a', x, y: 1, z: 0, amount, speed: 4 * amount }); if (f % 37 === 0) e.event({ kind: 'plasma', type: 'zap', x, y: 1, z: 0, strength: 0.8, extra: 1.5 }); }
      if (k === 'steam') { e.hold({ kind: 'steam', type: 'hiss', key: 'a', x, y: 1, z: 0, amount, speed: 2 }); if (f % 90 === 0) e.event({ kind: 'steam', type: 'puff', x, y: 1, z: 0, strength: 0.8 }); }
    },
  }),
  // (h) the determinism check: 20 s of everything at once, scripted
  everything: () => ({
    seconds: 20, world: stubWorld('geode', GEODE), dancers: [labDancer('you', 'camera', 0.6, 0), labDancer('npc', 'mocap', -0.6, 0, 1)],
    energy: (t) => Math.min(1, t / 8),
    setup(r) { grooveParams.level = -1; r.music.score.prelude(0.1); r.mark('all'); },
    each(r, t, f) {
      if (f % 3 === 0) r.stones(3);
      if (f === 300) r.music.drop();
      if (f === 840) r.music.fusion('storm');
      if (f % 30 === 0) r.music.sfx(SFX[(f / 30) % SFX.length], { element: ELEMENTS[(f / 30) % 4], move: MOVES[(f / 30) % MOVES.length] });
      r.ears.hold({ kind: 'fire', type: 'roar', key: 'you', x: 0.6, y: 1, z: 0, amount: 0.6, speed: 3 + 2 * Math.sin(t) });
      if (f % 17 === 0) r.ears.event({ kind: 'water', type: 'drip', x: -1, y: 1.2, z: 0.5, strength: 0.5 });
      r.music.tension = Math.min(1, t / 12);
    },
  }),
};
// (i) the duel's sounds (synth/duel.ts), each alone, nothing under it: the set's, the contact's in two matters, the
// ten powers, the reactions, the form, the tiers, the movement voices in every matter. On the plain place's mood
const DUEL_SOLO: [DuelCue, string, Partial<DuelCall>?][] = [
  ['count', 'fire', { level: 3 }], ['count', 'fire', { level: 2 }], ['count', 'fire', { level: 1 }], ['go', 'fire'],
  ...(['fire', 'water', 'ice', 'plasma', 'gems'] as const).map((m): [DuelCue, string, Partial<DuelCall>] => ['catch', m, { other: m === 'water' ? 'fire' : 'water' }]),
  ['aerial', 'water', { other: 'fire' }], ['range', 'water', { other: 'fire' }], ['swing', 'fire', { level: 1 }], ['swing', 'fire', { level: 3 }],
  ['fling', 'fire'], ['fling', 'water'], ['landed', 'water'], ['lift', 'ice'], ['counter', 'plasma'], ['release', 'fire'],
  ['merge', 'fire', { other: 'water' }], ['finale', 'fire', { other: 'water' }], ['fusion', 'fire', { other: 'water' }], ['banner', 'water'],
  ['tier', 'water', { level: 1 }], ['tier', 'water', { level: 2 }], ['tier', 'water', { level: 3 }], ['tier', 'water', { level: 4 }], ['bank', 'fire'],
  ['fall', 'fire'], ['reform', 'fire'],
  ...([['flare', 'fire'], ['ribbon', 'fire'], ['whip', 'water'], ['wave', 'water'], ['step', 'ice'], ['slide', 'ice'], ['blink', 'plasma'], ['arc', 'plasma'], ['pillar', 'gems'], ['prism', 'gems']] as const)
    .map(([p, m]): [DuelCue, string, Partial<DuelCall>] => ['cast', m, { power: p, dur: 2 }]),
  ['react', 'fire', { power: 'geyser' }], ['react', 'fire', { power: 'melt' }], ['react', 'water', { power: 'freeze' }],
  ['form', 'fire', { on: true }], ['form', 'fire', { on: false }], ['launch', 'gems'], ['swap', 'plasma'], ['redirect', 'gems'],
  ...(['fire', 'water', 'ice', 'plasma', 'gems'] as const).flatMap((m): [DuelCue, string, Partial<DuelCall>][] => [['dash', m, {}], ['walljump', m, {}], ['land', m, { level: 0.7 }]]),
  ['jump', 'fire'],
];
SCENARIOS['duel-solo'] = () => {
  const gap = 2.2;
  return {
    seconds: DUEL_SOLO.length * gap + 2, world: stubWorld('plain', PLAIN),
    // (no bed under it: each sound's own level)
    setup(r) { grooveParams.level = 0; r.music.engine.setPlace(0, PLAIN, PLAIN_ROOM, 1, true); },
    each(r, t, f) {
      const i = Math.round(t / gap - 0.5);
      if (f % Math.round(gap * 60) !== Math.round(gap * 30) || i >= DUEL_SOLO.length) return;
      const [cue, matter, x] = DUEL_SOLO[i], E = r.music.engine;
      r.mark(`${cue}${x?.power ? ':' + x.power : ''}:${matter}${x?.level != null && cue !== 'land' ? ':' + x.level : ''}${x?.on === false ? ':off' : ''}`);
      E.out.duel(t, { cue, matter, pan: 0, dist: 0.1, vel: 0.85, level: 1, H: E.harmony.at(t), spb: 60 / E.clock.bpm, seed: (i * 0.618) % 1, ...x });
    },
  };
};
// (b) each mood at levels 1 to 4 (six bars each, after two of level 0), in the plain place
MOODS.forEach((m, i) => {
  SCENARIOS[`mood-${m.name.toLowerCase()}`] = () => {
    const seg = bars(i, 6), start = bars(i, 2);
    return {
      seconds: start + 4 * seg, world: stubWorld('plain', PLAIN),
      setup(r) { grooveParams.level = 0; r.music.engine.setPlace(i, PLAIN, PLAIN_ROOM, 1, true); r.music.engine.begin(0); },
      each(r, t) {
        const L = t < start ? 0 : 1 + Math.floor((t - start) / seg);
        if (L !== grooveParams.level && L <= 4) { grooveParams.level = L; r.mark(`L${L}`); }
      },
    };
  };
});
// (d) each fusion: two bars of groove, the fusion's eight bars and its bar back
FUSIONS.forEach((k: FusionKind) => {
  SCENARIOS[`fusion-${k}`] = () => ({
    seconds: bars(0, 13), world: stubWorld('plain', PLAIN),
    setup(r) { grooveParams.level = 2; r.music.engine.setPlace(0, PLAIN, PLAIN_ROOM, 1, true); r.music.engine.begin(0); r.mark('groove'); },
    each(r, t) {
      if (Math.abs(t - bars(0, 2) + 0.4) < 1 / 120) { r.music.fusion(k); }
      if (Math.abs(t - bars(0, 2.5)) < 1 / 120) r.mark('fusion');
      if (Math.abs(t - bars(0, 10.5)) < 1 / 120) r.mark('back');
    },
  });
});

export async function render(name: string) {
  const make = SCENARIOS[name];
  if (!make) throw new Error(`no scenario '${name}' (${Object.keys(SCENARIOS).join(', ')})`);
  const res = await simulate(name, make());
  grooveParams.level = -1;
  return res;
}

Object.assign(window, { lab: { render, scenarios: Object.keys(SCENARIOS) } });
document.title = 'audio lab: ready';

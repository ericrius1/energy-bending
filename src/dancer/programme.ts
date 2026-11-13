// The programme: Gem Dancers' director, without the camera. Asleep, the matter lies in a heap on the floor. Woken,
// it rises into the first dancers, feet first; each dance plays for a while, the camera's shot changing now and then;
// then the dancers shatter and the matter settles on the floor and rises again as the next dance (dressed as the last
// one shatters, so what it needs is already falling with the rest). The camera rig eases to the shot it names.
// The front of the game (dancer/show.ts) opens it awake on a programme of its own (FRONT), the rise a quick flourish,
// and keeps to that one dance: its two bodies are the ones being chosen.
import type { Shot } from '../engine/shots';
import type { CameraRig } from '../engine/camera';
import { defineParams } from '../engine/params';

export interface Program {
  title: string;
  note: string;
  /** a piece from motion.json, or 'ensemble' */
  piece: string;
  /** a gem suite per dancer, round the ring if there are more dancers than suites */
  suites: string[];
  /** the music's key (midi root) */
  key: number;
  seconds: number;
  /** a mandala: this many copies of the dancer in a ring, each `canon` seconds behind the one before */
  ring?: number;
  canon?: number;
  /** chance a second that matter on a hand or foot is left hanging in the air */
  trails?: number;
  /** particles (the default otherwise) */
  count?: number;
  shots: Shot[];
}

const RING = ['Violet', 'Dawn', 'Sky', 'Ember', 'Forest', 'Blue lace', 'Midnight', 'Violet'];
export const PROGRAMS: Program[] = [
  { title: 'Salsa', note: 'amethyst and celestite, a couple', piece: 'salsa', suites: ['Violet', 'Sky'], key: 53, seconds: 34, shots: ['wide', 'close', 'orbit', 'low'] },
  { title: 'Pirouettes', note: 'celestite, leaving diamonds in the water', piece: 'pirouette', suites: ['Sky'], key: 50, seconds: 28, trails: 0.55, shots: ['orbit', 'close', 'high', 'wide'] },
  { title: 'Mandala', note: 'arching arms, six times round', piece: 'arch', suites: RING, ring: 6, canon: 0.3, key: 55, seconds: 28, count: 26000, shots: ['overhead', 'crown'] },
  { title: 'Indian dance', note: 'citrine, pyrite and obsidian', piece: 'indian', suites: ['Ember'], key: 52, seconds: 32, shots: ['low', 'close', 'wide', 'feet'] },
  { title: 'Grand jeté', note: 'rose quartz, and its wake', piece: 'jete', suites: ['Dawn'], key: 48, seconds: 26, trails: 0.6, shots: ['wide', 'low', 'orbit'] },
  { title: 'Ensemble', note: 'three dances at once', piece: 'ensemble', suites: ['Forest', 'Violet', 'Dawn'], key: 57, seconds: 32, count: 21000, shots: ['wide', 'high', 'orbit'] },
  { title: 'Mandala', note: 'the Charleston, eight times round', piece: 'charleston', suites: RING, ring: 8, canon: 0.08, key: 53, seconds: 26, count: 28000, shots: ['crown', 'overhead'] },
  { title: 'Breaking', note: 'malachite and emerald', piece: 'breaking', suites: ['Forest'], key: 50, seconds: 28, shots: ['low', 'feet', 'orbit'] },
];

/** the front of the game's own dance: the salsa couple (two bodies: the ones being chosen), framed low, whole, with the
 *  gates standing behind them and the hub's high blade above the frame (one shot: the front turns it slowly itself) */
export const FRONT: Program = { ...PROGRAMS[0], title: 'Front', note: 'the two bodies being chosen', seconds: 48, shots: ['low'] };

export const danceParams = defineParams('dance', {
  /** slowed, like dancing under water (it slows the matter too) */
  speed: 0.72,
  /** move on to the next dance by itself */
  auto: true,
  /** stretch every dance by this */
  length: 1,
}, {
  speed: { min: 0, max: 2 },
  auto: { label: 'move on by itself' },
  length: { min: 0.3, max: 3, label: 'dance length' },
});

export type Act = 'asleep' | 'rising' | 'dancing' | 'falling';

/** what the programme asks of the rest of the show (dancer/show.ts) */
export interface Stagehand {
  /** dress the stage for a programme: its dancers and their matter's new homes (nothing moves yet) */
  stage(p: Program): void;
  /** the resting matter rises, feet first, over `spread` seconds; and the sound of it */
  rise(spread: number): void;
  /** blow the dancers apart; what falls stays down until the next rise */
  shatter(): void;
}

export class Programme {
  act: Act = 'asleep';
  index = 0;
  /** seconds into the current act */
  clock = 0;
  /** seconds from the first particle up (the feet) to the last (the head); the rise; the fall between dances */
  spread = 3.6;
  riseTime = 7.2;
  fallTime = 6.4;
  /** how long a shot holds */
  hold = 11;
  private shotIx = 0;
  private shotClock = 0;

  constructor(private hand: Stagehand, private rig: CameraRig) {}

  get program() { return this.own ?? PROGRAMS[this.index % PROGRAMS.length]; }
  /** a programme of the page's own, outside the list (the front's): danced instead of PROGRAMS[index], again and again */
  private own: Program | null = null;
  get awake() { return this.act !== 'asleep'; }

  /** the first touch: the heap rises into the first dancers */
  wake() { if (this.act === 'asleep') this.enter('rising'); }

  /** the front's opening: awake at once, the rise a quick flourish (`spread` s, feet to head) that is dancing within
   *  `dancingIn` s, on programme p (staged now), kept to it. No sound: the first gesture starts it (a browser's rule) */
  open(p: Program, spread = 0.6, dancingIn = 1.2) {
    this.own = p;
    this.hand.stage(p);
    this.act = 'rising';
    this.rig.falling = false;
    this.hand.rise(spread);
    this.cutTo(this.program.shots[0], true);
    this.clock = Math.max(0, this.riseTime - dancingIn);
  }
  /** on to the next dance now */
  next() { if (this.act === 'dancing' || this.act === 'rising') this.enter('falling'); }
  /** jump to programme i: the stage is dressed at once and the matter rises */
  goto(i: number) {
    this.index = i;
    this.own = null;
    this.hand.stage(this.program);
    this.enter('rising');
  }

  private enter(act: Act) {
    this.act = act;
    this.clock = 0;
    this.rig.falling = act === 'falling';
    if (act === 'rising') {
      this.hand.rise(this.spread);
      this.cutTo(this.program.shots[0], true);
    } else if (act === 'falling') {
      this.hand.shatter();
      if (!this.own) this.index = (this.index + 1) % PROGRAMS.length;
      this.hand.stage(this.program);
    }
  }

  private cutTo(s: Shot, reset = false) {
    this.rig.shoot(s);
    this.shotClock = 0;
    if (reset) this.shotIx = 0;
  }

  update(dt: number) {
    this.clock += dt;
    const p = this.program;
    if (this.act === 'rising' && this.clock > this.riseTime) this.enter('dancing');
    else if (this.act === 'dancing' && danceParams.auto && this.clock > p.seconds * danceParams.length) this.enter('falling');
    else if (this.act === 'falling' && this.clock > this.fallTime) this.enter('rising');
    // the shots: each holds for a while, the camera easing from one to the next
    this.shotClock += dt;
    if (this.act === 'dancing' && this.shotClock > this.hold + (this.shotIx % 2) * 3) {
      this.shotIx = (this.shotIx + 1) % p.shots.length;
      this.cutTo(p.shots[this.shotIx]);
    }
  }
}

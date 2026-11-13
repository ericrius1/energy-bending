// The driver: one brain at the controls of one body. Each frame it builds the brain's Sight from the Scene, asks the
// brain for an Intent, and lays the brain's body hints on the Character before it steps (which named move "spin up"
// means, the idle: the ginga at the brain's groove blended toward a groove clip, where to face). As an IntentSource
// (`source()`, a BotSource: "a bot is a function that fills an Intent") it plugs into an IntentController like any
// device, so in the page a brain's dancer is an ordinary player's dancer: same body physics, moves, retargeter and
// motion-matched walk, and to the rules and the network the same events.
import type { Character } from '../dancer/character';
import { BotSource } from '../input/touch';
import { makeIntent, type Intent } from '../input/intent';
import { NP } from '../dancer/moves';
import type { Brain, StageView } from './brain';
import type { Scene, SceneBody } from './scene';
import { idlePose, type ClipGroove } from './clips';

export class BrainDriver {
  /** the flourish when the brain names none (the pirouette, as ?play gives a player) */
  defaultFlourish: string | null = null;
  /** what the brain chose last frame (for stats and the hooks) */
  intent: Intent = makeIntent();
  private groove = 1;
  private low = 0;
  private clip: ClipGroove | null = null;
  private clipW = 0;
  private tmp = new Float32Array(NP);
  private bpm = 112;

  constructor(readonly brain: Brain, readonly body: SceneBody & { character: Character }, private scene: Scene, private stage: () => StageView) {
    const c = body.character;
    // the idle the brain's hints shape: the ginga at its groove, blended toward a clip
    c.idle = (out, beat) => idlePose(out, beat, this.bpm, this.groove, this.clip, this.clipW, this.tmp, this.low);
  }

  get character() { return this.body.character; }

  /** this frame's Intent (call once per frame, after Scene.update, before the body steps) */
  think(): Intent {
    const s = this.scene.sight(this.body, this.stage());
    const it = this.brain.think(s);
    this.apply(s.dt, s.bpm);
    this.intent = it;
    return it;
  }

  /** the hints onto the body: eased, so nothing pops */
  private apply(dt: number, bpm: number) {
    const h = this.brain.body, c = this.body.character;
    this.bpm = bpm;
    c.flourish = h.flourish ?? this.defaultFlourish;
    if (h.lookAt) c.lookAt = h.lookAt;
    const k = 1 - Math.exp(-dt / 0.35);
    this.groove += (h.groove - this.groove) * k;
    this.low += (h.low - this.low) * (1 - Math.exp(-dt / 0.8));
    // a new clip waits for the old one to fade out
    if (h.clip !== this.clip) {
      if (!this.clip || this.clipW < 0.02) { this.clip = h.clip; this.clipW = 0; }
      else this.clipW += (0 - this.clipW) * (1 - Math.exp(-dt / 0.25));
    } else this.clipW += ((h.clip ? h.clipW : 0) - this.clipW) * (1 - Math.exp(-dt / 0.5));
  }

  /** as an IntentSource for an IntentController (it thinks when the controller asks) */
  source(name = this.brain.name): BotSource {
    return new BotSource((_dt, it) => { Object.assign(it, this.think()); }, name);
  }
}

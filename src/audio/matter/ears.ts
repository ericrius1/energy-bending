// The ears a matter kind is handed (the other side of sounds.ts): each event is placed (pan and distance from the
// listener), given its note from the chord at its time if its voice is pitched, put on the grid if the voice asks and
// the groove runs, and handed to the instrument; each held sound is restated to it, and one not restated this frame
// is let go (its amount to 0) when the frame's sounds are flushed. Unknown kinds and types are ignored, once warned.
import { matterVoices, seedOf, type MatterEars, type MatterSound, type MatterHold } from './sounds';
import type { Instrument, HoldPlay } from '../instrument';
import type { Harmony } from '../harmony';
import { panOf, distOf, type Listener } from '../spatial';
import { Gate } from '../gate';

export interface EarsHost { readonly grooving: boolean; place(t: number): number }

export class Ears implements MatterEars {
  private live = new Map<string, { fresh: boolean; last: HoldPlay }>();
  private warned = new Set<string>();
  private gate = new Gate(0.01, 0.25);
  /** counts by kind.type (the measurements and tests read them) */
  readonly heard: Record<string, number> = {};

  constructor(public out: Instrument, private h: Harmony, private host: EarsHost, public listener: Listener, readonly now: () => number) {}

  event(e: MatterSound) {
    const v = matterVoices.has(e.kind) ? matterVoices.get(e.kind).events[e.type] : undefined;
    if (!v) { this.warn(`${e.kind}.${e.type}`); return; }
    const seed = seedOf(e.x, e.y, e.z);
    let t = e.when ?? this.now();
    if (v.grid) t = this.host.place(t);
    const midi = v.note ? v.note(this.h, t, seed, e) : 0;
    this.out.matter(t, e.kind, e.type, {
      pan: panOf(this.listener, e.x, e.y, e.z), dist: distOf(this.listener, e.x, e.y, e.z),
      strength: e.strength, midi, tones: this.h.at(t).chord.tones, seed, extra: e.extra ?? 0,
    });
    const k = `${e.kind}.${e.type}`;
    this.heard[k] = (this.heard[k] ?? 0) + 1;
  }

  hold(s: MatterHold) {
    const v = matterVoices.has(s.kind) ? matterVoices.get(s.kind).holds?.[s.type] : undefined;
    if (!v) { this.warn(`${s.kind}.${s.type} (held)`); return; }
    const t = this.now(), key = `${s.kind}:${s.type}:${s.key}`;
    const p: HoldPlay = {
      amount: Math.max(0, s.amount), speed: Math.max(0, s.speed), pan: panOf(this.listener, s.x, s.y, s.z), dist: distOf(this.listener, s.x, s.y, s.z),
      midi: v.note ? v.note(this.h, t) : 0, tones: this.h.at(t).chord.tones,
    };
    this.live.set(key, { fresh: true, last: p });
    if (this.gate.pass(key, t, p.amount, p.speed, p.pan, p.dist, p.midi)) this.out.hold(t, key, s.kind, p);
  }

  /** end of a frame: a held sound nobody restated is let go */
  flush() {
    const t = this.now();
    for (const [key, s] of this.live) {
      if (s.fresh) { s.fresh = false; continue; }
      this.out.hold(t, key, key.split(':')[0], { ...s.last, amount: 0 });
      this.live.delete(key);
    }
  }

  private warn(what: string) {
    if (this.warned.has(what)) return;
    this.warned.add(what);
    console.warn(`audio: no matter voice for ${what} (see docs/extending/sound.md)`);
  }
}

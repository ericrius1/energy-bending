// The InputHub: who is playing with what. The first device anyone uses (a key, a gamepad button, a touch) becomes
// player one; the next different device, player two. One keyboard can be split: player one on the keyboard alone has
// the solo layout (WASD, J K L, the mouse); when someone presses the arrows or , . / the keyboard splits into the left
// and right layouts. Gamepads join and leave as they're plugged (a pad that goes away leaves its player standing, in
// ginga, until it's back). The camera body and bots join when asked (joinCamera, join). Plain DOM events and polling;
// `listen` can be off for tests, which call key / touch / poll themselves.
import { KeyboardSource, keysOf, type KeyLayout, type KeyboardOptions } from './keyboard';
import { GamepadHub, type GetPads, type GamepadSource } from './gamepad';
import { TouchSource } from './touch';
import { hasDOM, type IntentSource, type Scheme } from './intent';

export type Device = 'keyboard' | 'gamepad' | 'touch' | 'camera' | 'bot';
export interface Player {
  /** 0 for player one, 1 for player two */
  index: number;
  source: IntentSource;
  device: Device;
  /** the gamepad's index, or the keyboard's layout */
  slot: number | KeyLayout;
}

export interface HubOptions {
  /** most players (2: a jogo) */
  max?: number;
  /** where keys and touches come from (null: nowhere, for tests) */
  target?: EventTarget | null;
  /** the canvas: touches on it and the mouse for the solo layout */
  canvas?: HTMLElement | null;
  getPads?: GetPads;
  /** per player: where the dancer's bending shoulder is on screen (the mouse aims from there), which way it faces */
  dancerScreen?: (player: number) => { x: number; y: number; reach: number } | null;
  facing?: (player: number) => number;
}

const SOLO = keysOf('solo'), RIGHT = keysOf('right');

export class InputHub {
  readonly players: Player[] = [];
  /** a new player (index, source); and a player whose source changed (the keyboard split) */
  onJoin: ((p: Player) => void) | null = null;
  onChange: ((p: Player) => void) | null = null;
  readonly pads: GamepadHub;
  private max: number;
  private _scheme: Scheme = 'jogo';
  /** what the buttons mean for every device seated now and later: the jogo's or the duel's (input/intent.ts Scheme) */
  get scheme() { return this._scheme; }
  set scheme(s: Scheme) { this._scheme = s; for (const p of this.players) if (p.device !== 'bot' && p.device !== 'camera') p.source.scheme = s; }
  private handlers: [EventTarget, string, EventListener][] = [];

  constructor(private o: HubOptions = {}) {
    this.max = o.max ?? 2;
    this.pads = new GamepadHub({ getPads: o.getPads, target: o.target === null ? null : undefined });
    if (hasDOM && o.target !== null) {
      const t = o.target ?? window;
      const on = (el: EventTarget, ev: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => { el.addEventListener(ev, fn, opts); this.handlers.push([el, ev, fn]); };
      // capture: the hub sees the key before a new source exists to hear it, and hands it over
      on(t, 'keydown', (e: KeyboardEvent) => { if (!e.repeat && !(e.target as HTMLElement)?.closest?.('input, select, textarea')) this.key(e.code); }, { capture: true });
      if (o.canvas) on(o.canvas, 'pointerdown', (e: PointerEvent) => { if (e.pointerType !== 'mouse') this.touch(e.pointerId, e.clientX, e.clientY); }, { capture: true });
    }
  }

  get full() { return this.players.length >= this.max; }
  private add(source: IntentSource, device: Device, slot: number | KeyLayout) {
    const p: Player = { index: this.players.length, source, device, slot };
    if (device !== 'bot' && device !== 'camera') source.scheme = this._scheme;
    this.players.push(p);
    this.onJoin?.(p);
    return p;
  }
  private keyboard(layout: KeyLayout, player: number) {
    const opts: KeyboardOptions = {
      target: this.o.target === null ? null : undefined, mouseTarget: this.o.canvas ?? null,
      dancerScreen: this.o.dancerScreen ? () => this.o.dancerScreen!(player) : undefined,
      facing: this.o.facing ? () => this.o.facing!(player) : undefined,
    };
    const k = new KeyboardSource(layout, opts);
    k.scheme = this._scheme;
    return k;
  }

  /** a key went down somewhere (the DOM calls this; tests may) */
  key(code: string) {
    const kb = this.players.filter((p) => p.device === 'keyboard');
    const solo = SOLO.has(code), right = RIGHT.has(code) && !SOLO.has(code);
    if (!solo && !right) return;
    if (!kb.length) {
      if (this.full) return;
      const layout: KeyLayout = right ? 'right' : 'solo';
      const src = this.keyboard(layout, this.players.length);
      this.add(src, 'keyboard', layout);
      src.keyDown(code);
      return;
    }
    if (kb.length === 1) {
      const p = kb[0];
      // someone else on the other half of the keyboard: split it
      const other = (p.slot === 'right' && solo && !RIGHT.has(code)) || ((p.slot === 'solo' || p.slot === 'left') && right);
      if (!other || this.full) return;
      if (p.slot === 'solo') {
        (p.source as KeyboardSource).detach();
        const left = this.keyboard('left', p.index);
        left.mode = p.source.mode;
        p.source = left; p.slot = 'left';
        this.onChange?.(p);
      }
      const layout: KeyLayout = p.slot === 'right' ? 'left' : 'right';
      const src = this.keyboard(layout, this.players.length);
      src.mode = p.source.mode;
      this.add(src, 'keyboard', layout);
      src.keyDown(code);
    }
  }

  /** a touch began on the canvas */
  touch(id: number, x: number, y: number) {
    if (this.players.some((p) => p.device === 'touch') || this.full) return;
    const src = new TouchSource(this.o.target === null ? null : this.o.canvas ?? null);
    this.add(src, 'touch', 0);
    src.down(id, x, y);
  }

  /** each frame: pads plugged and unplugged, and a pad that's used for the first time joins */
  poll() {
    this.pads.update();
    for (const i of this.pads.indices()) {
      if (this.players.some((p) => p.device === 'gamepad' && p.slot === i)) continue;
      const src = this.pads.source(i);
      if (!this.full && src.active()) this.add(src, 'gamepad', i);
    }
  }

  /** the camera body joins (the webcam's source); a bot joins */
  joinCamera(src: IntentSource) { return this.full ? null : this.add(src, 'camera', 0); }
  join(src: IntentSource, device: Device = 'bot') { return this.full ? null : this.add(src, device, 0); }

  /** buzz a player's gamepad (impacts); false if it has none or the browser can't */
  rumble(player: number, strength = 0.5, ms = 120) {
    const p = this.players[player];
    return p?.device === 'gamepad' ? (p.source as GamepadSource).rumble(strength, ms) : false;
  }

  dispose() {
    for (const [el, ev, fn] of this.handlers) el.removeEventListener(ev, fn, { capture: true } as EventListenerOptions);
    for (const p of this.players) (p.source as { detach?: () => void }).detach?.();
    this.pads.dispose();
  }
}

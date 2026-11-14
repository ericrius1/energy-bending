// The HUD: two 2D canvases laid over the WebGPU canvas (index.html's layer: above the stage, below the menus and the
// touch pad, never taking a pointer), drawn from one HudState (state.ts) each frame.
//   base   what changes seldom: the dancers' panels (glass, emblem, name, style, dash). Each panel is drawn again
//          alone, only when a value it shows changes or a piece of it is moving (the style rolling, the dash filling)
//   live   what moves every frame: the link's line of light, the tags over the heads, the combos under the panels and
//          the link's ring and chip, the shared energy and the set's orb, the pair combo under it (pair.ts), the beat,
//          the pops, the countdown and the banner. Only the boxes drawn last frame are cleared
// Both are kept at the device's pixel ratio (or, filming, the render's: the film is graded bigger than it is shown)
// so the type is crisp. `compose` lays both over a captured frame (bend.grab) and `flatten` gives one image for the
// film's GPU composite (index.ts).
import { emptyHud, type HudState } from './state';
import { layout, type Layout, type Box } from './layout';
import { PlayerPanel, warmPanel } from './panel';
import { Centre, warmCentre } from './centre';
import { Shared, warmShared } from './shared';
import { PairChain } from './pair';
import { LinkLine } from './link';
import { drawBeat } from './beat';
import { Pops, drawTags, warmPops } from './pops';
import { makeCanvas, type Ctx, type Sprite } from './style';

export interface HudStats {
  /** CPU ms a frame: the mean of the last ~120 frames, and the worst of them */
  cpuMs: number; cpuMaxMs: number;
  /** frames the base layer was drawn, of frames drawn at all (since the last stats reset) */
  baseFrames: number; frames: number;
  /** ms a frame by part (the mean since the last reset): what the HUD's time goes on */
  parts: Record<string, number>;
  size: [number, number]; ratio: number; compact: boolean; mode: string; visible: boolean;
  /** the pops drawn last frame (in all, per seat, nobody's) and the most at once since the last stats reset */
  pops: { now: { total: number; seats: number[]; centre: number }; most: { total: number; seats: number[]; centre: number } };
}

export class Hud {
  private state: HudState = emptyHud();
  private base: HTMLCanvasElement | null = null;
  private live: HTMLCanvasElement | null = null;
  private gb: CanvasRenderingContext2D | null = null;
  private gl: CanvasRenderingContext2D | null = null;
  private flat: Sprite | null = null;
  private L: Layout | null = null;
  private ratio = 1;
  private cssW = 0;
  private cssH = 0;
  private panels = [new PlayerPanel(0), new PlayerPanel(1)];
  private centre = new Centre();
  private shared = new Shared();
  private pair = new PairChain();
  private link = new LinkLine();
  private pops = new Pops();
  private wasDuel = false;
  /** sprites to make ahead, one a frame (a new cast or size: its words, tags and countdown) */
  private warm: (() => void)[] = [];
  private warmFor = '';
  private baseDirty = true;
  private liveBoxes: Box[] = [];
  private shown = false;
  private on = true;
  private cpu: number[] = [];
  private counts = { base: 0, frames: 0 };
  private parts: Record<string, number> = {};
  private lap = 0;
  /** the time since the last lap, added to a part */
  private part(name: string) { const t = performance.now(); this.parts[name] = (this.parts[name] ?? 0) + t - this.lap; this.lap = t; }
  /** the stage canvas it lies over, and the pixel ratio to draw at */
  private stage: HTMLElement | null = null;
  private ratioOf: () => number = () => Math.min(3, globalThis.devicePixelRatio || 1);

  /** the state to draw from now on (the HUD keeps the object: fill a fresh one, or the same one, each frame) */
  set(state: HudState) { this.state = state; }
  get current(): Readonly<HudState> { return this.state; }

  /** the player's switch: false hides it on screen and in captures */
  get visible() { return this.on; }
  set visible(v: boolean) { this.on = v; }

  /** whether anything is on it this frame (what the capture composites) */
  get drawn() { return this.shown; }

  /** lay the canvases over `stage` (a fixed layer the size of the stage's box) */
  mount(stage: HTMLElement, ratio?: () => number) {
    this.stage = stage;
    if (ratio) this.ratioOf = ratio;
    const make = (name: string) => {
      const c = document.createElement('canvas');
      c.className = `hud hud-${name}`;
      c.setAttribute('aria-hidden', 'true');
      stage.after(c);
      return c;
    };
    this.base = make('base');
    this.live = make('live');
    this.gb = this.base.getContext('2d');
    this.gl = this.live.getContext('2d');
    this.show(false);
  }

  private show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    for (const c of [this.base, this.live]) if (c) c.style.display = on ? 'block' : 'none';
  }

  /** follow the stage's size and the pixel ratio; true if the canvases were resized */
  private fit() {
    const st = this.stage!;
    const w = st.clientWidth || innerWidth, h = st.clientHeight || innerHeight, r = this.ratioOf();
    if (w === this.cssW && h === this.cssH && Math.abs(r - this.ratio) < 1e-3 && this.L) return false;
    this.cssW = w; this.cssH = h; this.ratio = r;
    for (const c of [this.base!, this.live!]) {
      c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r));
      c.style.width = `${w}px`; c.style.height = `${h}px`;
    }
    for (const g of [this.gb!, this.gl!]) g.setTransform(c0(this.base!, w), 0, 0, c0(this.base!, w), 0, 0);
    this.L = layout(w, h);
    for (const p of this.panels) p.invalidate();
    this.baseDirty = true;
    this.liveBoxes = [];
    return true;
  }

  /** advance by dt and draw (once a frame, before the frame is submitted: index.ts) */
  frame(dt: number) {
    if (!this.base) return;
    const t0 = performance.now();
    const st = this.state;
    if (!this.on || st.mode === 'none') {
      if (this.shown) { this.clearAll(); this.show(false); }
      return;
    }
    this.fit();
    this.show(true);
    const L = this.L!, r = this.ratio, gb = this.gb!, gl = this.gl!;
    const duel = st.mode === 'duel';

    // ---------------------------------------------------------------- base: the panels
    // (two halves of the screen, each drawn again alone when its panel changes; a glow reaching past the middle is
    // clipped there)
    const dirty = [this.baseDirty, this.baseDirty];
    if (duel !== this.wasDuel) { this.wasDuel = duel; dirty.fill(true); }
    if (duel) {
      for (const p of st.players) if (p.seat === 0 || p.seat === 1) { if (this.panels[p.seat].update(p, dt)) dirty[p.seat] = true; }
      this.centre.update(st, dt);
      this.shared.update(st, dt);
      this.pair.update(st, dt);
      this.link.update(st, dt);
      this.pops.update(st, L, dt);
    }
    this.lap = t0;
    this.part('update');
    if (dirty[0] || dirty[1]) {
      const P = L.panels, bottom = P[0].y + P[0].h + 14 * L.u;
      const strips: [number, number][] = [[0, L.W / 2], [L.W / 2, L.W]];
      for (let i = 0; i < 2; i++) {
        if (!dirty[i]) continue;
        const [x0, x1] = strips[i];
        gb.save();
        gb.beginPath(); gb.rect(x0, 0, x1 - x0, bottom); gb.clip();
        gb.clearRect(x0, 0, x1 - x0, bottom);
        if (duel) for (const p of st.players) if (p.seat === i) this.panels[i].draw(gb, p, P[i], L.compact, L.u, r);
        gb.restore();
      }
      this.baseDirty = false;
      this.counts.base++;
    }

    // ---------------------------------------------------------------- live: only last frame's boxes cleared
    this.part('base');
    const prev = this.liveBoxes;
    let area = 0;
    for (const b of prev) area += b.w * b.h;
    if (area > L.W * L.H * 0.5) gl.clearRect(0, 0, L.W, L.H);
    else for (const b of prev) gl.clearRect(Math.floor(b.x) - 1, Math.floor(b.y) - 1, Math.ceil(b.w) + 2, Math.ceil(b.h) + 2);
    const out: Box[] = [];
    if (duel) {
      // (the link under everything: it is in the world, between the bodies)
      this.part('clear');
      this.link.draw(gl, st, L, r, out);
      this.part('link');
      drawTags(gl, st, L, r, out);
      this.part('tags');
      for (const p of st.players) if (p.seat === 0 || p.seat === 1) this.panels[p.seat].drawLive(gl, p, st, L, r, out);
      this.part('combo');
      this.shared.draw(gl, st, L, r, out);
      this.part('shared');
      this.pair.draw(gl, st, L, r, out);
      this.part('pair');
    }
    drawBeat(gl, st.beat, L, r, out);
    this.part('beat');
    // (the banner over the pops: the last move's word rises behind it)
    if (duel) {
      this.pops.draw(gl, st, L, r, out, this.centre.last);
      this.part('pops');
      this.centre.draw(gl, st, L, r, out);
      this.part('centre');
    }
    this.liveBoxes = out;

    // the warm-up: the next sprite this battle will want, made now while nothing is happening
    if (duel) {
      const key = `${L.W}x${L.H}@${r}:${st.players.map((p) => p.color + p.name).join(',')}:${st.set.length}`;
      if (key !== this.warmFor) { this.warmFor = key; this.warm = [...warmPanel(L, r), ...warmPops(st, L, r), ...warmCentre(L, r, st), ...warmShared(st, L, r)]; }
      if (this.warm.length && performance.now() - t0 < 0.15) this.warm.shift()!();
    }

    this.part('warm');
    this.counts.frames++;
    const ms = performance.now() - t0;
    this.cpu.push(ms);
    if (this.cpu.length > 120) this.cpu.shift();
  }

  /** add the ms of work done for this frame outside `frame` (a film's flatten and upload) to its cost */
  account(ms: number) { if (this.cpu.length) this.cpu[this.cpu.length - 1] += ms; }

  private clearAll() {
    if (!this.L) return;
    this.gb?.clearRect(0, 0, this.L.W, this.L.H);
    this.gl?.clearRect(0, 0, this.L.W, this.L.H);
    this.liveBoxes = [];
    this.baseDirty = true;
  }

  /** lay what is on screen over a captured frame of w × h pixels (bend.grab) */
  compose(g: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.shown || !this.base || !this.live) return;
    g.drawImage(this.base, 0, 0, w, h);
    g.drawImage(this.live, 0, 0, w, h);
  }

  /** both layers as one image of w × h pixels (the film's composite uploads it) */
  flatten(w: number, h: number): Sprite {
    const f = (this.flat && this.flat.width === w && this.flat.height === h) ? this.flat : (this.flat = makeCanvas(w, h));
    const g = f.getContext('2d') as Ctx;
    g.clearRect(0, 0, w, h);
    if (this.shown && this.base && this.live) { g.drawImage(this.base, 0, 0, w, h); g.drawImage(this.live, 0, 0, w, h); }
    return f;
  }

  stats(reset = false): HudStats {
    const n = this.cpu.length || 1;
    const s: HudStats = {
      cpuMs: +(this.cpu.reduce((a, b) => a + b, 0) / n).toFixed(4), cpuMaxMs: +Math.max(0, ...this.cpu).toFixed(4),
      baseFrames: this.counts.base, frames: this.counts.frames,
      parts: Object.fromEntries(Object.entries(this.parts).map(([k, v]) => [k, +(v / Math.max(1, this.counts.frames)).toFixed(4)])),
      size: [this.cssW, this.cssH], ratio: +this.ratio.toFixed(3), compact: !!this.L?.compact, mode: this.state.mode, visible: this.on,
      pops: { now: { ...this.pops.shown }, most: { ...this.pops.most } },
    };
    if (reset) { this.cpu = []; this.counts = { base: 0, frames: 0 }; this.parts = {}; this.pops.most = { total: 0, seats: [0, 0], centre: 0 }; }
    return s;
  }
}

/** the canvas's real pixels per CSS pixel (what the rounding of its size left) */
const c0 = (c: HTMLCanvasElement, w: number) => c.width / Math.max(1, w);

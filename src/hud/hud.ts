// The HUD: two 2D canvases laid over the WebGPU canvas (index.html's layer: above the stage, below the menus and the
// touch pad, never taking a pointer), drawn from one HudState (state.ts) each frame.
//   base   what changes seldom: the players' panels and the score. Drawn again only when a value it shows changes
//          or a piece of it is moving (a pip cracking, a meter filling, the super's glint)
//   live   what moves every frame: the beat, the countdown and the banner, the pops, the tags over the heads. Only
//          the boxes drawn last frame are cleared
// Both are kept at the device's pixel ratio (or, filming, the render's: the film is graded bigger than it is shown)
// so the type is crisp. `compose` lays both over a captured frame (bend.grab) and `flatten` gives one image for the
// film's GPU composite (index.ts).
import { emptyHud, type HudState } from './state';
import { layout, type Layout, type Box } from './layout';
import { PlayerPanel } from './panel';
import { Centre, drawScore, scoreSig, warmCentre } from './centre';
import { drawBeat } from './beat';
import { drawPops, drawTags, warmPops } from './pops';
import { makeCanvas, type Ctx, type Sprite } from './style';

export interface HudStats {
  /** CPU ms a frame: the mean of the last ~120 frames, and the worst of them */
  cpuMs: number; cpuMaxMs: number;
  /** frames the base layer was drawn, of frames drawn at all (since the last stats reset) */
  baseFrames: number; frames: number;
  size: [number, number]; ratio: number; compact: boolean; mode: string; visible: boolean;
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
  private score = '';
  /** sprites to make ahead, one a frame (a new cast or size: its words, tags and countdown) */
  private warm: (() => void)[] = [];
  private warmFor = '';
  private baseDirty = true;
  private liveBoxes: Box[] = [];
  private shown = false;
  private on = true;
  private cpu: number[] = [];
  private counts = { base: 0, frames: 0 };
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

    // ---------------------------------------------------------------- base: the panels and the score
    // (three strips across the top, each drawn again alone when what it shows changes: seat 0's panel, the score,
    // seat 1's panel; a glow reaching past its strip is clipped at the strip's edge, halfway across the gap)
    const dirty = [this.baseDirty, this.baseDirty, this.baseDirty];
    if (duel) {
      for (const p of st.players) if (p.seat === 0 || p.seat === 1) { if (this.panels[p.seat].update(p, dt)) dirty[p.seat === 0 ? 0 : 2] = true; }
      this.centre.update(st, dt);
      const sig = scoreSig(st);
      if (sig !== this.score) { this.score = sig; dirty[1] = true; }
    } else if (this.score !== 'off') { this.score = 'off'; dirty.fill(true); }
    if (dirty.some(Boolean)) {
      const P = L.panels, S = L.score, bottom = Math.max(P[0].y + P[0].h, S.y + S.h) + 40 * L.u;
      const cut0 = (P[0].x + P[0].w + S.x) / 2, cut1 = (S.x + S.w + P[1].x) / 2;
      const strips: [number, number][] = [[0, cut0], [cut0, cut1], [cut1, L.W]];
      for (let i = 0; i < 3; i++) {
        if (!dirty[i]) continue;
        const [x0, x1] = strips[i];
        gb.save();
        gb.beginPath(); gb.rect(x0, 0, x1 - x0, bottom); gb.clip();
        gb.clearRect(x0, 0, x1 - x0, bottom);
        if (duel) {
          if (i === 1) { if (st.players.length) drawScore(gb, st, L, r); }
          else for (const p of st.players) if (p.seat === (i === 0 ? 0 : 1)) this.panels[p.seat].draw(gb, p, P[p.seat], L.compact, L.u, st.round.koTarget, r);
        }
        gb.restore();
      }
      this.baseDirty = false;
      this.counts.base++;
    }

    // ---------------------------------------------------------------- live: only last frame's boxes cleared
    const prev = this.liveBoxes;
    let area = 0;
    for (const b of prev) area += b.w * b.h;
    if (area > L.W * L.H * 0.5) gl.clearRect(0, 0, L.W, L.H);
    else for (const b of prev) gl.clearRect(Math.floor(b.x) - 1, Math.floor(b.y) - 1, Math.ceil(b.w) + 2, Math.ceil(b.h) + 2);
    const out: Box[] = [];
    if (duel) {
      for (const p of st.players) if (p.seat === 0 || p.seat === 1) this.panels[p.seat].drawFlow(gl, p, L.panels[p.seat], L.compact, L.u, st.beat, r, out);
      drawTags(gl, st, L, r, out);
    }
    drawBeat(gl, st.beat, L, r, out);
    // (the banner over the pops: the last KO's word rises behind it)
    if (duel) {
      drawPops(gl, st, L, r, out);
      this.centre.draw(gl, st, L, r, out);
    }
    this.liveBoxes = out;

    // the warm-up: the next sprite this duel will want, made now while nothing is happening
    if (duel) {
      const key = `${L.W}x${L.H}@${r}:${st.players.map((p) => p.color).join(',')}`;
      if (key !== this.warmFor) { this.warmFor = key; this.warm = [...warmCentre(L, r), ...warmPops(st, L, r)]; }
      if (this.warm.length && performance.now() - t0 < 0.15) this.warm.shift()!();
    }

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
    this.score = '';
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
      size: [this.cssW, this.cssH], ratio: +this.ratio.toFixed(3), compact: !!this.L?.compact, mode: this.state.mode, visible: this.on,
    };
    if (reset) { this.cpu = []; this.counts = { base: 0, frames: 0 }; }
    return s;
  }
}

/** the canvas's real pixels per CSS pixel (what the rounding of its size left) */
const c0 = (c: HTMLCanvasElement, w: number) => c.width / Math.max(1, w);

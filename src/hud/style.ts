// The HUD's look, shared by every part of it: the site's type (system-ui, a little tracking, lowercase-free caps for
// the few words) and glass (index.html's `.jg-front`: a dark violet tint, a hairline of white), the elements' colours
// (menu.ts's swatches), the matter glyphs, and sprites: anything soft (a glow, a text with its halo) is rendered once
// into a small canvas and stamped after, because a canvas shadow or blur each frame is what makes a 2D HUD slow.
// Everything here works in CSS pixels; the caller has set the transform for the pixel ratio.

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** each matter's two colours: deep and light (menu.ts SWATCH) */
export const MATTER: Record<string, [string, string]> = {
  fire: ['#ff5a14', '#ffd27a'], water: ['#1c6cff', '#7fe0ff'], ice: ['#7cc4ff', '#f2fbff'], plasma: ['#8a2cff', '#ff7af0'],
  gems: ['#7a4cff', '#4ce0ff'], steam: ['#8a98b0', '#f4f6fa'],
};
export const matterOf = (m: string): [string, string] => MATTER[m] ?? ['#9a8cff', '#e8e4ff'];

export const GOLD = '#ffd68a', GOLD_HI = '#fff3d6', INK = '#ece6f4';

// ---------------------------------------------------------------- colour
const parsed = new Map<string, [number, number, number]>();
let probe: CanvasRenderingContext2D | null = null;
/** a CSS colour as [r, g, b] 0 … 255 (any syntax the canvas reads; cached) */
export function rgbOf(c: string): [number, number, number] {
  let v = parsed.get(c);
  if (v) return v;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  } else {
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (probe) { probe.fillStyle = '#000'; probe.fillStyle = c; probe.fillRect(0, 0, 1, 1); }
    const d = probe?.getImageData(0, 0, 1, 1).data;
    v = d ? [d[0], d[1], d[2]] : [255, 255, 255];
  }
  parsed.set(c, v);
  return v;
}
export const rgba = (c: string, a: number) => { const [r, g, b] = rgbOf(c); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
/** c lifted toward white by u (0 … 1) */
export const lift = (c: string, u: number) => { const [r, g, b] = rgbOf(c); return `rgb(${Math.round(r + (255 - r) * u)},${Math.round(g + (255 - g) * u)},${Math.round(b + (255 - b) * u)})`; };

// ---------------------------------------------------------------- shapes
export function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** the site's glass: a dark violet tint (deeper than the menus', since it sits over bright worlds and must hold type),
 *  a hairline of white, a faint sheen along the top; `tint` washes in from the `from` side (the player's colour) */
export function glass(g: Ctx, x: number, y: number, w: number, h: number, r: number, tint?: string, from: 'left' | 'right' = 'left', strength = 1) {
  roundRect(g, x, y, w, h, r);
  const bg = g.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, `rgba(16,12,26,${0.62 * strength})`);
  bg.addColorStop(1, `rgba(9,7,16,${0.5 * strength})`);
  g.fillStyle = bg;
  g.fill();
  if (tint) {
    const tg = from === 'left' ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(x + w, 0, x, 0);
    tg.addColorStop(0, rgba(tint, 0.2 * strength));
    tg.addColorStop(0.45, rgba(tint, 0.05 * strength));
    tg.addColorStop(1, rgba(tint, 0));
    g.fillStyle = tg;
    g.fill();
  }
  g.lineWidth = 1;
  g.strokeStyle = `rgba(255,255,255,${0.1 * strength})`;
  g.stroke();
  // the sheen: a lighter hairline just inside the top edge
  const sh = g.createLinearGradient(x, 0, x + w, 0);
  sh.addColorStop(0, 'rgba(255,255,255,0)');
  sh.addColorStop(0.5, `rgba(255,255,255,${0.12 * strength})`);
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.strokeStyle = sh;
  g.beginPath();
  g.moveTo(x + r, y + 1.5);
  g.lineTo(x + w - r, y + 1.5);
  g.stroke();
}

/** text with a dark halo under it, so it reads over a white sky or a lava glow (drawn twice: halo, then fill) */
export function haloText(g: Ctx, s: string, x: number, y: number, fill: string | CanvasGradient, halo = 0.55, width = 3) {
  g.lineJoin = 'round';
  g.lineWidth = width;
  g.strokeStyle = `rgba(6,4,12,${halo})`;
  g.strokeText(s, x, y);
  g.fillStyle = fill;
  g.fillText(s, x, y);
}

// ---------------------------------------------------------------- the matter glyphs, in a 24-unit box centred on 0
export function glyph(g: Ctx, matter: string, s: number) {
  g.save();
  g.scale(s / 24, s / 24);
  g.beginPath();
  switch (matter) {
    case 'fire':
      // a flame, two tongues
      g.moveTo(0.5, -11);
      g.bezierCurveTo(5.5, -5, 9, -1, 8.5, 3.5);
      g.bezierCurveTo(8, 8.5, 4.5, 11, 0, 11);
      g.bezierCurveTo(-4.8, 11, -8.5, 8, -8.5, 3.6);
      g.bezierCurveTo(-8.5, -0.5, -5.5, -2.5, -4.5, -6.5);
      g.bezierCurveTo(-2.5, -3.5, -2.2, -1.5, -1.5, 0.5);
      g.bezierCurveTo(0.8, -3, 1.6, -6.5, 0.5, -11);
      g.closePath();
      break;
    case 'water':
      g.moveTo(0, -11);
      g.bezierCurveTo(4, -5, 8, -1, 8, 4);
      g.arc(0, 4, 8, 0, Math.PI, false);
      g.bezierCurveTo(-8, -1, -4, -5, 0, -11);
      g.closePath();
      break;
    case 'ice': {
      // a six-sided crystal: a hexagon, its facets drawn by the caller's stroke
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const x = Math.cos(a) * 10.5, y = Math.sin(a) * 10.5;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      break;
    }
    case 'plasma':
      // a bolt
      g.moveTo(2.5, -11.5);
      g.lineTo(-7, 1.5);
      g.lineTo(-0.5, 1.5);
      g.lineTo(-3, 11.5);
      g.lineTo(7.5, -2.5);
      g.lineTo(0.8, -2.5);
      g.closePath();
      break;
    case 'gems':
      // a cut stone: table, crown, pavilion
      g.moveTo(-5, -9);
      g.lineTo(5, -9);
      g.lineTo(10, -3);
      g.lineTo(0, 11);
      g.lineTo(-10, -3);
      g.closePath();
      break;
    case 'steam':
      g.arc(-3.5, 1, 6, Math.PI * 0.6, Math.PI * 1.75);
      g.arc(3, -2, 6.5, Math.PI * 1.1, Math.PI * 2.1);
      g.arc(3.5, 4, 5, Math.PI * 1.7, Math.PI * 0.6);
      g.closePath();
      break;
    default:
      g.arc(0, 0, 9, 0, Math.PI * 2);
  }
  g.restore();
}

/** the glyph's inner lines (facets, the flame's heart), to stroke over its fill */
export function glyphLines(g: Ctx, matter: string, s: number) {
  g.save();
  g.scale(s / 24, s / 24);
  g.beginPath();
  if (matter === 'ice') {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      g.moveTo(Math.cos(a) * 10.5, Math.sin(a) * 10.5);
      g.lineTo(-Math.cos(a) * 10.5, -Math.sin(a) * 10.5);
    }
  } else if (matter === 'gems') {
    g.moveTo(-10, -3); g.lineTo(10, -3);
    g.moveTo(-5, -9); g.lineTo(-3, -3); g.lineTo(0, 11); g.lineTo(3, -3); g.lineTo(5, -9);
    g.moveTo(-3, -3); g.lineTo(0, -9); g.lineTo(3, -3);
  } else if (matter === 'fire') {
    g.moveTo(0, 10); g.bezierCurveTo(-3.5, 10, -4.5, 7, -3.5, 4.5); g.bezierCurveTo(-2, 6, 0, 5, 0.5, 2); g.bezierCurveTo(3, 4, 4, 9, 0, 10);
  } else if (matter === 'water') {
    g.moveTo(-4.5, 4); g.bezierCurveTo(-4.5, 6.5, -2.5, 8, 0, 8);
  }
  g.restore();
}

// ---------------------------------------------------------------- sprites
// Sprites live in atlases: a few big canvases packed shelf by shelf, because making a canvas and its 2D context costs
// milliseconds (the first KO's word, its glow and the mark's glow once took 13 ms in one frame) while drawing into a
// corner of one already made costs what the drawing costs. A sprite drawn while another is being drawn (a glow inside
// a word) goes into the next atlas down, so it is never clipped by its parent's box. A full atlas starts again (its
// sprites are drawn again as they are next asked for); one too big for an atlas gets a canvas of its own.
export type Sprite = HTMLCanvasElement | OffscreenCanvas;
export interface SpriteRef { c: Sprite; sx: number; sy: number; sw: number; sh: number; w: number; h: number; ox: number; oy: number }
export const makeCanvas = (w: number, h: number): Sprite => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c;
};

class Atlas {
  readonly c: Sprite;
  readonly g: Ctx;
  private x = 0;
  private y = 0;
  private row = 0;
  readonly keys = new Set<string>();
  constructor(readonly size: number) {
    this.c = makeCanvas(size, size);
    this.g = this.c.getContext('2d') as Ctx;
  }
  /** a free box of w × h pixels, or null when full */
  take(w: number, h: number): [number, number] | null {
    if (this.x + w > this.size) { this.x = 0; this.y += this.row; this.row = 0; }
    if (this.y + h > this.size) return null;
    const at: [number, number] = [this.x, this.y];
    this.x += w; this.row = Math.max(this.row, h);
    return at;
  }
  reset() { this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.size, this.size); this.x = this.y = this.row = 0; }
}
const ATLAS = [2048, 1024, 512];
const atlases: (Atlas | null)[] = ATLAS.map(() => null);
const sprites = new Map<string, SpriteRef & { atlas: number }>();
let depth = 0;

/** a sprite made once and kept by key: `draw` paints it in a box w × h (CSS px) at the pixel ratio; ox, oy is the
 *  point within it that is "at" when it is stamped */
export function sprite(key: string, dpr: number, w: number, h: number, ox: number, oy: number, draw: (g: Ctx) => void): SpriteRef {
  const k = `${key}@${dpr.toFixed(2)}`;
  const had = sprites.get(k);
  if (had) return had;
  const pw = Math.ceil(w * dpr) + 2, ph = Math.ceil(h * dpr) + 2;
  const level = Math.min(depth, ATLAS.length - 1);
  let A = atlases[level];
  let at: [number, number] | null = null;
  if (pw <= ATLAS[level] && ph <= ATLAS[level]) {
    A ??= atlases[level] = new Atlas(ATLAS[level]);
    at = A.take(pw, ph);
    if (!at) {
      for (const key of A.keys) sprites.delete(key);
      A.keys.clear();
      A.reset();
      at = A.take(pw, ph);
    }
  }
  let ref: SpriteRef & { atlas: number };
  depth++;
  try {
    if (A && at) {
      const g = A.g;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(at[0], at[1], pw, ph);
      g.beginPath(); g.rect(at[0] + 1, at[1] + 1, pw - 2, ph - 2); g.clip();
      g.setTransform(dpr, 0, 0, dpr, at[0] + 1, at[1] + 1);
      draw(g);
      g.restore();
      ref = { c: A.c, sx: at[0] + 1, sy: at[1] + 1, sw: pw - 2, sh: ph - 2, w, h, ox, oy, atlas: level };
      A.keys.add(k);
    } else {
      const c = makeCanvas(pw - 2, ph - 2), g = c.getContext('2d') as Ctx;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(g);
      ref = { c, sx: 0, sy: 0, sw: pw - 2, sh: ph - 2, w, h, ox, oy, atlas: -1 };
      // (the big ones, a winner's banner, are few: past a dozen the oldest goes)
      let own = 0, first: string | null = null;
      for (const [key, v] of sprites) if (v.atlas < 0) { own++; first ??= key; }
      if (own > 12 && first) sprites.delete(first);
    }
  } finally { depth--; }
  sprites.set(k, ref);
  return ref;
}

/** stamp a sprite at x, y (its own anchor), scaled by k, at alpha a (times the context's) */
export function stamp(g: Ctx, s: SpriteRef, x: number, y: number, k = 1, a = 1) {
  if (a <= 0.003) return;
  // (at a times the alpha already set: a stamp inside a fading group fades with it)
  const ga = g.globalAlpha;
  g.globalAlpha = ga * Math.min(1, a);
  g.drawImage(s.c, s.sx, s.sy, s.sw, s.sh, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k);
  g.globalAlpha = ga;
}

/** a soft round glow of colour c, radius r (CSS px) */
export function glow(c: string, r: number, dpr: number, core = 0.55) {
  const R = Math.ceil(r);
  return sprite(`glow:${c}:${R}:${core}`, dpr, R * 2, R * 2, R, R, (g) => {
    const gr = g.createRadialGradient(R, R, 0, R, R, R);
    gr.addColorStop(0, rgba(c, core));
    gr.addColorStop(0.35, rgba(c, core * 0.45));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, R * 2, R * 2);
  });
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeOutBack = (x: number) => { x = clamp01(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
/** a value eased toward a target at rate k per second (frame-rate free) */
export const approach = (v: number, to: number, k: number, dt: number) => v + (to - v) * (1 - Math.exp(-k * dt));

// ---------------------------------------------------------------- words as sprites
// Text drawn each frame costs (a stroke for the halo and a fill, at a size): what the HUD redraws often (the style as
// it rolls, the combo's count, the clock) is stamped from sprites instead, one per text (a number is stamped digit by
// digit, so a rolling score needs only eleven).
let measurer: Ctx | null = null;
const widths = new Map<string, number>();

export interface Label { ref: SpriteRef; w: number }
/** `text` at `size` (CSS px), weight, tracking (em), its colour and a dark halo (alpha, width px), as a sprite whose
 *  anchor is the start of its baseline; `w` is the text's advance */
/** the advance of `text` at a size, weight and tracking (em), measured once */
export function measure(text: string, size: number, weight: number | string, track: number) {
  const font = `${weight} ${size.toFixed(2)}px ${FONT}`, ls = `${(size * track).toFixed(2)}px`;
  const mk = `${font}|${ls}|${text}`;
  let w = widths.get(mk);
  if (w == null) {
    measurer ??= makeCanvas(4, 4).getContext('2d') as Ctx;
    measurer.font = font; measurer.letterSpacing = ls;
    w = measurer.measureText(text).width;
    widths.set(mk, w);
    if (widths.size > 4000) widths.clear();
  }
  return w;
}

export function label(text: string, size: number, weight: number | string, track: number, fill: string, halo: number, haloW: number, dpr: number): Label {
  const font = `${weight} ${size.toFixed(2)}px ${FONT}`, ls = `${(size * track).toFixed(2)}px`;
  const mk = `${font}|${ls}|${text}`;
  const w = measure(text, size, weight, track);
  const pad = Math.ceil(haloW + 2), sw = w + pad * 2, sh = size * 1.45 + pad * 2, base = pad + size * 1.08;
  const ref = sprite(`label:${mk}|${fill}|${halo}|${haloW.toFixed(2)}`, dpr, sw, sh, pad, base, (g) => {
    g.font = font; g.letterSpacing = ls;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    if (halo > 0) haloText(g, text, pad, base, fill, halo, haloW);
    else { g.fillStyle = fill; g.fillText(text, pad, base); }
  });
  return { ref, w };
}

/** a label stamped by its baseline at x, y: align 'left' (x is its start), 'right' (its end) or 'center' */
export function stampLabel(g: Ctx, l: Label, x: number, y: number, align: 'left' | 'right' | 'center' = 'left', a = 1) {
  stamp(g, l.ref, align === 'left' ? x : align === 'right' ? x - l.w : x - l.w / 2, y, 1, a);
}

/** a number's text stamped digit by digit (each digit a label: a rolling score costs eleven sprites); returns its width */
export function stampDigits(g: Ctx, text: string, size: number, weight: number | string, track: number, fill: string, halo: number, haloW: number, dpr: number,
  x: number, y: number, align: 'left' | 'right' = 'left', a = 1): number {
  let w = 0;
  const ls: Label[] = [];
  for (const ch of text) { const l = label(ch, size, weight, track, fill, halo, haloW, dpr); ls.push(l); w += l.w; }
  let cx = align === 'left' ? x : x - w;
  for (const l of ls) { stamp(g, l.ref, cx, y, 1, a); cx += l.w; }
  return w;
}

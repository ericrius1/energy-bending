// The game's skin in one place: the solarpunk palette and type (docs/design/solarpunk.md, the art bible). The page's
// CSS has the same tokens as custom properties on :root (index.html, `--eb-*`), for the menus, the lobby, the
// controls card and the lesson; this module is what the HUD's canvases draw with (style.ts reads it). A test
// (hud.test.ts) keeps the two lists equal, so a colour changed here and not there fails `node scripts/test-ts.mjs`.
// Pure data and two small helpers: no DOM at import.
//
// The look in a line: warm sunlit glass over the worlds. Smoked honey glass (a dark warm tint, never violet-black)
// holding cream type, framed by thin gold leading like a leaded pane, sun gold for what matters now, leaf, teal and
// terracotta for the rest, and the seats' rose and fern kept pure so who is who always reads.

/** the palette, by name (CSS: `--eb-<kebab-name>`) */
export const PALETTE = {
  /** sun gold: the one accent (play, full flow, a perfect beat, the set's finale) */
  sun: '#ffc861',
  /** the sun's light: highlights, numbers as they flare */
  sunHi: '#fff0c8',
  /** honey amber: the sun's shadow side, the leading's warm edge */
  honey: '#e09a3a',
  /** brass: thin frames and rings */
  brass: '#c9a463',
  /** cream: the ink on glass (body text, numbers) */
  cream: '#fbf4e4',
  /** parchment: quieter ink (labels, hints) */
  parchment: '#e6d7b8',
  /** leaf green */
  leaf: '#8fd17f',
  /** moss green, deep */
  moss: '#4e7a45',
  /** verdigris: copper gone green (rings, the second accent) */
  verdigris: '#6cc3a8',
  /** sky teal */
  teal: '#4fc0c8',
  /** pale sky */
  sky: '#a8e3ee',
  /** terracotta */
  terracotta: '#d4744e',
  /** a touch of coral */
  coral: '#ff8e7a',
  /** the glass's body: smoked honey, used with alpha */
  glass: '#1d170e',
  /** the deepest warm dark (the page under the canvas, the veil) */
  night: '#0b0906',
} as const;
export type Token = keyof typeof PALETTE;

/** the seats' colours (src/duel/seat.ts SEAT_CSS): rose and fern, never tinted by the skin */
export const SEAT = ['#ff6fa3', '#5ff0a4'] as const;

/** the faces (index.html loads both from Google Fonts; the fallbacks keep the shapes close while they load) */
export const TYPE = {
  /** the display face: Fraunces, soft (SOFT 100, WONK 0, pinned in the font's address), for big words and numbers */
  display: '"Fraunces", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  /** the body face: Nunito Sans, humanist and open at small sizes, for labels, keys and prose */
  body: '"Nunito Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

/** the weights the HUD draws with (loaded ahead, so the canvas never makes a sprite from a fallback face) */
export const FACES: string[] = [
  `300 32px ${TYPE.display}`, `600 32px ${TYPE.display}`, `700 32px ${TYPE.display}`, `italic 500 32px ${TYPE.display}`,
  `600 16px ${TYPE.body}`, `700 16px ${TYPE.body}`, `800 16px ${TYPE.body}`, `italic 800 16px ${TYPE.body}`,
];

/** the CSS custom properties the palette and type are on :root as (index.html must say the same) */
export function cssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(PALETTE)) out[`--eb-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = v;
  out['--eb-seat-1'] = SEAT[0];
  out['--eb-seat-2'] = SEAT[1];
  return out;
}

/** the HUD's glass, as numbers its drawing reads: the body's top and foot (rgba), the leading (gold over a dark lead
 *  line) and the cream hairline inside it */
export const GLASS = {
  top: 'rgba(52,40,22,0.66)',
  foot: 'rgba(18,14,8,0.6)',
  lead: 'rgba(14,10,4,0.55)',
  gold: ['#f6dc9a', '#c99a4c'] as const,
  inner: 'rgba(255,240,205,0.16)',
  sheen: 'rgba(255,236,190,0.2)',
};

// The skin's one place (theme.ts) and the page's CSS (index.html's :root) say the same palette, the seats' colours
// are the duel's own (src/duel/seat.ts) and stay out of the skin's tokens, the page loads the two faces theme.ts
// names, and the cream ink holds against the HUD's glass at a contrast a small label can be read at.
import { readFileSync } from 'node:fs';
import { test, assert, done } from '../dancer/test/check';
import { PALETTE, SEAT, TYPE, GLASS, cssVars } from './theme';
import { SEAT_CSS } from '../duel/seat';

const html = readFileSync('index.html', 'utf8');
const root = /:root\s*\{([\s\S]*?)\n\s*\}/.exec(html)?.[1] ?? '';

test('every token in theme.ts is on :root in index.html, with the same value', () => {
  assert(root.length > 0, 'index.html has a :root block');
  for (const [name, value] of Object.entries(cssVars())) {
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(root);
    assert(!!m, `${name} is on :root`);
    assert(m![1].trim().toLowerCase() === value.toLowerCase(), `${name}: index.html ${m![1].trim()}, theme.ts ${value}`);
  }
  const css = [...root.matchAll(/(--eb-[a-z0-9-]+):\s*#/g)].map((m) => m[1]);
  for (const name of css) assert(name in cssVars(), `${name} (a colour on :root) is in theme.ts`);
});

test('the seats are the duel\'s rose and fern', () => {
  assert(SEAT[0] === SEAT_CSS[0] && SEAT[1] === SEAT_CSS[1], `theme ${SEAT.join(',')} vs seat.ts ${SEAT_CSS.join(',')}`);
  for (const v of Object.values(PALETTE)) assert(!SEAT.includes(v as typeof SEAT[number]), `${v} is not a seat's colour`);
});

test('the page asks Google Fonts for the faces theme.ts draws with, and the CSS names them', () => {
  for (const face of ['Fraunces', 'Nunito Sans']) {
    assert(TYPE.display.includes(face) || TYPE.body.includes(face), `${face} is a theme face`);
    assert(html.includes(`family=${face.replace(' ', '+')}`), `index.html loads ${face}`);
  }
  assert(root.includes(`--eb-display: ${TYPE.display};`), '--eb-display matches TYPE.display');
  assert(root.includes(`--eb-body: ${TYPE.body};`), '--eb-body matches TYPE.body');
});

/** WCAG relative luminance and contrast of two #rrggbb (or rgba over black) colours */
const lum = (c: string) => {
  const m = /^#(..)(..)(..)$/.exec(c) ?? /rgba?\((\d+),(\d+),(\d+)/.exec(c.replace(/\s/g, ''));
  const v = m!.slice(1, 4).map((x) => (c.startsWith('#') ? parseInt(x, 16) : Number(x)) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('cream and parchment ink read on the glass (its body over a black world, at least 7:1 and 4.5:1)', () => {
  const body = GLASS.top;
  assert(contrast(PALETTE.cream, body) >= 7, `cream on glass ${contrast(PALETTE.cream, body).toFixed(1)}:1`);
  assert(contrast(PALETTE.parchment, body) >= 4.5, `parchment on glass ${contrast(PALETTE.parchment, body).toFixed(1)}:1`);
  assert(contrast('#2b1e0b', PALETTE.cream) >= 7, `a key's ink on its cream cap ${contrast('#2b1e0b', PALETTE.cream).toFixed(1)}:1`);
  for (const s of SEAT) assert(contrast(s, body) >= 4.5, `seat ${s} on glass ${contrast(s, body).toFixed(1)}:1`);
});

done();

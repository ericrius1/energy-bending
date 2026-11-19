// Which one is you, said in the page (report 24-newcomer): a small tag over your body (DOM over the canvas, in the
// skin's honey glass and gold leading: index.html's --eb-* tokens), held over the petal the world draws above your head
// (src/duel/you.ts), and the front's word on what to press. The same tag on the front (over the body that will be yours)
// and in the dance's first seconds and after each crossing (over the body that is), so the two read as one thing.
//   YouTags      one tag per seat: `place(k, x, y, alpha, text, sub?)` at the screen's fractions (src/hud/state.ts
//                screenOf), hidden at alpha 0
//   pressPrompt  the front's call: "press any key to dance", or "tap to dance" on a touch screen, and a gamepad's A once
//                one is plugged in, breathing gently above the strip; gone once a game begins
import { GLYPHS } from './menu';

const CSS = `
.jg-you { position: fixed; left: 0; top: 0; z-index: 4; pointer-events: none; display: flex; flex-direction: column; align-items: center;
  transform: translate(-50%, -100%); opacity: 0; transition: opacity 0.28s; will-change: transform, opacity; }
.jg-you b { display: flex; align-items: center; gap: 0.42em; padding: 0.24em 0.85em 0.28em 0.58em; border-radius: 999px; white-space: nowrap;
  font: italic 700 16px/1.1 var(--eb-display, Georgia, serif); letter-spacing: 0.04em; color: var(--eb-cream, #fbf4e4);
  background: var(--eb-glass-bg, rgba(30, 22, 10, 0.68)); box-shadow: 0 0 0 1.5px var(--c, #ff6fa3), 0 0 18px rgba(255, 200, 97, 0.25);
  -webkit-backdrop-filter: var(--eb-blur, none); backdrop-filter: var(--eb-blur, none); text-shadow: 0 1px 2px rgba(20, 12, 4, 0.7); }
.jg-you b i { width: 0.62em; height: 0.62em; border-radius: 60% 0 60% 0; transform: rotate(-45deg); background: var(--c, #ff6fa3);
  box-shadow: 0 0 10px var(--c, #ff6fa3), inset 0 0 0 1px rgba(255, 240, 205, 0.65); }
.jg-you small { font: 700 10px/1 var(--eb-body, system-ui, sans-serif); font-style: normal; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--eb-sun-hi, #fff0c8); opacity: 0.9; margin-left: 0.2em; }
.jg-you s { display: block; width: 0; height: 0; text-decoration: none; border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-top: 8px solid var(--c, #ff6fa3); filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45)); margin-top: 2px; }
.jg-you.partner b { padding: 0.16em 0.65em 0.19em 0.52em; font: 600 11px/1.1 var(--eb-body, system-ui, sans-serif); font-style: normal;
  text-transform: uppercase; letter-spacing: 0.12em; color: rgba(251, 244, 228, 0.78); background: rgba(22, 16, 10, 0.42);
  box-shadow: 0 0 0 1px rgba(222, 180, 104, 0.28); }
.jg-you.partner b i { width: 0.48em; height: 0.48em; box-shadow: none; opacity: 0.75; }
.jg-you.partner s { border-left-width: 4px; border-right-width: 4px; border-top: 5px solid rgba(222, 180, 104, 0.45); }

.jg-press { position: fixed; left: 50%; bottom: calc(118px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 6; pointer-events: none;
  display: flex; align-items: center; gap: 0.7em; padding: 0.5em 1.25em 0.55em 1em; border-radius: 999px; white-space: nowrap;
  font: italic 500 19px/1.15 var(--eb-display, Georgia, serif); letter-spacing: 0.01em; color: var(--eb-cream, #fbf4e4);
  background: var(--eb-glass-bg, rgba(30, 22, 10, 0.55)); box-shadow: var(--eb-lead, 0 0 0 1px rgba(222, 180, 104, 0.6)), 0 0 28px rgba(255, 200, 97, 0.18);
  -webkit-backdrop-filter: var(--eb-blur, none); backdrop-filter: var(--eb-blur, none); text-shadow: 0 1px 2px rgba(20, 12, 4, 0.55);
  animation: jg-breathe 3.4s ease-in-out infinite; transition: opacity 0.5s; }
.jg-press span.k { display: inline-flex; align-items: center; gap: 0.4em; }
.jg-press svg { width: 1.35em; height: 1.35em; color: var(--eb-sun, #ffc861); }
.jg-press kbd { font: 800 12px/1 var(--eb-body, system-ui, sans-serif); font-style: normal; color: #2b1e0b; padding: 0.3em 0.55em; border-radius: 6px;
  background: linear-gradient(var(--eb-cream, #fbf4e4), #efe2c2); box-shadow: 0 0 0 1px rgba(224, 154, 58, 0.85), 0 1px 0 rgba(120, 80, 20, 0.6); }
.jg-press kbd.a { border-radius: 50%; width: 1.5em; height: 1.5em; padding: 0; display: inline-grid; place-items: center; background: radial-gradient(circle at 40% 35%, #b9f5c9, #4fb873); color: #10301a; }
.jg-press em { font-style: normal; opacity: 0.55; }
@keyframes jg-breathe { 0%, 100% { box-shadow: var(--eb-lead, 0 0 0 1px rgba(222, 180, 104, 0.6)), 0 0 18px rgba(255, 200, 97, 0.12); }
  50% { box-shadow: var(--eb-lead, 0 0 0 1px rgba(222, 180, 104, 0.6)), 0 0 34px rgba(255, 200, 97, 0.32); } }
body.playing .jg-press, .jg-press.off { opacity: 0; }
@media (max-width: 640px) { .jg-press { font-size: 16px; bottom: calc(150px + env(safe-area-inset-bottom, 0px)); } }
@media (prefers-reduced-motion: reduce) { .jg-press { animation: none; } }
`;

let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.dataset.jg = 'you';
  st.textContent = CSS;
  document.head.append(st);
}

/** the seats' colours as the page shows them (index.html --eb-seat-1, --eb-seat-2) */
const SEAT_CSS = ['var(--eb-seat-1, #ff6fa3)', 'var(--eb-seat-2, #5ff0a4)'];

/** a tag per seat over its body: "you" (or, two at one screen, each seat's own device) */
export class YouTags {
  private els: (HTMLElement | null)[] = [null, null];
  private texts = ['', ''];

  place(k: number, x: number, y: number, alpha: number, text: string, sub?: string, kind: 'you' | 'partner' = 'you') {
    if (typeof document === 'undefined') return;
    let el = this.els[k];
    const on = alpha > 0.02 && x > -0.05 && x < 1.05 && y > 0.02 && y < 1.05;
    if (!on) { if (el) el.style.opacity = '0'; return; }
    if (!el) {
      style();
      el = document.createElement('div');
      el.className = 'jg-you';
      el.setAttribute('aria-hidden', 'true');
      el.style.setProperty('--c', SEAT_CSS[k] ?? SEAT_CSS[0]);
      document.body.append(el);
      this.els[k] = el;
    }
    el.classList.toggle('partner', kind === 'partner');
    const t = `${text}|${sub ?? ''}|${kind}`;
    if (t !== this.texts[k]) {
      this.texts[k] = t;
      el.innerHTML = `<b><i></i>${text}${sub ? `<small>${sub}</small>` : ''}</b><s></s>`;
    }
    // clamp gently so your own tag stays readable even near screen edges
    const cx = Math.max(0.05, Math.min(0.95, x)), cy = Math.max(0.08, Math.min(0.92, y));
    el.style.transform = `translate(${(cx * innerWidth).toFixed(1)}px, ${(cy * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = Math.min(1, alpha).toFixed(3);
  }
  hide() { for (const el of this.els) if (el) el.style.opacity = '0'; }
  remove() { for (const el of this.els) el?.remove(); this.els = [null, null]; }
}

/** the front's word on what to press: any key, a tap, a gamepad's A */
export function pressPrompt() {
  if (typeof document === 'undefined') return { remove: () => {}, show: (_: boolean) => {} };
  style();
  const el = document.createElement('div');
  el.className = 'jg-press';
  el.setAttribute('role', 'status');
  const touch = typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
  let pad = false;
  const paint = () => {
    pad = pad || (navigator.getGamepads?.() ?? []).some((p) => !!p);
    const ways: string[] = [];
    if (!touch) ways.push(`${GLYPHS.keyboard}<span>press any key</span>`);
    if (touch) ways.push(`${GLYPHS.touch}<span>tap</span>`);
    if (pad) ways.push(`${GLYPHS.gamepad}<kbd class="a">A</kbd>`);
    el.innerHTML = ways.map((w, i) => `<span class="k">${w}${i === ways.length - 1 ? '<span>to dance</span>' : ''}</span>`).join('<em>·</em>');
    el.setAttribute('aria-label', `${touch ? 'tap' : 'press any key'}${pad ? ' or A' : ''} to dance`);
  };
  paint();
  const plug = () => { pad = true; paint(); };
  addEventListener('gamepadconnected', plug);
  document.body.append(el);
  return {
    show(on: boolean) { el.classList.toggle('off', !on); },
    remove() { removeEventListener('gamepadconnected', plug); el.classList.add('off'); setTimeout(() => el.remove(), 600); },
  };
}

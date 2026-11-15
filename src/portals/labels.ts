// The mirrors' names (report 18-wayfinding): over each open gate in the world on screen, a small plaque of the HUD's
// honey glass naming the world beyond it ("the Tide Temple"), with a leaf of that world's colour. It rides the gate's
// crown on screen, comes in as the gate comes near (from 20 m, whole by 13 m), and goes as the eye reaches the disc
// (the other world is the whole screen then: no name needed). Asked for (M, a gamepad's d-pad left, or a tap on the
// small "mirrors" chip that shows for a while once a game begins), every gate of the world is named for a few seconds
// however far, the ones off screen at the screen's edge with an arrow toward them. DOM over the canvas, so a film (the
// canvas alone) never shows it; `?labels=0` turns it off. Styled with the skin's tokens (`--eb-*`, src/hud/theme.ts).
import type { Camera } from '@ericrius1/weft';
import type { Gate } from './gate';
import { WORLD_NAMES } from './mirrors';

/** each world's colour on its plaque's leaf (the front's medallions' colours: play/menu.ts WORLDS) */
const WORLD_CSS: Record<string, string> = { geode: '#a57cff', pool: '#5ec0ea', temple: '#45d2bd', redwoods: '#8cc265' };
const NEAR = 2.4, FULL = 13, FAR = 20;
/** seconds every gate stays named once asked for, and the chip's time on screen once a game begins */
const REVEAL_S = 4, CHIP_S = 14;

const CSS = `
.eb-gate-names { position: fixed; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.eb-gate-name { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); white-space: nowrap;
  display: flex; align-items: center; gap: 0.45em; padding: 0.28em 0.85em 0.32em 0.6em; border-radius: 999px;
  font: 600 15px var(--eb-display, "Fraunces", Georgia, serif); letter-spacing: 0.01em; color: var(--eb-cream, #fbf4e4);
  background: linear-gradient(180deg, rgba(52,40,22,0.62), rgba(18,14,8,0.55));
  border: 1px solid color-mix(in srgb, var(--eb-brass, #c9a463) 80%, transparent);
  box-shadow: 0 0 0 1px rgba(14,10,4,0.45), inset 0 1px 0 rgba(255,240,205,0.16), 0 4px 18px rgba(0,0,0,0.25);
  text-shadow: 0 1px 2px rgba(0,0,0,0.5); opacity: 0; will-change: transform, opacity; }
.eb-gate-name i { width: 0.7em; height: 0.95em; border-radius: 0 100% 0 100%; transform: rotate(-30deg);
  background: var(--c); box-shadow: 0 0 8px var(--c); flex: none; }
.eb-gate-name b { display: none; color: var(--eb-sun, #ffc861); font: 800 13px var(--eb-body, system-ui, sans-serif); }
.eb-gate-name.edge b { display: inline-block; transform: rotate(var(--a)); }
.eb-mirrors-chip { position: fixed; left: 16px; bottom: 16px; z-index: 5; pointer-events: auto; cursor: pointer;
  display: flex; align-items: center; gap: 0.5em; padding: 0.35em 0.9em 0.38em 0.55em; border-radius: 999px;
  font: 700 12px var(--eb-body, "Nunito Sans", system-ui, sans-serif); letter-spacing: 0.04em; color: var(--eb-parchment, #e6d7b8);
  background: linear-gradient(180deg, rgba(52,40,22,0.62), rgba(18,14,8,0.55)); border: 1px solid rgba(201,164,99,0.7);
  box-shadow: 0 0 0 1px rgba(14,10,4,0.45), inset 0 1px 0 rgba(255,240,205,0.16); opacity: 0; transition: opacity 0.6s; }
.eb-mirrors-chip.on { opacity: 0.92; }
.eb-mirrors-chip kbd { font: 800 11px var(--eb-body, system-ui, sans-serif); color: #2b1e0b; padding: 0.05em 0.45em; border-radius: 5px;
  background: linear-gradient(var(--eb-cream, #fbf4e4), #efe2c2); box-shadow: 0 0 0 1px rgba(224,154,58,0.85); }
.eb-mirrors-chip i { width: 1.25em; height: 1.25em; border-radius: 50%; border: 2px solid var(--eb-brass, #c9a463);
  background: radial-gradient(circle at 40% 35%, #fff8, #5ec0ea 50%, #1d4a5a); }
@media (max-width: 600px) { .eb-gate-name { font-size: 12px; } .eb-mirrors-chip kbd { display: none; } }
@media (pointer: coarse) { .eb-mirrors-chip kbd { display: none; } .eb-mirrors-chip { left: 12px; bottom: auto; top: 96px; } }
`;

export class GateNames {
  private root: HTMLElement | null = null;
  private chip: HTMLElement | null = null;
  private tags = new Map<string, HTMLElement>();
  private revealUntil = 0;
  private chipUntil = 0;
  private padWas = false;
  on = true;

  constructor() {
    if (typeof document === 'undefined') return;
    if (new URLSearchParams(location.search).get('labels') === '0') this.on = false;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
    this.root = document.createElement('div');
    this.root.className = 'eb-gate-names';
    this.root.setAttribute('aria-hidden', 'true');
    document.body.append(this.root);
    // the shortcut: M (never typed into a field), a tap or click on the chip; the gamepad's d-pad left in `update`
    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'm' && e.key !== 'M')) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      this.reveal();
    });
    this.chip = document.createElement('button');
    this.chip.setAttribute('type', 'button');
    this.chip.className = 'eb-mirrors-chip';
    this.chip.setAttribute('aria-label', 'show where the mirrors lead');
    this.chip.innerHTML = '<i></i><span>mirrors</span><kbd>M</kbd>';
    this.chip.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.chip.addEventListener('click', (e) => { e.stopPropagation(); this.reveal(); });
    document.body.append(this.chip);
  }

  /** name every gate of the world on screen for a few seconds, however far (off screen: at the edge, an arrow) */
  reveal() { this.revealUntil = performance.now() + REVEAL_S * 1000; }

  /** the chip that offers the shortcut, for a while (a game began: src/duel) */
  offer(seconds = CHIP_S) { this.chipUntil = performance.now() + seconds * 1000; }

  /** this frame: the gates of the world on screen, the camera, the canvas's size in CSS pixels */
  update(gates: Iterable<Gate>, world: string, cam: Camera, w: number, h: number) {
    if (!this.root) return;
    const now = performance.now();
    // (a gamepad's d-pad left, on its edge)
    let pad = false;
    for (const p of (typeof navigator !== 'undefined' && navigator.getGamepads?.()) || []) if (p?.buttons[14]?.pressed) pad = true;
    if (pad && !this.padWas) this.reveal();
    this.padWas = pad;
    const showing = now < this.revealUntil;
    this.chip?.classList.toggle('on', this.on && (now < this.chipUntil || showing) && !document.body.classList.contains('front'));
    const seen = new Set<string>();
    if (this.on) for (const g of gates) {
      if (g.world !== world || !g.partner || g.open < 0.4) continue;
      const top: [number, number, number] = [g.at[0] + g.up[0] * g.radius * 1.9, g.at[1] + g.up[1] * g.radius * 1.9, g.at[2] + g.up[2] * g.radius * 1.9];
      const m = cam.viewProj, x = top[0], y = top[1], z = top[2];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      let sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / Math.max(Math.abs(cw), 1e-3), sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / Math.max(Math.abs(cw), 1e-3);
      const e = cam.position, d = Math.hypot(g.at[0] - e[0], g.at[1] - e[1], g.at[2] - e[2]);
      const onScreen = cw > 0.1 && Math.abs(sx) <= 1.15 && Math.abs(sy) <= 1.15;
      let k = Math.min(1, Math.max(0, (d - NEAR) / 1.6)) * Math.min(1, (g.open - 0.4) / 0.4);
      if (!showing) {
        if (!onScreen) continue;
        k *= Math.min(1, Math.max(0, (FAR - d) / (FAR - FULL)));
      }
      if (k <= 0.01) continue;
      // off screen (or behind the eye): at the screen's edge, toward it
      let edge = false, ang = 0;
      if (!onScreen) {
        if (cw <= 0.1) { sx = -sx; sy = -sy; }
        const l = Math.max(Math.abs(sx) / 0.86, Math.abs(sy) / 0.8, 1e-3);
        ang = Math.atan2(-sy, sx);
        sx /= l; sy /= l;
        edge = true;
      }
      seen.add(g.id);
      let t = this.tags.get(g.id);
      if (!t) {
        const to = g.partner.world;
        t = document.createElement('div');
        t.className = 'eb-gate-name';
        t.dataset.world = to;
        t.innerHTML = `<i style="--c:${WORLD_CSS[to] ?? '#ffc861'}"></i><span>${WORLD_NAMES[to] ?? to}</span><b>&#10148;</b>`;
        this.root.append(t);
        this.tags.set(g.id, t);
      }
      t.classList.toggle('edge', edge);
      if (edge) t.style.setProperty('--a', `${ang.toFixed(3)}rad`);
      // (a little smaller further off; never under 0.75)
      const s = 0.75 + 0.25 * Math.min(1, Math.max(0, (FAR - d) / (FAR - 4)));
      // (kept whole on screen: a plaque at the edge never cut by it)
      const hw = (t.offsetWidth * s) / 2 + 8, hh = t.offsetHeight * s + 8;
      const px = Math.max(hw, Math.min(w - hw, (sx * 0.5 + 0.5) * w)), py = Math.max(hh, Math.min(h - 8, (0.5 - sy * 0.5) * h));
      t.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, ${edge ? '-50%' : '-100%'}) scale(${s.toFixed(3)})`;
      t.style.opacity = k.toFixed(3);
    }
    for (const [id, t] of this.tags) if (!seen.has(id)) t.style.opacity = '0';
  }
}

/** the mirror's light over the whole screen for a moment (a gold-white bloom in the far world's colour, gone in half
 *  a second): what covers the main view's cut to the other world when the eye couldn't come through the disc
 *  (Portals.arrive). Stepped by hand (a capture), it fades on the page's own clock all the same */
export function mirrorFlash(world: string) {
  if (typeof document === 'undefined') return;
  const v = document.createElement('div');
  const c = WORLD_CSS[world] ?? '#ffc861';
  v.className = 'eb-mirror-flash';
  v.setAttribute('aria-hidden', 'true');
  v.style.cssText = 'position:fixed;inset:0;z-index:4;pointer-events:none;opacity:1;transition:opacity 0.6s ease-out;'
    + `background:radial-gradient(circle at 50% 50%, rgba(255,248,226,0.95) 0%, color-mix(in srgb, ${c} 50%, rgba(255,236,190,0.9)) 50%, color-mix(in srgb, ${c} 70%, rgba(255,236,190,0.6)) 100%);`;
  document.body.append(v);
  requestAnimationFrame(() => requestAnimationFrame(() => { v.style.opacity = '0'; }));
  setTimeout(() => v.remove(), 900);
}

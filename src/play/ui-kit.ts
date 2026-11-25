/**
 * Energy Bending · Solarpunk Art Nouveau UI Kit.
 *
 * Original elemental emblems (fire, water, ice, plasma, gems), kinetic surf trick icons
 * (carve, flip, spin, morph, form, fuse), mirrored botanical corner filigree, and the
 * 3-tier parametric radial Charge + Beat Ring dock.
 *
 * Strictly zero `backdrop-filter` (Mac 60fps rule): uses layered warm honey-glass
 * gradients, inset highlights, and antique-brass hairlines.
 */
import type { Dev } from '../duel/help';

const sun = 'var(--eb-sun, #ffc861)';
const cream = 'var(--eb-cream, #fbf4e4)';
const leaf = 'var(--eb-leaf, #8fd17f)';
const teal = 'var(--eb-teal, #4fc0c8)';
const rose = 'var(--eb-seat-1, #ff6fa3)';
const sky = 'var(--eb-sky, #a8e3ee)';

const glyph = (body: string) =>
  '<svg class="eb-kit-glyph" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round">' +
  body + '</svg>';

export const ELEMENT_EMBLEMS = {
  fire: glyph(
    '<path class="eb-kit-inlay" d="M25 5c3 9-9 13-8 22-3-1-5-4-5-7C3 31 10 42 23 43c11 1 19-7 16-17-2 4-5 5-8 5C38 21 32 11 25 5Z"/>' +
    '<path class="eb-kit-filigree" d="M23 42c-6-4-6-9-1-13 4-3 6-6 5-10 5 8-4 11-2 16 1 3 4 3 7 1M35 8h4m-2-2v4"/>',
  ),
  water: glyph(
    '<path class="eb-kit-inlay" d="M5 34c9 1 9-15 21-16 7-1 12 5 9 10-2 4-8 4-10 0-5 5 3 12 14 7-8 10-20 8-26 3-2-2-5-3-8-4Z"/>' +
    '<path class="eb-kit-filigree" d="M7 38c7 3 12 7 19 6M37 5c2 4 5 6 5 9a5 5 0 0 1-10 0c0-3 3-5 5-9Z"/>',
  ),
  ice: glyph(
    '<path class="eb-kit-inlay" d="m24 4 5 11 13-1-7 10 7 10-13-1-5 11-5-11-13 1 7-10-7-10 13 1Z"/>' +
    '<path class="eb-kit-filigree" d="m24 4 5 20-5 20-5-20Zm-18 10 13 10-13 10m36-20L29 24l13 10"/>',
  ),
  plasma: glyph(
    '<path class="eb-kit-inlay" d="M40 8C28 5 12 12 9 23c-3 10 6 16 14 11-9 1-13-5-7-13C22 12 32 8 40 8Z"/>' +
    '<path class="eb-kit-inlay eb-kit-filigree" d="M8 40c12 3 28-4 31-15 3-10-6-16-14-11 9-1 13 5 7 13-6 9-16 13-24 13Z"/>' +
    '<path class="eb-kit-solid" d="m24 19 2 3 3 2-3 2-2 3-2-3-3-2 3-2Z"/>',
  ),
  gems: glyph(
    '<path class="eb-kit-inlay" d="m24 5 16 13-16 24L8 18Z"/>' +
    '<path d="M8 18h32M24 5l-7 13 7 24 7-24Z"/>' +
    '<path class="eb-kit-filigree eb-kit-inlay" d="M17 32C9 33 6 29 5 24c5 0 10 2 12 8Zm14 0c8 1 11-3 12-8-5 0-10 2-12 8Z"/>',
  ),
} as const;

export type KitElement = keyof typeof ELEMENT_EMBLEMS;

export const ELEMENT_HEX: Record<KitElement, string> = {
  fire: '#ff9a3c',
  water: '#3dc9dd',
  ice: '#9cebff',
  plasma: '#d978ff',
  gems: '#8fd17f',
};

export const ACTION_ICONS = {
  carve: glyph(
    '<path d="M5 32c9 1 11-16 22-17 6-1 10 2 11 5-9-2-12 6-18 10-4 3-9 4-15 2Z"/>' +
    '<path class="eb-kit-filigree" d="M8 39c8 0 14-3 20-9 4-4 9-7 15-5-6 1-8 6-12 10-5 5-11 7-17 7"/>',
  ),
  flip: glyph(
    '<path d="M13 35C2 24 9 8 22 8c11 0 18 10 14 18-3 6-11 7-15 3-3-3-2-8 2-10m-5 0h5l1 5"/>' +
    '<path class="eb-kit-solid" d="m36 31 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>',
  ),
  spin: glyph(
    '<path class="eb-kit-inlay" d="M5 22c9-9 26-12 35-5 8 7-5 18-19 17-6 0-10-3-7-6 3-4 12-4 15-1-1-6-15-6-20 0-6 7 8 14 21 11 9-2 14-7 14-13"/>' +
    '<path class="eb-kit-filigree" d="M10 14c6-5 15-8 23-6m-9 33 5 2 5-2"/>',
  ),
  morph: glyph(
    '<path class="eb-kit-inlay" d="M24 10C16 9 8 14 7 23c-1 9 6 16 15 16 5 0 8-3 9-6-4 2-9 1-10-3-2-4 2-8 6-8-5-3-6-8-3-12Z"/>' +
    '<path class="eb-kit-filigree" d="m31 8 4 4-4 4-4-4Zm6 13 4 4-4 4-4-4Z"/>' +
    '<path class="eb-kit-solid" d="M41 12a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM35 36a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 1 0 0-3.6Z"/>',
  ),
  form: glyph(
    '<path class="eb-kit-inlay" d="m24 16 9 13-9 13-9-13Z"/><path d="M15 29h18M24 16v26"/>' +
    '<path class="eb-kit-filigree" d="M18 13a6 6 0 0 1 12 0M24 3v2m-8 2 2 2m14-2-2 2M6 32c0-8 4-14 9-17m-9 4 9-4-3 8m30 9c0-8-4-14-9-17m9 4-9-4 3 8"/>',
  ),
  fuse: glyph(
    '<path d="M24 17C15 5 4 12 6 22c1 7 9 11 18 19 11-9 20-14 18-23-2-7-10-8-15-2-5 6-3 11 5 15"/>' +
    '<path class="eb-kit-filigree" d="M24 17c5 6 3 11-5 16m-4-20c-5 5-1 12 10 16m8-16c5 5 1 12-10 16"/>',
  ),
} as const;

export type KitAction = keyof typeof ACTION_ICONS;
export type ActionState = 'idle' | 'ready' | 'active' | 'unavailable';

const ELEMENT_COLOR: Record<KitElement, string> = {
  fire: sun, water: teal, ice: sky, plasma: rose, gems: leaf,
};

/** 60 × 34 Art Nouveau botanical filigree sprig; CSS mirrors the second copy */
export const BOTANICAL_CORNER = `<svg class="eb-kit-corner" viewBox="0 0 60 34" aria-hidden="true" focusable="false">
  <path fill="none" stroke="var(--eb-brass, #c9a463)" stroke-width="1.3" stroke-linecap="round"
    d="M3 31C3 12 13 4 28 4h26M5 28C13 28 13 17 25 15c10-2 15 2 23-6M11 25c6 2 11 0 14-4"/>
  <path fill="${leaf}" fill-opacity=".58" stroke="var(--eb-brass, #c9a463)" stroke-width=".8"
    d="M16 19c0-6 3-9 8-10 0 5-3 9-8 10Zm9-4c7-1 10 0 13 4-6 2-10 0-13-4Z"/>
  <path fill="${sun}" d="m54 4 2-2 2 2-2 2Z"/>
</svg>`;

/** compact horizontal Art Nouveau filigree flourish for calligraphic callout banners */
export const RIBBON_FLOURISH = `<svg class="eb-kit-flourish" viewBox="0 0 42 18" aria-hidden="true" focusable="false">
  <path fill="none" stroke="var(--eb-brass, #d4af6a)" stroke-width="1.25" stroke-linecap="round"
    d="M40 9H15C9 9 6 4 2 4M36 9c-6 0-9 5-16 5-4 0-7-2-10-4"/>
  <path fill="${leaf}" fill-opacity=".62" stroke="var(--eb-brass, #d4af6a)" stroke-width=".7"
    d="M23 9c-2-4-6-6-10-5 2 3 5 5 10 5Z"/>
  <path fill="${sun}" d="m38 9 2-2 2 2-2 2Z"/>
</svg>`;

export interface ChargeThresholds {
  tier1: number;
  tier2: number;
}

export interface DockFrame {
  charge: number;
  beat: number;
  bpm: number;
}

const DEFAULT_THRESHOLDS: ChargeThresholds = { tier1: 1 / 3, tier2: 2 / 3 };
const TIER_LABELS = ['Charge', 'Tier 1', 'Tier 2', 'Overdrive'] as const;
const RING_SIZE = 128;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 48;
const CHARGE_START = 127;
const CHARGE_SWEEP = 286;
const TIER_COUNT = 3;
const SEGMENT_GAP = 4;

function polar(radius: number, degrees: number) {
  const angle = degrees * Math.PI / 180;
  return `${(RING_CENTER + radius * Math.cos(angle)).toFixed(3)} ${(RING_CENTER + radius * Math.sin(angle)).toFixed(3)}`;
}

function chargeArc(start: number, end: number) {
  return `M${polar(RING_RADIUS, start)} A${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${polar(RING_RADIUS, end)}`;
}

function chargeTick(angle: number, overdrive: boolean) {
  if (overdrive) {
    return `M${polar(54, angle)} L${polar(48, angle - 3.6)} L${polar(42, angle)} L${polar(48, angle + 3.6)}Z`;
  }
  return `M${polar(43, angle)} L${polar(53, angle)}`;
}

/** Three equal visible charge segments with Overdrive diamond cap & music-synced beat core */
export function chargeBeatRingSvg() {
  const track: string[] = [];
  const fills: string[] = [];
  const ticks: string[] = [];
  const segmentSweep = CHARGE_SWEEP / TIER_COUNT;

  for (let i = 0; i < TIER_COUNT; i++) {
    const start = CHARGE_START + i * segmentSweep;
    const end = start + segmentSweep;
    const arc = chargeArc(start + SEGMENT_GAP, end - SEGMENT_GAP);
    track.push(arc);
    fills.push(`<path class="eb-kit-charge-fill" d="${arc}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>`);
    ticks.push(`<path class="eb-kit-tick" d="${chargeTick(end, i === TIER_COUNT - 1)}"/>`);
  }

  return `<svg class="eb-kit-ring" viewBox="0 0 ${RING_SIZE} ${RING_SIZE}" aria-hidden="true" focusable="false">
    <circle class="eb-kit-rim" cx="64" cy="64" r="58"/>
    <circle class="eb-kit-rim eb-kit-inner-rim" cx="64" cy="64" r="39"/>
    <path class="eb-kit-track" d="${track.join(' ')}"/>
    ${fills.join('')}
    ${ticks.join('')}
    <circle class="eb-kit-beat-halo" cx="64" cy="84" r="6.5"/>
    <circle class="eb-kit-beat-core" cx="64" cy="84" r="2.6"/>
  </svg>`;
}

export const HUD_KIT_CSS = `
.eb-kit-dock {
  --kit-brass: var(--eb-brass, #c9a463);
  --kit-sun: ${sun};
  --kit-cream: ${cream};
  --kit-accent: var(--kit-sun);
  --kit-ring-size: clamp(92px, 15vw, 114px);
  position: fixed;
  z-index: 6;
  inset-inline: 0;
  bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  width: min(588px, calc(100% - 16px));
  height: 74px;
  margin-inline: auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--kit-ring-size) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  align-items: center;
  box-sizing: border-box;
  padding-inline: 14px;
  border: 1px solid var(--kit-brass);
  border-radius: 28px 28px 18px 18px;
  color: var(--kit-cream);
  font-family: var(--eb-body, "Nunito Sans", system-ui, sans-serif);
  background:
    radial-gradient(ellipse at 50% -42%, #ffc86142, transparent 63%),
    linear-gradient(180deg, #ffe2a829, #ffe2a800 42%),
    linear-gradient(180deg, #342613f2, #181008f8);
  box-shadow: inset 0 1px #fff0c858, inset 0 -2px #09060395, 0 6px 22px #0b0906c0;
  pointer-events: none;
  user-select: none;
  transition: opacity 0.3s;
}
.eb-kit-dock.hide, .eb-kit-dock[hidden] { opacity: 0; }
.eb-kit-corner { position: absolute; top: 2px; left: 4px; width: 42px; height: 24px; opacity: .73; }
.eb-kit-corner + .eb-kit-corner { inset-inline: auto 4px; transform: scaleX(-1); }
.eb-kit-trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.eb-kit-action {
  position: relative;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 2px;
  height: 58px;
  border: 1px solid transparent;
  border-radius: 18px 18px 10px 10px;
  color: var(--kit-cream);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
}
.eb-kit-action .eb-kit-glyph { width: 25px; height: 25px; color: var(--eb-sun-hi, #fff0c8); }
.eb-kit-lbl { white-space: nowrap; }
.eb-kit-kbd {
  font: 800 9px/1 var(--eb-body, system-ui, sans-serif);
  letter-spacing: 0.06em;
  padding: 2px 5px;
  border-radius: 5px;
  color: #ffe8b5;
  background: rgba(18, 12, 6, 0.78);
  border: 1px solid rgba(201, 164, 99, 0.45);
  white-space: nowrap;
}
.eb-kit-action[data-state="unavailable"] .eb-kit-glyph { opacity: .42; }
.eb-kit-action[data-state="unavailable"] { color: #b7a285; }
.eb-kit-action[data-state="unavailable"] .eb-kit-kbd { opacity: .45; }
.eb-kit-action[data-state="ready"], .eb-kit-action[data-state="active"] {
  border-color: var(--kit-brass);
  background: radial-gradient(ellipse at 50% 0%, #ffc8612b, transparent 85%), #281d10;
  box-shadow: inset 0 1px #fff0c82e;
}
.eb-kit-action[data-state="ready"] .eb-kit-glyph,
.eb-kit-action[data-state="active"] .eb-kit-glyph { color: var(--kit-accent); }
.eb-kit-action[data-state="active"] .eb-kit-kbd {
  background: var(--kit-accent);
  color: #1c1207;
  border-color: #fff3d0;
}
.eb-kit-action::after {
  content: "";
  position: absolute;
  inset: -1px;
  border: 1px solid var(--kit-accent);
  border-radius: inherit;
  opacity: 0;
}
.eb-kit-action[data-state="active"]::after {
  box-shadow: 0 0 10px color-mix(in srgb, var(--kit-accent) 60%, transparent);
  animation: eb-kit-glow 750ms ease-in-out infinite alternate;
}
@keyframes eb-kit-glow { from { opacity: .55; } to { opacity: 1; } }
.eb-kit-dial {
  position: relative;
  align-self: end;
  width: var(--kit-ring-size);
  aspect-ratio: 1;
  margin-bottom: -4px;
  display: grid;
  grid-template: 1fr / 1fr;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle, #61431d 0%, #382613 33%, #24190e 59%, #110d08 72%);
  box-shadow: 0 4px 14px #090603d4, inset 0 0 0 1px rgba(255, 224, 150, 0.2);
}
.eb-kit-dial[data-tier="3"] {
  box-shadow: 0 0 22px rgba(255, 210, 110, 0.65), 0 4px 14px #090603d4;
}
.eb-kit-dial > * { grid-area: 1 / 1; }
.eb-kit-ring { display: block; width: 100%; overflow: visible; fill: none; }
.eb-kit-rim { stroke: var(--kit-brass); stroke-width: 1.45; }
.eb-kit-inner-rim { opacity: .48; stroke-width: 1; }
.eb-kit-track { stroke: #8c7048; stroke-width: 6.5; opacity: .57; }
.eb-kit-charge-fill { stroke: var(--kit-accent); stroke-width: 5.8; stroke-linecap: round; }
.eb-kit-charge-fill + .eb-kit-charge-fill { stroke: color-mix(in srgb, var(--kit-accent), var(--kit-sun) 45%); }
.eb-kit-charge-fill + .eb-kit-charge-fill + .eb-kit-charge-fill { stroke: #fff0b8; }
.eb-kit-tick { stroke: var(--kit-sun); stroke-width: 1.6; stroke-linecap: round; opacity: .7; }
.eb-kit-tick:last-of-type { fill: #523719; }
.eb-kit-tick[data-reached] { opacity: 1; stroke: var(--eb-sun-hi, #fff0c8); }
.eb-kit-tick[data-reached]:last-of-type { fill: var(--kit-sun); }
.eb-kit-beat-halo {
  stroke: var(--kit-sun);
  stroke-width: 1.2;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
}
.eb-kit-beat-core { fill: var(--eb-sun-hi, #fff0c8); opacity: .72; }
.eb-kit-emblem {
  display: grid;
  place-items: center;
  width: 39%;
  margin-top: -16%;
  color: var(--kit-accent);
}
.eb-kit-emblem .eb-kit-glyph { display: block; width: 100%; }
.eb-kit-inlay { fill: currentColor; fill-opacity: .14; }
.eb-kit-filigree { stroke: var(--eb-sun-hi, #fff0c8); stroke-width: 1.85; }
.eb-kit-action .eb-kit-filigree { stroke-width: 2.4; }
.eb-kit-solid { fill: currentColor; stroke: none; }
.eb-kit-dial-status {
  align-self: end;
  margin-bottom: 10%;
  color: var(--kit-cream);
  font: 600 11.5px/1 var(--eb-display, "Fraunces", Georgia, serif);
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.eb-kit-action-state {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 480px) {
  .eb-kit-dock { --kit-ring-size: 80px; padding-inline: 5px; height: 64px; }
  .eb-kit-trio { gap: 1px; }
  .eb-kit-corner { display: none; }
  .eb-kit-action { height: 50px; font-size: 9.5px; }
  .eb-kit-action .eb-kit-glyph { width: 21px; height: 21px; }
  .eb-kit-kbd { font-size: 8px; padding: 1px 4px; }
  .eb-kit-dial-status { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .eb-kit-action[data-state="active"]::after { animation: none; opacity: 1; }
  .eb-kit-beat-halo { display: none; }
}
`;

const ACTION_LABELS: Record<KitAction, string> = {
  carve: 'Slide', flip: 'Jump', spin: 'Spin', morph: 'Morph', form: 'Form', fuse: 'Fuse',
};

const DOCK_KEYS: Record<Dev, Record<KitAction, string>> = {
  solo:  { carve: 'A D', flip: 'Space', spin: 'Click', morph: 'Shift', form: 'E', fuse: 'F' },
  left:  { carve: 'A D', flip: 'Space', spin: 'L', morph: 'Shift', form: 'E', fuse: 'F' },
  right: { carve: '← →', flip: "'", spin: '/', morph: 'R-Shift', form: 'Enter', fuse: 'Ctrl' },
  pad:   { carve: 'Stick', flip: 'A', spin: 'Y', morph: 'RT', form: 'LT', fuse: 'Hold Y' },
  touch: { carve: 'Stick', flip: 'Jump', spin: 'Spin', morph: 'Dodge', form: 'Form', fuse: 'Merge' },
};

function actionTile(action: KitAction) {
  return `<div class="eb-kit-action" data-action="${action}" data-state="idle">${ACTION_ICONS[action]}<span class="eb-kit-lbl">${ACTION_LABELS[action]}</span><kbd class="eb-kit-kbd">${DOCK_KEYS.solo[action]}</kbd><span class="eb-kit-action-state"></span></div>`;
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function createActionDock(element: KitElement = 'fire', thresholds = DEFAULT_THRESHOLDS) {
  const { tier1, tier2 } = thresholds;
  if (!(0 < tier1 && tier1 < tier2 && tier2 < 1)) {
    throw new RangeError('Charge thresholds must satisfy 0 < tier1 < tier2 < 1.');
  }

  const root = document.createElement('div');
  root.className = 'eb-kit-dock';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Flow Surf action dock');
  root.innerHTML = `${BOTANICAL_CORNER}${BOTANICAL_CORNER}
    <div class="eb-kit-trio">${(['carve', 'flip', 'spin'] as const).map(actionTile).join('')}</div>
    <div class="eb-kit-dial" role="meter" aria-label="Hold charge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Uncharged">
      ${chargeBeatRingSvg()}<span class="eb-kit-emblem"></span><span class="eb-kit-dial-status" aria-hidden="true">Beat</span>
    </div>
    <div class="eb-kit-trio">${(['morph', 'form', 'fuse'] as const).map(actionTile).join('')}</div>`;

  const dial = root.querySelector<HTMLElement>('.eb-kit-dial')!;
  const emblem = root.querySelector<HTMLElement>('.eb-kit-emblem')!;
  const status = root.querySelector<HTMLElement>('.eb-kit-dial-status')!;
  const halo = root.querySelector<SVGCircleElement>('.eb-kit-beat-halo')!;
  const beatCore = root.querySelector<SVGCircleElement>('.eb-kit-beat-core')!;
  const fills = [...root.querySelectorAll<SVGPathElement>('.eb-kit-charge-fill')];
  const ticks = [...root.querySelectorAll<SVGPathElement>('.eb-kit-tick')];
  const actions = new Map(
    [...root.querySelectorAll<HTMLElement>('[data-action]')].map((tile) => [tile.dataset.action as KitAction, tile]),
  );
  const boundaries = [0, tier1, tier2, 1];
  const lastOffsets = [1, 1, 1];
  let lastElement: KitElement | undefined;
  let lastDev: Dev | undefined;
  let lastCharge = -1;
  let lastPercent = -1;
  let lastTier = -1;
  let lastPulse = -1;

  function setElement(next: KitElement) {
    if (next === lastElement) return;
    lastElement = next;
    root.style.setProperty('--kit-accent', ELEMENT_COLOR[next]);
    emblem.innerHTML = ELEMENT_EMBLEMS[next];
    root.setAttribute('aria-label', `Flow Surf dock · ${next}`);
    // update morph tile label dynamically so players instantly know what their element's Morph does!
    const morphLbl = actions.get('morph')?.querySelector('.eb-kit-lbl');
    if (morphLbl) {
      morphLbl.textContent = next === 'water' || next === 'ice' ? 'Slip' : next === 'gems' ? 'Scatter' : 'Dissolve';
    }
  }

  function setDevice(dev: Dev) {
    if (dev === lastDev) return;
    lastDev = dev;
    const keys = DOCK_KEYS[dev] ?? DOCK_KEYS.solo;
    for (const [act, tile] of actions) {
      const k = tile.querySelector('.eb-kit-kbd');
      if (k) k.textContent = keys[act];
    }
  }

  function setAction(action: KitAction, state: ActionState) {
    const tile = actions.get(action);
    if (!tile || tile.dataset.state === state) return;
    tile.dataset.state = state;
    tile.querySelector('.eb-kit-action-state')!.textContent = state === 'idle' ? '' : ` · ${state}`;
  }

  function update({ charge, beat, bpm }: DockFrame) {
    const progress = clampUnit(charge);
    if (progress !== lastCharge) {
      fills.forEach((fill, i) => {
        const fraction = clampUnit((progress - boundaries[i]) / (boundaries[i + 1] - boundaries[i]));
        const offset = Math.round((1 - fraction) * 1000) / 1000;
        if (offset === lastOffsets[i]) return;
        fill.setAttribute('stroke-dashoffset', String(offset));
        lastOffsets[i] = offset;
      });

      const tier = progress >= 0.98 ? 3 : progress >= tier2 ? 2 : progress >= tier1 ? 1 : 0;
      if (tier !== lastTier) {
        ticks.forEach((tick, i) => tick.toggleAttribute('data-reached', i < tier));
        dial.dataset.tier = String(tier);
      }

      const uncharged = progress < 0.01;
      const labelChanged = tier !== lastTier || uncharged !== (lastCharge < 0.01);
      if (labelChanged) status.textContent = uncharged ? 'Beat' : TIER_LABELS[tier];

      const percent = progress >= 0.98 ? 100 : Math.min(99, Math.round(progress * 100));
      if (percent !== lastPercent) dial.setAttribute('aria-valuenow', String(percent));
      if (labelChanged || percent !== lastPercent) {
        const valueText = uncharged ? 'Uncharged' : `${TIER_LABELS[tier]}, ${percent}%`;
        dial.setAttribute('aria-valuetext', valueText);
      }
      lastCharge = progress;
      lastPercent = percent;
      lastTier = tier;
    }

    const phase = ((beat % 1) + 1) % 1;
    const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 110;
    const pulse = Math.round(clampUnit(1 - phase * (60 / tempo) / 0.22) * 100) / 100;
    if (pulse !== lastPulse) {
      halo.style.opacity = String(pulse * 0.92);
      halo.style.transform = `scale(${1.52 - 0.55 * pulse})`;
      beatCore.style.opacity = String(0.72 + pulse * 0.28);
      lastPulse = pulse;
    }
  }

  setElement(element);
  return { root, setElement, setDevice, setAction, update };
}

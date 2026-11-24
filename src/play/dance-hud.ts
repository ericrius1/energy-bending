// Solarpunk Art Nouveau live HUD for Flow Surf / Dance: zero extra GPU passes, zero backdrop-filter (Mac 60fps).
// Three visual zones:
//   1. Top-Left Twin Elemental Harmony Bar (YOUR emblem + flow <-> Harmony Nexus diamond <-> PARTNER flow + emblem,
//      plus Combo multiplier & Flow Score ribbon).
//   2. Upper-Center Calligraphic Trick & Reaction Ribbon (Fraunces italic display callouts framed by botanical filigree).
//   3. Bottom-Center Living Reactive Action Dock & 3-Tier Radial Charge + Beat Ring (src/play/ui-kit.ts).
import { RULES } from '../../shared/rules.ts';
import type { PublicState } from '../../shared/protocol.ts';
import type { Element, JogoEvent } from './jogo';
import type { SurfEvent } from './surf';
import type { Intent } from '../input/intent';
import type { Dev } from '../duel/help';
import {
  ELEMENT_EMBLEMS,
  ELEMENT_HEX,
  RIBBON_FLOURISH,
  HUD_KIT_CSS,
  createActionDock,
  type KitElement,
} from './ui-kit';

const MOVE_LABEL: Record<string, string> = {
  somersault: 'SOMERSAULT',
  backflip: 'BACKFLIP',
  corkscrew: 'CORKSCREW 540°',
  cyclone: 'CYCLONE SPIN',
  'hydro-slip': 'HYDRO-SLIP WAVE',
  'ember-surge': 'EMBER DISSOLVE',
  'surf-carve': 'POWER CARVE',
  'meia-lua': 'MEIA-LUA',
  armada: 'ARMADA',
  martelo: 'MARTELO',
  bencao: 'BÊNÇÃO',
  rasteira: 'RASTEIRA',
  au: 'AÚ · CARTWHEEL',
  macaco: 'MACACO',
  role: 'ROLÊ · ROLL',
  esquiva: 'ESQUIVA · DODGE',
  spin: 'PIROUETTE SPIN',
  pirueta: 'PIROUETTE',
  strike: 'STRIKE',
  throw: 'ENERGY STREAM',
  block: 'GUARD',
  jump: 'LEAP',
  dash: 'DASH',
};

const CSS = HUD_KIT_CSS + `
/* ── Zone 1: Top-Right Twin Elemental Harmony Bar (clear of top-left ericlevin.dev pill) ── */
.dhud-twin {
  position: fixed;
  top: calc(14px + env(safe-area-inset-top, 0px));
  right: calc(14px + env(safe-area-inset-right, 0px));
  left: auto;
  z-index: 6;
  pointer-events: none;
  user-select: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: min(358px, calc(100vw - 128px));
  color: var(--eb-cream, #fbf4e4);
  font-family: var(--eb-body, "Nunito Sans", system-ui, sans-serif);
  transition: opacity 0.3s;
}
.dhud-twin.hide { opacity: 0; }
.dhud-plate {
  position: relative;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 52px minmax(0, 1fr) 38px;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 999px;
  border: 1px solid rgba(208, 170, 102, 0.72);
  background:
    radial-gradient(ellipse at 50% -30%, rgba(255, 208, 104, 0.24), transparent 65%),
    linear-gradient(180deg, rgba(50, 36, 17, 0.94), rgba(22, 15, 7, 0.96));
  box-shadow: inset 0 1px rgba(255, 240, 200, 0.36), inset 0 -2px rgba(9, 6, 3, 0.7), 0 6px 20px rgba(8, 5, 2, 0.52);
}
.dhud-med {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--mc, #ff9a3c);
  border: 1.5px solid var(--mc, #ff9a3c);
  background: radial-gradient(circle at 38% 32%, rgba(255, 244, 214, 0.2), rgba(24, 16, 8, 0.96) 72%);
  box-shadow: 0 0 12px color-mix(in srgb, var(--mc, #ff9a3c) 45%, transparent), inset 0 1px rgba(255, 245, 220, 0.35);
}
.dhud-med .eb-kit-glyph { width: 22px; height: 22px; display: block; }
.dhud-side { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dhud-side.right { text-align: right; }
.dhud-names {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(251, 244, 228, 0.86);
}
.dhud-who { font: italic 700 11.5px/1 var(--eb-display, "Fraunces", Georgia, serif); letter-spacing: 0.03em; color: #fff0c8; text-transform: none; }
.dhud-track {
  position: relative;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 240, 200, 0.12);
  border: 1px solid rgba(208, 170, 102, 0.32);
  overflow: hidden;
}
.dhud-fill {
  position: absolute;
  top: 0; bottom: 0;
  width: 0%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--mc, #ff9a3c), #ffe49c);
  box-shadow: 0 0 8px var(--mc, #ff9a3c);
  transition: width 0.08s linear;
}
.dhud-side.left .dhud-fill { left: 0; }
.dhud-side.right .dhud-fill { right: 0; background: linear-gradient(270deg, var(--mc, #3dc9dd), #d6f8ff); }
.dhud-nexus {
  position: relative;
  width: 44px;
  height: 44px;
  margin: -6px auto;
  display: grid;
  place-items: center;
}
.dhud-diamond {
  position: absolute;
  inset: 5px;
  transform: rotate(45deg);
  border-radius: 7px;
  border: 1.5px solid #e0ba72;
  background: radial-gradient(circle, #5b3f19 0%, #24170a 78%);
  box-shadow: 0 0 12px rgba(255, 205, 102, 0.35), inset 0 1px rgba(255, 245, 215, 0.45);
  overflow: hidden;
}
.dhud-diamond-fill {
  position: absolute;
  inset: auto 0 0 0;
  height: 0%;
  background: linear-gradient(0deg, #ff9c3b, #ffe496 65%, #7ef5f0);
  opacity: 0.72;
  transition: height 0.12s linear;
}
.dhud-nexus.ready .dhud-diamond {
  border-color: #fff2be;
  box-shadow: 0 0 20px rgba(255, 218, 114, 0.92), inset 0 0 8px rgba(255, 245, 200, 0.75);
}
.dhud-pct {
  position: relative;
  z-index: 1;
  font: 800 10.5px/1 var(--eb-body, system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  color: #fff8e2;
  text-shadow: 0 1px 4px rgba(10, 6, 2, 0.92);
}

.dhud-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(201, 164, 99, 0.48);
  background: linear-gradient(180deg, rgba(36, 25, 12, 0.9), rgba(18, 12, 6, 0.92));
  box-shadow: inset 0 1px rgba(255, 240, 200, 0.22), 0 4px 14px rgba(8, 5, 2, 0.42);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dhud-score { font-variant-numeric: tabular-nums; color: #fff4d2; }
.dhud-combo {
  padding: 2px 7px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffd36e, #d89232);
  color: #1c1206;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  opacity: 0.45;
  transition: transform 0.18s, opacity 0.18s;
}
.dhud-combo.hot { opacity: 1; transform: scale(1.06); box-shadow: 0 0 12px rgba(255, 204, 92, 0.65); }
.dhud-rings { color: #9be8ee; font-variant-numeric: tabular-nums; }
.dhud-status { margin-left: auto; color: rgba(251, 244, 228, 0.72); white-space: nowrap; }
.dhud-status.glow { color: #ffe38e; text-shadow: 0 0 10px rgba(255, 200, 97, 0.72); }

/* ── Zone 2: Upper-Center Calligraphic Trick & Reaction Ribbon ── */
.dhud-ribbon {
  position: fixed;
  top: calc(18px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%) translateY(-8px) scale(0.95);
  z-index: 6;
  pointer-events: none;
  user-select: none;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px 8px;
  border-radius: 999px;
  border: 1px solid rgba(212, 174, 102, 0.72);
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255, 214, 118, 0.24), transparent 72%),
    linear-gradient(180deg, rgba(46, 33, 16, 0.94), rgba(20, 14, 7, 0.96));
  box-shadow: inset 0 1px rgba(255, 242, 204, 0.42), 0 8px 26px rgba(8, 5, 2, 0.56);
  opacity: 0;
  transition: opacity 0.2s, transform 0.22s, top 0.22s;
  white-space: nowrap;
}
.dhud-ribbon.on { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
.dhud-ribbon.below-tut { top: calc(168px + env(safe-area-inset-top, 0px)); }
.dhud-ribbon.gold {
  border-color: #ffe398;
  box-shadow: inset 0 1px rgba(255, 248, 220, 0.58), 0 0 24px rgba(255, 202, 92, 0.48), 0 8px 26px rgba(8, 5, 2, 0.58);
}
.eb-kit-flourish { width: 34px; height: 15px; flex: none; opacity: 0.88; }
.eb-kit-flourish.flip { transform: scaleX(-1); }
.dhud-rib-txt {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.dhud-rib-main {
  font: italic 700 15.5px/1.1 var(--eb-display, "Fraunces", Georgia, serif);
  letter-spacing: 0.04em;
  color: #fff6dc;
  text-shadow: 0 1px 4px rgba(10, 6, 2, 0.85);
}
.dhud-ribbon.gold .dhud-rib-main { color: #ffe8a2; }
.dhud-rib-sub {
  font: 800 11.5px/1 var(--eb-body, system-ui, sans-serif);
  letter-spacing: 0.08em;
  color: #8cf2ec;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 700px) {
  .dhud-twin { top: calc(10px + env(safe-area-inset-top, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); left: auto; width: min(304px, calc(100vw - 68px)); }
  .dhud-plate { grid-template-columns: 30px minmax(0, 1fr) 42px minmax(0, 1fr) 30px; padding: 5px 6px; gap: 4px; }
  .dhud-med { width: 28px; height: 28px; }
  .dhud-med .eb-kit-glyph { width: 17px; height: 17px; }
  .dhud-nexus { width: 36px; height: 36px; }
  .dhud-ribbon { top: calc(96px + env(safe-area-inset-top, 0px)); padding: 6px 12px; }
  .dhud-rib-main { font-size: 13px; }
  .eb-kit-flourish { width: 22px; height: 12px; }
}
`;

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.dataset.eb = 'dance-hud';
  s.textContent = CSS;
  document.head.append(s);
}

export interface DanceHudFrame {
  seat: number;
  el: Element;
  partnerEl?: Element;
  state: PublicState | null;
  events: readonly JogoEvent[];
  raw: readonly Record<string, unknown>[];
  beat: number;
  bpm: number;
  hidden?: boolean;
  // Flow Surf live telemetry
  surfMode?: boolean;
  charge?: number;
  chargeAction?: 'jump' | 'spin' | 'morph' | null;
  dissolve?: number;
  bank?: number;
  carveSlide?: number;
  activeMove?: string | null;
  airborne?: boolean;
  intent?: Intent | null;
  score?: number;
  combo?: number;
  rings?: number;
  surfEvents?: readonly SurfEvent[];
  dev?: Dev;
  tutorialActive?: boolean;
}

export class DanceHud {
  private twin: HTMLElement | null = null;
  private medL: HTMLElement | null = null;
  private medR: HTMLElement | null = null;
  private elL: HTMLElement | null = null;
  private elR: HTMLElement | null = null;
  private fillL: HTMLElement | null = null;
  private fillR: HTMLElement | null = null;
  private nexus: HTMLElement | null = null;
  private nexusFill: HTMLElement | null = null;
  private pctEl: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private comboEl: HTMLElement | null = null;
  private ringsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private ribbon: HTMLElement | null = null;
  private ribMain: HTMLElement | null = null;
  private ribSub: HTMLElement | null = null;
  private dock: ReturnType<typeof createActionDock> | null = null;
  private callT = 0;
  private lastElL = '';
  private lastElR = '';

  constructor() {
    if (typeof document === 'undefined') return;
    ensureStyle();

    // Zone 1: Top-Left Twin Elemental Harmony Bar
    const twin = document.createElement('div');
    twin.className = 'dhud-twin';
    twin.setAttribute('aria-hidden', 'true');
    twin.innerHTML = `<div class="dhud-plate">`
      + `<div class="dhud-med dhud-med-l"></div>`
      + `<div class="dhud-side left"><div class="dhud-names"><span class="dhud-who">You</span><span class="dhud-el-l">FIRE</span></div><div class="dhud-track"><div class="dhud-fill dhud-fill-l"></div></div></div>`
      + `<div class="dhud-nexus"><div class="dhud-diamond"><div class="dhud-diamond-fill"></div></div><span class="dhud-pct">0%</span></div>`
      + `<div class="dhud-side right"><div class="dhud-names"><span class="dhud-el-r">WATER</span><span class="dhud-who">Partner</span></div><div class="dhud-track"><div class="dhud-fill dhud-fill-r"></div></div></div>`
      + `<div class="dhud-med dhud-med-r"></div>`
      + `</div>`
      + `<div class="dhud-meta">`
      + `<span class="dhud-combo">×1</span>`
      + `<span class="dhud-score">0</span>`
      + `<span class="dhud-rings">0 RINGS</span>`
      + `<span class="dhud-status">FLOW SURF</span>`
      + `</div>`;
    document.body.append(twin);
    this.twin = twin;
    this.medL = twin.querySelector('.dhud-med-l');
    this.medR = twin.querySelector('.dhud-med-r');
    this.elL = twin.querySelector('.dhud-el-l');
    this.elR = twin.querySelector('.dhud-el-r');
    this.fillL = twin.querySelector('.dhud-fill-l');
    this.fillR = twin.querySelector('.dhud-fill-r');
    this.nexus = twin.querySelector('.dhud-nexus');
    this.nexusFill = twin.querySelector('.dhud-diamond-fill');
    this.pctEl = twin.querySelector('.dhud-pct');
    this.scoreEl = twin.querySelector('.dhud-score');
    this.comboEl = twin.querySelector('.dhud-combo');
    this.ringsEl = twin.querySelector('.dhud-rings');
    this.statusEl = twin.querySelector('.dhud-status');

    // Zone 2: Upper-Center Calligraphic Trick & Reaction Ribbon
    const rib = document.createElement('div');
    rib.className = 'dhud-ribbon';
    rib.setAttribute('aria-hidden', 'true');
    rib.innerHTML = `${RIBBON_FLOURISH}<span class="dhud-rib-txt"><span class="dhud-rib-main"></span><span class="dhud-rib-sub"></span></span>${RIBBON_FLOURISH.replace('eb-kit-flourish', 'eb-kit-flourish flip')}`;
    document.body.append(rib);
    this.ribbon = rib;
    this.ribMain = rib.querySelector('.dhud-rib-main');
    this.ribSub = rib.querySelector('.dhud-rib-sub');

    // Zone 3: Bottom-Center Living Reactive Control Dock & Beat-Charge Dial
    this.dock = createActionDock('fire');
    document.body.append(this.dock.root);
  }

  /** push a crisp calligraphic trick / reaction callout in the upper-center filigree ribbon */
  callout(text: string, gold = false, hold = 1.3, sub = '') {
    if (!this.ribbon || !this.ribMain || !this.ribSub) return;
    this.ribMain.textContent = text;
    this.ribSub.textContent = sub;
    this.ribSub.hidden = !sub;
    this.ribbon.classList.toggle('gold', gold);
    this.ribbon.classList.add('on');
    this.callT = Math.max(hold, 0.5);
  }

  update(dt: number, o: DanceHudFrame) {
    if (!this.twin) return;
    const hide = !!o.hidden;
    this.twin.classList.toggle('hide', hide);
    this.dock?.root.classList.toggle('hide', hide);
    if (this.ribbon) {
      this.ribbon.classList.toggle('below-tut', !!o.tutorialActive);
      if (hide) this.ribbon.classList.remove('on');
    }
    if (hide) return;

    const myEl = (o.el ?? 'fire') as KitElement;
    const partnerEl = (o.partnerEl ?? 'water') as KitElement;

    if (myEl !== this.lastElL) {
      this.lastElL = myEl;
      const hex = ELEMENT_HEX[myEl] ?? ELEMENT_HEX.fire;
      this.medL?.style.setProperty('--mc', hex);
      this.fillL?.parentElement?.parentElement?.style.setProperty('--mc', hex);
      if (this.medL) this.medL.innerHTML = ELEMENT_EMBLEMS[myEl] ?? ELEMENT_EMBLEMS.fire;
      if (this.elL) this.elL.textContent = myEl.toUpperCase();
      this.dock?.setElement(myEl);
    }
    if (partnerEl !== this.lastElR) {
      this.lastElR = partnerEl;
      const hex = ELEMENT_HEX[partnerEl] ?? ELEMENT_HEX.water;
      this.medR?.style.setProperty('--mc', hex);
      this.fillR?.parentElement?.parentElement?.style.setProperty('--mc', hex);
      if (this.medR) this.medR.innerHTML = ELEMENT_EMBLEMS[partnerEl] ?? ELEMENT_EMBLEMS.water;
      if (this.elR) this.elR.textContent = partnerEl.toUpperCase();
    }
    if (o.dev) this.dock?.setDevice(o.dev);

    // update Twin Flow & Harmony Nexus
    const st = o.state;
    const myIdx = (o.seat ? 1 : 0) as 0 | 1;
    const otherIdx = (1 - myIdx) as 0 | 1;
    const flowMe = st ? Math.min(100, Math.round((st.flow[myIdx] / RULES.FLOW_MAX) * 100)) : 0;
    const flowOther = st ? Math.min(100, Math.round((st.flow[otherIdx] / RULES.FLOW_MAX) * 100)) : 0;
    const harmony = st ? Math.min(100, Math.round((st.tension / RULES.TENSION_MAX) * 100)) : 0;
    const inForm = !!st?.form[myIdx];
    const formReady = st ? st.flow[myIdx] >= RULES.FORM_ENTER : false;
    const mergeReady = !!st?.mergeReady;
    const fusing = st?.phase === 'fusion';

    if (this.fillL) this.fillL.style.width = `${flowMe}%`;
    if (this.fillR) this.fillR.style.width = `${flowOther}%`;
    if (this.nexusFill) this.nexusFill.style.height = `${harmony}%`;
    if (this.pctEl) this.pctEl.textContent = fusing ? '∞' : `${harmony}%`;
    this.nexus?.classList.toggle('ready', mergeReady || fusing);

    const score = o.score ?? st?.axe ?? 0;
    const combo = o.combo ?? Math.max(1, st?.streak ?? 1);
    const rings = o.rings ?? 0;
    if (this.scoreEl) this.scoreEl.textContent = Math.round(score).toLocaleString();
    if (this.comboEl) {
      this.comboEl.textContent = `×${combo}`;
      this.comboEl.classList.toggle('hot', combo >= 2);
    }
    if (this.ringsEl) {
      this.ringsEl.hidden = !o.surfMode;
      this.ringsEl.textContent = `${rings} ${rings === 1 ? 'RING' : 'RINGS'}`;
    }
    if (this.statusEl) {
      if (fusing) {
        this.statusEl.textContent = 'TWIN-HELIX FUSION!';
        this.statusEl.classList.add('glow');
      } else if (mergeReady) {
        this.statusEl.textContent = 'HOLD F · FUSE!';
        this.statusEl.classList.add('glow');
      } else if (inForm) {
        this.statusEl.textContent = `${myEl.toUpperCase()} FORM`;
        this.statusEl.classList.add('glow');
      } else if (formReady) {
        this.statusEl.textContent = 'E · FORM READY';
        this.statusEl.classList.add('glow');
      } else {
        this.statusEl.textContent = o.surfMode ? 'FLOW SURF' : `FLOW ${flowMe}%`;
        this.statusEl.classList.remove('glow');
      }
    }

    // update Living Reactive Action Dock tiles & radial Charge+Beat Dial
    if (this.dock) {
      const mv = o.activeMove ?? '';
      const carving = Math.abs(o.bank ?? 0) > 0.24 || (o.carveSlide ?? 0) > 0.2 || Math.abs(o.intent?.moveX ?? 0) > 0.25;
      const flipping = o.chargeAction === 'jump' || mv === 'somersault' || mv === 'backflip' || mv === 'corkscrew' || !!o.airborne;
      const spinning = o.chargeAction === 'spin' || mv === 'spin' || mv === 'cyclone' || mv === 'au' || mv === 'pirueta';
      const morphing = o.chargeAction === 'morph' || mv === 'hydro-slip' || mv === 'ember-surge' || (o.dissolve ?? 0) > 0.14;
      this.dock.setAction('carve', carving ? 'active' : 'ready');
      this.dock.setAction('flip', flipping ? 'active' : 'ready');
      this.dock.setAction('spin', spinning ? 'active' : 'ready');
      this.dock.setAction('morph', morphing ? 'active' : 'ready');
      this.dock.setAction('form', inForm ? 'active' : formReady ? 'ready' : 'unavailable');
      this.dock.setAction('fuse', fusing || o.intent?.merge ? 'active' : mergeReady ? 'ready' : 'unavailable');
      this.dock.update({ charge: o.charge ?? 0, beat: o.beat, bpm: o.bpm });
    }

    // process Flow Surf callouts (highest priority: unison > reaction > vortex > ring > trick > chargeTier)
    if (o.surfEvents && o.surfEvents.length) {
      let best: SurfEvent | null = null;
      const rank = (k: SurfEvent['k']) => (k === 'unison' ? 6 : k === 'reaction' ? 5 : k === 'vortex' ? 4 : k === 'ring' ? 3 : k === 'trick' ? 2 : 1);
      for (const se of o.surfEvents) {
        if (se.seat !== o.seat && se.k === 'chargeTier') continue;
        if (!best || rank(se.k) > rank(best.k)) best = se;
      }
      if (best) {
        this.callout(best.label, best.gold, best.k === 'chargeTier' ? 0.65 : 1.45, best.sub ?? '');
      }
    }

    // classic jogo / exchange events
    for (const e of o.events) {
      if (e.k === 'xch') {
        if (e.res === 'dodge' && e.target === o.seat) this.callout(e.streak > 1 ? `DODGE ×${e.streak}` : 'DODGE', true, 1.35);
        else if (e.res === 'parry') this.callout('PARRY', true, 1.35);
        else if (e.res === 'clash') this.callout('CLASH', true, 1.25);
        else if (e.res === 'near' && e.target === o.seat) this.callout('CLOSE CALL', false, 1.0);
      } else if (e.k === 'unison') {
        this.callout('SYNC UNISON!', true, 1.5);
      } else if (e.k === 'echo') {
        this.callout('HARMONIC ECHO!', true, 1.35);
      } else if (e.k === 'fusion') {
        this.callout(`${e.kind.toUpperCase()} FUSION!`, true, 2.2, '×2 FLOW');
      } else if (!o.surfMode && e.k === 'move' && e.seat === o.seat && e.move !== 'jump') {
        const name = MOVE_LABEL[e.move.toLowerCase()] ?? e.move.toUpperCase();
        this.callout(e.perfect ? `${name} · ON BEAT` : name, e.perfect, 1.05);
      }
    }
    if (!o.surfMode) {
      for (const r of o.raw) {
        if (r.type === 'dash') this.callout('DASH', false, 0.85);
        else if (r.type === 'move' && !o.events.some((e) => e.k === 'move' && e.seat === o.seat)) {
          const mv = String(r.move ?? '');
          if (mv) {
            const name = MOVE_LABEL[mv.toLowerCase()] ?? mv.toUpperCase();
            this.callout(r.perfect ? `${name} · ON BEAT` : name, !!r.perfect, 1.0);
          }
        }
      }
    }

    if (this.callT > 0) {
      this.callT = Math.max(0, this.callT - dt);
      if (this.callT === 0 && this.ribbon) this.ribbon.classList.remove('on');
    }
  }

  remove() {
    this.twin?.remove();
    this.ribbon?.remove();
    this.dock?.root.remove();
    this.twin = this.ribbon = null;
    this.dock = null;
  }
}

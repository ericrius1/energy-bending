// Lightweight solarpunk live HUD for Dance / Jogo: zero extra GPU passes, pure DOM overlay.
// Shows your element orb, YOU identity pill, Flow bar (with Form / Merge prompts), a subtle
// bottom-center beat pulse synced to the music, and crisp floating Move / Exchange callouts.
import { RULES } from '../../shared/rules.ts';
import type { PublicState } from '../../shared/protocol.ts';
import type { Element, JogoEvent } from './jogo';

const EL_COLOR: Record<Element, string> = {
  fire: '#ff7d3b',
  plasma: '#c270ff',
  water: '#3dc2ff',
  ice: '#8ef0ff',
  gems: '#ff85c0',
};

const MOVE_LABEL: Record<string, string> = {
  'meia-lua': 'MEIA-LUA',
  armada: 'ARMADA',
  martelo: 'MARTELO',
  bencao: 'BÊNÇÃO',
  rasteira: 'RASTEIRA',
  au: 'AÚ · CARTWHEEL',
  macaco: 'MACACO',
  role: 'ROLÊ · ROLL',
  esquiva: 'ESQUIVA · DODGE',
  spin: 'SPIN',
  pirueta: 'PIROUETTE',
  strike: 'STRIKE',
  throw: 'ENERGY STREAM',
  block: 'GUARD',
  jump: 'LEAP',
  dash: 'DASH',
};

const CSS = `
.dhud-me { position: fixed; top: calc(14px + env(safe-area-inset-top, 0px)); left: calc(14px + env(safe-area-inset-left, 0px));
  z-index: 6; pointer-events: none; display: flex; flex-direction: column; gap: 6px; min-width: 176px;
  padding: 9px 13px 10px; border-radius: 16px; color: var(--eb-cream, #fbf4e4);
  background: var(--eb-glass-bg, rgba(28, 20, 10, 0.56));
  box-shadow: var(--eb-lead, 0 0 0 1px rgba(222, 180, 104, 0.52)), 0 8px 24px rgba(10, 6, 2, 0.28);
  -webkit-backdrop-filter: var(--eb-blur, blur(10px)); backdrop-filter: var(--eb-blur, blur(10px));
  font-family: var(--eb-body, system-ui, sans-serif); transition: opacity 0.3s; }
.dhud-me.hide { opacity: 0; }
.dhud-top { display: flex; align-items: center; gap: 8px; }
.dhud-orb { width: 11px; height: 11px; border-radius: 50%; background: var(--ec, #ff7d3b);
  box-shadow: 0 0 10px var(--ec, #ff7d3b), inset 0 0 0 1px rgba(255, 250, 235, 0.65); flex: none; }
.dhud-who { font: italic 700 13px/1 var(--eb-display, Georgia, serif); letter-spacing: 0.04em; color: var(--eb-sun-hi, #fff0c8); }
.dhud-el { font: 700 10px/1 var(--eb-body, system-ui, sans-serif); letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(251, 244, 228, 0.78); margin-left: auto; }
.dhud-bar { position: relative; height: 6px; border-radius: 999px; background: rgba(255, 244, 220, 0.14); overflow: hidden; }
.dhud-fill { position: absolute; inset: 0 auto 0 0; width: 0%; border-radius: 999px;
  background: linear-gradient(90deg, var(--ec, #ff7d3b), #ffe294);
  box-shadow: 0 0 10px var(--ec, #ff7d3b); transition: width 0.08s linear; }
.dhud-hint { font: 700 10px/1.1 var(--eb-body, system-ui, sans-serif); letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(251, 244, 228, 0.68); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dhud-hint.glow { color: #ffe08a; text-shadow: 0 0 10px rgba(255, 200, 97, 0.65); }
.dhud-streak { color: #ffcf70; font-weight: 800; }

.dhud-beat { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  z-index: 6; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.dhud-call { min-height: 22px; font: 800 13px/1.1 var(--eb-body, system-ui, sans-serif); letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--eb-cream, #fbf4e4); padding: 4px 12px; border-radius: 999px;
  background: rgba(24, 16, 8, 0.62); box-shadow: 0 0 0 1px rgba(222, 180, 104, 0.45);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7); opacity: 0; transform: translateY(6px) scale(0.96);
  transition: opacity 0.2s, transform 0.2s; white-space: nowrap; }
.dhud-call.on { opacity: 1; transform: translateY(0) scale(1); }
.dhud-call.gold { color: #fff3c4; box-shadow: 0 0 0 1.5px rgba(255, 208, 102, 0.9), 0 0 18px rgba(255, 200, 97, 0.42); }
.dhud-dot-wrap { position: relative; width: 24px; height: 24px; display: grid; place-items: center; }
.dhud-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(251, 244, 228, 0.75);
  box-shadow: 0 0 8px rgba(255, 220, 140, 0.5); transition: transform 0.06s, background 0.06s; }
.dhud-ring { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(255, 214, 120, 0.6);
  transform: scale(1); opacity: 0; }
.dhud-dot-wrap.hit .dhud-dot { background: #ffe082; transform: scale(1.45); box-shadow: 0 0 14px rgba(255, 212, 102, 0.95); }
@media (max-width: 640px) {
  .dhud-me { top: calc(10px + env(safe-area-inset-top, 0px)); left: calc(10px + env(safe-area-inset-left, 0px)); min-width: 146px; padding: 7px 10px 8px; }
  .dhud-beat { bottom: calc(14px + env(safe-area-inset-bottom, 0px)); }
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

export class DanceHud {
  private root: HTMLElement | null = null;
  private elTxt: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private streakEl: HTMLElement | null = null;
  private beatWrap: HTMLElement | null = null;
  private dotWrap: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  private callEl: HTMLElement | null = null;
  private callT = 0;
  private lastEl = '';

  constructor() {
    if (typeof document === 'undefined') return;
    ensureStyle();
    const me = document.createElement('div');
    me.className = 'dhud-me';
    me.setAttribute('aria-hidden', 'true');
    me.innerHTML = `<div class="dhud-top"><span class="dhud-orb"></span><span class="dhud-who">YOU</span><span class="dhud-el">FIRE</span></div>`
      + `<div class="dhud-bar"><div class="dhud-fill"></div></div>`
      + `<div class="dhud-hint"><span class="dhud-status">FLOW</span><span class="dhud-streak"></span></div>`;
    document.body.append(me);
    this.root = me;
    this.elTxt = me.querySelector('.dhud-el');
    this.fill = me.querySelector('.dhud-fill');
    this.hint = me.querySelector('.dhud-status');
    this.streakEl = me.querySelector('.dhud-streak');

    const bw = document.createElement('div');
    bw.className = 'dhud-beat';
    bw.setAttribute('aria-hidden', 'true');
    bw.innerHTML = `<div class="dhud-call"></div><div class="dhud-dot-wrap"><span class="dhud-ring"></span><span class="dhud-dot"></span></div>`;
    document.body.append(bw);
    this.beatWrap = bw;
    this.callEl = bw.querySelector('.dhud-call');
    this.dotWrap = bw.querySelector('.dhud-dot-wrap');
    this.ring = bw.querySelector('.dhud-ring');
  }

  /** push a crisp move or exchange callout above the beat pulse */
  callout(text: string, gold = false, hold = 1.15) {
    if (!this.callEl) return;
    this.callEl.textContent = text;
    this.callEl.classList.toggle('gold', gold);
    this.callEl.classList.add('on');
    this.callT = hold;
  }

  update(dt: number, o: {
    seat: number;
    el: Element;
    state: PublicState | null;
    events: readonly JogoEvent[];
    raw: readonly Record<string, unknown>[];
    beat: number;
    bpm: number;
    hidden?: boolean;
  }) {
    if (!this.root) return;
    this.root.classList.toggle('hide', !!o.hidden);
    if (this.beatWrap) this.beatWrap.style.opacity = o.hidden ? '0' : '1';
    if (o.hidden) return;

    if (o.el !== this.lastEl) {
      this.lastEl = o.el;
      this.root.style.setProperty('--ec', EL_COLOR[o.el] ?? EL_COLOR.fire);
      if (this.elTxt) this.elTxt.textContent = o.el.toUpperCase();
    }

    const st = o.state;
    const flowPct = st ? Math.min(100, Math.round((st.flow[o.seat as 0 | 1] / RULES.FLOW_MAX) * 100)) : 0;
    const inForm = !!st?.form[o.seat as 0 | 1];
    const formReady = st ? st.flow[o.seat as 0 | 1] >= RULES.FORM_ENTER : false;
    if (this.fill) this.fill.style.width = `${flowPct}%`;
    if (this.hint) {
      const parent = this.hint.parentElement;
      if (st?.mergeReady) {
        this.hint.textContent = 'HOLD F · MERGE!';
        parent?.classList.add('glow');
      } else if (inForm) {
        this.hint.textContent = 'ELEMENTAL FORM';
        parent?.classList.add('glow');
      } else if (formReady) {
        this.hint.textContent = 'PRESS E · FORM READY';
        parent?.classList.add('glow');
      } else {
        this.hint.textContent = `FLOW ${flowPct}%`;
        parent?.classList.remove('glow');
      }
    }
    if (this.streakEl) this.streakEl.textContent = st && st.streak > 1 ? `×${st.streak}` : '';

    // listen for player's own moves & exchanges
    for (const e of o.events) {
      if (e.k === 'xch') {
        if (e.res === 'dodge' && e.target === o.seat) this.callout(e.streak > 1 ? `DODGE ×${e.streak}!` : 'DODGE!', true, 1.35);
        else if (e.res === 'parry') this.callout('PARRY!', true, 1.35);
        else if (e.res === 'clash') this.callout('CLASH!', true, 1.25);
        else if (e.res === 'near' && e.target === o.seat) this.callout('CLOSE CALL!', false, 1.0);
      } else if (e.k === 'unison') {
        this.callout('UNISON!', true, 1.45);
      } else if (e.k === 'echo') {
        this.callout('ECHO!', true, 1.3);
      } else if (e.k === 'move' && e.seat === o.seat && e.move !== 'jump') {
        const name = MOVE_LABEL[e.move.toLowerCase()] ?? e.move.toUpperCase();
        this.callout(e.perfect ? `${name} · ON BEAT!` : name, e.perfect, 1.05);
      }
    }
    for (const r of o.raw) {
      if (r.type === 'dash') this.callout('DASH', false, 0.85);
      else if (r.type === 'move' && !o.events.some((e) => e.k === 'move' && e.seat === o.seat)) {
        const mv = String(r.move ?? '');
        if (mv) {
          const name = MOVE_LABEL[mv.toLowerCase()] ?? mv.toUpperCase();
          this.callout(r.perfect ? `${name} · ON BEAT!` : name, !!r.perfect, 1.0);
        }
      }
    }

    if (this.callT > 0) {
      this.callT = Math.max(0, this.callT - dt);
      if (this.callT === 0 && this.callEl) this.callEl.classList.remove('on');
    }

    // subtle bottom beat pulse
    const spb = 60 / Math.max(40, o.bpm || 110);
    const ph = ((o.beat % 1) + 1) % 1;
    const nearBeat = (1 - ph) * spb <= 0.095 || ph * spb <= 0.095;
    this.dotWrap?.classList.toggle('hit', nearBeat);
    if (this.ring) {
      const sc = 0.75 + (1 - ph) * 1.15;
      this.ring.style.transform = `scale(${sc.toFixed(3)})`;
      this.ring.style.opacity = `${(Math.min(1, ph * 3) * (1 - ph) * 0.85).toFixed(3)}`;
    }
  }

  remove() {
    this.root?.remove();
    this.beatWrap?.remove();
    this.root = this.beatWrap = null;
  }
}

// The debug panel: every parameter group (engine/params.ts) on one scrolling page, built from the groups' specs.
// Plain DOM, no library. Hidden at start; `/` or `?panel` shows it. It is a tool for tuning, not part of the game's
// screen (the game shows nothing but controls and meters), so it stays small and grey.
import { allParams, type ParamGroup, type ParamSpec } from './params';

const CSS = `
.eb-panel { position: fixed; top: 8px; right: 8px; width: 290px; max-height: calc(100vh - 16px); overflow: auto; z-index: 10;
  background: rgba(14, 12, 18, 0.88); color: #ddd; font: 11px/1.35 system-ui, sans-serif; border-radius: 6px; padding: 6px 8px; }
.eb-panel[hidden] { display: none; }
.eb-panel details { border-top: 1px solid #333; padding: 3px 0; }
.eb-panel summary { cursor: pointer; font-weight: 600; color: #bbb; }
.eb-panel label { display: grid; grid-template-columns: 110px 1fr 44px; gap: 6px; align-items: center; margin: 2px 0; }
.eb-panel input[type=range] { width: 100%; }
.eb-panel output { text-align: right; color: #999; font-variant-numeric: tabular-nums; }
.eb-panel .foot { color: #888; padding-top: 4px; }`;

export class Panel {
  readonly el = document.createElement('div');
  private foot = document.createElement('div');
  private refreshers: (() => void)[] = [];

  constructor(open = false) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.el.className = 'eb-panel';
    this.el.hidden = !open;
    this.foot.className = 'foot';
    document.body.append(this.el);
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (e.key === '/' && (e.altKey || e.ctrlKey)) { this.el.hidden = !this.el.hidden; e.preventDefault(); }
    });
  }

  /** build the page from every group defined so far (call once, after the modules have defined theirs) */
  build() {
    for (const g of allParams()) {
      const keys = Object.keys(g.specs);
      if (!keys.length) continue;
      const box = document.createElement('details');
      box.innerHTML = `<summary>${g.name}</summary>`;
      for (const k of keys) box.append(this.control(g, k, g.specs[k as never] as ParamSpec));
      this.el.append(box);
    }
    this.el.append(this.foot);
  }

  /** read the values again (something other than the panel changed them) */
  refresh() { for (const r of this.refreshers) r(); }

  /** the line at the bottom: frame rate and counts */
  status(text: string) { if (!this.el.hidden) this.foot.textContent = text; }

  private control(g: ParamGroup<any>, key: string, s: ParamSpec) {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = s.label ?? key;
    const out = document.createElement('output');
    const v = g.values[key];
    let input: HTMLInputElement | HTMLSelectElement;
    if (s.options) {
      const sel = document.createElement('select');
      for (const o of s.options) sel.append(new Option(String(o), String(o)));
      sel.onchange = () => { g.values[key] = typeof v === 'number' ? Number(sel.value) : sel.value; g.changed(key); };
      this.refreshers.push(() => { sel.value = String(g.values[key]); });
      input = sel;
    } else if (typeof v === 'boolean') {
      const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
      box.onchange = () => { g.values[key] = box.checked; g.changed(key); };
      this.refreshers.push(() => { box.checked = g.values[key]; });
      input = box;
    } else if (s.color) {
      const pick = Object.assign(document.createElement('input'), { type: 'color' });
      pick.oninput = () => { g.values[key] = pick.value; g.changed(key); };
      this.refreshers.push(() => { pick.value = g.values[key]; });
      input = pick;
    } else {
      const range = Object.assign(document.createElement('input'), {
        type: 'range', min: String(s.min ?? 0), max: String(s.max ?? 1), step: String(s.step ?? ((s.max ?? 1) - (s.min ?? 0)) / 200),
      });
      range.oninput = () => { g.values[key] = Number(range.value); out.textContent = fmt(g.values[key]); g.changed(key); };
      this.refreshers.push(() => { range.value = String(g.values[key]); out.textContent = fmt(g.values[key]); });
      input = range;
    }
    row.append(name, input, out);
    this.refreshers[this.refreshers.length - 1]();
    return row;
  }
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(2));

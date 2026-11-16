// What a touch player sees: the TouchSource's buttons (its descriptors) down the right edge, and the virtual stick
// drawn where the left thumb landed. Plain DOM over the canvas, made when a touch player joins; controls only, no text
// beyond the buttons' names (docs/PLAN.md: nothing on screen beyond controls and meters).
import type { TouchSource } from './touch';

export class TouchPad {
  private root = document.createElement('div');
  private ring = document.createElement('div');
  private knob = document.createElement('div');
  private freeOnly: HTMLElement[] = [];
  private duelOnly: HTMLElement[] = [];
  private jogoOnly: HTMLElement[] = [];
  private labelled: [HTMLElement, string, string][] = [];
  private col: HTMLElement | null = null;

  constructor(private src: TouchSource, canvas: HTMLElement) {
    Object.assign(this.root.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5', font: '12px system-ui, sans-serif', userSelect: 'none', webkitUserSelect: 'none' });
    const col = (this.col = document.createElement('div'));
    Object.assign(col.style, { position: 'absolute', right: 'max(12px, env(safe-area-inset-right))', bottom: 'max(12px, env(safe-area-inset-bottom))', display: 'grid', gridTemplateColumns: 'repeat(2, 64px)', gap: '8px', pointerEvents: 'auto' });
    for (const b of src.buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      Object.assign(el.style, { width: '64px', height: '48px', borderRadius: '24px', border: '1px solid rgba(220,210,255,0.35)', background: 'rgba(20,16,30,0.45)', color: '#d9d0f0', touchAction: 'none' });
      const down = (e: PointerEvent) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); src.press(b.name); el.style.background = 'rgba(120,100,180,0.6)'; };
      const up = () => { src.release(b.name); el.style.background = 'rgba(20,16,30,0.45)'; };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      if (b.freeOnly) this.freeOnly.push(el);
      if (b.duelOnly) this.duelOnly.push(el);
      if (b.jogoOnly) this.jogoOnly.push(el);
      if (b.duelLabel) this.labelled.push([el, b.label, b.duelLabel]);
      col.append(el);
    }
    for (const [el, size] of [[this.ring, 120], [this.knob, 48]] as const) {
      Object.assign(el.style, { position: 'absolute', width: `${size}px`, height: `${size}px`, marginLeft: `${-size / 2}px`, marginTop: `${-size / 2}px`, borderRadius: '50%', border: '1px solid rgba(220,210,255,0.4)', display: 'none' });
    }
    this.knob.style.background = 'rgba(200,190,255,0.25)';
    this.root.append(this.ring, this.knob, col);
    (canvas.parentElement ?? document.body).append(this.root);
  }

  /** each frame: the stick where it is, the free-only buttons shown in free mode */
  update() {
    const s = this.src.stick;
    for (const el of [this.ring, this.knob]) el.style.display = s.active ? 'block' : 'none';
    if (s.active) {
      Object.assign(this.ring.style, { left: `${s.ox}px`, top: `${s.oy}px` });
      const dx = s.x - s.ox, dy = s.y - s.oy, l = Math.hypot(dx, dy), k = l > this.src.R ? this.src.R / l : 1;
      Object.assign(this.knob.style, { left: `${s.ox + dx * k}px`, top: `${s.oy + dy * k}px` });
    }
    for (const el of this.freeOnly) el.style.visibility = this.src.mode === 'free' ? 'visible' : 'hidden';
    const duel = this.src.scheme === 'duel';
    for (const el of this.duelOnly) el.style.display = duel ? '' : 'none';
    for (const el of this.jogoOnly) el.style.display = duel ? 'none' : '';
    for (const [el, a, b] of this.labelled) { const t = duel ? b : a; if (el.textContent !== t) el.textContent = t; }
    // (a short screen, a phone held sideways: three columns, so the buttons stay under the HUD's top corners)
    const cols = innerHeight < 520 ? 3 : 2;
    if (this.col && this.col.dataset.cols !== String(cols)) { this.col.dataset.cols = String(cols); this.col.style.gridTemplateColumns = `repeat(${cols}, 64px)`; }
  }

  remove() { this.root.remove(); }
}

// The HUD in the jogo: off (the jogo has its meters in the world, src/play/hud.ts), except, behind a switch
// (`?hud=beat`, or `bend.hud.jogoBeat = true`), the beat indicator alone: mode 'jogo', the room's beat and the jogo's
// own perfect window (shared/rules.ts PERFECT_MS either side of a grid line). The jogo judges perfect on eighths
// (PERFECT_GRID 2), so a move on the off-beat eighth counts too; the ring closes on the beats only, which is what a
// player dances to.
import { RULES } from '../../shared/rules.ts';
import type { HudState } from './state';
import { emptyHud } from './state';

interface JogoHooks { beat(): number | null; state: { music?: { bpm: number } } | null; phase: string | null }

export class JogoBeat {
  private state: HudState = { ...emptyHud(), mode: 'jogo' };
  private mine = false;

  /** the state to set this frame, 'none' to take it down, or null (not the jogo's business: leave the HUD alone) */
  update(on: boolean, jogo: JogoHooks | undefined): HudState | null {
    const b = on && jogo ? jogo.beat() : null;
    if (b == null || !jogo) {
      if (!this.mine) return null;
      this.mine = false;
      return emptyHud();
    }
    this.mine = true;
    const S = this.state;
    S.beat.phase = b - Math.floor(b);
    S.beat.bpm = jogo.state?.music?.bpm ?? RULES.BPM;
    S.beat.window = RULES.PERFECT_MS / 1000;
    return S;
  }
}

// The controls card's key table (src/duel/help.ts, report 14) against the devices' own bindings: every device names
// every action, and the keys it shows are the ones the duel's scheme listens to (input/keyboard.ts LAYOUTS, the HUD's
// POWER_KEYS, input/gamepad.ts POWER_BUTTONS), so the card and the lesson can't drift from the game.
import { test, assert, done } from '../../dancer/test/check';
import { KEYS, devOf, type Action, type Dev } from '../help';
import { LAYOUTS, POWER_KEYS } from '../../input/keyboard';
import { POWER_BUTTONS } from '../../input/gamepad';

const ACTS: Action[] = ['move', 'jump', 'catch', 'dash', 'kick', 'spin', 'dodge', 'power1', 'power2', 'form', 'view', 'help'];
/** a key code as the card writes it */
const shown = (code: string) => code.replace(/^Key/, '').replace(/^Shift(Left|Right)$/, 'Shift').replace('Comma', ',').replace('Period', '.').replace('Slash', '/')
  .replace('Semicolon', ';').replace('Quote', "'").replace('BracketLeft', '[').replace('BracketRight', ']').replace(/^Enter$/, 'Enter');

test('every device has a key for every action', () => {
  for (const d of Object.keys(KEYS) as Dev[]) for (const a of ACTS) assert(KEYS[d][a], `${d} ${a}`);
});
test('the keyboard halves: the keys the duel listens to', () => {
  for (const d of ['solo', 'left', 'right'] as const) {
    const L = LAYOUTS[d], D = L.duel;
    const want: Partial<Record<Action, string[]>> = { catch: L.punch, dash: D.dash, kick: D.kick, spin: D.spin, dodge: D.dodge, power1: D.power1, power2: D.power2, form: L.form, view: L.lock };
    for (const [a, codes] of Object.entries(want) as [Action, string[]][]) {
      assert(codes.map(shown).includes(KEYS[d][a]), `${d} ${a}: the card says ${KEYS[d][a]}, the layout listens to ${codes.join(' ')}`);
    }
    assert(L.freeJump.map(shown).includes(KEYS[d].jump === 'Space' ? 'Space' : KEYS[d].jump), `${d} jump`);
  }
});
test('the power keys match the HUD panels\' (POWER_KEYS, POWER_BUTTONS)', () => {
  for (const d of ['solo', 'left', 'right'] as const) {
    assert(POWER_KEYS[d][0] === KEYS[d].power1 && POWER_KEYS[d][1] === KEYS[d].power2, d);
    assert(POWER_KEYS[d][2] === KEYS[d].form || (POWER_KEYS[d][2] === '↵' && KEYS[d].form === 'Enter'), `${d} form`);
  }
  assert(POWER_BUTTONS[0] === KEYS.pad.power1 && POWER_BUTTONS[1] === KEYS.pad.power2, 'pad');
});
test('the right half kicks with /, so its card is F1, not ?', () => assert(KEYS.right.help === 'F1'));
test('a source\'s name as the card\'s device', () => {
  assert(devOf('keyboard-solo') === 'solo' && devOf('keyboard-left') === 'left' && devOf('keyboard-right') === 'right');
  assert(devOf('gamepad-2') === 'pad' && devOf('touch') === 'touch' && devOf('duel-flyer') === null && devOf(null) === null);
});
done();

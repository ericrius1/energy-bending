// The forge's floor along the way in from its gate: a dancer who walks on from the geode's gate keeps floor under them
// (the cameras agent found 1.75 to 2.75 m in along the gate's normal open: between the anvil's lobe and the anvil itself,
// a player walking in fell into the pit). The lobe now reaches the anvil.
import { test, assert, done } from '../../dancer/test/check';
import { layoutForge, COLUMN_FLOATS } from './layout';

test('floor all the way from the gate to the stage', () => {
  const L = layoutForge({ coarse: false });
  const gate = [-5.7, -3.5], n = [0.7, 0.71];
  const gaps: string[] = [];
  let worst = 0;
  for (let t = 0.4; t <= 5.01; t += 0.1) {
    const x = gate[0] + n[0] * t, z = gate[1] + n[1] * t;
    let best = 9;
    for (let i = 0; i < L.stageColumns; i++) {
      const o = i * COLUMN_FLOATS;
      if (Math.abs(L.columns[o + 2]) > 0.05) continue; // the anvil's (floor) cells only: their tops at 0
      best = Math.min(best, Math.hypot(L.columns[o] - x, L.columns[o + 1] - z));
    }
    worst = Math.max(worst, best);
    if (best > 0.4) gaps.push(`${t.toFixed(1)} m (${best.toFixed(2)} m to a cell)`);
  }
  assert(!gaps.length, `no floor at ${gaps.join(', ')}`);
  return `from 0.4 to 5 m in, every point within ${worst.toFixed(2)} m of a floor cell's middle (a cell is 0.4 m round)`;
});

done();

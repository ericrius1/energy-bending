// The HUD's pure parts, checked without a DOM: the demo (`?hud=demo`) fills HudState v2 as docs/design/duel.md
// defines it over a whole set (every frame's values in range, the set's phases in order, the link's holder and held,
// the named moments all there, a winner at the end) and replays the same when jumped to the same second; the layout
// keeps the shared energy's strands and the set's orb between the panels at desktop and phone sizes.
import { test, assert, done } from '../dancer/test/check';
import { HudDemo } from './demo';
import { layout } from './layout';
import { LINK_KINDS, emptyHud, type HudState } from './state';

const POPS = new Set(['catch', 'swing', 'fling', 'perfect', 'combo', 'merge', 'info']);
const PHASES = ['intro', 'play', 'finale', 'done'];

function check(s: HudState, where: string) {
  assert(s.mode === 'duel' && s.players.length === 2, `${where}: two players in a duel`);
  for (const p of s.players) {
    const c = p.combo;
    assert(c.n >= 0 && c.perfect >= 0 && c.perfect <= c.n, `${where}: combo ${c.perfect} perfect of ${c.n}`);
    assert(c.links.length <= c.n && c.links.length <= 8, `${where}: ${c.links.length} links of ${c.n}`);
    for (const l of c.links) assert((LINK_KINDS as readonly string[]).includes(l), `${where}: link ${l}`);
    assert(c.mult >= 1, `${where}: multiplier ${c.mult}`);
    assert(p.dash >= 0 && p.dash <= 1 && p.reforming >= 0 && p.reforming <= 1, `${where}: dash ${p.dash}, reforming ${p.reforming}`);
    assert(p.style >= 0, `${where}: style ${p.style}`);
    assert(!(p.holding && p.held), `${where}: holding and held at once`);
  }
  const L = s.link, [a, b] = s.players;
  if (L.on) assert((a.holding && b.held) || (b.holding && a.held), `${where}: a link has a holder and a held`);
  else assert(!a.holding && !a.held && !b.holding && !b.held, `${where}: no link, nobody holding`);
  assert(L.energy >= 0 && L.energy <= 1, `${where}: link energy ${L.energy}`);
  const S = s.shared;
  for (const v of [S.energy, S.peak, S.merge]) assert(v >= 0 && v <= 1, `${where}: shared ${JSON.stringify(S)}`);
  assert(S.peak >= S.energy - 1e-9, `${where}: the peak ${S.peak} under the energy ${S.energy}`);
  assert(PHASES.includes(s.set.phase) && s.set.length > 0 && s.set.time >= 0 && s.set.time <= s.set.length, `${where}: set ${JSON.stringify(s.set)}`);
  for (const p of s.pops) assert(POPS.has(p.kind) && p.age >= 0, `${where}: pop ${p.kind} ${p.age}`);
}

test('the demo fills HudState v2 over a whole set', () => {
  const seen = new Set<string>(), texts = new Set<string>();
  let last = 0, mergeFull = false, winner: number | undefined;
  // (stepped as the page does: one frame at a time through update, no bodies on screen)
  const e = new HudDemo();
  for (let i = 0; i < 56 * 60; i++) {
    const s = e.update({ dt: 1 / 60, beat: { beats: i / 30, bpm: 120 }, heads: [], hands: [], matters: ['fire', 'water'], viewProj: new Float32Array(16) });
    check(s, `frame ${i}`);
    const k = PHASES.indexOf(s.set.phase);
    assert(k >= last, `frame ${i}: the set went back from ${PHASES[last]} to ${s.set.phase}`);
    last = k;
    seen.add(s.set.phase);
    for (const p of s.pops) texts.add(p.text);
    if (s.set.phase === 'finale' && s.shared.merge >= 1) mergeFull = true;
    if (s.set.phase === 'done') winner = s.set.winner;
  }
  assert(seen.size === 4, `phases seen: ${[...seen]}`);
  assert(mergeFull, 'the finale fills the merge');
  assert(winner === 0 || winner === 1, `a winner: ${winner}`);
  for (const t of ['CATCH', 'SWING', 'FLING', 'FLING ×2', 'PERFECT', 'MERGE', 'FUSION']) assert(texts.has(t), `the pop ${t}`);
  assert([...texts].some((t) => t.startsWith('COMBO ×')), 'a COMBO pop');
  return `${texts.size} kinds of pop, winner seat ${winner}`;
});

test('the demo replays the same when jumped to the same second', () => {
  const a = JSON.stringify(new HudDemo().at(23.4)), b = JSON.stringify(new HudDemo().at(23.4));
  assert(a === b, 'two jumps to 23.4 s differ');
  const m = new HudDemo().moments(8);
  for (const k of ['catch', 'swing', 'fling2', 'merge', 'cash', 'fall', 'finale', 'fusion', 'done']) assert(typeof m[k] === 'number' && m[k] >= 8, `moment ${k}: ${m[k]}`);
  assert(m.finale < m.fusion && m.fusion < m.done, `finale ${m.finale}, fusion ${m.fusion}, done ${m.done}`);
});

test('the layout keeps the shared energy between the panels', () => {
  for (const [W, H] of [[1920, 1080], [1280, 720], [844, 390], [390, 844], [760, 480]]) {
    const L = layout(W, H), [p0, p1] = L.panels, O = L.orb;
    assert(L.compact === (W < 760 || H < 480), `${W}x${H}: compact`);
    assert(p0.x + p0.w < L.shared.x0 && L.shared.x0 < O.x - O.r && O.x + O.r < L.shared.x1 && L.shared.x1 < p1.x, `${W}x${H}: panel, strand, orb, strand, panel`);
    assert(L.combo[0].y >= p0.y + p0.h && L.top > L.combo[0].y + L.combo[0].h, `${W}x${H}: the combos under the panels, the pops under them`);
    assert(p1.x + p1.w <= W && p0.x >= 0, `${W}x${H}: on screen`);
  }
});

test('an empty state is v2 and draws nothing', () => {
  const s = emptyHud();
  assert(s.mode === 'none' && s.players.length === 0 && !s.link.on && s.shared.merge === 0 && s.set.phase === 'play');
});

done();

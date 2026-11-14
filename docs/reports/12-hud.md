# 12: the HUD for the contact dance (HudState v2)

The duel is no longer a fight (docs/design/duel.md, the second correction): no hits, no KOs, a dance battle like
contact improvisation. The HUD built last round (docs/reports/11-hud.md) drew hit pips and KO marks; this round
redraws it for **HudState v2** exactly as duel.md defines it: each dancer's style and live combo, the dash, holding
and held, the shared energy and the merge between the two panels, the link on screen as a line of light, the set on
the music, pops for named moves, tags. The jogo's beat-only mode is unchanged. The contact-dance rules that will
fill v2 from the game are another agent's; this only draws.

Branch `worktree-agent-a90541091d3007f9a`, from master `e135473`.

## What was built

`src/hud/` only (plus the HUD's step files). Nothing outside it changed: `main.ts`, the post chain's overlay,
`bend.grab`'s compose and the film tool's `"hud": false` all join it as before.

| file | job |
|---|---|
| `state.ts` | **HudState v2**, field for field as duel.md's "The HUD's state, version 2" (`players[].style`, `combo {n, mult, links, live, perfect}`, `dash`, `holding`, `held`, `reforming`, `screen`; `link {on, energy, from, to}`; `shared {energy, peak, merge}`; `set {time, length, phase, countdown, winner}`; `beat`; `pops` with the kinds `catch swing fling perfect combo merge info`). `LINK_KINDS`, `emptyHud()`, `emptyCombo()`, `screenOf` (as before), `onScreen`. The v1 fields (`hits`, `hitsMax`, `kos`, `charges`, `superMeter`, `round`) are gone: the jogo never used them |
| `panel.ts` | a dancer's panel. **Base layer**: glass, the matter's emblem, the name, the **style** (a number that rolls up; stamped digit by digit from sprites, gold-flared while a combo cashes into it, "STYLE" after it), the dash (chevrons and a recharge hairline at the panel's inner end). **Live layer**: the **combo** hanging under the panel while it goes (count, `×mult` in gold once any link was on the beat, the last links as icons, newest toward the centre, older ones quieter; a new link springs in with a ring, gold if on the beat), the combo's **end** (cashed: the glass goes, the icons gather into the count, the count flies up into the style, which flares gold, "+n" rising beside it; dropped by a fall: the row greys, sinks and fades), and **holding / held** (a ring of both colours turning round the emblem, faster with the link's energy, and a chip "HOLDING" or "HELD" with a catch or lift icon; on a narrow phone bar the chip is the icon alone) |
| `icons.ts` | the eleven link icons as thin line glyphs in a 24-unit box, one family: catch `( • )`, swing (pivot, arc, body), fling (a curve leaving on its tangent), lift (base bar, rising chevrons, the flyer), vault (down onto shoulders and away), wall jump, wall run, dash, flip (a loop), kick, aerial (a spark over a horizon). Sprites per size and colour; on the beat they're a warmer gold with a glow. An unknown name draws a plain ring |
| `shared.ts` | the **shared energy** as one thing between the panels: a strand of light from each panel's inner edge, in its dancer's colour, two filaments braiding toward the set's orb, flowing faster and swelling as the energy rises, a pulse running along on each beat, a spark at the head; both strands are the one value, so at full they touch the orb together. The set's **peak** is a gold tick (and diamond) on both. In the **orb** the **merge** grows: a core of both colours turning (a conic gradient), from a seed to the whole orb, its heart whitening, the orb blooming gold when full. Round the orb the **set's time on the music**: a progress arc against the length, ticked every four bars, its head swelling on each beat, gold through the finale; the time left under it, and "FINALE" / "FUSION" under that on desktop. What stays still (tracks, well, ring, ticks) is one sprite |
| `link.ts` | the **link on screen**: while `link.on` with `from` and `to`, a thin line of light between the contact points, drawn additively: a faint wide breath, a core shading from the holder's colour to the held's, two filaments twisting round it, a slight bow that sways, beads running both ways (faster with `link.energy`), a swell on the beat, a small glow at each contact. Fades in and out over a tenth of a second. Not drawn when the ends are most of the screen apart (a bad reading) |
| `centre.ts` | the intro's countdown ("3", "2", "1", then **"DANCE"**), **"FINALE"** once as the finale begins, and the **winner's banner**: a band opening in the winner's colour with a light running along its edges, the name, "TAKES THE SET", each dancer's style in its colour either side of "STYLE", and "TOGETHER n% AT PEAK" (the shared peak). No winner at `done` reads "EVEN / THE SET IS EVEN" |
| `pops.ts` | the pops, each kind its own motion: **CATCH** snaps in (large and faint to its size in 0.11 s, a ring closing on it like a hand), **SWING** hangs from a point above and swings as a dying pendulum, **FLING ×n** flies off on its tangent (italic, stretched, two ghosts trailing), **PERFECT** gold, springs in with a ring of light, **COMBO ×n** punches in with a shiver, bigger the longer the combo, **MERGE** (or FUSION) two halves in the dancers' colours slide together and flash into one. A newer pop near an older one pushes it away (up, or down if up would cover the panels); nothing but a fling rises over the panels and combos. The **tags** over heads as before (with the tag's beat ring) |
| `hud.ts` | the two canvases as before; the base is now two halves (each panel alone); the live layer draws link, tags, combos, shared, beat, pops, centre; `stats()` gains `parts` (ms a frame by part); the warm-up makes ahead every word, icon, digit, clock time and banner name a battle will want |
| `style.ts` | as before, plus `label` / `stampLabel` / `stampDigits` / `measure`: text made once into atlas sprites (with its halo), since the HUD redraws numbers every frame |
| `demo.ts` | `?hud=demo`, a believable contact-dance battle (below) |
| `hud.test.ts` | runs in `npm test`: the demo fills v2 correctly every frame of a whole set, replays the same when jumped, has every named moment; the layout keeps strands and orb between the panels at five sizes |
| `beat.ts`, `jogo.ts`, `overlay.wgsl`, `index.ts` | unchanged but for `index.ts` exporting the v2 types and passing the dancers' hands to the demo |

Layout (u = 1 at 1280×720): panels 300×84 u in the top corners, the combo row 30 u under each, the orb (r 24 u) at
the top centre, strands between; compact (phone, `W < 760 || H < 480`): 40 u bars, 20 u combo rows, the panels
leave at least 132 u for the shared energy (on a 390 px portrait that is short strands, about 45 px each side).

### Readings of the contract (what the HUD assumes)

- `set.time` is elapsed seconds of `set.length`; the clock shows the time left. `countdown` is seconds left of the
  intro; "DANCE" shows once as it reaches 0 or play starts. "FINALE" shows once on `play → finale`.
- `link.from` is the **holder's** contact, `to` the held's (the line shades from the holder's colour).
- `combo.links` oldest first; `perfect` is a count. Which icons glow gold is **inferred**: when `n` rises by k and
  `perfect` by j in the same frame, the last j of the k new links are gold. After a jump (a still, a resync) the
  HUD can't know and lights the newest `perfect` of them.
- A combo **cashing in** is inferred: `live` going false, then a style rise within 0.6 s, is a cash-in (the flourish
  and "+n"); `live` going false while `reforming > 0` is a drop.
- A fling pop's **tangent** is inferred: the faster-moving head on screen at the pop's birth (over 220 u/s), else away
  from the farther player and up.
- Pop lives: catch 0.95 s, swing 1.05, fling 1.0, perfect 1.0, combo 1.2, merge 1.4, info 1.6 (of `age`). A pop is
  identified by its text, seat and birth time (no id in the contract).
- `shared.peak` is shown as a per cent on the banner. `merge ≥ 1` reads as FUSION (the orb blooms).

### The demo

`?hud=demo` plays an intro (3 s), a 50 s set at the music's beat, the banner (6.5 s), then the next seed. The set is
built of phrases: a leader runs in (dash, wall run, flip, kick, wall jump), catches, swings or lifts (the flyer
sometimes vaulting off the lift), flings; the flyer turns the flight into its own aerial, wall run or wall jump, is
sometimes caught again for a **FLING ×2**; both combos cash into style. Once a set the flyer falls instead: combo
dropped, "FALL −40", reforming 1.2 s. Links land on the beat by chance (seat 0 more often), the multiplier grows
with variety and perfects, style comes per link and in a cash-in (60 × n × mult). The shared energy rises with every
move (contact moves more), ebbs between phrases; the merge grows while joined; the **finale** (the last 10 s) is one
long contact that fills the merge (**FUSION**); then the higher style wins. The link joins the two dancers' nearest
hands (only when they are within 2.4 m: the demo's bodies don't really meet), the pops ride their anchors.
`bend.hud.demo.at(s)` replays to second s; `bend.hud.demo.moments(after)` gives the first catch, swing, fling2,
merge, cash, combo, perfect, fall, finale, fusion and done at or after `after` seconds (what the step files use).

## What was measured (RTX 5090 PC, headless Chrome, device pixel ratio 1)

HUD CPU a frame, over the demo's **whole set** (3,600 stepped frames: intro, play, finale, banner), bodies placed
close so the link draws:

| case | mean | worst single frame |
|---|---|---|
| desktop 1920×1080, locked | 0.210–0.222 ms | 2.2 ms (the banner's first frame) |
| desktop 1920×1080, free | 0.208 ms | 3.0 ms |
| desktop 1280×720, locked | 0.229 ms | 3.4 ms |
| phone 844×390 (compact) | 0.173–0.198 ms | 1.5–2.6 ms |
| phone 390×844 (compact) | 0.171 ms | 2.7 ms |
| jogo, beat only, 1280×720 | 0.037 ms | 1.2 ms (first frame) |
| film 1920×1080 at scale 1.5 (draw + flatten + upload) | 0.539 ms | |

- All under the 0.3 ms budget. Where it goes at 1920×1080 (ms a frame): shared energy 0.051, combos and chips 0.036,
  base 0.028, link 0.018, tags 0.021, beat 0.012, pops 0.009, centre 0.008, update 0.012 (`bend.hud.stats().parts`).
- The first version was 0.25–0.30 ms; what brought it down: the style, combo counts, multipliers, chip words, "+n"
  and the clock stamped from text sprites instead of drawn (digit by digit for the rolling style), the shared
  energy's still parts in one sprite, two filaments instead of three, the warm-up made wider (digits, counts, clock
  times, icons, banner names). With the warm-up, the slow frames left are the fall's "FALL −40" (a text nobody can
  warm) and the banner's first frame.
- `performance.now()` is coarsened to 0.1 ms in headless Chrome: means are over thousands of such readings, single
  frames are quantised.
- Base layer redrawn in 1,421 of 3,600 frames (the style rolling after each link and cash-in, the dash recharging).
- **Film**: the grade pass 0.048 ms without the HUD, 0.058 with it; stepped frame 4.74 → 6.18 ms wall (the flatten
  and upload of a 2880×1620 image). A preview film (`scripts/steps/hud-film.json`, 1920×1080) shows the HUD
  composited: `12-hud-film-frame.jpg`. `bend.grab` stills show it too (every still below is one).
- `npm run typecheck` clean; full `npm test` passed (13 of 13 TypeScript test files, the new `hud.test.ts` included;
  the net tests, smoothness among them, passed in the full run).
- The timing ran from a variant of `scripts/hud-time.mjs` in my scratchpad (the whole set, bodies close, `parts`);
  `scripts/hud-time.mjs` itself is outside my files and unchanged: it still runs against v2 (it only uses
  `demo.at(0)` and `stats`) but measures the first 10 s only.

## Stills (`docs/reports/media/12-hud-*.jpg`)

- Every world, **locked and free**, 1920×1080, a moment just after the merge passes a quarter (link on, a combo of 8
  with gold links, COMBO ×8, SWING and MERGE popping, the strands near full): `geode-lock/free`, `pool-lock/free`,
  `temple-lock/free`, `forge-lock/free`, `redwoods-day-lock/free`, `redwoods-night-lock/free`.
- The set's moments in the geode: `geode-intro` (the countdown), `geode-swing`, `geode-catch` (the CATCH snapping in,
  the chips just on), `geode-fling2` (FLING ×2 flying off up-left, PERFECT), `geode-cash` (both combos cashing: "+360"
  and "+1,500", the counts flying into the style), `geode-fall` (the flyer's combo dropped and sinking grey, FALL −40,
  the emblem reforming), `geode-combo` (COMBO ×5), `geode-finale`, `geode-fusion` (the orb full and blooming, FUSION),
  `geode-won` (the banner).
- `phone-landscape` (844×390) and `phone-portrait` (390×844): sheets of eight (merge, fling ×2, cash, swing, fusion,
  finale, intro, won) across the worlds.
- `film-frame`: a frame of the preview film.

Regenerate: `node scripts/shot.mjs <out> scripts/steps/hud.json --url … --size 1920x1080`, and
`scripts/steps/hud-phone.json` with `--size 844x390` / `--size 390x844`.

What I changed after looking: the zig-zag strands made smooth and slower; the "lift" and "swing" icons redrawn (both
read as anchors); on-beat gold made warmer (it read white at icon size); the chip kept its word while fading (it
flipped to "HELD"), stamps made to respect a group's alpha; pops de-collided and kept off the panels; the cash-in's
glass dropped and its count faded sooner (it sat over the score); the banner reordered (name, then "TAKES THE SET",
then the numbers); the demo's energy slowed (it was full by the first quarter), its finale moved inside the set, and
the link drawn only between bodies near each other (a hand-to-hand line across the screen read as a UI line).

## Weak points

- **Inferences** stand in for what the contract doesn't say (gold icons, cash-ins, a fling's tangent, pop identity;
  see "Readings" and below). They are right when the game publishes every frame; a dropped or jumped frame can light
  the wrong icons gold or miss a flourish.
- **Busy moments**: four pops near the heads at once (the demo does this when a merge threshold falls on a catch) stack
  in a column and cover the tags. A real game may want fewer kinds per moment, or the HUD a cap.
- **Phone portrait**: the strands are about 45 px a side; the shared energy reads more by the orb than by its length.
- The link's line is subtle by design and nearly vanishes over bright skies (redwoods by day); the matter carries it.
- The demo's bodies don't move with its events (they are `?play&two` dancers); in the films and the temple stills
  they stand too far apart for a link, so the chips say HOLDING with no line between them.
- Text sprites: a label is cached per string, so a long set with many distinct numbers fills the atlas and it starts
  again (redrawn as needed). Not seen in a 60 s set.
- System fonts as before (Segoe UI here); digits are assumed tabular (they are in Segoe UI, SF and Roboto).

## What the contract lacks (proposals, not changed)

1. **Which links were on the beat.** `combo.perfect` is a count; to glow the right icons gold the HUD guesses from
   frame-to-frame changes. Proposal: `combo.beats?: boolean[]` aligned with `links`.
2. **A fling's direction.** "A fling's pop flies off on its tangent" needs the tangent. Proposal:
   `pops[].dir?: [number, number]` (on screen, the flung body's velocity).
3. **How a combo ended.** Proposal: `combo.ended?: 'cashed' | 'dropped'` and `combo.cashed?: number` (the style it
   paid) for the frame it ends, so the flourish and "+n" aren't inferred.
4. **Pop identity.** Proposal: `pops[].id?: number` (stable for a pop's life).
5. **Who leads.** duel.md says the battle is about leading; the contract has holding/held but nothing for the leader
   of the set or of a phrase. If it matters, `players[].lead?: number` (0..1, share of leads this set).
6. For the banner: each dancer's best combo this set (`players[].best?: { n, mult }`) would read better than the bare
   style numbers.
7. Which of `link.from` / `to` is whose is not written down; the HUD reads `from` as the holder's.

## Proposed lines for AGENTS.md (not edited)

- In the map: `hud/   the screen's HUD for the duel's contact dance (panels: style, combo with link icons, dash,
  holding/held; the shared energy and merge between them; the link's line of light; the set on the music; pops;
  tags), drawn from one HudState v2 (docs/design/duel.md; hud.set) on two 2D canvases over the stage; composited into
  bend.grab and a film's frames (post's overlay); ?hud=0|demo|beat`.
- In the hooks: `bend.hud` (set, state, visible, jogoBeat, demo (`at(s)`, `moments(after)`), startDemo, stats (with
  `parts`)).

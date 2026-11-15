# 20: the dusk worlds, third pass (the geode and the redwoods: a place, not props on a floor)

Branch `p6-dusk-worlds`, from master `48f568c` (phase 5 and report 19). The brief: report 19's issue 1 for the geode (the
hub's greenhouse, the first world a player sees) and the redwoods at dusk. First the floating gold rectangles of rim
light; then a place seen whole: the geode a greenhouse cathedral, the redwoods a wood people live in.

**Measured:** stills from the duel's own camera at 1280×720 (`bend.grab`; two virtual players at skill 0.85, `fire,water`,
the music's clock on the stepped frames as `duel-page.mjs` does, `&mirrors=0` so the pair stay in the world). The same
seeds and set times before (the branch's base, `48f568c`) and after. A wide still of each world from a pose set by hand
inside the room. GPU time at four moments, base and branch served in turn on port 5491, two rounds each. Also run:
`npm run typecheck`, `node scripts/test-ts.mjs` (25 of 25 files, `edge.test.ts` and `arena.test.ts` among them),
`check-limits` and `check-bindings`.

**Not measured:** a person playing; a phone (`coarse` counts are set but not looked at); an online duel; the sound; the
duel sims (no play surface, solid or collision changed: below); `npm run test:net` (as asked).

As report 18 warned, the page's dance doesn't repeat frame for frame between loads. Each "after" still is the same seed
and second as its "before", not the same moment.

## 1. The rim rectangles are gone

The arena's rim light (`src/duel/arena-lines.wgsl`, `arena-layer.ts`) drew a ribbon round every top a body can stand on,
and round the drops. On the redwoods' meadow that was the gold rectangles of report 19's frame. In the geode it drew a
gold line round every selenite block.

- **The fix.** Both arenas set `rim: [0, 0, 0]` (`geode/arena.ts`, `redwoods/arena.ts`). `ArenaLayer` draws no rim for
  an arena whose rim colour is black: one condition in `enabled`. The temple and the Pool keep theirs.
- **What still marks the edges.** The stumps read by their oiled tops in brass (report 18). The drops read by the
  grass ending at their earth walls. The selenite reads by its own sheen.
- **The near fade** keeps its floor-edge line exactly as it was.

| | before | after |
|---|---|---|
| redwoods, seed 3, 14 s | ![](media/20-dusk-worlds-redwoods-14-before.jpg) | ![](media/20-dusk-worlds-redwoods-14-after.jpg) |
| redwoods, seed 3, 26 s | ![](media/20-dusk-worlds-redwoods-26-before.jpg) | ![](media/20-dusk-worlds-redwoods-26-after.jpg) |

## 2. The geode: a greenhouse cathedral

| | before | after |
|---|---|---|
| seed 2, 8 s | ![](media/20-dusk-worlds-geode-8-before.jpg) | ![](media/20-dusk-worlds-geode-8-after.jpg) |
| seed 2, 14 s | ![](media/20-dusk-worlds-geode-14-before.jpg) | ![](media/20-dusk-worlds-geode-14-after.jpg) |
| seed 2, 20 s | ![](media/20-dusk-worlds-geode-20-before.jpg) | ![](media/20-dusk-worlds-geode-20-after.jpg) |
| seed 2, 32 s | ![](media/20-dusk-worlds-geode-32-before.jpg) | ![](media/20-dusk-worlds-geode-32-after.jpg) |
| wide | ![](media/20-dusk-worlds-geode-wide0-before.jpg) | ![](media/20-dusk-worlds-geode-wide0-after.jpg) |
| wide, the other way | ![](media/20-dusk-worlds-geode-wide1-before.jpg) | ![](media/20-dusk-worlds-geode-wide1-after.jpg) |

Before, every frame behind the pair was a dark hollow of crystal faces and gem bokeh. Now it is a sunlit room with a
glass sky. Almost all of it is in the backdrop (`geode.wgsl geodeGreenhouse`, drawn inside `geodeWall`): no geometry,
nothing solid.

- **The vault** rises to 18 m: `vault` went from 1 to 1.45, against a radius of 12.4 m.
  - Above 7.6 m it is glass on brass ribs: 32 ribs, every other one stopping half way up as they draw in toward the
    oculus, and a brass purlin every 1.6 m.
  - Each bay's panes sit under an ogee arch of lead. A ring of stained-glass flowers (coral and gold on teal) runs round
    its lowest course.
  - Through the glass: a warm-to-teal sky with soft cloud and the wells' sun (`geodeSky`), and the crowns of trees
    outside against the lowest panes.
  - Vines climb the ribs. Wisteria and trailing green hang from the purlins.
  - The light wells are now round leaded windows set in the glass, and their god rays fall as before.
- **The tiers** (3.2 to 7.4 m):
  - A planted ledge behind a brass rail on balusters, with ferns and flowers along it and vines trailing down over the
    crystal.
  - Above it, an arcade of honey sandstone with pointed arches every 2.4 m and wisteria hanging inside each.
  - Through the arches, planting 2.5 m deep: the view ray carries on to a plane behind the wall, so the green moves
    against the arches as the eye moves (cheap parallax). It is lit from above, with shafts of haze.
  - A cream cornice with a band of copper gone green.
- **The crystal is a bank at the wall's foot.** The gem dome fixture takes a new `top` (`gems/fixtures.ts buildDome`,
  one argument, plus one line in `gems.ts`): the geode keeps it below 0.27 of its radius (about 3.3 m), with 1700 stones
  where there were 3600. The vault isn't hidden behind gems any more, and the bank is crystal with plants for company.
- **Water.** A channel of clear water runs round the floor's edge at the crystal's foot, between 11.0 and 11.9 m: cream
  stone coping, pale stones netted by caustics, and the vault and sun mirrored with Fresnel (`backdrop.wgsl`). It is
  outside the duel's space (10.5 m) and visual only.
- **Hanging gardens** (`garden.ts`): up to 14 planters (7 to 12 drawn, the rest skipped to keep the gates' ways clear;
  8 on a phone), hung at 4.7 to 6.5 m round the room's edge over the channel. Each has a vine-wrapped chain from the
  vault, ferns and flowers on top and long vines trailing down. They stay outside the space, off the gates' bearings.
- **Pollen in the shafts** (`motes.wgsl`): half the dust (`motes` 1400 → 2400) now drifts down the four wells' beams.
- **The air.** The haze is warm and lifts looking up, the sunlit air under glass (`geodeAir`, `hazeCol`).

The front page (the hub, the first thing a player sees) gets the arcade and the vault's foot over the gates:

![the front page after](media/20-dusk-worlds-front-after.jpg)

## 3. The redwoods at dusk: a wood people live in

| | before | after |
|---|---|---|
| seed 3, 8 s | ![](media/20-dusk-worlds-redwoods-8-before.jpg) | ![](media/20-dusk-worlds-redwoods-8-after.jpg) |
| seed 3, 40 s | ![](media/20-dusk-worlds-redwoods-40-before.jpg) | ![](media/20-dusk-worlds-redwoods-40-after.jpg) |
| wide | ![](media/20-dusk-worlds-redwoods-wide0-before.jpg) | ![](media/20-dusk-worlds-redwoods-wide0-after.jpg) |
| wide, the other way | ![](media/20-dusk-worlds-redwoods-wide1-before.jpg) | ![](media/20-dusk-worlds-redwoods-wide1-after.jpg) |

![seed 3, 70 s: deep dusk, the walkway's lanterns over the ring, the arbour and the fungi](media/20-dusk-worlds-redwoods-70-after.jpg)

**Living architecture.** New files `canopy.ts` (the layout) and `canopy.wgsl` (the drawing): three draws, a few
thousand triangles.

- **Turned pieces** (one lathe shader, profile by kind):
  - Decks of oiled honey-wood planks round the trunks, with a brass-banded fascia. Their undersides are mossy, with
    bracket ribs and points of fungus that glow after dusk.
  - Railings: brass handrail, honey posts, slender balusters, a wave rail and vine.
  - Round tree-houses: cream lime walls on a timber frame, five arched leaded windows that light amber as dusk falls,
    and a roof of moss over copper gone green in shingle courses, with a brass finial. Each stands on its own floor
    disc, pointed below.
  - Seed lanterns of solar glass in brass ribs.
- **Spans:**
  - Rope bridges: a catenary of planks with gaps, rope netting up to a handrope on each side, lanterns hung along it.
  - Stairs winding up a trunk from the ground: treads nosed in brass and a rope-and-post balustrade.
- **Halos** in the glow pass for every lantern. They scale with dusk, and a far one keeps a few pixels so a string of
  them reads in the mist.
- **Where it stands:**
  - On the ring's nine trees, decks at 6.6 to 7.6 m going only round the side away from the clearing (a 220° arc), so
    their inner edge stays outside the duel's space.
  - A walkway of bridges joins neighbouring ring decks. Houses sit beside the trunk on every other ring deck, where they
    show from the clearing.
  - In the wood 16 to 48 m out: up to 22 decks (lower the nearer: 2.4 to 4 m near, higher further), houses on about
    half, a second higher deck on some, bridges between neighbours at like heights, and up to 7 stairs from the ground.
- **Nothing here is a solid.** It is decoration (`decorDrop`), nothing stands on the ground inside the ring, and the air
  fogs it by its own distance, so tier after tier goes back into the mist.

**Other changes:**

- **Roots at the meadow's edge** (`canopy.ts layoutRoots`): up to six gnarled roots from each ring tree's flare (three on
  a phone), chains of half-sunk capsules drawn with the bark (`trunks.wgsl vs_stage`). They are kept outside the duel's
  space and 3.2 m clear of both mirrors and the gate.
- **Layered depth and the warm glow through the trunks** (`woods.wgsl woodsDeep`): past the last drawn trunk, three
  tiers of trunk silhouettes ring the view against the low sky's glow, each further tier paler in the mist. The glow is
  warmest toward the sun's bearing and lingers after sunset.
- **Fireflies in volume** (`lanterns.wgsl`): 900 more live out in the wood (260 on a phone), from the ring to 48 m and
  up to about 8 m, past `NEAR` (the clearing's 320 are as before). A far one is drawn a little bigger so it stays a
  point at 720p. Like the rest they come out with dusk (`forest.horizon.w`).
- **Bioluminescence building with dusk:** the deck undersides' fungus, the moss on the roofs, the windows and lanterns,
  the deep fireflies and the halos all scale with `horizon.w`, on top of report 18's moss, fungi and pods. The 70 s
  still shows where a set ends.

## Mirrors, play and readability

- **No play surface, solid, drop, spawn or collision changed** in either arena: the pieces, ledges, walls and drops are
  the same numbers. The rim is light only, and everything new is decoration outside the space or above its top. The
  `edge.test.ts` and `flow.test.ts` lanes pass. The duel sims were not run.
- **The mirrors' and gates' sites are untouched.**
  - The roots keep 3.2 m off them.
  - The geode's hanging planters keep 0.32 rad off the gates' bearings.
  - The geode's channel lies behind the gates (it starts at 11.0 m; the redwoods' gate stands at 9.7 m).
  - The redwoods' ring walkway passes over its mirrors at 6.6 m and up, above their crowns.
- **The glimpse.** A geode gate seen from another world now shows a bright greenhouse in place of a dark cave. A redwoods
  mirror seen from elsewhere shows the lit wood. Not looked at in a still.
- **The bodies.** They read in every after-still at 720p: fire and water against a lighter, warmer geode, and against
  the meadow at dusk. The geode is brighter overall, so check this with plasma and ice, which weren't dressed here.

## The GPU

RTX 5090, 1280×720. The GPU was shared with other agents. Base `48f568c` and the branch were served in turn on port
5491, at the same seeds and moments: two rounds, each the mean of 50 profiled frames.

| | scene pass, base → branch (ms, two rounds) | whole frame, base → branch |
|---|---|---|
| geode, seed 2, 20 s | 0.374, 0.384 → 0.453, 0.363 | 1.99, 1.95 → 1.94, 1.89 |
| geode, seed 2, 32 s | 0.419, 0.368 → 0.393, 0.365 | 2.67, 1.79 → 2.16, 2.01 |
| redwoods, seed 3, 26 s | 0.838, 0.815 → 0.941, 0.704 | 4.02, 3.07 → 3.09, 3.34 |
| redwoods, seed 3, 40 s | 1.397, 0.759 → 1.114, 0.996 | 4.53, 2.96 → 3.20, 3.15 |

Every change is inside the run-to-run noise: identical runs moved by up to 0.6 ms on the scene pass and 0.9 ms on the
whole frame. The geode's backdrop does more per pixel (the vault's noise and leading), but the gem fixture lost 1900
stones. The canopy, roots and deep fireflies are a few thousand triangles and some 900 tiny quads, and pieces off
screen skip their work in the vertex shader. The cost of the new draws alone was not isolated.

## Files

- **The rim:** `src/duel/arena-layer.ts` (one condition), `src/worlds/geode/arena.ts`, `src/worlds/redwoods/arena.ts`.
- **The geode:**
  - `geode.wgsl`: `geodeGreenhouse`, `geodeSky`, the haze.
  - `backdrop.wgsl`: the channel.
  - `motes.wgsl`: pollen in the beams.
  - `garden.ts`: the hanging gardens.
  - `geode.ts`: vault, crystal count and `top`, brightness, motes, haze colour.
  - `src/matter/gems/fixtures.ts` and `gems.ts`: the dome's `top`.
- **The redwoods:**
  - `canopy.ts`, `canopy.wgsl` and the generated `canopy.d.wgsl.ts` (all new).
  - `redwoods.ts`: the draws, the roots, the deep fireflies.
  - `woods.wgsl`: `woodsDeep`.
  - `lanterns.wgsl`: the deep fireflies.

## Not done

- **The selenite and the crystal points are still boxes and spikes.** The geode's arena still reads partly as blocks
  standing in the greenhouse. A planted-top material for the selenite (moss and ferns over a pale stone, not a beige
  board) is the next step there.
- **The crystal bank is busy close up.** When the duel's eye stands at the room's edge it fills half the frame with gem
  glints (seed 2, 14 s). Fewer, larger crystals there, or more planting between them, would calm it.
- **The redwoods' duel camera still mostly sees meadow.** It looks a little down, so the canopy village, the ring
  walkway and the tiers of trunks show mainly in the wide stills, at the frame's top, and at deep dusk (the 70 s
  still). Showing more of it means a camera change (p6-crossing's area) or architecture at body height inside the
  ring, which would crowd the play space.
- **Small faults:**
  - A partial deck's two cut ends are open; seen end on, they show the inside of the lathe.
  - The geode's hanging planters are small in the frame.
  - The channel is mostly hidden behind the crystal bank from the duel's eye.
- **Not done at all:**
  - No concept image was made.
  - A phone (`coarse`) and plasma and ice bodies were not looked at.
  - The bridges' and stairs' safety on a phone budget wasn't measured.

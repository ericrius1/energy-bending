# matter/reactions

What happens where kinds meet, read off the matter field (src/matter/field), whoever brought the heat and the wet.
Each reaction is a matter kind with no homes on a body, registered from `index.ts`.

- **steam** (`steam.ts`, `steam.wgsl`, `steam_sim.wgsl`, `steam_draw.wgsl`, `steam_comp.wgsl`, `steam_front.wgsl`,
  `params.ts`): the meeting of two elements as an event. Where two bodies' surfaces touch and the field reacts there,
  a white-hot **front** burns along the contact (short streaks born every frame, so it follows the contact and is
  gone when they part) and **wisps** boil up from it, gone within about a second; flame on ice also **drips**, plasma
  on water **sparks**. The pair is read off the field (heat's sign and size, cold, plasma's dryness): fire and water
  white with a warm underside, flame and ice a hard bright crack and a jet of vapour, plasma and water violet-white
  with small arcs, plasma and ice cold blue-violet vapour that sinks before it rises. Wisps are drawn at half
  resolution into their own target and composited after the depth of field, blurred a little, under a per-pixel cap
  (at most `cap` 0.45 of what is behind, never brighter than 0.85 of white); the fronts, drips and sparks go on top at
  full resolution. A fusion staged in the field (`field.fuse`) gives steam its look: steam, prism, storm, aurora.
- **The look** (phase 5, report 18-steam): morning mist in the sun's shafts. Fire and water's white is a warm cream;
  the key is scattered forward (brighter looking toward the light) and crossed by the sun's shafts (bands radiating
  from where the key stands on screen); after dusk in the redwoods the moss, the fireflies and the lanterns light it
  from below. **Off the bodies:** each dancer's core on screen (a capsule from its hips to its head) takes `keepOff`
  0.8 of the veil off (0.92 through a catch's frames: the duel sets `SteamPasses.quiet`), and no wisp stands nearer
  the lens than the nearest dancer (less 0.4 m). The fronts are a line of sun gold, not white-hot. **A geyser's
  column** (`SteamPasses.column`, set by the duel from power-fx.ts): drawn in the composite as the eye's ray through a
  soft upright cylinder of mist (strands round its axis, patches rising, thicker toward its rim), warm by day and lit
  by the moss's teal from below after dusk, cut at the pair's distance (only the part behind and beside them shows)
  and cleared round each body (steam_comp.wgsl `columnMist`).

Not yet: smoke (flame in wet), quench, melting and freezing as their own matter (the kinds read `fieldHeat` /
`fieldWet` for those).

How to read the field and add a reaction or an aura: `docs/extending/reactions.md`.

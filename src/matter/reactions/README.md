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
  (at most `cap` 0.55 of what is behind, never brighter than 0.85 of white); the fronts, drips and sparks go on top at
  full resolution. A fusion staged in the field (`field.fuse`) gives steam its look: steam, prism, storm, aurora.

Not yet: smoke (flame in wet), quench, melting and freezing as their own matter (the kinds read `fieldHeat` /
`fieldWet` for those).

How to read the field and add a reaction or an aura: `docs/extending/reactions.md`.

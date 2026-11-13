# matter/reactions

What happens where kinds meet, read off the matter field (src/matter/field), whoever brought the heat and the wet.
Each reaction is a matter kind with no homes on a body, registered from `index.ts`.

- **steam** (`steam.ts`, `steam_sim.wgsl`, `steam_draw.wgsl`, `params.ts`): puffs born where the field makes steam
  (`fieldSteam`: heat meeting wet, flame melting ice), rising on the field's wind, billowing and fading; pale, a little
  luminous, warmed by the field's heat, white-hot at the clash.

Not yet: smoke (flame in wet), quench, melting and freezing as their own matter (the kinds read `fieldHeat` /
`fieldWet` for those), and the fusion's flows beyond the vortex source the field already has (`field.vortex`).
How to read the field and add a reaction or an aura: `docs/extending/reactions.md`.

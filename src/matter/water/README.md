# matter/water (wave 1: water + ice)

Fluid bodies: particles sprung loosely to their homes that slosh and spray, drawn as a screen-space surface (depth,
thickness, a smoothed normal). It implements `MatterKind` (src/matter/core/kind.ts) and registers from an `index.ts`
here. It deposits wet into the field and reads heat (water in heat becomes steam, in cold near ice it freezes). See
`docs/extending/matter-kind.md` and `docs/element-looks.md`.

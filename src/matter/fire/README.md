# matter/fire (wave 1: fire + plasma)

Bodies of flame: particles born on the body's capsules that rise, flicker and die, re-emitted where the body is.
It implements `MatterKind` (src/matter/core/kind.ts): `matterKinds.register({ id: 'fire', declare })` from an
`index.ts` here, which `main.ts` picks up by itself. Read `docs/extending/matter-kind.md` first; the look reference is
`docs/element-looks.md`. It deposits heat (and stirs wind) into the field (`src/matter/field`) and samples wet there to
die to smoke.

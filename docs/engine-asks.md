# Engine asks

Things Energy Bending would like from weft, written down instead of forking engine code (weft's AGENTS.md, rule 12).
Each: what, why, and what we do meanwhile.

## 1. Don't pass `powerPreference` on Windows

`createKit` calls `requestAdapter({ powerPreference: opts.powerPreference ?? 'high-performance' })`. Chrome on Windows
ignores the option and logs a console warning on every load ("The powerPreference option is currently ignored when
calling requestAdapter() on Windows", crbug.com/369219127). Passing `powerPreference: undefined` doesn't help, as the
default fills it in. Ask: leave it out when the platform is Windows (or when the caller passes `null`).
Meanwhile: the one warning on load is known and listed in `docs/reports/0-foundation.md`.

## 2. Reflection of `const` array lengths (nice to have)

Uniform arrays here are sized by WGSL constants (`array<Kind, MAX_SPECIMENS>`), and the same caps live in
`src/engine/limits.ts` for the buffers. A shader module exposing its module-scope `const` values (as it exposes
structs) would let TypeScript read the caps from WGSL, making WGSL the single source for them too.
Meanwhile: `npm test` (scripts/check-limits.mjs) checks the two files agree.

## 3. A view's draws without redeclaring them per view (a question, not yet a need)

A portal (and `?pip`) draws a second world's scene from another camera. Today each view declares its own draws
(`declareScene(view, …)`), which is explicit and simple. `replay` copies another pass's draws, but every draw then keeps
the source's `enabled` and bindings, and the gems need a per-view cull list. If portals grow to several live views, a
way to declare a draw once with per-view bindings (a `views` option on a draw, binding by view) would save pipeline
records. Not needed for wave 0.

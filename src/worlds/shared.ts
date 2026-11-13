// The worlds' light group: every world's light uniforms (World.shared) gathered into one bind group, group 2, that
// weft shares with every shader including worlds/light.wgsl. Called once, after the worlds are made and before any
// pass that draws with it is declared (weft's rule for shared groups).
import type { Kit } from '@ericrius1/weft';
import lightShader from './light.wgsl';
import type { World } from './world';

export function shareWorldLight(kit: Kit, all: readonly World[]) {
  const values: Record<string, unknown> = {};
  for (const w of all) for (const [name, buf] of Object.entries(w.shared)) {
    if (name in values) throw new Error(`worlds: two worlds share a light uniform named '${name}'`);
    values[name] = buf;
  }
  const declared = Object.values(lightShader.bindings).filter((b) => b.group === 2).map((b) => b.name);
  for (const n of declared) if (!(n in values)) throw new Error(`worlds/light.wgsl declares '${n}' but no world provides it`);
  return kit.shareGroup(2, lightShader, values, 'worlds.light');
}

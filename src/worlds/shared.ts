// The worlds' light group, group 2, that weft shares with every shader including worlds/light.wgsl: one uniform
// buffer, `worldLight` (WorldLight in light.wgsl: a slot per world and the dancers' fire), and the textures the worlds put
// in World.shared (the water worlds' ripples). A world writes only its own slot, through a LightSlot it takes by its
// member's name; the slots are written in place in the one buffer's CPU copy, which weft uploads once per kit.run, so
// every view drawn that run (the main view, each gate's) reads its own world's slot. Nothing here names a world: a new
// one adds its member to WorldLight and takes its slot, and this file stays as it is.
// shareWorldLight is called once, after the worlds are made and before any pass that draws with it is declared
// (weft's rule for shared groups).
import type { DeepPartial, Kit, UniformBuffer } from '@ericrius1/weft';
import lightShader, { type WorldLight } from './light.wgsl';
import type { World } from './world';

const made = new WeakMap<Kit, UniformBuffer<WorldLight>>();

/** the kit's one world-light uniform (made by whoever asks first: a world in its constructor, or the fire kind) */
export function worldLight(kit: Kit): UniformBuffer<WorldLight> {
  let u = made.get(kit);
  if (!u) {
    u = kit.uniforms(lightShader.structs.WorldLight, 'worlds.light');
    made.set(kit, u);
  }
  return u;
}

/** one member of WorldLight: a world's own light (or the dancers' fire), written in place in the shared buffer */
export class LightSlot<T> {
  constructor(private readonly buf: UniformBuffer<WorldLight>, readonly name: keyof WorldLight) {}
  /** write these fields of the slot (nested partials, as UniformBuffer.set); uploaded with the rest at the next run */
  set(values: DeepPartial<T>): this {
    this.buf.set({ [this.name]: values } as DeepPartial<WorldLight>);
    return this;
  }
}

/** a world's slot in the shared light uniform, by its WorldLight member's name (`lightSlot(kit, 'geode')`) */
export function lightSlot<K extends keyof WorldLight>(kit: Kit, name: K): LightSlot<WorldLight[K]> {
  if (!lightShader.structs.WorldLight.fields.some((f) => f.name === name)) throw new Error(`worlds/light.wgsl: WorldLight has no member '${String(name)}'`);
  return new LightSlot<WorldLight[K]>(worldLight(kit), name);
}

export function shareWorldLight(kit: Kit, all: readonly World[]) {
  const values: Record<string, unknown> = { worldLight: worldLight(kit) };
  for (const w of all) for (const [name, res] of Object.entries(w.shared)) {
    if (name in values) throw new Error(`worlds: two worlds share a light binding named '${name}'`);
    values[name] = res;
  }
  const declared = Object.values(lightShader.bindings).filter((b) => b.group === 2).map((b) => b.name);
  for (const n of declared) if (!(n in values)) throw new Error(`worlds/light.wgsl declares '${n}' but no world provides it`);
  return kit.shareGroup(2, lightShader, values, 'worlds.light');
}

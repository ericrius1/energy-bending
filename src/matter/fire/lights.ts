// The fire's light for the worlds: one small uniform per kit (matter/fire/light.wgsl says what is in it and how a world
// shader reads it). It is made by whoever asks first, so a world can bind it when it is made (before the matter kinds
// are declared) and the fire kind fills it each frame. Nothing else about the fire is shared this way.
import type { Kit, UniformBuffer } from '@ericrius1/weft';
import lightShader, { type FireLights } from './light.wgsl';
import { LIMITS } from '../../engine/limits';

const made = new WeakMap<Kit, UniformBuffer<FireLights>>();

/** the kit's fire-light uniform (bind it as `fireLights` in a shader that includes matter/fire/light.wgsl) */
export function fireLights(kit: Kit): UniformBuffer<FireLights> {
  let u = made.get(kit);
  if (!u) {
    u = kit.uniforms(lightShader.structs.FireLights, 'fire.lights');
    u.set({ count: 0 });
    made.set(kit, u);
  }
  return u;
}

/** one dancer's flame as a light, on the CPU (FireLight in light.wgsl): position, radius, colour × intensity, intensity */
export interface FlameLight { dancer: number; pos: [number, number, number]; radius: number; color: [number, number, number]; intensity: number }

/** write the lights (at most LIMITS.dancers) */
export function writeFireLights(u: UniformBuffer<FireLights>, lights: readonly FlameLight[]) {
  const n = Math.min(lights.length, LIMITS.dancers);
  u.set({
    count: n,
    lights: lights.slice(0, n).map((l) => ({
      pos: [l.pos[0], l.pos[1], l.pos[2], l.radius],
      col: [l.color[0] * l.intensity, l.color[1] * l.intensity, l.color[2] * l.intensity, l.intensity],
    })),
  });
}

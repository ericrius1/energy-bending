// The fire's light for the worlds: the `fire` slot of the worlds' one light uniform (WorldLight in worlds/light.wgsl;
// matter/fire/light.wgsl says what is in it and how a shader reads it). The slot's buffer is made by whoever asks
// first, so a world can be made before the matter kinds are declared, and the fire kind fills it each frame. Nothing
// else about the fire is shared this way.
import type { Kit } from '@ericrius1/weft';
import type { FireLights } from './light.wgsl';
import { lightSlot, type LightSlot } from '../../worlds/shared';
import { LIMITS } from '../../engine/limits';

/** the kit's fire light: the `fire` slot of the shared world light (read as `light.fire` in worlds/light.wgsl) */
export function fireLights(kit: Kit): LightSlot<FireLights> {
  return lightSlot(kit, 'fire');
}

/** one dancer's flame as a light, on the CPU (FireLight in light.wgsl): position, radius, colour × intensity, intensity */
export interface FlameLight { dancer: number; pos: [number, number, number]; radius: number; color: [number, number, number]; intensity: number }

/** write the lights (at most LIMITS.dancers) */
export function writeFireLights(u: LightSlot<FireLights>, lights: readonly FlameLight[]) {
  const n = Math.min(lights.length, LIMITS.dancers);
  u.set({
    count: n,
    lights: lights.slice(0, n).map((l) => ({
      pos: [l.pos[0], l.pos[1], l.pos[2], l.radius],
      col: [l.color[0] * l.intensity, l.color[1] * l.intensity, l.color[2] * l.intensity, l.intensity],
    })),
  });
}

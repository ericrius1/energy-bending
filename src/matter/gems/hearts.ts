// The hearts (hearts.wgsl): one uniform per kit, a glowing sphere per dancer whose torso is a gem heart inside other
// matter. The gems fill it each frame; any kind that draws matter round a heart (fire, water, ice) binds it by name
// (`hearts: heartsOf(kit)`) and thins its matter in front of the heart (heartVeil) and takes its light (heartLight).
// It is made by whichever asks first, so neither side depends on the other being loaded: with no gems it stays zero
// (no hearts). This is a shared buffer between kinds, kept per kit (not a global bag of numbers).
import type { Kit, UniformBuffer } from '@ericrius1/weft';
import heartsShader, { type Hearts } from './hearts.wgsl';

const made = new WeakMap<Kit, UniformBuffer<Hearts>>();

/** the hearts' uniform for this kit (hearts.wgsl `Hearts`): bind it as `hearts` */
export function heartsOf(kit: Kit): UniformBuffer<Hearts> {
  let u = made.get(kit);
  if (!u) { u = kit.uniforms(heartsShader.structs.Hearts, 'gems.hearts'); made.set(kit, u); }
  return u;
}

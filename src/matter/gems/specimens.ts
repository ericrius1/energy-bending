// The specimens the gems draw: public/specimens/ (Blender, scripts/specimens.py), and minerals that borrow one of
// their shapes (minerals.ts `mesh`). A borrowed shape is a copy of the other specimen's vertices with the copy's own
// draw number written into each vertex (draw.wgsl reads its specimen and detail from the vertex: code = (specimen ×
// LODS + detail) × 8 + material), appended after the file's, so the copy has its own indirect draws and its own look.
import { STONES } from './minerals';

export interface SpecimenIndex { lods: number; specimens: { id: string; title: string; lods: { first: number; count: number }[] }[] }

const FLOATS = 8;   // two vec4 a vertex: position + ao.facet, normal + code

/** the file's specimens and the borrowed ones after them: a new index and a new vertex buffer */
export function withBorrowed(index: SpecimenIndex, bin: ArrayBuffer): { index: SpecimenIndex; bin: Float32Array } {
  const src = new Float32Array(bin);
  const L = index.lods;
  const add = Object.entries(STONES).filter(([id, s]) => s.mesh && !index.specimens.some((x) => x.id === id));
  const from = add.map(([, s]) => index.specimens.find((x) => x.id === s.mesh));
  const extra = from.reduce((a, s) => a + (s ? s.lods.reduce((b, l) => b + l.count, 0) : 0), 0);
  const out = new Float32Array(src.length + extra * FLOATS);
  out.set(src);
  const specimens = [...index.specimens];
  let at = src.length / FLOATS;
  add.forEach(([id, s], j) => {
    const base = from[j];
    if (!base) return;
    const t = specimens.length;
    const lods = base.lods.map((l, d) => {
      const first = at;
      out.set(src.subarray(l.first * FLOATS, (l.first + l.count) * FLOATS), first * FLOATS);
      for (let v = 0; v < l.count; v++) {
        const o = (first + v) * FLOATS + 7;
        const mat = Math.round(out[o]) % 8;
        out[o] = (t * L + d) * 8 + mat;
      }
      at += l.count;
      return { first, count: l.count };
    });
    specimens.push({ id, title: s.title ?? id, lods });
  });
  return { index: { lods: L, specimens }, bin: out };
}

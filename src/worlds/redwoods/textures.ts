// The wood's textures (photographs, seamless: public/worlds/redwoods/), loaded into textures with their whole mip
// chain (Gem Dancers' forest.ts).
/** something that takes pixels a mip level at a time (a weft Texture) */
interface Pixels { mips: number; write(data: ArrayBufferView, o: { mip: number }): unknown }

/** load an image into a texture with its whole mip chain (each level the last one halved, wrapping, as it tiles). A
 *  height map (`height`) comes out as r: the height, gb: its normal (round, up), from the slopes either side */
export async function fillTexture(tex: Pixels, url: string, height = false) {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  let w = img.width, h = img.height;
  const cv = new OffscreenCanvas(w, h);
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0);
  let px = new Uint8Array(cx.getImageData(0, 0, w, h).data.buffer);
  if (height) {
    const src = px.slice();
    const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
        // round the trunk is +x; up it is -y in the image
        const nx = -gx * 4, ny = gy * 4, l = Math.hypot(nx, ny, 1);
        const o = (y * w + x) * 4;
        px[o] = src[o];
        px[o + 1] = Math.round((nx / l * 0.5 + 0.5) * 255);
        px[o + 2] = Math.round((ny / l * 0.5 + 0.5) * 255);
        px[o + 3] = 255;
      }
    }
  }
  for (let m = 0; m < tex.mips; m++) {
    tex.write(px, { mip: m });
    if (m === tex.mips - 1) break;
    const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1), next = new Uint8Array(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) {
      for (let x = 0; x < w2; x++) {
        for (let c = 0; c < 4; c++) {
          const a = ((y * 2) % h) * w, b = ((y * 2 + 1) % h) * w, x0 = (x * 2) % w, x1 = (x * 2 + 1) % w;
          next[(y * w2 + x) * 4 + c] = (px[(a + x0) * 4 + c] + px[(a + x1) * 4 + c] + px[(b + x0) * 4 + c] + px[(b + x1) * 4 + c] + 2) >> 2;
        }
      }
    }
    px = next; w = w2; h = h2;
  }
}

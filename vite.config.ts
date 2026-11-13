import { defineConfig } from 'vite';
import { weft } from '@ericrius1/weft/vite';

// Energy Bending. weft's plugin imports .wgsl shaders typed (it writes a .d.wgsl.ts beside each). `public/` (motion
// capture, specimens, the worlds' textures) is copied verbatim. The site's base path comes from BASE (default
// /energybending/, where it will live): code reads it as import.meta.env.BASE_URL, never a literal.
// sketches/ holds plain-JS prototypes with their own package.json: the dev server and the build leave them alone.
export default defineConfig({
  base: process.env.BASE ?? '/energybending/',
  plugins: [weft()],
  server: {
    port: Number(process.env.PORT ?? 5391),
    strictPort: !!process.env.PORT,
    watch: { ignored: ['**/sketches/**', '**/docs/**', '**/shots/**'] },
  },
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'esnext' },
});

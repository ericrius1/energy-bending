import { defineConfig, normalizePath } from 'vite';
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
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // main.ts boots with top-level awaits, one of them on the duel's (or the jogo's) dynamic import. Left to
        // itself Rollup puts what main imports statically into main's own chunk, and a lazy chunk that shares one of
        // those modules (the hazards, the sound's helpers) imports main's chunk back: main waits on the lazy chunk,
        // the lazy chunk waits on main to finish evaluating, and the page never boots (only in a build: the dev
        // server serves modules one by one). So everything main reaches statically goes to a `core` chunk without
        // top-level awaits, and main's own chunk holds main alone.
        manualChunks(id, { getModuleInfo, getModuleIds }) {
          if (!coreIds) {
            coreIds = new Set();
            const main = [...getModuleIds()].find((m) => normalizePath(m).endsWith('/src/main.ts'));
            const walk = (m: string) => {
              for (const d of getModuleInfo(m)?.importedIds ?? []) if (!coreIds!.has(d)) { coreIds!.add(d); walk(d); }
            };
            if (main) walk(main);
          }
          return coreIds.has(id) ? 'core' : undefined;
        },
      },
    },
  },
});

let coreIds: Set<string> | null = null;

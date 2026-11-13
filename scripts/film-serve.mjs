// The film's server: Vite's dev server with no hot reload and no file watching, so an edit made while a film renders
// can't reload its page halfway through a take (or change the build under a cache key). Restart it after changing
// code. node scripts/film-serve.mjs [port, default 5435]   (serves /energybending/ on 127.0.0.1)
import { createServer } from 'vite';

const port = Number(process.argv[2] ?? 5435);
const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } },
});
await server.listen();
server.printUrls();

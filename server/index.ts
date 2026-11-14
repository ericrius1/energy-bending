// The room server's entry: `node server/index.ts [port]` (or `npm start` at the repo root). Node strips the types
// itself (22.18 and later), so there is no build step. With PORT in the environment (Railway sets it) it binds
// 0.0.0.0 on that port; otherwise 127.0.0.1 on the argument or 5417. Stops cleanly on SIGINT and SIGTERM.
// If the game has been built (dist/index.html, or SITE_DIR), it serves it too, under BASE (default /energybending/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRooms, SERVER_PARAMS } from './rooms.ts';

const port = Number(process.env.PORT) || Number(process.argv[2]) || 5417;
const host = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

// ROOM_GRACE_MS shortens the reconnect grace (the tests use it; the default is SERVER_PARAMS.GRACE_MS)
if (Number(process.env.ROOM_GRACE_MS) > 0) SERVER_PARAMS.GRACE_MS = Number(process.env.ROOM_GRACE_MS);

const dir = process.env.SITE_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const site = fs.existsSync(path.join(dir, 'index.html')) ? { dir, base: process.env.BASE ?? '/energybending/' } : null;
// DUELS=0 turns the online duels off (no engine bundled, no duel clock)
const server = await startRooms({ port, host, site, duels: process.env.DUELS !== '0' });
if (site) console.log(`serving the game from ${site.dir} at ${site.base}`);

function shutdown() {
  void server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

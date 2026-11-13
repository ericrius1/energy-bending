// The game's built site (dist/), served by the room server so one Railway service is both: the page under its base
// path (/energybending/, what Vite builds for and what ericlevin.dev's rewrite forwards), the rooms at /ws. Vite's
// hashed files (assets/*-<hash>.*) are cached for a year; everything else revalidates. Media answers range requests,
// which Safari needs before it will play an audio or video file. A path outside the folder is refused; a path with
// no file under the base gets the page (index.html), so a reload on any address there still opens the game.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wgsl': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};
const HASHED = /[-.][A-Za-z0-9_-]{8,}\.(js|css|wasm|woff2|png|jpg|webp|svg)$/;

export interface Site { dir: string; base: string }

/** handles the request if it belongs to the site (true), else leaves it to the caller (false) */
export function serveSite(site: Site, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? '/').split('?')[0];
  const base = site.base.endsWith('/') ? site.base : site.base + '/';
  if (url === '/' || url === base.slice(0, -1)) { res.writeHead(302, { Location: base }); res.end(); return true; }
  if (!url.startsWith(base)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }

  let rel: string;
  try { rel = decodeURIComponent(url.slice(base.length)); } catch { res.writeHead(400); res.end(); return true; }
  const root = path.resolve(site.dir);
  let file = path.resolve(root, rel || 'index.html');
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return true; }
  let stat = statOf(file);
  if (stat?.isDirectory()) { file = path.join(file, 'index.html'); stat = statOf(file); }
  // an address with no file and no extension is a page address: give the game
  if (!stat && !path.extname(file)) { file = path.join(root, 'index.html'); stat = statOf(file); }
  if (!stat) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return true; }

  const ext = path.extname(file).toLowerCase();
  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': HASHED.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
  };
  const size = stat.size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  return true;
}

function statOf(file: string): fs.Stats | null {
  try { return fs.statSync(file); } catch { return null; }
}

// Where the room server is, in one place:
// - `&server=ws://host:port/ws` on the address wins.
// - Otherwise a production build's VITE_ROOMS (the Railway service's own wss://…/ws, set when ericlevin.dev forwards
//   the page through a rewrite that can't carry a WebSocket).
// - Otherwise a production build asks its own host (the service serves the page and the rooms together).
// - In development it is the page's host on 5417 (npm start).
export function roomServer(query: URLSearchParams = new URLSearchParams(location.search)): string {
  const given = query.get('server');
  if (given) return given;
  const ws = location.protocol === 'https:' ? 'wss' : 'ws';
  const built = import.meta.env.VITE_ROOMS as string | undefined;
  if (built) return built;
  if (import.meta.env.PROD) return `${ws}://${location.host}/ws`;
  return `${ws}://${location.hostname}:5417/ws`;
}

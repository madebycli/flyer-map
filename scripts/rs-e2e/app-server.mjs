// The app's address for the flows against the local Worker: serves dist-rs and passes `/api/v5/*` on to the Worker, so the page and the API share one
// origin (cookies, same-origin checks), exactly as in production. Only for the local test stack.
//   node scripts/rs-e2e/app-server.mjs [port] [worker-port]      (defaults 8160 and 8788)
import { request } from 'node:http';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export function startApp(dir, port = 8160, workerPort = 8788) {
  const worker = `http://127.0.0.1:${workerPort}`;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      // the Worker judges "same origin" by its own address: the page's origin is rewritten to it
      const headers = { ...req.headers, host: `127.0.0.1:${workerPort}` };
      if (headers.origin) headers.origin = worker;
      const up = request({ host: '127.0.0.1', port: workerPort, path: req.url, method: req.method, headers }, (answer) => { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); });
      up.on('error', () => { res.writeHead(502).end(); });
      req.pipe(up);
      return;
    }
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(dir, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(file)); }
    catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startApp(fileURLToPath(new URL('../../dist-rs/', import.meta.url)), Number(process.argv[2] ?? 8160), Number(process.argv[3] ?? 8788));
  console.log('app on http://127.0.0.1:' + (process.argv[2] ?? 8160));
}

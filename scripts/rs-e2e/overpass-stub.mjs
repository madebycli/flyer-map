// A stand-in for the map data source (Overpass) of the local test stack: answers every request of the Worker with a made-up neighbourhood for the box
// the query asks for (the generator is the mock backend's, `flyermap-web/examples/synth_overpass.rs`). No network, nothing real.
//   node scripts/rs-e2e/overpass-stub.mjs [port]      (default 8799; the Worker is started with OSM_OVERPASS_URL=http://127.0.0.1:8799/api/interpreter)
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const BINARY = process.env.SYNTH_OVERPASS ?? fileURLToPath(new URL('../../flyermap-rs/target/debug/examples/synth_overpass', import.meta.url));

export function startStub(port = 8799) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const query = decodeURIComponent(body.replace(/^data=/u, ''));
      // `way["highway"](51.199277,13.008853,51.205723,13.021147)`: south, west, north, east
      const box = /\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/u.exec(query);
      if (!box) { res.statusCode = 400; return res.end('no box'); }
      try {
        const out = execFileSync(BINARY, [...box.slice(1, 5), box[0]], { maxBuffer: 64 * 1024 * 1024 });
        res.setHeader('content-type', 'application/json');
        res.end(out);
      } catch (e) { res.statusCode = 500; res.end(String(e.message)); }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startStub(Number(process.argv[2] ?? 8799));
  console.log('overpass stub on 127.0.0.1');
}

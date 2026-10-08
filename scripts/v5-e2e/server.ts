// End-to-end fixture server for the v5 field core: the real Worker handlers on an in-memory D1 plus the built client.
// Usage: npm run build && node --experimental-transform-types scripts/v5-e2e/server.ts, then node scripts/v5-e2e/flow.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { NetworkD1, seedNetwork } from '../../tests/helpers/networkD1.ts';
import { createAccessGrant, createSessionForGrant, sessionCookie } from '../../worker/access.ts';
import { handleV5Api } from '../../worker/v5/api.ts';
import { syntheticCity } from '../../src/v5/engine/synthetic.ts';

const db = new NetworkD1(false, true);
seedNetwork(db);
// Area polygon covering the synthetic city (origin 13.0/51.0, 12x12 blocks of 100 m, plus the extras below/left of it).
const ring = [[12.998, 50.996], [13.02, 50.996], [13.02, 51.013], [12.998, 51.013], [12.998, 50.996]];
db.sqlite.prepare('UPDATE areas SET geometry_json=? WHERE id=?').run(JSON.stringify({ type: 'Polygon', coordinates: [ring] }), 'area_n');

const city = syntheticCity(12, 12);
const overpass = {
  elements: [
    ...city.raw.ways.map((w) => ({ type: 'way', id: w.id, nodes: w.nodes, tags: w.tags, geometry: w.coords.map(([lon, lat]) => ({ lat, lon })) })),
    ...city.raw.buildings.map((b) => ({ type: 'way', id: b.id, tags: b.tags, geometry: b.ring.map(([lon, lat]) => ({ lat, lon })) })),
  ],
};
const fetchImpl = (async () => new Response(JSON.stringify(overpass))) as unknown as typeof fetch;

const admin = await createAccessGrant(db, { campaignId: 'campaign_n', role: 'admin', teamId: null, label: 'tester' });
const viewer = await createAccessGrant(db, { campaignId: 'campaign_n', role: 'viewer', teamId: null, label: 'zuschauer' });
const cookies: Record<string, string> = {};
for (const [name, grant] of [['admin', admin.grant], ['viewer', viewer.grant]] as const) {
  const session = await createSessionForGrant(db, { ...grant, groupId: null, membershipId: null });
  cookies[name] = sessionCookie(session.sessionSecret).split(';')[0].split('=').slice(1).join('=');
}
fs.writeFileSync(new URL('./cookies.json', import.meta.url).pathname, JSON.stringify(cookies));

const dist = new URL('../../dist/client', import.meta.url).pathname;
const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:8140');
  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(chunks) });
    const response = await handleV5Api(request, db, { fetchImpl });
    if (!response) { res.writeHead(404); res.end(); return; }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
  }
  let file = path.join(dist, url.pathname === '/v5' ? '/v5.html' : url.pathname);
  try { const body = fs.readFileSync(file); res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8140, () => console.log('READY'));

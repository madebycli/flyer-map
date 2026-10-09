// End-to-end fixture server for the v5 field core: the real Worker handlers on an in-memory D1 plus the built client.
// Usage: npm run build && node --experimental-transform-types scripts/v5-e2e/server.ts, then node scripts/v5-e2e/flow.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { NetworkD1, seedNetwork } from '../../tests/helpers/networkD1.ts';
import { createAccessGrant, createSessionForGrant, sessionCookie } from '../../worker/access.ts';
import { collectionSessionCookie, createCollectionAccessLink, redeemCollectionAccess } from '../../worker/collectionAccess.ts';
import { handleV5Api } from '../../worker/v5/api.ts';
import baseWorker from '../../worker/indexFc52.ts'; // base Worker + the pickup (Sonder-Marker) layer, as in production
import { syntheticCity } from '../../src/v5/engine/synthetic.ts';

const BLOCKS = Number(process.env.CITY_BLOCKS ?? 12);
const db = new NetworkD1(false, true);
seedNetwork(db);
// Area polygon covering the synthetic city (origin 13.0/51.0, 12x12 blocks of 100 m, plus the extras below/left of it).
const M_LNG = 70_053, M_LAT = 110_574;
const ring = [[-300 / M_LNG, -400 / M_LAT], [(BLOCKS * 100 + 100) / M_LNG, -400 / M_LAT], [(BLOCKS * 100 + 100) / M_LNG, (BLOCKS * 100 + 100) / M_LAT], [-300 / M_LNG, (BLOCKS * 100 + 100) / M_LAT], [-300 / M_LNG, -400 / M_LAT]].map(([x, y]) => [13 + x, 51 + y]);
db.sqlite.prepare('UPDATE areas SET geometry_json=? WHERE id=?').run(JSON.stringify({ type: 'Polygon', coordinates: [ring] }), 'area_n');

const city = syntheticCity(BLOCKS, BLOCKS);
const overpass = {
  elements: [
    ...city.raw.ways.map((w) => ({ type: 'way', id: w.id, nodes: w.nodes, tags: w.tags, geometry: w.coords.map(([lon, lat]) => ({ lat, lon })) })),
    ...city.raw.buildings.map((b) => ({ type: 'way', id: b.id, tags: b.tags, geometry: b.ring.map(([lon, lat]) => ({ lat, lon })) })),
  ],
};
const fetchImpl = (async () => new Response(JSON.stringify(overpass))) as unknown as typeof fetch;
const pace = { clock: Date.now() };

const t0 = '2026-09-07T00:00:00.000Z';
db.sqlite.prepare("INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_o','campaign_n','Andere','#ef4444',?,?)").run(t0, t0);
db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_o','campaign_n','team_o','Fremdes Gebiet',?,?,?)")
  .run(JSON.stringify({ type: 'Polygon', coordinates: [[[13.2, 51.2], [13.21, 51.2], [13.21, 51.21], [13.2, 51.21], [13.2, 51.2]]] }), t0, t0);
const admin = await createAccessGrant(db, { campaignId: 'campaign_n', role: 'admin', teamId: null, label: 'tester' });
const viewer = await createAccessGrant(db, { campaignId: 'campaign_n', role: 'viewer', teamId: null, label: 'zuschauer' });
const cookies: Record<string, string> = {};
const editor = await createAccessGrant(db, { campaignId: 'campaign_n', role: 'team-editor', teamId: 'team_n', label: 'editor' });
for (const [name, grant] of [['admin', admin.grant], ['viewer', viewer.grant], ['editor', editor.grant]] as const) {
  const session = await createSessionForGrant(db, { ...grant });
  cookies[name] = sessionCookie(session.sessionSecret).split(';')[0].split('=').slice(1).join('=');
}
// Collection side (Abholaktion): a Sammelgebiet split into a west and an east Area, and two helpers who came in through the Abhol-Link.
{
  const link = await createCollectionAccessLink(db, 'campaign_n');
  const geo = (x0: number, x1: number) => JSON.stringify({ type: 'Polygon', coordinates: [[[x0, -400], [x1, -400], [x1, BLOCKS * 100 + 100], [x0, BLOCKS * 100 + 100], [x0, -400]].map(([x, y]) => [13 + x / M_LNG, 51 + y / M_LAT])] });
  const mid = Math.round((BLOCKS * 100) / 2);
  db.sqlite.prepare("INSERT INTO collection_main_areas(id,campaign_id,name,geometry_json,created_at,updated_at) VALUES('main','campaign_n','Sammelgebiet',?,?,?)").run(geo(-300, BLOCKS * 100 + 100), t0, t0);
  for (const [id, name, x0, x1] of [['c_west', 'West', -300, mid], ['c_east', 'Ost', mid, BLOCKS * 100 + 100]] as const) {
    db.sqlite.prepare("INSERT INTO collection_areas(id,campaign_id,main_area_id,name,geometry_json,color,status,run_id,claimed_by_collector_id,claimed_by_label,completed_at,created_at,updated_at) VALUES(?,'campaign_n','main',?,?,'#2563eb','open',NULL,NULL,NULL,NULL,?,?)").run(id, name, geo(x0, x1), t0, t0);
  }
  for (const name of ['alice', 'bob']) {
    const redeemed = (await redeemCollectionAccess(db, 'campaign_n', link.token))!;
    // alice may place and edit Sonder-Marker, bob only sees them
    if (name === 'alice') db.sqlite.prepare('UPDATE collection_collectors SET can_create_pickups=1, can_edit_pickups=1 WHERE id=?').run(redeemed.access.collectorId);
    cookies[name] = collectionSessionCookie(redeemed.sessionSecret).split(';')[0].split('=').slice(1).join('=');
  }
}
fs.writeFileSync(new URL('./cookies.json', import.meta.url).pathname, JSON.stringify(cookies));

const dist = new URL('../../dist/client', import.meta.url).pathname;
const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:8140');
  if (url.pathname === '/api/campaigns/campaign_n/snapshot') {
    // Legacy snapshot mock for the one-time progress import: 5 completed houses and one street fragment.
    const through = city.raw.ways.find((w) => w.id === 1000)!;
    const body = {
      houseTasks: Array.from({ length: 5 }, (_, i) => ({ status: 'completed', source: { objectType: 'way', objectIds: [5_000_000 + i] } })),
      tasks: [{ status: 'open', source: { objectType: 'way', objectIds: [1000] }, geometry: { type: 'LineString', coordinates: through.coords }, network: { length: BLOCKS * 100, coverage: [{ from: 0, to: 250, status: 'completed' }] } }],
    };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return;
  }
  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(chunks) });
    const response = await handleV5Api(request, db, { fetchImpl, maxAreaSqKm: 200, now: () => (pace.clock += 70_000) }); // each call counts as 70 s later, so build cooldowns never block the scripted flow
    // Everything that is not /api/v5 (area mutations, access info, version) runs through the real legacy Worker.
    const final = response ?? await baseWorker.fetch(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(chunks) }), { DB: db } as never);
    if (!final) { res.writeHead(404); res.end(); return; }
    res.writeHead(final.status, Object.fromEntries(final.headers)); res.end(Buffer.from(await final.arrayBuffer())); return;
  }
  let file = path.join(dist, url.pathname === '/v5' ? '/v5.html' : url.pathname === '/' ? '/index.html' : url.pathname);
  try { const body = fs.readFileSync(file); res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(body); }
  catch {
    // Like the Worker's assets (single-page-application): a path without a file extension is an app route served by index.html.
    if (!path.extname(url.pathname)) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(path.join(dist, 'index.html'))); return; }
    res.writeHead(404); res.end();
  }
}).listen(8140, () => console.log('READY'));

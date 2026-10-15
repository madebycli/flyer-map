// The garden-path rule on real OpenStreetMap data: for a few residential areas, derive the network with and without the rule and list the houses
// whose street changed. Public OSM data only; run by .github/workflows/real-osm-check.yml (the sandbox has no access to Overpass).
import { overpassQuery, packFromOverpass, deriveNetwork } from '../src/v5/engine/index.ts';

const AREAS = [
  ['Dresden-Gorbitz', [51.0385, 13.6620, 51.0445, 13.6720]],
  ['Leipzig-Grünau', [51.3040, 12.2700, 51.3100, 12.2800]],
  ['Hamburg-Steilshoop', [53.5960, 10.0660, 53.6020, 10.0760]],
  ['Berlin-Marzahn', [52.5400, 13.5600, 52.5460, 13.5700]],
  ['Münster-Kinderhaus', [51.9890, 7.6060, 51.9950, 7.6160]],
  ['Erfurt-Rieth', [50.9890, 11.0640, 50.9950, 11.0740]],
];
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOsm(bbox) {
  let last = 'no attempt';
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'flyer-map-real-osm-check/1 (engine test)' }, body: `data=${encodeURIComponent(overpassQuery(bbox))}`, signal: AbortSignal.timeout(90000) });
      if (res.ok) return await res.json();
      last = `${url} → ${res.status}`;
    } catch (e) { last = `${url} → ${e.message}`; }
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`Overpass not reachable: ${last}`);
}

const label = (way) => (way ? `${way.tags.highway}${way.tags.name ? ` "${way.tags.name}"` : ' (no name)'}` : '–');
let totals = { houses: 0, withStreet: 0, changed: 0, kept: 0, wrong: 0 };
for (const [name, bbox] of AREAS) {
  let osm;
  try { osm = await fetchOsm(bbox); } catch (e) { console.log(`${name}: SKIPPED (${e.message})`); continue; }
  const { raw, stats } = packFromOverpass(osm);
  const wayById = new Map(raw.ways.map((w) => [w.id, w]));
  const oldNet = deriveNetwork(raw, { gardenPathRule: false });
  const newNet = deriveNetwork(raw);
  const segWay = (net) => new Map(net.segments.map((s) => [s.id, wayById.get(s.wayId)]));
  const oldSeg = segWay(oldNet), newSeg = segWay(newNet);
  const oldHouse = new Map(oldNet.houses.map((h) => [h.id, h]));
  const changed = [];
  for (const h of newNet.houses) {
    const o = oldHouse.get(h.id);
    if (o && o.parent !== h.parent) changed.push({ h, from: oldSeg.get(o.parent), to: newSeg.get(h.parent) });
  }
  // a change is right when the house now sits on a way whose name is the street of its address
  const right = changed.filter((c) => c.to?.tags.name && c.h.street && c.to.tags.name.trim().toLowerCase() === c.h.street.trim().toLowerCase());
  console.log(`\n== ${name}: ${raw.ways.length} ways, ${raw.buildings.length} buildings, ${newNet.houses.length} houses (${newNet.houses.filter((h) => h.street).length} with an address street)`);
  console.log(`   rule kept ${newNet.diagnostics.keptFromPaths} houses on their named street; ${changed.length} houses changed parent; ${right.length} of them now on the street named in their address`);
  for (const c of changed.slice(0, 6)) console.log(`   · ${c.h.street ?? '?'} ${c.h.number ?? ''}: was ${label(c.from)} → now ${label(c.to)}`);
  totals.houses += newNet.houses.length; totals.withStreet += newNet.houses.filter((h) => h.street).length; totals.changed += changed.length; totals.kept += newNet.diagnostics.keptFromPaths; totals.wrong += changed.length - right.length;
  await sleep(3000);
}
console.log(`\nTOTAL houses ${totals.houses}, with address street ${totals.withStreet}, kept by the rule ${totals.kept}, changed parent ${totals.changed}, changed but NOT on the named street ${totals.wrong}`);
if (!totals.houses) { console.log('no area could be loaded'); process.exit(2); }

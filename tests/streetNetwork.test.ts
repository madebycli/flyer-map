import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoadNetwork, clipNetworkLines, associateHouses } from '../worker/streetNetwork/geometry.ts';
import { RoadIndex, networkRoutes, setCoverage, applyNetworkCoverage, networkProgress } from '../src/domain/streetNetwork.ts';
import type { HouseTask, PolygonGeometry } from '../src/domain/campaign.ts';

const area: PolygonGeometry = { type: 'Polygon', coordinates: [[[13, 51], [13.1, 51], [13.1, 51.1], [13, 51.1], [13, 51]]] };
const base = { area, campaignId: 'campaign_n', areaId: 'area_n', generation: 'generation1', timestamp: '2026-09-07T00:00:00Z' };
const roads = [
  { osmId: 1, tags: { highway: 'residential', name: 'Kurve' }, geometry: { type: 'LineString' as const, coordinates: [[13.01,51.01],[13.02,51.015],[13.03,51.01],[13.04,51.01]] as [number,number][] } },
  { osmId: 2, tags: { highway: 'residential', name: 'Abzweig' }, geometry: { type: 'LineString' as const, coordinates: [[13.03,51.01],[13.03,51.02]] as [number,number][] } },
];
test('T-junction splits at interior shared vertex and reverse roads retain IDs', async () => {
  const tasks = await buildRoadNetwork({ ...base, roads });
  assert.equal(tasks.length, 3);
  const reversed = await buildRoadNetwork({ ...base, roads: roads.map((road) => ({ ...road, geometry: { ...road.geometry, coordinates: [...road.geometry.coordinates].reverse() } })).reverse() });
  assert.deepEqual(reversed, tasks);
  const index = new RoadIndex(tasks);
  const start = index.candidates([13.015,51.0125])[0], end = index.candidates([13.03,51.015])[0];
  const routes = networkRoutes(tasks, start, end);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].ranges.length, 2);
  assert.ok(routes[0].geometry.coordinates.some((p) => p[0] === 13.02));
  const reverse = networkRoutes(tasks, end, start)[0];
  assert.ok(Math.abs(reverse.length - routes[0].length) < 0.001);
  assert.ok(routes[0].ranges.every((range) => Math.abs(range.to - range.from) < tasks.find((t) => t.id === range.taskId)!.network!.length));
});
test('interval replacement is direction invariant and preserves unrelated coverage', () => {
  const initial = setCoverage([], 10, 40, 'completed', 100);
  assert.deepEqual(setCoverage(initial, 30, 20, 'later', 100), [{ from:10,to:20,status:'completed' },{from:20,to:30,status:'later'},{from:30,to:40,status:'completed'}]);
  assert.deepEqual(setCoverage(initial, 40, 10, 'completed', 100), initial);
  assert.deepEqual(setCoverage(initial, 15, 30, 'open', 100), [{from:10,to:15,status:'completed'},{from:30,to:40,status:'completed'}]);
});
test('JSTS clips MultiLine and collections, rejects self-intersecting polygons and discards point touches', () => {
  assert.equal(clipNetworkLines({type:'GeometryCollection', geometries:[{type:'MultiLineString',coordinates:[[[12.9,51.05],[13.2,51.05]],[[12.9,51],[13,51]]]}]},area).length,1);
  assert.throws(() => clipNetworkLines(roads[0].geometry, {type:'Polygon',coordinates:[[[13,51],[13.1,51.1],[13,51.1],[13.1,51],[13,51]]]}), /input_validation/);
});
test('houses propagate only in range; manual exceptions and individual house progress remain independent', async () => {
  const tasks = await buildRoadNetwork({...base,roads});
  const task = tasks[0];
  const houses = [10,20,30,40].map((measure,i):HouseTask => ({id:`house_${i}`,campaignId:base.campaignId,areaId:base.areaId,taskType:'house',label:'Haus',geometry:area,parentStreetTaskId:task.id,roadPosition:{measure,confidence:'nearby'},status:i===2?'later':'open',completedAt:null,createdAt:base.timestamp,updatedAt:base.timestamp}));
  const next = applyNetworkCoverage(tasks,houses,[{taskId:task.id,from:15,to:35}],'completed',base.timestamp);
  assert.deepEqual(next.houseTasks.map((h)=>h.status),['open','completed','later','open']);
  assert.equal(networkProgress(next.tasks,next.houseTasks).percent,25);
  assert.equal(next.tasks.find((t)=>t.id===task.id)!.status,'open');
});
test('1000 and 5000 house corpus uses spatial candidates with reproducible assignments', async (t) => {
  for (const count of [1000,5000]) {
    const begin = performance.now();
    const synthetic = Array.from({length:100},(_,i)=>({osmId:i+100,tags:{highway:'residential',name:`Road ${i}`},geometry:{type:'LineString' as const,coordinates:[[13.001+i*0.0008,51.001],[13.001+i*0.0008,51.09]] as [number,number][]}}));
    const tasks = await buildRoadNetwork({...base,roads:synthetic});
    const graphMs = performance.now()-begin;
    const houses = Array.from({length:count},(_,i):HouseTask=>{
      const x=13.001+(i%100)*0.0008+0.0001, y=51.002+Math.floor(i/100)*0.0015;
      return {id:`house_${i}`,campaignId:base.campaignId,areaId:base.areaId,taskType:'house',label:'Haus',geometry:{type:'Polygon',coordinates:[[[x,y],[x+0.00003,y],[x+0.00003,y+0.00003],[x,y+0.00003],[x,y]]]},parentStreetTaskId:null,status:'open',completedAt:null,createdAt:base.timestamp,updatedAt:base.timestamp};
    });
    const linkBegin=performance.now();
    const linked=associateHouses(tasks,houses);
    assert.equal(linked.filter((h)=>h.parentStreetTaskId).length,count);
    t.diagnostic(JSON.stringify({houses:count,roads:tasks.length,graphMs,houseLinkMs:performance.now()-linkBegin,totalMs:performance.now()-begin}));
  }
});

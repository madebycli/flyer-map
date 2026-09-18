import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { planStreetEngineV4Coverage, type StreetEngineV4CoveragePoint } from '../src/domain/streetEngineV4Coverage.ts';

const [, , inputArg, outputArg = '/tmp/street-engine-v4-source-meta.json'] = process.argv;
if (!inputArg) {
  console.error('usage: node --experimental-transform-types scripts/plan-street-engine-v4-coverage.ts <wrangler-areas.json> [output.json]');
  process.exit(2);
}

const raw = JSON.parse(await readFile(resolve(inputArg), 'utf8')) as unknown;
const envelopes = Array.isArray(raw) ? raw : [raw];
const rows = envelopes.flatMap((value) => {
  if (!value || typeof value !== 'object') return [];
  const results = (value as { results?: unknown }).results;
  return Array.isArray(results) ? results : [];
}) as Array<{ id: string; name: string; geometry_json: string; updated_at: string; campaign_id: string }>;

if (!rows.length) throw new Error('street_engine_v4_no_beta_areas');
const campaignIds = [...new Set(rows.map((row) => row.campaign_id))];
if (campaignIds.length !== 1 || !campaignIds[0]) throw new Error('street_engine_v4_beta_campaign_ambiguous');

const points: StreetEngineV4CoveragePoint[] = [];
const collect = (value: unknown) => {
  if (Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number') {
    points.push([value[0], value[1]]);
    return;
  }
  if (Array.isArray(value)) value.forEach(collect);
};
for (const row of rows) {
  const geometry = JSON.parse(row.geometry_json) as { coordinates?: unknown };
  collect(geometry.coordinates);
}

const plan = planStreetEngineV4Coverage(points);
const areas = rows.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updated_at }));
const meta = {
  engineVersion: 'v4',
  campaignId: campaignIds[0],
  areaCount: rows.length,
  areas,
  areaIds: areas.map((area) => area.id),
  areaNames: areas.map((area) => area.name),
  bbox: plan.bboxText,
  cellCount: plan.cellCount,
  coveragePolicy: plan.policy,
  gridCellDegrees: plan.gridCellDegrees,
  reserveCells: plan.reserveCells,
  reserveDegrees: plan.reserveDegrees,
};
await writeFile(resolve(outputArg), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta));

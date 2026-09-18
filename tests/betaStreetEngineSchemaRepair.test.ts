import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/beta-release.yml', 'utf8');
const repairSql = readFileSync('scripts/beta-streetengine-schema-repair.sql', 'utf8');

test('Beta release repairs and verifies the StreetEngine schema before deploy', () => {
  const repairStep = workflow.indexOf('Repair and verify Beta StreetEngine schema');
  const sourcePackStep = workflow.indexOf('Build and stage Street Engine V4 source pack as Worker assets');
  const deployStep = workflow.indexOf('Build and deploy exact Beta V4 source directly');
  assert.ok(repairStep >= 0, 'missing Beta StreetEngine schema repair step');
  assert.ok(sourcePackStep > repairStep, 'V4 source pack must stage after schema repair');
  assert.ok(deployStep > sourcePackStep, 'schema repair and V4 source-pack staging must run before Beta deploy');
  assert.match(workflow, /BETA_DB_NAME: flyer-map-beta-db/u);
  assert.match(workflow, /public\/__street-engine-v4/u);
  assert.match(workflow, /dist\/client\/__street-engine-v4/u);
  assert.match(workflow, /V4_BBOX="\$\(jq -er '[^']*' \/tmp\/street-engine-v4-source-meta\.json\)"/u);
  assert.match(workflow, /export V4_BBOX V4_CAMPAIGN_ID/u);
  assert.doesNotMatch(workflow, /wrangler r2|BETA_STREET_ENGINE_V4_BUCKET|STREET_ENGINE_V4_SOURCE/u);
  assert.match(workflow, /STREET_ENGINE_VERSION:'v4'/u);
  assert.match(workflow, /delete c\.vars\.OSM_OVERPASS_URL/u);
  assert.match(workflow, /\[\[ "\$BETA_D1_ID" != "\$PROD_D1_ID" \]\]/u);
  assert.match(workflow, /\[\[ "\$BETA_D1_ID" != "\$RXDB_STAGING_D1_ID" \]\]/u);
  assert.match(workflow, /ALTER TABLE tasks ADD COLUMN area_preparation_generation TEXT/u);
  assert.match(workflow, /ALTER TABLE house_tasks ADD COLUMN area_preparation_generation TEXT/u);
  assert.match(workflow, /beta-streetengine-schema-summary\.json/u);
});

test('Beta repair SQL contains the complete 0014 and 0022 StreetEngine gate', () => {
  for (const table of [
    'area_task_preparations',
    'street_network_state',
    'house_road_positions',
    'street_network_jobs',
    'street_network_staging',
    'street_network_intents',
  ]) {
    assert.match(repairSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'u'));
  }
  assert.match(repairSql, /CREATE INDEX IF NOT EXISTS idx_tasks_campaign_area_preparation_generation/u);
  assert.match(repairSql, /CREATE INDEX IF NOT EXISTS idx_house_tasks_campaign_area_preparation_generation/u);
});

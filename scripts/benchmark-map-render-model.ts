import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { colorAreaEntities, createAreaRenderIndex } from '../src/map/renderModel.ts';
import { darkenHexColor } from '../src/domain/color.ts';
import type { Area, Team } from '../src/domain/campaign.ts';

// Baseline: App.tsx on beta@6037756. Measures CPU joins/coloring only, no
// React, RxDB, MapLibre, network or device FPS. Same inputs for both variants.
const samples = 15;
const results = [];
for (const [entities, areaCount] of [[1_000, 1], [20_000, 32], [101_935, 1], [101_935, 256]]) {
  const teams = Array.from({ length: 16 }, (_, i) => ({ id: `team_${i}`, color: '#2563eb' })) as Team[];
  const areas = Array.from({ length: areaCount }, (_, i) => ({ id: `area_${i}`, teamId: teams[i % teams.length].id })) as Area[];
  const rows = Array.from({ length: entities }, (_, i) => ({ id: `entity_${i}`, areaId: areas[i % areaCount].id,
    status: 'open', geometry: { type: 'LineString', coordinates: [[13, 51], [13.01, 51.01]] } }));
  const baseline = () => rows.map((row) => {
    const area = areas.find((a) => a.id === row.areaId);
    const team = area ? teams.find((t) => t.id === area.teamId) : null;
    const color = team?.color ?? '#64748b';
    return { ...row, color, completedColor: darkenHexColor(color, 0.25) };
  });
  // Include index rebuilding on every sample: this also covers a cold read model.
  const candidate = () => colorAreaEntities(rows, createAreaRenderIndex(areas, teams));
  assert.deepEqual(candidate(), baseline());
  const durations = { baseline: [] as number[], candidate: [] as number[] };
  for (let sample = -5; sample < samples; sample++) {
    const order = sample % 2 ? ['candidate', 'baseline'] as const : ['baseline', 'candidate'] as const;
    for (const variant of order) {
      const started = performance.now();
      const output = variant === 'baseline' ? baseline() : candidate();
      const elapsed = performance.now() - started;
      assert.equal(output.length, entities);
      if (sample >= 0) durations[variant].push(elapsed);
    }
  }
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], rawMs: values };
  };
  results.push({ entities, areas: areaCount, teams: teams.length, baseline: stats(durations.baseline), candidate: stats(durations.candidate), equivalent: true });
}
const report = { at: new Date().toISOString(), baseline: '603775645a07c1587df6b3cae21e35836a6de81c',
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
  method: 'synthetic in-memory joins and coloring; 5 warmups, 15 alternating samples, index construction included; no browser/cache/IO/FPS claim', results };
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(JSON.stringify(report));

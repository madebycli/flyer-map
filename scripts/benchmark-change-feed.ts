import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import type { CampaignSnapshot } from '../src/domain/campaign.ts';
import { rxdbChangeFeedEntriesForMutation as candidate } from '../worker/rxdbChangeFeed.ts';

// Pass the unchanged worker module from a detached Beta worktree as argument 3.
const { rxdbChangeFeedEntriesForMutation: baseline } = await import(pathToFileURL(process.argv[3]).href);
const stamp = '2026-10-07T00:00:00Z';
const results = [];
for (const count of [1_000, 10_000]) {
  const before: CampaignSnapshot = { schemaVersion: 3, revision: 1,
    campaign: { id: 'campaign', name: 'Synthetic', status: 'active', defaultMapView: null, createdAt: stamp, updatedAt: stamp },
    teams: [], areas: [], houseTasks: [], tasks: Array.from({ length: count }, (_, i) => ({
      id: `task_${i}`, campaignId: 'campaign', areaId: 'area', taskType: 'street', label: 'Synthetic',
      geometry: { type: 'LineString', coordinates: [[13, 51], [13.001, 51.001]] },
      status: 'open', completedAt: null, createdAt: stamp, updatedAt: stamp,
    })) };
  const after = { ...before, tasks: before.tasks.map(task => ({ ...task })) };
  after.tasks[count - 1] = { ...after.tasks[count - 1], status: 'completed', completedAt: stamp };
  const mutation = { id: 'synthetic-mutation', campaignId: 'campaign', baseRevision: 1, createdAt: stamp,
    type: 'house.set-status' as const, payload: { taskId: 'absent-house', status: 'completed' as const, completedAt: stamp, expectedUpdatedAt: stamp } };
  assert.deepEqual(candidate(before, after, mutation), baseline(before, after, mutation));
  const timings: Record<string, number[]> = { baseline: [], candidate: [] };
  for (const fn of [baseline, candidate]) fn(before, after, mutation);
  for (let sample = 0; sample < 3; sample++) {
    for (const [name, fn] of [['baseline', baseline], ['candidate', candidate]] as const) {
      const start = performance.now(); fn(before, after, mutation);
      timings[name].push(performance.now() - start);
    }
  }
  const stats = (values: number[]) => ({ medianMs: [...values].sort((a, b) => a - b)[1], rawMs: values });
  results.push({ streets: count, equivalent: true, baseline: stats(timings.baseline), candidate: stats(timings.candidate) });
}
const report = { at: new Date().toISOString(), baseline: '603775645a07c1587df6b3cae21e35836a6de81c',
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
  method: 'full feed function, synthetic unchanged Street snapshot plus one automated parent delta; empty House/Area collections isolate comparison; 1 warmup, 3 alternating samples; no D1/HTTP/cloud billing claim', results };
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(JSON.stringify(report));

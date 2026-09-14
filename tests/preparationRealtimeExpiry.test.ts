import assert from "node:assert/strict";
import test from "node:test";
import { CampaignSyncDurableObject, type CampaignSyncWebSocket } from "../worker/campaignSyncDurableObject.ts";

const area = {
  id: "area_progress",
  campaignId: "campaign_progress",
  teamId: "team_progress",
  name: "Area",
  geometry: { type: "Polygon" as const, coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]] },
  createdAt: "2026-09-14T18:00:00.000Z",
  updatedAt: "2026-09-14T18:00:00.000Z",
};

const progress = {
  status: "pending" as const,
  roadCount: 12,
  houseCount: 34,
  sourceTimestamp: null,
  errorCode: null,
  updatedAt: "2026-09-14T18:01:00.000Z",
  progress: {
    phase: "buildings",
    totalTiles: 8,
    completedRoadTiles: 8,
    completedBuildingTiles: 3,
    processedBuildings: 0,
    totalBuildings: 0,
    percent: 51,
  },
};

test("expired preparation sockets are closed so the authenticated client reconnects", () => {
  const sent: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const expired: CampaignSyncWebSocket = {
    deserializeAttachment: () => ({ teamId: "team_progress", expiresAt: Date.now() - 1 }),
    send: (value) => sent.push("expired:" + value),
    close: (code, reason) => closed.push({ code, reason }),
  };
  const valid: CampaignSyncWebSocket = {
    deserializeAttachment: () => ({ teamId: "team_progress", expiresAt: Date.now() + 60_000 }),
    send: (value) => sent.push(value),
  };
  const state = {
    storage: {
      async get() { return undefined; },
      async put() {},
      async setAlarm() {},
      async getAlarm() { return null; },
      async deleteAlarm() {},
    },
    acceptWebSocket() {},
    getWebSockets: () => [expired, valid],
  };
  const worker = new CampaignSyncDurableObject(state, { DB: {} });
  const runner = (worker as unknown as { runner: { options: { onProgress?: (areaValue: typeof area, stateValue: typeof progress) => void } } }).runner;

  runner.options.onProgress?.(area, progress);

  assert.deepEqual(closed, [{ code: 4001, reason: "scope_expired" }]);
  assert.equal(sent.some((value) => value.startsWith("expired:")), false, "expired socket must not receive progress");
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(sent[0]), { type: "preparation", areaId: area.id, state: progress });
});

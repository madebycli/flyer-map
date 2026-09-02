import assert from "node:assert/strict";
import test from "node:test";

function missionTrafficModel(input: {
  clients: number;
  hours: number;
  changedDocuments: number;
  pullBatchSize: number;
  pushBatchSize: number;
  collections: number;
  safetySeconds: number;
}) {
  const safetyCheckpointRequests = Math.ceil((input.clients * input.hours * 3_600) / input.safetySeconds);
  const bootstrapPullRequests = input.clients * input.collections;
  const incrementalPullRequests = Math.ceil(input.changedDocuments / input.pullBatchSize);
  const pushRequests = Math.ceil(input.changedDocuments / input.pushBatchSize);
  const websocketConnections = input.clients;
  const invalidationFrames = input.clients * input.changedDocuments;
  return {
    safetyCheckpointRequests,
    bootstrapPullRequests,
    incrementalPullRequests,
    pushRequests,
    websocketConnections,
    invalidationFrames,
  };
}

test("50-60 client sanity model follows the implemented batch/checkpoint limits", () => {
  const model = missionTrafficModel({
    clients: 60,
    hours: 8,
    changedDocuments: 5_000,
    pullBatchSize: 100,
    pushBatchSize: 20,
    collections: 5,
    safetySeconds: 45,
  });
  assert.deepEqual(model, {
    safetyCheckpointRequests: 38_400,
    bootstrapPullRequests: 300,
    incrementalPullRequests: 50,
    pushRequests: 250,
    websocketConnections: 60,
    invalidationFrames: 300_000,
  });
  // The important property is one lightweight checkpoint per Campaign/client
  // interval, not one timer or full snapshot per collection.
  assert.ok(model.safetyCheckpointRequests < 40_000);
  assert.equal(model.websocketConnections, 60);
});


import assert from "node:assert/strict";
import test from "node:test";
import {
  MutationQueue,
  type MutationQueueStorage,
  type QueuedCampaignMutation,
} from "../src/data/mutationQueue.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";

class MemoryQueueStorage implements MutationQueueStorage {
  readonly records = new Map<string, QueuedCampaignMutation>();

  async getAll() {
    return [...this.records.values()];
  }

  async put(record: QueuedCampaignMutation) {
    this.records.set(record.id, structuredClone(record));
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}

function mutation(id: string): CampaignMutation {
  return {
    id,
    campaignId: "campaign_queue-state-test",
    type: "campaign.rename",
    payload: { name: "Neu", expectedName: "Alt" },
    baseRevision: 7,
    createdAt: "2026-08-25T20:50:00.000Z",
  };
}

test("authorization-blocked queued work remains blocked after a queue reload", async () => {
  const storage = new MemoryQueueStorage();
  const firstQueue = new MutationQueue(storage);
  await firstQueue.enqueue(mutation("mutation_blocked-auth"));

  const [record] = await firstQueue.list("campaign_queue-state-test");
  await firstQueue.update({
    ...record,
    state: "blocked-auth",
    attemptCount: 1,
    lastError: "access revoked",
  });

  const reloadedQueue = new MutationQueue(storage);
  const [reloaded] = await reloadedQueue.list("campaign_queue-state-test");

  assert.equal(reloaded.state, "blocked-auth");
  assert.equal(reloaded.attemptCount, 1);
  assert.equal(reloaded.lastError, "access revoked");
  assert.deepEqual(reloaded.mutation, record.mutation);
});

test("transient retry metadata remains durable across a queue reload", async () => {
  const storage = new MemoryQueueStorage();
  const firstQueue = new MutationQueue(storage);
  await firstQueue.enqueue(mutation("mutation_retry"));

  const [record] = await firstQueue.list("campaign_queue-state-test");
  await firstQueue.update({
    ...record,
    state: "retry",
    attemptCount: 3,
    nextAttemptAt: 123_456,
    lastError: "temporary upstream failure",
  });

  const reloadedQueue = new MutationQueue(storage);
  const [reloaded] = await reloadedQueue.list("campaign_queue-state-test");

  assert.equal(reloaded.state, "retry");
  assert.equal(reloaded.attemptCount, 3);
  assert.equal(reloaded.nextAttemptAt, 123_456);
  assert.equal(reloaded.lastError, "temporary upstream failure");
});

test("acknowledged queued work stays removed after a queue reload", async () => {
  const storage = new MemoryQueueStorage();
  const firstQueue = new MutationQueue(storage);
  const queued = await firstQueue.enqueue(mutation("mutation_acknowledged"));

  await firstQueue.remove(queued.id);

  const reloadedQueue = new MutationQueue(storage);
  assert.deepEqual(await reloadedQueue.list("campaign_queue-state-test"), []);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MutationQueue,
  type MutationQueueStorage,
  type QueuedCampaignMutation,
} from "../src/data/mutationQueue.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";

class JsonFileQueueStorage implements MutationQueueStorage {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async readAll() {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as QueuedCampaignMutation[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async getAll() {
    return this.readAll();
  }

  async put(record: QueuedCampaignMutation) {
    const records = await this.readAll();
    const next = records.filter((candidate) => candidate.id !== record.id);
    next.push(record);
    await writeFile(this.filePath, JSON.stringify(next), "utf8");
  }

  async delete(id: string) {
    const records = await this.readAll();
    await writeFile(
      this.filePath,
      JSON.stringify(records.filter((record) => record.id !== id)),
      "utf8",
    );
  }
}

function renameMutation(id: string, baseRevision: number, createdAt: string): CampaignMutation {
  return {
    id,
    campaignId: "campaign_queue-test",
    type: "campaign.rename",
    payload: { name: `Name ${baseRevision}`, expectedName: "Vorher" },
    baseRevision,
    createdAt,
  };
}

test("durable mutation queue survives a storage reload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flyer-map-queue-"));
  const filePath = path.join(directory, "queue.json");

  try {
    const firstQueue = new MutationQueue(new JsonFileQueueStorage(filePath));
    const mutation = renameMutation(
      "mutation_reload-1",
      4,
      "2026-08-24T10:00:00.000Z",
    );
    await firstQueue.enqueue(mutation);

    const reloadedQueue = new MutationQueue(new JsonFileQueueStorage(filePath));
    const records = await reloadedQueue.list(mutation.campaignId);

    assert.equal(records.length, 1);
    assert.deepEqual(records[0].mutation, mutation);
    assert.equal(records[0].state, "pending");
    assert.equal(records[0].attemptCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("queue preserves dependency order by local base revision", async () => {
  const records = new Map<string, QueuedCampaignMutation>();
  const storage: MutationQueueStorage = {
    async getAll() {
      return [...records.values()];
    },
    async put(record) {
      records.set(record.id, record);
    },
    async delete(id) {
      records.delete(id);
    },
  };
  const queue = new MutationQueue(storage);

  await queue.enqueue(renameMutation("mutation_third", 3, "2026-08-24T10:00:00.000Z"));
  await queue.enqueue(renameMutation("mutation_first", 1, "2026-08-24T10:00:02.000Z"));
  await queue.enqueue(renameMutation("mutation_second", 2, "2026-08-24T10:00:01.000Z"));

  const ordered = await queue.list("campaign_queue-test");
  assert.deepEqual(
    ordered.map((record) => record.mutation.baseRevision),
    [1, 2, 3],
  );
});

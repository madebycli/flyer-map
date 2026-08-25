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

const EMERGENCY_RECORD_KEY = "verteil-flyer:m5-mutation-emergency";

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

function installFakeWindowStorage(options?: {
  failWrites?: boolean;
  initial?: Iterable<readonly [string, string]>;
}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>(options?.initial);
  const localStorage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (options?.failWrites) throw new Error("localStorage unavailable");
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  return {
    values,
    restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
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

test("failed durable enqueue is recovered from the emergency local shadow on next list", async () => {
  const fakeWindow = installFakeWindowStorage();
  const mutation = renameMutation(
    "mutation_emergency-1",
    9,
    "2026-08-25T14:30:00.000Z",
  );

  try {
    const failingStorage: MutationQueueStorage = {
      async getAll() {
        return [];
      },
      async put() {
        throw new Error("IndexedDB write unavailable");
      },
      async delete() {},
    };
    const firstQueue = new MutationQueue(failingStorage);
    await assert.rejects(() => firstQueue.enqueue(mutation), /IndexedDB write unavailable/);

    const recovered = new Map<string, QueuedCampaignMutation>();
    const recoveredStorage: MutationQueueStorage = {
      async getAll() {
        return [...recovered.values()];
      },
      async put(record) {
        recovered.set(record.id, record);
      },
      async delete(id) {
        recovered.delete(id);
      },
    };

    const reloadedQueue = new MutationQueue(recoveredStorage);
    const records = await reloadedQueue.list(mutation.campaignId);

    assert.equal(records.length, 1);
    assert.equal(records[0].id, mutation.id);
    assert.deepEqual(records[0].mutation, mutation);
    assert.equal(fakeWindow.values.has(EMERGENCY_RECORD_KEY), false);
  } finally {
    fakeWindow.restore();
  }
});

test("localStorage emergency shadow failure does not block a successful IndexedDB enqueue", async () => {
  const fakeWindow = installFakeWindowStorage({ failWrites: true });
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
  const mutation = renameMutation(
    "mutation_no-shadow-1",
    12,
    "2026-08-25T14:31:00.000Z",
  );

  try {
    const queue = new MutationQueue(storage);
    await queue.enqueue(mutation);
    const listed = await queue.list(mutation.campaignId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, mutation.id);
  } finally {
    fakeWindow.restore();
  }
});

test("corrupt emergency shadow is quarantined instead of blocking the queue forever", async () => {
  const fakeWindow = installFakeWindowStorage({
    initial: [[EMERGENCY_RECORD_KEY, "{not valid json"]],
  });
  const storage: MutationQueueStorage = {
    async getAll() {
      return [];
    },
    async put() {},
    async delete() {},
  };

  try {
    const queue = new MutationQueue(storage);
    await assert.rejects(
      () => queue.list("campaign_queue-test"),
      /Emergency mutation record could not be restored/,
    );
    assert.equal(fakeWindow.values.has(EMERGENCY_RECORD_KEY), false);
    assert.deepEqual(await queue.list("campaign_queue-test"), []);
  } finally {
    fakeWindow.restore();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createRxDatabase } from "rxdb";
import { replicateRxCollection } from "rxdb/plugins/replication";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";

test("one pull page may contain multiple ordered writes for the same document", async () => {
  const db = await createRxDatabase({
    name: `rxdb-duplicate-pull-${crypto.randomUUID().replaceAll("-", "")}`,
    storage: getRxStorageMemory(),
    multiInstance: false,
    eventReduce: true,
  });
  const { docs } = await db.addCollections({
    docs: {
      schema: {
        version: 0,
        primaryKey: "id",
        type: "object",
        properties: {
          id: { type: "string", maxLength: 200 },
          value: { type: "string" },
        },
        required: ["id", "value"],
        additionalProperties: false,
      },
    },
  });
  let firstPage = true;
  const errors: unknown[] = [];
  const replication = replicateRxCollection<{ id: string; value: string }, { seq: number }>({
    replicationIdentifier: `duplicate-pull-${crypto.randomUUID()}`,
    collection: docs,
    pull: {
      batchSize: 20,
      handler: async (checkpoint) => {
        if (firstPage) {
          firstPage = false;
          return {
            documents: [
              { id: "same", value: "first" },
              { id: "same", value: "second" },
            ],
            checkpoint: { seq: 2 },
          };
        }
        return { documents: [], checkpoint: checkpoint ?? { seq: 2 } };
      },
    },
    live: false,
    retryTime: 20,
    waitForLeadership: false,
  });
  const subscription = replication.error$.subscribe((error) => errors.push(error));
  try {
    await Promise.race([
      replication.awaitInitialReplication(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("duplicate_pull_timeout")), 2_000)),
    ]);
    const document = await docs.findOne("same").exec();
    assert.equal(document?.get("value"), "second");
    assert.deepEqual(errors, []);
  } finally {
    subscription.unsubscribe();
    await replication.cancel().catch(() => undefined);
    await db.close().catch(() => undefined);
  }
});

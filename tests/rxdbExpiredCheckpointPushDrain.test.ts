import assert from "node:assert/strict";
import test from "node:test";
import { createRxDatabase, type RxCollection, type RxDatabase, type RxJsonSchema } from "rxdb";
import { replicateRxCollection } from "rxdb/plugins/replication";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";

type ProofDoc = { id: string; value: string };
type ProofCheckpoint = { seq: number };

const schema: RxJsonSchema<ProofDoc> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    value: { type: "string" },
  },
  required: ["id", "value"],
  additionalProperties: false,
};

async function openDatabase(name: string, storage: ReturnType<typeof getRxStorageMemory>) {
  const database = await createRxDatabase({ name, storage, multiInstance: false, eventReduce: true });
  const collections = await database.addCollections({ docs: { schema } });
  return { database, collection: collections.docs as RxCollection<ProofDoc> };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

test("RxDB 17.5 can drain a durable pending push after restart even when the pull checkpoint is expired", async () => {
  const storage = getRxStorageMemory();
  const databaseName = `expired-push-drain-${crypto.randomUUID().replaceAll("-", "")}`;
  const replicationIdentifier = `expired-push-drain:${databaseName}`;
  const server = new Map<string, ProofDoc>();
  let serverSeq = 0;
  let pushOnline = true;
  let expirePull = false;
  let failedPushAttempts = 0;

  const pull = {
    batchSize: 10,
    handler: async (_checkpoint: ProofCheckpoint | undefined) => {
      if (expirePull) {
        const error = new Error("rxdb_checkpoint_expired") as Error & { code?: string; status?: number };
        error.code = "rxdb_checkpoint_expired";
        error.status = 409;
        throw error;
      }
      return { documents: [...server.values()], checkpoint: { seq: serverSeq } };
    },
  };

  const push = {
    batchSize: 10,
    handler: async (rows: Array<{ newDocumentState: ProofDoc & { _deleted?: boolean } }>) => {
      if (!pushOnline) {
        failedPushAttempts += 1;
        throw new Error("offline");
      }
      for (const row of rows) {
        if (row.newDocumentState._deleted) server.delete(row.newDocumentState.id);
        else server.set(row.newDocumentState.id, { id: row.newDocumentState.id, value: row.newDocumentState.value });
        serverSeq += 1;
      }
      return [];
    },
  };

  let first: RxDatabase | null = null;
  let second: RxDatabase | null = null;
  try {
    const openedFirst = await openDatabase(databaseName, storage);
    first = openedFirst.database;
    const firstReplication = replicateRxCollection<ProofDoc, ProofCheckpoint>({
      replicationIdentifier,
      collection: openedFirst.collection,
      pull,
      push,
      live: true,
      retryTime: 25,
      waitForLeadership: false,
    });
    await withTimeout(firstReplication.awaitInitialReplication(), 2_000, "initial_replication_timeout");

    pushOnline = false;
    await openedFirst.collection.upsert({ id: "doc_a", value: "offline-write" });
    firstReplication.reSync();
    await withTimeout((async () => {
      while (failedPushAttempts === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    })(), 2_000, "offline_push_was_not_attempted");
    assert.equal(server.has("doc_a"), false);

    await firstReplication.cancel();
    await first.close();
    first = null;

    const openedSecond = await openDatabase(databaseName, storage);
    second = openedSecond.database;
    const persisted = await openedSecond.collection.findOne("doc_a").exec();
    assert.equal(persisted?.toJSON().value, "offline-write", "the local pending write must survive the simulated browser restart");

    expirePull = true;
    pushOnline = false;
    const expiredReplication = replicateRxCollection<ProofDoc, ProofCheckpoint>({
      replicationIdentifier,
      collection: openedSecond.collection,
      pull,
      push,
      live: true,
      retryTime: 25,
      waitForLeadership: false,
    });
    const expiredError = await withTimeout(new Promise<unknown>((resolve) => {
      const subscription = expiredReplication.error$.subscribe((error) => {
        subscription.unsubscribe();
        resolve(error);
      });
    }), 2_000, "expired_pull_error_timeout");
    assert.ok(expiredError, "the restarted combined replication must observe the expired pull failure");
    await expiredReplication.cancel();

    pushOnline = true;
    const drainReplication = replicateRxCollection<ProofDoc, ProofCheckpoint>({
      replicationIdentifier,
      collection: openedSecond.collection,
      push,
      live: true,
      retryTime: 25,
      waitForLeadership: false,
    });
    await withTimeout(drainReplication.awaitInSync(), 3_000, "push_only_drain_timeout");
    assert.deepEqual(server.get("doc_a"), { id: "doc_a", value: "offline-write" });
    await drainReplication.cancel();
  } finally {
    if (first) await first.close();
    if (second) await second.close();
  }
});

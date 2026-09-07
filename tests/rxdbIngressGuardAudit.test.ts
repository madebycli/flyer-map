import assert from "node:assert/strict";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike } from "../worker/campaignRepository.ts";
import { handleRxdbPush } from "../worker/rxdbSync.ts";

const campaignId = "campaign_ingress_audit";

function access(role: AccessContext["role"], teamId: string | null = null): AccessContext {
  return {
    grantId: `grant_${role}`,
    campaignId,
    role,
    teamId,
    label: "Audit",
    ...(role === "field-group-member" ? { groupId: "group_a", membershipId: "membership_a" } : {}),
  };
}

function untouchedDb(): D1DatabaseLike {
  return new Proxy({}, {
    get() {
      throw new Error("request must be rejected before D1 access");
    },
  }) as D1DatabaseLike;
}

class SchemaOnlyDb implements D1DatabaseLike {
  canonicalQueries = 0;
  schemaQueries = 0;

  prepare(query: string) {
    const isSchema = query.includes("PRAGMA table_info(campaign_sync_changes)");
    if (isSchema) this.schemaQueries += 1;
    else this.canonicalQueries += 1;
    const statement = {
      bind() { return statement; },
      async first<T>() { return null as T | null; },
      async all<T>() {
        if (!isSchema) return { results: [] as T[] };
        return {
          results: [
            "seq",
            "campaign_id",
            "collection_name",
            "document_id",
            "operation",
            "scope_team_id",
            "document_json",
            "changed_at",
          ].map((name) => ({ name })) as T[],
        };
      },
    };
    return statement;
  }

  async batch() {
    throw new Error("schema-only audit DB must never write");
  }
}

test("viewer RxDB push is rejected before any D1 schema or canonical access", async () => {
  const response = await handleRxdbPush(
    untouchedDb(),
    campaignId,
    "streetTasks",
    access("viewer"),
    { rows: [] },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: { code: "viewer_read_only", message: "Read-only Viewer dürfen nichts verändern." },
  });
});

test("field-group member without canonical team is rejected before D1 access", async () => {
  const response = await handleRxdbPush(
    untouchedDb(),
    campaignId,
    "streetTasks",
    access("field-group-member", null),
    { rows: [] },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "field_group_scope_forbidden",
      message: "Temporäre Gruppenmitglieder benötigen ein kanonisches Team.",
    },
  });
});

test("foreign-campaign RxDB document is rejected before canonical campaign reads", async () => {
  const db = new SchemaOnlyDb();
  const response = await handleRxdbPush(
    db,
    campaignId,
    "streetTasks",
    access("admin"),
    {
      rows: [{
        newDocumentState: {
          id: "task_foreign",
          campaignId: "campaign_other",
        },
      }],
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "invalid_rxdb_document",
      message: "RxDB-Dokument gehört nicht zur angeforderten Campaign.",
    },
  });
  assert.equal(db.schemaQueries, 1);
  assert.equal(db.canonicalQueries, 0, "foreign campaign input must not trigger canonical entity reads");
});

test("push row count is bounded before any canonical campaign read", async () => {
  const db = new SchemaOnlyDb();
  const rows = Array.from({ length: 41 }, (_, index) => ({
    newDocumentState: { id: `task_${index}`, campaignId },
  }));
  const response = await handleRxdbPush(db, campaignId, "streetTasks", access("admin"), { rows });
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "invalid_rxdb_push");
  assert.equal(db.canonicalQueries, 0);
});

test("oversized push payload is bounded before canonical campaign reads", async () => {
  const db = new SchemaOnlyDb();
  const response = await handleRxdbPush(
    db,
    campaignId,
    "streetTasks",
    access("admin"),
    {
      rows: [{
        newDocumentState: {
          id: "task_big",
          campaignId,
          label: "x".repeat(260_000),
        },
      }],
    },
  );
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "invalid_rxdb_push");
  assert.equal(db.canonicalQueries, 0);
});

test("malformed individual rows are isolated as rejections instead of crashing the batch", async () => {
  const db = new SchemaOnlyDb();
  const response = await handleRxdbPush(
    db,
    campaignId,
    "streetTasks",
    access("admin"),
    { rows: [{ nope: true }] },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    conflicts: [],
    rejections: [{ documentId: "unknown", code: "invalid_rxdb_push" }],
  });
  assert.equal(db.canonicalQueries, 0);
});

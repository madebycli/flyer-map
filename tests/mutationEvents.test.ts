import assert from "node:assert/strict";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
} from "../worker/campaignRepository.ts";
import { buildMutationDomainEvent } from "../worker/mutationEvents.ts";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";

class EventStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly db: EventDb,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return null as T | null;
  }

  async all<T>() {
    return {
      results: this.db.sessionCandidates.map((field_session_id) => ({ field_session_id })) as T[],
    };
  }
}

class EventDb implements D1DatabaseLike {
  sessionCandidates: string[] = [];
  lastStatement: EventStatement | null = null;

  prepare(query: string) {
    this.lastStatement = new EventStatement(this, query);
    return this.lastStatement;
  }

  async batch() {
    return [];
  }
}

function snapshot(): CampaignSnapshot {
  const at = "2026-08-27T10:00:00.000Z";
  return {
    schemaVersion: 3,
    revision: 8,
    campaign: {
      id: "campaign_a",
      name: "Aktion",
      status: "active",
      defaultMapView: null,
      createdAt: at,
      updatedAt: at,
    },
    teams: [
      {
        id: "team_a",
        campaignId: "campaign_a",
        name: "Nord",
        color: "#2563eb",
        createdAt: at,
        updatedAt: at,
      },
    ],
    areas: [
      {
        id: "area_a",
        campaignId: "campaign_a",
        teamId: "team_a",
        name: "Gebiet",
        geometry: {
          type: "Polygon",
          coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50]]],
        },
        createdAt: at,
        updatedAt: at,
      },
    ],
    tasks: [
      {
        id: "task_a",
        campaignId: "campaign_a",
        areaId: "area_a",
        taskType: "street",
        label: "Hauptstraße",
        geometry: { type: "LineString", coordinates: [[8, 50], [8.1, 50.1]] },
        status: "open",
        completedAt: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    houseTasks: [
      {
        id: "house_a",
        campaignId: "campaign_a",
        areaId: "area_a",
        taskType: "house",
        label: "Haus 1",
        geometry: {
          type: "Polygon",
          coordinates: [[[8, 50], [8.01, 50], [8.01, 50.01], [8, 50]]],
        },
        parentStreetTaskId: "task_a",
        status: "later",
        completedAt: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
}

function streetMutation(): CampaignMutation {
  return {
    id: "mutation_status_a",
    campaignId: "campaign_a",
    type: "task.set-status",
    payload: {
      taskId: "task_a",
      status: "completed",
      completedAt: "2026-08-27T10:30:00.000Z",
      expectedUpdatedAt: "2026-08-27T10:00:00.000Z",
    },
    baseRevision: 8,
    createdAt: "2026-08-27T10:30:00.000Z",
  };
}

function persistentAccess(): AccessContext {
  return {
    grantId: "grant_editor",
    campaignId: "campaign_a",
    role: "team-editor",
    teamId: "team_a",
    label: "Editor",
    groupId: null,
    membershipId: null,
  };
}

function temporaryAccess(): AccessContext {
  return {
    grantId: "field-group:membership_a",
    campaignId: "campaign_a",
    role: "field-group-member",
    teamId: "team_a",
    label: "Nordrunde",
    groupId: "group_a",
    membershipId: "membership_a",
  };
}

test("street status event contains minimized previous/new status and Team context", async () => {
  const db = new EventDb();
  db.sessionCandidates = ["field_session_group_a"];

  const event = await buildMutationDomainEvent(
    db,
    snapshot(),
    streetMutation(),
    persistentAccess(),
    null,
  );

  assert.deepEqual(event, {
    teamId: "team_a",
    fieldSessionId: "field_session_group_a",
    entityType: "street-task",
    entityId: "task_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-27T10:30:00.000Z",
    actorKind: "campaign-grant",
    actorRef: "grant_editor",
    previousStatus: "open",
    newStatus: "completed",
  });
});

test("persistent access does not guess a Session when multiple memberships match", async () => {
  const db = new EventDb();
  db.sessionCandidates = ["field_session_a", "field_session_b"];

  const event = await buildMutationDomainEvent(
    db,
    snapshot(),
    streetMutation(),
    persistentAccess(),
    null,
  );

  assert.equal(event?.fieldSessionId, null);
  assert.match(db.lastStatement?.query ?? "", /LIMIT 2/u);
});

test("temporary member only links the server-known group and membership", async () => {
  const db = new EventDb();
  db.sessionCandidates = ["field_session_group_a"];

  const event = await buildMutationDomainEvent(
    db,
    snapshot(),
    streetMutation(),
    temporaryAccess(),
    "group_a",
  );

  assert.equal(event?.fieldSessionId, "field_session_group_a");
  assert.equal(event?.actorKind, "temporary-member");
  assert.equal(event?.actorRef, "membership_a");
  assert.match(db.lastStatement?.query ?? "", /m\.joined_at <= \?/u);
  assert.match(db.lastStatement?.query ?? "", /m\.removed_at IS NULL OR m\.removed_at >= \?/u);
  assert.match(db.lastStatement?.query ?? "", /s\.started_at <= \?/u);
});

test("wrong explicit group selector cannot relabel a temporary member event", async () => {
  const db = new EventDb();
  db.sessionCandidates = ["field_session_wrong"];

  const event = await buildMutationDomainEvent(
    db,
    snapshot(),
    streetMutation(),
    temporaryAccess(),
    "group_b",
  );

  assert.equal(event?.fieldSessionId, null);
  assert.equal(db.lastStatement, null);
});

test("house status mutation uses the same event type with house entity context", async () => {
  const db = new EventDb();
  const mutation: CampaignMutation = {
    id: "mutation_house_status",
    campaignId: "campaign_a",
    type: "house.set-status",
    payload: {
      taskId: "house_a",
      status: "completed",
      completedAt: "2026-08-27T10:40:00.000Z",
      expectedUpdatedAt: "2026-08-27T10:00:00.000Z",
    },
    baseRevision: 8,
    createdAt: "2026-08-27T10:40:00.000Z",
  };

  const event = await buildMutationDomainEvent(
    db,
    snapshot(),
    mutation,
    persistentAccess(),
    null,
  );

  assert.equal(event?.entityType, "house-task");
  assert.equal(event?.entityId, "house_a");
  assert.equal(event?.previousStatus, "later");
  assert.equal(event?.newStatus, "completed");
});

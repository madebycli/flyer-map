import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
} from "../worker/campaignRepository.ts";
import { handleCommentsApi } from "../worker/comments.ts";

class MissingCommentsSchemaStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(readonly query: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    const query = this.query.replace(/\s+/gu, " ");
    if (query.includes("FROM campaign_sessions s")) {
      return {
        grant_id: "grant_admin",
        campaign_id: "campaign_a",
        role: "admin",
        team_id: null,
        label: "Test admin",
      } as T;
    }
    return null;
  }

  async all<T>() {
    if (this.query.includes("PRAGMA table_info(comments)")) {
      return { results: [] as T[] };
    }
    if (this.query.includes("PRAGMA table_info(domain_events)")) {
      return { results: [] as T[] };
    }
    return { results: [] as T[] };
  }
}

class MissingCommentsSchemaDb implements D1DatabaseLike {
  prepare(query: string) {
    return new MissingCommentsSchemaStatement(query);
  }

  async batch() {
    return [];
  }
}

test("missing migration 0008 is simulated as a specific 503 after access resolution", async () => {
  const response = await handleCommentsApi(
    new Request(
      "https://flyer.test/api/campaigns/campaign_a/comments?targetType=campaign&targetId=campaign_a",
      { headers: { cookie: "vf_session=test-session" } },
    ),
    new MissingCommentsSchemaDb(),
  );

  assert.equal(response?.status, 503);
  const body = await response?.json();
  assert.equal(body.error.code, "comments_schema_unavailable");
  assert.match(body.error.message, /Datenbankmigration/u);
});

test("read-heavy launcher modules wire error and empty states through the shared state model", async () => {
  const [sessions, activity, automation, comments, teamCenter] = await Promise.all([
    readFile("src/collaboration/FieldSessionsHub.tsx", "utf8"),
    readFile("src/collaboration/ActivityHub.tsx", "utf8"),
    readFile("src/collaboration/AutomationHub.tsx", "utf8"),
    readFile("src/collaboration/CommentsContextPanel.tsx", "utf8"),
    readFile("src/team/TeamCenter.tsx", "utf8"),
  ]);

  assert.match(sessions, /resolveRemoteReadState/u);
  assert.match(sessions, /readState === "empty" \|\| readState === "data"/u);
  assert.match(activity, /resolveRemoteReadState/u);
  assert.match(activity, /readState === "empty"/u);
  assert.match(activity, /readState === "data"/u);
  assert.match(automation, /resolveRemoteReadState/u);
  assert.match(automation, /readState === "empty"/u);
  assert.match(automation, /readState === "data"/u);
  assert.match(comments, /comments_schema_unavailable/u);
  assert.match(comments, /pickup_comments_schema_unavailable/u);
  assert.match(comments, /error\.status === 401/u);
  assert.match(comments, /error\.status === 403/u);
  assert.match(comments, /error\.code === "network_error" \|\| error\.status >= 500/u);
  assert.match(comments, /online && errorCanRetry/u);
  assert.match(comments, /initialReadFailed/u);
  assert.match(comments, /!initialReadFailed/u);
  assert.match(teamCenter, /error instanceof CampaignApiError/u);
  assert.match(teamCenter, /return error\.message/u);
  assert.match(teamCenter, /setError\(errorMessage\(cause\)\)/u);
});
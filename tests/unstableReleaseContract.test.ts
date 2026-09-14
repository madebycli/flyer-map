import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/unstable-separated-release.yml", import.meta.url);

test("unstable release remains isolated and verifies the new sync/auth migrations", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /BETA_DB_NAME: flyer-map-unstable-db/u);
  assert.match(source, /BETA_BACKEND_WORKER: flyer-map-unstable-backend/u);
  assert.match(source, /\[\[ "\$BETA_D1_ID" != "\$PROD_D1_ID" \]\]/u);
  assert.match(source, /ORGANIZATION_OPTIONAL_MFA:'1'/u);
  assert.match(source, /campaign_sync_retention/u);
  assert.match(source, /auth_trusted_devices/u);
  assert.match(source, /min_checkpoint_seq/u);
  assert.match(source, /replaced_by_id/u);
});

test("unstable alias preserves Cloudflare websocket handshake objects", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /if \(response\.webSocket\)/u);
  assert.match(source, /webSocket:response\.webSocket/u);
  assert.match(source, /status:101/u);
  assert.match(source, /x-flyer-release-channel','unstable'/u);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/release-channels.yml", import.meta.url);
const runtimePath = new URL("../worker/indexOrganizer.ts", import.meta.url);
const contractPath = new URL("../.release-channels.json", import.meta.url);

test("release workflow hard-maps main to Stable and unstable to Unstable", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /branches:\s*\n\s*- main\s*\n\s*- unstable/u);
  assert.match(source, /stable:\s*\n\s*if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /unstable:\s*\n\s*if: github\.ref == 'refs\/heads\/unstable'/u);
  assert.match(source, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/u);
  assert.match(source, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/unstable' \]\]/u);
  assert.match(source, /Deploy exact main to Stable without D1 migration/u);
  assert.match(source, /Build and deploy exact unstable source to isolated backend/u);
});

test("machine-readable release contract forbids cross-channel deployments", async () => {
  const contract = JSON.parse(await readFile(contractPath, "utf8")) as {
    stable: { sourceBranch: string; worker: string; database: string; applyD1MigrationsDuringDeploy: boolean };
    unstable: { sourceBranch: string; backendWorker: string; aliasWorker: string; database: string; applyD1MigrationsDuringDeploy: boolean };
    forbidden: string[];
  };
  assert.equal(contract.stable.sourceBranch, "main");
  assert.equal(contract.unstable.sourceBranch, "unstable");
  assert.equal(contract.stable.worker, "flyer-map");
  assert.equal(contract.stable.database, "flyer-map-db");
  assert.equal(contract.stable.applyD1MigrationsDuringDeploy, false);
  assert.equal(contract.unstable.backendWorker, "flyer-map-unstable-backend");
  assert.equal(contract.unstable.aliasWorker, "flyer-map-unstable");
  assert.equal(contract.unstable.database, "flyer-map-unstable-db");
  assert.equal(contract.unstable.applyD1MigrationsDuringDeploy, true);
  assert.ok(contract.forbidden.some((entry) => entry.includes("main to the unstable")));
  assert.ok(contract.forbidden.some((entry) => entry.includes("unstable to the stable")));
});

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

test("release runtime and artifact expose exact source revision", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const runtime = await readFile(runtimePath, "utf8");
  assert.match(workflow, /SOURCE_COMMIT_SHA:process\.env\.GITHUB_SHA/u);
  assert.match(workflow, /release-channel-state\.json/u);
  assert.match(workflow, /\.sourceCommit == \$sha/u);
  assert.match(runtime, /SOURCE_COMMIT_SHA\?: string/u);
  assert.match(runtime, /sourceCommit: env\.SOURCE_COMMIT_SHA \?\? null/u);
});

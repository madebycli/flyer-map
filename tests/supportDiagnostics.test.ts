import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSupportDiagnostics,
  supportDiagnosticsText,
} from "../src/support/supportDiagnostics.ts";

test("support diagnostics contain only explicitly supplied safe operational fields", () => {
  const diagnostics = buildSupportDiagnostics({
    appVersion: "0.2.0",
    language: "de",
    online: false,
    campaignId: "campaign_support",
    includeCampaignContext: true,
    mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1",
    snapshotSchemaVersion: 3,
    revision: 12,
    offlineMapPrepared: true,
  });

  assert.deepEqual(diagnostics, {
    appVersion: "0.2.0",
    language: "de",
    connectivity: "offline",
    campaignId: "campaign_support",
    mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1",
    snapshotSchemaVersion: 3,
    revision: 12,
    offlineMapPrepared: true,
  });
});

test("Campaign context is excluded unless the user explicitly opts in", () => {
  const diagnostics = buildSupportDiagnostics({
    appVersion: "0.2.0",
    language: "de",
    online: true,
    campaignId: "campaign_private-by-default",
    mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1",
    snapshotSchemaVersion: 3,
  });

  assert.equal(diagnostics.campaignId, null);
  assert.doesNotMatch(supportDiagnosticsText(diagnostics), /campaign_private-by-default/);
});

test("support diagnostics reject unsafe campaign identifiers even after context consent", () => {
  const diagnostics = buildSupportDiagnostics({
    appVersion: "0.2.0",
    language: "en",
    online: true,
    campaignId: "campaign#access=plaintext-secret",
    includeCampaignContext: true,
    mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1",
    snapshotSchemaVersion: 3,
  });

  assert.equal(diagnostics.campaignId, null);
});

test("diagnostics text never needs URL, cookie, access token, password or TOTP inputs", () => {
  const text = supportDiagnosticsText(
    buildSupportDiagnostics({
      appVersion: "0.2.0",
      language: "de",
      online: true,
      campaignId: "campaign_safe",
      includeCampaignContext: true,
      mapRenderer: "maplibre",
      mapRendererVersion: "5.7.1",
      snapshotSchemaVersion: 3,
      revision: 2,
      offlineMapPrepared: false,
    }),
  );

  assert.match(text, /Campaign: campaign_safe/);
  assert.doesNotMatch(text, /cookie|token|password|totp|location\.href/i);
});

test("invalid numeric metadata degrades safely", () => {
  const diagnostics = buildSupportDiagnostics({
    appVersion: "0.2.0",
    language: "de",
    online: true,
    mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1",
    snapshotSchemaVersion: Number.NaN,
    revision: -1,
  });

  assert.equal(diagnostics.snapshotSchemaVersion, 0);
  assert.equal(diagnostics.revision, null);
});

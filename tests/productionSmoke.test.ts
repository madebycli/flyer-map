import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = "https://flyer-map.cloudflare-eleven035.workers.dev";
const PROBE_CAMPAIGN_ID = "campaign_smoke_probe";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

test(
  "production Worker is deployed with D1 and campaign schema",
  { timeout: 150_000 },
  async () => {
    let lastObservation = "no response";

    for (let attempt = 0; attempt < 24; attempt += 1) {
      try {
        const healthResponse = await fetch(`${BASE_URL}/api/health`, {
          headers: { accept: "application/json" },
        });
        const health = (await healthResponse.json()) as Record<string, unknown>;

        const versionResponse = await fetch(
          `${BASE_URL}/api/campaigns/${PROBE_CAMPAIGN_ID}/version`,
          { headers: { accept: "application/json" } },
        );
        const versionBody = (await versionResponse.json()) as {
          error?: { code?: string };
        };

        lastObservation = JSON.stringify({
          healthStatus: healthResponse.status,
          health,
          versionStatus: versionResponse.status,
          versionBody,
        });

        if (
          healthResponse.status === 200 &&
          health.ok === true &&
          health.service === "flyer-map" &&
          health.version === "0.2.0" &&
          health.persistence === "d1" &&
          versionResponse.status === 404 &&
          versionBody.error?.code === "campaign_not_found"
        ) {
          assert.equal(health.persistence, "d1");
          return;
        }
      } catch (error) {
        lastObservation = error instanceof Error ? error.message : String(error);
      }

      await delay(5_000);
    }

    assert.fail(`Production M3 smoke check did not become ready: ${lastObservation}`);
  },
);

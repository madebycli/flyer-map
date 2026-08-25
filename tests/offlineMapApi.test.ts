import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadOfflineMapPackage,
  OfflineMapApiError,
} from "../src/data/offlineMapApi.ts";
import type { OfflineMapPackage } from "../src/domain/offlineMap.ts";

function packageFixture(): OfflineMapPackage {
  return {
    schemaVersion: 1,
    sourceDataset: "OpenStreetMap",
    sourceLicense: "ODbL-1.0",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    fetchedAt: "2026-08-25T21:30:00.000Z",
    sourceTimestamp: "2026-08-25T21:29:00.000Z",
    center: { lat: 51.05, lng: 13.74 },
    radiusMeters: 3_000,
    bounds: { south: 51.02, west: 13.69, north: 51.08, east: 13.79 },
    attribution: "© OpenStreetMap contributors",
    roads: { type: "FeatureCollection", features: [] },
    buildings: { type: "FeatureCollection", features: [] },
  };
}

async function withFetch(
  replacement: typeof fetch,
  run: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("offline map client sends only campaign route, center and fixed radius", async () => {
  await withFetch(async (input, init) => {
    assert.equal(
      String(input),
      "/api/campaigns/campaign_settings/offline-map/package",
    );
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      center: { lat: 51.05, lng: 13.74 },
      radiusMeters: 3_000,
    });
    return Response.json(packageFixture());
  }, async () => {
    const pkg = await downloadOfflineMapPackage("campaign_settings", {
      lat: 51.05,
      lng: 13.74,
    });
    assert.equal(pkg.schemaVersion, 1);
    assert.equal(pkg.radiusMeters, 3_000);
  });
});

test("offline map client rejects structurally invalid success payloads", async () => {
  await withFetch(
    async () => Response.json({ schemaVersion: 1, radiusMeters: 3_000 }),
    async () => {
      await assert.rejects(
        () =>
          downloadOfflineMapPackage("campaign_settings", {
            lat: 51.05,
            lng: 13.74,
          }),
        (error: unknown) =>
          error instanceof OfflineMapApiError &&
          error.code === "offline_package_invalid" &&
          error.status === 502,
      );
    },
  );
});

test("offline map client preserves safe server error codes", async () => {
  await withFetch(
    async () =>
      Response.json(
        { error: { code: "access_required", message: "Access required." } },
        { status: 401 },
      ),
    async () => {
      await assert.rejects(
        () =>
          downloadOfflineMapPackage("campaign_settings", {
            lat: 51.05,
            lng: 13.74,
          }),
        (error: unknown) =>
          error instanceof OfflineMapApiError &&
          error.code === "access_required" &&
          error.status === 401,
      );
    },
  );
});

test("offline map client converts fetch failure into a network error", async () => {
  await withFetch(
    async () => {
      throw new TypeError("network failed");
    },
    async () => {
      await assert.rejects(
        () =>
          downloadOfflineMapPackage("campaign_settings", {
            lat: 51.05,
            lng: 13.74,
          }),
        (error: unknown) =>
          error instanceof OfflineMapApiError &&
          error.code === "network_error" &&
          error.status === 0,
      );
    },
  );
});

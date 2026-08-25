import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OfflineMapPackageRepository,
  type OfflineMapPackageStorage,
  type StoredOfflineMapPackage,
} from "../src/data/offlineMapRepository.ts";
import type { OfflineMapPackage } from "../src/domain/offlineMap.ts";

function packageFixture(options?: { fetchedAt?: string; roadId?: number }): OfflineMapPackage {
  const roadId = options?.roadId ?? 123;
  return {
    schemaVersion: 1,
    sourceDataset: "OpenStreetMap",
    sourceLicense: "ODbL-1.0",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    fetchedAt: options?.fetchedAt ?? "2026-08-25T21:30:00.000Z",
    sourceTimestamp: "2026-08-25T21:29:00.000Z",
    center: { lat: 51.05, lng: 13.74 },
    radiusMeters: 3_000,
    bounds: { south: 51.02, west: 13.69, north: 51.08, east: 13.79 },
    attribution: "© OpenStreetMap contributors",
    roads: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: `way/${roadId}`,
          properties: {
            osmType: "way",
            osmId: roadId,
            kind: "road",
            tags: { highway: "residential", name: "Teststraße" },
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [13.74, 51.05],
              [13.741, 51.051],
            ],
          },
        },
      ],
    },
    buildings: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "way/456",
          properties: {
            osmType: "way",
            osmId: 456,
            kind: "building",
            tags: { building: "yes", "addr:housenumber": "7" },
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [13.74, 51.05],
                [13.741, 51.05],
                [13.741, 51.051],
                [13.74, 51.05],
              ],
            ],
          },
        },
      ],
    },
  };
}

class JsonFilePackageStorage implements OfflineMapPackageStorage {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async readAll() {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as StoredOfflineMapPackage[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(campaignId: string) {
    return (await this.readAll()).find((record) => record.campaignId === campaignId);
  }

  async put(record: StoredOfflineMapPackage) {
    const records = (await this.readAll()).filter(
      (candidate) => candidate.campaignId !== record.campaignId,
    );
    records.push(record);
    await writeFile(this.filePath, JSON.stringify(records), "utf8");
  }

  async delete(campaignId: string) {
    const records = (await this.readAll()).filter(
      (record) => record.campaignId !== campaignId,
    );
    await writeFile(this.filePath, JSON.stringify(records), "utf8");
  }
}

class MemoryPackageStorage implements OfflineMapPackageStorage {
  readonly records = new Map<string, StoredOfflineMapPackage>();
  failWrites = false;

  async get(campaignId: string) {
    return this.records.get(campaignId);
  }

  async put(record: StoredOfflineMapPackage) {
    if (this.failWrites) throw new Error("storage write failed");
    this.records.set(record.campaignId, structuredClone(record));
  }

  async delete(campaignId: string) {
    this.records.delete(campaignId);
  }
}

test("offline map package survives a repository reload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flyer-map-offline-map-"));
  const filePath = path.join(directory, "packages.json");
  const campaignId = "campaign_offline-1";

  try {
    const first = new OfflineMapPackageRepository(
      new JsonFilePackageStorage(filePath),
      () => new Date("2026-08-25T21:31:00.000Z"),
    );
    const stored = await first.replace(campaignId, packageFixture());

    const reloaded = new OfflineMapPackageRepository(new JsonFilePackageStorage(filePath));
    const loaded = await reloaded.load(campaignId);

    assert.deepEqual(loaded, stored);
    assert.ok((loaded?.byteSize ?? 0) > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid replacement is rejected before storage changes", async () => {
  const storage = new MemoryPackageStorage();
  const repository = new OfflineMapPackageRepository(storage);
  const invalid = { ...packageFixture(), radiusMeters: 3_001 } as OfflineMapPackage;

  await assert.rejects(
    () => repository.replace("campaign_offline-1", invalid),
    /Offline map package is invalid/,
  );
  assert.equal(storage.records.size, 0);
});

test("failed replacement preserves the previous valid package", async () => {
  const storage = new MemoryPackageStorage();
  const repository = new OfflineMapPackageRepository(
    storage,
    () => new Date("2026-08-25T21:31:00.000Z"),
  );
  const campaignId = "campaign_offline-1";
  const original = await repository.replace(campaignId, packageFixture({ roadId: 123 }));

  storage.failWrites = true;
  await assert.rejects(
    () => repository.replace(campaignId, packageFixture({ roadId: 999 })),
    /storage write failed/,
  );
  storage.failWrites = false;

  assert.deepEqual(await repository.load(campaignId), original);
});

test("package summary reports storage size and geometry counts", async () => {
  const storage = new MemoryPackageStorage();
  const repository = new OfflineMapPackageRepository(storage);
  const record = await repository.replace("campaign_offline-1", packageFixture());
  const summary = repository.summary(record);

  assert.equal(summary.roadCount, 1);
  assert.equal(summary.buildingCount, 1);
  assert.equal(summary.radiusMeters, 3_000);
  assert.equal(summary.attribution, "© OpenStreetMap contributors");
  assert.equal(summary.byteSize, record.byteSize);
  assert.ok(summary.byteSize > 0);
});

test("removing a prepared package releases the campaign record", async () => {
  const storage = new MemoryPackageStorage();
  const repository = new OfflineMapPackageRepository(storage);
  const campaignId = "campaign_offline-1";

  await repository.replace(campaignId, packageFixture());
  await repository.remove(campaignId);

  assert.equal(await repository.load(campaignId), null);
});

test("corrupt stored package is surfaced instead of silently used", async () => {
  const storage = new MemoryPackageStorage();
  const repository = new OfflineMapPackageRepository(storage);
  const campaignId = "campaign_offline-1";
  const valid = await repository.replace(campaignId, packageFixture());

  storage.records.set(campaignId, {
    ...valid,
    byteSize: valid.byteSize + 1,
  });

  await assert.rejects(
    () => repository.load(campaignId),
    /size metadata is invalid/,
  );
});

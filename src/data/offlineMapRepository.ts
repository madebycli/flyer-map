import {
  isOfflineMapPackage,
  type OfflineMapPackage,
} from "../domain/offlineMap";

const DATABASE_NAME = "verteil-flyer-offline-map";
const DATABASE_VERSION = 1;
const STORE_NAME = "packages";

export type StoredOfflineMapPackage = {
  campaignId: string;
  savedAt: string;
  byteSize: number;
  package: OfflineMapPackage;
};

export type OfflineMapPackageStorage = {
  get(campaignId: string): Promise<StoredOfflineMapPackage | undefined>;
  put(record: StoredOfflineMapPackage): Promise<void>;
  delete(campaignId: string): Promise<void>;
};

export type OfflineMapPackageSummary = {
  campaignId: string;
  savedAt: string;
  fetchedAt: string;
  sourceTimestamp: string | null;
  byteSize: number;
  radiusMeters: number;
  center: OfflineMapPackage["center"];
  bounds: OfflineMapPackage["bounds"];
  attribution: OfflineMapPackage["attribution"];
  roadCount: number;
  buildingCount: number;
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function validCampaignId(campaignId: string) {
  return (
    campaignId.length >= 1 &&
    campaignId.length <= 120 &&
    /^[A-Za-z0-9_-]+$/u.test(campaignId)
  );
}

function encodedByteSize(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isStoredOfflineMapPackage(value: unknown): value is StoredOfflineMapPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.campaignId === "string" &&
    validCampaignId(record.campaignId) &&
    typeof record.savedAt === "string" &&
    !Number.isNaN(Date.parse(record.savedAt)) &&
    typeof record.byteSize === "number" &&
    Number.isSafeInteger(record.byteSize) &&
    record.byteSize > 0 &&
    isOfflineMapPackage(record.package)
  );
}

export class IndexedDbOfflineMapPackageStorage implements OfflineMapPackageStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database() {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is not available."));
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "campaignId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Offline map IndexedDB could not be opened."));
      request.onblocked = () =>
        reject(new Error("Offline map IndexedDB upgrade is blocked."));
    });

    return this.databasePromise;
  }

  async get(campaignId: string) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const result = await requestResult(
      transaction.objectStore(STORE_NAME).get(campaignId),
    );
    await completion;
    return result as StoredOfflineMapPackage | undefined;
  }

  async put(record: StoredOfflineMapPackage) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    try {
      await requestResult(transaction.objectStore(STORE_NAME).put(record));
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be completed/aborted. The original error remains authoritative.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async delete(campaignId: string) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    await requestResult(transaction.objectStore(STORE_NAME).delete(campaignId));
    await completion;
  }
}

export class OfflineMapPackageRepository {
  private readonly storage: OfflineMapPackageStorage;
  private readonly now: () => Date;

  constructor(storage: OfflineMapPackageStorage, now: () => Date = () => new Date()) {
    this.storage = storage;
    this.now = now;
  }

  async load(campaignId: string) {
    if (!validCampaignId(campaignId)) {
      throw new Error("Campaign id is invalid for offline map storage.");
    }
    const stored = await this.storage.get(campaignId);
    if (!stored) return null;
    if (!isStoredOfflineMapPackage(stored) || stored.campaignId !== campaignId) {
      throw new Error("Stored offline map package is invalid.");
    }
    const actualByteSize = encodedByteSize(stored.package);
    if (actualByteSize !== stored.byteSize) {
      throw new Error("Stored offline map package size metadata is invalid.");
    }
    return stored;
  }

  async replace(campaignId: string, pkg: OfflineMapPackage) {
    if (!validCampaignId(campaignId)) {
      throw new Error("Campaign id is invalid for offline map storage.");
    }
    if (!isOfflineMapPackage(pkg)) {
      throw new Error("Offline map package is invalid.");
    }

    const record: StoredOfflineMapPackage = {
      campaignId,
      savedAt: this.now().toISOString(),
      byteSize: encodedByteSize(pkg),
      package: pkg,
    };

    await this.storage.put(record);
    return record;
  }

  async remove(campaignId: string) {
    if (!validCampaignId(campaignId)) {
      throw new Error("Campaign id is invalid for offline map storage.");
    }
    await this.storage.delete(campaignId);
  }

  summary(record: StoredOfflineMapPackage): OfflineMapPackageSummary {
    if (!isStoredOfflineMapPackage(record)) {
      throw new Error("Stored offline map package is invalid.");
    }
    return {
      campaignId: record.campaignId,
      savedAt: record.savedAt,
      fetchedAt: record.package.fetchedAt,
      sourceTimestamp: record.package.sourceTimestamp,
      byteSize: record.byteSize,
      radiusMeters: record.package.radiusMeters,
      center: record.package.center,
      bounds: record.package.bounds,
      attribution: record.package.attribution,
      roadCount: record.package.roads.features.length,
      buildingCount: record.package.buildings.features.length,
    };
  }
}

export const browserOfflineMapRepository = new OfflineMapPackageRepository(
  new IndexedDbOfflineMapPackageStorage(),
);

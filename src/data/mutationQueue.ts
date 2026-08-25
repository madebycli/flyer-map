import type { CampaignMutation } from "../domain/mutations";

const DATABASE_NAME = "verteil-flyer-sync";
const DATABASE_VERSION = 1;
const STORE_NAME = "mutations";
const EMERGENCY_RECORD_KEY = "verteil-flyer:m5-mutation-emergency";

export type MutationQueueState =
  | "pending"
  | "retry"
  | "conflict"
  | "blocked-auth"
  | "invalid";

export type QueuedCampaignMutation = {
  id: string;
  campaignId: string;
  createdAt: string;
  mutation: CampaignMutation;
  state: MutationQueueState;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: string;
};

export type MutationQueueStorage = {
  getAll(): Promise<QueuedCampaignMutation[]>;
  put(record: QueuedCampaignMutation): Promise<void>;
  delete(id: string): Promise<void>;
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
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function writeEmergencyRecord(record: QueuedCampaignMutation) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(EMERGENCY_RECORD_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function readEmergencyRecord() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(EMERGENCY_RECORD_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<QueuedCampaignMutation>;
    if (
      typeof value.id !== "string" ||
      typeof value.campaignId !== "string" ||
      typeof value.createdAt !== "string" ||
      !value.mutation ||
      typeof value.mutation !== "object"
    ) {
      throw new Error("Emergency mutation record is invalid.");
    }
    return value as QueuedCampaignMutation;
  } catch (error) {
    window.localStorage.removeItem(EMERGENCY_RECORD_KEY);
    throw new Error("Emergency mutation record could not be restored.", { cause: error });
  }
}

function clearEmergencyRecord(id: string) {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(EMERGENCY_RECORD_KEY);
  if (!raw) return;
  try {
    const current = JSON.parse(raw) as Partial<QueuedCampaignMutation>;
    if (current.id === id) window.localStorage.removeItem(EMERGENCY_RECORD_KEY);
  } catch {
    window.localStorage.removeItem(EMERGENCY_RECORD_KEY);
  }
}

export class IndexedDbMutationQueueStorage implements MutationQueueStorage {
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
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("campaign-created", ["campaignId", "createdAt"], { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked."));
    });

    return this.databasePromise;
  }

  async getAll() {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const request = transaction.objectStore(STORE_NAME).getAll();
    const records = (await requestResult(request)) as QueuedCampaignMutation[];
    await completion;
    return records;
  }

  async put(record: QueuedCampaignMutation) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
    await completion;
  }

  async delete(id: string) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    await requestResult(transaction.objectStore(STORE_NAME).delete(id));
    await completion;
  }
}

export class MutationQueue {
  private readonly storage: MutationQueueStorage;

  constructor(storage: MutationQueueStorage) {
    this.storage = storage;
  }

  private async recoverEmergencyRecord() {
    const record = readEmergencyRecord();
    if (!record) return;
    await this.storage.put(record);
    clearEmergencyRecord(record.id);
  }

  async enqueue(mutation: CampaignMutation) {
    const record: QueuedCampaignMutation = {
      id: mutation.id,
      campaignId: mutation.campaignId,
      createdAt: mutation.createdAt,
      mutation,
      state: "pending",
      attemptCount: 0,
      nextAttemptAt: 0,
    };

    const emergencyWritten = writeEmergencyRecord(record);
    await this.storage.put(record);
    if (emergencyWritten) clearEmergencyRecord(record.id);
    return record;
  }

  async list(campaignId: string) {
    await this.recoverEmergencyRecord();
    const records = await this.storage.getAll();
    return records
      .filter((record) => record.campaignId === campaignId)
      .sort((a, b) => {
        const revisionOrder = a.mutation.baseRevision - b.mutation.baseRevision;
        if (revisionOrder !== 0) return revisionOrder;
        const created = a.createdAt.localeCompare(b.createdAt);
        return created !== 0 ? created : a.id.localeCompare(b.id);
      });
  }

  async update(record: QueuedCampaignMutation) {
    await this.storage.put(record);
  }

  async remove(id: string) {
    await this.storage.delete(id);
  }
}

export const browserMutationQueue = new MutationQueue(new IndexedDbMutationQueueStorage());

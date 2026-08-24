import type { CampaignMutation } from "../domain/mutations";

const DATABASE_NAME = "verteil-flyer-sync";
const DATABASE_VERSION = 1;
const STORE_NAME = "mutations";

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
    const request = transaction.objectStore(STORE_NAME).getAll();
    return (await requestResult(request)) as QueuedCampaignMutation[];
  }

  async put(record: QueuedCampaignMutation) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
  }

  async delete(id: string) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(id));
  }
}

export class MutationQueue {
  constructor(private readonly storage: MutationQueueStorage) {}

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
    await this.storage.put(record);
    return record;
  }

  async list(campaignId: string) {
    const records = await this.storage.getAll();
    return records
      .filter((record) => record.campaignId === campaignId)
      .sort((a, b) => {
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

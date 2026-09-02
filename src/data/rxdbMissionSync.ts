import { createRxDatabase } from "rxdb";
import { replicateRxCollection } from "rxdb/plugins/replication";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import type { CampaignMutation } from "../domain/mutations.ts";
import type { DurableCampaignMutation } from "../domain/durableMutation.ts";
import type { CampaignSnapshot } from "../domain/campaign.ts";
import {
  materializeCampaignSnapshot,
  withoutRxdbMetadata,
  type RxdbCollectionName,
  type RxdbDocument,
  type RxdbPullResponse,
  type RxdbPushRow,
} from "./rxdbSyncProtocol.ts";

const PULL_BATCH_SIZE = 100;
const PUSH_BATCH_SIZE = 20;

type RxdbCollections = Record<RxdbCollectionName, any>;
type ReplicationState = ReturnType<typeof replicateRxCollection<any, { seq: number }>>;
type RxdbReplicationDocument = RxdbDocument & { _deleted: boolean };

function withDeletedMarker(document: RxdbDocument): RxdbReplicationDocument {
  return { ...document, _deleted: document._deleted === true } as RxdbReplicationDocument;
}

export type RxdbSyncIssue = {
  kind: "network" | "schema" | "rejected";
  collectionName?: RxdbCollectionName;
  documentId?: string;
  code: string;
};

export class RxdbSyncHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RxdbSyncHttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Holds RxDB's upstream persistence window open until the trailing edit has
 * settled.  The gate is deliberately small and scheduler-based so the UI can
 * flush it synchronously on blur/Enter while normal typing still coalesces.
 */
export class TrailingPersistenceGate {
  private timer: number | null = null;
  private resolvers: Array<() => void> = [];

  private release() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const resolvers = this.resolvers.splice(0);
    for (const pending of resolvers) pending();
  }

  wait() {
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.release(), 900);
    });
  }

  flush() {
    this.release();
  }
}

const objectSchema = { type: "object", additionalProperties: true } as const;
const nullableObjectSchema = { anyOf: [objectSchema, { type: "null" }] } as const;
const nullableStringSchema = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

const schemas: Record<RxdbCollectionName, any> = {
  campaigns: {
    version: 0,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 200 }, campaignId: { type: "string", maxLength: 200 },
      name: { type: "string" }, status: { type: "string" }, defaultMapView: nullableObjectSchema,
      createdAt: { type: "string" }, updatedAt: { type: "string" },
    },
    required: ["id", "campaignId", "name", "status", "defaultMapView", "createdAt", "updatedAt"],
    indexes: ["campaignId"],
    additionalProperties: false,
  },
  teams: {
    version: 0,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 200 }, campaignId: { type: "string", maxLength: 200 },
      name: { type: "string" }, color: { type: "string" }, createdAt: { type: "string" }, updatedAt: { type: "string" },
    },
    required: ["id", "campaignId", "name", "color", "createdAt", "updatedAt"],
    indexes: ["campaignId"],
    additionalProperties: false,
  },
  areas: {
    version: 0,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 200 }, campaignId: { type: "string", maxLength: 200 }, teamId: { type: "string", maxLength: 200 },
      name: { type: "string" }, geometry: objectSchema, createdAt: { type: "string" }, updatedAt: { type: "string" },
    },
    required: ["id", "campaignId", "teamId", "name", "geometry", "createdAt", "updatedAt"],
    indexes: ["campaignId", "teamId"],
    additionalProperties: false,
  },
  streetTasks: {
    version: 0,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 200 }, campaignId: { type: "string", maxLength: 200 }, areaId: { type: "string", maxLength: 200 },
      taskType: { type: "string" }, label: { type: "string" }, geometry: objectSchema, source: nullableObjectSchema,
      areaPreparationGeneration: nullableStringSchema, status: { type: "string" }, completedAt: nullableStringSchema,
      createdAt: { type: "string" }, updatedAt: { type: "string" },
    },
    required: ["id", "campaignId", "areaId", "taskType", "label", "geometry", "areaPreparationGeneration", "status", "completedAt", "createdAt", "updatedAt"],
    indexes: ["campaignId", "areaId"],
    additionalProperties: false,
  },
  houseTasks: {
    version: 0,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 200 }, campaignId: { type: "string", maxLength: 200 }, areaId: { type: "string", maxLength: 200 },
      taskType: { type: "string" }, label: { type: "string" }, geometry: objectSchema, source: nullableObjectSchema,
      areaPreparationGeneration: nullableStringSchema, parentStreetTaskId: nullableStringSchema,
      status: { type: "string" }, completedAt: nullableStringSchema, createdAt: { type: "string" }, updatedAt: { type: "string" },
    },
    required: ["id", "campaignId", "areaId", "taskType", "label", "geometry", "areaPreparationGeneration", "parentStreetTaskId", "status", "completedAt", "createdAt", "updatedAt"],
    indexes: ["campaignId", "areaId"],
    additionalProperties: false,
  },
};

function collectionPath(campaignId: string, operation: "pull" | "push", collectionName: RxdbCollectionName) {
  return "/api/campaigns/" + encodeURIComponent(campaignId) + "/rxdb/" + operation + "/" + collectionName;
}

function checkpointPath(campaignId: string) {
  return "/api/campaigns/" + encodeURIComponent(campaignId) + "/rxdb/checkpoint";
}

function realtimePath(campaignId: string) {
  return "/api/campaigns/" + encodeURIComponent(campaignId) + "/rxdb/ws";
}

async function responseError(response: Response) {
  let payload: { error?: { code?: string; message?: string } } | null = null;
  try {
    payload = await response.json() as { error?: { code?: string; message?: string } };
  } catch {
    // Keep the generic error below.
  }
  return new RxdbSyncHttpError(
    response.status,
    payload?.error?.code ?? "rxdb_request_failed",
    payload?.error?.message ?? "RxDB-Synchronisation ist momentan nicht verfügbar.",
  );
}

function asWireDocument(document: RxdbDocument) {
  return withoutRxdbMetadata(document);
}

export class MissionRxdbSync {
  private readonly campaignId: string;
  private readonly teamScopeId: string | null;
  private readonly collectionFallback: CampaignSnapshot["collection"];
  private readonly storage: any;
  private readonly multiInstance: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly onSnapshot: (snapshot: CampaignSnapshot) => void;
  private readonly onIssue: (issue: RxdbSyncIssue) => void;
  private database: any = null;
  private collections: RxdbCollections | null = null;
  private readonly replications = new Map<RxdbCollectionName, ReplicationState>();
  private readonly checkpoints = new Map<RxdbCollectionName, number>();
  private readonly subscriptions: Array<{ unsubscribe(): void }> = [];
  private materializationTimer: number | null = null;
  private safetyTimer: number | null = null;
  private socketReconnectTimer: number | null = null;
  private socket: WebSocket | null = null;
  private socketReconnectDelay = 2_000;
  private initialized = false;
  private canonicalRevision = 0;
  private readonly persistenceGates = new Map<RxdbCollectionName, TrailingPersistenceGate>();

  constructor(input: {
    campaignId: string;
    teamScopeId?: string | null;
    collectionFallback?: CampaignSnapshot["collection"];
    /** Optional test storage; production defaults to the Dexie adapter. */
    storage?: any;
    multiInstance?: boolean;
    /** Optional isolated fetcher for Worker/Miniflare integration tests. */
    fetchImpl?: typeof fetch;
    onSnapshot: (snapshot: CampaignSnapshot) => void;
    onIssue: (issue: RxdbSyncIssue) => void;
  }) {
    this.campaignId = input.campaignId;
    this.teamScopeId = input.teamScopeId ?? null;
    this.collectionFallback = input.collectionFallback;
    this.storage = input.storage ?? getRxStorageDexie();
    this.multiInstance = input.multiInstance ?? true;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.onSnapshot = input.onSnapshot;
    this.onIssue = input.onIssue;
    this.persistenceGates.set("campaigns", new TrailingPersistenceGate());
    this.persistenceGates.set("teams", new TrailingPersistenceGate());
  }

  private async request<T>(
    operation: "pull" | "push",
    collectionName: RxdbCollectionName,
    body: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(collectionPath(this.campaignId, operation, collectionName), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new RxdbSyncHttpError(0, "network_error", "Server ist momentan nicht erreichbar.");
    }
    if (!response.ok) throw await responseError(response);
    return await response.json() as T;
  }

  private async requestCheckpoint() {
    let response: Response;
    try {
      response = await this.fetchImpl(checkpointPath(this.campaignId), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      throw new RxdbSyncHttpError(0, "network_error", "Server ist momentan nicht erreichbar.");
    }
    if (!response.ok) throw await responseError(response);
    const payload = await response.json() as {
      checkpoint?: { seq?: unknown };
      campaignRevision?: unknown;
    };
    const seq = payload.checkpoint?.seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
      throw new RxdbSyncHttpError(502, "invalid_checkpoint", "Der Server hat keinen gültigen RxDB-Checkpoint geliefert.");
    }
    const campaignRevision = typeof payload.campaignRevision === "number" && Number.isSafeInteger(payload.campaignRevision) && payload.campaignRevision >= 0
      ? payload.campaignRevision
      : this.canonicalRevision;
    return { seq, campaignRevision };
  }

  private scheduleMaterialization() {
    if (this.materializationTimer !== null) return;
    this.materializationTimer = window.setTimeout(() => {
      this.materializationTimer = null;
      void this.materialize();
    }, 0);
  }

  private async materialize() {
    if (!this.collections) return;
    const [campaigns, teams, areas, streetTasks, houseTasks] = await Promise.all([
      this.collections.campaigns.find({ selector: { campaignId: this.campaignId } }).exec(),
      this.collections.teams.find({ selector: { campaignId: this.campaignId } }).exec(),
      this.collections.areas.find({ selector: { campaignId: this.campaignId } }).exec(),
      this.collections.streetTasks.find({ selector: { campaignId: this.campaignId } }).exec(),
      this.collections.houseTasks.find({ selector: { campaignId: this.campaignId } }).exec(),
    ]);
    const visibleTeams = this.teamScopeId
      ? teams.filter((document: any) => document.id === this.teamScopeId)
      : teams;
    const visibleAreas = this.teamScopeId
      ? areas.filter((document: any) => document.teamId === this.teamScopeId)
      : areas;
    const visibleAreaIds = new Set(visibleAreas.map((document: any) => document.id));
    const visibleStreetTasks = this.teamScopeId
      ? streetTasks.filter((document: any) => visibleAreaIds.has(document.areaId))
      : streetTasks;
    const visibleHouseTasks = this.teamScopeId
      ? houseTasks.filter((document: any) => visibleAreaIds.has(document.areaId))
      : houseTasks;
    const snapshot = materializeCampaignSnapshot({
      revision: this.canonicalRevision,
      campaign: campaigns[0]?.toJSON(),
      teams: visibleTeams.map((document: any) => document.toJSON()),
      areas: visibleAreas.map((document: any) => document.toJSON()),
      streetTasks: visibleStreetTasks.map((document: any) => document.toJSON()),
      houseTasks: visibleHouseTasks.map((document: any) => document.toJSON()),
      collection: this.collectionFallback,
    });
    if (snapshot) this.onSnapshot(snapshot);
  }

  private createReplication(collectionName: RxdbCollectionName) {
    const collection = this.collections?.[collectionName];
    if (!collection) throw new Error("rxdb_collection_missing");
    const persistenceGate = this.persistenceGates.get(collectionName);
    const replication = replicateRxCollection({
      replicationIdentifier: "mission-rxdb-sync-v1:" + this.campaignId + ":" + (this.teamScopeId ?? "campaign") + ":" + collectionName,
      collection,
      pull: {
        batchSize: PULL_BATCH_SIZE,
        handler: async (checkpoint: { seq: number } | undefined, batchSize: number) => {
          const result = await this.request<RxdbPullResponse>("pull", collectionName, { checkpoint: checkpoint ?? null, batchSize });
          this.checkpoints.set(collectionName, result.checkpoint.seq);
          if (Number.isSafeInteger(result.campaignRevision) && result.campaignRevision >= 0) {
            this.canonicalRevision = Math.max(this.canonicalRevision, result.campaignRevision);
          }
          return {
            documents: result.documents.map(withDeletedMarker),
            checkpoint: result.checkpoint,
          };
        },
      },
      push: {
        batchSize: PUSH_BATCH_SIZE,
        ...(persistenceGate ? { waitBeforePersist: () => persistenceGate.wait() } : {}),
        handler: async (rows: RxdbPushRow[]) => {
          const result = await this.request<{ conflicts: RxdbDocument[]; rejections: Array<{ documentId: string; code: string }> }>(
            "push",
            collectionName,
            {
              rows: rows.map((row) => ({
                ...(row.assumedMasterState ? { assumedMasterState: asWireDocument(row.assumedMasterState) } : {}),
                newDocumentState: asWireDocument(row.newDocumentState),
              })),
            },
          );
          for (const rejection of result.rejections) {
            this.onIssue({ kind: "rejected", collectionName, documentId: rejection.documentId, code: rejection.code });
          }
          return result.conflicts.map(withDeletedMarker);
        },
      },
      live: true,
      retryTime: 2_000,
      waitForLeadership: true,
      toggleOnDocumentVisible: true,
    });
    this.subscriptions.push(
      replication.error$.subscribe((error: unknown) => {
        const message = error instanceof Error ? error.message : "rxdb_replication_error";
        const details = (() => {
          try { return JSON.stringify(error); } catch { return message; }
        })();
        const code = error instanceof RxdbSyncHttpError ? error.code : message + details;
        this.onIssue({
          kind: code.includes("rxdb_sync_schema_unavailable") ? "schema" : "network",
          collectionName,
          code,
        });
      }),
      replication.received$.subscribe(() => this.scheduleMaterialization()),
      replication.sent$.subscribe(() => this.scheduleMaterialization()),
    );
    this.replications.set(collectionName, replication);
  }

  private connectSocket() {
    if (!this.initialized || this.socket || typeof window === "undefined" || typeof location === "undefined") return;
    const WebSocketConstructor = (globalThis as typeof globalThis & {
      WebSocket?: typeof WebSocket;
    }).WebSocket;
    if (!WebSocketConstructor) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocketConstructor(protocol + "//" + location.host + realtimePath(this.campaignId));
    this.socket = socket;
    socket.onopen = () => {
      this.socketReconnectDelay = 2_000;
    };
    socket.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = typeof event.data === "string" ? JSON.parse(event.data) : null;
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      const value = payload as Record<string, unknown>;
      const seq = value.seq;
      if (value.type === "changed" && typeof seq === "number" && Number.isSafeInteger(seq) && seq > this.maxKnownCheckpoint()) {
        this.refresh();
      }
    };
    socket.onerror = () => {
      try { socket.close(); } catch { /* socket already closed */ }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.initialized || typeof window === "undefined" || this.socketReconnectTimer !== null) return;
      const delay = this.socketReconnectDelay;
      this.socketReconnectDelay = Math.min(30_000, this.socketReconnectDelay * 2);
      this.socketReconnectTimer = window.setTimeout(() => {
        this.socketReconnectTimer = null;
        this.connectSocket();
      }, delay);
    };
  }

  private maxKnownCheckpoint() {
    let max = 0;
    for (const checkpoint of this.checkpoints.values()) max = Math.max(max, checkpoint);
    return max;
  }

  /** Pulls only a Campaign-level high-water mark before deciding to resync. */
  async safetyResync() {
    if (!this.initialized) return;
    try {
      const checkpoint = await this.requestCheckpoint();
      if (checkpoint.seq > this.maxKnownCheckpoint() || checkpoint.campaignRevision > this.canonicalRevision) {
        this.refresh();
      }
    } catch (error) {
      const code = error instanceof RxdbSyncHttpError ? error.code : "rxdb_checkpoint_failed";
      this.onIssue({ kind: code.includes("schema_unavailable") ? "schema" : "network", code });
    }
  }

  async start() {
    if (this.initialized) return;
    this.database = await createRxDatabase({
      name: "verteil-flyer-mission-rxdb-v1-" + this.campaignId + (this.teamScopeId ? "-field-group-" + this.teamScopeId : ""),
      storage: this.storage,
      multiInstance: this.multiInstance,
      eventReduce: true,
    });
    this.collections = await this.database.addCollections({
      campaigns: { schema: schemas.campaigns },
      teams: { schema: schemas.teams },
      areas: { schema: schemas.areas },
      streetTasks: { schema: schemas.streetTasks },
      houseTasks: { schema: schemas.houseTasks },
    }) as RxdbCollections;
    this.initialized = true;
    for (const collectionName of Object.keys(this.collections) as RxdbCollectionName[]) {
      this.subscriptions.push(this.collections[collectionName].find({ selector: { campaignId: this.campaignId } }).$.subscribe(() => this.scheduleMaterialization()));
      this.createReplication(collectionName);
    }
    if (typeof window !== "undefined") {
      this.safetyTimer = window.setInterval(() => { void this.safetyResync(); }, 45_000);
    }
    this.connectSocket();
    this.scheduleMaterialization();
  }

  refresh() {
    this.connectSocket();
    for (const replication of this.replications.values()) replication.reSync();
  }

  /** Blur, Enter and sheet-close use this without changing status-write behavior. */
  flushDebouncedWrites() {
    this.persistenceGates.get("campaigns")?.flush();
    this.persistenceGates.get("teams")?.flush();
    this.refresh();
  }

  /**
   * A legacy queue may only be migrated after this browser has a Campaign
   * document in its local replica. Waiting for RxDB's replication promise is
   * unsafe in a follower tab, because only the elected leader performs I/O.
   */
  async waitForCampaignDocument(timeoutMs = 15_000) {
    const campaigns = this.collections?.campaigns;
    if (!campaigns || typeof window === "undefined") return false;
    if (await campaigns.findOne(this.campaignId).exec()) return true;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: number | null = null;
      let subscription: { unsubscribe(): void } | null = null;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        if (timer !== null) window.clearTimeout(timer);
        subscription?.unsubscribe();
        resolve(value);
      };
      subscription = campaigns.findOne(this.campaignId).$.subscribe((document: unknown) => {
        if (document) finish(true);
      });
      if (settled) {
        subscription?.unsubscribe();
        return;
      }
      timer = window.setTimeout(() => finish(false), timeoutMs);
    });
  }

  private async mutateDocument(collectionName: RxdbCollectionName, id: string, updater: (document: any) => any) {
    if (!this.collections) throw new Error("rxdb_not_initialized");
    const collection = this.collections[collectionName];
    const existing = await collection.findOne(id).exec();
    const current = existing ? existing.toJSON() as RxdbDocument : null;
    const next = updater(current);
    if (!next) {
      if (existing) await existing.remove();
      return;
    }
    await collection.upsert(withoutRxdbMetadata(next));
  }

  async applyMutation(mutation: DurableCampaignMutation) {
    if (!this.collections) throw new Error("rxdb_not_initialized");
    const now = mutation.createdAt;
    switch (mutation.type) {
      case "campaign.rename":
        return this.mutateDocument("campaigns", mutation.campaignId, (current) => current ? { ...current, name: mutation.payload.name, updatedAt: now } : current);
      case "campaign.set-default-map-view":
        return this.mutateDocument("campaigns", mutation.campaignId, (current) => current ? { ...current, defaultMapView: mutation.payload.defaultMapView, updatedAt: now } : current);
      case "team.create":
        return this.mutateDocument("teams", mutation.payload.teamId, () => ({ id: mutation.payload.teamId, campaignId: mutation.campaignId, name: mutation.payload.name, color: mutation.payload.color, createdAt: now, updatedAt: now } as RxdbDocument));
      case "team.update":
        return this.mutateDocument("teams", mutation.payload.teamId, (current) => current ? { ...current, ...(mutation.payload.name !== undefined ? { name: mutation.payload.name } : {}), ...(mutation.payload.color !== undefined ? { color: mutation.payload.color } : {}), updatedAt: now } : current);
      case "team.delete":
        return this.mutateDocument("teams", mutation.payload.teamId, () => null);
      case "area.create":
        return this.mutateDocument("areas", mutation.payload.areaId, () => ({ id: mutation.payload.areaId, campaignId: mutation.campaignId, teamId: mutation.payload.teamId, name: mutation.payload.name, geometry: mutation.payload.geometry, createdAt: now, updatedAt: now } as RxdbDocument));
      case "area.rename":
        return this.mutateDocument("areas", mutation.payload.areaId, (current) => current ? { ...current, name: mutation.payload.name, updatedAt: now } : current);
      case "area.set-team":
        return this.mutateDocument("areas", mutation.payload.areaId, (current) => current ? { ...current, teamId: mutation.payload.teamId, updatedAt: now } : current);
      case "area.update-geometry":
        return this.mutateDocument("areas", mutation.payload.areaId, (current) => current ? { ...current, geometry: mutation.payload.geometry, updatedAt: now } : current);
      case "area.delete":
        await this.mutateDocument("areas", mutation.payload.areaId, () => null);
        await Promise.all([
          this.collections.streetTasks.find({ selector: { campaignId: mutation.campaignId, areaId: mutation.payload.areaId } }).remove(),
          this.collections.houseTasks.find({ selector: { campaignId: mutation.campaignId, areaId: mutation.payload.areaId } }).remove(),
        ]);
        return;
      case "task.create":
        return this.mutateDocument("streetTasks", mutation.payload.taskId, () => ({ id: mutation.payload.taskId, campaignId: mutation.campaignId, areaId: mutation.payload.areaId, taskType: "street", label: mutation.payload.label, geometry: mutation.payload.geometry, ...(mutation.payload.source ? { source: mutation.payload.source } : {}), areaPreparationGeneration: null, status: "open", completedAt: null, createdAt: now, updatedAt: now } as RxdbDocument));
      case "task.rename":
        return this.mutateDocument("streetTasks", mutation.payload.taskId, (current) => current ? { ...current, label: mutation.payload.label, updatedAt: now } : current);
      case "task.set-status":
        return this.mutateDocument("streetTasks", mutation.payload.taskId, (current) => current ? { ...current, status: mutation.payload.status, completedAt: mutation.payload.completedAt, updatedAt: now } : current);
      case "task.delete":
        return this.mutateDocument("streetTasks", mutation.payload.taskId, () => null);
      case "house.create":
        return this.mutateDocument("houseTasks", mutation.payload.taskId, () => ({ id: mutation.payload.taskId, campaignId: mutation.campaignId, areaId: mutation.payload.areaId, taskType: "house", label: mutation.payload.label, geometry: mutation.payload.geometry, ...(mutation.payload.source ? { source: mutation.payload.source } : {}), areaPreparationGeneration: null, parentStreetTaskId: mutation.payload.parentStreetTaskId, status: "open", completedAt: null, createdAt: now, updatedAt: now } as RxdbDocument));
      case "house.create-batch":
        await Promise.all(mutation.payload.houses.map((house) => this.mutateDocument("houseTasks", house.taskId, () => ({ id: house.taskId, campaignId: mutation.campaignId, areaId: house.areaId, taskType: "house", label: house.label, geometry: house.geometry, ...(house.source ? { source: house.source } : {}), areaPreparationGeneration: null, parentStreetTaskId: house.parentStreetTaskId, status: "open", completedAt: null, createdAt: now, updatedAt: now } as RxdbDocument))));
        return;
      case "house.rename":
        return this.mutateDocument("houseTasks", mutation.payload.taskId, (current) => current ? { ...current, label: mutation.payload.label, updatedAt: now } : current);
      case "house.set-status":
        return this.mutateDocument("houseTasks", mutation.payload.taskId, (current) => current ? { ...current, status: mutation.payload.status, completedAt: mutation.payload.completedAt, updatedAt: now } : current);
      case "house.delete":
        return this.mutateDocument("houseTasks", mutation.payload.taskId, () => null);
      default:
        throw new Error("rxdb_collection_mutation_not_supported");
    }
  }

  async destroy() {
    if (typeof window !== "undefined" && this.materializationTimer !== null) window.clearTimeout(this.materializationTimer);
    if (typeof window !== "undefined" && this.safetyTimer !== null) window.clearInterval(this.safetyTimer);
    if (typeof window !== "undefined" && this.socketReconnectTimer !== null) window.clearTimeout(this.socketReconnectTimer);
    this.materializationTimer = null;
    this.safetyTimer = null;
    this.socketReconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try { socket.close(); } catch { /* socket already closed */ }
    }
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    for (const replication of this.replications.values()) await replication.cancel();
    this.replications.clear();
    if (this.database) await this.database.close();
    this.database = null;
    this.collections = null;
    this.initialized = false;
  }
}

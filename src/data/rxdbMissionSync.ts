import { createRxDatabase } from "rxdb";
import type { RxCollection, RxDatabase, RxDocument, RxJsonSchema } from "rxdb";
import { replicateRxCollection } from "rxdb/plugins/replication";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import type { DurableCampaignMutation } from "../domain/durableMutation.ts";
import type { CampaignSnapshot } from "../domain/campaign.ts";
import {
  materializeCampaignSnapshot,
  narrowRxdbDocument,
  withoutRxdbMetadata,
  type RxdbCollectionName,
  type RxdbDocument,
  type RxdbDocumentForCollection,
  type RxdbPullResponse,
  type RxdbPushRow,
} from "./rxdbSyncProtocol.ts";

const PULL_BATCH_SIZE = 100;
const PUSH_BATCH_SIZE = 20;
const REFRESH_POLL_INTERVAL_MS = 50;
const FIELD_GROUP_ACTOR_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const COLLECTION_NAMES = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];

type RxdbCollections = Record<RxdbCollectionName, RxCollection<RxdbDocument>>;
type MissionRxdbDatabase = RxDatabase<RxdbCollections>;
type ReplicationState = {
  active$: { subscribe(handler: (active: boolean) => void): { unsubscribe(): void } };
  error$: { subscribe(handler: (error: unknown) => void): { unsubscribe(): void } };
  received$: { subscribe(handler: () => void): { unsubscribe(): void } };
  sent$: { subscribe(handler: () => void): { unsubscribe(): void } };
  awaitDocumentPushed(document: RxDocument<RxdbDocument>): Promise<void>;
  reSync(): void;
  cancel(): Promise<unknown>;
};
type RxdbReplicationDocument = RxdbDocument & { _deleted: boolean };
type StoredSyncProgress = {
  checkpoints?: Partial<Record<RxdbCollectionName, number>>;
  campaignRevision?: number;
};
type PendingPullProgress = { seq: number; campaignRevision: number };
type RxdbPushProof = { collectionName: RxdbCollectionName; document: RxDocument<RxdbDocument> };
export type RxdbRemoteSyncEvent = "received" | "sent" | "push-pending" | "push-idle";

function withDeletedMarker(document: RxdbDocument): RxdbReplicationDocument {
  return { ...document, _deleted: document._deleted === true } as RxdbReplicationDocument;
}

function safeDatabaseSegment(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function progressStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function replicationErrorDirection(error: unknown): "pull" | "push" | null {
  const value = recordValue(error);
  if (!value) return null;
  if (value.code === "RC_PULL") return "pull";
  if (value.code === "RC_PUSH") return "push";
  const parameters = recordValue(value.parameters);
  return parameters?.direction === "pull" ? "pull" : parameters?.direction === "push" ? "push" : null;
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

export class TrailingPersistenceGate {
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private resolvers: Array<() => void> = [];

  private release() {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    const resolvers = this.resolvers.splice(0);
    for (const pending of resolvers) pending();
  }

  wait() {
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
      if (this.timer !== null) globalThis.clearTimeout(this.timer);
      this.timer = globalThis.setTimeout(() => this.release(), 900);
    });
  }

  flush() {
    this.release();
  }
}

const objectSchema = { type: "object", additionalProperties: true } as const;
const nullableObjectSchema = { anyOf: [objectSchema, { type: "null" }] } as const;
const nullableStringSchema = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

type RxdbSchemaMap = {
  [N in RxdbCollectionName]: RxJsonSchema<Omit<RxdbDocumentForCollection<N>, "_deleted" | "_rev" | "_meta" | "_attachments">>;
};

const schemas: RxdbSchemaMap = {
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
  private readonly actorScopeId: string | null;
  private readonly replicaScope: string;
  private readonly progressKey: string;
  private readonly collectionFallback: CampaignSnapshot["collection"];
  private readonly storage: any;
  private readonly multiInstance: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly onSnapshot: (snapshot: CampaignSnapshot) => void;
  private readonly onIssue: (issue: RxdbSyncIssue) => void;
  private readonly onRemoteEvent: (event: RxdbRemoteSyncEvent) => void;
  private database: MissionRxdbDatabase | null = null;
  private collections: RxdbCollections | null = null;
  private readonly replications = new Map<RxdbCollectionName, ReplicationState>();
  private readonly checkpoints = new Map<RxdbCollectionName, number>();
  private readonly pendingPullProgress = new Map<RxdbCollectionName, PendingPullProgress>();
  private readonly pullApplyFailures = new Set<RxdbCollectionName>();
  private readonly subscriptions: Array<{ unsubscribe(): void }> = [];
  private materializationTimer: number | null = null;
  private safetyTimer: number | null = null;
  private socketReconnectTimer: number | null = null;
  private socket: WebSocket | null = null;
  private socketReconnectDelay = 2_000;
  private initialized = false;
  private canonicalRevision = 0;
  private readonly pendingPushProofs = new Map<string, number>();
  private pushProofGeneration = 0;
  private readonly persistenceGates = new Map<RxdbCollectionName, TrailingPersistenceGate>();

  constructor(input: {
    campaignId: string;
    teamScopeId?: string | null;
    actorScopeId?: string | null;
    collectionFallback?: CampaignSnapshot["collection"];
    storage?: any;
    multiInstance?: boolean;
    fetchImpl?: typeof fetch;
    onSnapshot: (snapshot: CampaignSnapshot) => void;
    onIssue: (issue: RxdbSyncIssue) => void;
    onRemoteEvent?: (event: RxdbRemoteSyncEvent) => void;
  }) {
    this.campaignId = input.campaignId;
    this.teamScopeId = input.teamScopeId ?? null;
    this.actorScopeId = input.actorScopeId ?? null;
    if (this.actorScopeId && !FIELD_GROUP_ACTOR_ID_PATTERN.test(this.actorScopeId)) throw new Error("invalid_field_group_actor_scope");
    this.replicaScope = this.actorScopeId
      ? "field-group:" + (this.teamScopeId ?? "unscoped") + ":" + this.actorScopeId
      : this.teamScopeId
        ? "team:" + this.teamScopeId
        : "campaign";
    this.progressKey = "verteil-flyer:rxdb-progress:v1:" + encodeURIComponent(this.campaignId) + ":" + encodeURIComponent(this.replicaScope);
    this.collectionFallback = input.collectionFallback;
    this.storage = input.storage ?? getRxStorageDexie();
    this.multiInstance = input.multiInstance ?? true;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.onSnapshot = input.onSnapshot;
    this.onIssue = input.onIssue;
    this.onRemoteEvent = input.onRemoteEvent ?? (() => undefined);
    this.persistenceGates.set("campaigns", new TrailingPersistenceGate());
    this.persistenceGates.set("teams", new TrailingPersistenceGate());
  }

  private async request<T>(operation: "pull" | "push", collectionName: RxdbCollectionName, body: unknown): Promise<T> {
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
    const payload = await response.json() as { checkpoint?: { seq?: unknown }; campaignRevision?: unknown };
    const seq = payload.checkpoint?.seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
      throw new RxdbSyncHttpError(502, "invalid_checkpoint", "Der Server hat keinen gültigen RxDB-Checkpoint geliefert.");
    }
    const campaignRevision = typeof payload.campaignRevision === "number" && Number.isSafeInteger(payload.campaignRevision) && payload.campaignRevision >= 0
      ? payload.campaignRevision
      : this.canonicalRevision;
    return { seq, campaignRevision };
  }

  private readStoredProgress(): StoredSyncProgress {
    const storage = progressStorage();
    if (!storage) return {};
    try {
      const raw = storage.getItem(this.progressKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const value = parsed as Record<string, unknown>;
      const checkpointsValue = value.checkpoints;
      const checkpoints: Partial<Record<RxdbCollectionName, number>> = {};
      if (checkpointsValue && typeof checkpointsValue === "object" && !Array.isArray(checkpointsValue)) {
        const checkpointRecord = checkpointsValue as Record<string, unknown>;
        for (const collectionName of COLLECTION_NAMES) {
          const seq = checkpointRecord[collectionName];
          if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0) checkpoints[collectionName] = seq;
        }
      }
      const campaignRevision = value.campaignRevision;
      return {
        checkpoints,
        ...(typeof campaignRevision === "number" && Number.isSafeInteger(campaignRevision) && campaignRevision >= 0 ? { campaignRevision } : {}),
      };
    } catch {
      return {};
    }
  }

  private recordPullProgress(collectionName: RxdbCollectionName, seq: number, campaignRevision: number) {
    const current = this.checkpoints.get(collectionName);
    this.checkpoints.set(collectionName, current === undefined ? seq : Math.max(current, seq));
    this.canonicalRevision = Math.max(this.canonicalRevision, campaignRevision);
    const storage = progressStorage();
    if (!storage) return;
    try {
      const stored = this.readStoredProgress();
      const checkpoints = { ...(stored.checkpoints ?? {}) };
      checkpoints[collectionName] = Math.max(checkpoints[collectionName] ?? 0, seq);
      storage.setItem(this.progressKey, JSON.stringify({
        checkpoints,
        campaignRevision: Math.max(stored.campaignRevision ?? 0, campaignRevision),
      } satisfies StoredSyncProgress));
    } catch {
    }
  }

  private queuePullProgress(collectionName: RxdbCollectionName, seq: number, campaignRevision: number) {
    const current = this.pendingPullProgress.get(collectionName);
    this.pendingPullProgress.set(collectionName, {
      seq: Math.max(current?.seq ?? 0, seq),
      campaignRevision: Math.max(current?.campaignRevision ?? 0, campaignRevision),
    });
    this.pullApplyFailures.delete(collectionName);
  }

  private commitAppliedPullProgress(collectionName: RxdbCollectionName) {
    if (this.pullApplyFailures.has(collectionName)) return;
    const pending = this.pendingPullProgress.get(collectionName);
    if (!pending) return;
    this.pendingPullProgress.delete(collectionName);
    this.recordPullProgress(collectionName, pending.seq, pending.campaignRevision);
  }

  private knownCheckpoint(collectionName: RxdbCollectionName) {
    const local = this.checkpoints.get(collectionName);
    const stored = this.readStoredProgress().checkpoints?.[collectionName];
    if (local === undefined) return stored;
    if (stored === undefined) return local;
    return Math.max(local, stored);
  }

  private allCollectionsAtOrBeyond(seq: number) {
    return COLLECTION_NAMES.every((collectionName) => {
      const checkpoint = this.knownCheckpoint(collectionName);
      return checkpoint !== undefined && checkpoint >= seq;
    });
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
    const visibleTeams = this.teamScopeId ? teams.filter((document) => narrowRxdbDocument("teams", document)?.id === this.teamScopeId) : teams;
    const visibleAreas = this.teamScopeId ? areas.filter((document) => narrowRxdbDocument("areas", document)?.teamId === this.teamScopeId) : areas;
    const visibleAreaIds = new Set(visibleAreas.map((document) => document.id));
    const visibleStreetTasks = this.teamScopeId ? streetTasks.filter((document) => visibleAreaIds.has(narrowRxdbDocument("streetTasks", document)?.areaId ?? "")) : streetTasks;
    const visibleHouseTasks = this.teamScopeId ? houseTasks.filter((document) => visibleAreaIds.has(narrowRxdbDocument("houseTasks", document)?.areaId ?? "")) : houseTasks;
    const campaign = campaigns[0] ? narrowRxdbDocument("campaigns", campaigns[0].toJSON()) : null;
    const teamDocuments = visibleTeams.flatMap((document) => { const value = narrowRxdbDocument("teams", document.toJSON()); return value ? [value] : []; });
    const areaDocuments = visibleAreas.flatMap((document) => { const value = narrowRxdbDocument("areas", document.toJSON()); return value ? [value] : []; });
    const streetTaskDocuments = visibleStreetTasks.flatMap((document) => { const value = narrowRxdbDocument("streetTasks", document.toJSON()); return value ? [value] : []; });
    const houseTaskDocuments = visibleHouseTasks.flatMap((document) => { const value = narrowRxdbDocument("houseTasks", document.toJSON()); return value ? [value] : []; });
    const snapshot = materializeCampaignSnapshot({
      revision: this.canonicalRevision,
      campaign,
      teams: teamDocuments,
      areas: areaDocuments,
      streetTasks: streetTaskDocuments,
      houseTasks: houseTaskDocuments,
      collection: this.collectionFallback,
    });
    if (snapshot) this.onSnapshot(snapshot);
  }

  private trackPushProofs(proofs: RxdbPushProof[]) {
    if (proofs.length === 0) return;
    for (const proof of proofs) {
      const replication = this.replications.get(proof.collectionName);
      const proofKey = proof.collectionName + ":" + proof.document.primary;
      const generation = ++this.pushProofGeneration;
      this.pendingPushProofs.set(proofKey, generation);
      if (!replication) {
        this.onIssue({ kind: "network", collectionName: proof.collectionName, documentId: proof.document.primary, code: "rxdb_replication_missing" });
        continue;
      }
      void replication.awaitDocumentPushed(proof.document)
        .then(() => {
          if (this.pendingPushProofs.get(proofKey) !== generation) return;
          this.pendingPushProofs.delete(proofKey);
          if (this.initialized && this.pendingPushProofs.size === 0) this.onRemoteEvent("push-idle");
        })
        .catch((error: unknown) => {
          if (this.pendingPushProofs.get(proofKey) !== generation) return;
          this.pendingPushProofs.delete(proofKey);
          const code = error instanceof Error ? error.message : "rxdb_push_confirmation_failed";
          this.onIssue({ kind: "network", collectionName: proof.collectionName, documentId: proof.document.primary, code });
        });
    }
    this.onRemoteEvent("push-pending");
  }

  private createReplication(collectionName: RxdbCollectionName) {
    const collection = this.collections?.[collectionName];
    if (!collection) throw new Error("rxdb_collection_missing");
    const persistenceGate = this.persistenceGates.get(collectionName);
    const replication = replicateRxCollection<RxdbDocument, { seq: number }>({
      replicationIdentifier: "mission-rxdb-sync-v1:" + this.campaignId + ":" + this.replicaScope + ":" + collectionName,
      collection,
      pull: {
        batchSize: PULL_BATCH_SIZE,
        handler: async (checkpoint: { seq: number } | undefined, batchSize: number) => {
          const result = await this.request<RxdbPullResponse>("pull", collectionName, { checkpoint: checkpoint ?? null, batchSize });
          this.queuePullProgress(collectionName, result.checkpoint.seq, result.campaignRevision);
          return { documents: result.documents.map(withDeletedMarker), checkpoint: result.checkpoint };
        },
      },
      push: {
        batchSize: PUSH_BATCH_SIZE,
        ...(persistenceGate ? { waitBeforePersist: () => persistenceGate.wait() } : {}),
        handler: async (rows: RxdbPushRow[]) => {
          const result = await this.request<{ conflicts: RxdbDocument[]; rejections: Array<{ documentId: string; code: string }> }>("push", collectionName, {
            rows: rows.map((row) => ({
              ...(row.assumedMasterState ? { assumedMasterState: asWireDocument(row.assumedMasterState) } : {}),
              newDocumentState: asWireDocument(row.newDocumentState),
            })),
          });
          for (const rejection of result.rejections) this.onIssue({ kind: "rejected", collectionName, documentId: rejection.documentId, code: rejection.code });
          return result.conflicts.map(withDeletedMarker);
        },
      },
      live: true,
      retryTime: 2_000,
      waitForLeadership: true,
      toggleOnDocumentVisible: true,
    });
    this.subscriptions.push(
      replication.active$.subscribe((active: boolean) => {
        if (!active) this.commitAppliedPullProgress(collectionName);
      }),
      replication.error$.subscribe((error: unknown) => {
        if (replicationErrorDirection(error) === "pull") this.pullApplyFailures.add(collectionName);
        const message = error instanceof Error ? error.message : "rxdb_replication_error";
        const details = (() => { try { return JSON.stringify(error); } catch { return message; } })();
        const code = error instanceof RxdbSyncHttpError ? error.code : message + details;
        this.onIssue({ kind: code.includes("rxdb_sync_schema_unavailable") ? "schema" : "network", collectionName, code });
      }),
      replication.received$.subscribe(() => {
        this.onRemoteEvent("received");
        this.scheduleMaterialization();
      }),
      replication.sent$.subscribe(() => {
        this.onRemoteEvent("sent");
        this.scheduleMaterialization();
      }),
    );
    this.replications.set(collectionName, replication);
  }

  private connectSocket() {
    if (!this.initialized || this.socket || typeof window === "undefined" || typeof location === "undefined") return;
    const WebSocketConstructor = (globalThis as typeof globalThis & { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WebSocketConstructor) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocketConstructor(protocol + "//" + location.host + realtimePath(this.campaignId));
    this.socket = socket;
    socket.onopen = () => { this.socketReconnectDelay = 2_000; };
    socket.onmessage = (event) => {
      let payload: unknown;
      try { payload = typeof event.data === "string" ? JSON.parse(event.data) : null; } catch { return; }
      if (!payload || typeof payload !== "object") return;
      const value = payload as Record<string, unknown>;
      const seq = value.seq;
      if (value.type === "changed" && typeof seq === "number" && Number.isSafeInteger(seq) && seq > this.minimumKnownCheckpoint()) this.refresh();
    };
    socket.onerror = () => { try { socket.close(); } catch {} };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.initialized || typeof window === "undefined" || this.socketReconnectTimer !== null) return;
      const delay = this.socketReconnectDelay;
      this.socketReconnectDelay = Math.min(30_000, this.socketReconnectDelay * 2);
      this.socketReconnectTimer = window.setTimeout(() => { this.socketReconnectTimer = null; this.connectSocket(); }, delay);
    };
  }

  private minimumKnownCheckpoint() {
    let minimum = Number.POSITIVE_INFINITY;
    for (const collectionName of COLLECTION_NAMES) {
      minimum = Math.min(minimum, this.knownCheckpoint(collectionName) ?? 0);
    }
    return Number.isFinite(minimum) ? minimum : 0;
  }

  async safetyResync() {
    if (!this.initialized) return;
    try {
      const checkpoint = await this.requestCheckpoint();
      const storedRevision = this.readStoredProgress().campaignRevision ?? this.canonicalRevision;
      if (checkpoint.seq > this.minimumKnownCheckpoint() || checkpoint.campaignRevision > Math.max(this.canonicalRevision, storedRevision)) this.refresh();
    } catch (error) {
      const code = error instanceof RxdbSyncHttpError ? error.code : "rxdb_checkpoint_failed";
      this.onIssue({ kind: code.includes("schema_unavailable") ? "schema" : "network", code });
    }
  }

  async start() {
    if (this.initialized) return;
    const actorSuffix = this.actorScopeId ? "-actor-" + safeDatabaseSegment(this.actorScopeId) : "";
    this.database = await createRxDatabase({
      name: "verteil-flyer-mission-rxdb-v1-" + this.campaignId + (this.teamScopeId ? "-field-group-" + this.teamScopeId + actorSuffix : ""),
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
    if (typeof window !== "undefined") this.safetyTimer = window.setInterval(() => { void this.safetyResync(); }, 45_000);
    this.connectSocket();
    this.scheduleMaterialization();
  }

  refresh() {
    this.connectSocket();
    for (const replication of this.replications.values()) replication.reSync();
  }

  async refreshAndWait(timeoutMs = 15_000) {
    if (!this.initialized) throw new RxdbSyncHttpError(0, "rxdb_not_initialized", "RxDB-Synchronisation ist noch nicht gestartet.");
    const target = await this.requestCheckpoint();
    this.refresh();
    if (this.allCollectionsAtOrBeyond(target.seq)) {
      this.canonicalRevision = Math.max(this.canonicalRevision, target.campaignRevision);
      this.scheduleMaterialization();
      return target;
    }

    return await new Promise<{ seq: number; campaignRevision: number }>((resolve, reject) => {
      const deadline = Date.now() + Math.max(1, timeoutMs);
      const temporarySubscriptions: Array<{ unsubscribe(): void }> = [];
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const onStorage = (event: StorageEvent) => {
        if (event.key === this.progressKey) check();
      };
      const cleanup = () => {
        if (pollTimer !== null) clearTimeout(pollTimer);
        for (const subscription of temporarySubscriptions) subscription.unsubscribe();
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("storage", onStorage);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.canonicalRevision = Math.max(this.canonicalRevision, target.campaignRevision);
        this.scheduleMaterialization();
        resolve(target);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new RxdbSyncHttpError(0, "rxdb_refresh_failed", "RxDB-Aktualisierung ist fehlgeschlagen."));
      };
      const check = () => {
        if (settled) return;
        if (!this.initialized) {
          fail(new RxdbSyncHttpError(0, "rxdb_refresh_cancelled", "RxDB-Aktualisierung wurde beendet."));
          return;
        }
        if (this.allCollectionsAtOrBeyond(target.seq)) {
          finish();
          return;
        }
        if (Date.now() >= deadline) {
          fail(new RxdbSyncHttpError(0, "rxdb_refresh_timeout", "Nicht alle Datenbereiche konnten rechtzeitig bestätigt werden."));
          return;
        }
        pollTimer = setTimeout(check, REFRESH_POLL_INTERVAL_MS);
      };
      for (const replication of this.replications.values()) {
        temporarySubscriptions.push(
          replication.received$.subscribe(check),
          replication.sent$.subscribe(check),
          replication.error$.subscribe((error: unknown) => fail(error)),
        );
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("storage", onStorage);
      check();
    });
  }

  flushDebouncedWrites() {
    this.persistenceGates.get("campaigns")?.flush();
    this.persistenceGates.get("teams")?.flush();
    this.refresh();
  }

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
      subscription = campaigns.findOne(this.campaignId).$.subscribe((document: unknown) => { if (document) finish(true); });
      if (settled) { subscription?.unsubscribe(); return; }
      timer = window.setTimeout(() => finish(false), timeoutMs);
    });
  }

  private async mutateDocument<N extends RxdbCollectionName>(collectionName: N, id: string, updater: (document: RxdbDocumentForCollection<N> | null) => RxdbDocumentForCollection<N> | null): Promise<RxdbPushProof[]> {
    if (!this.collections) throw new Error("rxdb_not_initialized");
    const collection = this.collections[collectionName];
    const existing = await collection.findOne(id).exec();
    const current = existing ? existing.toJSON() as RxdbDocumentForCollection<N> : null;
    const next = updater(current);
    if (!next) {
      if (!existing) return [];
      const removed = await existing.remove();
      return [{ collectionName, document: removed }];
    }
    const document = await collection.upsert(withoutRxdbMetadata(next));
    return [{ collectionName, document }];
  }

  async applyMutation(mutation: DurableCampaignMutation) {
    if (!this.collections) throw new Error("rxdb_not_initialized");
    const now = mutation.createdAt;
    let proofs: RxdbPushProof[];
    switch (mutation.type) {
      case "campaign.rename": proofs = await this.mutateDocument("campaigns", mutation.campaignId, (current) => current ? { ...current, name: mutation.payload.name, updatedAt: now } : current); break;
      case "campaign.set-default-map-view": proofs = await this.mutateDocument("campaigns", mutation.campaignId, (current) => current ? { ...current, defaultMapView: mutation.payload.defaultMapView, updatedAt: now } : current); break;
      case "team.create": proofs = await this.mutateDocument("teams", mutation.payload.teamId, () => ({ id: mutation.payload.teamId, campaignId: mutation.campaignId, name: mutation.payload.name, color: mutation.payload.color, createdAt: now, updatedAt: now } satisfies RxdbDocumentForCollection<"teams">)); break;
      case "team.update": proofs = await this.mutateDocument("teams", mutation.payload.teamId, (current) => current ? { ...current, ...(mutation.payload.name !== undefined ? { name: mutation.payload.name } : {}), ...(mutation.payload.color !== undefined ? { color: mutation.payload.color } : {}), updatedAt: now } : current); break;
      case "team.delete": proofs = await this.mutateDocument("teams", mutation.payload.teamId, () => null); break;
      case "area.create": proofs = await this.mutateDocument("areas", mutation.payload.areaId, () => ({ id: mutation.payload.areaId, campaignId: mutation.campaignId, teamId: mutation.payload.teamId, name: mutation.payload.name, geometry: mutation.payload.geometry, createdAt: now, updatedAt: now } satisfies RxdbDocumentForCollection<"areas">)); break;
      case "area.rename": proofs = await this.mutateDocument("areas", mutation.payload.areaId, (current) => current ? { ...current, name: mutation.payload.name, updatedAt: now } : current); break;
      case "area.set-team": proofs = await this.mutateDocument("areas", mutation.payload.areaId, (current) => current ? { ...current, teamId: mutation.payload.teamId, updatedAt: now } : current); break;
      case "area.update-geometry": proofs = await this.mutateDocument("areas", mutation.payload.areaId, (current) => current ? { ...current, geometry: mutation.payload.geometry, updatedAt: now } : current); break;
      case "area.delete": {
        proofs = await this.mutateDocument("areas", mutation.payload.areaId, () => null);
        const [streetDocuments, houseDocuments] = await Promise.all([
          this.collections.streetTasks.find({ selector: { campaignId: mutation.campaignId, areaId: mutation.payload.areaId } }).exec(),
          this.collections.houseTasks.find({ selector: { campaignId: mutation.campaignId, areaId: mutation.payload.areaId } }).exec(),
        ]);
        const [removedStreetTasks, removedHouseTasks] = await Promise.all([
          Promise.all(streetDocuments.map((document) => document.remove())),
          Promise.all(houseDocuments.map((document) => document.remove())),
        ]);
        proofs.push(
          ...removedStreetTasks.map((document) => ({ collectionName: "streetTasks" as const, document })),
          ...removedHouseTasks.map((document) => ({ collectionName: "houseTasks" as const, document })),
        );
        break;
      }
      case "task.create": proofs = await this.mutateDocument("streetTasks", mutation.payload.taskId, () => ({ id: mutation.payload.taskId, campaignId: mutation.campaignId, areaId: mutation.payload.areaId, taskType: "street", label: mutation.payload.label, geometry: mutation.payload.geometry, ...(mutation.payload.source ? { source: mutation.payload.source } : {}), areaPreparationGeneration: null, status: "open", completedAt: null, createdAt: now, updatedAt: now } satisfies RxdbDocumentForCollection<"streetTasks">)); break;
      case "task.rename": proofs = await this.mutateDocument("streetTasks", mutation.payload.taskId, (current) => current ? { ...current, label: mutation.payload.label, updatedAt: now } : current); break;
      case "task.set-status": proofs = await this.mutateDocument("streetTasks", mutation.payload.taskId, (current) => current ? { ...current, status: mutation.payload.status, completedAt: mutation.payload.completedAt, updatedAt: now } : current); break;
      case "task.delete": proofs = await this.mutateDocument("streetTasks", mutation.payload.taskId, () => null); break;
      case "house.create": proofs = await this.mutateDocument("houseTasks", mutation.payload.taskId, () => ({ id: mutation.payload.taskId, campaignId: mutation.campaignId, areaId: mutation.payload.areaId, taskType: "house", label: mutation.payload.label, geometry: mutation.payload.geometry, ...(mutation.payload.source ? { source: mutation.payload.source } : {}), areaPreparationGeneration: null, parentStreetTaskId: mutation.payload.parentStreetTaskId, status: "open", completedAt: null, createdAt: now, updatedAt: now } satisfies RxdbDocumentForCollection<"houseTasks">)); break;
      case "house.create-batch": proofs = (await Promise.all(mutation.payload.houses.map((house) => this.mutateDocument("houseTasks", house.taskId, () => ({ id: house.taskId, campaignId: mutation.campaignId, areaId: house.areaId, taskType: "house", label: house.label, geometry: house.geometry, ...(house.source ? { source: house.source } : {}), areaPreparationGeneration: null, parentStreetTaskId: house.parentStreetTaskId, status: "open", completedAt: null, createdAt: now, updatedAt: now } satisfies RxdbDocumentForCollection<"houseTasks">))))).flat(); break;
      case "house.rename": proofs = await this.mutateDocument("houseTasks", mutation.payload.taskId, (current) => current ? { ...current, label: mutation.payload.label, updatedAt: now } : current); break;
      case "house.set-status": proofs = await this.mutateDocument("houseTasks", mutation.payload.taskId, (current) => current ? { ...current, status: mutation.payload.status, completedAt: mutation.payload.completedAt, updatedAt: now } : current); break;
      case "house.delete": proofs = await this.mutateDocument("houseTasks", mutation.payload.taskId, () => null); break;
      default: throw new Error("rxdb_collection_mutation_not_supported");
    }
    this.trackPushProofs(proofs);
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
    if (socket) { try { socket.close(); } catch {} }
    for (const subscription of this.subscriptions.splice(0)) subscription.unsubscribe();
    for (const replication of this.replications.values()) await replication.cancel();
    this.replications.clear();
    this.pendingPullProgress.clear();
    this.pullApplyFailures.clear();
    this.pendingPushProofs.clear();
    for (const gate of this.persistenceGates.values()) gate.flush();
    if (this.database) await this.database.close();
    this.database = null;
    this.collections = null;
    this.initialized = false;
  }
}
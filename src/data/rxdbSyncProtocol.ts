import type {
  Area,
  Campaign,
  CampaignSnapshot,
  DistributionTask,
  HouseTask,
  Team,
} from "../domain/campaign.ts";

export const RXDB_COLLECTION_NAMES = [
  "campaigns",
  "teams",
  "areas",
  "streetTasks",
  "houseTasks",
] as const;

export type RxdbCollectionName = (typeof RXDB_COLLECTION_NAMES)[number];
export type RxdbCheckpoint = { seq: number };

/**
 * The RxDB document is deliberately the persisted entity, never a Campaign
 * snapshot. RxDB-owned revision metadata is allowed on the wire but stripped
 * before a document reaches the domain/Worker layer.
 */
export type RxdbDocumentBase = {
  id: string;
  campaignId: string;
  _deleted?: boolean;
  _rev?: string;
  _meta?: unknown;
  _attachments?: unknown;
};

export type RxdbCampaignDocument = Campaign & RxdbDocumentBase;
export type RxdbTeamDocument = Team & RxdbDocumentBase;
export type RxdbAreaDocument = Area & RxdbDocumentBase;
export type RxdbStreetTaskDocument = DistributionTask & RxdbDocumentBase;
export type RxdbHouseTaskDocument = HouseTask & RxdbDocumentBase;

/**
 * The collection name is the wire-level discriminator.  It is kept outside
 * the persisted document so the existing RxDB schemas and D1 feed remain
 * backwards compatible, while callers still get collection-specific fields.
 */
export type RxdbDocumentMap = {
  campaigns: RxdbCampaignDocument;
  teams: RxdbTeamDocument;
  areas: RxdbAreaDocument;
  streetTasks: RxdbStreetTaskDocument;
  houseTasks: RxdbHouseTaskDocument;
};

export type RxdbDocumentForCollection<N extends RxdbCollectionName> = RxdbDocumentMap[N];
export type RxdbDocument = RxdbDocumentForCollection<RxdbCollectionName>;

export type RxdbPushRow<N extends RxdbCollectionName = RxdbCollectionName> = {
  assumedMasterState?: RxdbDocumentForCollection<N>;
  newDocumentState: RxdbDocumentForCollection<N>;
};

export type RxdbChangeFeedEntry<N extends RxdbCollectionName = RxdbCollectionName> = {
  collectionName: N;
  document: RxdbDocumentForCollection<N>;
  scopeTeamId: string | null;
};

export type RxdbPullResponse = {
  documents: RxdbDocument[];
  checkpoint: RxdbCheckpoint;
  /** D1 Campaign revision; deliberately separate from the feed seq checkpoint. */
  campaignRevision: number;
};

export function isRxdbCollectionName(value: unknown): value is RxdbCollectionName {
  return typeof value === "string" && (RXDB_COLLECTION_NAMES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string";
}

function isCampaignDocument(value: unknown): value is RxdbCampaignDocument {
  if (!isRecord(value)) return false;
  return hasString(value, "id") && hasString(value, "campaignId") && hasString(value, "name") &&
    hasString(value, "status") && "defaultMapView" in value && hasString(value, "createdAt") &&
    hasString(value, "updatedAt");
}

function isTeamDocument(value: unknown): value is RxdbTeamDocument {
  if (!isRecord(value)) return false;
  return hasString(value, "id") && hasString(value, "campaignId") && hasString(value, "name") &&
    hasString(value, "color") && hasString(value, "createdAt") && hasString(value, "updatedAt");
}

function isAreaDocument(value: unknown): value is RxdbAreaDocument {
  if (!isRecord(value)) return false;
  return hasString(value, "id") && hasString(value, "campaignId") && hasString(value, "teamId") &&
    hasString(value, "name") && "geometry" in value && hasString(value, "createdAt") &&
    hasString(value, "updatedAt");
}

function isStreetTaskDocument(value: unknown): value is RxdbStreetTaskDocument {
  if (!isRecord(value)) return false;
  return hasString(value, "id") && hasString(value, "campaignId") && hasString(value, "areaId") &&
    value.taskType === "street" && hasString(value, "label") && "geometry" in value &&
    hasString(value, "status") && "completedAt" in value && hasString(value, "createdAt") &&
    hasString(value, "updatedAt");
}

function isHouseTaskDocument(value: unknown): value is RxdbHouseTaskDocument {
  if (!isRecord(value)) return false;
  return hasString(value, "id") && hasString(value, "campaignId") && hasString(value, "areaId") &&
    value.taskType === "house" && hasString(value, "label") && "geometry" in value &&
    "parentStreetTaskId" in value && hasString(value, "status") && "completedAt" in value &&
    hasString(value, "createdAt") && hasString(value, "updatedAt");
}

/**
 * Narrows the transport union after the collection name has been validated.
 * The collection name is the discriminator; no synthetic field is written to
 * the existing RxDB documents just to satisfy TypeScript.
 */
export function narrowRxdbDocument(
  collectionName: "campaigns",
  document: unknown,
): RxdbCampaignDocument | null;
export function narrowRxdbDocument(
  collectionName: "teams",
  document: unknown,
): RxdbTeamDocument | null;
export function narrowRxdbDocument(
  collectionName: "areas",
  document: unknown,
): RxdbAreaDocument | null;
export function narrowRxdbDocument(
  collectionName: "streetTasks",
  document: unknown,
): RxdbStreetTaskDocument | null;
export function narrowRxdbDocument(
  collectionName: "houseTasks",
  document: unknown,
): RxdbHouseTaskDocument | null;
export function narrowRxdbDocument(
  collectionName: RxdbCollectionName,
  document: unknown,
): RxdbDocument | null;
export function narrowRxdbDocument(
  collectionName: RxdbCollectionName,
  document: unknown,
): RxdbDocument | null {
  switch (collectionName) {
    case "campaigns":
      return isCampaignDocument(document) ? document : null;
    case "teams":
      return isTeamDocument(document) ? document : null;
    case "areas":
      return isAreaDocument(document) ? document : null;
    case "streetTasks":
      return isStreetTaskDocument(document) ? document : null;
    case "houseTasks":
      return isHouseTaskDocument(document) ? document : null;
  }
}

export function campaignToRxdbDocument(campaign: Campaign): RxdbCampaignDocument {
  return { ...campaign, campaignId: campaign.id };
}

export function documentForCollection(
  collectionName: "campaigns",
  snapshot: CampaignSnapshot,
  id: string,
): RxdbCampaignDocument | null;
export function documentForCollection(
  collectionName: "teams",
  snapshot: CampaignSnapshot,
  id: string,
): RxdbTeamDocument | null;
export function documentForCollection(
  collectionName: "areas",
  snapshot: CampaignSnapshot,
  id: string,
): RxdbAreaDocument | null;
export function documentForCollection(
  collectionName: "streetTasks",
  snapshot: CampaignSnapshot,
  id: string,
): RxdbStreetTaskDocument | null;
export function documentForCollection(
  collectionName: "houseTasks",
  snapshot: CampaignSnapshot,
  id: string,
): RxdbHouseTaskDocument | null;
export function documentForCollection(
  collectionName: RxdbCollectionName,
  snapshot: CampaignSnapshot,
  id: string,
): RxdbDocument | null;
export function documentForCollection(
  collectionName: RxdbCollectionName,
  snapshot: CampaignSnapshot,
  id: string,
): RxdbDocument | null {
  switch (collectionName) {
    case "campaigns":
      return snapshot.campaign.id === id ? campaignToRxdbDocument(snapshot.campaign) : null;
    case "teams":
      return snapshot.teams.find((team) => team.id === id) ?? null;
    case "areas":
      return snapshot.areas.find((area) => area.id === id) ?? null;
    case "streetTasks":
      return snapshot.tasks.find((task) => task.id === id) ?? null;
    case "houseTasks":
      return (snapshot.houseTasks ?? []).find((task) => task.id === id) ?? null;
  }
}

export function documentsForCollection(
  collectionName: "campaigns",
  snapshot: CampaignSnapshot,
): RxdbCampaignDocument[];
export function documentsForCollection(
  collectionName: "teams",
  snapshot: CampaignSnapshot,
): RxdbTeamDocument[];
export function documentsForCollection(
  collectionName: "areas",
  snapshot: CampaignSnapshot,
): RxdbAreaDocument[];
export function documentsForCollection(
  collectionName: "streetTasks",
  snapshot: CampaignSnapshot,
): RxdbStreetTaskDocument[];
export function documentsForCollection(
  collectionName: "houseTasks",
  snapshot: CampaignSnapshot,
): RxdbHouseTaskDocument[];
export function documentsForCollection(
  collectionName: RxdbCollectionName,
  snapshot: CampaignSnapshot,
): RxdbDocument[];
export function documentsForCollection(
  collectionName: RxdbCollectionName,
  snapshot: CampaignSnapshot,
): RxdbDocument[] {
  switch (collectionName) {
    case "campaigns":
      return [campaignToRxdbDocument(snapshot.campaign)];
    case "teams":
      return snapshot.teams;
    case "areas":
      return snapshot.areas;
    case "streetTasks":
      return snapshot.tasks;
    case "houseTasks":
      return snapshot.houseTasks ?? [];
  }
}

export function toDeletedRxdbDocument<N extends RxdbCollectionName>(document: RxdbDocumentForCollection<N>): RxdbDocumentForCollection<N>;
export function toDeletedRxdbDocument(document: RxdbDocument): RxdbDocument;
export function toDeletedRxdbDocument(document: RxdbDocument): RxdbDocument {
  return { ...document, _deleted: true };
}

/** Removes transport metadata before comparing domain content or sending HTTP. */
export function withoutRxdbMetadata(document: RxdbCampaignDocument): RxdbCampaignDocument;
export function withoutRxdbMetadata(document: RxdbTeamDocument): RxdbTeamDocument;
export function withoutRxdbMetadata(document: RxdbAreaDocument): RxdbAreaDocument;
export function withoutRxdbMetadata(document: RxdbStreetTaskDocument): RxdbStreetTaskDocument;
export function withoutRxdbMetadata(document: RxdbHouseTaskDocument): RxdbHouseTaskDocument;
export function withoutRxdbMetadata<N extends RxdbCollectionName>(document: RxdbDocumentForCollection<N>): RxdbDocumentForCollection<N>;
export function withoutRxdbMetadata(document: RxdbDocument): RxdbDocument;
export function withoutRxdbMetadata(document: RxdbDocument): RxdbDocument {
  const { _deleted, _rev: _rev, _meta: _meta, _attachments: _attachments, ...plain } = document;
  return _deleted ? { ...plain, _deleted: true } : plain;
}

/** Canonical timestamps are server generated, so retry equivalence excludes them. */
export function sameRxdbBusinessDocument(left: RxdbDocument, right: RxdbDocument) {
  const normalize = (document: RxdbDocument) => {
    const { createdAt: _createdAt, updatedAt: _updatedAt, _deleted, _rev, _meta, _attachments, ...value } = document;
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function materializeCampaignSnapshot(input: {
  revision: number;
  campaign: RxdbCampaignDocument | null;
  teams: RxdbTeamDocument[];
  areas: RxdbAreaDocument[];
  streetTasks: RxdbStreetTaskDocument[];
  houseTasks: RxdbHouseTaskDocument[];
  collection?: CampaignSnapshot["collection"];
}): CampaignSnapshot | null {
  if (!input.campaign || input.campaign._deleted) return null;
  const campaign = input.campaign;
  const { campaignId: _campaignId, _deleted: _deleted, _rev: _rev, _meta: _meta, _attachments: _attachments, ...domainCampaign } = campaign;
  const sortByCreated = <T extends { createdAt: string; id: string; _deleted?: boolean }>(values: T[]) =>
    values.filter((value) => !value._deleted).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );

  return {
    schemaVersion: 3,
    revision: input.revision,
    campaign: domainCampaign,
    teams: sortByCreated(input.teams).map((document) => withoutRxdbMetadata(document)),
    areas: sortByCreated(input.areas).map((document) => withoutRxdbMetadata(document)),
    tasks: sortByCreated(input.streetTasks).map((document) => withoutRxdbMetadata(document)),
    houseTasks: sortByCreated(input.houseTasks).map((document) => withoutRxdbMetadata(document)),
    ...(input.collection ? { collection: input.collection } : {}),
  };
}

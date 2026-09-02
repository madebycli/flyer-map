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
export type RxdbDocument =
  | RxdbCampaignDocument
  | RxdbTeamDocument
  | RxdbAreaDocument
  | RxdbStreetTaskDocument
  | RxdbHouseTaskDocument;

export type RxdbPushRow = {
  assumedMasterState?: RxdbDocument;
  newDocumentState: RxdbDocument;
};

export type RxdbChangeFeedEntry = {
  collectionName: RxdbCollectionName;
  document: RxdbDocument;
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

export function campaignToRxdbDocument(campaign: Campaign): RxdbCampaignDocument {
  return { ...campaign, campaignId: campaign.id };
}

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

export function toDeletedRxdbDocument(document: RxdbDocument): RxdbDocument {
  return { ...document, _deleted: true };
}

/** Removes transport metadata before comparing domain content or sending HTTP. */
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
    teams: sortByCreated(input.teams).map(withoutRxdbMetadata) as Team[],
    areas: sortByCreated(input.areas).map(withoutRxdbMetadata) as Area[],
    tasks: sortByCreated(input.streetTasks).map(withoutRxdbMetadata) as DistributionTask[],
    houseTasks: sortByCreated(input.houseTasks).map(withoutRxdbMetadata) as HouseTask[],
    ...(input.collection ? { collection: input.collection } : {}),
  };
}

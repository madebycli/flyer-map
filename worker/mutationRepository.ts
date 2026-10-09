import type { CampaignMutation, CollectionMutation } from "../src/domain/mutations.ts";
import {
  getCampaignRevision,
  hasCollectionSchema,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from "./campaignRepository.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";
import { collectionMutationStatements } from "./collectionMutationRepository.ts";

export type AppliedMutation = {
  mutationType: CampaignMutation["type"];
  mutationFingerprint: string;
  appliedRevision: number;
};

export type MutationPersistenceResult =
  | { ok: true; revision: number; alreadyApplied: boolean }
  | {
      ok: false;
      currentRevision: number | null;
      reason: "revision_conflict" | "mutation_id_reused" | "schema_migration_required";
    };

export type TeamDeleteBlocker =
  | "team_delete_has_areas"
  | "team_delete_has_field_groups"
  | "team_delete_has_sessions"
  | "team_delete_has_history"
  | "team_delete_has_access_grants"
  | "team_delete_schema_unavailable";

const TEAM_DELETE_TABLE_INFO_SQL = {
  areas: "PRAGMA table_info(areas)",
  field_groups: "PRAGMA table_info(field_groups)",
  field_sessions: "PRAGMA table_info(field_sessions)",
  domain_events: "PRAGMA table_info(domain_events)",
  campaign_access_grants: "PRAGMA table_info(campaign_access_grants)",
} as const;

type TeamDeleteDependencyTable = keyof typeof TEAM_DELETE_TABLE_INFO_SQL;

async function tableHasColumns(
  db: D1DatabaseLike,
  table: TeamDeleteDependencyTable,
  required: string[],
) {
  try {
    const result = await db.prepare(TEAM_DELETE_TABLE_INFO_SQL[table]).all<{ name: string }>();
    const columns = new Set(result.results.map((column) => column.name));
    return required.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

async function tableHasRows(
  db: D1DatabaseLike,
  table: TeamDeleteDependencyTable,
  requiredColumns: string[],
  query: string,
  values: unknown[],
) {
  if (!(await tableHasColumns(db, table, requiredColumns))) return "schema" as const;
  try {
    return (await db.prepare(query).bind(...values).first<{ present: number }>()) ? "present" as const : "none" as const;
  } catch {
    return "schema" as const;
  }
}

/** Fail closed: a Team is removed only when no canonical D1 dependency remains. */
export async function teamDeleteBlocker(
  db: D1DatabaseLike,
  campaignId: string,
  teamId: string,
): Promise<TeamDeleteBlocker | null> {
  const checks: Array<[TeamDeleteBlocker, TeamDeleteDependencyTable, string[], string, unknown[]]> = [
    ["team_delete_has_areas", "areas", ["campaign_id", "team_id"], "SELECT 1 AS present FROM areas WHERE campaign_id = ? AND team_id = ? LIMIT 1", [campaignId, teamId]],
    ["team_delete_has_field_groups", "field_groups", ["campaign_id", "team_id"], "SELECT 1 AS present FROM field_groups WHERE campaign_id = ? AND team_id = ? LIMIT 1", [campaignId, teamId]],
    ["team_delete_has_sessions", "field_sessions", ["campaign_id", "team_id"], "SELECT 1 AS present FROM field_sessions WHERE campaign_id = ? AND team_id = ? LIMIT 1", [campaignId, teamId]],
    ["team_delete_has_history", "domain_events", ["campaign_id", "team_id"], "SELECT 1 AS present FROM domain_events WHERE campaign_id = ? AND team_id = ? LIMIT 1", [campaignId, teamId]],
    ["team_delete_has_access_grants", "campaign_access_grants", ["campaign_id", "team_id", "revoked_at"], "SELECT 1 AS present FROM campaign_access_grants WHERE campaign_id = ? AND team_id = ? AND revoked_at IS NULL LIMIT 1", [campaignId, teamId]],
  ];
  for (const [blocker, table, columns, query, values] of checks) {
    const result = await tableHasRows(db, table, columns, query, values);
    if (result === "schema") return "team_delete_schema_unavailable";
    if (result === "present") return blocker;
  }
  return null;
}

export async function getAppliedMutation(
  db: D1DatabaseLike,
  campaignId: string,
  mutationId: string,
): Promise<AppliedMutation | null> {
  const row = await db
    .prepare(
      `SELECT mutation_type, mutation_fingerprint, applied_revision
       FROM campaign_mutations
       WHERE campaign_id = ? AND mutation_id = ?`,
    )
    .bind(campaignId, mutationId)
    .first<{
      mutation_type: CampaignMutation["type"];
      mutation_fingerprint: string;
      applied_revision: number;
    }>();

  return row
    ? {
        mutationType: row.mutation_type,
        mutationFingerprint: row.mutation_fingerprint,
        appliedRevision: row.applied_revision,
      }
    : null;
}

function guardExistsSql() {
  return "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";
}

function mutationStatement(
  db: D1DatabaseLike,
  mutation: Exclude<CampaignMutation, CollectionMutation>,
  writeToken: string,
): D1PreparedStatement {
  const guard = guardExistsSql();

  switch (mutation.type) {
    case "campaign.rename":
      return db
        .prepare("UPDATE campaigns SET name = ? WHERE id = ? AND write_token = ?")
        .bind(mutation.payload.name, mutation.campaignId, writeToken);
    case "team.create":
      return db
        .prepare(
          `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(
          mutation.payload.teamId,
          mutation.campaignId,
          mutation.payload.name,
          mutation.payload.color,
          mutation.createdAt,
          mutation.createdAt,
          mutation.campaignId,
          writeToken,
        );
    case "team.update":
      return db
        .prepare(
          `UPDATE teams SET
             name = COALESCE(?, name), color = COALESCE(?, color), updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.name ?? null,
          mutation.payload.color ?? null,
          mutation.createdAt,
          mutation.payload.teamId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "team.delete":
      return db
        .prepare(`DELETE FROM teams WHERE id = ? AND campaign_id = ? AND updated_at = ? AND ${guard}`)
        .bind(
          mutation.payload.teamId,
          mutation.campaignId,
          mutation.payload.expectedUpdatedAt,
          mutation.campaignId,
          writeToken,
        );
    case "area.create":
      return db
        .prepare(
          `INSERT INTO areas (
             id, campaign_id, team_id, name, geometry_json, created_at, updated_at
           ) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.payload.teamId,
          mutation.payload.name,
          JSON.stringify(mutation.payload.geometry),
          mutation.createdAt,
          mutation.createdAt,
          mutation.campaignId,
          writeToken,
        );
    case "area.rename":
      return db
        .prepare(
          `UPDATE areas SET name = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.name,
          mutation.createdAt,
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "area.set-team":
      return db
        .prepare(
          `UPDATE areas SET team_id = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.teamId,
          mutation.createdAt,
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "area.update-geometry":
      return db
        .prepare(
          `UPDATE areas SET geometry_json = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          JSON.stringify(mutation.payload.geometry),
          mutation.createdAt,
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "area.delete":
      return db
        .prepare(`DELETE FROM areas WHERE id = ? AND campaign_id = ? AND ${guard}`)
        .bind(
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    default:
      throw new Error("unsupported_mutation_type");
  }
}

/**
 * One guarded D1 batch: claim the next campaign revision, apply the change, write the ledger entry. The write token ties the three
 * together, so a concurrent writer makes the claim miss and nothing else lands.
 */
export async function persistCampaignMutation(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  fromRevision: number,
  fingerprintOverride?: string,
): Promise<MutationPersistenceResult> {
  const fingerprint = fingerprintOverride ?? (await fingerprintCampaignMutation(mutation));
  const existing = await getAppliedMutation(db, mutation.campaignId, mutation.id);
  if (existing) {
    if (existing.mutationFingerprint !== fingerprint) {
      return { ok: false, currentRevision: existing.appliedRevision, reason: "mutation_id_reused" };
    }
    return { ok: true, revision: existing.appliedRevision, alreadyApplied: true };
  }

  const collectionMutation = mutation.type.startsWith("collection.");
  if (collectionMutation && !(await hasCollectionSchema(db))) {
    return { ok: false, currentRevision: fromRevision, reason: "schema_migration_required" };
  }

  const writeToken = crypto.randomUUID();
  const nextRevision = fromRevision + 1;
  const claim = db
    .prepare(`UPDATE campaigns SET revision = ?, write_token = ?, updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(nextRevision, writeToken, mutation.createdAt, mutation.campaignId, fromRevision);

  const ledger = db
    .prepare(
      `INSERT INTO campaign_mutations (
         campaign_id, mutation_id, mutation_type, mutation_fingerprint,
         requested_base_revision, applied_from_revision, applied_revision, client_created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardExistsSql()}`,
    )
    .bind(mutation.campaignId, mutation.id, mutation.type, fingerprint, mutation.baseRevision, fromRevision, nextRevision, mutation.createdAt, mutation.campaignId, writeToken);

  const domainStatements = collectionMutation
    ? collectionMutationStatements(db, mutation as CollectionMutation, writeToken)
    : [mutationStatement(db, mutation as Exclude<CampaignMutation, CollectionMutation>, writeToken)];

  const results = await db.batch([claim, ...domainStatements, ledger]);

  if ((results[0]?.meta?.changes ?? 0) === 1) {
    return { ok: true, revision: nextRevision, alreadyApplied: false };
  }

  const appliedAfterRace = await getAppliedMutation(db, mutation.campaignId, mutation.id);
  if (appliedAfterRace) {
    if (appliedAfterRace.mutationFingerprint !== fingerprint) {
      return { ok: false, currentRevision: appliedAfterRace.appliedRevision, reason: "mutation_id_reused" };
    }
    return { ok: true, revision: appliedAfterRace.appliedRevision, alreadyApplied: true };
  }

  return { ok: false, currentRevision: await getCampaignRevision(db, mutation.campaignId), reason: "revision_conflict" };
}

import {
  createAccessGrant,
  createSessionForGrant,
  hashSecret,
  type AccessContext,
} from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

export async function operatorSecretMatches(provided: string, configured: string | undefined) {
  if (!provided || !configured) return false;
  const [providedHash, configuredHash] = await Promise.all([
    hashSecret(provided),
    hashSecret(configured),
  ]);
  return providedHash === configuredHash;
}

export async function createRecoveredAdminAccess(
  db: D1DatabaseLike,
  campaignId: string,
  label = "Admin recovery",
) {
  const created = await createAccessGrant(db, {
    campaignId,
    role: "admin",
    teamId: null,
    label,
  });
  const access: AccessContext = {
    grantId: created.grant.grantId,
    campaignId,
    role: "admin",
    teamId: null,
    label: created.grant.label,
  };
  const session = await createSessionForGrant(db, access);
  return {
    access,
    token: created.token,
    sessionSecret: session.sessionSecret,
  };
}

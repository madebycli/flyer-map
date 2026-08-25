import {
  createAccessGrant,
  createSessionForGrant,
  hashSecret,
  type AccessContext,
} from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

function fixedLengthEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function operatorSecretMatches(provided: string, configured: string | undefined) {
  if (!provided || !configured) return false;
  const [providedHash, configuredHash] = await Promise.all([
    hashSecret(provided),
    hashSecret(configured),
  ]);
  return fixedLengthEqual(providedHash, configuredHash);
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

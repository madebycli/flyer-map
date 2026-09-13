import type { AccessContext } from "./access.ts";
import type { CollectionActor } from "../src/domain/collection.ts";

export function collectionActorForAccess(access: AccessContext): CollectionActor | null {
  if (access.role === "admin") {
    return { kind: "campaign-grant", ref: access.grantId };
  }
  if (access.role === "collection-collector" && access.collectorId) {
    return { kind: "collection-collector", ref: access.collectorId };
  }
  return null;
}

import type { CampaignMutation } from "../src/domain/mutations.ts";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)] as const);
    return Object.fromEntries(entries);
  }

  return value;
}

export function canonicalMutationJson(mutation: CampaignMutation) {
  return JSON.stringify(canonicalize(mutation));
}

export async function fingerprintCampaignMutation(mutation: CampaignMutation) {
  const bytes = new TextEncoder().encode(canonicalMutationJson(mutation));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

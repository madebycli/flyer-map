import type { CampaignDiagnosticData } from './streetEngineSnapshot.ts';
import { safeDiagnosticValue } from './streetEngineSnapshot.ts';

export type StreetEngineAreaDiagnostic = {
  areaId: string;
  areaName: string;
  httpStatus: number | null;
  ok: boolean;
  payload: unknown;
  error: string | null;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function preparationDiagnosticUrl(campaignId: string, areaId: string) {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/areas/${encodeURIComponent(areaId)}/preparation?diag=1`;
}

export async function loadStreetEngineAreaDiagnostics(
  campaign: CampaignDiagnosticData,
  fetchImpl: FetchLike = fetch,
): Promise<StreetEngineAreaDiagnostic[]> {
  if (!campaign.campaignId || campaign.storageState !== 'ok') return [];

  const results: StreetEngineAreaDiagnostic[] = [];
  for (const area of campaign.areas.slice(0, 20)) {
    try {
      const response = await fetchImpl(preparationDiagnosticUrl(campaign.campaignId, area.id), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      let payload: unknown = null;
      try {
        payload = safeDiagnosticValue(await response.json());
      } catch {
        payload = null;
      }
      results.push({
        areaId: area.id,
        areaName: area.name,
        httpStatus: response.status,
        ok: response.ok,
        payload,
        error: response.ok ? null : `HTTP ${response.status}`,
      });
    } catch (error) {
      results.push({
        areaId: area.id,
        areaName: area.name,
        httpStatus: null,
        ok: false,
        payload: null,
        error: error instanceof Error ? error.message.slice(0, 200) : 'request_failed',
      });
    }
  }
  return results;
}

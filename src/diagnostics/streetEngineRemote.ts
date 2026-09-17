import type { CampaignDiagnosticData, DiagnosticAreaSummary } from './streetEngineSnapshot.ts';
import { safeDiagnosticValue } from './streetEngineSnapshot.ts';

const MAX_AREA_DIAGNOSTICS = 20;

export type StreetEngineDiagnosticSelection = {
  totalAreas: number;
  requestedAreas: number;
  omittedAreas: number;
  truncated: boolean;
  newestAreaId: string | null;
  newestAreaIncluded: boolean;
};

export type StreetEngineAreaDiagnostic = {
  areaId: string;
  areaName: string;
  httpStatus: number | null;
  ok: boolean;
  payload: unknown;
  error: string | null;
  selection: StreetEngineDiagnosticSelection;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function preparationDiagnosticUrl(campaignId: string, areaId: string) {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/areas/${encodeURIComponent(areaId)}/preparation?diag=1`;
}

function updatedAtMs(area: DiagnosticAreaSummary) {
  if (!area.updatedAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(area.updatedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Select diagnostic Areas newest-first. The original snapshot position is the
 * deterministic tie-breaker, newest index first, so a newly appended Area with
 * a missing/equal updatedAt is still preferred over stale entries.
 */
export function selectStreetEngineDiagnosticAreas(areas: DiagnosticAreaSummary[], limit = MAX_AREA_DIAGNOSTICS) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid_diagnostic_area_limit');
  return areas
    .map((area, index) => ({ area, index }))
    .sort((left, right) => updatedAtMs(right.area) - updatedAtMs(left.area) || right.index - left.index)
    .slice(0, limit)
    .map(({ area }) => area);
}

export async function loadStreetEngineAreaDiagnostics(
  campaign: CampaignDiagnosticData,
  fetchImpl: FetchLike = fetch,
): Promise<StreetEngineAreaDiagnostic[]> {
  if (!campaign.campaignId || campaign.storageState !== 'ok') return [];

  const selectedAreas = selectStreetEngineDiagnosticAreas(campaign.areas);
  const newestAreaId = selectedAreas[0]?.id ?? null;
  const selection: StreetEngineDiagnosticSelection = {
    totalAreas: campaign.areas.length,
    requestedAreas: selectedAreas.length,
    omittedAreas: Math.max(0, campaign.areas.length - selectedAreas.length),
    truncated: campaign.areas.length > selectedAreas.length,
    newestAreaId,
    newestAreaIncluded: newestAreaId === null || selectedAreas.some((area) => area.id === newestAreaId),
  };

  const results: StreetEngineAreaDiagnostic[] = [];
  for (const area of selectedAreas) {
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
        selection,
      });
    } catch (error) {
      results.push({
        areaId: area.id,
        areaName: area.name,
        httpStatus: null,
        ok: false,
        payload: null,
        error: error instanceof Error ? error.message.slice(0, 200) : 'request_failed',
        selection,
      });
    }
  }
  return results;
}

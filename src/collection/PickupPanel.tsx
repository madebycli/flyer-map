import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../domain/campaign.ts";
import {
  summarizePickupStatuses,
  validatePickupDraft,
  type PickupDraft,
  type PickupSource,
  type PickupStatus,
} from "../domain/pickup.ts";
import {
  searchPickupAddresses,
  type PickupSearchAttribution,
  type PickupSearchResult,
} from "../data/pickupSearchApi.ts";
import "./pickup-panel.css";

export type PickupListItem = {
  id: string;
  title: string;
  address: string;
  description: string;
  status: PickupStatus;
};

type Props = {
  campaignId: string;
  items: readonly PickupListItem[];
  canCreate: boolean;
  canEdit: boolean;
  online: boolean;
  locale: string;
  position: LngLat | null;
  source: PickupSource | null;
  mapCenter: LngLat | null;
  manualPositioning: boolean;
  areaId?: string | null;
  onCreate: (draft: PickupDraft & { position: LngLat }) => void | Promise<void>;
  onStatusChange: (id: string, status: PickupStatus) => void | Promise<void>;
  onPositionChange: (position: LngLat | null, source: PickupSource | null) => void;
  onFocusPosition: (position: LngLat) => void;
  onManualPositioningChange: (active: boolean) => void;
  labels: {
    title: string;
    progress: string;
    pickupTitle: string;
    address: string;
    description: string;
    add: string;
    adding: string;
    openComposer: string;
    closeComposer: string;
    search: string;
    searchHint: string;
    searching: string;
    searchEmpty: string;
    searchOffline: string;
    searchError: string;
    useLocation: string;
    locationLoading: string;
    locationActive: string;
    locationError: string;
    manualPosition: string;
    confirmPosition: string;
    positionSelected: string;
    open: string;
    collected: string;
    unavailable: string;
    needsFollowUp: string;
    empty: string;
    invalidDraft: string;
    positionRequired: string;
    readOnly: string;
    readOnlyCreate: string;
  };
};

const STATUS_ORDER: readonly PickupStatus[] = [
  "open",
  "collected",
  "unavailable",
  "needs-follow-up",
];

function formatDistance(meters: number, locale: string) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

export function PickupPanel({
  campaignId,
  items,
  canCreate,
  canEdit,
  online,
  locale,
  position,
  source,
  mapCenter,
  manualPositioning,
  areaId = null,
  onCreate,
  onStatusChange,
  onPositionChange,
  onFocusPosition,
  onManualPositioningChange,
  labels,
}: Props) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", address: "", description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickupSearchResult[]>([]);
  const [attribution, setAttribution] = useState<PickupSearchAttribution | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [locationBias, setLocationBias] = useState<LngLat | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "loading" | "active" | "error">("idle");
  const searchSequence = useRef(0);
  const summary = useMemo(() => summarizePickupStatuses(items.map((item) => item.status)), [items]);
  const effectiveBias = locationBias ?? mapCenter;

  useEffect(() => {
    const normalized = query.trim();
    if (!composerOpen || !canCreate || !online || normalized.length < 2) {
      setResults([]);
      setAttribution(null);
      setSearchState("idle");
      return;
    }

    const controller = new AbortController();
    const sequence = ++searchSequence.current;
    const timer = window.setTimeout(() => {
      setSearchState("loading");
      void searchPickupAddresses(campaignId, normalized, effectiveBias, controller.signal)
        .then((response) => {
          if (sequence !== searchSequence.current) return;
          setResults(response.results);
          setAttribution(response.attribution);
          setSearchState(response.results.length === 0 ? "empty" : "idle");
        })
        .catch((error) => {
          if (sequence !== searchSequence.current) return;
          if (error instanceof Error && error.name === "AbortError") return;
          setResults([]);
          setAttribution(null);
          setSearchState("error");
        });
    }, 320);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    campaignId,
    canCreate,
    composerOpen,
    effectiveBias?.[0],
    effectiveBias?.[1],
    online,
    query,
  ]);

  const resetComposer = () => {
    setComposerOpen(false);
    setDraft({ title: "", address: "", description: "" });
    setQuery("");
    setResults([]);
    setAttribution(null);
    setSearchState("idle");
    setInvalid(false);
    onPositionChange(null, null);
    onManualPositioningChange(false);
  };

  const create = async () => {
    const validation = validatePickupDraft({
      ...draft,
      position,
      areaId,
      source,
    });
    if (!canCreate || !validation.valid) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSubmitting(true);
    try {
      await onCreate(validation.value);
      resetComposer();
    } catch {
      setInvalid(true);
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (status: PickupStatus) => {
    if (status === "collected") return labels.collected;
    if (status === "unavailable") return labels.unavailable;
    if (status === "needs-follow-up") return labels.needsFollowUp;
    return labels.open;
  };

  const selectSearchResult = (result: PickupSearchResult) => {
    setDraft((current) => ({
      ...current,
      title: result.title,
      address: result.address,
    }));
    setQuery("");
    setResults([]);
    setAttribution(null);
    onPositionChange(result.position, result.source);
    onFocusPosition(result.position);
    onManualPositioningChange(true);
    setInvalid(false);
  };

  const useCurrentLocation = () => {
    if (!canCreate || !navigator.geolocation) {
      setLocationState("error");
      return;
    }
    setLocationState("loading");
    navigator.geolocation.getCurrentPosition(
      (current) => {
        setLocationBias([current.coords.longitude, current.coords.latitude]);
        setLocationState("active");
      },
      () => setLocationState("error"),
      { enableHighAccuracy: false, timeout: 5_000, maximumAge: 60_000 },
    );
  };

  const toggleManualPositioning = () => {
    if (!manualPositioning && !position && mapCenter) onPositionChange(mapCenter, null);
    onManualPositioningChange(!manualPositioning);
  };

  return (
    <section className="pickup-panel" aria-label={labels.title}>
      <header className="pickup-panel-header">
        <div>
          <strong>{labels.title}</strong>
          <span>{labels.progress}</span>
        </div>
        <div className="pickup-progress" aria-label={labels.progress}>
          <strong>{summary.percentCollected === null ? "–" : `${Math.round(summary.percentCollected)} %`}</strong>
          <span>{summary.collected} / {summary.total}</span>
        </div>
      </header>

      <div className="pickup-list">
        {items.length === 0 ? <p className="pickup-empty">{labels.empty}</p> : null}
        {items.map((item) => (
          <article className="pickup-card" key={item.id}>
            <div className="pickup-card-copy">
              <strong>{item.title}</strong>
              <small>{item.address}</small>
              {item.description ? <p>{item.description}</p> : null}
            </div>
            {canEdit ? (
              <select
                aria-label={`${item.address}: ${labels.progress}`}
                value={item.status}
                onChange={(event) => void onStatusChange(item.id, event.target.value as PickupStatus)}
              >
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            ) : (
              <span className={`pickup-status is-${item.status}`}>{statusLabel(item.status)}</span>
            )}
          </article>
        ))}
      </div>

      {canCreate && !composerOpen ? (
        <button type="button" className="pickup-open-composer" onClick={() => setComposerOpen(true)}>
          {labels.openComposer}
        </button>
      ) : null}

      {canCreate && composerOpen ? (
        <div className="pickup-composer">
          <div className="pickup-composer-heading">
            <strong>{labels.openComposer}</strong>
            <button type="button" onClick={resetComposer}>{labels.closeComposer}</button>
          </div>

          <label>
            <span>{labels.search}</span>
            <input
              value={query}
              maxLength={120}
              autoComplete="off"
              placeholder={labels.searchHint}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="pickup-search-actions">
            <button type="button" onClick={useCurrentLocation} disabled={locationState === "loading"}>
              {locationState === "loading" ? labels.locationLoading : labels.useLocation}
            </button>
            {locationState === "active" ? <span>{labels.locationActive}</span> : null}
            {locationState === "error" ? <span className="pickup-error">{labels.locationError}</span> : null}
          </div>
          {!online && query.trim().length >= 2 ? <p className="pickup-search-note">{labels.searchOffline}</p> : null}
          {searchState === "loading" ? <p className="pickup-search-note" role="status">{labels.searching}</p> : null}
          {searchState === "empty" ? <p className="pickup-search-note">{labels.searchEmpty}</p> : null}
          {searchState === "error" ? <p className="pickup-error" role="alert">{labels.searchError}</p> : null}

          {results.length > 0 ? (
            <div className="pickup-search-results">
              {results.map((result) => (
                <button type="button" key={result.id} onClick={() => selectSearchResult(result)}>
                  <span>
                    <strong>{result.title}</strong>
                    <small>{result.address}</small>
                  </span>
                  <b>{formatDistance(result.distanceMeters, locale)}</b>
                </button>
              ))}
            </div>
          ) : null}
          {attribution ? (
            <p className="pickup-attribution">
              <a href={attribution.provider.href} target="_blank" rel="noreferrer">{attribution.provider.text}</a>
              {" · "}
              <a href={attribution.data.href} target="_blank" rel="noreferrer">{attribution.data.text}</a>
            </p>
          ) : null}

          <label>
            <span>{labels.pickupTitle}</span>
            <input
              value={draft.title}
              maxLength={160}
              onChange={(event) => {
                setDraft((current) => ({ ...current, title: event.target.value }));
                if (invalid) setInvalid(false);
              }}
            />
          </label>
          <label>
            <span>{labels.address}</span>
            <input
              value={draft.address}
              maxLength={320}
              autoComplete="street-address"
              onChange={(event) => {
                setDraft((current) => ({ ...current, address: event.target.value }));
                if (invalid) setInvalid(false);
              }}
            />
          </label>
          <label>
            <span>{labels.description}</span>
            <textarea
              rows={3}
              value={draft.description}
              maxLength={4_000}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className="pickup-position-row">
            <button
              type="button"
              disabled={!position && !mapCenter}
              onClick={toggleManualPositioning}
            >
              {manualPositioning ? labels.confirmPosition : labels.manualPosition}
            </button>
            {position ? (
              <span>{labels.positionSelected}: {position[1].toFixed(5)}, {position[0].toFixed(5)}</span>
            ) : null}
          </div>
          {!position ? <p className="pickup-error">{labels.positionRequired}</p> : null}
          {invalid ? <p className="pickup-error" role="alert">{labels.invalidDraft}</p> : null}
          <button type="button" disabled={submitting || !position} onClick={() => void create()}>
            {submitting ? labels.adding : labels.add}
          </button>
        </div>
      ) : null}

      {!canCreate ? <p className="pickup-readonly">{canEdit ? labels.readOnlyCreate : labels.readOnly}</p> : null}
    </section>
  );
}

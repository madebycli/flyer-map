import { useEffect, useMemo, useRef, useState } from "react";
import { campaignIdFromUrl } from "../data/campaignApi";
import "./street-engine-diagnostics.css";

type AreaOption = { id: string; name: string; updatedAt: string };
type SourceAttempt = {
  endpoint: string;
  providerAttempt: number;
  kind: "roads" | "buildings";
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
  retryAfterSeconds: number | null;
  responseType: string;
  remark: string | null;
  bytes: number;
  elapsedMs: number;
  aborted: boolean;
  code: string | null;
};
type TileTiming = { kind: "roads" | "buildings"; tile: number; bytes: number; elapsedMs: number; attempts: number };
type DiagnosticMetrics = {
  tiles: number | null;
  cacheHits: number;
  requests: number;
  retries: number;
  bytes: number;
  observedSourceBytes: number;
  fetchMs: number;
  parseMs: number;
  normalizationMs: number;
  graphMs: number;
  addressMs: number;
  linkMs: number;
  publishMs: number;
  roads: number;
  buildings: number;
  addressableBuildings: number;
  houses: number;
  sourceTimestamp: string | null;
  tileTimings: TileTiming[];
  lastSourceAttempts: SourceAttempt[];
  quality: null | {
    receivedBuildings: number;
    acceptedBuildings: number;
    rejectedBuildings: number;
    emptyBuildingTiles: number;
    samples: Array<{ osmId: number | null; tile: number; reason: string }>;
  };
  lastError: null | {
    phase: string;
    cursor: number;
    code: string;
    attempt: number;
    sourceAttempts: SourceAttempt[];
    quality: DiagnosticMetrics["quality"];
  };
};
type StreetDiagnostic = {
  generation: string;
  status: "pending" | "ready" | "failed";
  phase: string;
  cursor: number;
  attempts: number;
  errorCode: string | null;
  leaseUntil: string | null;
  retryWaitRemainingMs: number;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  elapsedMs: number | null;
  staleForMs: number | null;
  roadCount: number;
  houseCount: number;
  metrics: DiagnosticMetrics;
};
type PreparationPayload = {
  status: "missing" | "pending" | "ready" | "failed";
  roadCount: number;
  houseCount: number;
  sourceTimestamp: string | null;
  errorCode: string | null;
  updatedAt: string | null;
  progress?: { phase: string; percent: number; totalTiles: number; completedRoadTiles: number; completedBuildingTiles: number; processedBuildings: number; totalBuildings: number };
  diagnostics?: StreetDiagnostic | null;
};
type Observation = {
  at: string;
  kind: "state" | "heartbeat";
  elapsedMs: number | null;
  status: string;
  phase: string;
  cursor: number;
  attempts: number;
  errorCode: string | null;
  pollMs: number;
  retryWaitRemainingMs: number;
};
type LiveState = {
  areaId: string;
  areaName: string;
  payload: PreparationPayload;
  receivedAt: number;
  pollMs: number;
  phaseObservedAt: number;
};

const SNAPSHOT_STORAGE_KEY = "verteil-flyer:campaign-snapshot";

function diagnosticsEnabled() {
  return typeof window !== "undefined" && new URL(window.location.href).searchParams.get("diag") === "1";
}

function readAreas(): AreaOption[] {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { areas?: unknown[] };
    if (!Array.isArray(parsed.areas)) return [];
    return parsed.areas.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const area = value as Record<string, unknown>;
      if (typeof area.id !== "string") return [];
      return [{
        id: area.id,
        name: typeof area.name === "string" && area.name.trim() ? area.name.trim() : area.id,
        updatedAt: typeof area.updatedAt === "string" ? area.updatedAt : "",
      }];
    }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  } catch {
    return [];
  }
}

function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const totalSeconds = ms / 1_000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 2 : 1)} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")} min`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

function shortGeneration(value: string | undefined) {
  return value ? value.slice(0, 8) : "–";
}

export function StreetEngineDiagnostics() {
  const enabled = useMemo(diagnosticsEnabled, []);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [areas, setAreas] = useState<AreaOption[]>(() => enabled ? readAreas() : []);
  const [selectedAreaId, setSelectedAreaId] = useState(() => enabled ? readAreas()[0]?.id ?? "" : "");
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [tick, setTick] = useState(() => Date.now());
  const lastGenerationRef = useRef<string | null>(null);
  const lastSignatureRef = useRef<string>("");
  const lastObservationAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => setTick(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      const next = readAreas();
      setAreas(next);
      setSelectedAreaId((current) => current && next.some((area) => area.id === current) ? current : next[0]?.id ?? "");
    };
    refresh();
    const interval = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(interval);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !selectedAreaId) return;
    const campaignId = campaignIdFromUrl();
    if (!campaignId) return;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      const started = performance.now();
      try {
        const response = await fetch(
          `/api/campaigns/${encodeURIComponent(campaignId)}/areas/${encodeURIComponent(selectedAreaId)}/preparation?diag=1`,
          { cache: "no-store", credentials: "same-origin" },
        );
        const pollMs = performance.now() - started;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as PreparationPayload;
        if (cancelled) return;
        const receivedAt = Date.now();
        const areaName = areas.find((area) => area.id === selectedAreaId)?.name ?? selectedAreaId;
        const diagnostic = payload.diagnostics ?? null;
        const generation = diagnostic?.generation ?? null;
        const signature = `${generation ?? "none"}|${payload.status}|${diagnostic?.phase ?? payload.progress?.phase ?? "none"}|${diagnostic?.cursor ?? 0}|${diagnostic?.attempts ?? 0}|${diagnostic?.errorCode ?? payload.errorCode ?? ""}`;
        const generationChanged = generation !== lastGenerationRef.current;
        if (generationChanged) {
          lastGenerationRef.current = generation;
          lastSignatureRef.current = "";
          lastObservationAtRef.current = 0;
          setObservations([]);
        }
        const stateChanged = signature !== lastSignatureRef.current;
        const heartbeat = !stateChanged && receivedAt - lastObservationAtRef.current >= 5_000;
        if (stateChanged || heartbeat) {
          lastSignatureRef.current = signature;
          lastObservationAtRef.current = receivedAt;
          setObservations((current) => [...current.slice(-79), {
            at: new Date(receivedAt).toISOString(),
            kind: stateChanged ? "state" : "heartbeat",
            elapsedMs: diagnostic?.elapsedMs ?? null,
            status: payload.status,
            phase: diagnostic?.phase ?? payload.progress?.phase ?? "none",
            cursor: diagnostic?.cursor ?? 0,
            attempts: diagnostic?.attempts ?? 0,
            errorCode: diagnostic?.errorCode ?? payload.errorCode ?? null,
            pollMs,
            retryWaitRemainingMs: diagnostic?.retryWaitRemainingMs ?? 0,
          }]);
        }
        setLive((previous) => ({
          areaId: selectedAreaId,
          areaName,
          payload,
          receivedAt,
          pollMs,
          phaseObservedAt:
            previous && previous.areaId === selectedAreaId &&
            previous.payload.diagnostics?.generation === diagnostic?.generation &&
            previous.payload.diagnostics?.phase === diagnostic?.phase &&
            previous.payload.diagnostics?.cursor === diagnostic?.cursor
              ? previous.phaseObservedAt
              : receivedAt,
        }));
        setError(null);
      } catch (pollError) {
        if (!cancelled) setError(pollError instanceof Error ? pollError.message : String(pollError));
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, selectedAreaId, areas]);

  if (!enabled) return null;

  const diagnostic = live?.payload.diagnostics ?? null;
  const metrics = diagnostic?.metrics ?? null;
  const liveElapsed = diagnostic?.elapsedMs === null || diagnostic?.elapsedMs === undefined
    ? null
    : diagnostic.elapsedMs + (diagnostic.status === "pending" ? Math.max(0, tick - (live?.receivedAt ?? tick)) : 0);
  const phaseElapsed = live ? Math.max(0, tick - live.phaseObservedAt) : null;
  const retryWait = diagnostic?.leaseUntil
    ? Math.max(0, Date.parse(diagnostic.leaseUntil) - tick)
    : diagnostic?.retryWaitRemainingMs ?? 0;
  const sourceAttempts = metrics?.lastError?.sourceAttempts?.length
    ? metrics.lastError.sourceAttempts
    : metrics?.lastSourceAttempts ?? [];
  const phase = diagnostic?.phase ?? live?.payload.progress?.phase ?? live?.payload.status ?? "idle";

  const copyDiagnostics = async () => {
    const safeUrl = new URL(window.location.href);
    safeUrl.hash = "";
    safeUrl.searchParams.delete("campaign");
    const report = {
      timestamp: new Date().toISOString(),
      page: `${safeUrl.origin}${safeUrl.pathname}${safeUrl.search}`,
      campaignId: campaignIdFromUrl(),
      selectedAreaId,
      selectedAreaName: live?.areaName ?? areas.find((area) => area.id === selectedAreaId)?.name ?? null,
      browserPollMs: live?.pollMs ?? null,
      liveElapsedMs: liveElapsed,
      phaseObservedMs: phaseElapsed,
      state: live?.payload ?? null,
      observations,
    };
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      window.prompt("Street Engine Diagnose kopieren", text);
    }
  };

  return (
    <aside className={`street-engine-diagnostics${expanded ? " is-expanded" : ""}`}>
      <button className="street-engine-diagnostics-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
        STREET DIAG · {phase} · {formatDuration(liveElapsed)}
      </button>
      {expanded ? (
        <div className="street-engine-diagnostics-panel">
          <div className="street-engine-diagnostics-heading">
            <strong>Street Engine Timeline</strong>
            <span>{live?.payload.status ?? "–"} · Gen {shortGeneration(diagnostic?.generation)}</span>
          </div>
          <label>
            Gebiet
            <select value={selectedAreaId} onChange={(event) => setSelectedAreaId(event.target.value)}>
              {areas.length === 0 ? <option value="">Kein Gebiet im lokalen Snapshot</option> : null}
              {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>
          {error ? <div className="street-engine-diagnostics-error">Diagnose-GET: {error}</div> : null}
          <div className="street-engine-diagnostics-grid">
            <span>Gesamt</span><b>{formatDuration(liveElapsed)}</b>
            <span>Aktueller Schritt beobachtet</span><b>{formatDuration(phaseElapsed)}</b>
            <span>Phase / Cursor</span><b>{phase} / {diagnostic?.cursor ?? "–"}</b>
            <span>Job-Attempts</span><b>{diagnostic?.attempts ?? "–"}</b>
            <span>Retry-Wartezeit</span><b>{formatDuration(retryWait)}</b>
            <span>Fortschritt</span><b>{live?.payload.progress?.percent ?? (live?.payload.status === "ready" ? 100 : "–")}%</b>
            <span>Browser-Poll</span><b>{formatDuration(live?.pollMs)}</b>
            <span>Seit Server-Update</span><b>{formatDuration(diagnostic?.staleForMs === null || diagnostic?.staleForMs === undefined ? null : diagnostic.staleForMs + Math.max(0, tick - (live?.receivedAt ?? tick)))}</b>
          </div>

          {metrics ? (
            <>
              <details open>
                <summary>Server-Zeiten</summary>
                <div className="street-engine-diagnostics-grid">
                  <span>Overpass Fetch</span><b>{formatDuration(metrics.fetchMs)}</b>
                  <span>JSON Parse</span><b>{formatDuration(metrics.parseMs)}</b>
                  <span>Normalisierung</span><b>{formatDuration(metrics.normalizationMs)}</b>
                  <span>Graph</span><b>{formatDuration(metrics.graphMs)}</b>
                  <span>Adressen</span><b>{formatDuration(metrics.addressMs)}</b>
                  <span>House-Link</span><b>{formatDuration(metrics.linkMs)}</b>
                  <span>Publish</span><b>{formatDuration(metrics.publishMs)}</b>
                </div>
              </details>
              <details open>
                <summary>Mengen / Requests</summary>
                <div className="street-engine-diagnostics-grid">
                  <span>Tiles</span><b>{metrics.tiles ?? "–"}</b>
                  <span>Requests / Retries / Cache</span><b>{metrics.requests} / {metrics.retries} / {metrics.cacheHits}</b>
                  <span>Bytes</span><b>{formatBytes(metrics.bytes)} · beobachtet {formatBytes(metrics.observedSourceBytes)}</b>
                  <span>Straßen / Buildings</span><b>{metrics.roads} / {metrics.buildings}</b>
                  <span>Adressierbar / Houses</span><b>{metrics.addressableBuildings} / {metrics.houses}</b>
                  <span>Output</span><b>{live?.payload.roadCount ?? 0} Straßen / {live?.payload.houseCount ?? 0} Häuser</b>
                </div>
              </details>
              {metrics.quality ? (
                <details>
                  <summary>Building-Qualität</summary>
                  <div className="street-engine-diagnostics-grid">
                    <span>Empfangen</span><b>{metrics.quality.receivedBuildings}</b>
                    <span>Akzeptiert</span><b>{metrics.quality.acceptedBuildings}</b>
                    <span>Verworfen</span><b>{metrics.quality.rejectedBuildings}</b>
                    <span>Leere Tiles</span><b>{metrics.quality.emptyBuildingTiles}</b>
                  </div>
                  {metrics.quality.samples.length ? <pre>{JSON.stringify(metrics.quality.samples, null, 2)}</pre> : null}
                </details>
              ) : null}
              <details open={sourceAttempts.length > 0}>
                <summary>Letzte Provider-Attempts ({sourceAttempts.length})</summary>
                {sourceAttempts.length === 0 ? <small>Noch keine Provider-Messung.</small> : (
                  <div className="street-engine-diagnostics-list">
                    {sourceAttempts.map((attempt, index) => (
                      <div key={`${attempt.kind}-${attempt.providerAttempt}-${index}`}>
                        <b>{attempt.kind} P{attempt.providerAttempt}</b>
                        <span>{attempt.endpoint}</span>
                        <span>HTTP {attempt.status ?? "–"} · {formatDuration(attempt.elapsedMs)} · {formatBytes(attempt.bytes)} · {attempt.code ?? attempt.responseType}{attempt.aborted ? " · ABORT" : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </details>
              <details>
                <summary>Tile-Zeiten ({metrics.tileTimings.length})</summary>
                <div className="street-engine-diagnostics-list">
                  {metrics.tileTimings.slice(-24).map((tile, index) => (
                    <div key={`${tile.kind}-${tile.tile}-${index}`}>
                      <b>{tile.kind} Tile {tile.tile}</b>
                      <span>{formatDuration(tile.elapsedMs)} · {tile.attempts} Attempt(s) · {formatBytes(tile.bytes)}</span>
                    </div>
                  ))}
                </div>
              </details>
              {metrics.lastError ? (
                <div className="street-engine-diagnostics-error">
                  Letzter Fehler: {metrics.lastError.code} · {metrics.lastError.phase}/{metrics.lastError.cursor} · Attempt {metrics.lastError.attempt}
                </div>
              ) : null}
            </>
          ) : <small>Noch keine persistierten Street-Engine-Metriken für dieses Gebiet.</small>}

          <details>
            <summary>Client-Timeline ({observations.length})</summary>
            <div className="street-engine-diagnostics-list street-engine-diagnostics-timeline">
              {observations.slice(-30).reverse().map((entry, index) => (
                <div key={`${entry.at}-${index}`}>
                  <b>{entry.kind === "heartbeat" ? "♥" : "→"} {entry.phase}/{entry.cursor}</b>
                  <span>{entry.status} · Gesamt {formatDuration(entry.elapsedMs)} · Poll {formatDuration(entry.pollMs)} · Attempt {entry.attempts}{entry.errorCode ? ` · ${entry.errorCode}` : ""}</span>
                  <small>{entry.at}</small>
                </div>
              ))}
            </div>
          </details>

          <button type="button" onClick={() => void copyDiagnostics()}>{copied ? "Street-Log kopiert ✓" : "Street-Log kopieren"}</button>
          <small>Nur in ?diag=1. Der Poll ist read-only und startet oder retriggert die Street Engine nicht.</small>
        </div>
      ) : null}
    </aside>
  );
}

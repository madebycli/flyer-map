import { useEffect, useMemo, useRef, useState } from "react";
import {
  clipboardApiAvailable,
  copyTextToClipboard,
  legacyCopyAvailable,
  type ClipboardCopyMethod,
} from "./clipboard.ts";
import {
  readCampaignDiagnosticData,
  safeDiagnosticValue,
  type CampaignDiagnosticData,
} from "./streetEngineSnapshot.ts";
import {
  loadStreetEngineAreaDiagnostics,
  type StreetEngineAreaDiagnostic,
} from "./streetEngineRemote.ts";

type DiagnosticSnapshot = {
  diagnosticSchema: "street-engine-diag-v3";
  timestamp: string;
  page: string;
  runtime: RuntimeDiagnosticState;
  browser: {
    userAgent: string;
    viewport: string;
    online: boolean;
    secureContext: boolean;
    hardwareConcurrency: number | null;
    deviceMemoryGb: number | null;
    connection: {
      effectiveType: string | null;
      downlinkMbps: number | null;
      rttMs: number | null;
      saveData: boolean | null;
    };
    clipboard: {
      apiAvailable: boolean;
      legacyCopyAvailable: boolean;
      lastCopyMethod: ClipboardCopyMethod | null;
    };
  };
  mode: string;
  campaign: CampaignDiagnosticData;
  streetEngine: {
    serverDiagnosticsLoadedAt: string | null;
    areas: StreetEngineAreaDiagnostic[];
    observedPreparationEvents: PreparationEventDiagnostic[];
  };
  renderer: ReturnType<typeof rendererStats>;
  performance: {
    fpsLastSecond: number;
    worstFrameMsLastFiveSeconds: number;
    framesOver32MsLastFiveSeconds: number;
    jsHeapUsedMb: number | null;
  };
  network: ReturnType<typeof relevantResourceStats>;
  basemap: ReturnType<typeof basemapStats>;
  capturedMessages: string[];
};

type RuntimeDiagnosticState = {
  status: "loading" | "ready" | "error";
  payload: unknown;
  error: string | null;
};

type PreparationEventDiagnostic = {
  at: string;
  areaId: string | null;
  state: unknown;
};

type ConnectionLike = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

type NavigatorWithHints = Navigator & {
  connection?: ConnectionLike;
  deviceMemory?: number;
};

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number;
  };
};

type ResourceTimingWithStatus = PerformanceResourceTiming & {
  responseStatus?: number;
};

const SNAPSHOT_STORAGE_KEY = "verteil-flyer:campaign-snapshot";
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_-]{32,}/g;
const MAX_CAPTURED_MESSAGES = 80;
const MAX_PREPARATION_EVENTS = 30;

function redact(value: unknown) {
  let text: string;
  if (value instanceof Error) text = `${value.name}: ${value.message}`;
  else if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(safeDiagnosticValue(value));
    } catch {
      text = String(value);
    }
  }
  return text.replace(TOKEN_LIKE_PATTERN, "[redacted]").slice(0, 1_000);
}

function readCampaignData() {
  try {
    return readCampaignDiagnosticData(window.localStorage.getItem(SNAPSHOT_STORAGE_KEY));
  } catch {
    return readCampaignDiagnosticData(null);
  }
}

function currentMode() {
  const region = document.querySelector<HTMLElement>(".map-region");
  const modeClass = [...(region?.classList ?? [])].find((value) => value.startsWith("map-mode-"));
  return modeClass?.slice("map-mode-".length) ?? "unknown";
}

function basemapStats() {
  const entries = performance
    .getEntriesByType("resource")
    .filter((entry) => entry.name.includes("tiles.openfreemap.org"));
  if (entries.length === 0) {
    return { requests: 0, averageDurationMs: null, maxDurationMs: null };
  }
  const durations = entries.map((entry) => entry.duration).filter(Number.isFinite);
  return {
    requests: entries.length,
    averageDurationMs:
      durations.length > 0
        ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10
        : null,
    maxDurationMs:
      durations.length > 0 ? Math.round(Math.max(...durations) * 10) / 10 : null,
  };
}

function safeResourcePath(name: string) {
  try {
    const url = new URL(name, window.location.origin);
    return `${url.pathname}${url.searchParams.has("diag") ? "?diag=1" : ""}`;
  } catch {
    return name.slice(0, 180);
  }
}

function relevantResourceStats() {
  const entries = performance.getEntriesByType("resource") as ResourceTimingWithStatus[];
  const apiEntries = entries.filter((entry) => entry.name.includes("/api/"));
  const preparationEntries = apiEntries.filter((entry) => entry.name.includes("/preparation"));
  const sourcePackEntries = entries.filter((entry) =>
    /source[-_/]?pack|street[-_/]?engine[-_/]?v3|\.fgb(?:\?|$)|\.pmtiles(?:\?|$)|\.parquet(?:\?|$)/iu.test(entry.name),
  );
  const relevant = [...new Set([...apiEntries, ...sourcePackEntries])].slice(-30);

  return {
    resourceEntries: entries.length,
    apiRequests: apiEntries.length,
    preparationRequests: preparationEntries.length,
    sourcePackRequestsObserved: sourcePackEntries.length,
    recent: relevant.map((entry) => ({
      name: safeResourcePath(entry.name),
      initiatorType: entry.initiatorType || null,
      durationMs: Math.round(entry.duration * 10) / 10,
      transferBytes: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
      encodedBodyBytes: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
      decodedBodyBytes: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
      responseStatus: typeof entry.responseStatus === "number" ? entry.responseStatus : null,
    })),
  };
}

function readDatasetNumber(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rendererStats() {
  const region = document.querySelector<HTMLElement>(".map-region");
  return {
    kind: region?.dataset.renderer ?? "unknown",
    maplibreCanvases: document.querySelectorAll(".maplibregl-canvas").length,
    mapContainerSize: region?.dataset.mapContainerSize ?? null,
    mapCanvasSize: region?.dataset.mapCanvasSize ?? null,
    sourceAreas: readDatasetNumber(region?.dataset.sourceAreas),
    sourceStreets: readDatasetNumber(region?.dataset.sourceStreets),
    sourceHouses: readDatasetNumber(region?.dataset.sourceHouses),
    queuedAreas: readDatasetNumber(region?.dataset.queuedAreas),
    queuedStreets: readDatasetNumber(region?.dataset.queuedStreets),
    queuedHouses: readDatasetNumber(region?.dataset.queuedHouses),
    appliedAreas: readDatasetNumber(region?.dataset.appliedAreas),
    appliedStreets: readDatasetNumber(region?.dataset.appliedStreets),
    appliedHouses: readDatasetNumber(region?.dataset.appliedHouses),
    renderedAreas: readDatasetNumber(region?.dataset.renderedAreas),
    renderedStreets: readDatasetNumber(region?.dataset.renderedStreets),
    renderedHouses: readDatasetNumber(region?.dataset.renderedHouses),
    mapStyleReady: region?.dataset.mapStyleReady === "1",
    applicationSources: region?.dataset.applicationSources ?? null,
    applicationLayers: region?.dataset.applicationLayers ?? null,
    missingApplicationSources: region?.dataset.missingApplicationSources ?? null,
    missingApplicationLayers: region?.dataset.missingApplicationLayers ?? null,
    rendererError: region?.dataset.mapRendererError || null,
    activeSvgNodes: document.querySelectorAll(".active-geometry-overlay *").length,
    totalDomNodes: document.getElementsByTagName("*").length,
  };
}

function diagnosticsEnabled() {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.get("diag") === "1";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown, key: string) {
  const candidate = record(value)?.[key];
  return typeof candidate === "string" ? candidate : null;
}

function numberField(value: unknown, key: string) {
  const candidate = record(value)?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function serverDiagnosticSummary(area: StreetEngineAreaDiagnostic) {
  const payload = record(area.payload);
  const diagnostics = record(payload?.diagnostics);
  const progress = record(payload?.progress);
  const metrics = record(diagnostics?.metrics);
  return {
    status: stringField(payload, "status") ?? (area.ok ? "unknown" : "request-failed"),
    phase: stringField(diagnostics, "phase") ?? stringField(progress, "phase"),
    percent: numberField(progress, "percent"),
    generation: stringField(diagnostics, "generation"),
    requests: numberField(metrics, "requests"),
    fetchMs: numberField(metrics, "fetchMs"),
    graphMs: numberField(metrics, "graphMs"),
    addressMs: numberField(metrics, "addressMs"),
    linkMs: numberField(metrics, "linkMs"),
    publishMs: numberField(metrics, "publishMs"),
  };
}

function runtimeField(runtime: RuntimeDiagnosticState, key: string) {
  return stringField(runtime.payload, key);
}

export function MapDiagnostics() {
  const enabled = useMemo(diagnosticsEnabled, []);
  const [expanded, setExpanded] = useState(false);
  const [copyMethod, setCopyMethod] = useState<ClipboardCopyMethod | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [manualCopyText, setManualCopyText] = useState("");
  const [fps, setFps] = useState(0);
  const [worstFrame, setWorstFrame] = useState(0);
  const [longFrames, setLongFrames] = useState(0);
  const [serverDiagnostics, setServerDiagnostics] = useState<StreetEngineAreaDiagnostic[]>([]);
  const [serverDiagnosticsLoadedAt, setServerDiagnosticsLoadedAt] = useState<string | null>(null);
  const [serverDiagnosticsLoading, setServerDiagnosticsLoading] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeDiagnosticState>({ status: "loading", payload: null, error: null });
  const frameSamplesRef = useRef<Array<{ at: number; delta: number }>>([]);
  const messagesRef = useRef<string[]>([]);
  const preparationEventsRef = useRef<PreparationEventDiagnostic[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    void fetch("/api/runtime", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`runtime_http_${response.status}`);
        const payload = safeDiagnosticValue(await response.json());
        if (!stopped) setRuntime({ status: "ready", payload, error: null });
      })
      .catch((error) => {
        if (!stopped) {
          setRuntime({ status: "error", payload: null, error: error instanceof Error ? error.message : "runtime_request_failed" });
        }
      });
    return () => { stopped = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = now - previous;
      previous = now;
      frameSamplesRef.current.push({ at: now, delta });
      const cutoff = now - 5_000;
      while (frameSamplesRef.current[0]?.at < cutoff) frameSamplesRef.current.shift();
      if (active) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    const originalLog = console.log;
    const originalInfo = console.info;
    const originalError = console.error;
    const originalWarn = console.warn;
    const capture = (level: string, args: unknown[]) => {
      const message = `${new Date().toISOString()} ${level}: ${args.map(redact).join(" ")}`;
      messagesRef.current = [...messagesRef.current.slice(-(MAX_CAPTURED_MESSAGES - 1)), message];
    };
    console.log = (...args: unknown[]) => { capture("log", args); originalLog(...args); };
    console.info = (...args: unknown[]) => { capture("info", args); originalInfo(...args); };
    console.error = (...args: unknown[]) => { capture("error", args); originalError(...args); };
    console.warn = (...args: unknown[]) => { capture("warn", args); originalWarn(...args); };

    const onError = (event: ErrorEvent) => capture("window-error", [event.error ?? event.message]);
    const onRejection = (event: PromiseRejectionEvent) => capture("unhandled-rejection", [event.reason]);
    const onPreparation = (event: Event) => {
      const detail = record((event as CustomEvent).detail);
      const item: PreparationEventDiagnostic = {
        at: new Date().toISOString(),
        areaId: typeof detail?.areaId === "string" ? detail.areaId : null,
        state: safeDiagnosticValue(detail?.state ?? null),
      };
      preparationEventsRef.current = [
        ...preparationEventsRef.current.slice(-(MAX_PREPARATION_EVENTS - 1)),
        item,
      ];
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("campaign-preparation", onPreparation);

    const interval = window.setInterval(() => {
      const now = performance.now();
      const samples = frameSamplesRef.current;
      setFps(samples.filter((sample) => sample.at >= now - 1_000).length);
      setWorstFrame(Math.round(Math.max(0, ...samples.map((sample) => sample.delta)) * 10) / 10);
      setLongFrames(samples.filter((sample) => sample.delta > 32).length);
    }, 1_000);

    return () => {
      active = false;
      window.cancelAnimationFrame(raf);
      window.clearInterval(interval);
      console.log = originalLog;
      console.info = originalInfo;
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("campaign-preparation", onPreparation);
    };
  }, [enabled]);

  if (!enabled) return null;

  const refreshServerDiagnostics = async () => {
    if (serverDiagnosticsLoading) return serverDiagnostics;
    setServerDiagnosticsLoading(true);
    try {
      const diagnostics = await loadStreetEngineAreaDiagnostics(readCampaignData());
      setServerDiagnostics(diagnostics);
      setServerDiagnosticsLoadedAt(new Date().toISOString());
      return diagnostics;
    } finally {
      setServerDiagnosticsLoading(false);
    }
  };

  const buildSnapshot = (streetEngineAreas = serverDiagnostics): DiagnosticSnapshot => {
    const navigatorHints = navigator as NavigatorWithHints;
    const connection = navigatorHints.connection;
    const performanceMemory = (performance as PerformanceWithMemory).memory;
    const safeUrl = new URL(window.location.href);
    safeUrl.hash = "";
    safeUrl.searchParams.delete("campaign");

    return {
      diagnosticSchema: "street-engine-diag-v3",
      timestamp: new Date().toISOString(),
      page: `${safeUrl.origin}${safeUrl.pathname}${safeUrl.search}`,
      runtime,
      browser: {
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
        online: navigator.onLine,
        secureContext: window.isSecureContext,
        hardwareConcurrency: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null,
        deviceMemoryGb: typeof navigatorHints.deviceMemory === "number" ? navigatorHints.deviceMemory : null,
        connection: {
          effectiveType: connection?.effectiveType ?? null,
          downlinkMbps: typeof connection?.downlink === "number" ? connection.downlink : null,
          rttMs: typeof connection?.rtt === "number" ? connection.rtt : null,
          saveData: typeof connection?.saveData === "boolean" ? connection.saveData : null,
        },
        clipboard: {
          apiAvailable: clipboardApiAvailable(),
          legacyCopyAvailable: legacyCopyAvailable(),
          lastCopyMethod: copyMethod,
        },
      },
      mode: currentMode(),
      campaign: readCampaignData(),
      streetEngine: {
        serverDiagnosticsLoadedAt,
        areas: streetEngineAreas,
        observedPreparationEvents: preparationEventsRef.current,
      },
      renderer: rendererStats(),
      performance: {
        fpsLastSecond: fps,
        worstFrameMsLastFiveSeconds: worstFrame,
        framesOver32MsLastFiveSeconds: longFrames,
        jsHeapUsedMb:
          typeof performanceMemory?.usedJSHeapSize === "number"
            ? Math.round((performanceMemory.usedJSHeapSize / 1024 / 1024) * 10) / 10
            : null,
      },
      network: relevantResourceStats(),
      basemap: basemapStats(),
      capturedMessages: messagesRef.current,
    };
  };

  const copyDiagnostics = () => {
    // Never await network before initiating copy. iPadOS/Safari expires transient
    // user activation when the click handler waits for a fetch.
    const text = JSON.stringify(buildSnapshot(), null, 2);
    const copyAttempt = copyTextToClipboard(text);
    if (!serverDiagnosticsLoading) void refreshServerDiagnostics();
    void copyAttempt.then((result) => {
      setCopyMethod(result.method);
      setCopyFailed(!result.ok);
      if (result.ok) {
        setManualCopyText("");
        window.setTimeout(() => setCopyMethod(null), 2_500);
        return;
      }
      setManualCopyText(text);
      window.setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(".map-diagnostics-manual-copy");
        textarea?.focus({ preventScroll: true });
        textarea?.select();
        textarea?.setSelectionRange(0, textarea.value.length);
      }, 0);
    });
  };

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !serverDiagnosticsLoadedAt) void refreshServerDiagnostics();
  };

  const renderer = rendererStats();
  const campaign = readCampaignData();
  const sourceCommit = runtimeField(runtime, "sourceCommit");
  const environment = runtimeField(runtime, "environment");

  return (
    <aside className={`map-diagnostics${expanded ? " is-expanded" : ""}`}>
      <button className="map-diagnostics-toggle" type="button" onClick={toggleExpanded}>
        DIAG V3 · {fps} FPS
      </button>
      {expanded ? (
        <div className="map-diagnostics-panel">
          <strong>StreetEngine-Diagnose V3</strong>
          <span>
            Build: {sourceCommit ? sourceCommit.slice(0, 12) : runtime.status} · {environment ?? "Umgebung unbekannt"}
          </span>
          <span>
            Gebiete: {campaign.totals.areas} · Straßen: {campaign.totals.streetTasks} · vorbereitet: {campaign.totals.preparedStreetTasks} · Häuser: {campaign.totals.houseTasks}
          </span>
          {campaign.duplicateAreaNames.length > 0 ? (
            <span>
              ⚠ Doppelte Gebietsnamen: {campaign.duplicateAreaNames.map((item) => `${item.name} (${item.areaIds.join(", ")})`).join(" · ")}
            </span>
          ) : <span>Gebietsnamen: keine Dubletten erkannt</span>}
          {campaign.areas.map((area) => (
            <span key={area.id}>
              {area.name} · {area.id} · {area.streetTasks} Straßen · {area.houseTasks} Häuser · {area.polygonVertices ?? "?"} Eckpunkte
            </span>
          ))}

          <strong>StreetEngine Server</strong>
          <span>
            Read-only Diag: {serverDiagnosticsLoading ? "lädt …" : serverDiagnosticsLoadedAt ? `geladen ${serverDiagnosticsLoadedAt}` : "noch nicht geladen"}
          </span>
          {serverDiagnostics.map((area) => {
            const summary = serverDiagnosticSummary(area);
            return (
              <span key={area.areaId}>
                {area.areaName} · {summary.status}
                {summary.phase ? ` · ${summary.phase}` : ""}
                {summary.percent !== null ? ` · ${summary.percent}%` : ""}
                {summary.requests !== null ? ` · ${summary.requests} Requests` : ""}
                {summary.fetchMs !== null ? ` · Fetch ${summary.fetchMs} ms` : ""}
                {summary.graphMs !== null ? ` · Graph ${summary.graphMs} ms` : ""}
                {summary.addressMs !== null ? ` · Address ${summary.addressMs} ms` : ""}
                {summary.linkMs !== null ? ` · Link ${summary.linkMs} ms` : ""}
                {summary.publishMs !== null ? ` · Publish ${summary.publishMs} ms` : ""}
                {area.error ? ` · ${area.error}` : ""}
              </span>
            );
          })}

          <strong>Karte & Browser</strong>
          <span>Renderer: {renderer.kind} · MapLibre Canvas: {renderer.maplibreCanvases} · Style: {renderer.mapStyleReady ? "bereit" : "nicht bereit"}</span>
          <span>FPS: {fps} · schlimmster Frame: {worstFrame.toFixed(1)} ms · Frames &gt;32 ms / 5 s: {longFrames}</span>
          <span>
            Source: {renderer.sourceAreas ?? "–"} Gebiete · {renderer.sourceStreets ?? "–"} Straßen · {renderer.sourceHouses ?? "–"} Häuser
          </span>
          <span>
            Sichtbar: {renderer.renderedAreas ?? "–"} Gebiete · {renderer.renderedStreets ?? "–"} Straßen · {renderer.renderedHouses ?? "–"} Häuser
          </span>
          <span>Container: {renderer.mapContainerSize ?? "–"} · Canvas: {renderer.mapCanvasSize ?? "–"} · DOM: {renderer.totalDomNodes}</span>
          <span>
            API-Requests beobachtet: {relevantResourceStats().apiRequests} · Preparation: {relevantResourceStats().preparationRequests} · Source-Pack: {relevantResourceStats().sourcePackRequestsObserved}
          </span>
          <span>
            Clipboard API: {clipboardApiAvailable() ? "ja" : "nein"} · Fallback: {legacyCopyAvailable() ? "ja" : "nein"} · Secure Context: {window.isSecureContext ? "ja" : "nein"}
          </span>
          {renderer.rendererError ? <span>Renderer-Fehler: {renderer.rendererError}</span> : null}
          {renderer.missingApplicationLayers ? <span>Fehlende Layer: {renderer.missingApplicationLayers}</span> : null}

          <div className="map-diagnostics-actions">
            <button type="button" disabled={serverDiagnosticsLoading} onClick={() => void refreshServerDiagnostics()}>
              {serverDiagnosticsLoading ? "Street-Status lädt …" : "Street-Status aktualisieren"}
            </button>
            <button type="button" onClick={copyDiagnostics}>
              {copyFailed ? "Kopieren fehlgeschlagen" : copyMethod ? "Kopiert ✓" : "Street-Logs kopieren"}
            </button>
          </div>
          {manualCopyText ? (
            <>
              <small>Automatisches Kopieren wurde vom Browser blockiert. Der komplette Report ist ausgewählt und kann manuell kopiert werden.</small>
              <textarea
                className="map-diagnostics-manual-copy"
                readOnly
                rows={8}
                value={manualCopyText}
                onFocus={(event) => event.currentTarget.select()}
              />
            </>
          ) : null}
          <small>
            DIAG lädt StreetEngine-Serverdaten beim Öffnen/Aktualisieren. Kopieren verwendet den zuletzt geladenen Stand sofort und wartet auf kein Netzwerk; danach wird der Serverstatus im Hintergrund aktualisiert.
          </small>
        </div>
      ) : null}
    </aside>
  );
}

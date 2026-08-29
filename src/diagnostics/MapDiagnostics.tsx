import { useEffect, useMemo, useRef, useState } from "react";

type DiagnosticSnapshot = {
  timestamp: string;
  page: string;
  userAgent: string;
  viewport: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  connection: {
    effectiveType: string | null;
    downlinkMbps: number | null;
    rttMs: number | null;
    saveData: boolean | null;
  };
  mode: string;
  data: {
    areas: number;
    streetTasks: number;
    houseTasks: number;
  };
  renderer: {
    kind: string;
    maplibreCanvases: number;
    sourceAreas: number | null;
    sourceStreets: number | null;
    sourceHouses: number | null;
    renderedAreas: number | null;
    renderedStreets: number | null;
    renderedHouses: number | null;
    activeSvgNodes: number;
    totalDomNodes: number;
  };
  performance: {
    fpsLastSecond: number;
    worstFrameMsLastFiveSeconds: number;
    framesOver32MsLastFiveSeconds: number;
    jsHeapUsedMb: number | null;
  };
  basemap: {
    requests: number;
    averageDurationMs: number | null;
    maxDurationMs: number | null;
  };
  capturedMessages: string[];
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

const SNAPSHOT_STORAGE_KEY = "verteil-flyer:campaign-snapshot";
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_-]{32,}/g;

function redact(value: unknown) {
  let text: string;
  if (value instanceof Error) text = `${value.name}: ${value.message}`;
  else if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return text.replace(TOKEN_LIKE_PATTERN, "[redacted]").slice(0, 500);
}

function readDataCounts() {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return { areas: 0, streetTasks: 0, houseTasks: 0 };
    const snapshot = JSON.parse(raw) as {
      areas?: unknown[];
      tasks?: unknown[];
      houseTasks?: unknown[];
    };
    return {
      areas: Array.isArray(snapshot.areas) ? snapshot.areas.length : 0,
      streetTasks: Array.isArray(snapshot.tasks) ? snapshot.tasks.length : 0,
      houseTasks: Array.isArray(snapshot.houseTasks) ? snapshot.houseTasks.length : 0,
    };
  } catch {
    return { areas: -1, streetTasks: -1, houseTasks: -1 };
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
    .filter((entry) => entry.name.includes("basemaps.cartocdn.com"));
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
    sourceAreas: readDatasetNumber(region?.dataset.sourceAreas),
    sourceStreets: readDatasetNumber(region?.dataset.sourceStreets),
    sourceHouses: readDatasetNumber(region?.dataset.sourceHouses),
    renderedAreas: readDatasetNumber(region?.dataset.renderedAreas),
    renderedStreets: readDatasetNumber(region?.dataset.renderedStreets),
    renderedHouses: readDatasetNumber(region?.dataset.renderedHouses),
    activeSvgNodes: document.querySelectorAll(".active-geometry-overlay *").length,
    totalDomNodes: document.getElementsByTagName("*").length,
  };
}

function diagnosticsEnabled() {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.get("diag") === "1";
}

export function MapDiagnostics() {
  const enabled = useMemo(diagnosticsEnabled, []);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fps, setFps] = useState(0);
  const [worstFrame, setWorstFrame] = useState(0);
  const [longFrames, setLongFrames] = useState(0);
  const frameSamplesRef = useRef<Array<{ at: number; delta: number }>>([]);
  const messagesRef = useRef<string[]>([]);

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

    const originalError = console.error;
    const originalWarn = console.warn;
    const capture = (level: string, args: unknown[]) => {
      const message = `${level}: ${args.map(redact).join(" ")}`;
      messagesRef.current = [...messagesRef.current.slice(-9), message];
    };
    console.error = (...args: unknown[]) => {
      capture("error", args);
      originalError(...args);
    };
    console.warn = (...args: unknown[]) => {
      capture("warn", args);
      originalWarn(...args);
    };

    const onError = (event: ErrorEvent) => capture("window-error", [event.error ?? event.message]);
    const onRejection = (event: PromiseRejectionEvent) => capture("unhandled-rejection", [event.reason]);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

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
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [enabled]);

  if (!enabled) return null;

  const buildSnapshot = (): DiagnosticSnapshot => {
    const navigatorHints = navigator as NavigatorWithHints;
    const connection = navigatorHints.connection;
    const performanceMemory = (performance as PerformanceWithMemory).memory;
    const safeUrl = new URL(window.location.href);
    safeUrl.hash = "";
    safeUrl.searchParams.delete("campaign");

    return {
      timestamp: new Date().toISOString(),
      page: `${safeUrl.origin}${safeUrl.pathname}${safeUrl.search}`,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
      hardwareConcurrency:
        typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null,
      deviceMemoryGb:
        typeof navigatorHints.deviceMemory === "number" ? navigatorHints.deviceMemory : null,
      connection: {
        effectiveType: connection?.effectiveType ?? null,
        downlinkMbps: typeof connection?.downlink === "number" ? connection.downlink : null,
        rttMs: typeof connection?.rtt === "number" ? connection.rtt : null,
        saveData: typeof connection?.saveData === "boolean" ? connection.saveData : null,
      },
      mode: currentMode(),
      data: readDataCounts(),
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
      basemap: basemapStats(),
      capturedMessages: messagesRef.current,
    };
  };

  const copyDiagnostics = async () => {
    const text = JSON.stringify(buildSnapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Diagnose kopieren", text);
    }
  };

  const renderer = rendererStats();
  return (
    <aside className={`map-diagnostics${expanded ? " is-expanded" : ""}`}>
      <button
        className="map-diagnostics-toggle"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        DIAG {fps} FPS
      </button>
      {expanded ? (
        <div className="map-diagnostics-panel">
          <strong>Karten-Diagnose</strong>
          <span>Renderer: {renderer.kind}</span>
          <span>FPS: {fps}</span>
          <span>Schlimmster Frame: {worstFrame.toFixed(1)} ms</span>
          <span>Frames &gt;32 ms / 5 s: {longFrames}</span>
          <span>
            Daten: {readDataCounts().areas} Gebiete · {readDataCounts().streetTasks} Straßen · {readDataCounts().houseTasks} Häuser
          </span>
          <span>
            Source: {renderer.sourceAreas ?? "–"} Gebiete · {renderer.sourceStreets ?? "–"} Straßen · {renderer.sourceHouses ?? "–"} Häuser
          </span>
          <span>
            Sichtbar: {renderer.renderedAreas ?? "–"} Gebiete · {renderer.renderedStreets ?? "–"} Straßen · {renderer.renderedHouses ?? "–"} Häuser
          </span>
          <span>MapLibre Canvas: {renderer.maplibreCanvases} · aktive SVG-Nodes: {renderer.activeSvgNodes}</span>
          <button type="button" onClick={() => void copyDiagnostics()}>
            {copied ? "Kopiert ✓" : "Diagnose kopieren"}
          </button>
          <small>Vor dem Kopieren die Karte 5–10 Sekunden so bewegen, wie sie ruckelt.</small>
        </div>
      ) : null}
    </aside>
  );
}

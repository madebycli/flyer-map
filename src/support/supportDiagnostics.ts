export type SupportDiagnosticsInput = {
  appVersion: string;
  language: "de" | "en";
  online: boolean;
  campaignId?: string | null;
  includeCampaignContext?: boolean;
  mapRenderer: "maplibre";
  mapRendererVersion: string;
  snapshotSchemaVersion: number;
  revision?: number | null;
  offlineMapPrepared?: boolean;
};

export type SupportDiagnostics = {
  appVersion: string;
  language: "de" | "en";
  connectivity: "online" | "offline";
  campaignId: string | null;
  mapRenderer: "maplibre";
  mapRendererVersion: string;
  snapshotSchemaVersion: number;
  revision: number | null;
  offlineMapPrepared: boolean;
};

function safeShortIdentifier(value: string | null | undefined) {
  if (!value) return null;
  if (value.length > 160 || !/^[A-Za-z0-9._:-]+$/u.test(value)) return null;
  return value;
}

export function buildSupportDiagnostics(input: SupportDiagnosticsInput): SupportDiagnostics {
  return {
    appVersion: input.appVersion.slice(0, 80),
    language: input.language,
    connectivity: input.online ? "online" : "offline",
    campaignId: input.includeCampaignContext === true ? safeShortIdentifier(input.campaignId) : null,
    mapRenderer: "maplibre",
    mapRendererVersion: input.mapRendererVersion.slice(0, 40),
    snapshotSchemaVersion: Number.isSafeInteger(input.snapshotSchemaVersion)
      ? input.snapshotSchemaVersion
      : 0,
    revision:
      input.revision === null || input.revision === undefined
        ? null
        : Number.isSafeInteger(input.revision) && input.revision >= 0
          ? input.revision
          : null,
    offlineMapPrepared: input.offlineMapPrepared === true,
  };
}

export function supportDiagnosticsText(diagnostics: SupportDiagnostics) {
  const lines = [
    `App: ${diagnostics.appVersion}`,
    `Sprache: ${diagnostics.language}`,
    `Verbindung: ${diagnostics.connectivity}`,
    `Kartenrenderer: ${diagnostics.mapRenderer} ${diagnostics.mapRendererVersion}`,
    `Snapshot-Schema: ${diagnostics.snapshotSchemaVersion}`,
    `Revision: ${diagnostics.revision ?? "unbekannt"}`,
    `Offline-Karte vorbereitet: ${diagnostics.offlineMapPrepared ? "ja" : "nein"}`,
  ];
  if (diagnostics.campaignId) lines.push(`Campaign: ${diagnostics.campaignId}`);
  return lines.join("\n");
}

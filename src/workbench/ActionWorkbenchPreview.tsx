import { useState } from "react";
import { ActionTemplatePanel } from "../admin/ActionTemplatePanel.tsx";
import { AdminAnalyticsExportPanel } from "../admin/AdminAnalyticsExportPanel.tsx";
import { NewActionWizard } from "../admin/NewActionWizard.tsx";
import type { ActionTemplateBlueprint } from "../domain/actionTemplate.ts";
import {
  buildAdminAnalyticsExport,
  type AdminAnalyticsExportPackage,
} from "../domain/adminAnalyticsExport.ts";
import type { NewActionSetupDraft } from "../domain/newActionSetup.ts";
import "./action-workbench-preview.css";

const DISTRIBUTION_TEMPLATE: ActionTemplateBlueprint = {
  schemaVersion: 2,
  mode: "distribution",
  name: "Standard Flyer-Verteilung",
  defaultMapView: { center: [8.4, 49.0], zoom: 15, bearing: 0 },
  operationalDefaults: { fieldGroupDiscoverableByDefault: true },
  teams: [
    { key: "team-orange", name: "Orange", color: "#ea580c" },
    { key: "team-blue", name: "Blau", color: "#2563eb" },
  ],
  areas: [
    {
      key: "area-nord",
      teamKey: "team-orange",
      name: "Nord",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.4, 49.0], [8.405, 49.0], [8.405, 49.004], [8.4, 49.0]]],
      },
    },
    {
      key: "area-sued",
      teamKey: "team-blue",
      name: "Süd",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.4, 48.996], [8.405, 48.996], [8.405, 49.0], [8.4, 48.996]]],
      },
    },
  ],
  roadSections: [
    {
      key: "road-1",
      areaKey: "area-nord",
      label: "Hauptstraße Abschnitt 1",
      geometry: { type: "LineString", coordinates: [[8.4, 49.001], [8.404, 49.001]] },
    },
  ],
};

const COLLECTION_TEMPLATE: ActionTemplateBlueprint = {
  schemaVersion: 2,
  mode: "collection",
  name: "Standard Kleider-Abholung",
  defaultMapView: { center: [8.402, 49.0], zoom: 15.6, bearing: 0 },
  operationalDefaults: { fieldGroupDiscoverableByDefault: true },
  teams: [
    { key: "car-1", name: "Auto 1", color: "#16a34a" },
    { key: "car-2", name: "Auto 2", color: "#dc2626" },
    { key: "car-3", name: "Auto 3", color: "#6b7280" },
  ],
  areas: [
    {
      key: "pickup-a",
      teamKey: "car-1",
      name: "Abholung A",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.4, 49.0], [8.402, 49.0], [8.402, 49.002], [8.4, 49.0]]],
      },
    },
    {
      key: "pickup-b",
      teamKey: "car-2",
      name: "Abholung B",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.402, 49.0], [8.404, 49.0], [8.404, 49.002], [8.402, 49.0]]],
      },
    },
    {
      key: "pickup-c",
      teamKey: "car-3",
      name: "Abholung C",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.4, 48.998], [8.402, 48.998], [8.402, 49.0], [8.4, 48.998]]],
      },
    },
  ],
  roadSections: [],
};

function buildPreviewAnalyticsPackage() {
  return buildAdminAnalyticsExport({
    actionName: "Frühjahr 2027 Flyer-Verteilung",
    templateName: DISTRIBUTION_TEMPLATE.name,
    mode: "distribution",
    generatedAt: "2027-04-21T18:30:00.000Z",
    teams: [
      {
        teamLabel: "Orange",
        distribution: { total: 82, completed: 76, open: 2, later: 3, notDeliverable: 1 },
        pickupTotal: 0,
        pickupCollected: 0,
        sessionCount: 3,
        personMinutes: 810,
      },
      {
        teamLabel: "Blau",
        distribution: { total: 58, completed: 58, open: 0, later: 0, notDeliverable: 0 },
        pickupTotal: 0,
        pickupCollected: 0,
        sessionCount: 2,
        personMinutes: 430,
      },
    ],
    areas: [
      {
        areaLabel: "Nord",
        teamLabel: "Orange",
        distribution: { total: 82, completed: 76, open: 2, later: 3, notDeliverable: 1 },
        pickupTotal: 0,
        pickupCollected: 0,
      },
      {
        areaLabel: "Süd",
        teamLabel: "Blau",
        distribution: { total: 58, completed: 58, open: 0, later: 0, notDeliverable: 0 },
        pickupTotal: 0,
        pickupCollected: 0,
      },
    ],
    sessions: [
      {
        startedAt: "2027-04-10T09:00:00.000Z",
        mode: "distribution",
        teamLabel: "Orange",
        durationMinutes: 150,
        participantCount: 3,
        personMinutes: 450,
        affectedTaskCount: 41,
      },
      {
        startedAt: "2027-04-11T09:15:00.000Z",
        mode: "distribution",
        teamLabel: "Blau",
        durationMinutes: 110,
        participantCount: 2,
        personMinutes: 220,
        affectedTaskCount: 37,
      },
    ],
    events: [
      {
        occurredAt: "2027-04-10T11:10:00.000Z",
        eventType: "task-marked-later",
        teamLabel: "Orange",
        areaLabel: "Nord",
        outcomeCode: "access-problem",
      },
      {
        occurredAt: "2027-04-11T10:45:00.000Z",
        eventType: "area-completed",
        teamLabel: "Blau",
        areaLabel: "Süd",
        outcomeCode: "completed",
      },
    ],
  });
}

function downloadPreviewFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ActionWorkbenchPreview() {
  const [templates, setTemplates] = useState<ActionTemplateBlueprint[]>([
    DISTRIBUTION_TEMPLATE,
    COLLECTION_TEMPLATE,
  ]);
  const [exportPackage, setExportPackage] = useState<AdminAnalyticsExportPackage | null>(null);
  const [message, setMessage] = useState(
    "Nur lokale Vorschau. Neue Aktionen, Vorlagen und Analysepakete werden nicht serverseitig gespeichert.",
  );

  const addImportedTemplate = (template: ActionTemplateBlueprint) => {
    setTemplates((current) => [...current, template]);
    setMessage(`Vorlage ${template.name} lokal geladen.`);
  };

  const showSetupDraft = (draft: NewActionSetupDraft) => {
    setMessage(
      `${draft.mode === "distribution" ? "Flyer-Verteilung" : "Kleider-Abholung"}: ${draft.actionName}` +
        `${draft.templateName ? ` · Vorlage ${draft.templateName}` : " · ohne Vorlage"}` +
        `${draft.cycleLabel ? ` · Zyklus ${draft.cycleLabel}` : ""}`,
    );
  };

  return (
    <main className="action-workbench-preview">
      <header className="action-workbench-preview__header">
        <div>
          <span>Experimenteller Workbench</span>
          <strong>Vorlagen, neue Aktion & Analyse</strong>
          <p>Verteilung und Abholung bleiben getrennte Planungen mit frischem Zustand.</p>
        </div>
        <a href="?">Normale App</a>
      </header>

      <div className="action-workbench-preview__message" role="status">{message}</div>

      <div className="action-workbench-preview__grid">
        <NewActionWizard
          templates={templates}
          canCreateAction
          canImportTemplate
          onImportTemplate={addImportedTemplate}
          onCreateDraft={showSetupDraft}
        />

        <section className="action-workbench-preview__template-card">
          <ActionTemplatePanel
            templates={templates}
            canCreateAction
            canManageTemplates
            onImportTemplate={addImportedTemplate}
            onCreateActionDraft={(template, draft) => {
              setMessage(
                `Lokaler ${draft.mode === "distribution" ? "Verteil" : "Abhol"}-Entwurf aus ${template.name}: ` +
                  `${draft.teams.length} Teams, ${draft.areas.length} Gebiete.`,
              );
            }}
            onEditTemplate={(template) => setMessage(`Preview: Vorlage ${template.name} bearbeiten.`)}
          />
        </section>
      </div>

      <section className="action-workbench-preview__note">
        <strong>Wichtig bei Abholung</strong>
        <p>
          Die Abholvorlage besitzt eigene Auto-Teams und eigene kleinere Gebiete. Sie übernimmt nicht,
          welche Flyer-Gruppe vorher welches Verteilgebiet hatte.
        </p>
      </section>

      <section className="action-workbench-preview__analytics">
        <AdminAnalyticsExportPanel
          authorized
          actionLabel="Frühjahr 2027 Flyer-Verteilung"
          onPrepareExport={buildPreviewAnalyticsPackage}
          onExportReady={(pkg) => {
            setExportPackage(pkg);
            setMessage("Lokales Analysepaket vorbereitet. Die Dateien können einzeln heruntergeladen werden.");
          }}
        />

        {exportPackage ? (
          <div className="action-workbench-preview__downloads">
            <strong>Vorbereitete Dateien</strong>
            <p>Fake-Daten aus dem Workbench, keine echten Campaign-Daten.</p>
            <div>
              {Object.entries(exportPackage.files).map(([fileName, content]) => (
                <button
                  type="button"
                  key={fileName}
                  onClick={() => downloadPreviewFile(fileName, content)}
                >
                  {fileName} herunterladen
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

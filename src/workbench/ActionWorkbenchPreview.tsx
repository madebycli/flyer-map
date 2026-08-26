import { useState } from "react";
import { ActionTemplatePanel } from "../admin/ActionTemplatePanel.tsx";
import { NewActionWizard } from "../admin/NewActionWizard.tsx";
import type { ActionTemplateBlueprint } from "../domain/actionTemplate.ts";
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

export function ActionWorkbenchPreview() {
  const [templates, setTemplates] = useState<ActionTemplateBlueprint[]>([
    DISTRIBUTION_TEMPLATE,
    COLLECTION_TEMPLATE,
  ]);
  const [message, setMessage] = useState(
    "Nur lokale Vorschau. Neue Aktionen und importierte Vorlagen werden nicht gespeichert.",
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
          <strong>Vorlagen & neue Aktion</strong>
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
    </main>
  );
}

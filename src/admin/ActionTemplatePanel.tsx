import { useRef, useState } from "react";
import type {
  ActionMode,
  ActionTemplateBlueprint,
  ActionRunDraft,
} from "../domain/actionTemplate.ts";
import {
  actionRunDraftFromTemplate,
  actionTemplateFilename,
  parseActionTemplateFile,
  serializeActionTemplate,
} from "../domain/actionTemplate.ts";

type Props = {
  templates: ActionTemplateBlueprint[];
  canCreateAction: boolean;
  canManageTemplates: boolean;
  onCreateActionDraft: (template: ActionTemplateBlueprint, draft: ActionRunDraft) => void;
  onImportTemplate?: (template: ActionTemplateBlueprint) => void;
  onEditTemplate?: (template: ActionTemplateBlueprint) => void;
};

function modeLabel(mode: ActionMode) {
  return mode === "distribution" ? "Flyer-Verteilung" : "Kleider-Abholung";
}

function downloadTemplate(template: ActionTemplateBlueprint) {
  const blob = new Blob([serializeActionTemplate(template)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = actionTemplateFilename(template);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ActionTemplatePanel({
  templates,
  canCreateAction,
  canManageTemplates,
  onCreateActionDraft,
  onImportTemplate,
  onEditTemplate,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const createDraft = (template: ActionTemplateBlueprint) => {
    if (!canCreateAction) return;
    onCreateActionDraft(template, actionRunDraftFromTemplate(template));
  };

  const importFile = async (file: File | undefined) => {
    if (!file || !canManageTemplates || !onImportTemplate) return;
    setImportError(null);
    try {
      const template = parseActionTemplateFile(await file.text());
      onImportTemplate(template);
    } catch {
      setImportError("Vorlage konnte nicht geladen werden. Datei oder Version ist ungültig.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section className="action-template-panel" aria-labelledby="action-template-title">
      <div className="action-template-panel__header">
        <div>
          <span>Admin</span>
          <h2 id="action-template-title">Aktionsvorlagen</h2>
          <p>
            Flyer-Verteilung und Kleider-Abholung haben eigene Vorlagen. Abholvorlagen können eigene
            Auto-Teams und kleinere Gebiete enthalten und übernehmen keine Flyer-Zuweisungen.
          </p>
        </div>

        {canManageTemplates && onImportTemplate ? (
          <div className="action-template-panel__import">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              aria-label="Aktionsvorlage laden"
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
          </div>
        ) : null}
      </div>

      {importError ? <p className="action-template-panel__error" role="alert">{importError}</p> : null}

      {templates.length === 0 ? (
        <p className="action-template-panel__empty">Noch keine Vorlage vorhanden.</p>
      ) : (
        <ul className="action-template-panel__list">
          {templates.map((template, index) => (
            <li key={`${template.mode}-${template.name}-${index}`}>
              <div className="action-template-panel__identity">
                <strong>{template.name}</strong>
                <span>{modeLabel(template.mode)}</span>
                <span>
                  {template.teams.length} Teams · {template.areas.length} Gebiete · {template.roadSections.length} Straßenabschnitte
                </span>
                <span>
                  Online-Gruppen standardmäßig {template.operationalDefaults.fieldGroupDiscoverableByDefault ? "sichtbar" : "versteckt"}
                </span>
              </div>

              <div className="action-template-panel__actions">
                <button
                  type="button"
                  disabled={!canCreateAction}
                  onClick={() => createDraft(template)}
                >
                  Neue {modeLabel(template.mode)} aus Vorlage
                </button>
                <button type="button" onClick={() => downloadTemplate(template)}>
                  Vorlage herunterladen
                </button>
                {canManageTemplates && onEditTemplate ? (
                  <button type="button" onClick={() => onEditTemplate(template)}>
                    Vorlage bearbeiten
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="action-template-panel__note">
        Vorlagen enthalten Karte, Teamfarben, Gebiete, geplante Straßen und normale Defaults. Passwörter,
        Room-Codes, QR-Tokens, Zugangslinks, Sessions, Kommentare und erledigte Status werden nie exportiert.
      </p>
    </section>
  );
}

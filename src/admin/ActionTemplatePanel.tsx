import type {
  ActionMode,
  ActionTemplateBlueprint,
  ActionRunDraft,
} from "../domain/actionTemplate.ts";
import { actionRunDraftFromTemplate } from "../domain/actionTemplate.ts";

type Props = {
  templates: ActionTemplateBlueprint[];
  canCreateAction: boolean;
  canManageTemplates: boolean;
  onCreateActionDraft: (template: ActionTemplateBlueprint, draft: ActionRunDraft) => void;
  onEditTemplate?: (template: ActionTemplateBlueprint) => void;
};

function modeLabel(mode: ActionMode) {
  return mode === "distribution" ? "Flyer-Verteilung" : "Kleider-Abholung";
}

export function ActionTemplatePanel({
  templates,
  canCreateAction,
  canManageTemplates,
  onCreateActionDraft,
  onEditTemplate,
}: Props) {
  const createDraft = (template: ActionTemplateBlueprint, mode: ActionMode) => {
    if (!canCreateAction) return;
    onCreateActionDraft(template, actionRunDraftFromTemplate(template, mode));
  };

  return (
    <section className="action-template-panel" aria-labelledby="action-template-title">
      <div className="action-template-panel__header">
        <div>
          <span>Admin</span>
          <h2 id="action-template-title">Aktionsvorlagen</h2>
          <p>
            Wiederverwendbare Planung für Teams, Gebiete und Straßen. Neue Aktionen starten mit
            frischem Fortschritt und eigener Historie.
          </p>
        </div>
      </div>

      {templates.length === 0 ? (
        <p className="action-template-panel__empty">Noch keine Vorlage vorhanden.</p>
      ) : (
        <ul className="action-template-panel__list">
          {templates.map((template) => (
            <li key={template.name}>
              <div className="action-template-panel__identity">
                <strong>{template.name}</strong>
                <span>
                  {template.teams.length} Teams · {template.areas.length} Gebiete · {template.streetSections.length} Straßenabschnitte
                </span>
              </div>

              <div className="action-template-panel__actions">
                {(["distribution", "collection"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    disabled={!canCreateAction}
                    onClick={() => createDraft(template, mode)}
                  >
                    {modeLabel(mode)} starten
                  </button>
                ))}
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
        Vorlage kopiert keine erledigten Status, Einsatzgruppen, Sessions, Kommentare oder Zugangsdaten.
      </p>
    </section>
  );
}

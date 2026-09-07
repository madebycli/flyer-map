import { useMemo, useRef, useState } from "react";
import type { ActionMode, ActionTemplateBlueprint } from "../domain/actionTemplate.ts";
import { parseActionTemplateFile } from "../domain/actionTemplate.ts";
import type { NewActionSetupDraft } from "../domain/newActionSetup.ts";
import {
  buildNewActionSetupDraft,
  compatibleActionTemplates,
} from "../domain/newActionSetup.ts";
import "./new-action-wizard.css";

type Props = {
  templates: ActionTemplateBlueprint[];
  canCreateAction: boolean;
  canImportTemplate: boolean;
  onImportTemplate?: (template: ActionTemplateBlueprint) => void;
  onCreateDraft: (draft: NewActionSetupDraft) => void;
};

function modeLabel(mode: ActionMode) {
  return mode === "distribution" ? "Flyer-Verteilung" : "Kleider-Abholung";
}

export function NewActionWizard({
  templates,
  canCreateAction,
  canImportTemplate,
  onImportTemplate,
  onCreateDraft,
}: Props) {
  const [mode, setMode] = useState<ActionMode>("distribution");
  const [actionName, setActionName] = useState("");
  const [cycleLabel, setCycleLabel] = useState("");
  const [templateIndex, setTemplateIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const compatibleTemplates = useMemo(
    () => compatibleActionTemplates(templates, mode),
    [templates, mode],
  );
  const selectedTemplate = templateIndex >= 0 ? compatibleTemplates[templateIndex] ?? null : null;

  const changeMode = (nextMode: ActionMode) => {
    setMode(nextMode);
    setTemplateIndex(-1);
    setError(null);
  };

  const createDraft = () => {
    if (!canCreateAction) return;
    try {
      const draft = buildNewActionSetupDraft({
        actionName,
        mode,
        template: selectedTemplate,
        cycleLabel,
      });
      setError(null);
      onCreateDraft(draft);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "invalid_action";
      setError(
        code === "invalid_action_name"
          ? "Bitte einen Namen für die Aktion eingeben."
          : code === "invalid_cycle_label"
            ? "Die Bezeichnung des Aktionszyklus ist zu lang."
            : "Die ausgewählte Vorlage passt nicht zur Aktion.",
      );
    }
  };

  const importTemplate = async (file: File | undefined) => {
    if (!file || !canImportTemplate || !onImportTemplate) return;
    try {
      const template = parseActionTemplateFile(await file.text());
      onImportTemplate(template);
      setMode(template.mode);
      setTemplateIndex(-1);
      setError(null);
    } catch {
      setError("Vorlage konnte nicht geladen werden.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section className="new-action-wizard" aria-labelledby="new-action-wizard-title">
      <header>
        <span>Neue Aktion</span>
        <h2 id="new-action-wizard-title">Aktion erstellen</h2>
        <p>Aktionstyp wählen und optional eine passende Vorlage laden oder auswählen.</p>
      </header>

      <fieldset className="new-action-wizard__mode">
        <legend>Art der Aktion</legend>
        {(["distribution", "collection"] as const).map((item) => (
          <label key={item}>
            <input
              type="radio"
              name="action-mode"
              checked={mode === item}
              onChange={() => changeMode(item)}
            />
            {modeLabel(item)}
          </label>
        ))}
      </fieldset>

      <label className="new-action-wizard__field">
        Name der Aktion
        <input
          type="text"
          value={actionName}
          maxLength={160}
          placeholder={mode === "distribution" ? "z. B. Frühjahr 2027 Flyer" : "z. B. Frühjahr 2027 Abholung"}
          onChange={(event) => setActionName(event.target.value)}
        />
      </label>

      <label className="new-action-wizard__field">
        Aktionszyklus (optional)
        <input
          type="text"
          value={cycleLabel}
          maxLength={160}
          placeholder="z. B. Frühjahr 2027"
          onChange={(event) => setCycleLabel(event.target.value)}
        />
      </label>

      <label className="new-action-wizard__field">
        Vorlage
        <select
          value={templateIndex}
          onChange={(event) => setTemplateIndex(Number(event.target.value))}
        >
          <option value={-1}>Ohne Vorlage starten</option>
          {compatibleTemplates.map((template, index) => (
            <option value={index} key={`${template.mode}-${template.name}-${index}`}>
              {template.name}
            </option>
          ))}
        </select>
      </label>

      {canImportTemplate && onImportTemplate ? (
        <label className="new-action-wizard__file">
          Vorlage aus Datei laden
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importTemplate(event.target.files?.[0])}
          />
        </label>
      ) : null}

      <div className="new-action-wizard__summary">
        <strong>{modeLabel(mode)}</strong>
        <span>{selectedTemplate ? `Vorlage: ${selectedTemplate.name}` : "Keine Vorlage"}</span>
        {mode === "collection" ? (
          <small>Abholvorlagen besitzen eigene Auto-Teams/Gebiete und übernehmen keine Flyer-Zuweisungen.</small>
        ) : null}
      </div>

      {error ? <p className="new-action-wizard__error" role="alert">{error}</p> : null}

      <button type="button" disabled={!canCreateAction} onClick={createDraft}>
        Aktionsentwurf erstellen
      </button>
    </section>
  );
}

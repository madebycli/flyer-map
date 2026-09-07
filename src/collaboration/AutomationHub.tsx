import { useCallback, useEffect, useState } from "react";
import { CampaignApiError } from "../data/campaignApi.ts";
import { fetchAutomations, updateAutomation } from "../data/automationApi.ts";
import type { AutomationRuleState } from "../domain/automations.ts";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { resolveRemoteReadState } from "./remoteReadState.ts";
import "./automation-hub.css";

type Props = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
};

type LoadState = "idle" | "loading";

function automationErrorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "automation_schema_unavailable") {
      return "Automationen sind vorbereitet, aber Migration 0009 ist noch nicht angewendet.";
    }
    if (error.status === 401) return "Für Automationen fehlt ein gültiger Zugriff.";
    if (error.status === 403) return "Nur Campaign-Admins dürfen Automationen verwalten.";
    if (error.code === "network_error") return "Die Automationen sind gerade nicht erreichbar.";
    return error.message;
  }
  return "Die Automationen konnten nicht geladen werden.";
}

export function AutomationHub({ context, online, onClose }: Props) {
  const campaignId = context?.campaignId ?? null;
  const isAdmin = context?.accessRole === "admin";
  const [automations, setAutomations] = useState<AutomationRuleState[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [savingRuleType, setSavingRuleType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readState = resolveRemoteReadState({
    loading: loadState === "loading",
    error,
    itemCount: automations.length,
  });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!campaignId || !isAdmin || !online) return;
      setLoadState("loading");
      setError(null);
      try {
        const result = await fetchAutomations(campaignId, signal);
        setAutomations(result.automations);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(automationErrorMessage(loadError));
      } finally {
        if (!signal?.aborted) setLoadState("idle");
      }
    },
    [campaignId, isAdmin, online],
  );

  useEffect(() => {
    if (!online || !campaignId || !isAdmin) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [campaignId, isAdmin, load, online]);

  const toggle = useCallback(
    async (automation: AutomationRuleState) => {
      if (!campaignId || !isAdmin || !online || savingRuleType) return;
      setSavingRuleType(automation.ruleType);
      setError(null);
      try {
        const result = await updateAutomation(campaignId, automation.ruleType, !automation.enabled);
        setAutomations((current) =>
          current.map((candidate) =>
            candidate.ruleType === result.automation.ruleType ? result.automation : candidate,
          ),
        );
      } catch (saveError) {
        setError(automationErrorMessage(saveError));
      } finally {
        setSavingRuleType(null);
      }
    },
    [campaignId, isAdmin, online, savingRuleType],
  );

  return (
    <div className="automation-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="automation-hub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="automation-handle" aria-hidden="true" />
        <header className="automation-header">
          <div>
            <span>Verwaltung</span>
            <strong id="automation-title">Automationen</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Automationen schließen">×</button>
        </header>

        <div className="automation-scroll">
          {!online ? (
            <div className="automation-notice is-offline" role="status">
              Offline: bereits geladene Konfiguration bleibt sichtbar. Änderungen benötigen Internet.
            </div>
          ) : null}

          {!isAdmin ? (
            <div className="automation-notice is-error" role="alert">
              Nur Campaign-Admins dürfen Automationen verwalten.
            </div>
          ) : null}

          {error ? (
            <div className="automation-notice is-error" role="alert">
              <span>{error}</span>
              {online && isAdmin ? (
                <button type="button" onClick={() => void load()}>Erneut laden</button>
              ) : null}
            </div>
          ) : null}

          {readState === "loading" ? (
            <div className="automation-loading" role="status">Automationen werden geladen ...</div>
          ) : null}

          {readState === "empty" ? (
            <div className="automation-empty" role="status">
              {online ? "Keine Automation-Konfiguration verfügbar." : "Automationen sind offline nicht abrufbar."}
            </div>
          ) : null}

          {readState === "data" ? (
            <div className="automation-list" aria-label="Automation-Konfiguration">
              {automations.map((automation) => {
                const saving = savingRuleType === automation.ruleType;
                return (
                  <article className="automation-card" key={automation.ruleType}>
                    <div className="automation-card-heading">
                      <div>
                        <span>Version {automation.version}</span>
                        <strong>{automation.label}</strong>
                      </div>
                      <button
                        className={`automation-switch ${automation.enabled ? "is-enabled" : ""}`}
                        type="button"
                        role="switch"
                        aria-checked={automation.enabled}
                        aria-label={`${automation.label} ${automation.enabled ? "deaktivieren" : "aktivieren"}`}
                        disabled={!online || !isAdmin || savingRuleType !== null}
                        onClick={() => void toggle(automation)}
                      >
                        {saving ? "Wird gespeichert ..." : automation.enabled ? "Aktiv" : "Deaktiviert"}
                      </button>
                    </div>
                    <p>{automation.description}</p>
                    <p className="automation-caution">{automation.caution}</p>
                  </article>
                );
              })}
            </div>
          ) : null}

          <div className="automation-footer">
            <span>Änderungen wirken nur bei neuen, serverseitig autorisierten Statusmutationen.</span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={!online || !isAdmin || loadState !== "idle"}
            >
              Aktualisieren
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

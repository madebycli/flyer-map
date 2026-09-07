import { useMemo, useState } from "react";
import type { AccessInfo } from "../data/campaignApi.ts";
import { appMenuModules, type AppMenuModuleId } from "../navigation/appMenuModel.ts";
import { ActiveTeamContext } from "../navigation/ActiveTeamContext.tsx";
import { AppMenuSurface } from "../navigation/AppMenuSurface.tsx";
import { ProgressSummaryCard } from "../progress/ProgressSummaryCard.tsx";
import { buildSupportDiagnostics, supportDiagnosticsText } from "../support/supportDiagnostics.ts";
import { SupportPanel } from "../support/SupportPanel.tsx";
import type { SupportFeedbackDraft } from "../support/supportFeedback.ts";
import "./workbench-preview.css";

const ADMIN_ACCESS: AccessInfo = {
  campaignId: "campaign_preview",
  role: "admin",
  teamId: null,
  label: "Preview Admin",
};

const TEAM_PROGRESS = {
  denominator: "street-tasks" as const,
  total: 24,
  completed: 15,
  open: 5,
  later: 3,
  notDeliverable: 1,
  remaining: 9,
  percentCompleted: 62.5,
};

export function WorkbenchPreview() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSurface, setActiveSurface] = useState<AppMenuModuleId>("progress");
  const [feedback, setFeedback] = useState<SupportFeedbackDraft | null>(null);

  const diagnostics = useMemo(
    () =>
      supportDiagnosticsText(
        buildSupportDiagnostics({
          appVersion: "workbench",
          language: "de",
          online: navigator.onLine,
          mapRenderer: "maplibre",
          mapRendererVersion: "5.7.1",
          snapshotSchemaVersion: 3,
          revision: 42,
          offlineMapPrepared: true,
        }),
      ),
    [],
  );

  const selectModule = (moduleId: AppMenuModuleId) => {
    setActiveSurface(moduleId);
    setMenuOpen(false);
  };

  return (
    <main className="workbench-preview">
      <header className="workbench-preview-topbar">
        <div>
          <span>Experimentelle UI</span>
          <strong>Verteil-Flyer Workbench</strong>
        </div>
        <ActiveTeamContext
          teamName="Team Orange"
          teamColor="#ea580c"
          progress={TEAM_PROGRESS}
          label="Aktives Team öffnen"
          onOpen={() => setActiveSurface("teams")}
        />
        <button className="workbench-menu-button" type="button" onClick={() => setMenuOpen(true)}>
          Menü
        </button>
      </header>

      <section className="workbench-preview-content">
        <div className="workbench-preview-note">
          <strong>Nur Branch-Preview</strong>
          <span>Diese Oberfläche verändert keine Campaign-Daten und sendet kein Feedback.</span>
        </div>

        {activeSurface === "progress" ? (
          <ProgressSummaryCard
            title="Gesamtfortschritt"
            summary={TEAM_PROGRESS}
            labels={{
              completed: "Erledigt",
              total: "Straßen gesamt",
              open: "Offen",
              later: "Später",
              notDeliverable: "Nicht zustellbar",
              noTasks: "Keine Aufgaben",
            }}
          />
        ) : null}

        {activeSurface === "support" ? (
          <SupportPanel
            diagnosticsText={diagnostics}
            onSubmit={(draft) => setFeedback(draft)}
            labels={{
              title: "Support & Feedback",
              helpTitle: "Hilfe",
              helpBody: "Diese Workbench zeigt nur die vorbereitete Support-Oberfläche.",
              diagnosticsTitle: "Technische Diagnose",
              copyDiagnostics: "Diagnose kopieren",
              copiedDiagnostics: "Kopiert",
              feedbackTitle: "Feedback",
              category: "Kategorie",
              bug: "Fehler",
              idea: "Idee",
              question: "Frage",
              feedbackSubject: "Betreff",
              feedbackMessage: "Nachricht",
              includeCampaignContext: "Campaign-Kontext nach Freigabe mitsenden",
              submit: "Lokal prüfen",
              invalidFeedback: "Bitte Betreff und Nachricht vollständig ausfüllen.",
            }}
          />
        ) : null}

        {activeSurface !== "progress" && activeSurface !== "support" ? (
          <section className="workbench-placeholder">
            <strong>{activeSurface}</strong>
            <span>Für dieses Modul ist im Workbench noch keine integrierte Oberfläche aktiviert.</span>
          </section>
        ) : null}

        {feedback ? (
          <section className="workbench-feedback-result" role="status">
            <strong>Feedback lokal validiert</strong>
            <span>{feedback.title}</span>
            <button type="button" onClick={() => setFeedback(null)}>Schließen</button>
          </section>
        ) : null}
      </section>

      {menuOpen ? (
        <AppMenuSurface
          modules={appMenuModules(ADMIN_ACCESS)}
          onSelect={selectModule}
          onClose={() => setMenuOpen(false)}
          labels={{
            title: "Menü",
            close: "Menü schließen",
            planned: "Geplant",
            progress: "Fortschritt",
            teams: "Teams & Beitreten",
            activity: "Aktivität & Kommentare",
            collection: "Kleidersammlung",
            support: "Support & Feedback",
            settings: "Einstellungen",
            admin: "Admin",
          }}
        />
      ) : null}
    </main>
  );
}

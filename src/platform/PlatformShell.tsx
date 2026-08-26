import { useEffect, useMemo, useState } from "react";
import App from "../App";
import type { AccessInfo } from "../data/campaignApi.ts";
import { loadCampaignSnapshot, subscribeCampaignStore } from "../data/campaignStore.ts";
import type { CampaignSnapshot } from "../domain/campaign.ts";
import { buildProgressOverview } from "../domain/progressOverview.ts";
import type { FieldSessionDraft, ValidatedFieldSessionDraft } from "../domain/fieldSessionDraft.ts";
import type { PickupDraft, PickupStatus } from "../domain/pickup.ts";
import { CommentsPanel, type CommentListItem } from "../collaboration/CommentsPanel.tsx";
import { FieldSessionDraftPanel } from "../collaboration/FieldSessionDraftPanel.tsx";
import { PickupPanel, type PickupListItem } from "../collection/PickupPanel.tsx";
import { ProgressOverviewTable } from "../progress/ProgressOverviewTable.tsx";
import { ProgressSummaryCard } from "../progress/ProgressSummaryCard.tsx";
import { SupportPanel } from "../support/SupportPanel.tsx";
import { buildSupportDiagnostics, supportDiagnosticsText } from "../support/supportDiagnostics.ts";
import { ActionWorkbenchPreview } from "../workbench/ActionWorkbenchPreview.tsx";
import { AdminWorkbenchPreview } from "../workbench/AdminWorkbenchPreview.tsx";
import { LiveGroupWorkbenchPreview } from "../workbench/LiveGroupWorkbenchPreview.tsx";
import { M6SelectionPreview } from "../workbench/M6SelectionPreview.tsx";
import "./platform-shell.css";

type PlatformModuleId =
  | "progress"
  | "operations"
  | "smart"
  | "groups"
  | "actions"
  | "support"
  | "admin";

type PlatformModule = {
  id: PlatformModuleId;
  title: string;
  menuLabel: string;
  description: string;
  badge: string;
  icon: string;
  adminOnly?: boolean;
};

const MODULES: readonly PlatformModule[] = [
  {
    id: "progress",
    title: "Fortschritt",
    menuLabel: "Stats",
    description: "Gesamtstand, Teams und Gebiete auf einen Blick.",
    badge: "Live-Daten",
    icon: "📊",
  },
  {
    id: "groups",
    title: "Live-Gruppen",
    menuLabel: "Team",
    description: "Online-Gruppen, Touren, Teamfilter und Teilnehmerzahl.",
    badge: "Foundation",
    icon: "👥",
  },
  {
    id: "support",
    title: "Support & Feedback",
    menuLabel: "Feedback",
    description: "Diagnose, Hilfe und sicherer Feedback-Entwurf.",
    badge: "Verfügbar",
    icon: "💬",
  },
  {
    id: "smart",
    title: "Smart Streets & Houses",
    menuLabel: "Smart",
    description: "Straßen direkt auf echter Kartengeometrie auswählen und vorbereiten.",
    badge: "M6",
    icon: "🧭",
  },
  {
    id: "operations",
    title: "Aktivität & Einsätze",
    menuLabel: "Einsätze",
    description: "Kommentare, Kleidersammlung und Field-Session-Oberflächen.",
    badge: "Foundation",
    icon: "✅",
  },
  {
    id: "actions",
    title: "Aktionen & Analyse",
    menuLabel: "Aktionen",
    description: "Vorlagen, neue Aktionen, Vergleiche und Analyse-Export.",
    badge: "Admin",
    icon: "📁",
    adminOnly: true,
  },
  {
    id: "admin",
    title: "Organisation & Admin",
    menuLabel: "Admin",
    description: "Rollen, Administratoren und Organisationsverwaltung.",
    badge: "Security-Gate",
    icon: "⚙️",
    adminOnly: true,
  },
] as const;

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function nextLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function PlatformProgressPanel({ snapshot }: { snapshot: CampaignSnapshot }) {
  const overview = useMemo(() => buildProgressOverview(snapshot), [snapshot]);

  return (
    <div className="platform-stack">
      <ProgressSummaryCard
        title="Gesamtfortschritt"
        summary={overview.campaign}
        labels={{
          completed: "Erledigt",
          total: "Straßen gesamt",
          open: "Offen",
          later: "Später",
          notDeliverable: "Nicht zustellbar",
          noTasks: "Noch keine Straßen",
        }}
      />

      <section className="platform-card">
        <div className="platform-card-heading">
          <div>
            <span>Teams</span>
            <strong>{overview.teams.length} Teams in dieser Aktion</strong>
          </div>
        </div>
        <div className="platform-team-progress-grid">
          {overview.teams.map((team) => (
            <article key={team.teamId} className="platform-team-progress-card">
              <div>
                <span className="platform-team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />
                <strong>{team.name || "Team"}</strong>
              </div>
              <span>
                {team.progress.percentCompleted === null
                  ? "Keine Straßen"
                  : `${Math.round(team.progress.percentCompleted)} % erledigt`}
              </span>
              <small>
                {team.progress.completed}/{team.progress.total} Straßen · {team.areaCount} Gebiete
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-card">
        <div className="platform-card-heading">
          <div>
            <span>Gebiete</span>
            <strong>Fortschritt nach Gebiet</strong>
          </div>
        </div>
        <ProgressOverviewTable
          overview={overview}
          labels={{
            team: "Team",
            area: "Gebiet",
            completed: "Erledigt",
            total: "Gesamt",
            progress: "Fortschritt",
            noTasks: "Keine Straßen",
          }}
        />
      </section>
    </div>
  );
}

function PlatformOperationsPanel({
  snapshot,
  access,
}: {
  snapshot: CampaignSnapshot;
  access: AccessInfo | null;
}) {
  const canEdit = Boolean(access && access.role !== "viewer");
  const [comments, setComments] = useState<CommentListItem[]>([]);
  const [pickups, setPickups] = useState<PickupListItem[]>([]);
  const [sessions, setSessions] = useState<ValidatedFieldSessionDraft[]>([]);
  const [sessionDraft, setSessionDraft] = useState<FieldSessionDraft>(() => {
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - 2 * 60 * 60_000);
    return {
      mode: "distribution",
      startedAt: localDateTime(startedAt),
      endedAt: localDateTime(endedAt),
      participantCount: 2,
      note: "",
    };
  });

  const createPickup = (draft: PickupDraft) => {
    setPickups((current) => [
      ...current,
      {
        id: nextLocalId("pickup"),
        address: draft.address,
        note: draft.note,
        status: "open",
      },
    ]);
  };

  const changePickupStatus = (id: string, status: PickupStatus) => {
    setPickups((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
  };

  return (
    <div className="platform-stack">
      <div className="platform-foundation-note" role="status">
        <strong>UI vollständig integriert, Persistenz bleibt bewusst getrennt.</strong>
        <span>
          Kommentare, Pickup-Entwürfe und Field Sessions in dieser Oberfläche sind aktuell lokale
          Foundation-Zustände. Sie umgehen keine Worker-, D1- oder ADR-Sicherheitsgrenze.
        </span>
      </div>

      <CommentsPanel
        targetLabel={snapshot.campaign.name || "Aktuelle Aktion"}
        comments={comments}
        canCreate={canEdit}
        onSubmit={(body) =>
          setComments((current) => [
            ...current,
            {
              id: nextLocalId("comment"),
              body,
              authorLabel: "Dieses Gerät",
              createdAt: new Date().toISOString(),
            },
          ])
        }
        labels={{
          title: "Aktivität & Kommentare",
          context: "Kontext",
          empty: "Noch keine lokalen Kommentare.",
          placeholder: "Hinweis für dieses Gebiet oder diese Aktion …",
          submit: "Kommentar hinzufügen",
          submitting: "Wird hinzugefügt …",
          invalid: "Bitte einen Kommentar mit maximal 2000 Zeichen eingeben.",
          readOnly: "Mit diesem Zugriff können Kommentare nur gelesen werden.",
        }}
      />

      <PickupPanel
        items={pickups}
        canEdit={canEdit}
        onCreate={createPickup}
        onStatusChange={changePickupStatus}
        labels={{
          title: "Kleidersammlung",
          progress: "Abholfortschritt",
          address: "Adresse",
          note: "Notiz",
          add: "Abholung hinzufügen",
          adding: "Wird hinzugefügt …",
          open: "Offen",
          collected: "Abgeholt",
          unavailable: "Nicht erreichbar",
          needsFollowUp: "Nachfassen",
          empty: "Noch keine Abholadressen in diesem lokalen Entwurf.",
          invalidAddress: "Bitte eine gültige Adresse eintragen.",
          readOnly: "Mit diesem Zugriff können Abholungen nur gelesen werden.",
        }}
      />

      {canEdit ? (
        <FieldSessionDraftPanel
          draft={sessionDraft}
          onChange={setSessionDraft}
          onSubmit={(session) => {
            setSessions((current) => [session, ...current]);
            setSessionDraft((current) => ({ ...current, note: "" }));
          }}
          labels={{
            title: "Field Session erfassen",
            distribution: "Flyer-Verteilung",
            collection: "Kleidersammlung",
            startedAt: "Start",
            endedAt: "Ende",
            participants: "Personen",
            note: "Notiz",
            duration: "Dauer",
            personTime: "Personenzeit",
            submit: "Einsatz lokal übernehmen",
            submitting: "Wird übernommen …",
            invalidTime: "Start und Ende sind noch nicht plausibel.",
            invalidParticipants: "Teilnehmerzahl muss zwischen 1 und 500 liegen.",
            noteTooLong: "Die Notiz ist zu lang.",
          }}
        />
      ) : (
        <section className="platform-card">
          <strong>Field Sessions</strong>
          <p>Für diesen Zugriff ist die Einsatz-Erfassung schreibgeschützt.</p>
        </section>
      )}

      <section className="platform-card">
        <div className="platform-card-heading">
          <div>
            <span>Lokaler Verlauf</span>
            <strong>{sessions.length ? `${sessions.length} erfasste Einsätze` : "Noch kein Einsatz erfasst"}</strong>
          </div>
        </div>
        <div className="platform-session-list">
          {sessions.map((session, index) => (
            <article key={`${session.startedAt}-${index}`}>
              <strong>{session.mode === "distribution" ? "Flyer-Verteilung" : "Kleidersammlung"}</strong>
              <span>
                {Math.round(session.metrics.durationMinutes)} min · {session.participantCount} Personen · {Math.round(session.metrics.personMinutes)} Personenminuten
              </span>
              {session.note ? <p>{session.note}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlatformSupportPanel({ snapshot }: { snapshot: CampaignSnapshot }) {
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const diagnostics = useMemo(
    () =>
      supportDiagnosticsText(
        buildSupportDiagnostics({
          appVersion: "platform-ui",
          language: "de",
          online: navigator.onLine,
          mapRenderer: "maplibre",
          mapRendererVersion: "5.7.1",
          snapshotSchemaVersion: 3,
          revision: snapshot.revision,
          offlineMapPrepared: false,
        }),
      ),
    [snapshot.revision],
  );

  return (
    <div className="platform-stack">
      <SupportPanel
        diagnosticsText={diagnostics}
        onSubmit={(draft) => setFeedbackStatus(`Feedback lokal validiert: ${draft.title}`)}
        labels={{
          title: "Support & Feedback",
          helpTitle: "Hilfe",
          helpBody: "Nutze die Diagnose für technische Probleme. Zugangsdaten und Geheimnisse werden nicht automatisch eingefügt.",
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
          submit: "Feedback lokal prüfen",
          invalidFeedback: "Bitte Betreff und Nachricht vollständig ausfüllen.",
        }}
      />
      {feedbackStatus ? <div className="platform-foundation-note" role="status">{feedbackStatus}</div> : null}
    </div>
  );
}

function moduleContent(
  moduleId: PlatformModuleId,
  snapshot: CampaignSnapshot,
  access: AccessInfo | null,
) {
  if (moduleId === "progress") return <PlatformProgressPanel snapshot={snapshot} />;
  if (moduleId === "operations") return <PlatformOperationsPanel snapshot={snapshot} access={access} />;
  if (moduleId === "smart") return <M6SelectionPreview />;
  if (moduleId === "groups") return <LiveGroupWorkbenchPreview />;
  if (moduleId === "actions") return <ActionWorkbenchPreview />;
  if (moduleId === "support") return <PlatformSupportPanel snapshot={snapshot} />;
  return <AdminWorkbenchPreview />;
}

function MenuGridIcon() {
  return (
    <span className="platform-grid-glyph" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </span>
  );
}

export function PlatformShell() {
  const [initialLoad] = useState(loadCampaignSnapshot);
  const [snapshot, setSnapshot] = useState<CampaignSnapshot>(initialLoad.snapshot);
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<PlatformModuleId | null>(null);

  useEffect(
    () =>
      subscribeCampaignStore((update) => {
        if (update.snapshot) setSnapshot(update.snapshot);
        if ("access" in update) setAccess(update.access ?? null);
      }),
    [],
  );

  const isAdmin = access?.role === "admin";
  const visibleModules = MODULES.filter((module) => !module.adminOnly || isAdmin);
  const activeMeta = MODULES.find((module) => module.id === activeModule) ?? null;
  const teamContext = access?.teamId
    ? snapshot.teams.find((team) => team.id === access.teamId) ?? null
    : snapshot.teams[0] ?? null;
  const teamName = teamContext?.name.trim() || "Team";
  const teamColor = teamContext?.color ?? "#64748b";

  const openModule = (moduleId: PlatformModuleId) => {
    const module = MODULES.find((candidate) => candidate.id === moduleId);
    if (!module || (module.adminOnly && !isAdmin)) return;
    setActiveModule(moduleId);
    setMenuOpen(false);
  };

  return (
    <div className="platform-shell">
      <div className="platform-map-layer" aria-hidden={menuOpen || activeModule !== null || undefined}>
        <App />
      </div>

      {!activeModule ? (
        <div className={`platform-field-bar ${menuOpen ? "is-behind-menu" : ""}`}>
          <button
            className="platform-grid-button"
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Menü öffnen"
            title="Menü öffnen"
          >
            <MenuGridIcon />
          </button>
          <div className="platform-active-team" title={teamName}>
            <span className="platform-active-team-dot" style={{ backgroundColor: teamColor }} aria-hidden="true" />
            <strong>{teamName}</strong>
          </div>
        </div>
      ) : null}

      {activeModule && activeMeta ? (
        <section className="platform-module-overlay" role="dialog" aria-modal="true" aria-labelledby="platform-module-title">
          <header className="platform-module-header">
            <button type="button" onClick={() => setActiveModule(null)} aria-label="Zurück zur Karte">← Karte</button>
            <div>
              <span>{activeMeta.badge}</span>
              <strong id="platform-module-title">{activeMeta.title}</strong>
            </div>
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Menü öffnen">Menü</button>
          </header>
          <div className="platform-module-content">{moduleContent(activeModule, snapshot, access)}</div>
        </section>
      ) : null}

      {menuOpen ? (
        <div className="platform-menu-overlay" role="presentation" onMouseDown={() => setMenuOpen(false)}>
          <section
            className="platform-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="platform-menu-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="platform-menu-handle" aria-hidden="true" />
            <header className="platform-menu-header">
              <div>
                <span>Verteil-Flyer</span>
                <strong id="platform-menu-title">Menü</strong>
              </div>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Menü schließen">×</button>
            </header>

            <div className="platform-menu-grid">
              <button
                className="platform-app-item"
                type="button"
                onClick={() => {
                  setActiveModule(null);
                  setMenuOpen(false);
                }}
              >
                <span className="platform-app-icon platform-app-icon--map" aria-hidden="true">🗺️</span>
                <strong>Karte</strong>
              </button>

              {visibleModules.map((module) => (
                <button
                  className="platform-app-item"
                  type="button"
                  key={module.id}
                  onClick={() => openModule(module.id)}
                >
                  <span className={`platform-app-icon platform-app-icon--${module.id}`} aria-hidden="true">
                    {module.icon}
                  </span>
                  <strong>{module.menuLabel}</strong>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

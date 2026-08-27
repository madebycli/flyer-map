import { useEffect, useRef, useState } from "react";
import App from "../App";
import { FieldSessionsHub } from "../collaboration/FieldSessionsHub.tsx";
import { manualRefreshCampaign } from "../data/campaignStore.ts";
import { TeamHub } from "../team/TeamHub.tsx";
import {
  buildPlatformLauncherItems,
  type PlatformAppCommand,
  type PlatformAppCommandType,
  type PlatformAppContext,
} from "./platformContract.ts";
import "./platform-shell.css";

function MenuGridIcon() {
  return (
    <span className="platform-grid-glyph" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </span>
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function PlatformShell() {
  const online = useOnlineStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const [teamHubOpen, setTeamHubOpen] = useState(false);
  const [fieldSessionsOpen, setFieldSessionsOpen] = useState(false);
  const [appContext, setAppContext] = useState<PlatformAppContext | null>(null);
  const [appCommand, setAppCommand] = useState<PlatformAppCommand | null>(null);
  const commandId = useRef(0);

  const launcherItems = buildPlatformLauncherItems(appContext);
  const teamName = appContext?.activeTeam?.name.trim() || "Team";
  const teamColor = appContext?.activeTeam?.color ?? "#64748b";
  const launcherAvailable = appContext?.launcherAvailable ?? true;
  const overlayOpen = menuOpen || teamHubOpen || fieldSessionsOpen;

  const dispatchSimpleCommand = (
    type: Exclude<PlatformAppCommandType, "select-active-team">,
  ) => {
    commandId.current += 1;
    setAppCommand({ id: commandId.current, type });
    setMenuOpen(false);
    setTeamHubOpen(false);
    setFieldSessionsOpen(false);
  };

  const selectActiveTeam = (teamId: string) => {
    commandId.current += 1;
    setAppCommand({ id: commandId.current, type: "select-active-team", teamId });
  };

  return (
    <div className="platform-shell">
      <div className="platform-map-layer" aria-hidden={overlayOpen || undefined}>
        <App
          platformCommand={appCommand}
          onPlatformContextChange={setAppContext}
        />
      </div>

      {launcherAvailable ? (
        <div className={`platform-field-bar ${overlayOpen ? "is-behind-menu" : ""}`}>
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
            <span
              className="platform-active-team-dot"
              style={{ backgroundColor: teamColor }}
              aria-hidden="true"
            />
            <strong>{teamName}</strong>
          </div>
        </div>
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
              {launcherItems.map((item) => (
                <button
                  className="platform-app-item"
                  type="button"
                  key={item.id}
                  onClick={() => {
                    if (item.opensTeamHub) {
                      setMenuOpen(false);
                      setFieldSessionsOpen(false);
                      setTeamHubOpen(true);
                    } else if (item.opensFieldSessions) {
                      setMenuOpen(false);
                      setTeamHubOpen(false);
                      setFieldSessionsOpen(true);
                    } else if (item.command) {
                      dispatchSimpleCommand(item.command);
                    } else {
                      setMenuOpen(false);
                    }
                  }}
                >
                  <span className={`platform-app-icon platform-app-icon--${item.id}`} aria-hidden="true">
                    {item.icon}
                  </span>
                  <strong>{item.label}</strong>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {teamHubOpen ? (
        <TeamHub
          context={appContext}
          online={online}
          onClose={() => setTeamHubOpen(false)}
          onSelectTeam={selectActiveTeam}
          onManageTeams={() => dispatchSimpleCommand("open-team-management")}
          onAccessChanged={manualRefreshCampaign}
        />
      ) : null}

      {fieldSessionsOpen ? (
        <FieldSessionsHub
          context={appContext}
          online={online}
          onClose={() => setFieldSessionsOpen(false)}
        />
      ) : null}
    </div>
  );
}

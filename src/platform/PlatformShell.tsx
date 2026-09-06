
import { useEffect, useRef, useState } from "react";
import App from "../App";
import { CommentsHub } from "../collaboration/CommentsHub.tsx";
import { manualRefreshCampaign } from "../data/campaignStore.ts";
import { StreetsHub } from "../streets/StreetsHub.tsx";
import { RoomsHub } from "../team/RoomsHub.tsx";
import { TeamHub } from "../team/TeamHub.tsx";
import { TeamProgressHub } from "../team/TeamProgressHub.tsx";
import { FieldBottomSheet } from "./FieldBottomSheet.tsx";
import {
  buildPlatformLauncherItems,
  type PlatformAppCommand,
  type PlatformAppCommandType,
  type PlatformAppContext,
} from "./platformContract.ts";
import { SessionMapHighlightProvider } from "./sessionMapHighlight.tsx";
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

type PrimaryHub = "team" | "rooms" | "progress" | "comments" | "streets" | null;

export function PlatformShell() {
  const online = useOnlineStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const [primaryHub, setPrimaryHub] = useState<PrimaryHub>(null);
  const [appContext, setAppContext] = useState<PlatformAppContext | null>(null);
  const [appCommand, setAppCommand] = useState<PlatformAppCommand | null>(null);
  const [activeFieldGroupId, setActiveFieldGroupId] = useState<string | null>(null);
  const commandId = useRef(0);

  const launcherItems = buildPlatformLauncherItems(appContext);
  const teamName = appContext?.activeTeam?.name.trim() || "Team";
  const teamColor = appContext?.activeTeam?.color ?? "#64748b";
  const showActiveTeam = appContext?.accessRole !== "viewer" && Boolean(appContext?.activeTeam);
  const launcherAvailable = appContext?.launcherAvailable ?? true;
  const overlayOpen = menuOpen || primaryHub !== null;
  const syncState = appContext?.syncState ?? (online ? "healthy" : "offline");
  const syncLabel = appContext?.syncLabel ?? (syncState === "offline" ? "Offline" : null);

  const closeOverlays = () => {
    setMenuOpen(false);
    setPrimaryHub(null);
  };

  const dispatchSimpleCommand = (
    type: Exclude<PlatformAppCommandType, "select-active-team" | "open-street-task">,
  ) => {
    closeOverlays();
    commandId.current += 1;
    setAppCommand({ id: commandId.current, type });
  };

  const selectActiveTeam = (teamId: string) => {
    commandId.current += 1;
    setAppCommand({ id: commandId.current, type: "select-active-team", teamId });
  };

  const openStreetTask = (taskId: string) => {
    commandId.current += 1;
    setAppCommand({ id: commandId.current, type: "open-street-task", taskId });
    closeOverlays();
  };

  return (
    <div className="platform-shell">
      <div className="platform-map-layer" aria-hidden={overlayOpen || undefined}>
        <SessionMapHighlightProvider value={null}>
          <App
            platformCommand={appCommand}
            activeFieldGroupId={activeFieldGroupId}
            onPlatformContextChange={setAppContext}
          />
        </SessionMapHighlightProvider>
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
          {showActiveTeam ? (
            <div className="platform-active-team" title={teamName}>
              <span className="platform-active-team-dot" style={{ backgroundColor: teamColor }} aria-hidden="true" />
              <strong>{teamName}</strong>
            </div>
          ) : null}
          <div
            className={`platform-sync-indicator is-${syncState}`}
            role={syncState === "healthy" ? undefined : "status"}
            aria-label={syncState === "healthy" ? "Serverstand aktuell" : syncLabel ?? "Synchronisationsstatus"}
            title={syncState === "healthy" ? "Serverstand aktuell" : syncLabel ?? "Synchronisationsstatus"}
          >
            <span aria-hidden="true" />
            {syncState !== "healthy" && syncLabel ? <strong>{syncLabel}</strong> : null}
          </div>
        </div>
      ) : null}

      {menuOpen ? (
        <FieldBottomSheet open title="Menü" kicker="Verteil-Flyer" onClose={() => setMenuOpen(false)} initialSnap="expanded" className="platform-menu-sheet">
          <div className="platform-menu-grid">
            {launcherItems.map((item) => (
              <button
                className="platform-app-item"
                type="button"
                key={item.id}
                onClick={() => {
                  if (item.opensTeamHub) {
                    setMenuOpen(false);
                    setPrimaryHub("team");
                  } else if (item.opensRoomsHub) {
                    setMenuOpen(false);
                    setPrimaryHub("rooms");
                  } else if (item.opensProgressHub) {
                    setMenuOpen(false);
                    setPrimaryHub("progress");
                  } else if (item.opensCommentsHub) {
                    setMenuOpen(false);
                    setPrimaryHub("comments");
                  } else if (item.opensStreetsHub) {
                    setMenuOpen(false);
                    setPrimaryHub("streets");
                  } else if (item.command) {
                    dispatchSimpleCommand(item.command);
                  }
                }}
              >
                <span className={`platform-app-icon platform-app-icon--${item.id}`} aria-hidden="true">{item.icon}</span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        </FieldBottomSheet>
      ) : null}

      {primaryHub === "team" ? (
        <TeamHub
          context={appContext}
          online={online}
          onClose={() => setPrimaryHub(null)}
          onSelectTeam={selectActiveTeam}
          onManageTeams={() => dispatchSimpleCommand("open-team-management")}
        />
      ) : null}

      {primaryHub === "rooms" ? (
        <RoomsHub
          context={appContext}
          online={online}
          onClose={() => setPrimaryHub(null)}
          onSelectTeam={selectActiveTeam}
          onAccessChanged={manualRefreshCampaign}
          onOperationalGroupChange={setActiveFieldGroupId}
        />
      ) : null}

      {primaryHub === "progress" ? (
        <TeamProgressHub
          context={appContext}
          online={online}
          onClose={() => setPrimaryHub(null)}
          onSelectTeam={selectActiveTeam}
        />
      ) : null}

      {primaryHub === "comments" ? (
        <CommentsHub
          context={appContext}
          online={online}
          onClose={() => setPrimaryHub(null)}
          onChanged={manualRefreshCampaign}
        />
      ) : null}

      {primaryHub === "streets" ? (
        <StreetsHub
          context={appContext}
          onClose={() => setPrimaryHub(null)}
          onManualStreet={() => dispatchSimpleCommand("start-manual-street")}
          onOpenStreet={openStreetTask}
        />
      ) : null}
    </div>
  );
}

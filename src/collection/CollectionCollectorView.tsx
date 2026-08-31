import { useEffect, useMemo, useRef, useState } from "react";
import type { AccessInfo } from "../data/campaignApi";
import {
  collectionPickupCapabilitiesFromUnknown,
} from "../data/pickupCapabilitiesApi.ts";
import type { CampaignSnapshot, LngLat, MapCameraView } from "../domain/campaign";
import {
  collectionAreaColor,
  collectionSnapshotOrEmpty,
  createCollectionId,
  type CollectionArea,
  type CollectionRun,
  type CollectionSnapshot,
} from "../domain/collection";
import type { PickupDraft, PickupSource, PickupStatus, PickupTask } from "../domain/pickup.ts";
import type { Language } from "../i18n";
import { t } from "../i18n";
import { MapView, type MapCameraCommand } from "../map/MapView";
import type { RefreshState } from "../data/campaignStore";
import { PickupPanel } from "./PickupPanel.tsx";
import "./collection-collector.css";

type Props = {
  campaignId: string;
  language: Language;
  snapshot: CampaignSnapshot;
  access: AccessInfo;
  online: boolean;
  refreshState: RefreshState;
  onRefresh: () => void;
  onSnapshotChange: (update: (current: CampaignSnapshot) => CampaignSnapshot) => void;
  onExit: () => void;
};

function copy(language: Language, german: string, english: string) {
  return language === "en" ? english : german;
}

function areaStatus(language: Language, area: CollectionArea) {
  const labels: Record<CollectionArea["status"], [string, string]> = {
    open: ["offen", "open"],
    claimed: ["reserviert", "claimed"],
    "in-progress": ["läuft", "in progress"],
    completed: ["fertig", "completed"],
    archived: ["archiviert", "archived"],
  };
  return copy(language, labels[area.status][0], labels[area.status][1]);
}

function runStatus(language: Language, run: CollectionRun) {
  return run.status === "active"
    ? copy(language, "offen", "active")
    : run.status === "closed"
      ? copy(language, "geschlossen", "closed")
      : copy(language, "abgebrochen", "cancelled");
}

function activeMember(run: CollectionRun, collectorId: string) {
  return run.members.find((member) => member.collectorId === collectorId && member.leftAt === null) ?? null;
}

function updateCollection(
  onSnapshotChange: Props["onSnapshotChange"],
  update: (collection: CollectionSnapshot) => CollectionSnapshot,
) {
  onSnapshotChange((current) => ({
    ...current,
    collection: update(collectionSnapshotOrEmpty(current.collection)),
  }));
}

function pickupActor(collectorId: string) {
  return { kind: "collection-collector" as const, ref: collectorId };
}

export function CollectionCollectorView({
  campaignId,
  language,
  snapshot,
  access,
  online,
  refreshState,
  onRefresh,
  onSnapshotChange,
  onExit,
}: Props) {
  const collection = collectionSnapshotOrEmpty(snapshot.collection);
  const collectorId = access.collectorId;
  const collectorLabel = access.label ?? copy(language, "Sammler", "Collector");
  const pickupCapabilities = collectionPickupCapabilitiesFromUnknown(
    (access as AccessInfo & { collectionCapabilities?: unknown }).collectionCapabilities,
  );
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [currentCamera, setCurrentCamera] = useState<MapCameraView | null>(null);
  const [pickupCameraCommand, setPickupCameraCommand] = useState<MapCameraCommand>(null);
  const [pickupPosition, setPickupPosition] = useState<LngLat | null>(null);
  const [pickupSource, setPickupSource] = useState<PickupSource | null>(null);
  const [pickupPositioning, setPickupPositioning] = useState(false);
  const pickupPositioningRef = useRef(false);
  const preservePickupSourceOnNextCamera = useRef(false);
  const pickupFocusResetTimer = useRef<number | null>(null);
  const pickupCameraCommandId = useRef(0);
  const submitInFlight = useRef(false);
  pickupPositioningRef.current = pickupPositioning;

  useEffect(() => () => {
    if (pickupFocusResetTimer.current !== null) window.clearTimeout(pickupFocusResetTimer.current);
  }, []);

  const visibleAreas = collection.areas.filter((area) => area.status !== "archived");
  const activeRuns = collection.runs.filter((run) => run.status === "active");
  const selectedRun = activeRuns.find((run) => run.id === selectedRunId) ?? activeRuns[0] ?? null;
  const selectedRunMember = selectedRun && collectorId ? activeMember(selectedRun, collectorId) : null;
  const ownedAreas = selectedRun && collectorId
    ? visibleAreas.filter((area) => area.runId === selectedRun.id && area.claimedByCollectorId === collectorId)
    : [];
  const selectedOpenAreaIds = selectedAreaIds.filter((areaId) =>
    visibleAreas.some((area) => area.id === areaId && area.status === "open" && area.runId === null),
  );
  const pickupItems = collection.pickups
    .filter((pickup) => pickup.archivedAt === null)
    .map((pickup) => ({
      id: pickup.id,
      title: pickup.title,
      address: pickup.address,
      description: pickup.description,
      status: pickup.status,
    }));

  const renderedCollectionAreas = useMemo(
    () => visibleAreas.map((area) => ({
      ...area,
      color: area.color || collectionAreaColor(0),
    })),
    [visibleAreas],
  );

  const startRun = () => {
    if (!collectorId || !collection.mainArea || submitInFlight.current) return;
    submitInFlight.current = true;
    const now = new Date().toISOString();
    const runId = createCollectionId("run");
    const memberId = createCollectionId("member");
    updateCollection(onSnapshotChange, (current) => {
      const alreadyOpen = current.runs.some(
        (run) =>
          run.status === "active" &&
          run.members.some((member) => member.collectorId === collectorId && member.leftAt === null),
      );
      if (alreadyOpen) return current;
      const run: CollectionRun = {
        id: runId,
        campaignId,
        mainAreaId: current.mainArea?.id ?? "",
        status: "active",
        startedAt: now,
        endedAt: null,
        createdByCollectorId: collectorId,
        areaIds: [],
        members: [{
          id: memberId,
          runId,
          collectorId,
          label: collectorLabel,
          joinedAt: now,
          leftAt: null,
        }],
        createdAt: now,
        updatedAt: now,
      };
      return { ...current, runs: [...current.runs, run] };
    });
    setSelectedRunId(runId);
    window.setTimeout(() => {
      submitInFlight.current = false;
    }, 0);
  };

  const joinRun = (runId: string) => {
    if (!collectorId || submitInFlight.current) return;
    const run = collection.runs.find((candidate) => candidate.id === runId);
    if (!run || run.status !== "active" || activeMember(run, collectorId)) return;
    submitInFlight.current = true;
    const now = new Date().toISOString();
    const memberId = createCollectionId("member");
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      runs: current.runs.map((candidate) =>
        candidate.id === runId
          ? {
              ...candidate,
              members: [...candidate.members, {
                id: memberId,
                runId,
                collectorId,
                label: collectorLabel,
                joinedAt: now,
                leftAt: null,
              }],
              updatedAt: now,
            }
          : candidate,
      ),
    }));
    setSelectedRunId(runId);
    window.setTimeout(() => {
      submitInFlight.current = false;
    }, 0);
  };

  const leaveRun = () => {
    if (!collectorId || !selectedRun || !selectedRunMember || ownedAreas.length > 0) return;
    const now = new Date().toISOString();
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      runs: current.runs.map((run) =>
        run.id === selectedRun.id
          ? {
              ...run,
              members: run.members.map((member) =>
                member.collectorId === collectorId && member.leftAt === null
                  ? { ...member, leftAt: now }
                  : member,
              ),
              updatedAt: now,
            }
          : run,
      ),
    }));
  };

  const claimAreas = () => {
    if (!collectorId || !selectedRun || !selectedRunMember || selectedOpenAreaIds.length === 0) return;
    const now = new Date().toISOString();
    const selected = new Set(selectedOpenAreaIds);
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      areas: current.areas.map((area) =>
        selected.has(area.id)
          ? {
              ...area,
              status: "claimed",
              runId: selectedRun.id,
              claimedByCollectorId: collectorId,
              claimedByLabel: collectorLabel,
              updatedAt: now,
            }
          : area,
      ),
      runs: current.runs.map((run) =>
        run.id === selectedRun.id
          ? {
              ...run,
              areaIds: [...run.areaIds, ...selectedOpenAreaIds.filter((id) => !run.areaIds.includes(id))],
              updatedAt: now,
            }
          : run,
      ),
    }));
    setSelectedAreaIds([]);
  };

  const changeArea = (areaId: string, nextStatus: CollectionArea["status"]) => {
    if (!collectorId || !selectedRun) return;
    const area = visibleAreas.find((candidate) => candidate.id === areaId);
    if (!area || area.runId !== selectedRun.id || area.claimedByCollectorId !== collectorId) return;
    const now = new Date().toISOString();
    if (nextStatus === "open") {
      updateCollection(onSnapshotChange, (current) => ({
        ...current,
        areas: current.areas.map((candidate) =>
          candidate.id === areaId
            ? {
                ...candidate,
                status: "open",
                runId: null,
                claimedByCollectorId: null,
                claimedByLabel: null,
                completedAt: null,
                updatedAt: now,
              }
            : candidate,
        ),
        runs: current.runs.map((run) =>
          run.id === selectedRun.id
            ? { ...run, areaIds: run.areaIds.filter((id) => id !== areaId), updatedAt: now }
            : run,
        ),
      }));
      return;
    }
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      areas: current.areas.map((candidate) =>
        candidate.id === areaId
          ? {
              ...candidate,
              status: nextStatus,
              completedAt: nextStatus === "completed" ? now : candidate.completedAt,
              updatedAt: now,
            }
          : candidate,
      ),
    }));
  };

  const closeRun = () => {
    if (!selectedRun || !selectedRunMember) return;
    const incomplete = visibleAreas.some(
      (area) => area.runId === selectedRun.id && area.status !== "completed",
    );
    if (incomplete) return;
    const now = new Date().toISOString();
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      runs: current.runs.map((run) =>
        run.id === selectedRun.id
          ? { ...run, status: "closed", endedAt: now, updatedAt: now }
          : run,
      ),
    }));
  };

  const cancelRun = () => {
    if (!selectedRun || !selectedRunMember) return;
    const now = new Date().toISOString();
    const completedIds = new Set(
      visibleAreas
        .filter((area) => area.runId === selectedRun.id && area.status === "completed")
        .map((area) => area.id),
    );
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      areas: current.areas.map((area) =>
        area.runId === selectedRun.id && area.status !== "completed"
          ? {
              ...area,
              status: "open",
              runId: null,
              claimedByCollectorId: null,
              claimedByLabel: null,
              completedAt: null,
              updatedAt: now,
            }
          : area,
      ),
      runs: current.runs.map((run) =>
        run.id === selectedRun.id
          ? { ...run, status: "cancelled", endedAt: now, areaIds: [...completedIds], updatedAt: now }
          : run,
      ),
    }));
  };

  const createPickup = async (draft: PickupDraft & { position: LngLat }) => {
    if (
      !collectorId ||
      !pickupCapabilities.canViewPickups ||
      !pickupCapabilities.canCreatePickups
    ) {
      return;
    }
    const now = new Date().toISOString();
    const actor = pickupActor(collectorId);
    const pickup: PickupTask = {
      id: createCollectionId("pickup"),
      campaignId,
      areaId: draft.areaId ?? null,
      title: draft.title,
      address: draft.address,
      description: draft.description,
      position: draft.position,
      status: "open",
      archivedAt: null,
      assignedRunIds: [],
      assignedCollectorIds: [],
      source: draft.source ?? null,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      pickups: [...collectionSnapshotOrEmpty(current).pickups, pickup],
    }));
  };

  const changePickupStatus = async (pickupId: string, status: PickupStatus) => {
    if (
      !collectorId ||
      !pickupCapabilities.canViewPickups ||
      !pickupCapabilities.canEditPickups
    ) {
      return;
    }
    const now = new Date().toISOString();
    const actor = pickupActor(collectorId);
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      pickups: collectionSnapshotOrEmpty(current).pickups.map((pickup) =>
        pickup.id === pickupId && pickup.archivedAt === null && pickup.status !== status
          ? { ...pickup, status, updatedBy: actor, updatedAt: now }
          : pickup,
      ),
    }));
  };

  const changePickupPosition = (position: LngLat | null, source: PickupSource | null) => {
    setPickupPosition(position);
    setPickupSource(source);
  };

  const focusPickupPosition = (position: LngLat) => {
    preservePickupSourceOnNextCamera.current = true;
    if (pickupFocusResetTimer.current !== null) window.clearTimeout(pickupFocusResetTimer.current);
    pickupFocusResetTimer.current = window.setTimeout(() => {
      preservePickupSourceOnNextCamera.current = false;
      pickupFocusResetTimer.current = null;
    }, 900);
    pickupCameraCommandId.current += 1;
    setPickupCameraCommand({
      id: pickupCameraCommandId.current,
      view: {
        center: position,
        zoom: Math.max(currentCamera?.zoom ?? 0, 17),
        bearing: currentCamera?.bearing ?? 0,
      },
      persist: false,
    });
  };

  const handleCameraChange = (camera: MapCameraView) => {
    setCurrentCamera(camera);
    if (!pickupPositioningRef.current) return;
    if (preservePickupSourceOnNextCamera.current) {
      preservePickupSourceOnNextCamera.current = false;
      if (pickupFocusResetTimer.current !== null) {
        window.clearTimeout(pickupFocusResetTimer.current);
        pickupFocusResetTimer.current = null;
      }
      return;
    }
    setPickupPosition(camera.center);
    setPickupSource(null);
  };

  const setManualPickupPositioning = (active: boolean) => {
    setPickupPositioning(active);
  };

  if (!collectorId) {
    return (
      <main className="collection-screen">
        <section className="collection-card">
          <h1>{copy(language, "Sammlerzugang fehlt", "Collector access missing")}</h1>
          <p>{copy(language, "Dieser QR-Zugang ist nicht mehr gültig.", "This QR access is no longer valid.")}</p>
          <button type="button" onClick={onExit}>{t(language, "close")}</button>
        </section>
      </main>
    );
  }

  return (
    <main className="collection-screen">
      <header className="collection-header">
        <div>
          <span className="eyebrow">{copy(language, "Collection", "Collection")}</span>
          <h1>{collection.mainArea?.name ?? copy(language, "Sammelgebiet", "Collection area")}</h1>
          <p>{collectorLabel}</p>
        </div>
        <div className="collection-header-actions">
          <span className={online ? "connection is-online" : "connection is-offline"}>
            {online ? t(language, "online") : t(language, "offline")}
          </span>
          <button type="button" className="small-action" onClick={onExit}>
            {copy(language, "Beenden", "Exit")}
          </button>
        </div>
      </header>

      <section className={"collection-map-card " + (pickupPositioning ? "is-pickup-positioning" : "")}>
        <MapView
          campaignId={campaignId}
          campaignDefaultView={null}
          language={language}
          areas={[]}
          tasks={[]}
          houses={[]}
          selectedTaskId={null}
          selectedHouseTaskId={null}
          mode="browse"
          draftVertices={[]}
          draftColor="#2563eb"
          editingVertices={[]}
          editingColor="#2563eb"
          selectedVertexIndex={null}
          streetDraftVertices={[]}
          streetDraftColor="#2563eb"
          refreshState={refreshState}
          cameraCommand={pickupCameraCommand}
          onCameraChange={handleCameraChange}
          onRefresh={onRefresh}
          onAreaSelect={() => {}}
          onTaskSelect={() => {}}
          onHouseTaskSelect={() => {}}
          onDrawPoint={() => {}}
          onEditVertexSelect={() => {}}
          onEditVertexMove={() => {}}
          onStreetDrawPoint={() => {}}
          smartRoads={[]}
          smartSelectedSourceIds={[]}
          smartStartAnchor={null}
          smartEndAnchor={null}
          smartWaypointAnchors={[]}
          smartPreviewGeometry={null}
          smartStreetColor="#2563eb"
          onSmartStreetPoint={() => {}}
          smartHouseBuildings={[]}
          smartHouseSelectedSourceIds={[]}
          onSmartHousePoint={() => {}}
          collectionVisible
          collectionMainArea={collection.mainArea}
          collectionAreas={renderedCollectionAreas}
          selectedCollectionAreaId={selectedAreaIds[0] ?? null}
          onCollectionAreaSelect={(areaId) => {
            if (pickupPositioning || !areaId) return;
            setSelectedAreaIds((current) =>
              current.includes(areaId)
                ? current.filter((id) => id !== areaId)
                : [...current, areaId],
            );
          }}
        />
        {pickupPositioning ? (
          <div className="collection-pickup-map-pin" aria-hidden="true">
            <span />
          </div>
        ) : null}
      </section>

      {pickupCapabilities.canViewPickups ? (
        <PickupPanel
          campaignId={campaignId}
          items={pickupItems}
          canCreate={pickupCapabilities.canCreatePickups}
          canEdit={pickupCapabilities.canEditPickups}
          online={online}
          locale={language === "de" ? "de-DE" : "en"}
          position={pickupPosition}
          source={pickupSource}
          mapCenter={currentCamera?.center ?? null}
          manualPositioning={pickupPositioning}
          areaId={null}
          onCreate={createPickup}
          onStatusChange={changePickupStatus}
          onPositionChange={changePickupPosition}
          onFocusPosition={focusPickupPosition}
          onManualPositioningChange={setManualPickupPositioning}
          labels={{
            title: copy(language, "Sonderadressen", "Pickup addresses"),
            progress: copy(language, "Fortschritt", "Progress"),
            pickupTitle: copy(language, "Titel", "Title"),
            address: copy(language, "Adresse", "Address"),
            description: copy(language, "Beschreibung", "Description"),
            add: copy(language, "Sonderadresse hinzufügen", "Add pickup address"),
            adding: copy(language, "Wird gespeichert…", "Saving…"),
            openComposer: copy(language, "+ Sonderadresse hinzufügen", "+ Add pickup address"),
            closeComposer: copy(language, "Schließen", "Close"),
            search: copy(language, "Adresse suchen", "Search address"),
            searchHint: copy(language, "Straße, Hausnummer oder Ort", "Street, number or place"),
            searching: copy(language, "Suche läuft…", "Searching…"),
            searchEmpty: copy(language, "Keine Treffer im Collection-Hauptgebiet.", "No results inside the collection main area."),
            searchOffline: copy(language, "Offline: Suche pausiert, manuelle Eingabe bleibt möglich.", "Offline: search is paused, manual entry remains available."),
            searchError: copy(language, "Adresssuche ist gerade nicht verfügbar.", "Address search is currently unavailable."),
            useLocation: copy(language, "Einmalig Standort nutzen", "Use location once"),
            locationLoading: copy(language, "Standort wird gelesen…", "Reading location…"),
            locationActive: copy(language, "Standort-Bias aktiv", "Location bias active"),
            locationError: copy(language, "Standort nicht verfügbar, Kartenmitte wird verwendet.", "Location unavailable, map center is used."),
            manualPosition: copy(language, "Position auf Karte korrigieren", "Adjust position on map"),
            confirmPosition: copy(language, "Position übernehmen", "Use this position"),
            positionSelected: copy(language, "Position", "Position"),
            open: copy(language, "Offen", "Open"),
            collected: copy(language, "Eingesammelt", "Collected"),
            unavailable: copy(language, "Nicht verfügbar", "Unavailable"),
            needsFollowUp: copy(language, "Später prüfen", "Needs follow-up"),
            empty: copy(language, "Noch keine Sonderadressen.", "No pickup addresses yet."),
            invalidDraft: copy(language, "Bitte Titel, Adresse und Position prüfen.", "Check title, address and position."),
            positionRequired: copy(language, "Eine Kartenposition ist erforderlich.", "A map position is required."),
            readOnly: copy(language, "Sonderadressen sind für diesen Zugang nur lesbar.", "Pickup addresses are read-only for this access."),
            readOnlyCreate: copy(language, "Dieser Zugang darf Sonderadressen bearbeiten, aber keine neuen anlegen.", "This access may edit pickup addresses but cannot create new ones."),
          }}
        />
      ) : null}

      <section className="collection-card collection-actions-card">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">{copy(language, "Gebiete", "Areas")}</span>
            <h2>{copy(language, "Gebiete auswählen", "Select areas")}</h2>
          </div>
          <span className="collection-count">{selectedOpenAreaIds.length}</span>
        </div>
        <div className="collection-area-list">
          {visibleAreas.length === 0 ? (
            <p className="empty-state">{copy(language, "Noch keine Collection-Gebiete eingerichtet.", "No collection areas configured yet.")}</p>
          ) : visibleAreas.map((area) => (
            <button
              className={"collection-area-row " + (selectedAreaIds.includes(area.id) ? "is-selected" : "")}
              key={area.id}
              type="button"
              onClick={() => setSelectedAreaIds((current) =>
                current.includes(area.id)
                  ? current.filter((id) => id !== area.id)
                  : [...current, area.id],
              )}
              disabled={area.status !== "open" || area.runId !== null}
            >
              <span className="collection-color-dot" style={{ backgroundColor: area.color }} aria-hidden="true" />
              <span className="collection-area-copy">
                <strong>{area.name}</strong>
                <small>{areaStatus(language, area)}</small>
              </span>
              <span aria-hidden="true">{selectedAreaIds.includes(area.id) ? "✓" : "+"}</span>
            </button>
          ))}
        </div>
        <div className="collection-button-row">
          {selectedRun && selectedRunMember ? (
            <button type="button" className="primary-action" onClick={claimAreas} disabled={selectedOpenAreaIds.length === 0}>
              {copy(language, "Gebiete übernehmen", "Claim areas")}
            </button>
          ) : (
            <button type="button" className="primary-action" onClick={startRun} disabled={!collection.mainArea}>
              {copy(language, "Collection Run starten", "Start collection run")}
            </button>
          )}
          {selectedRun && selectedRunMember && ownedAreas.length === 0 ? (
            <button type="button" className="secondary-action" onClick={leaveRun}>
              {copy(language, "Run verlassen", "Leave run")}
            </button>
          ) : null}
        </div>
      </section>

      <section className="collection-card">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">{copy(language, "Runs", "Runs")}</span>
            <h2>{copy(language, "Gemeinsam sammeln", "Collect together")}</h2>
          </div>
          <span className="collection-count">{activeRuns.length}</span>
        </div>
        <div className="collection-run-list">
          {activeRuns.length === 0 ? (
            <p className="empty-state">{copy(language, "Noch kein offener Run.", "No open run yet.")}</p>
          ) : activeRuns.map((run) => {
            const member = collectorId ? activeMember(run, collectorId) : null;
            return (
              <article className={"collection-run-row " + (selectedRun?.id === run.id ? "is-selected" : "")} key={run.id}>
                <button type="button" className="collection-run-select" onClick={() => setSelectedRunId(run.id)}>
                  <strong>{run.id.slice(-8)}</strong>
                  <small>{runStatus(language, run)} · {run.members.filter((candidate) => candidate.leftAt === null).length} {copy(language, "Geräte", "devices")}</small>
                </button>
                {member ? (
                  <span className="collection-member-badge">{copy(language, "dabei", "joined")}</span>
                ) : (
                  <button type="button" className="small-action" onClick={() => joinRun(run.id)}>
                    {copy(language, "Beitreten", "Join")}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {selectedRun && selectedRunMember ? (
        <section className="collection-card">
          <div className="collection-section-heading">
            <div>
              <span className="eyebrow">{copy(language, "Deine Gebiete", "Your areas")}</span>
              <h2>{selectedRun.id.slice(-8)}</h2>
            </div>
            <span className="collection-count">{ownedAreas.length}</span>
          </div>
          <div className="collection-owned-list">
            {ownedAreas.length === 0 ? (
              <p className="empty-state">{copy(language, "Noch keine Gebiete übernommen.", "No claimed areas yet.")}</p>
            ) : ownedAreas.map((area) => (
              <article className="collection-owned-row" key={area.id}>
                <div>
                  <strong>{area.name}</strong>
                  <small>{areaStatus(language, area)}</small>
                </div>
                <div className="collection-button-row">
                  {area.status === "claimed" ? (
                    <button type="button" className="small-action" onClick={() => changeArea(area.id, "in-progress")}>
                      {copy(language, "Start", "Start")}
                    </button>
                  ) : null}
                  {area.status === "in-progress" ? (
                    <button type="button" className="small-action" onClick={() => changeArea(area.id, "completed")}>
                      {copy(language, "Fertig", "Complete")}
                    </button>
                  ) : null}
                  {area.status !== "completed" ? (
                    <button type="button" className="text-action" onClick={() => changeArea(area.id, "open")}>
                      {copy(language, "Freigeben", "Release")}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <div className="collection-button-row">
            <button type="button" className="secondary-action" onClick={closeRun} disabled={visibleAreas.some((area) => area.runId === selectedRun.id && area.status !== "completed")}>
              {copy(language, "Run schließen", "Close run")}
            </button>
            <button type="button" className="text-action" onClick={cancelRun}>
              {copy(language, "Run abbrechen", "Cancel run")}
            </button>
          </div>
        </section>
      ) : null}

      <p className="collection-footnote">
        {copy(language, "Änderungen werden über den bestehenden Offline-/Retry-Weg synchronisiert.", "Changes use the existing offline and retry path.")}
      </p>
    </main>
  );
}

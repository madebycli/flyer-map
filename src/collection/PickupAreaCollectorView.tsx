import { useEffect, useMemo, useState } from "react";
import type { AccessInfo } from "../data/campaignApi.ts";
import { postPickupRoomAction } from "../data/campaignApi.ts";
import { collectionMutationQueue } from "../data/collectionMutationQueue.ts";
import type { RefreshState } from "../data/campaignStore.ts";
import { collectionPickupCapabilitiesFromUnknown } from "../data/pickupCapabilitiesApi.ts";
import type { CampaignSnapshot, MapCameraView } from "../domain/campaign.ts";
import {
  collectionAreaColor,
  collectionSnapshotOrEmpty,
  createCollectionId,
  PICKUP_COMPLETION_CONFIRMATION,
  type CollectionArea,
  type CollectionRoadSectionStatus,
  type CollectionRoom,
} from "../domain/collection.ts";
import type { PickupStatus } from "../domain/pickup.ts";
import type { Language } from "../i18n.ts";
import { MapView } from "../map/MapView.tsx";
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

const SECTION_STATUS_ORDER: CollectionRoadSectionStatus[] = ["open", "driven", "later", "unavailable"];

function copy(language: Language, german: string, english: string) {
  return language === "en" ? english : german;
}

function sectionStatusLabel(language: Language, status: CollectionRoadSectionStatus) {
  const labels: Record<CollectionRoadSectionStatus, [string, string]> = {
    open: ["offen", "open"],
    driven: ["gefahren", "driven"],
    later: ["später", "later"],
    unavailable: ["nicht möglich", "unavailable"],
  };
  return copy(language, labels[status][0], labels[status][1]);
}

function areaStateLabel(language: Language, area: CollectionArea) {
  const status = area.pickupState ?? area.status;
  const labels: Record<CollectionArea["status"], [string, string]> = {
    open: ["offen", "open"],
    claimed: ["übernommen", "claimed"],
    "in-progress": ["läuft", "in progress"],
    completed: ["fertig", "completed"],
    archived: ["archiviert", "archived"],
  };
  return copy(language, labels[status][0], labels[status][1]);
}

function activeMember(room: CollectionRoom | null, collectorId: string | null) {
  return room && collectorId
    ? room.participants.find((member) => member.collectorId === collectorId && member.leftAt === null) ?? null
    : null;
}

export function PickupAreaCollectorView({
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
  const collectorId = access.collectorId ?? null;
  const collectorLabel = access.label ?? copy(language, "Sammler", "Collector");
  const capabilities = collectionPickupCapabilitiesFromUnknown(
    (access as AccessInfo & { collectionCapabilities?: unknown }).collectionCapabilities,
  );
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(collection.areas[0]?.id ?? null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [camera, setCamera] = useState<MapCameraView | null>(null);
  const selectedArea = collection.areas.find((area) => area.id === selectedAreaId) ?? collection.areas[0] ?? null;
  const activeRoom = selectedArea
    ? collection.rooms.find((room) => room.areaId === selectedArea.id && room.status === "active") ?? null
    : null;
  const member = activeMember(activeRoom, collectorId);
  const canChangeProgress = capabilities.canEditPickups && Boolean(member);
  const pendingSyncCount = collectionMutationQueue.list(campaignId).length;

  useEffect(() => {
    if (selectedAreaId && collection.areas.some((area) => area.id === selectedAreaId && area.status !== "archived")) return;
    setSelectedAreaId(collection.areas.find((area) => area.status !== "archived")?.id ?? null);
  }, [collection.areas, selectedAreaId]);

  const renderedAreas = useMemo(
    () => collection.areas
      .filter((area) => area.status !== "archived")
      .map((area, index) => ({ ...area, color: area.color || collectionAreaColor(index) })),
    [collection.areas],
  );
  const visiblePickups = useMemo(() => {
    if (!capabilities.canViewPickups) return [];
    return collection.pickups.filter((pickup) => pickup.archivedAt === null && pickup.areaId === (selectedArea?.id ?? null));
  }, [capabilities.canViewPickups, collection.pickups, selectedArea?.id]);
  const pickupItems = visiblePickups.map((pickup) => ({
    id: pickup.id,
    title: pickup.title,
    address: pickup.address,
    description: pickup.description,
    status: pickup.status,
    assignedRunIds: pickup.assignedRunIds,
    assignedCollectorIds: pickup.assignedCollectorIds,
  }));
  const progress = collection.progress.find((item) => item.areaId === selectedArea?.id) ?? null;
  const sections = collection.roadSections.filter((section) => section.areaId === selectedArea?.id);

  const runRoomAction = async (
    action: "claim" | "join" | "release" | "complete",
    roomId: string,
    input: Record<string, unknown> = {},
  ) => {
    if (!online || busyAction || !collectorId) return;
    setBusyAction(action);
    setMessage(null);
    try {
      await postPickupRoomAction(campaignId, selectedArea?.id ?? "", action, { roomId, ...input });
      await Promise.resolve(onRefresh());
      setMessage(copy(language, "Room-Stand aktualisiert.", "Room state updated."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy(language, "Room-Aktion fehlgeschlagen.", "Room action failed."));
    } finally {
      setBusyAction(null);
    }
  };

  const claim = () => {
    if (!selectedArea || selectedArea.status === "completed" || selectedArea.status === "archived") return;
    void runRoomAction("claim", createCollectionId("room"), {
      label: collectorLabel,
      participantId: createCollectionId("participant"),
    });
  };

  const join = () => {
    if (!activeRoom) return;
    void runRoomAction("join", activeRoom.id, {
      label: collectorLabel,
      participantId: createCollectionId("participant"),
    });
  };

  const closeRoom = (action: "release" | "complete") => {
    if (!activeRoom || !member || !selectedArea || pendingSyncCount !== 0 || !online) return;
    const confirmed = typeof window === "undefined" || window.confirm(
      copy(
        language,
        `${PICKUP_COMPLETION_CONFIRMATION}\n\nDer aktuelle Stand ist synchronisiert. Fortfahren?`,
        `${PICKUP_COMPLETION_CONFIRMATION}\n\nThe current state is synchronized. Continue?`,
      ),
    );
    if (!confirmed) return;
    void runRoomAction(action, activeRoom.id, {
      expectedRevision: snapshot.revision,
      roomUpdatedAt: activeRoom.updatedAt,
      pendingSyncCount,
      completenessConfirmed: true,
      confirmationText: PICKUP_COMPLETION_CONFIRMATION,
    });
  };

  const updateSectionStatus = (sectionId: string, status: CollectionRoadSectionStatus) => {
    if (!canChangeProgress || !activeRoom || !selectedArea) return;
    const now = new Date().toISOString();
    onSnapshotChange((current) => ({
      ...current,
      collection: {
        ...collectionSnapshotOrEmpty(current.collection),
        roadSections: collectionSnapshotOrEmpty(current.collection).roadSections.map((section) =>
          section.id === sectionId ? { ...section, status, updatedAt: now } : section,
        ),
      },
    }));
  };

  const updatePickupStatus = (pickupId: string, status: PickupStatus) => {
    if (!canChangeProgress || !collectorId) return;
    const now = new Date().toISOString();
    onSnapshotChange((current) => ({
      ...current,
      collection: {
        ...collectionSnapshotOrEmpty(current.collection),
        pickups: collectionSnapshotOrEmpty(current.collection).pickups.map((pickup) =>
          pickup.id === pickupId && pickup.archivedAt === null
            ? { ...pickup, status, updatedBy: { kind: "collection-collector", ref: collectorId }, updatedAt: now }
            : pickup,
        ),
      },
    }));
  };

  if (!collectorId) {
    return (
      <main className="collection-screen">
        <section className="collection-card">
          <h1>{copy(language, "Sammlerzugang fehlt", "Collector access missing")}</h1>
          <p>{copy(language, "Dieser QR-Zugang ist nicht mehr gültig.", "This QR access is no longer valid.")}</p>
          <button type="button" onClick={onExit}>{copy(language, "Schließen", "Close")}</button>
        </section>
      </main>
    );
  }

  return (
    <main className="collection-screen pickup-area-screen">
      <header className="collection-header">
        <div>
          <span className="eyebrow">{copy(language, "Flyer abholen", "Flyer pickup")}</span>
          <h1>{collection.mainArea?.name ?? copy(language, "Pickup Areas", "Pickup areas")}</h1>
          <p>{collectorLabel}</p>
        </div>
        <div className="collection-header-actions">
          <span className={online ? "connection is-online" : "connection is-offline"}>
            {online ? copy(language, "online", "online") : copy(language, "offline", "offline")}
          </span>
          <button type="button" className="small-action" onClick={onExit}>{copy(language, "Beenden", "Exit")}</button>
        </div>
      </header>

      <section className="collection-card">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">{copy(language, "Pickup Areas", "Pickup areas")}</span>
            <h2>{copy(language, "Gebiet auswählen", "Select an area")}</h2>
          </div>
          <span className="collection-count">{collection.areas.filter((area) => area.status !== "archived").length}</span>
        </div>
        <div className="collection-area-list">
          {collection.areas.filter((area) => area.status !== "archived").map((area) => (
            <button
              type="button"
              key={area.id}
              className={`collection-area-row ${area.id === selectedArea?.id ? "is-selected" : ""}`}
              onClick={() => setSelectedAreaId(area.id)}
              disabled={area.status === "archived"}
            >
              <span className="collection-color-dot" style={{ backgroundColor: area.color }} aria-hidden="true" />
              <span className="collection-area-copy"><strong>{area.name}</strong><small>{areaStateLabel(language, area)}</small></span>
              <span aria-hidden="true">{area.id === selectedArea?.id ? "✓" : "→"}</span>
            </button>
          ))}
          {collection.areas.length === 0 ? <p className="empty-state">{copy(language, "Noch keine Pickup Areas.", "No pickup areas yet.")}</p> : null}
        </div>
      </section>

      <section className="collection-map-card pickup-area-map-card">
        <MapView
          campaignId={campaignId}
          campaignDefaultView={snapshot.campaign.defaultMapView ?? null}
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
          cameraCommand={null}
          onCameraChange={setCamera}
          onRefresh={onRefresh}
          onAreaSelect={() => {}}
          onTaskSelect={() => {}}
          onHouseTaskSelect={() => {}}
          onDrawPoint={() => {}}
          onEditVertexSelect={() => {}}
          onEditVertexMove={() => {}}
          onStreetDrawPoint={() => {}}
          collectionVisible
          collectionMainArea={collection.mainArea}
          collectionAreas={renderedAreas}
          selectedCollectionAreaId={selectedArea?.id ?? null}
          collectionPickups={visiblePickups}
          collectionRoadSections={collection.roadSections}
          selectedCollectionPickupId={null}
          onCollectionAreaSelect={setSelectedAreaId}
          onCollectionPickupSelect={() => {}}
        />
        <span className="pickup-area-map-hint">{camera ? copy(language, "Karte zeigt den gewählten Bereich und seine Pickup-Straßen.", "Map shows the selected area and its pickup roads.") : ""}</span>
      </section>

      {selectedArea ? (
        <section className="collection-card pickup-room-card">
          <div className="collection-section-heading">
            <div><span className="eyebrow">{copy(language, "Room", "Room")}</span><h2>{selectedArea.name}</h2></div>
            <span className="collection-count">{activeRoom ? activeRoom.participants.filter((candidate) => candidate.leftAt === null).length : 0}</span>
          </div>
          <p className="collection-footnote">
            {activeRoom
              ? copy(language, `Gemeinsamer Room · ${activeRoom.participants.filter((candidate) => candidate.leftAt === null).map((candidate) => candidate.label).join(", ")}`, `Shared room · ${activeRoom.participants.filter((candidate) => candidate.leftAt === null).map((candidate) => candidate.label).join(", ")}`)
              : copy(language, "Noch kein aktiver Room. Übernehmen erstellt ihn atomar für dieses Gebiet.", "No active room yet. Claiming creates it atomically for this area.")}
          </p>
          <div className="collection-button-row">
            {!activeRoom ? (
              <button type="button" className="primary-action" disabled={!online || !capabilities.canEditPickups || selectedArea.status === "completed" || Boolean(busyAction)} onClick={claim}>
                {busyAction === "claim" ? copy(language, "Wird übernommen…", "Claiming…") : copy(language, "Gebiet übernehmen", "Claim area")}
              </button>
            ) : !member ? (
              <button type="button" className="primary-action" disabled={!online || !capabilities.canEditPickups || Boolean(busyAction)} onClick={join}>
                {busyAction === "join" ? copy(language, "Beitritt…", "Joining…") : copy(language, "Room beitreten", "Join room")}
              </button>
            ) : (
              <>
                <button type="button" className="secondary-action" disabled={!online || pendingSyncCount > 0 || Boolean(busyAction)} onClick={() => closeRoom("release")}>
                  {busyAction === "release" ? copy(language, "Wird freigegeben…", "Releasing…") : copy(language, "Room freigeben", "Release room")}
                </button>
                <button type="button" className="primary-action" disabled={!online || pendingSyncCount > 0 || Boolean(busyAction)} onClick={() => closeRoom("complete")}>
                  {busyAction === "complete" ? copy(language, "Wird abgeschlossen…", "Completing…") : copy(language, "Gebiet abschließen", "Complete area")}
                </button>
              </>
            )}
          </div>
          <p className="pickup-room-sync-note">
            {pendingSyncCount > 0
              ? copy(language, `${pendingSyncCount} lokale Änderung(en) warten auf Synchronisierung.`, `${pendingSyncCount} local change(s) waiting to sync.`)
              : copy(language, "Alle lokalen Änderungen sind synchronisiert.", "All local changes are synchronized.")}
          </p>
        </section>
      ) : null}

      {selectedArea ? (
        <section className="collection-card pickup-road-sections-card">
          <div className="collection-section-heading">
            <div><span className="eyebrow">{copy(language, "Straßen", "Roads")}</span><h2>{copy(language, "Pickup-Abschnitte", "Pickup sections")}</h2></div>
            <span className="collection-count">{progress ? `${progress.roadSectionsDriven}/${progress.roadSectionsTotal}` : `${sections.filter((section) => section.status === "driven").length}/${sections.length}`}</span>
          </div>
          <p className="collection-footnote">{copy(language, "Der Straßenstatus ist getrennt vom Verteilmodus und wird nur im aktiven Room geschrieben.", "Road status is separate from distribution and can only be changed in the active room.")}</p>
          <div className="pickup-road-section-list">
            {sections.map((section) => (
              <article className={`pickup-road-section-row is-${section.status}`} key={section.id}>
                <div><strong>{section.label}</strong><small>{section.status === "driven" ? copy(language, "Erledigt", "Done") : copy(language, "Pickup-Straße", "Pickup road")}</small></div>
                <select aria-label={`${section.label}: ${copy(language, "Status", "Status")}`} value={section.status} disabled={!canChangeProgress} onChange={(event) => updateSectionStatus(section.id, event.target.value as CollectionRoadSectionStatus)}>
                  {SECTION_STATUS_ORDER.map((status) => <option key={status} value={status}>{sectionStatusLabel(language, status)}</option>)}
                </select>
              </article>
            ))}
            {sections.length === 0 ? <p className="empty-state">{copy(language, "Noch keine Pickup-Straßen vorbereitet.", "No pickup roads prepared yet.")}</p> : null}
          </div>
        </section>
      ) : null}

      {capabilities.canViewPickups ? (
        <PickupPanel
          campaignId={campaignId}
          items={pickupItems}
          canCreate={false}
          canEdit={canChangeProgress}
          canAssign={false}
          assignmentRunOptions={[]}
          assignmentCollectorOptions={[]}
          online={online}
          locale={language === "de" ? "de-DE" : "en"}
          position={null}
          source={null}
          mapCenter={camera?.center ?? null}
          manualPositioning={false}
          areaId={selectedArea?.id ?? null}
          onCreate={async () => undefined}
          onStatusChange={updatePickupStatus}
          onAssignmentChange={async () => undefined}
          onPositionChange={() => {}}
          onFocusPosition={() => {}}
          onManualPositioningChange={() => {}}
          labels={{
            title: copy(language, "Pickup-Adressen", "Pickup addresses"),
            progress: copy(language, "Fortschritt", "Progress"),
            pickupTitle: copy(language, "Titel", "Title"),
            address: copy(language, "Adresse", "Address"),
            description: copy(language, "Beschreibung", "Description"),
            add: "",
            adding: "",
            openComposer: "",
            closeComposer: copy(language, "Schließen", "Close"),
            search: "",
            searchHint: "",
            searching: "",
            searchEmpty: "",
            searchOffline: "",
            searchError: "",
            useLocation: "",
            locationLoading: "",
            locationActive: "",
            locationError: "",
            manualPosition: "",
            confirmPosition: "",
            positionSelected: "",
            open: copy(language, "Offen", "Open"),
            collected: copy(language, "Eingesammelt", "Collected"),
            unavailable: copy(language, "Nicht verfügbar", "Unavailable"),
            needsFollowUp: copy(language, "Später prüfen", "Needs follow-up"),
            empty: copy(language, "Keine Pickup-Adressen in diesem Gebiet.", "No pickup addresses in this area."),
            invalidDraft: "",
            positionRequired: "",
            readOnly: copy(language, "Pickup-Fortschritt ist nur im aktiven Room editierbar.", "Pickup progress is editable only in the active room."),
            readOnlyCreate: "",
          }}
        />
      ) : null}

      {message ? <p className="collection-message" role="status">{message}</p> : null}
      <p className="collection-footnote">{copy(language, "Fortschritt bleibt beim App-Neustart erhalten. Room-Freigabe ist erst nach bestätigter Synchronisierung möglich.", "Progress survives app restart. A room can be released only after synchronized progress is confirmed.")}</p>
    </main>
  );
}

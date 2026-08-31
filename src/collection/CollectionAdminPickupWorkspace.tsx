import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignSnapshot, LngLat, MapCameraView } from "../domain/campaign.ts";
import {
  collectionAreaColor,
  collectionSnapshotOrEmpty,
  createCollectionId,
  type CollectionSnapshot,
} from "../domain/collection.ts";
import type { PickupDraft, PickupSource, PickupStatus, PickupTask } from "../domain/pickup.ts";
import type { Language } from "../i18n.ts";
import { MapView, type MapCameraCommand } from "../map/MapView.tsx";
import { manualRefreshCampaign } from "../data/campaignStore.ts";
import { PickupPanel } from "./PickupPanel.tsx";
import {
  PickupLifecyclePanel,
  type PickupLifecycleEdit,
} from "./PickupLifecyclePanel.tsx";
import "./collection-admin-pickup-workspace.css";

type Props = {
  campaignId: string;
  language: Language;
  snapshot: CampaignSnapshot;
  onSnapshotChange: (update: (current: CampaignSnapshot) => CampaignSnapshot) => void;
};

function copy(language: Language, german: string, english: string) {
  return language === "en" ? english : german;
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
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

function updateCollection(
  onSnapshotChange: Props["onSnapshotChange"],
  update: (collection: CollectionSnapshot) => CollectionSnapshot,
) {
  onSnapshotChange((current) => ({
    ...current,
    collection: update(collectionSnapshotOrEmpty(current.collection)),
  }));
}

function samePosition(a: LngLat, b: LngLat) {
  return a[0] === b[0] && a[1] === b[1];
}

const adminActor = { kind: "campaign-grant" as const, ref: null };

export function CollectionAdminPickupWorkspace({
  campaignId,
  language,
  snapshot,
  onSnapshotChange,
}: Props) {
  const online = useOnlineStatus();
  const collection = collectionSnapshotOrEmpty(snapshot.collection);
  const [selectedPickupId, setSelectedPickupId] = useState<string | null>(null);
  const [currentCamera, setCurrentCamera] = useState<MapCameraView | null>(null);
  const [cameraCommand, setCameraCommand] = useState<MapCameraCommand>(null);
  const [pickupPosition, setPickupPosition] = useState<LngLat | null>(null);
  const [pickupSource, setPickupSource] = useState<PickupSource | null>(null);
  const [pickupPositioning, setPickupPositioning] = useState(false);
  const pickupPositioningRef = useRef(false);
  const preservePickupSourceOnNextCamera = useRef(false);
  const focusResetTimer = useRef<number | null>(null);
  const cameraCommandId = useRef(0);
  pickupPositioningRef.current = pickupPositioning;

  useEffect(() => () => {
    if (focusResetTimer.current !== null) window.clearTimeout(focusResetTimer.current);
  }, []);

  const activePickups = collection.pickups.filter((pickup) => pickup.archivedAt === null);
  const pickupItems = activePickups.map((pickup) => ({
    id: pickup.id,
    title: pickup.title,
    address: pickup.address,
    description: pickup.description,
    status: pickup.status,
    assignedRunIds: pickup.assignedRunIds,
    assignedCollectorIds: pickup.assignedCollectorIds,
  }));
  const lifecycleItems = collection.pickups.map((pickup) => ({
    id: pickup.id,
    title: pickup.title,
    address: pickup.address,
    description: pickup.description,
    position: pickup.position,
    areaId: pickup.areaId,
    status: pickup.status,
    archivedAt: pickup.archivedAt,
  }));
  const renderedAreas = useMemo(
    () => collection.areas
      .filter((area) => area.status !== "archived")
      .map((area, index) => ({ ...area, color: area.color || collectionAreaColor(index) })),
    [collection.areas],
  );

  useEffect(() => {
    if (selectedPickupId && !activePickups.some((pickup) => pickup.id === selectedPickupId)) {
      setSelectedPickupId(null);
    }
  }, [activePickups, selectedPickupId]);

  const focusPosition = (position: LngLat) => {
    preservePickupSourceOnNextCamera.current = true;
    if (focusResetTimer.current !== null) window.clearTimeout(focusResetTimer.current);
    focusResetTimer.current = window.setTimeout(() => {
      preservePickupSourceOnNextCamera.current = false;
      focusResetTimer.current = null;
    }, 900);
    cameraCommandId.current += 1;
    setCameraCommand({
      id: cameraCommandId.current,
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
      if (focusResetTimer.current !== null) {
        window.clearTimeout(focusResetTimer.current);
        focusResetTimer.current = null;
      }
      return;
    }
    setPickupPosition(camera.center);
    setPickupSource(null);
  };

  const createPickup = async (draft: PickupDraft & { position: LngLat }) => {
    const now = new Date().toISOString();
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
      createdBy: adminActor,
      updatedBy: adminActor,
      createdAt: now,
      updatedAt: now,
    };
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      pickups: [...current.pickups, pickup],
    }));
    setSelectedPickupId(pickup.id);
    focusPosition(pickup.position);
  };

  const changeStatus = async (pickupId: string, status: PickupStatus) => {
    const existing = activePickups.find((pickup) => pickup.id === pickupId);
    if (!existing || existing.status === status) return;
    const now = new Date().toISOString();
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      pickups: current.pickups.map((pickup) =>
        pickup.id === pickupId && pickup.archivedAt === null
          ? { ...pickup, status, updatedBy: adminActor, updatedAt: now }
          : pickup,
      ),
    }));
  };

  const changeDetails = async (pickupId: string, input: PickupLifecycleEdit) => {
    const existing = activePickups.find((pickup) => pickup.id === pickupId);
    if (!existing) return;
    const changed =
      existing.areaId !== input.areaId ||
      existing.title !== input.title ||
      existing.address !== input.address ||
      existing.description !== input.description ||
      !samePosition(existing.position, input.position);
    if (!changed) return;
    const now = new Date().toISOString();
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      pickups: current.pickups.map((pickup) =>
        pickup.id === pickupId && pickup.archivedAt === null
          ? {
              ...pickup,
              areaId: input.areaId,
              title: input.title,
              address: input.address,
              description: input.description,
              position: input.position,
              updatedBy: adminActor,
              updatedAt: now,
            }
          : pickup,
      ),
    }));
    setSelectedPickupId(pickupId);
    focusPosition(input.position);
  };

  const archivePickup = async (pickupId: string) => {
    const existing = activePickups.find((pickup) => pickup.id === pickupId);
    if (!existing) return;
    const now = new Date().toISOString();
    updateCollection(onSnapshotChange, (current) => ({
      ...current,
      pickups: current.pickups.map((pickup) =>
        pickup.id === pickupId && pickup.archivedAt === null
          ? { ...pickup, archivedAt: now, updatedBy: adminActor, updatedAt: now }
          : pickup,
      ),
    }));
    if (selectedPickupId === pickupId) setSelectedPickupId(null);
  };

  const changePosition = (position: LngLat | null, source: PickupSource | null) => {
    setPickupPosition(position);
    setPickupSource(source);
  };

  return (
    <section className="collection-admin-pickup-workspace">
      <div className={"collection-admin-pickup-map " + (pickupPositioning ? "is-positioning" : "")}>
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
          refreshState="idle"
          cameraCommand={cameraCommand}
          onCameraChange={handleCameraChange}
          onRefresh={manualRefreshCampaign}
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
          collectionAreas={renderedAreas}
          selectedCollectionAreaId={null}
          collectionPickups={collection.pickups}
          selectedCollectionPickupId={selectedPickupId}
          onCollectionPickupSelect={setSelectedPickupId}
          onCollectionAreaSelect={() => {}}
        />
        {pickupPositioning ? (
          <div className="collection-admin-pickup-pin" aria-hidden="true"><span /></div>
        ) : null}
      </div>

      <PickupPanel
        campaignId={campaignId}
        items={pickupItems}
        canCreate
        canEdit
        canAssign={false}
        assignmentRunOptions={[]}
        assignmentCollectorOptions={[]}
        online={online}
        locale={language === "de" ? "de-DE" : "en"}
        position={pickupPosition}
        source={pickupSource}
        mapCenter={currentCamera?.center ?? null}
        manualPositioning={pickupPositioning}
        areaId={null}
        onCreate={createPickup}
        onStatusChange={changeStatus}
        onAssignmentChange={() => {}}
        onPositionChange={changePosition}
        onFocusPosition={focusPosition}
        onManualPositioningChange={setPickupPositioning}
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
          readOnly: "",
          readOnlyCreate: "",
        }}
      />

      <PickupLifecyclePanel
        campaignId={campaignId}
        items={lifecycleItems}
        canEdit
        online={online}
        language={language}
        editPosition={pickupPosition}
        manualPositioning={pickupPositioning}
        onEdit={changeDetails}
        onArchive={archivePickup}
        onPositionChange={(position) => {
          setPickupPosition(position);
          setPickupSource(null);
        }}
        onFocusPosition={focusPosition}
        onManualPositioningChange={setPickupPositioning}
      />
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectionModeFromUrl,
  removeCollectionAccessTokenFromUrl,
  type AccessInfo,
} from "./data/campaignApi";
import {
  loadCampaignSnapshot,
  manualRefreshCampaign,
  saveCampaignSnapshot,
  setCampaignFieldGroupContext,
  setCampaignInteractionBlocked,
  subscribeCampaignStore,
  type RefreshState,
  type SyncMessageCode,
} from "./data/campaignStore";
import {
  createId,
  createLineStringGeometry,
  createPolygonGeometry,
  nextAvailableTeamColor,
  openPolygonRing,
  TEAM_COLORS,
  type Area,
  type CampaignSnapshot,
  type DistributionTask,
  type HouseTask,
  type LngLat,
  type MapCameraView,
  type TaskStatus,
  type Team,
} from "./domain/campaign";
import { darkenHexColor } from "./domain/color";
import {
  collectionAreaColor,
  collectionSnapshotOrEmpty,
  createCollectionId,
  type CollectionArea,
  type CollectionMainArea,
} from "./domain/collection";
import { validateLineStringVertices, validatePolygonVertices } from "./domain/geometry";
import { detectLanguage, geometryReason, t, taskStatusLabel, type Language } from "./i18n";
import { lineStringIsFullyInsideOrOnPolygon } from "./domain/areaTaskPreparation.ts";
import { clearPersonalMapView } from "./map/cameraStore";
import { MapView, type MapCameraCommand } from "./map/MapView";
import { CollectionAdminPanel } from "./collection/CollectionAdminPanel";
import { CollectionCollectorView } from "./collection/CollectionCollectorView";
import type { PlatformAppCommand, PlatformAppContext } from "./platform/platformContract.ts";
import { CommentsContextPanel } from "./collaboration/CommentsContextPanel.tsx";
import { SettingsSheet } from "./settings/SettingsSheet";

type MapMode =
  | "browse"
  | "draw"
  | "edit"
  | "street-draw"
  | "collection-main-draw"
  | "collection-area-draw"
  | "collection-area-edit";
type Sheet =
  | "teams"
  | "area"
  | "task"
  | "house"
  | "campaign-comments"
  | "settings"
  | "collection-admin"
  | null;
type UndoStatusChange = {
  taskId: string;
  label: string;
  previousStatus: TaskStatus;
  previousCompletedAt: string | null;
};
type AppProps = {
  platformCommand?: PlatformAppCommand | null;
  activeFieldGroupId?: string | null;
  onPlatformContextChange?: (context: PlatformAppContext) => void;
};

const GERMANY_VIEW: MapCameraView = {
  center: [10.45, 51.16],
  zoom: 5.3,
  bearing: 0,
};

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

function nextAreaName(areas: Area[], language: Language) {
  return `${t(language, "area")} ${areas.length + 1}`;
}

function nextStreetName(tasks: DistributionTask[], areaId: string, language: Language) {
  const count = tasks.filter((task) => task.areaId === areaId).length;
  return `${t(language, "street")} ${count + 1}`;
}

function syncMessage(language: Language, code: SyncMessageCode, refreshState: RefreshState) {
  if (refreshState === "available") return null;
  if (code === "access_required") return t(language, "accessRequired");
  if (code === "network") return t(language, "unavailable");
  if (code === "forbidden") return t(language, "permissionDenied");
  if (code === "schema_migration_required") return t(language, "schemaMigrationRequired");
  if (code === "conflict") return t(language, "newData");
  return null;
}

export default function App({
  platformCommand = null,
  activeFieldGroupId = null,
  onPlatformContextChange,
}: AppProps = {}) {
  const online = useOnlineStatus();
  const [initialLoad] = useState(loadCampaignSnapshot);
  const [snapshot, setSnapshot] = useState<CampaignSnapshot>(initialLoad.snapshot);
  const [storageWarning, setStorageWarning] = useState<string | null>(initialLoad.warning);
  const [language, setLanguage] = useState<Language>(detectLanguage);
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [syncMessageCode, setSyncMessageCode] = useState<SyncMessageCode>(null);
  const [initialAccessUrl, setInitialAccessUrl] = useState<string | null>(null);
  const [currentCamera, setCurrentCamera] = useState<MapCameraView | null>(null);
  const [cameraCommand, setCameraCommand] = useState<MapCameraCommand>(null);
  const cameraCommandId = useRef(0);
  const handledPlatformCommandId = useRef(0);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(
    initialLoad.snapshot.teams[0]?.id ?? null,
  );
  const [sheet, setSheet] = useState<Sheet>(null);
  const [mode, setMode] = useState<MapMode>("browse");
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedHouseTaskId, setSelectedHouseTaskId] = useState<string | null>(null);
  const [draftVertices, setDraftVertices] = useState<LngLat[]>([]);
  const [editingVertices, setEditingVertices] = useState<LngLat[]>([]);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [streetDraftVertices, setStreetDraftVertices] = useState<LngLat[]>([]);
  const [collectionDraftVertices, setCollectionDraftVertices] = useState<LngLat[]>([]);
  const [collectionEditingVertices, setCollectionEditingVertices] = useState<LngLat[]>([]);
  const [collectionEditingAreaId, setCollectionEditingAreaId] = useState<string | null>(null);
  const [selectedCollectionAreaId, setSelectedCollectionAreaId] = useState<string | null>(null);
  const [collectionSelectedVertexIndex, setCollectionSelectedVertexIndex] = useState<number | null>(null);
  const [manualStreetAreaSelection, setManualStreetAreaSelection] = useState(false);
  const [undoStatusChange, setUndoStatusChange] = useState<UndoStatusChange | null>(null);

  useEffect(
    () =>
      subscribeCampaignStore((update) => {
        if (update.snapshot) setSnapshot(update.snapshot);
        if ("access" in update) setAccess(update.access ?? null);
        if (update.refreshState) setRefreshState(update.refreshState);
        if ("messageCode" in update) setSyncMessageCode(update.messageCode ?? null);
        if (update.initialAccessUrl) setInitialAccessUrl(update.initialAccessUrl);
      }),
    [],
  );

  useEffect(() => {
    setStorageWarning(saveCampaignSnapshot(snapshot));
  }, [snapshot]);

  useEffect(() => {
    setCampaignInteractionBlocked(mode !== "browse");
    return () => setCampaignInteractionBlocked(false);
  }, [mode]);

  useEffect(() => {
    setCampaignFieldGroupContext(access?.groupId ?? activeFieldGroupId);
  }, [access?.groupId, activeFieldGroupId]);

  useEffect(() => {
    if (!undoStatusChange) return;
    const timeout = window.setTimeout(() => setUndoStatusChange(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [undoStatusChange]);

  useEffect(() => {
    if (access?.role === "viewer") {
      setActiveTeamId(null);
      return;
    }
    if (
      (access?.role === "team-editor" || access?.role === "field-group-member") &&
      access.teamId
    ) {
      setActiveTeamId(access.teamId);
      return;
    }
    if (activeTeamId && snapshot.teams.some((team) => team.id === activeTeamId)) return;
    setActiveTeamId(snapshot.teams[0]?.id ?? null);
  }, [access, snapshot.teams, activeTeamId]);

  useEffect(() => {
    if (selectedAreaId && !snapshot.areas.some((area) => area.id === selectedAreaId)) {
      setSelectedAreaId(null);
      if (sheet === "area") setSheet(null);
    }
    if (selectedTaskId && !snapshot.tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null);
      if (sheet === "task") setSheet(selectedAreaId ? "area" : null);
    }
    if (selectedHouseTaskId && !(snapshot.houseTasks ?? []).some((task) => task.id === selectedHouseTaskId)) {
      setSelectedHouseTaskId(null);
      if (sheet === "house") setSheet(selectedAreaId ? "area" : null);
    }
  }, [snapshot, selectedAreaId, selectedHouseTaskId, selectedTaskId, sheet]);

  const isAdmin = access?.role === "admin";
  const isEditor = access?.role === "team-editor";
  const isFieldGroupMember = access?.role === "field-group-member";
  const canEditTeam = (teamId: string) => isAdmin || (isEditor && access?.teamId === teamId);
  const canEditArea = (area: Area | null) => Boolean(area && canEditTeam(area.teamId));
  const canChangeTaskStatusInArea = (area: Area | null) =>
    Boolean(
      area &&
        (canEditTeam(area.teamId) || isEditor ||
          (isFieldGroupMember && access?.teamId === area.teamId && Boolean(access.groupId))),
    );

  const collection = collectionSnapshotOrEmpty(snapshot.collection);
  const collectionMode = collectionModeFromUrl();
  const collectionSelectedArea = collection.areas.find(
    (area) => area.id === (collectionEditingAreaId ?? selectedCollectionAreaId),
  ) ?? null;
  const collectionColor = collectionSelectedArea?.color ?? collectionAreaColor(collection.areas.length);
  const collectionVisible =
    Boolean(isAdmin) &&
    (sheet === "collection-admin" || mode === "collection-main-draw" ||
      mode === "collection-area-draw" || mode === "collection-area-edit");
  const collectionDraftValidation = useMemo(
    () => validatePolygonVertices(collectionDraftVertices),
    [collectionDraftVertices],
  );
  const collectionEditValidation = useMemo(
    () => validatePolygonVertices(collectionEditingVertices),
    [collectionEditingVertices],
  );

  const activeTeam = snapshot.teams.find((team) => team.id === activeTeamId) ?? null;
  const selectedArea = snapshot.areas.find((area) => area.id === selectedAreaId) ?? null;
  const selectedAreaTeam = selectedArea
    ? snapshot.teams.find((team) => team.id === selectedArea.teamId) ?? null
    : null;
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedTaskArea = selectedTask
    ? snapshot.areas.find((area) => area.id === selectedTask.areaId) ?? null
    : null;
  const selectedTaskTeam = selectedTaskArea
    ? snapshot.teams.find((team) => team.id === selectedTaskArea.teamId) ?? null
    : null;
  const selectedHouseTask = snapshot.houseTasks?.find((task) => task.id === selectedHouseTaskId) ?? null;
  const selectedHouseTaskArea = selectedHouseTask
    ? snapshot.areas.find((area) => area.id === selectedHouseTask.areaId) ?? null
    : null;
  const selectedHouseTaskTeam = selectedHouseTaskArea
    ? snapshot.teams.find((team) => team.id === selectedHouseTaskArea.teamId) ?? null
    : null;
  const selectedAreaHouseTasks = useMemo(
    () =>
      selectedArea
        ? (snapshot.houseTasks ?? []).filter((task) => task.areaId === selectedArea.id)
        : [],
    [selectedArea, snapshot.houseTasks],
  );
  const canEditSelectedArea = canEditArea(selectedArea);
  const canEditSelectedTask = canEditArea(selectedTaskArea);
  const canChangeSelectedTaskStatus = canChangeTaskStatusInArea(selectedTaskArea);
  const canChangeSelectedHouseTaskStatus = canChangeTaskStatusInArea(selectedHouseTaskArea);
  const selectedTaskIsAutoPrepared = Boolean(selectedTask?.areaPreparationGeneration);
  useEffect(() => {
    onPlatformContextChange?.({
      campaignId: snapshot.campaign.id,
      accessRole: access?.role ?? null,
      accessTeamId: access?.teamId ?? null,
      activeGroupId: access?.groupId ?? activeFieldGroupId,
      activeTeam: activeTeam
        ? {
            id: activeTeam.id,
            name: activeTeam.name,
            color: activeTeam.color,
          }
        : null,
      teams: snapshot.teams.map((team) => ({ id: team.id, name: team.name, color: team.color })),
      launcherAvailable: mode === "browse" && sheet === null && !manualStreetAreaSelection,
      canManageTeams: Boolean(isAdmin),
      canCreateArea: Boolean(activeTeam && canEditTeam(activeTeam.id)),
      canCreateManualStreet: snapshot.areas.some((area) => canEditArea(area)),
    });
  }, [access, activeFieldGroupId, activeTeam, isAdmin, manualStreetAreaSelection, mode, sheet, onPlatformContextChange, snapshot.areas, snapshot.campaign.id, snapshot.teams]);

  const renderedAreas = useMemo(
    () =>
      snapshot.areas.map((area) => ({
        ...area,
        color: snapshot.teams.find((team) => team.id === area.teamId)?.color ?? "#64748b",
      })),
    [snapshot.areas, snapshot.teams],
  );

  const renderedTasks = useMemo(
    () =>
      snapshot.tasks.map((task) => {
        const area = snapshot.areas.find((candidate) => candidate.id === task.areaId);
        const team = area ? snapshot.teams.find((candidate) => candidate.id === area.teamId) : null;
        return {
          ...task,
          color: team?.color ?? "#64748b",
          completedColor: darkenHexColor(team?.color ?? "#64748b", 0.25),
        };
      }),
    [snapshot.tasks, snapshot.areas, snapshot.teams],
  );

  const renderedHouses = useMemo(
    () =>
      (snapshot.houseTasks ?? []).map((house) => {
        const area = snapshot.areas.find((candidate) => candidate.id === house.areaId);
        const team = area ? snapshot.teams.find((candidate) => candidate.id === area.teamId) : null;
        return {
          ...house,
          color: team?.color ?? "#64748b",
          completedColor: darkenHexColor(team?.color ?? "#64748b", 0.25),
        };
      }),
    [snapshot.houseTasks, snapshot.areas, snapshot.teams],
  );

  const drawValidation = useMemo(
    () => validatePolygonVertices(draftVertices),
    [draftVertices],
  );
  const editValidation = useMemo(
    () => validatePolygonVertices(editingVertices),
    [editingVertices],
  );
  const streetValidation = useMemo(() => {
    const validation = validateLineStringVertices(streetDraftVertices);
    if (!validation.valid || !selectedArea) return validation;
    return lineStringIsFullyInsideOrOnPolygon(
      createLineStringGeometry(streetDraftVertices),
      selectedArea.geometry,
    )
      ? validation
      : { valid: false as const, reason: "Die Straße muss vollständig innerhalb des Gebiets liegen." };
  }, [selectedArea, streetDraftVertices]);
  const commitSnapshot = (update: (current: CampaignSnapshot) => CampaignSnapshot) => {
    if (!access || access.role === "viewer") return;
    setSnapshot((current) => {
      const next = update(current);
      if (next === current) return current;
      const now = new Date().toISOString();
      return {
        ...next,
        revision: current.revision + 1,
        campaign: {
          ...next.campaign,
          updatedAt: now,
        },
      };
    });
  };

  const renameCampaign = (name: string) => {
    if (!isAdmin) return;
    commitSnapshot((current) => ({
      ...current,
      campaign: { ...current.campaign, name },
    }));
  };

  const normalizeCampaignName = () => {
    if (!isAdmin || snapshot.campaign.name.trim()) return;
    renameCampaign(language === "en" ? "New campaign" : "Neue Verteilaktion");
  };

  const createTeam = () => {
    if (!isAdmin) return;
    const color = nextAvailableTeamColor(snapshot.teams);

    const now = new Date().toISOString();
    const team: Team = {
      id: createId("team"),
      campaignId: snapshot.campaign.id,
      name: `${t(language, "team")} ${snapshot.teams.length + 1}`,
      color,
      createdAt: now,
      updatedAt: now,
    };

    commitSnapshot((current) => ({ ...current, teams: [...current.teams, team] }));
    setActiveTeamId(team.id);
  };

  const updateTeam = (teamId: string, patch: Partial<Pick<Team, "name" | "color">>) => {
    if (!isAdmin) return;
    if (
      patch.color &&
      snapshot.teams.some(
        (team) => team.id !== teamId && team.color.toLowerCase() === patch.color?.toLowerCase(),
      )
    ) {
      return;
    }

    const now = new Date().toISOString();
    commitSnapshot((current) => ({
      ...current,
      teams: current.teams.map((team) =>
        team.id === teamId ? { ...team, ...patch, updatedAt: now } : team,
      ),
    }));
  };

  const normalizeTeamName = (team: Team) => {
    if (team.name.trim()) return;
    updateTeam(team.id, { name: t(language, "team") });
  };

  const startDrawing = () => {
    if (!activeTeam || !canEditTeam(activeTeam.id)) {
      if (isAdmin) setSheet("teams");
      return;
    }

    setMode("draw");
    setSheet(null);
    setSelectedAreaId(null);
    setSelectedTaskId(null);
    setSelectedHouseTaskId(null);
    setDraftVertices([]);
    setEditingVertices([]);
    setStreetDraftVertices([]);
    setSelectedVertexIndex(null);
  };

  const openStreetDrawing = (area: Area) => {
    if (!canEditArea(area)) return;
    setManualStreetAreaSelection(false);
    setSelectedAreaId(area.id);
    setStreetDraftVertices([]);
    setSelectedTaskId(null);
    setSelectedHouseTaskId(null);
    setMode("street-draw");
    setSheet(null);
  };

  const startManualStreet = () => {
    if (selectedArea && canEditSelectedArea) {
      openStreetDrawing(selectedArea);
      return;
    }
    const editableAreas = snapshot.areas.filter((area) => canEditArea(area));
    if (editableAreas.length === 1) {
      openStreetDrawing(editableAreas[0]);
      return;
    }
    if (editableAreas.length > 1) {
      setSelectedAreaId(null);
      setSelectedTaskId(null);
      setSelectedHouseTaskId(null);
      setSheet(null);
      setManualStreetAreaSelection(true);
    }
  };

  useEffect(() => {
    if (!platformCommand || platformCommand.id <= handledPlatformCommandId.current) return;
    handledPlatformCommandId.current = platformCommand.id;
    if (mode !== "browse") return;

    if (platformCommand.type === "open-settings") {
      setSheet("settings");
      return;
    }

    if (platformCommand.type === "open-campaign-comments") {
      setSelectedAreaId(null);
      setSelectedTaskId(null);
      setSelectedHouseTaskId(null);
      setSheet("campaign-comments");
      return;
    }

    if (platformCommand.type === "open-team-management") {
      if (isAdmin) setSheet("teams");
      return;
    }

    if (platformCommand.type === "select-active-team") {
      const candidate = snapshot.teams.find((team) => team.id === platformCommand.teamId);
      if (!candidate || !access) return;
      if (
        (access.role === "team-editor" || access.role === "field-group-member") &&
        access.teamId !== candidate.id
      ) {
        return;
      }
      setActiveTeamId(candidate.id);
      return;
    }

    if (platformCommand.type === "start-area-drawing") {
      startDrawing();
    }
    if (platformCommand.type === "start-manual-street") {
      startManualStreet();
    }
  }, [platformCommand, mode, isAdmin, activeTeam, access, selectedArea, canEditSelectedArea, snapshot.areas, snapshot.teams]);

  const cancelDrawing = () => {
    setMode("browse");
    setDraftVertices([]);
  };

  const startCollectionMainArea = () => {
    if (!isAdmin || collection.mainArea) return;
    setMode("collection-main-draw");
    setSheet(null);
    setCollectionDraftVertices([]);
    setCollectionEditingVertices([]);
    setCollectionEditingAreaId(null);
    setCollectionSelectedVertexIndex(null);
  };

  const startCollectionArea = () => {
    if (!isAdmin || !collection.mainArea) return;
    setMode("collection-area-draw");
    setSheet(null);
    setCollectionDraftVertices([]);
    setCollectionEditingVertices([]);
    setCollectionEditingAreaId(null);
    setCollectionSelectedVertexIndex(null);
  };

  const startCollectionAreaEditing = (areaId: string) => {
    if (!isAdmin) return;
    const area = collection.areas.find((candidate) => candidate.id === areaId);
    if (!area || area.status !== "open") return;
    setSelectedCollectionAreaId(area.id);
    setCollectionEditingAreaId(area.id);
    setCollectionEditingVertices(openPolygonRing(area.geometry));
    setCollectionSelectedVertexIndex(null);
    setMode("collection-area-edit");
    setSheet(null);
  };

  const cancelCollectionGeometry = () => {
    setMode("browse");
    setCollectionDraftVertices([]);
    setCollectionEditingVertices([]);
    setCollectionEditingAreaId(null);
    setCollectionSelectedVertexIndex(null);
    setSheet("collection-admin");
  };

  const moveCollectionEditVertex = (index: number, point: LngLat) => {
    setCollectionEditingVertices((current) =>
      current.map((vertex, vertexIndex) => (vertexIndex === index ? point : vertex)),
    );
    setCollectionSelectedVertexIndex(null);
  };

  const saveCollectionGeometry = () => {
    if (!isAdmin) return;
    const now = new Date().toISOString();
    if (mode === "collection-main-draw") {
      if (!collectionDraftValidation.valid || collection.mainArea) return;
      const mainArea: CollectionMainArea = {
        id: createCollectionId("main"),
        campaignId: snapshot.campaign.id,
        name: language === "en" ? "Collection Main Area" : "Collection Main Area",
        geometry: createPolygonGeometry(collectionDraftVertices),
        createdAt: now,
        updatedAt: now,
      };
      commitSnapshot((current) => ({
        ...current,
        collection: {
          ...collectionSnapshotOrEmpty(current.collection),
          mainArea,
        },
      }));
      setSelectedCollectionAreaId(null);
      setCollectionDraftVertices([]);
      setMode("browse");
      setSheet("collection-admin");
      return;
    }

    if (mode === "collection-area-draw") {
      if (!collectionDraftValidation.valid || !collection.mainArea) return;
      const area: CollectionArea = {
        id: createCollectionId("area"),
        campaignId: snapshot.campaign.id,
        mainAreaId: collection.mainArea.id,
        name: language === "en"
          ? "Collection Area " + (collection.areas.length + 1)
          : "Collection Area " + (collection.areas.length + 1),
        geometry: createPolygonGeometry(collectionDraftVertices),
        color: collectionAreaColor(collection.areas.length),
        status: "open",
        runId: null,
        claimedByCollectorId: null,
        claimedByLabel: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      commitSnapshot((current) => ({
        ...current,
        collection: {
          ...collectionSnapshotOrEmpty(current.collection),
          areas: [...collectionSnapshotOrEmpty(current.collection).areas, area],
        },
      }));
      setSelectedCollectionAreaId(area.id);
      setCollectionDraftVertices([]);
      setMode("browse");
      setSheet("collection-admin");
      return;
    }

    if (mode === "collection-area-edit") {
      const area = collectionSelectedArea;
      if (!area || !collectionEditValidation.valid) return;
      commitSnapshot((current) => ({
        ...current,
        collection: {
          ...collectionSnapshotOrEmpty(current.collection),
          areas: collectionSnapshotOrEmpty(current.collection).areas.map((candidate) =>
            candidate.id === area.id
              ? { ...candidate, geometry: createPolygonGeometry(collectionEditingVertices), updatedAt: now }
              : candidate,
          ),
        },
      }));
      setCollectionEditingVertices([]);
      setCollectionEditingAreaId(null);
      setCollectionSelectedVertexIndex(null);
      setMode("browse");
      setSheet("collection-admin");
    }
  };

  const forceReleaseCollectionArea = (areaId: string, runId: string) => {
    if (!isAdmin) return;
    const area = collection.areas.find((candidate) => candidate.id === areaId);
    if (!area || area.runId !== runId || area.status === "completed") return;
    const now = new Date().toISOString();
    commitSnapshot((current) => {
      const currentCollection = collectionSnapshotOrEmpty(current.collection);
      return {
        ...current,
        collection: {
          ...currentCollection,
          areas: currentCollection.areas.map((candidate) =>
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
          runs: currentCollection.runs.map((run) =>
            run.id === runId
              ? { ...run, areaIds: run.areaIds.filter((id) => id !== areaId), updatedAt: now }
              : run,
          ),
        },
      };
    });
  };

  const saveDraftArea = () => {
    if (!activeTeam || !canEditTeam(activeTeam.id) || !drawValidation.valid) return;

    const now = new Date().toISOString();
    const area: Area = {
      id: createId("area"),
      campaignId: snapshot.campaign.id,
      teamId: activeTeam.id,
      name: nextAreaName(snapshot.areas, language),
      geometry: createPolygonGeometry(draftVertices),
      createdAt: now,
      updatedAt: now,
    };

    commitSnapshot((current) => ({ ...current, areas: [...current.areas, area] }));
    setDraftVertices([]);
    setMode("browse");
    setSelectedAreaId(area.id);
    setSheet("area");
  };

  const selectArea = (areaId: string | null) => {
    if (mode !== "browse") return;
    if (manualStreetAreaSelection) {
      const candidate = snapshot.areas.find((area) => area.id === areaId) ?? null;
      if (candidate && canEditArea(candidate)) openStreetDrawing(candidate);
      return;
    }
    setSelectedTaskId(null);
    setSelectedHouseTaskId(null);
    setSelectedAreaId(areaId);
    setSheet(areaId ? "area" : null);
  };

  const selectTask = (taskId: string | null) => {
    if (mode !== "browse") return;
    if (!taskId) {
      setSelectedTaskId(null);
      return;
    }

    const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    setSelectedTaskId(task.id);
    setSelectedHouseTaskId(null);
    setSelectedAreaId(task.areaId);
    setSheet("task");
  };

  const selectHouseTask = (taskId: string | null) => {
    if (mode !== "browse") return;
    if (!taskId) {
      setSelectedHouseTaskId(null);
      setSheet(selectedAreaId ? "area" : null);
      return;
    }

    const task: HouseTask | undefined = snapshot.houseTasks?.find((candidate) => candidate.id === taskId);
    if (!task) return;
    setSelectedTaskId(null);
    setSelectedHouseTaskId(task.id);
    setSelectedAreaId(task.areaId);
    setSheet("house");
  };

  const updateSelectedArea = (patch: Partial<Pick<Area, "name" | "teamId">>) => {
    if (!selectedArea || !canEditSelectedArea) return;
    if (patch.teamId && !isAdmin) return;
    const now = new Date().toISOString();

    commitSnapshot((current) => ({
      ...current,
      areas: current.areas.map((area) =>
        area.id === selectedArea.id ? { ...area, ...patch, updatedAt: now } : area,
      ),
    }));

    if (patch.teamId) setActiveTeamId(patch.teamId);
  };

  const normalizeAreaName = () => {
    if (!selectedArea || selectedArea.name.trim()) return;
    updateSelectedArea({
      name: nextAreaName(snapshot.areas.filter((area) => area.id !== selectedArea.id), language),
    });
  };

  const deleteSelectedArea = () => {
    if (!selectedArea || !canEditSelectedArea) return;
    if (!window.confirm(t(language, "confirmDeleteArea", { name: selectedArea.name }))) return;

    commitSnapshot((current) => ({
      ...current,
      areas: current.areas.filter((area) => area.id !== selectedArea.id),
      tasks: current.tasks.filter((task) => task.areaId !== selectedArea.id),
      ...(current.houseTasks
        ? { houseTasks: current.houseTasks.filter((task) => task.areaId !== selectedArea.id) }
        : {}),
    }));
    setSelectedAreaId(null);
    setSelectedTaskId(null);
    setSheet(null);
  };

  const startEditing = () => {
    if (!selectedArea || !canEditSelectedArea) return;
    setEditingVertices(openPolygonRing(selectedArea.geometry));
    setSelectedVertexIndex(null);
    setMode("edit");
    setSheet(null);
  };

  const cancelEditing = () => {
    setMode("browse");
    setEditingVertices([]);
    setSelectedVertexIndex(null);
    if (selectedAreaId) setSheet("area");
  };

  const moveEditVertex = (index: number, point: LngLat) => {
    setEditingVertices((current) =>
      current.map((vertex, vertexIndex) => (vertexIndex === index ? point : vertex)),
    );
    setSelectedVertexIndex(null);
  };

  const saveEditedArea = () => {
    if (!selectedArea || !canEditSelectedArea || !editValidation.valid) return;
    const now = new Date().toISOString();

    commitSnapshot((current) => ({
      ...current,
      areas: current.areas.map((area) =>
        area.id === selectedArea.id
          ? { ...area, geometry: createPolygonGeometry(editingVertices), updatedAt: now }
          : area,
      ),
    }));
    setMode("browse");
    setEditingVertices([]);
    setSelectedVertexIndex(null);
    setSheet("area");
  };

  const startStreetDrawing = () => {
    if (!selectedArea || !canEditSelectedArea) return;
    openStreetDrawing(selectedArea);
  };

  const cancelStreetDrawing = () => {
    setStreetDraftVertices([]);
    setMode("browse");
    if (selectedAreaId) setSheet("area");
  };

  const saveStreetTask = () => {
    if (!selectedArea || !canEditSelectedArea || !streetValidation.valid) return;
    const now = new Date().toISOString();
    const task: DistributionTask = {
      id: createId("task"),
      campaignId: snapshot.campaign.id,
      areaId: selectedArea.id,
      taskType: "street",
      label: nextStreetName(snapshot.tasks, selectedArea.id, language),
      geometry: createLineStringGeometry(streetDraftVertices),
      areaPreparationGeneration: null,
      status: "open",
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    commitSnapshot((current) => ({ ...current, tasks: [...current.tasks, task] }));
    setStreetDraftVertices([]);
    setSelectedTaskId(task.id);
    setMode("browse");
    setSheet("task");
  };

  const updateSelectedTask = (
    patch: Partial<Pick<DistributionTask, "label" | "status" | "completedAt">>,
  ) => {
    if (!selectedTask || !canEditSelectedTask) return;
    const now = new Date().toISOString();
    commitSnapshot((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === selectedTask.id ? { ...task, ...patch, updatedAt: now } : task,
      ),
    }));
  };

  const normalizeTaskLabel = () => {
    if (!selectedTask || selectedTask.label.trim()) return;
    updateSelectedTask({
      label: nextStreetName(
        snapshot.tasks.filter((task) => task.id !== selectedTask.id),
        selectedTask.areaId,
        language,
      ),
    });
  };

  const changeTaskStatus = (status: TaskStatus) => {
    if (!selectedTask || !canChangeSelectedTaskStatus || selectedTask.status === status) return;
    const now = new Date().toISOString();
    setUndoStatusChange({
      taskId: selectedTask.id,
      label: selectedTask.label,
      previousStatus: selectedTask.status,
      previousCompletedAt: selectedTask.completedAt,
    });
    commitSnapshot((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === selectedTask.id
          ? {
              ...task,
              status,
              completedAt: status === "completed" ? now : null,
              updatedAt: now,
            }
          : task,
      ),
    }));
  };

  const changeHouseTaskStatus = (status: TaskStatus) => {
    if (
      !selectedHouseTask ||
      !canChangeSelectedHouseTaskStatus ||
      selectedHouseTask.status === status
    ) {
      return;
    }
    const now = new Date().toISOString();
    commitSnapshot((current) => ({
      ...current,
      houseTasks: (current.houseTasks ?? []).map((task) =>
        task.id === selectedHouseTask.id
          ? {
              ...task,
              status,
              completedAt: status === "completed" ? now : null,
              updatedAt: now,
            }
          : task,
      ),
    }));
  };

  const undoLastStatusChange = () => {
    if (!undoStatusChange) return;
    const task = snapshot.tasks.find((candidate) => candidate.id === undoStatusChange.taskId) ?? null;
    const area = task ? snapshot.areas.find((candidate) => candidate.id === task.areaId) ?? null : null;
    if (!task || !canChangeTaskStatusInArea(area)) return;
    const now = new Date().toISOString();
    commitSnapshot((current) => ({
      ...current,
      tasks: current.tasks.map((currentTask) =>
        currentTask.id === undoStatusChange.taskId
          ? {
              ...currentTask,
              status: undoStatusChange.previousStatus,
              completedAt: undoStatusChange.previousCompletedAt,
              updatedAt: now,
            }
          : currentTask,
      ),
    }));
    setUndoStatusChange(null);
  };

  const deleteSelectedTask = () => {
    if (!selectedTask || !canEditSelectedTask || selectedTask.areaPreparationGeneration) return;
    if (!window.confirm(t(language, "confirmDeleteStreet", { name: selectedTask.label }))) return;
    commitSnapshot((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id !== selectedTask.id),
    }));
    if (undoStatusChange?.taskId === selectedTask.id) setUndoStatusChange(null);
    setSelectedTaskId(null);
    setSheet("area");
  };

  const commandCamera = (view: MapCameraView, persist = true) => {
    cameraCommandId.current += 1;
    setCameraCommand({ id: cameraCommandId.current, view, persist });
  };

  const saveCurrentFocus = () => {
    if (!isAdmin || !currentCamera) return;
    commitSnapshot((current) => ({
      ...current,
      campaign: { ...current.campaign, defaultMapView: currentCamera },
    }));
  };

  const removeFocus = () => {
    if (!isAdmin) return;
    commitSnapshot((current) => ({
      ...current,
      campaign: { ...current.campaign, defaultMapView: null },
    }));
  };

  const jumpToFocus = () => {
    if (snapshot.campaign.defaultMapView) commandCamera(snapshot.campaign.defaultMapView);
  };

  const resetPersonalCamera = () => {
    clearPersonalMapView(snapshot.campaign.id);
    commandCamera(snapshot.campaign.defaultMapView ?? GERMANY_VIEW, false);
  };

  const campaignDisplayName = snapshot.campaign.name.trim() || t(language, "actionFallback");
  const editColor = selectedAreaTeam?.color ?? "#64748b";
  const streetColor = selectedAreaTeam?.color ?? "#2563eb";
  const message = syncMessage(language, syncMessageCode, refreshState);
  const displayedStorageWarning =
    storageWarning && language === "de" ? storageWarning : storageWarning ? t(language, "refreshError") : null;

  if (collectionMode) {
    if (access?.role === "collection-collector") {
      return (
        <CollectionCollectorView
          campaignId={snapshot.campaign.id}
          language={language}
          snapshot={snapshot}
          access={access}
          online={online}
          refreshState={refreshState}
          onRefresh={manualRefreshCampaign}
          onSnapshotChange={commitSnapshot}
          onExit={() => {
            removeCollectionAccessTokenFromUrl();
            const url = new URL(window.location.href);
            url.searchParams.delete("collection");
            window.history.replaceState(null, "", url);
            window.location.reload();
          }}
        />
      );
    }
    return (
      <main className="collection-screen">
        <section className="collection-card">
          <h1>{t(language, "accessRequired")}</h1>
          <p>{t(language, "permissionDenied")}</p>
          <button type="button" onClick={() => {
            removeCollectionAccessTokenFromUrl();
            const url = new URL(window.location.href);
            url.searchParams.delete("collection");
            window.history.replaceState(null, "", url);
            window.location.reload();
          }}>
            {t(language, "close")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-copy">
          <strong>{t(language, "appName")}</strong>
          <span className="subtitle">{campaignDisplayName}</span>
        </div>
        <span className={`connection ${online ? "is-online" : "is-offline"}`}>
          {online ? t(language, "online") : t(language, "offline")}
        </span>
      </header>

      <MapView
        campaignId={snapshot.campaign.id}
        campaignDefaultView={snapshot.campaign.defaultMapView}
        language={language}
        areas={renderedAreas}
        tasks={renderedTasks}
        houses={renderedHouses}
        selectedTaskId={selectedTaskId}
        selectedHouseTaskId={selectedHouseTaskId}
        mode={mode}
        draftVertices={draftVertices}
        draftColor={activeTeam?.color ?? "#2563eb"}
        editingVertices={editingVertices}
        editingColor={editColor}
        selectedVertexIndex={selectedVertexIndex}
        streetDraftVertices={streetDraftVertices}
        streetDraftColor={streetColor}
        refreshState={refreshState}
        cameraCommand={cameraCommand}
        onCameraChange={setCurrentCamera}
        onRefresh={manualRefreshCampaign}
        onAreaSelect={selectArea}
        onTaskSelect={selectTask}
        onHouseTaskSelect={selectHouseTask}
        onDrawPoint={(point) => setDraftVertices((current) => [...current, point])}
        onEditVertexSelect={(index) =>
          setSelectedVertexIndex((current) => (current === index ? null : index))
        }
        onEditVertexMove={moveEditVertex}
        onStreetDrawPoint={(point) => setStreetDraftVertices((current) => [...current, point])}
        collectionVisible={collectionVisible}
        collectionMainArea={collection.mainArea}
        collectionAreas={collection.areas}
        selectedCollectionAreaId={selectedCollectionAreaId}
        collectionDraftVertices={collectionDraftVertices}
        collectionEditingVertices={collectionEditingVertices}
        collectionColor={collectionSelectedArea?.color ?? collectionAreaColor(collection.areas.length)}
        collectionSelectedVertexIndex={collectionSelectedVertexIndex}
        onCollectionAreaSelect={setSelectedCollectionAreaId}
        onCollectionDrawPoint={(point) => setCollectionDraftVertices((current) => [...current, point])}
        onCollectionEditVertexSelect={(index) =>
          setCollectionSelectedVertexIndex((current) => (current === index ? null : index))
        }
        onCollectionEditVertexMove={moveCollectionEditVertex}
      />

      {displayedStorageWarning || message ? (
        <div className="storage-warning" role="status">
          {displayedStorageWarning ?? message}
        </div>
      ) : null}

      {undoStatusChange ? (
        <div className="undo-toast" role="status">
          <span>
            {undoStatusChange.label || t(language, "street")}: {t(language, "statusChanged")}
          </span>
          <button type="button" onClick={undoLastStatusChange}>
            {t(language, "undo")}
          </button>
        </div>
      ) : null}

      {manualStreetAreaSelection ? (
        <section className="mode-sheet" aria-label="Gebiet für manuelle Straße auswählen">
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">Straße manuell hinzufügen</span>
              <strong>Gebiet auswählen</strong>
            </div>
          </div>
          <p>Tippe auf ein Gebiet, in dem du Straßen bearbeiten darfst.</p>
          <div className="mode-actions">
            <button className="button secondary" type="button" onClick={() => setManualStreetAreaSelection(false)}>
              {t(language, "cancel")}
            </button>
          </div>
        </section>
      ) : null}

      {mode === "browse" && sheet === null ? (
        <section className={`map-toolbar ${access?.role === "viewer" ? "viewer-toolbar" : ""}`} aria-label={t(language, "mapActions")}>
          {access && (access.role === "admin" || access.role === "team-editor") ? (
            <label className="team-picker">
              <span>{t(language, "activeTeam")}</span>
              <select
                value={activeTeamId ?? ""}
                onChange={(event) => setActiveTeamId(event.target.value || null)}
                disabled={isEditor || snapshot.teams.length === 0}
              >
                {snapshot.teams.length === 0 ? <option value="">{t(language, "noTeam")}</option> : null}
                {snapshot.teams
                  .filter((team) => isAdmin || team.id === access.teamId)
                  .map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name.trim() || t(language, "team")}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <div className="toolbar-actions">
            <button className="button secondary" type="button" onClick={() => setSheet("settings")}>
              {t(language, "settings")}
            </button>
            {isAdmin ? (
              <button className="button secondary" type="button" onClick={() => setSheet("teams")}>
                {t(language, "teams")}
              </button>
            ) : null}
            {isAdmin ? (
              <button className="button secondary" type="button" onClick={() => setSheet("collection-admin")}>
                Collection
              </button>
            ) : null}
            {access && (access.role === "admin" || access.role === "team-editor") ? (
              <button className="button primary" type="button" onClick={startDrawing}>
                {t(language, "drawArea")}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {mode === "collection-main-draw" || mode === "collection-area-draw" ? (
        <section className="mode-sheet collection-mode-sheet" aria-label="Collection">
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">Collection</span>
              <strong>
                {mode === "collection-main-draw" ? "Collection Main Area" : "Collection Area"}
              </strong>
            </div>
            <span className="team-color-preview" style={{ backgroundColor: collectionColor }} aria-hidden="true" />
          </div>
          <p>
            {mode === "collection-main-draw"
              ? "Zeichne das gemeinsame Collection-Hauptgebiet."
              : "Zeichne ein auswählbares Collection-Untergebiet."}
          </p>
          <p className={`geometry-status ${collectionDraftValidation.valid ? "is-valid" : "is-invalid"}`}>
            {collectionDraftValidation.valid
              ? `${collectionDraftVertices.length} Punkte bereit`
              : geometryReason(language, collectionDraftValidation.reason)}
          </p>
          <div className="mode-actions three-actions">
            <button className="button secondary" type="button" onClick={cancelCollectionGeometry}>{t(language, "cancel")}</button>
            <button
              className="button secondary"
              type="button"
              disabled={collectionDraftVertices.length === 0}
              onClick={() => setCollectionDraftVertices((current) => current.slice(0, -1))}
            >
              {t(language, "undo")}
            </button>
            <button className="button primary" type="button" disabled={!collectionDraftValidation.valid} onClick={saveCollectionGeometry}>
              {t(language, "save")}
            </button>
          </div>
        </section>
      ) : null}

      {mode === "collection-area-edit" ? (
        <section className="mode-sheet collection-mode-sheet" aria-label="Collection Area bearbeiten">
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">Collection</span>
              <strong>{collectionSelectedArea?.name || "Collection Area"}</strong>
            </div>
            <span className="team-color-preview" style={{ backgroundColor: collectionSelectedArea?.color ?? "#2563eb" }} aria-hidden="true" />
          </div>
          <p>
            {collectionSelectedVertexIndex === null
              ? "Wähle einen Punkt auf der Karte und verschiebe ihn."
              : `Punkt ${collectionSelectedVertexIndex + 1} ausgewählt`}
          </p>
          <p className={`geometry-status ${collectionEditValidation.valid ? "is-valid" : "is-invalid"}`}>
            {collectionEditValidation.valid
              ? "Geometrie ist gültig"
              : geometryReason(language, collectionEditValidation.reason)}
          </p>
          <div className="mode-actions">
            <button className="button secondary" type="button" onClick={cancelCollectionGeometry}>{t(language, "cancel")}</button>
            <button className="button primary" type="button" disabled={!collectionEditValidation.valid} onClick={saveCollectionGeometry}>
              {t(language, "saveChanges")}
            </button>
          </div>
        </section>
      ) : null}

      {mode === "draw" ? (
        <section className="mode-sheet" aria-label={t(language, "drawArea")}>
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">{t(language, "drawing")}</span>
              <strong>{t(language, "area")} · {activeTeam?.name || t(language, "team")}</strong>
            </div>
            <span className="team-color-preview" style={{ backgroundColor: activeTeam?.color ?? "#2563eb" }} aria-hidden="true" />
          </div>
          <p>{t(language, "drawHint")}</p>
          <p className={`geometry-status ${drawValidation.valid ? "is-valid" : "is-invalid"}`}>
            {drawValidation.valid
              ? t(language, "readySaveCorners", { count: draftVertices.length })
              : geometryReason(language, drawValidation.reason)}
          </p>
          <div className="mode-actions three-actions">
            <button className="button secondary" type="button" onClick={cancelDrawing}>{t(language, "cancel")}</button>
            <button className="button secondary" type="button" disabled={draftVertices.length === 0} onClick={() => setDraftVertices((current) => current.slice(0, -1))}>{t(language, "undo")}</button>
            <button className="button primary" type="button" disabled={!drawValidation.valid} onClick={saveDraftArea}>{t(language, "save")}</button>
          </div>
        </section>
      ) : null}

      {mode === "street-draw" ? (
        <section className="mode-sheet" aria-label={t(language, "saveStreet")}>
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">{t(language, "streetMode")}</span>
              <strong>{selectedArea?.name || t(language, "area")}</strong>
            </div>
            <span className="team-color-preview" style={{ backgroundColor: streetColor }} aria-hidden="true" />
          </div>
          <p>{t(language, "streetHint")}</p>
          <p className={`geometry-status ${streetValidation.valid ? "is-valid" : "is-invalid"}`}>
            {streetValidation.valid
              ? t(language, "readySaveStreet", { count: streetDraftVertices.length })
              : geometryReason(language, streetValidation.reason)}
          </p>
          <div className="mode-actions three-actions">
            <button className="button secondary" type="button" onClick={cancelStreetDrawing}>{t(language, "cancel")}</button>
            <button className="button secondary" type="button" disabled={streetDraftVertices.length === 0} onClick={() => setStreetDraftVertices((current) => current.slice(0, -1))}>{t(language, "undo")}</button>
            <button className="button primary" type="button" disabled={!streetValidation.valid} onClick={saveStreetTask}>{t(language, "saveStreet")}</button>
          </div>
        </section>
      ) : null}

      {mode === "edit" ? (
        <section className="mode-sheet" aria-label={t(language, "editShape")}>
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">{t(language, "edit")}</span>
              <strong>{selectedArea?.name || t(language, "area")}</strong>
            </div>
            <span className="team-color-preview" style={{ backgroundColor: editColor }} aria-hidden="true" />
          </div>
          <p>
            {selectedVertexIndex === null
              ? t(language, "editHint")
              : t(language, "editHintSelected", { index: selectedVertexIndex + 1 })}
          </p>
          <p className={`geometry-status ${editValidation.valid ? "is-valid" : "is-invalid"}`}>
            {editValidation.valid ? t(language, "geometryValid") : geometryReason(language, editValidation.reason)}
          </p>
          <div className="mode-actions">
            <button className="button secondary" type="button" onClick={cancelEditing}>{t(language, "cancel")}</button>
            <button className="button primary" type="button" disabled={!editValidation.valid} onClick={saveEditedArea}>{t(language, "saveChanges")}</button>
          </div>
        </section>
      ) : null}

      {sheet === "settings" && mode === "browse" ? (
        <SettingsSheet
          language={language}
          campaign={snapshot.campaign}
          teams={snapshot.teams}
          access={access}
          currentCamera={currentCamera}
          initialAccessUrl={initialAccessUrl}
          onLanguageChange={setLanguage}
          onRenameCampaign={renameCampaign}
          onNormalizeCampaignName={normalizeCampaignName}
          onSaveCurrentFocus={saveCurrentFocus}
          onJumpToFocus={jumpToFocus}
          onRemoveFocus={removeFocus}
          onResetPersonalCamera={resetPersonalCamera}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === "campaign-comments" && mode === "browse" ? (
        <section className="bottom-sheet comment-sheet" aria-label="Kommentare">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div>
              <span className="eyebrow">{t(language, "campaignSettings")}</span>
              <strong>{language === "de" ? "Campaign-Kommentare" : "Campaign comments"}</strong>
            </div>
            <button className="icon-button" type="button" onClick={() => setSheet(null)} aria-label={t(language, "close")}>×</button>
          </div>
          <CommentsContextPanel
            campaignId={snapshot.campaign.id}
            targetType="campaign"
            targetId={snapshot.campaign.id}
            targetLabel={campaignDisplayName}
            targetTeamId={null}
            access={access}
            online={online}
            language={language}
          />
        </section>
      ) : null}

      {sheet === "teams" && mode === "browse" && isAdmin ? (
        <section className="bottom-sheet" aria-label={t(language, "manageTeams")}>
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div>
              <span className="eyebrow">{t(language, "campaignSettings")}</span>
              <strong>{t(language, "manageTeams")}</strong>
            </div>
            <button className="icon-button" type="button" onClick={() => setSheet(null)} aria-label={t(language, "close")}>×</button>
          </div>

          <div className="team-list">
            {snapshot.teams.length === 0 ? (
              <div className="empty-state">
                <strong>{t(language, "noTeamTitle")}</strong>
                <p>{t(language, "noTeamBody")}</p>
              </div>
            ) : null}

            {snapshot.teams.map((team) => (
              <article className={`team-card ${team.id === activeTeamId ? "is-active" : ""}`} key={team.id}>
                <div className="team-card-header">
                  <span className="team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />
                  <input
                    aria-label={t(language, "teamName", { name: team.name || t(language, "team") })}
                    value={team.name}
                    onChange={(event) => updateTeam(team.id, { name: event.target.value })}
                    onBlur={() => normalizeTeamName(team)}
                    maxLength={40}
                  />
                  <button className="small-action" type="button" onClick={() => setActiveTeamId(team.id)} aria-pressed={team.id === activeTeamId}>
                    {team.id === activeTeamId ? t(language, "active") : t(language, "choose")}
                  </button>
                </div>
                <div className="color-palette" aria-label={t(language, "teamColor", { name: team.name || t(language, "team") })}>
                  {TEAM_COLORS.map((color) => {
                    const usedByOther = snapshot.teams.some((other) => other.id !== team.id && other.color.toLowerCase() === color.value.toLowerCase());
                    return (
                      <button
                        key={color.value}
                        type="button"
                        className={`color-swatch ${team.color === color.value ? "is-selected" : ""}`}
                        style={{ backgroundColor: color.value }}
                        onClick={() => updateTeam(team.id, { color: color.value })}
                        aria-label={`${t(language, "teamColor", { name: color.value })}${usedByOther ? " · ×" : ""}`}
                        aria-pressed={team.color === color.value}
                      />
                    );
                  })}
                  <label className="color-picker-label">
                    <span>Eigene Farbe</span>
                    <input type="color" value={/^#[0-9a-f]{6}$/iu.test(team.color) ? team.color : "#334155"} onChange={(event) => updateTeam(team.id, { color: event.target.value })} aria-label="Eigene Teamfarbe" />
                  </label>
                </div>
              </article>
            ))}
          </div>

          <button className="button primary full-width" type="button" onClick={createTeam}>
            {t(language, "addTeam")}
          </button>
        </section>
      ) : null}

      {sheet === "collection-admin" && mode === "browse" && isAdmin ? (
        <CollectionAdminPanel
          campaignId={snapshot.campaign.id}
          language={language}
          snapshot={snapshot}
          onSnapshotChange={commitSnapshot}
          onClose={() => setSheet(null)}
          onStartMainArea={startCollectionMainArea}
          onStartArea={startCollectionArea}
          onEditArea={startCollectionAreaEditing}
          onForceReleaseArea={forceReleaseCollectionArea}
        />
      ) : null}

      {sheet === "area" && mode === "browse" && selectedArea ? (
        <section className="bottom-sheet compact-sheet" aria-label={t(language, "area")}>
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div className="area-heading">
              <span className="team-dot large-dot" style={{ backgroundColor: selectedAreaTeam?.color ?? "#64748b" }} aria-hidden="true" />
              <div>
                <span className="eyebrow">{t(language, "area")}</span>
                <strong>{selectedArea.name.trim() || t(language, "area")}</strong>
              </div>
            </div>
            <button className="icon-button" type="button" onClick={() => { setSelectedAreaId(null); setSelectedTaskId(null); setSheet(null); }} aria-label={t(language, "close")}>×</button>
          </div>

          {canEditSelectedArea ? (
            <div className="area-fields">
              <label className="field-label">
                <span>{t(language, "name")}</span>
                <input value={selectedArea.name} onChange={(event) => updateSelectedArea({ name: event.target.value })} onBlur={normalizeAreaName} maxLength={60} />
              </label>
              <label className="field-label">
                <span>{t(language, "team")}</span>
                <select value={selectedArea.teamId} disabled={!isAdmin} onChange={(event) => updateSelectedArea({ teamId: event.target.value })}>
                  {snapshot.teams.map((team) => <option value={team.id} key={team.id}>{team.name.trim() || t(language, "team")}</option>)}
                </select>
              </label>
            </div>
          ) : null}

          {canEditSelectedArea ? (
            <>
              <button className="button secondary full-width" type="button" onClick={startStreetDrawing}>{t(language, "addManualStreet")}</button>
              <div className="area-actions secondary-row">
                <button className="button secondary" type="button" onClick={startEditing}>{t(language, "editShape")}</button>
                <button className="button danger" type="button" onClick={deleteSelectedArea}>{t(language, "deleteArea")}</button>
              </div>
            </>
          ) : null}

          {selectedAreaHouseTasks.length > 0 ? (
            <div className="context-task-list">
              <div className="context-task-list-header">
                <strong>{language === "de" ? "Haus-Aufgaben" : "House tasks"}</strong>
                <span>{selectedAreaHouseTasks.length}</span>
              </div>
              {selectedAreaHouseTasks.map((task) => (
                <button className="context-task-row" type="button" key={task.id} onClick={() => selectHouseTask(task.id)}>
                  <span>{task.label.trim() || (language === "de" ? "Haus" : "House")}</span>
                  <small>{taskStatusLabel(language, task.status)}</small>
                </button>
              ))}
            </div>
          ) : null}

          <CommentsContextPanel
            campaignId={snapshot.campaign.id}
            targetType="area"
            targetId={selectedArea.id}
            targetLabel={selectedArea.name.trim() || t(language, "area")}
            targetTeamId={selectedArea.teamId}
            access={access}
            online={online}
            language={language}
          />
        </section>
      ) : null}

      {sheet === "task" && mode === "browse" && selectedTask ? (
        <section className="bottom-sheet task-sheet" aria-label={t(language, "streetMode")}>
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div className="area-heading">
              <span className="team-dot large-dot" style={{ backgroundColor: selectedTaskTeam?.color ?? "#64748b" }} aria-hidden="true" />
              <div>
                <span className="eyebrow">{t(language, "streetMode")} · {selectedTaskArea?.name || t(language, "area")}</span>
                <strong>{selectedTask.label.trim() || t(language, "street")}</strong>
              </div>
            </div>
            <button className="icon-button" type="button" onClick={() => { setSelectedTaskId(null); setSheet(selectedAreaId ? "area" : null); }} aria-label={t(language, "close")}>×</button>
          </div>

          {canEditSelectedTask && !selectedTaskIsAutoPrepared ? (
            <label className="field-label">
              <span>{t(language, "name")}</span>
              <input value={selectedTask.label} onChange={(event) => updateSelectedTask({ label: event.target.value })} onBlur={normalizeTaskLabel} maxLength={60} />
            </label>
          ) : null}

          <div className="task-current-status">
            <span>{t(language, "current")}</span>
            <strong>{taskStatusLabel(language, selectedTask.status)}</strong>
          </div>

          <div className="status-grid" aria-label={t(language, "current")}>
            {(["open", "completed", "later", "not-deliverable"] as TaskStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                disabled={!canChangeSelectedTaskStatus}
                className={`status-button status-${status} ${selectedTask.status === status ? "is-selected" : ""}`}
                aria-pressed={selectedTask.status === status}
                onClick={() => changeTaskStatus(status)}
              >
                {taskStatusLabel(language, status)}
              </button>
            ))}
          </div>

          {canEditSelectedTask && !selectedTaskIsAutoPrepared ? (
            <button className="button danger full-width task-delete" type="button" onClick={deleteSelectedTask}>{t(language, "deleteStreet")}</button>
          ) : null}

          <CommentsContextPanel
            campaignId={snapshot.campaign.id}
            targetType="street-task"
            targetId={selectedTask.id}
            targetLabel={selectedTask.label.trim() || t(language, "street")}
            targetTeamId={selectedTaskArea?.teamId ?? null}
            access={access}
            online={online}
            language={language}
          />
        </section>
      ) : null}

      {sheet === "house" && mode === "browse" && selectedHouseTask ? (
        <section className="bottom-sheet task-sheet commentable-task-sheet" aria-label={language === "de" ? "Haus-Aufgabe" : "House task"}>
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div className="area-heading">
              <span className="team-dot large-dot" style={{ backgroundColor: selectedHouseTaskTeam?.color ?? "#64748b" }} aria-hidden="true" />
              <div>
                <span className="eyebrow">{language === "de" ? "Haus-Aufgabe" : "House task"} · {selectedHouseTaskArea?.name || t(language, "area")}</span>
                <strong>{selectedHouseTask.label.trim() || (language === "de" ? "Haus" : "House")}</strong>
              </div>
            </div>
            <button className="icon-button" type="button" onClick={() => { setSelectedHouseTaskId(null); setSheet(selectedAreaId ? "area" : null); }} aria-label={t(language, "close")}>×</button>
          </div>

          <div className="task-current-status">
            <span>{t(language, "current")}</span>
            <strong>{taskStatusLabel(language, selectedHouseTask.status)}</strong>
          </div>

          <div className="status-grid" aria-label={t(language, "current")}>
            {(["open", "completed", "later", "not-deliverable"] as TaskStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                disabled={!canChangeSelectedHouseTaskStatus}
                className={`status-button status-${status} ${selectedHouseTask.status === status ? "is-selected" : ""}`}
                aria-pressed={selectedHouseTask.status === status}
                onClick={() => changeHouseTaskStatus(status)}
              >
                {taskStatusLabel(language, status)}
              </button>
            ))}
          </div>

          <CommentsContextPanel
            campaignId={snapshot.campaign.id}
            targetType="house-task"
            targetId={selectedHouseTask.id}
            targetLabel={selectedHouseTask.label.trim() || (language === "de" ? "Haus" : "House")}
            targetTeamId={selectedHouseTaskArea?.teamId ?? null}
            access={access}
            online={online}
            language={language}
          />
        </section>
      ) : null}
    </main>
  );
}

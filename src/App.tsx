import { useEffect, useMemo, useState } from "react";
import { loadCampaignSnapshot, saveCampaignSnapshot } from "./data/campaignStore";
import {
  createId,
  createLineStringGeometry,
  createPolygonGeometry,
  nextAvailableTeamColor,
  openPolygonRing,
  TASK_STATUS_OPTIONS,
  TEAM_COLORS,
  type Area,
  type CampaignSnapshot,
  type DistributionTask,
  type LngLat,
  type TaskStatus,
  type Team,
} from "./domain/campaign";
import { validateLineStringVertices, validatePolygonVertices } from "./domain/geometry";
import { MapView } from "./map/MapView";

type MapMode = "browse" | "draw" | "edit" | "street-draw";
type Sheet = "teams" | "area" | "task" | null;
type UndoStatusChange = {
  taskId: string;
  label: string;
  previousStatus: TaskStatus;
  previousCompletedAt: string | null;
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

function nextAreaName(areas: Area[]) {
  return `Gebiet ${areas.length + 1}`;
}

function nextStreetName(tasks: DistributionTask[], areaId: string) {
  const count = tasks.filter((task) => task.areaId === areaId).length;
  return `Straße ${count + 1}`;
}

function statusLabel(status: TaskStatus) {
  return TASK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export default function App() {
  const online = useOnlineStatus();
  const [initialLoad] = useState(loadCampaignSnapshot);
  const [snapshot, setSnapshot] = useState<CampaignSnapshot>(initialLoad.snapshot);
  const [storageWarning, setStorageWarning] = useState<string | null>(initialLoad.warning);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(
    initialLoad.snapshot.teams[0]?.id ?? null,
  );
  const [sheet, setSheet] = useState<Sheet>(null);
  const [mode, setMode] = useState<MapMode>("browse");
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draftVertices, setDraftVertices] = useState<LngLat[]>([]);
  const [editingVertices, setEditingVertices] = useState<LngLat[]>([]);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [streetDraftVertices, setStreetDraftVertices] = useState<LngLat[]>([]);
  const [undoStatusChange, setUndoStatusChange] = useState<UndoStatusChange | null>(null);

  useEffect(() => {
    setStorageWarning(saveCampaignSnapshot(snapshot));
  }, [snapshot]);

  useEffect(() => {
    if (!undoStatusChange) return;
    const timeout = window.setTimeout(() => setUndoStatusChange(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [undoStatusChange]);

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
  const selectedAreaTasks = selectedArea
    ? snapshot.tasks.filter((task) => task.areaId === selectedArea.id)
    : [];

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
        };
      }),
    [snapshot.tasks, snapshot.areas, snapshot.teams],
  );

  const drawValidation = useMemo(
    () => validatePolygonVertices(draftVertices),
    [draftVertices],
  );
  const editValidation = useMemo(
    () => validatePolygonVertices(editingVertices),
    [editingVertices],
  );
  const streetValidation = useMemo(
    () => validateLineStringVertices(streetDraftVertices),
    [streetDraftVertices],
  );

  const commitSnapshot = (update: (current: CampaignSnapshot) => CampaignSnapshot) => {
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
    commitSnapshot((current) => ({
      ...current,
      campaign: { ...current.campaign, name },
    }));
  };

  const normalizeCampaignName = () => {
    if (snapshot.campaign.name.trim()) return;
    renameCampaign("Neue Verteilaktion");
  };

  const createTeam = () => {
    const color = nextAvailableTeamColor(snapshot.teams);
    if (!color) return;

    const now = new Date().toISOString();
    const team: Team = {
      id: createId("team"),
      campaignId: snapshot.campaign.id,
      name: `Team ${snapshot.teams.length + 1}`,
      color,
      createdAt: now,
      updatedAt: now,
    };

    commitSnapshot((current) => ({
      ...current,
      teams: [...current.teams, team],
    }));
    setActiveTeamId(team.id);
  };

  const updateTeam = (teamId: string, patch: Partial<Pick<Team, "name" | "color">>) => {
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
    updateTeam(team.id, { name: "Team" });
  };

  const startDrawing = () => {
    if (!activeTeam) {
      setSheet("teams");
      return;
    }

    setMode("draw");
    setSheet(null);
    setSelectedAreaId(null);
    setSelectedTaskId(null);
    setDraftVertices([]);
    setEditingVertices([]);
    setStreetDraftVertices([]);
    setSelectedVertexIndex(null);
  };

  const cancelDrawing = () => {
    setMode("browse");
    setDraftVertices([]);
  };

  const saveDraftArea = () => {
    if (!activeTeam || !drawValidation.valid) return;

    const now = new Date().toISOString();
    const area: Area = {
      id: createId("area"),
      campaignId: snapshot.campaign.id,
      teamId: activeTeam.id,
      name: nextAreaName(snapshot.areas),
      geometry: createPolygonGeometry(draftVertices),
      createdAt: now,
      updatedAt: now,
    };

    commitSnapshot((current) => ({
      ...current,
      areas: [...current.areas, area],
    }));
    setDraftVertices([]);
    setMode("browse");
    setSelectedAreaId(area.id);
    setSheet("area");
  };

  const selectArea = (areaId: string | null) => {
    if (mode !== "browse") return;
    setSelectedTaskId(null);
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
    setSelectedAreaId(task.areaId);
    setSheet("task");
  };

  const updateSelectedArea = (patch: Partial<Pick<Area, "name" | "teamId">>) => {
    if (!selectedArea) return;
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
    updateSelectedArea({ name: nextAreaName(snapshot.areas.filter((area) => area.id !== selectedArea.id)) });
  };

  const deleteSelectedArea = () => {
    if (!selectedArea) return;
    if (!window.confirm(`„${selectedArea.name}“ und alle zugehörigen Straßen wirklich löschen?`)) return;

    commitSnapshot((current) => ({
      ...current,
      areas: current.areas.filter((area) => area.id !== selectedArea.id),
      tasks: current.tasks.filter((task) => task.areaId !== selectedArea.id),
    }));
    setSelectedAreaId(null);
    setSelectedTaskId(null);
    setSheet(null);
  };

  const startEditing = () => {
    if (!selectedArea) return;
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
    if (!selectedArea || !editValidation.valid) return;
    const now = new Date().toISOString();

    commitSnapshot((current) => ({
      ...current,
      areas: current.areas.map((area) =>
        area.id === selectedArea.id
          ? {
              ...area,
              geometry: createPolygonGeometry(editingVertices),
              updatedAt: now,
            }
          : area,
      ),
    }));
    setMode("browse");
    setEditingVertices([]);
    setSelectedVertexIndex(null);
    setSheet("area");
  };

  const startStreetDrawing = () => {
    if (!selectedArea) return;
    setStreetDraftVertices([]);
    setSelectedTaskId(null);
    setMode("street-draw");
    setSheet(null);
  };

  const cancelStreetDrawing = () => {
    setStreetDraftVertices([]);
    setMode("browse");
    if (selectedAreaId) setSheet("area");
  };

  const saveStreetTask = () => {
    if (!selectedArea || !streetValidation.valid) return;
    const now = new Date().toISOString();
    const task: DistributionTask = {
      id: createId("task"),
      campaignId: snapshot.campaign.id,
      areaId: selectedArea.id,
      taskType: "street",
      label: nextStreetName(snapshot.tasks, selectedArea.id),
      geometry: createLineStringGeometry(streetDraftVertices),
      status: "open",
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    commitSnapshot((current) => ({
      ...current,
      tasks: [...current.tasks, task],
    }));
    setStreetDraftVertices([]);
    setSelectedTaskId(task.id);
    setMode("browse");
    setSheet("task");
  };

  const updateSelectedTask = (
    patch: Partial<Pick<DistributionTask, "label" | "status" | "completedAt">>,
  ) => {
    if (!selectedTask) return;
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
    updateSelectedTask({ label: nextStreetName(snapshot.tasks.filter((task) => task.id !== selectedTask.id), selectedTask.areaId) });
  };

  const changeTaskStatus = (status: TaskStatus) => {
    if (!selectedTask || selectedTask.status === status) return;
    const now = new Date().toISOString();
    setUndoStatusChange({
      taskId: selectedTask.id,
      label: selectedTask.label,
      previousStatus: selectedTask.status,
      previousCompletedAt: selectedTask.completedAt,
    });
    updateSelectedTask({
      status,
      completedAt: status === "completed" ? now : null,
    });
  };

  const undoLastStatusChange = () => {
    if (!undoStatusChange) return;
    const now = new Date().toISOString();
    commitSnapshot((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === undoStatusChange.taskId
          ? {
              ...task,
              status: undoStatusChange.previousStatus,
              completedAt: undoStatusChange.previousCompletedAt,
              updatedAt: now,
            }
          : task,
      ),
    }));
    setUndoStatusChange(null);
  };

  const deleteSelectedTask = () => {
    if (!selectedTask) return;
    if (!window.confirm(`„${selectedTask.label}“ wirklich löschen?`)) return;
    commitSnapshot((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id !== selectedTask.id),
    }));
    if (undoStatusChange?.taskId === selectedTask.id) setUndoStatusChange(null);
    setSelectedTaskId(null);
    setSheet("area");
  };

  const campaignDisplayName = snapshot.campaign.name.trim() || "Verteilaktion";
  const editColor = selectedAreaTeam?.color ?? "#64748b";
  const streetColor = selectedAreaTeam?.color ?? "#2563eb";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-copy">
          <strong>Verteil-Flyer</strong>
          <span className="subtitle">{campaignDisplayName}</span>
        </div>
        <span className={`connection ${online ? "is-online" : "is-offline"}`}>
          {online ? "Online" : "Offline · lokal"}
        </span>
      </header>

      <MapView
        areas={renderedAreas}
        tasks={renderedTasks}
        selectedAreaId={selectedAreaId}
        selectedTaskId={selectedTaskId}
        mode={mode}
        draftVertices={draftVertices}
        draftColor={activeTeam?.color ?? "#2563eb"}
        editingVertices={editingVertices}
        editingColor={editColor}
        selectedVertexIndex={selectedVertexIndex}
        streetDraftVertices={streetDraftVertices}
        streetDraftColor={streetColor}
        onAreaSelect={selectArea}
        onTaskSelect={selectTask}
        onDrawPoint={(point) => setDraftVertices((current) => [...current, point])}
        onEditVertexSelect={(index) =>
          setSelectedVertexIndex((current) => (current === index ? null : index))
        }
        onEditVertexMove={moveEditVertex}
        onStreetDrawPoint={(point) => setStreetDraftVertices((current) => [...current, point])}
      />

      {storageWarning ? (
        <div className="storage-warning" role="status">
          {storageWarning}
        </div>
      ) : null}

      {undoStatusChange ? (
        <div className="undo-toast" role="status">
          <span>
            {undoStatusChange.label || "Straße"}: Status geändert
          </span>
          <button type="button" onClick={undoLastStatusChange}>
            Rückgängig
          </button>
        </div>
      ) : null}

      {mode === "browse" && sheet === null ? (
        <section className="map-toolbar" aria-label="Kartenaktionen">
          <label className="team-picker">
            <span>Aktives Team</span>
            <select
              value={activeTeamId ?? ""}
              onChange={(event) => setActiveTeamId(event.target.value || null)}
              disabled={snapshot.teams.length === 0}
            >
              {snapshot.teams.length === 0 ? <option value="">Noch kein Team</option> : null}
              {snapshot.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name.trim() || "Team"}
                </option>
              ))}
            </select>
          </label>
          <div className="toolbar-actions">
            <button className="button secondary" type="button" onClick={() => setSheet("teams")}>
              Teams
            </button>
            <button className="button primary" type="button" onClick={startDrawing}>
              Gebiet zeichnen
            </button>
          </div>
        </section>
      ) : null}

      {mode === "draw" ? (
        <section className="mode-sheet" aria-label="Gebiet zeichnen">
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">Zeichnen</span>
              <strong>Gebiet für {activeTeam?.name || "Team"}</strong>
            </div>
            <span
              className="team-color-preview"
              style={{ backgroundColor: activeTeam?.color ?? "#2563eb" }}
              aria-hidden="true"
            />
          </div>
          <p>Tippe die Eckpunkte nacheinander auf die Karte. Verschieben und Zoomen bleiben möglich.</p>
          <p className={`geometry-status ${drawValidation.valid ? "is-valid" : "is-invalid"}`}>
            {drawValidation.valid
              ? `${draftVertices.length} Eckpunkte · bereit zum Speichern`
              : drawValidation.reason}
          </p>
          <div className="mode-actions three-actions">
            <button className="button secondary" type="button" onClick={cancelDrawing}>
              Abbrechen
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={draftVertices.length === 0}
              onClick={() => setDraftVertices((current) => current.slice(0, -1))}
            >
              Rückgängig
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!drawValidation.valid}
              onClick={saveDraftArea}
            >
              Speichern
            </button>
          </div>
        </section>
      ) : null}

      {mode === "street-draw" ? (
        <section className="mode-sheet" aria-label="Straße einzeichnen">
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">Street Mode</span>
              <strong>{selectedArea?.name || "Gebiet"}</strong>
            </div>
            <span
              className="team-color-preview"
              style={{ backgroundColor: streetColor }}
              aria-hidden="true"
            />
          </div>
          <p>Tippe den Straßenverlauf Punkt für Punkt nach. Die Linie wird als manuelle Verteilaufgabe gespeichert.</p>
          <p className={`geometry-status ${streetValidation.valid ? "is-valid" : "is-invalid"}`}>
            {streetValidation.valid
              ? `${streetDraftVertices.length} Punkte · Straße bereit zum Speichern`
              : streetValidation.reason}
          </p>
          <div className="mode-actions three-actions">
            <button className="button secondary" type="button" onClick={cancelStreetDrawing}>
              Abbrechen
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={streetDraftVertices.length === 0}
              onClick={() => setStreetDraftVertices((current) => current.slice(0, -1))}
            >
              Rückgängig
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!streetValidation.valid}
              onClick={saveStreetTask}
            >
              Straße speichern
            </button>
          </div>
        </section>
      ) : null}

      {mode === "edit" ? (
        <section className="mode-sheet" aria-label="Gebiet bearbeiten">
          <div className="mode-title-row">
            <div>
              <span className="eyebrow">Bearbeiten</span>
              <strong>{selectedArea?.name || "Gebiet"}</strong>
            </div>
            <span
              className="team-color-preview"
              style={{ backgroundColor: editColor }}
              aria-hidden="true"
            />
          </div>
          <p>
            {selectedVertexIndex === null
              ? "Großen Eckpunkt antippen, dann die neue Position auf der Karte antippen."
              : `Eckpunkt ${selectedVertexIndex + 1} gewählt · jetzt Zielposition antippen.`}
          </p>
          <p className={`geometry-status ${editValidation.valid ? "is-valid" : "is-invalid"}`}>
            {editValidation.valid ? "Geometrie ist gültig." : editValidation.reason}
          </p>
          <div className="mode-actions">
            <button className="button secondary" type="button" onClick={cancelEditing}>
              Abbrechen
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!editValidation.valid}
              onClick={saveEditedArea}
            >
              Änderungen speichern
            </button>
          </div>
        </section>
      ) : null}

      {sheet === "teams" && mode === "browse" ? (
        <section className="bottom-sheet" aria-label="Teams verwalten">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div>
              <span className="eyebrow">Verteilaktion</span>
              <strong>Teams verwalten</strong>
            </div>
            <button className="icon-button" type="button" onClick={() => setSheet(null)} aria-label="Schließen">
              ×
            </button>
          </div>

          <label className="field-label">
            <span>Name der Aktion</span>
            <input
              value={snapshot.campaign.name}
              onChange={(event) => renameCampaign(event.target.value)}
              onBlur={normalizeCampaignName}
              maxLength={80}
            />
          </label>

          <div className="team-list">
            {snapshot.teams.length === 0 ? (
              <div className="empty-state">
                <strong>Noch kein Team</strong>
                <p>Lege ein Team an. Danach kannst du das erste Gebiet direkt auf der Karte zeichnen.</p>
              </div>
            ) : null}

            {snapshot.teams.map((team) => (
              <article className={`team-card ${team.id === activeTeamId ? "is-active" : ""}`} key={team.id}>
                <div className="team-card-header">
                  <span className="team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />
                  <input
                    aria-label={`Name von ${team.name || "Team"}`}
                    value={team.name}
                    onChange={(event) => updateTeam(team.id, { name: event.target.value })}
                    onBlur={() => normalizeTeamName(team)}
                    maxLength={40}
                  />
                  <button
                    className="small-action"
                    type="button"
                    onClick={() => setActiveTeamId(team.id)}
                    aria-pressed={team.id === activeTeamId}
                  >
                    {team.id === activeTeamId ? "Aktiv" : "Wählen"}
                  </button>
                </div>
                <div className="color-palette" aria-label={`Farbe für ${team.name || "Team"}`}>
                  {TEAM_COLORS.map((color) => {
                    const usedByOther = snapshot.teams.some(
                      (other) => other.id !== team.id && other.color === color.value,
                    );
                    return (
                      <button
                        key={color.value}
                        type="button"
                        className={`color-swatch ${team.color === color.value ? "is-selected" : ""}`}
                        style={{ backgroundColor: color.value }}
                        disabled={usedByOther}
                        onClick={() => updateTeam(team.id, { color: color.value })}
                        aria-label={`${color.label}${usedByOther ? " · vergeben" : ""}`}
                        aria-pressed={team.color === color.value}
                      />
                    );
                  })}
                </div>
              </article>
            ))}
          </div>

          <button
            className="button primary full-width"
            type="button"
            onClick={createTeam}
            disabled={nextAvailableTeamColor(snapshot.teams) === null}
          >
            {nextAvailableTeamColor(snapshot.teams) === null ? "Alle Teamfarben vergeben" : "+ Team hinzufügen"}
          </button>
        </section>
      ) : null}

      {sheet === "area" && mode === "browse" && selectedArea ? (
        <section className="bottom-sheet compact-sheet" aria-label="Gebiet verwalten">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div className="area-heading">
              <span
                className="team-dot large-dot"
                style={{ backgroundColor: selectedAreaTeam?.color ?? "#64748b" }}
                aria-hidden="true"
              />
              <div>
                <span className="eyebrow">Gebiet</span>
                <strong>{selectedArea.name.trim() || "Gebiet"}</strong>
              </div>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setSelectedAreaId(null);
                setSelectedTaskId(null);
                setSheet(null);
              }}
              aria-label="Schließen"
            >
              ×
            </button>
          </div>

          <div className="area-fields">
            <label className="field-label">
              <span>Name</span>
              <input
                value={selectedArea.name}
                onChange={(event) => updateSelectedArea({ name: event.target.value })}
                onBlur={normalizeAreaName}
                maxLength={60}
              />
            </label>
            <label className="field-label">
              <span>Team</span>
              <select
                value={selectedArea.teamId}
                onChange={(event) => updateSelectedArea({ teamId: event.target.value })}
              >
                {snapshot.teams.map((team) => (
                  <option value={team.id} key={team.id}>
                    {team.name.trim() || "Team"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="street-summary">
            <span>{selectedAreaTasks.length} Straßen</span>
            <span>{selectedAreaTasks.filter((task) => task.status === "completed").length} erledigt</span>
          </div>

          <button className="button primary full-width" type="button" onClick={startStreetDrawing}>
            + Straße einzeichnen
          </button>

          <div className="area-actions secondary-row">
            <button className="button secondary" type="button" onClick={startEditing}>
              Form bearbeiten
            </button>
            <button className="button danger" type="button" onClick={deleteSelectedArea}>
              Gebiet löschen
            </button>
          </div>
        </section>
      ) : null}

      {sheet === "task" && mode === "browse" && selectedTask ? (
        <section className="bottom-sheet task-sheet" aria-label="Straßenstatus">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-header">
            <div className="area-heading">
              <span
                className="team-dot large-dot"
                style={{ backgroundColor: selectedTaskTeam?.color ?? "#64748b" }}
                aria-hidden="true"
              />
              <div>
                <span className="eyebrow">Street Mode · {selectedTaskArea?.name || "Gebiet"}</span>
                <strong>{selectedTask.label.trim() || "Straße"}</strong>
              </div>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setSelectedTaskId(null);
                setSheet(selectedAreaId ? "area" : null);
              }}
              aria-label="Schließen"
            >
              ×
            </button>
          </div>

          <label className="field-label">
            <span>Name</span>
            <input
              value={selectedTask.label}
              onChange={(event) => updateSelectedTask({ label: event.target.value })}
              onBlur={normalizeTaskLabel}
              maxLength={60}
            />
          </label>

          <div className="task-current-status">
            <span>Aktuell</span>
            <strong>{statusLabel(selectedTask.status)}</strong>
          </div>

          <div className="status-grid" aria-label="Straßenstatus ändern">
            {TASK_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`status-button status-${option.value} ${selectedTask.status === option.value ? "is-selected" : ""}`}
                aria-pressed={selectedTask.status === option.value}
                onClick={() => changeTaskStatus(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button className="button danger full-width task-delete" type="button" onClick={deleteSelectedTask}>
            Straße löschen
          </button>
        </section>
      ) : null}
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import { loadCampaignSnapshot, saveCampaignSnapshot } from "./data/campaignStore";
import {
  createId,
  createPolygonGeometry,
  nextAvailableTeamColor,
  openPolygonRing,
  TEAM_COLORS,
  type Area,
  type CampaignSnapshot,
  type LngLat,
  type Team,
} from "./domain/campaign";
import { validatePolygonVertices } from "./domain/geometry";
import { MapView } from "./map/MapView";

type MapMode = "browse" | "draw" | "edit";
type Sheet = "teams" | "area" | null;

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
  const [draftVertices, setDraftVertices] = useState<LngLat[]>([]);
  const [editingVertices, setEditingVertices] = useState<LngLat[]>([]);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);

  useEffect(() => {
    setStorageWarning(saveCampaignSnapshot(snapshot));
  }, [snapshot]);

  const activeTeam = snapshot.teams.find((team) => team.id === activeTeamId) ?? null;
  const selectedArea = snapshot.areas.find((area) => area.id === selectedAreaId) ?? null;
  const selectedAreaTeam = selectedArea
    ? snapshot.teams.find((team) => team.id === selectedArea.teamId) ?? null
    : null;

  const renderedAreas = useMemo(
    () =>
      snapshot.areas.map((area) => ({
        ...area,
        color: snapshot.teams.find((team) => team.id === area.teamId)?.color ?? "#64748b",
      })),
    [snapshot.areas, snapshot.teams],
  );

  const drawValidation = useMemo(
    () => validatePolygonVertices(draftVertices),
    [draftVertices],
  );
  const editValidation = useMemo(
    () => validatePolygonVertices(editingVertices),
    [editingVertices],
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
    setDraftVertices([]);
    setEditingVertices([]);
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
    setSelectedAreaId(areaId);
    setSheet(areaId ? "area" : null);
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
    if (!window.confirm(`„${selectedArea.name}“ wirklich löschen?`)) return;

    commitSnapshot((current) => ({
      ...current,
      areas: current.areas.filter((area) => area.id !== selectedArea.id),
    }));
    setSelectedAreaId(null);
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

  const campaignDisplayName = snapshot.campaign.name.trim() || "Verteilaktion";
  const editColor = selectedAreaTeam?.color ?? "#64748b";

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
        selectedAreaId={selectedAreaId}
        mode={mode}
        draftVertices={draftVertices}
        draftColor={activeTeam?.color ?? "#2563eb"}
        editingVertices={editingVertices}
        editingColor={editColor}
        selectedVertexIndex={selectedVertexIndex}
        onAreaSelect={selectArea}
        onDrawPoint={(point) => setDraftVertices((current) => [...current, point])}
        onEditVertexSelect={(index) =>
          setSelectedVertexIndex((current) => (current === index ? null : index))
        }
        onEditVertexMove={moveEditVertex}
      />

      {storageWarning ? (
        <div className="storage-warning" role="status">
          {storageWarning}
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

          <div className="area-actions">
            <button className="button primary" type="button" onClick={startEditing}>
              Form bearbeiten
            </button>
            <button className="button danger" type="button" onClick={deleteSelectedArea}>
              Gebiet löschen
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

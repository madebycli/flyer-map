import { useMemo, useState } from "react";
import type { CampaignSnapshot, DistributionTask } from "../domain/campaign.ts";
import {
  collectionAreaColor,
  collectionSnapshotOrEmpty,
  createCollectionId,
  type CollectionRoadSectionStatus,
} from "../domain/collection.ts";
import { lineStringIntersectsPolygon } from "../domain/smartGeometry.ts";
import { postCampaignMutation } from "../data/campaignApi.ts";
import type { CampaignMutation } from "../domain/mutations.ts";
import { createPickupRoadSectionFromSelection, verifyPickupRoadSectionAgainstDistribution } from "./pickupStreetEngineAdapter.ts";
import { usePickupStreetWorkspace } from "./usePickupStreetWorkspace.ts";
import type { Language } from "../i18n.ts";
import { MapView } from "../map/MapView.tsx";
import { manualRefreshCampaign } from "../data/campaignStore.ts";
import "./pickup-area.css";

type Props = {
  campaignId: string;
  language: Language;
  snapshot: CampaignSnapshot;
  onSnapshotChange: (update: (current: CampaignSnapshot) => CampaignSnapshot) => void;
};

function copy(language: Language, german: string, english: string) {
  return language === "en" ? english : german;
}

function statusLabel(language: Language, status: CollectionRoadSectionStatus) {
  const labels: Record<CollectionRoadSectionStatus, [string, string]> = {
    open: ["offen", "open"],
    driven: ["gefahren", "driven"],
    later: ["später", "later"],
    unavailable: ["nicht möglich", "unavailable"],
  };
  return copy(language, labels[status][0], labels[status][1]);
}

function actorLabel(language: Language, actor: { kind: "campaign-grant" | "collection-collector"; ref: string | null } | undefined) {
  if (!actor) return null;
  const subject = actor.kind === "collection-collector"
    ? copy(language, "Sammler", "Collector")
    : copy(language, "Admin", "Admin");
  return `${subject}${actor.ref ? ` · ${actor.ref.slice(-8)}` : ""}`;
}

export function PickupRoadSectionWorkspace({ campaignId, language, snapshot, onSnapshotChange }: Props) {
  const collection = collectionSnapshotOrEmpty(snapshot.collection);
  const [sectionAreaId, setSectionAreaId] = useState<string | null>(null);
  const [sectionLabel, setSectionLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revertTargets, setRevertTargets] = useState<Record<string, CollectionRoadSectionStatus>>({});
  const [verification, setVerification] = useState<Record<string, string>>({});
  const marking = usePickupStreetWorkspace(snapshot.tasks, collection.areas);
  const selectedArea = collection.areas.find((area) => area.id === sectionAreaId) ?? null;
  const renderedAreas = useMemo(
    () => collection.areas.filter((area) => area.status !== "archived").map((area, index) => ({ ...area, color: area.color || collectionAreaColor(index) })),
    [collection.areas],
  );
  const renderedTasks = useMemo(
    () => snapshot.tasks.map((task: DistributionTask) => ({ ...task, color: "#7c3aed", completedColor: "#6d28d9" })),
    [snapshot.tasks],
  );

  const begin = (areaId: string) => {
    setSectionAreaId(areaId);
    setSectionLabel("");
    setMessage(null);
    marking.start(areaId);
  };

  const cancel = () => {
    marking.reset();
    setSectionAreaId(null);
    setSectionLabel("");
    setMessage(null);
  };

  const saveSection = async () => {
    if (!selectedArea || !marking.activeRoute || marking.points.length < 2 || !sectionLabel.trim()) {
      setMessage(copy(language, "Mindestens zwei Punkte und ein Name sind erforderlich.", "At least two points and a name are required."));
      return;
    }
    try {
      const section = await createPickupRoadSectionFromSelection(
        {
          campaignId,
          areaId: selectedArea.id,
          sectionId: createCollectionId("section"),
          label: sectionLabel,
          points: marking.points,
          pickupAreaGeometry: selectedArea.geometry,
          legs: marking.legs,
        },
        snapshot.tasks,
      );
      onSnapshotChange((current) => ({
        ...current,
        collection: {
          ...collectionSnapshotOrEmpty(current.collection),
          roadSections: [...collectionSnapshotOrEmpty(current.collection).roadSections, section],
        },
      }));
      setMessage(copy(language, "Pickup-Straßenabschnitt gespeichert.", "Pickup road section saved."));
      cancel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy(language, "Pickup-Straße konnte nicht gespeichert werden.", "Pickup road could not be saved."));
    }
  };

  const verify = async (sectionId: string) => {
    const section = collection.roadSections.find((candidate) => candidate.id === sectionId);
    if (!section) return;
    setVerifyingId(sectionId);
    const result = await verifyPickupRoadSectionAgainstDistribution(section, snapshot.tasks);
    setVerification((current) => ({ ...current, [sectionId]: result.valid ? copy(language, "aktuell gültig", "currently valid") : result.reason ?? "ungültig" }));
    setVerifyingId(null);
  };

  const updateStatus = (sectionId: string, status: CollectionRoadSectionStatus) => {
    const section = collection.roadSections.find((candidate) => candidate.id === sectionId);
    if (!section || section.status === status) return;
    const now = new Date().toISOString();
    onSnapshotChange((current) => ({
      ...current,
      collection: {
        ...collectionSnapshotOrEmpty(current.collection),
        roadSections: collectionSnapshotOrEmpty(current.collection).roadSections.map((candidate) => candidate.id === sectionId ? { ...candidate, status, updatedAt: now } : candidate),
      },
    }));
  };

  const revertStatus = async (sectionId: string) => {
    const section = collection.roadSections.find((candidate) => candidate.id === sectionId);
    const status = section ? revertTargets[section.id] : undefined;
    if (!section || !status || status === section.status || section.status === "open" || revertingId) return;
    if (typeof window !== "undefined" && !window.confirm(copy(language, "Diese Änderung als kompensierende Admin-Aktion zurücksetzen?", "Revert this change as a compensating admin action?"))) return;
    setRevertingId(sectionId);
    try {
      const mutation: CampaignMutation = {
        id: `mutation_${crypto.randomUUID()}`,
        campaignId,
        type: "collection.pickup-section.revert-status",
        baseRevision: snapshot.revision,
        createdAt: new Date().toISOString(),
        payload: {
          sectionId: section.id,
          areaId: section.areaId,
          status,
          expectedUpdatedAt: section.updatedAt,
          expectedCurrentStatus: section.status,
        },
      };
      await postCampaignMutation(campaignId, mutation);
      setMessage(copy(language, "Pickup-Abschnitt kompensierend zurückgesetzt.", "Pickup section reverted with a compensating admin action."));
      manualRefreshCampaign();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy(language, "Revert konnte nicht gespeichert werden.", "Revert could not be saved."));
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <section className="pickup-road-workspace" aria-label={copy(language, "Pickup-Straßen vorbereiten", "Prepare pickup roads")}>
      <div className="pickup-area-section-heading">
        <div><span className="eyebrow">{copy(language, "Pickup-Straßen", "Pickup roads")}</span><h2>{copy(language, "Smart Marking", "Smart marking")}</h2></div>
        <span className="collection-count">{collection.roadSections.length}</span>
      </div>
      <p className="collection-footnote">
        {copy(language, "Die Karte nutzt denselben StreetEngine wie der Verteilmodus. Gespeichert wird aber eine eigene Pickup-Section mit eigener ID, Route, Waypoints und erwarteter Netzversion.", "The map uses the same StreetEngine as distribution. It saves an independent pickup section with its own ID, route, waypoints and expected network state.")}
      </p>
      {!marking.active ? (
        <div className="pickup-area-prepare-list">
          {collection.areas.filter((area) => area.status !== "archived").map((area) => {
            const count = collection.roadSections.filter((section) => section.areaId === area.id).length;
            const prepared = snapshot.tasks.some((task) =>
              task.network && lineStringIntersectsPolygon(task.geometry.coordinates, area.geometry.coordinates[0] ?? []),
            );
            return (
              <article className="pickup-area-prepare-row" key={area.id}>
                <div><strong>{area.name}</strong><small>{count} {copy(language, "Abschnitt(e)", "section(s)")} · {prepared ? copy(language, "StreetEngine bereit", "StreetEngine ready") : copy(language, "Vorbereitung fehlt", "Preparation missing")}</small></div>
                <button type="button" className="small-action" disabled={!prepared} onClick={() => begin(area.id)}>{copy(language, "Markieren", "Mark")}</button>
              </article>
            );
          })}
          {collection.areas.length === 0 ? <p className="empty-state">{copy(language, "Zuerst Pickup Areas anlegen.", "Create pickup areas first.")}</p> : null}
        </div>
      ) : (
        <>
          <div className="pickup-smart-map-card">
            <MapView
              campaignId={campaignId}
              campaignDefaultView={snapshot.campaign.defaultMapView ?? null}
              language={language}
              areas={[]}
              tasks={renderedTasks}
              houses={[]}
              selectedTaskId={null}
              selectedHouseTaskId={null}
              mode="smart-street"
              draftVertices={[]}
              draftColor="#7c3aed"
              editingVertices={[]}
              editingColor="#7c3aed"
              selectedVertexIndex={null}
              streetDraftVertices={[]}
              streetDraftColor="#7c3aed"
              refreshState="idle"
              cameraCommand={null}
              onCameraChange={() => {}}
              onRefresh={manualRefreshCampaign}
              onAreaSelect={() => {}}
              onTaskSelect={() => {}}
              onHouseTaskSelect={() => {}}
              onDrawPoint={() => {}}
              onEditVertexSelect={() => {}}
              onEditVertexMove={() => {}}
              onStreetDrawPoint={() => {}}
              {...marking.mapProps}
              collectionVisible
              collectionSmartMarking
              collectionMainArea={collection.mainArea}
              collectionAreas={renderedAreas}
              collectionRoadSections={collection.roadSections}
              selectedCollectionAreaId={selectedArea?.id ?? null}
              onCollectionSmartPoint={marking.onMapPoint}
              onCollectionAreaSelect={() => {}}
              onCollectionPickupSelect={() => {}}
            />
          </div>
          <div className="pickup-smart-toolbar">
            <label><span>{copy(language, "Abschnittsname", "Section name")}</span><input value={sectionLabel} maxLength={240} onChange={(event) => setSectionLabel(event.target.value)} placeholder={copy(language, "z. B. Nordroute", "e.g. North route")} /></label>
            <p>{marking.message}</p>
            <div className="pickup-smart-actions">
              <button type="button" className="secondary-action" onClick={marking.undo} disabled={marking.points.length === 0}>{copy(language, "Letzten Punkt zurück", "Undo last point")}</button>
              <button type="button" className="text-action danger-action" onClick={cancel}>{copy(language, "Abbrechen", "Cancel")}</button>
              <button type="button" className="primary-action" onClick={() => void saveSection()} disabled={marking.points.length < 2 || !marking.activeRoute || !sectionLabel.trim()}>{copy(language, "Pickup-Straße speichern", "Save pickup road")}</button>
            </div>
          </div>
          {marking.choices.length > 0 ? (
            <div className="pickup-smart-choice-list"><strong>{copy(language, "Straße auswählen", "Choose road")}</strong>{marking.choices.map((choice) => <button type="button" className="small-action" key={`${choice.task.id}:${choice.measure}`} onClick={() => marking.chooseCandidate(choice)}>{choice.task.label} · {Math.round(choice.distance)} m</button>)}</div>
          ) : null}
          {marking.legs.map((leg, index) => leg.routes.length > 1 ? (
            <div className="pickup-smart-choice-list" key={`leg-${index}`}><strong>{copy(language, `Route für Teilstrecke ${index + 1}`, `Route for leg ${index + 1}`)}</strong>{leg.routes.map((route, routeIndex) => <button type="button" className={leg.selected === routeIndex ? "small-action is-selected" : "small-action"} key={`${index}:${routeIndex}`} onClick={() => marking.chooseRoute(index, routeIndex)}>{routeIndex + 1} · {Math.round(route.length)} m</button>)}</div>
          ) : null)}
        </>
      )}

      <div className="pickup-road-section-list pickup-road-section-admin-list">
        {collection.roadSections.map((section) => (
          <article className={`pickup-road-section-row is-${section.status}`} key={section.id}>
            <div><strong>{section.label}</strong><small>{section.smartMarking ? `${section.smartMarking.via.length + 2} ${copy(language, "Punkte", "points")}` : copy(language, "manuell", "manual")}{verification[section.id] ? ` · ${verification[section.id]}` : ""}{actorLabel(language, section.updatedBy) ? ` · ${copy(language, "zuletzt", "last")}: ${actorLabel(language, section.updatedBy)}` : ""}</small></div>
            <div className="pickup-road-section-actions">
              <select aria-label={`${section.label}: ${copy(language, "Status", "Status")}`} value={section.status} onChange={(event) => updateStatus(section.id, event.target.value as CollectionRoadSectionStatus)}>{(["open", "driven", "later", "unavailable"] as CollectionRoadSectionStatus[]).map((status) => <option key={status} value={status}>{statusLabel(language, status)}</option>)}</select>
              {section.smartMarking ? <button type="button" className="text-action" disabled={verifyingId === section.id} onClick={() => void verify(section.id)}>{verifyingId === section.id ? "…" : copy(language, "Prüfen", "Verify")}</button> : null}
              {section.status !== "open" ? (
                <div className="pickup-road-section-revert">
                  <select
                    aria-label={`${section.label}: ${copy(language, "Revert-Ziel", "Revert target")}`}
                    value={revertTargets[section.id] && revertTargets[section.id] !== section.status ? revertTargets[section.id] : "open"}
                    onChange={(event) => setRevertTargets((current) => ({ ...current, [section.id]: event.target.value as CollectionRoadSectionStatus }))}
                  >
                    {(["open", "driven", "later", "unavailable"] as CollectionRoadSectionStatus[]).filter((status) => status !== section.status).map((status) => <option key={status} value={status}>{statusLabel(language, status)}</option>)}
                  </select>
                  <button type="button" className="text-action danger-action" disabled={revertingId === section.id} onClick={() => void revertStatus(section.id)}>{revertingId === section.id ? "…" : copy(language, "Ausgleichen", "Revert")}</button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {message ? <p className="collection-message" role="status">{message}</p> : null}
    </section>
  );
}

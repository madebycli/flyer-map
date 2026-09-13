import { useMemo, useState } from "react";
import type { DistributionTask, LngLat } from "../domain/campaign.ts";
import type { CollectionArea } from "../domain/collection.ts";
import { lineStringIntersectsPolygon, pointInPolygon } from "../domain/smartGeometry.ts";
import {
  MAX_NETWORK_POINTS,
  joinNetworkRoutes,
} from "../domain/networkSelection.ts";
import {
  RoadIndex,
  networkRoutes,
  snapNetworkPoint,
  type NetworkRoute,
  type RoadSnap,
} from "../domain/streetNetwork.ts";
import type { SmartRoadCandidate } from "../domain/smartCandidates.ts";
import type { SmartRoadPointAnchor } from "../domain/smartRoadPointAnchor.ts";

function anchor(snap: RoadSnap): SmartRoadPointAnchor {
  return {
    sourceId: snap.task.id,
    snapped: snap.point,
    segmentIndex: 0,
    segmentT: 0,
    distanceMeters: snap.distance,
  };
}

function candidates(tasks: DistributionTask[]): SmartRoadCandidate[] {
  return tasks.map((task) => ({
    sourceId: task.id,
    osmId: task.source?.objectIds[0] ?? 0,
    name: task.label,
    ref: null,
    highway: "residential",
    geometry: task.geometry,
  }));
}

export function usePickupStreetWorkspace(tasks: DistributionTask[], areas: CollectionArea[] = []) {
  const [areaId, setAreaId] = useState<string | null>(null);
  const [selectionTasks, setSelectionTasks] = useState<DistributionTask[]>([]);
  const [points, setPoints] = useState<RoadSnap[]>([]);
  const [legs, setLegs] = useState<{ routes: NetworkRoute[]; selected: number | null }[]>([]);
  const [choices, setChoices] = useState<RoadSnap[]>([]);
  const [pendingPoint, setPendingPoint] = useState<LngLat | null>(null);
  const [message, setMessage] = useState("");

  const pickupArea = useMemo(
    () => areas.find((area) => area.id === areaId) ?? null,
    [areaId, areas],
  );
  const index = useMemo(() => new RoadIndex(selectionTasks), [selectionTasks]);
  const activeRoute = useMemo(() => {
    if (!legs.length || legs.some((leg) => leg.selected === null)) return null;
    try {
      return joinNetworkRoutes(legs.map((leg) => leg.routes[leg.selected!]));
    } catch {
      return null;
    }
  }, [legs]);

  const reset = () => {
    setAreaId(null);
    setSelectionTasks([]);
    setPoints([]);
    setLegs([]);
    setChoices([]);
    setPendingPoint(null);
    setMessage("");
  };

  const start = (nextAreaId: string) => {
    const nextArea = areas.find((area) => area.id === nextAreaId) ?? null;
    const ring = nextArea?.geometry.coordinates[0] ?? [];
    const nextTasks = tasks.filter(
      (task) => task.network && (!nextArea || lineStringIntersectsPolygon(task.geometry.coordinates, ring)),
    );
    setAreaId(nextAreaId);
    setSelectionTasks(nextTasks);
    setPoints([]);
    setLegs([]);
    setChoices([]);
    setPendingPoint(null);
    setMessage(nextTasks.length ? "Wähle den ersten Punkt auf einer vorbereiteten Straße." : "Für dieses Gebiet gibt es noch keine vorbereiteten Straßen.");
  };

  const accept = (snap: RoadSnap) => {
    if (!areaId || points.length >= MAX_NETWORK_POINTS) return;
    setChoices([]);
    setPendingPoint(null);
    if (points.length === 0) {
      setPoints([snap]);
      setMessage("Wähle den nächsten Punkt. Mehrere Punkte bleiben echte Wegpunkte.");
      return;
    }
    const last = points.at(-1)!;
    try {
      const routeTasks = tasks.filter((task) => task.network && task.areaId === last.task.areaId);
      const routes = networkRoutes(routeTasks, last, snap);
      if (!routes.length) throw new Error("pickup_route_missing");
      setPoints((current) => [...current, snap]);
      setLegs((current) => [...current, { routes, selected: 0 }]);
      setMessage(
        routes.length > 1
          ? "Wähle die gewünschte Route für die letzte Teilstrecke oder setze den nächsten Wegpunkt."
          : "Setze weitere Wegpunkte oder speichere den Abschnitt.",
      );
    } catch {
      setMessage("Zwischen diesen Punkten wurde keine gültige vorbereitete Straßenroute gefunden.");
    }
  };

  const onMapPoint = (point: LngLat) => {
    if (!areaId || points.length >= MAX_NETWORK_POINTS || (legs.at(-1)?.selected === null)) return;
    try {
      const ring = pickupArea?.geometry.coordinates[0] ?? [];
      if (pickupArea && !pointInPolygon(point, ring)) throw new Error("pickup_point_outside_area");
      const found = index.candidates(point);
      if (!found.length) throw new Error("pickup_snap_missing");
      if (found[1] && found[1].distance - found[0].distance < 1) {
        setPendingPoint(point);
        setChoices(found.slice(0, 4));
        setMessage("Mehrere Straßen liegen hier nah beieinander. Wähle die richtige Straße.");
        return;
      }
      accept(snapNetworkPoint(index, point));
    } catch {
      setMessage("Bitte einen Punkt innerhalb von 45 Metern einer vorbereiteten Straße wählen.");
    }
  };

  const chooseCandidate = (snap: RoadSnap) => accept(snap);

  const chooseRoute = (legIndex: number, routeIndex: number) => {
    if (!legs[legIndex]?.routes[routeIndex]) return;
    setLegs((current) => current.map((leg, index) => index === legIndex ? { ...leg, selected: routeIndex } : leg));
    setMessage("Teilroute aktualisiert. Weitere Wegpunkte bleiben möglich.");
  };

  const undo = () => {
    if (!points.length) return;
    if (points.length === 1) {
      setPoints([]);
      setLegs([]);
      setMessage("Erster Punkt entfernt. Wähle einen neuen Startpunkt.");
      return;
    }
    setPoints((current) => current.slice(0, -1));
    setLegs((current) => current.slice(0, -1));
    setChoices([]);
    setPendingPoint(null);
    setMessage("Letzter Wegpunkt entfernt.");
  };

  const anchors = points.map(anchor);
  return {
    active: areaId !== null,
    areaId,
    points,
    legs,
    choices,
    pendingPoint,
    message,
    activeRoute,
    start,
    reset,
    onMapPoint,
    chooseCandidate,
    chooseRoute,
    undo,
    mapProps: {
      smartRoads: candidates(selectionTasks),
      smartSelectedSourceIds: activeRoute ? [...new Set(activeRoute.ranges.map((range) => range.taskId))] : [],
      smartStartAnchor: anchors[0] ?? null,
      smartEndAnchor: anchors.length > 1 ? anchors.at(-1)! : null,
      smartWaypointAnchors: anchors.slice(1, -1),
      smartPreviewGeometry: activeRoute?.geometry ?? null,
      smartStreetColor: "#7c3aed",
    },
  };
}

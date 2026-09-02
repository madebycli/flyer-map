import type { LineStringGeometry, LngLat, PolygonGeometry } from "./campaign.ts";

export {
  clipLineGeometryToPolygon,
  clipLineStringToPolygon,
  lineStringInsidePolygon,
  pointInOrOnPolygon,
  polygonRepresentativePoint,
} from "../../worker/streetPreparation/clipRoadsToArea.ts";

export type { LineStringGeometry, LngLat, PolygonGeometry };

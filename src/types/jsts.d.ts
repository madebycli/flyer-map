type JstsCoordinate = {
  x: number;
  y: number;
};

type JstsGeometry = {
  getGeometryType(): string;
  getNumGeometries(): number;
  getGeometryN(index: number): JstsGeometry;
  getCoordinates(): JstsCoordinate[];
  getInteriorPoint(): JstsGeometry;
  getCoordinate(): JstsCoordinate | null;
  isEmpty(): boolean;
};

declare module "jsts/org/locationtech/jts/io/GeoJSONReader.js" {
  export default class GeoJSONReader {
    read(geometry: object): JstsGeometry;
  }
}

declare module "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js" {
  export default class OverlayOp {
    static intersection(left: JstsGeometry, right: JstsGeometry): JstsGeometry;
  }
}

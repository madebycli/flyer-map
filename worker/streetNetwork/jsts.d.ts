declare module 'jsts/org/locationtech/jts/io/GeoJSONReader.js' {
  export default class GeoJSONReader { read(value: unknown): JstsNetworkGeometry }
}
declare module 'jsts/org/locationtech/jts/io/GeoJSONWriter.js' {
  export default class GeoJSONWriter { write(value: JstsNetworkGeometry): unknown }
}
declare module 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js' {
  export default class OverlayOp { static intersection(a: JstsNetworkGeometry, b: JstsNetworkGeometry): JstsNetworkGeometry }
}
declare module 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js' {
  export default class IsValidOp { static isValid(value: JstsNetworkGeometry): boolean }
}
declare module 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js' {
  export default class InteriorPointArea { constructor(value: JstsNetworkGeometry); getInteriorPoint(): { x: number; y: number } | null }
}
interface JstsNetworkGeometry {
  isEmpty(): boolean;
  getGeometryType(): string;
  getNumGeometries(): number;
  getGeometryN(index: number): JstsNetworkGeometry;
}

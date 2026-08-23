import type { LngLat } from "./campaign";

export type GeometryValidation =
  | { valid: true }
  | { valid: false; reason: string };

const EPSILON = 1e-10;

function samePoint(a: LngLat, b: LngLat) {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

function pointInMapRange([lng, lat]: LngLat) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -85.0511 && lat <= 85.0511;
}

function orientation(a: LngLat, b: LngLat, c: LngLat) {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function onSegment(a: LngLat, b: LngLat, c: LngLat) {
  return (
    b[0] <= Math.max(a[0], c[0]) + EPSILON &&
    b[0] + EPSILON >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + EPSILON &&
    b[1] + EPSILON >= Math.min(a[1], c[1])
  );
}

function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (
    ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))
  ) {
    return true;
  }

  if (Math.abs(o1) <= EPSILON && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= EPSILON && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= EPSILON && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= EPSILON && onSegment(c, b, d)) return true;

  return false;
}

function hasSelfIntersection(vertices: LngLat[]) {
  const edgeCount = vertices.length;

  for (let i = 0; i < edgeCount; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % edgeCount];

    for (let j = i + 1; j < edgeCount; j += 1) {
      const c = vertices[j];
      const d = vertices[(j + 1) % edgeCount];

      const adjacent =
        i === j ||
        (i + 1) % edgeCount === j ||
        i === (j + 1) % edgeCount;

      if (adjacent) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }

  return false;
}

function signedArea(vertices: LngLat[]) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function validatePolygonVertices(vertices: LngLat[]): GeometryValidation {
  if (vertices.length < 3) {
    return { valid: false, reason: "Mindestens 3 Eckpunkte setzen." };
  }

  for (const point of vertices) {
    if (!pointInMapRange(point)) {
      return { valid: false, reason: "Das Gebiet enthält einen ungültigen Kartenpunkt." };
    }
  }

  const unique = new Set(vertices.map(([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)}`));
  if (unique.size < 3) {
    return { valid: false, reason: "Das Gebiet braucht 3 unterschiedliche Eckpunkte." };
  }

  for (let i = 0; i < vertices.length; i += 1) {
    if (samePoint(vertices[i], vertices[(i + 1) % vertices.length])) {
      return { valid: false, reason: "Zwei benachbarte Eckpunkte liegen übereinander." };
    }
  }

  if (Math.abs(signedArea(vertices)) < EPSILON) {
    return { valid: false, reason: "Das Gebiet hat keine nutzbare Fläche." };
  }

  if (hasSelfIntersection(vertices)) {
    return { valid: false, reason: "Die Gebietsgrenze darf sich nicht selbst kreuzen." };
  }

  return { valid: true };
}

export function validateLineStringVertices(vertices: LngLat[]): GeometryValidation {
  if (vertices.length < 2) {
    return { valid: false, reason: "Mindestens 2 Punkte entlang der Straße setzen." };
  }

  for (const point of vertices) {
    if (!pointInMapRange(point)) {
      return { valid: false, reason: "Die Straße enthält einen ungültigen Kartenpunkt." };
    }
  }

  for (let i = 0; i < vertices.length - 1; i += 1) {
    if (samePoint(vertices[i], vertices[i + 1])) {
      return { valid: false, reason: "Zwei aufeinanderfolgende Straßenpunkte liegen übereinander." };
    }
  }

  const unique = new Set(vertices.map(([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)}`));
  if (unique.size < 2) {
    return { valid: false, reason: "Die Straße braucht mindestens 2 unterschiedliche Punkte." };
  }

  return { valid: true };
}

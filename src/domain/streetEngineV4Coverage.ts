export type StreetEngineV4CoveragePoint = readonly [number, number];

export type StreetEngineV4CoveragePlan = {
  policy: 'grid-reserve-v1';
  bbox: readonly [number, number, number, number];
  bboxText: string;
  cellCount: number;
  gridCellDegrees: number;
  reserveCells: number;
  reserveDegrees: number;
};

export type StreetEngineV4CoverageOptions = {
  gridCellDegrees?: number;
  maxCells?: number;
  maxReserveDegrees?: number;
};

function finiteCoordinate(value: number, minimum: number, maximum: number, code: string) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(code);
  return value;
}

export function planStreetEngineV4Coverage(
  points: readonly StreetEngineV4CoveragePoint[],
  options: StreetEngineV4CoverageOptions = {},
): StreetEngineV4CoveragePlan {
  if (!points.length) throw new Error('street_engine_v4_beta_geometry_empty');

  const gridCellDegrees = options.gridCellDegrees ?? 0.01;
  const maxCells = options.maxCells ?? 4096;
  const maxReserveDegrees = options.maxReserveDegrees ?? 0.2;
  if (!(gridCellDegrees > 0) || !Number.isSafeInteger(maxCells) || maxCells <= 0 || maxReserveDegrees < 0) {
    throw new Error('street_engine_v4_coverage_policy_invalid');
  }

  const scale = 1 / gridCellDegrees;
  if (!Number.isSafeInteger(Math.round(scale)) || Math.abs(scale - Math.round(scale)) > 1e-9) {
    throw new Error('street_engine_v4_coverage_grid_invalid');
  }
  const integerScale = Math.round(scale);
  const maxReserveCells = Math.floor(maxReserveDegrees * integerScale + 1e-9);

  const longitudes = points.map(([lng]) =>
    finiteCoordinate(lng, -180, 180, 'street_engine_v4_beta_geometry_invalid'));
  const latitudes = points.map(([, lat]) =>
    finiteCoordinate(lat, -85, 85, 'street_engine_v4_beta_geometry_invalid'));

  const baseWest = Math.min(...longitudes);
  const baseEast = Math.max(...longitudes);
  const baseSouth = Math.min(...latitudes);
  const baseNorth = Math.max(...latitudes);

  const worldWest = -180 * integerScale;
  const worldEast = 180 * integerScale;
  const worldSouth = -85 * integerScale;
  const worldNorth = 85 * integerScale;

  let zeroReserveCells = 0;
  for (let reserveCells = maxReserveCells; reserveCells >= 0; reserveCells -= 1) {
    const westCell = Math.max(worldWest, Math.floor(baseWest * integerScale) - reserveCells);
    const eastCell = Math.min(worldEast, Math.ceil(baseEast * integerScale) + reserveCells);
    const southCell = Math.max(worldSouth, Math.floor(baseSouth * integerScale) - reserveCells);
    const northCell = Math.min(worldNorth, Math.ceil(baseNorth * integerScale) + reserveCells);
    const widthCells = Math.max(1, eastCell - westCell);
    const heightCells = Math.max(1, northCell - southCell);
    const cellCount = widthCells * heightCells;
    if (reserveCells === 0) zeroReserveCells = cellCount;
    if (cellCount > maxCells) continue;

    const bbox = [
      westCell / integerScale,
      southCell / integerScale,
      eastCell / integerScale,
      northCell / integerScale,
    ] as const;
    return {
      policy: 'grid-reserve-v1',
      bbox,
      bboxText: bbox.map((value) => value.toFixed(7)).join(','),
      cellCount,
      gridCellDegrees,
      reserveCells,
      reserveDegrees: reserveCells / integerScale,
    };
  }

  throw new Error(`street_engine_v4_beta_coverage_too_large:${zeroReserveCells}`);
}

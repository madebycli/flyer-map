export type BuildingRejectionReason = 'missing_nodes' | 'invalid_coordinate' | 'open_ring' | 'invalid_polygon';
export type PreparationQuality = {
  receivedBuildings: number;
  acceptedBuildings: number;
  rejectedBuildings: number;
  emptyBuildingTiles: number;
  samples: { osmId: number | null; tile: number; reason: BuildingRejectionReason }[];
};
export type PreparationFailureDetail = { phase: string; cursor: number; code: string; attempt: number };

export function preparationFailureMessage(code: string | undefined) {
  if (code === 'osm_normalization_no_trustworthy_buildings') return 'Die Gebäudedaten sind beschädigt. Es wurde keine neue Generation veröffentlicht.';
  if (code?.startsWith('osm_normalization_')) return 'Die Kartendaten konnten nicht sicher verarbeitet werden.';
  if (code?.includes('budget') || code === 'area_preparation_too_many_features') return 'Das Gebiet überschreitet eine Verarbeitungsgrenze. Ein erneuter Versuch mit denselben Daten löst das nicht.';
  if (code === 'overpass_rate_limited') return 'Der Kartendatenanbieter begrenzt die Anfragen. Bitte später erneut versuchen.';
  if (code === 'overpass_timeout') return 'Der Kartendatenanbieter hat nicht rechtzeitig geantwortet.';
  if (code === 'overpass_partial_failure') return 'Der Kartendatenanbieter hat eine unvollständige oder ungültige Antwort geliefert.';
  if (code === 'overpass_transport_error' || code?.startsWith('overpass_http_')) return 'Der Kartendatenanbieter ist derzeit nicht erreichbar.';
  return 'Die Vorbereitung konnte nicht abgeschlossen werden. Der gespeicherte Job bleibt für die Fehlerprüfung erhalten.';
}

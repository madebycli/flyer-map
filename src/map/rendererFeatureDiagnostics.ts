import type { Map } from 'maplibre-gl';

type FeatureDiagnosticGroup = {
  source: string;
  layers: readonly string[];
  idProperty: string;
  sourceCount: string;
  renderedCount: string;
};

/** Feature queries deserialize geometry. Keep them in the opt-in diagnostic path. */
export function updateRendererFeatureDiagnostics(
  map: Pick<Map, 'getSource' | 'getLayer' | 'querySourceFeatures' | 'queryRenderedFeatures'>,
  dataset: DOMStringMap,
  groups: readonly FeatureDiagnosticGroup[],
  enabled: boolean,
) {
  if (!enabled) return;
  for (const group of groups) {
    const source = map.getSource(group.source) ? map.querySourceFeatures(group.source) : [];
    const layers = group.layers.filter((layer) => map.getLayer(layer));
    const rendered = layers.length ? map.queryRenderedFeatures(undefined, { layers: [...layers] }) : [];
    const count = (features: typeof source) => new Set(features
      .map((feature) => feature.properties?.[group.idProperty])
      .filter((id) => typeof id === 'string')).size;
    dataset[group.sourceCount] = String(count(source));
    dataset[group.renderedCount] = String(count(rendered));
  }
}

from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file.write_text(text.replace(old, new))


replace_exact(
    'src/map/useNetworkWorkspace.tsx',
    "import { RoadIndex,networkRoutes,applyNetworkCoverage,type NetworkRoute,type RoadSnap } from '../domain/streetNetwork.ts';\n",
    "import { RoadIndex,networkRoutes,applyNetworkCoverage,type NetworkRoute,type RoadSnap } from '../domain/streetNetwork.ts';\nimport { SMART_POINT_FALLBACK_RADIUS_METERS,smartPointCandidates } from '../domain/smartStreetPointSelection.ts';\n",
)

replace_exact(
    'src/map/useNetworkWorkspace.tsx',
    "    const candidates=index.candidates(point).filter(snap=>!sourceIds.length||sourceIds.includes(snap.task.id));\n",
    "    const rawCandidates=index.candidates(point,sourceIds.length?45:SMART_POINT_FALLBACK_RADIUS_METERS);\n    const candidates=smartPointCandidates(rawCandidates,sourceIds);\n",
)

replace_exact(
    'src/map/MapView.tsx',
    '''        paint: {\n          "circle-color": [\n            "match",\n            ["get", "role"],\n            "start",\n            "#1f6b3a",\n            "end",\n            "#b42318",\n            "#2563eb",\n          ],\n          "circle-radius": 8,\n          "circle-stroke-color": "#ffffff",\n          "circle-stroke-width": 3,\n        },\n''',
    '''        paint: {\n          "circle-color": "#7c3aed",\n          "circle-radius": 8,\n          "circle-stroke-color": "#ffffff",\n          "circle-stroke-width": 3,\n        },\n''',
)

replace_exact(
    'src/map/MapView.tsx',
    '''  for (const layerId of [\n    SMART_ROAD_LAYER_ID,\n    SMART_ROAD_SELECTED_LAYER_ID,\n    SMART_PREVIEW_LAYER_ID,\n    SMART_POINT_LAYER_ID,\n    SMART_POINT_LABEL_LAYER_ID,\n  ]) {\n    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);\n  }\n''',
    '''  for (const layerId of [\n    SMART_ROAD_LAYER_ID,\n    SMART_ROAD_SELECTED_LAYER_ID,\n    SMART_PREVIEW_LAYER_ID,\n    SMART_POINT_LAYER_ID,\n  ]) {\n    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);\n  }\n  if (map.getLayer(SMART_POINT_LABEL_LAYER_ID)) {\n    map.setLayoutProperty(SMART_POINT_LABEL_LAYER_ID, "visibility", "none");\n  }\n''',
)

replace_exact(
    'src/map/MapView.tsx',
    '''        if (interaction.mode === "smart-street") {\n          const smartLayers = [SMART_ROAD_LAYER_ID, SMART_ROAD_SELECTED_LAYER_ID].filter(\n            (layerId) => map.getLayer(layerId),\n          );\n          const bbox: [[number, number], [number, number]] = [\n            [event.point.x - 10, event.point.y - 10],\n            [event.point.x + 10, event.point.y + 10],\n          ];\n          const smartFeatures = smartLayers.length > 0\n            ? map.queryRenderedFeatures(bbox, { layers: smartLayers })\n            : [];\n          const sourceIds = [...new Set(\n            smartFeatures\n              .map((feature) => feature.properties?.sourceId)\n              .filter((sourceId): sourceId is string => typeof sourceId === "string"),\n          )];\n          interaction.onSmartStreetPoint(lngLat, sourceIds);\n          return;\n        }\n''',
    '''        if (interaction.mode === "smart-street") {\n          // Reuse the already-rendered StreetEngine street layers as the precise\n          // pointer hit-test. Routing stays in RoadIndex, so we keep the large\n          // Smart candidate overlay empty without sacrificing tap precision.\n          const streetLayers = STREET_LAYER_IDS.filter((layerId) => map.getLayer(layerId));\n          const bbox: [[number, number], [number, number]] = [\n            [event.point.x - 12, event.point.y - 12],\n            [event.point.x + 12, event.point.y + 12],\n          ];\n          const streetFeatures = streetLayers.length > 0\n            ? map.queryRenderedFeatures(bbox, { layers: [...streetLayers] })\n            : [];\n          const sourceIds = [...new Set(\n            streetFeatures\n              .map((feature) => feature.properties?.taskId)\n              .filter((taskId): taskId is string => typeof taskId === "string"),\n          )];\n          interaction.onSmartStreetPoint(lngLat, sourceIds);\n          return;\n        }\n''',
)

replace_exact(
    'tests/smartStreetRuntime.test.ts',
    '''  assert.match(map, /map\\.queryRenderedFeatures\\(bbox, \\{ layers: smartLayers \\}\\)/u);\n  assert.match(map, /interaction\\.onSmartStreetPoint\\(lngLat, sourceIds\\)/u);\n''',
    '''  assert.match(map, /const streetLayers = STREET_LAYER_IDS\\.filter/u);\n  assert.match(map, /map\\.queryRenderedFeatures\\(bbox, \\{ layers: \\[\\.\\.\\.streetLayers\\] \\}\\)/u);\n  assert.match(map, /feature\\.properties\\?\\.taskId/u);\n  assert.match(map, /interaction\\.onSmartStreetPoint\\(lngLat, sourceIds\\)/u);\n  assert.match(map, /"circle-color": "#7c3aed"/u);\n  assert.match(map, /"circle-stroke-color": "#ffffff"/u);\n  assert.match(map, /SMART_POINT_LABEL_LAYER_ID, "visibility", "none"/u);\n''',
)

print('Smart Marking precision patch applied')

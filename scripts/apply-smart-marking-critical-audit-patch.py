from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file.write_text(text.replace(old, new))


replace_exact(
    'src/domain/smartStreetPointSelection.ts',
    "export const SMART_POINT_AMBIGUITY_METERS = 3;\n",
    "export const SMART_POINT_AMBIGUITY_METERS = 0.5;\n",
)

replace_exact(
    'src/domain/smartStreetPointSelection.ts',
    "  sourceIds: readonly string[],\n): RoadSnap[] {\n  const sourceSet = sourceIds.length > 0 ? new Set(sourceIds) : null;\n  const eligible = candidates\n    .filter((candidate) => sourceSet ? sourceSet.has(candidate.task.id) : candidate.distance <= SMART_POINT_FALLBACK_RADIUS_METERS)\n",
    "  sourceIds: readonly string[],\n  selectableTaskIds: ReadonlySet<string> | null = null,\n): RoadSnap[] {\n  const sourceSet = sourceIds.length > 0 ? new Set(sourceIds) : null;\n  const eligible = candidates\n    .filter((candidate) => {\n      if (selectableTaskIds && !selectableTaskIds.has(candidate.task.id)) return false;\n      return sourceSet ? sourceSet.has(candidate.task.id) : candidate.distance <= SMART_POINT_FALLBACK_RADIUS_METERS;\n    })\n",
)

replace_exact(
    'src/map/useNetworkWorkspace.tsx',
    "  const index=useMemo(()=>new RoadIndex(tasks),[tasks]);\n",
    "  const index=useMemo(()=>new RoadIndex(tasks),[tasks]);\n  const selectableTaskIds=useMemo(()=>new Set(screening.tasks.map(task=>task.id)),[screening.tasks]);\n",
)

replace_exact(
    'src/map/useNetworkWorkspace.tsx',
    "    const candidates=smartPointCandidates(rawCandidates,sourceIds);\n",
    "    const candidates=smartPointCandidates(rawCandidates,sourceIds,selectableTaskIds);\n",
)

replace_exact(
    'src/map/MapView.tsx',
    '''        paint: {\n          "circle-color": "#7c3aed",\n          "circle-radius": 8,\n          "circle-stroke-color": "#ffffff",\n          "circle-stroke-width": 3,\n        },\n''',
    '''        paint: {\n          "circle-color": "#7c3aed",\n          "circle-radius": 9,\n          "circle-stroke-color": "#ffffff",\n          "circle-stroke-width": 3.5,\n        },\n''',
)

replace_exact(
    'src/map/MapView.tsx',
    '''        if (interaction.mode === "smart-street") {\n          // Reuse the already-rendered StreetEngine street layers as the precise\n          // pointer hit-test. Routing stays in RoadIndex, so we keep the large\n          // Smart candidate overlay empty without sacrificing tap precision.\n          const streetLayers = STREET_LAYER_IDS.filter((layerId) => map.getLayer(layerId));\n          const bbox: [[number, number], [number, number]] = [\n            [event.point.x - 12, event.point.y - 12],\n            [event.point.x + 12, event.point.y + 12],\n          ];\n          const streetFeatures = streetLayers.length > 0\n            ? map.queryRenderedFeatures(bbox, { layers: [...streetLayers] })\n            : [];\n          const sourceIds = [...new Set(\n            streetFeatures\n              .map((feature) => feature.properties?.taskId)\n              .filter((taskId): taskId is string => typeof taskId === "string"),\n          )];\n          interaction.onSmartStreetPoint(lngLat, sourceIds);\n          return;\n        }\n''',
    '''        if (interaction.mode === "smart-street") {\n          // Preserve pointer intent: an exact rendered-line hit wins. Only when\n          // the pointer misses every visible line do we widen to a touch-friendly\n          // box. RoadIndex still performs the exact geometric snap and routing.\n          const streetLayers = STREET_LAYER_IDS.filter((layerId) => map.getLayer(layerId));\n          const exactStreetFeatures = streetLayers.length > 0\n            ? map.queryRenderedFeatures(event.point, { layers: [...streetLayers] })\n            : [];\n          const bbox: [[number, number], [number, number]] = [\n            [event.point.x - 12, event.point.y - 12],\n            [event.point.x + 12, event.point.y + 12],\n          ];\n          const streetFeatures = exactStreetFeatures.length > 0\n            ? exactStreetFeatures\n            : streetLayers.length > 0\n              ? map.queryRenderedFeatures(bbox, { layers: [...streetLayers] })\n              : [];\n          const sourceIds = [...new Set(\n            streetFeatures\n              .map((feature) => feature.properties?.taskId)\n              .filter((taskId): taskId is string => typeof taskId === "string"),\n          )];\n          interaction.onSmartStreetPoint(lngLat, sourceIds);\n          return;\n        }\n''',
)

replace_exact(
    'tests/smartStreetRuntime.test.ts',
    '''  assert.match(map, /const streetLayers = STREET_LAYER_IDS\\.filter/u);\n  assert.match(map, /map\\.queryRenderedFeatures\\(bbox, \\{ layers: \\[\\.\\.\\.streetLayers\\] \\}\\)/u);\n  assert.match(map, /feature\\.properties\\?\\.taskId/u);\n''',
    '''  assert.match(map, /const streetLayers = STREET_LAYER_IDS\\.filter/u);\n  assert.match(map, /map\\.queryRenderedFeatures\\(event\\.point, \\{ layers: \\[\\.\\.\\.streetLayers\\] \\}\\)/u);\n  assert.match(map, /exactStreetFeatures\\.length > 0/u);\n  assert.match(map, /map\\.queryRenderedFeatures\\(bbox, \\{ layers: \\[\\.\\.\\.streetLayers\\] \\}\\)/u);\n  assert.match(map, /feature\\.properties\\?\\.taskId/u);\n''',
)

replace_exact(
    'tests/smartStreetRuntime.test.ts',
    '''  assert.match(map, /"circle-color": "#7c3aed"/u);\n  assert.match(map, /"circle-stroke-color": "#ffffff"/u);\n''',
    '''  assert.match(map, /"circle-color": "#7c3aed"/u);\n  assert.match(map, /"circle-radius": 9/u);\n  assert.match(map, /"circle-stroke-color": "#ffffff"/u);\n  assert.match(map, /"circle-stroke-width": 3\\.5/u);\n  assert.match(map, /streetDraftVertices[\\s\\S]*radius=\\{9\\}/u);\n''',
)

selection_test = Path('tests/smartStreetPointSelection.test.ts')
selection_text = selection_test.read_text()
addition = '''\n\ntest('rendered neighboring roads cannot steal a fine tap outside the half-meter tie window', () => {\n  const result = smartPointCandidates([\n    snap('tapped-side-street', 0.15),\n    snap('nearby-shorter-route', 0.66),\n  ], ['tapped-side-street', 'nearby-shorter-route']);\n  assert.deepEqual(result.map((candidate) => candidate.task.id), ['tapped-side-street']);\n});\n\ntest('fallback cannot select a street hidden by the current screening mode', () => {\n  const result = smartPointCandidates([\n    snap('hidden', 0.1),\n    snap('visible', 0.2),\n  ], [], new Set(['visible']));\n  assert.deepEqual(result.map((candidate) => candidate.task.id), ['visible']);\n});\n'''
if "rendered neighboring roads cannot steal" in selection_text:
    raise SystemExit('selection tests already patched')
selection_test.write_text(selection_text + addition)

replace_exact(
    'docs/plans/active/041-smart-marking-precision-visible-vertices.md',
    "2. In Smart Street mode, hit-test the already-rendered normal street layers around the pointer and pass their `taskId`s to Smart Marking.\n",
    "2. In Smart Street mode, hit-test the exact pointer against already-rendered normal street layers first; only if there is no exact hit, use the touch-sized fallback box and pass its `taskId`s to Smart Marking.\n",
)
replace_exact(
    'docs/plans/active/041-smart-marking-precision-visible-vertices.md',
    "5. In every case, only candidates within 3 m of the nearest spatial candidate may compete on route length. This preserves crossing disambiguation while preventing a farther road from winning only because its route is shorter.\n6. Render all accepted Smart points as purple circles (`#7c3aed`) with a white 3 px outline. Hide text labels so the interaction matches manual area/street vertices.\n",
    "5. In every case, only candidates within 0.5 m of the nearest spatial candidate may compete on route length. This keeps true crossing ties routable while making pointer position dominant everywhere else. Hidden Screening-V2 tasks are not eligible as fallback tap targets.\n6. Render all accepted Smart points as purple circles (`#7c3aed`) with radius 9 and a white 3.5 px outline, exactly matching the normal manual area/street vertex geometry. Hide text labels.\n",
)
replace_exact(
    'docs/plans/active/041-smart-marking-precision-visible-vertices.md',
    "- A candidate more than 3 m farther than the nearest tap candidate cannot win only because it gives a shorter route.\n",
    "- A candidate more than 0.5 m farther than the nearest tap candidate cannot win only because it gives a shorter route.\n- An exact rendered-line hit wins before the wider touch fallback is considered.\n- Screening-hidden streets cannot become invisible fallback tap targets.\n",
)

print('Smart Marking critical-audit patch applied')

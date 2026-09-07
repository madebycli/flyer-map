---
id: plan-026-smart-street-edit-after-mission
type: plan
status: proposed
last_updated: 2026-09-02
related: [ADR-0023, ADR-0021, ADR-0013, plan-smart-street-runtime, plan-auto-area-task-preparation, map, offline-sync, security, quality]
source_of_truth_for: [post-mission-automatic-street-edit]
---

# Plan 026: Straßen bearbeiten nach der automatischen Markierung

## Entscheidung und Auslöser

Nach der Distribution-Mission darf die automatische Area-Vorbereitung erst durch eine
eigene, dokumentierte Release-Entscheidung wieder aktiviert werden. Bis dahin bleibt
`AUTO_AREA_PREPARATION_ENABLED = false` und der heutige manuelle Street-Flow maßgeblich.
Dieser Plan ist deshalb eine umsetzungsreife Folgearbeit, kein versteckter Schalter.

Sobald automatische Streets für eine Area erfolgreich als `ready` vorliegen, ersetzt der
grüne primäre Plus-Button für berechtigte Personen den Text **„Straßen bearbeiten“**.
Bei Areas ohne bereitgestellte automatische Streets bleibt er **„Straße manuell
hinzufügen“**. Der manuelle Flow bleibt außerdem als sekundäre Aktion im Area-Sheet
erreichbar, damit ein fehlendes OSM-Ergebnis nie die Feldarbeit blockiert.

## Gewählter Produktfluss

1. Die Person wählt eine bereitgestellte Area, falls mehrere editierbare Areas offen sind.
2. Ein Tipp auf „Straßen bearbeiten“ startet den vorhandenen normalen
   Smart-Street-Map-Mode, nicht M6-Preview- oder Mock-Code.
3. Die MapLibre-Karte zeigt nur reale Kandidaten. Die Person tippt Start und Ende auf
   derselben oder verbundenen Straße.
4. Die bestehende Snap-/Routing-Logik bildet die geprüfte Route zwischen beiden Punkten
   und hebt genau diesen LineString sichtbar hervor. Mehrdeutige Routen bleiben eine
   explizite Auswahl, nicht eine geratenen Änderung.
5. Die Review-Sheet zeigt alte Street, neue hervorgehobene Strecke und einen klaren
   **„Änderung speichern“**-Button. Abbrechen ändert nichts.
6. Erst die Bestätigung schickt eine einzige idempotente M5-Mutation. Nach dem
   Server-Ack wird die gleiche Task-ID mit der neuen geprüften Geometrie gerendert und
   auf anderen Geräten synchronisiert.

Der Button ist bewusst kein globaler Schalter für automatische Vorbereitung. Er ist eine
Bearbeitungsaktion innerhalb einer bereits vorbereiteten Area.

## Persistenzentscheidung: expliziter Smart-Override statt Duplikat

Die automatisch erzeugte Street wird nicht still gelöscht und es entsteht keine zweite,
zählbare Parallel-Street. Stattdessen ergänzt die vorhandene Task-ID einen kontrollierten
`streetOverride`-Nachweis. Dieser bewahrt die ursprüngliche OSM-Provenance und macht die
neue Auswahl nachvollziehbar:

```ts
type StreetOverride = {
  kind: "smart-street-edit";
  originalGeometry: LineString;
  originalSource: SmartTaskSource;
  editedAt: string;
  editedByGrantId: string;
};

type DistributionTask = {
  // bestehende Felder
  geometry: LineString;
  source?: SmartTaskSource;
  streetOverride?: StreetOverride;
};
```

Die normale Bearbeitungs-Mutation darf Geometrie und OSM-Provenance weiter nicht ändern.
Nur die neue, eng geprüfte Mutation `task.smart-street-override` darf beides ersetzen und
muss die ursprünglichen Werte in `streetOverride` sichern. So bleiben Status, Kommentare,
Zuweisung und Fortschrittszählung an derselben App-Task erhalten, ohne doppelte Arbeit
oder unprüfbare Löschungen.

## Konkrete Code-Slices

| Slice | Dateien | Umsetzung |
| --- | --- | --- |
| Primäre Aktion | `src/platform/PlatformShell.tsx`, `src/App.tsx` | Label und Event `start-smart-street-edit`; Area-Auswahl wie beim manuellen Flow, aber nur für `ready` Areas. |
| Karteninteraktion | `src/App.tsx`, `src/map/MapView.tsx` | Bestehenden Smart-Street-Selection-State verwenden: Kandidat, Start, Ende, Alternativen, geprüfte Vorschau. Neue Preview-Layer-Farbe unterscheidet „Änderung“ von gespeichertem Street-Layer. |
| Reiner Domain-Builder | `src/domain/smartStreetEdit.ts` neu | Aus einer bereits validierten Route den Override-Payload bauen, ursprüngliche Geometry/Source erfassen, vollständige Linien-in-Area-Prüfung wiederholen. |
| M5-Vertrag | `src/domain/mutations.ts`, `worker/mutationHandler.ts`, Snapshot-Validierung | Mutation nur für eine existierende automatische Street derselben Area. Server prüft Aufgabe, Rolle, `ready`-Generation, vollständige Geometrie, OSM-Way-Provenance und Konfliktbasis. |
| Synchronisation | `src/data/campaignStore.ts` | Keine neue Queue: `task.smart-street-override` wird mit vorhandener Mutation-ID, Retry, Conflict-UI und Field-Group-Kontext versendet. |
| Audit/Anzeige | Task-Sheet, Fortschritt, Activity-Mapper | „Automatisch korrigiert“ und Original-Provenance sind sichtbar. Die Task wird nur einmal gezählt. |

Der zentrale Builder bleibt klein und testbar:

```ts
export function buildSmartStreetOverride(input: {
  task: DistributionTask;
  selected: SmartStreetSelection;
  area: Area;
  actorGrantId: string;
  now: string;
}): CampaignMutation {
  assertAutomaticStreetInArea(input.task, input.area);
  const route = verifiedSelectionLine(input.selected);
  if (!lineStringIsFullyInsideOrOnPolygon(route, input.area.geometry)) {
    throw new Error("street_outside_area");
  }
  return {
    type: "task.smart-street-override",
    payload: {
      taskId: input.task.id,
      geometry: route,
      source: selectedOsmProvenance(input.selected),
      streetOverride: {
        kind: "smart-street-edit",
        originalGeometry: input.task.geometry,
        originalSource: input.task.source,
        editedAt: input.now,
        editedByGrantId: input.actorGrantId,
      },
    },
  };
}
```

Die endgültigen Typnamen richten sich nach dem dann aktuellen Mutation-Union-Typ. Die
Sicherheitsinvarianten und die eine Mutation sind verbindlich.

## Server-Schutz und Sonderfälle

- Nur Admins und Team-Editoren der Area dürfen die Mutation ausführen.
- Ein Client darf weder `streetOverride` noch `editedByGrantId` frei behaupten. Der
  Worker setzt Actor-Information aus dem autorisierten Zugriff und verwirft unbekannte
  verschachtelte Felder.
- Die neue Linie muss vollständig innerhalb oder auf der Area-Grenze liegen. Das wird
  im Browser für schnelle Rückmeldung und im Worker als Autoritätsgrenze geprüft.
- Eine bereits überschriebene Street kann nur nach einer expliziten Review erneut
  überschrieben werden. Das vorherige Override wird in der Activity-Historie referenziert,
  nicht still ersetzt.
- Ist die Area nicht `ready`, ist keine OSM-Kandidatenquelle verfügbar oder ist der
  Server nicht erreichbar, bleibt der Button beim manuellen Fallback. Es gibt keine
  generische Retry-Schleife und keine lokale Fantasie-Geometrie.
- Ein Conflict zeigt die aktuelle Street und zwingt die Person zur erneuten Auswahl;
  die Queue überschreibt keinen zwischenzeitlichen Override.

## Abnahme und Tests

1. Button-Semantik für manuelle, pending, failed und ready Areas sowie mehrere Areas.
2. MapLibre-Hit-Test, Snap, Start/Ende, Route-Mehrdeutigkeit und sichtbare Highlight-
   Linie zwischen den zwei Punkten.
3. Reiner Builder: vollständige Area-Containment-Prüfung, ursprüngliche Provenance,
   keine zweite Task-ID und keine Änderung ohne Bestätigung.
4. Worker: Viewer/anderes Team abgelehnt, forged Actor/provenance abgelehnt,
   Linie außerhalb abgelehnt, automatische Task-ID erforderlich, idempotente Wiederholung.
5. M5: Offline-Queue, 409-Conflict, zweites Gerät und Wiederanmeldung nach Queue-Block.
6. Progress/Activity: eine Street bleibt eine Street; ursprüngliche automatische Auswahl
   und bestätigte Korrektur sind nachvollziehbar.
7. Android Chromium und iPhone Safari: Zwei-Punkt-Auswahl, QR/Area-Sheet-Rückweg,
   Touch-Ziele, Safe Areas und WebGL-Sichtbarkeit.

## Nicht-Ziele

- Keine Reaktivierung der automatischen Vorbereitung in diesem Plan ohne gesondertes
  Release-Gate.
- Kein stilles Neu-Generieren oder Löschen automatischer Tasks.
- Keine neue Kartenengine, kein M6-Preview-Produktpfad, keine lokale Routing-API und
  keine serverseitig erfundene Route.
- Keine Bearbeitung von House-Tasks in diesem Slice.

## Reihenfolge nach der Mission

1. Mission-Feature-Freeze und reale Geräteevidence abschließen.
2. ADR-0023-Missions-Override bewusst aufheben und die automatische Vorbereitung in
   einer eigenen Änderung mit D1/Preview-Gate wieder aktivieren.
3. Erst danach die oben beschriebenen UI-, Domain-, Worker- und Test-Slices in einer
   separaten Draft-PR implementieren.
4. Preview, zwei Geräte und die sieben Abnahmegruppen prüfen, dann erst bereitstellen.

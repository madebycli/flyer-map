# StreetEngine-Handoff

Stand 2026-09-13. Repository `madebycli/flyer-map`, Branch `fix/street-engine-smart-marking`, Draft PR92 offen/unmerged. Base `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`; main zuletzt `ebc082bcaa1062215ca63a8f2c99a667418f5975`.

## Verifizierte Checkpoints

| Checkpoint | SHA / Evidence |
|---|---|
| Freeze | `b126e70899ad5a5c206d8c3ed0fa1fe7b34766fe` |
| Evidence-Freeze-Dokument | `5fc71184982f8f19903514709bfea7ee84d6f15a` |
| D1-Gate | `37576f8a2d390ec6de056ebc9442dca0803b8027` |
| Audit und synthetische Messung | `102b29fade760e916714531f4f22fa22a3d42a50` |
| ADR-0031 | `9af307c5262b57ae7a441ebd0964fdb08093ca4e` |
| Plan035 | `6f16fab93116da92b00b29012c52b9ec5d58e46b` |
| Quellqualität und Diagnose | `3ad3fc755bbdcfa03a1b1110312a0f3ab198af31`, [CI34720417354](https://github.com/madebycli/flyer-map/actions/runs/34720417354), Job103625130098, 887/887 Tests, Typecheck, Audit, Build erfolgreich |
| Master-Context-Audit/ADR/Plan | `ba574eef32a03a0d473a5c608e98dfbc7472a7e1` |
| Smart-Marking-Plan036 | `f85abd45fa534745cd6abb25c002bbc88cf9290b` |

Smart-Marking-Runtime `4c2d01e2a0a873c9c233e525e50f20148c648bda`, [CI34761931839](https://github.com/madebycli/flyer-map/actions/runs/34761931839), Job `103736181142`: 894/894 Tests, Typecheck7, Dependency Audit und Build erfolgreich. Lokal 893/894, ausschließlich Sandbox-Socket-EPERM; TS5.9.3 und Build grün, TS7-Start lokal blockiert. Alle 21 geänderten Dateien wurden nach dem Remote-Commit inhaltlich zurückgelesen; anschließender git-fetch-Abgleich ist sauber. [Lokale Smart-Evidence](../verification/2026-09-13-smart-marking.md), [Plan036](../plans/active/036-smart-marking-waypoints.md), [Gesamtplan035](../plans/active/035-street-engine-masterplan.md).

## Gelöst und weiterhin offen

Der bereits zuvor behobene Prepared-Area-Delete lädt keinen vollen House-/Task-Snapshot mehr. Lokale RxDB-/DO-/Delete-Regressionen sichern dies. Kein neuer Delete-Fix. `AREA_DELETE_READ_PATH=VERIFIED_FIXED`; `D1_STATUS=OPEN` ausschließlich für den gemessenen wiederholten Vollgraph-Read in Link-Schritten. Keine Zuordnung der gemeldeten 4,5M billable Rows ohne echte Zeitfenster/Metriken.

P1 verhindert stillen Leer-Erfolg bei ausschließlich defekten Buildings, behandelt null Nodes korrekt und persistiert sichere Provider-/Phasen-/Cursor-/Qualitätsdiagnose. Der konkrete Liveabbruch bei Buildings cursor0 ist damit noch nicht kausal zugeordnet. Sanitierter aktueller Job und zugehöriger Deployment-SHA fehlen.

ADR-0031 vergleicht vier Computevarianten mit Gesamtgewicht100: Server4,23, alle Endgeräte2,49, Clientabsicht/Serververifikation3,38, fähiger Operator3,68. Entscheidung: server-first und serverseitiger Publish, Operator nur bei gemessenem Gesamtnutzen. Keine neue Plattform oder bezahlte Quelle.

Synthetisch 0/399/1k/5k/10k durchgeführt. 20k mit zwei Tiles scheitert am bestehenden 10k-Limit, nicht bestanden. Pause/Resume-API, kalter Graphcache-/Partitionierungsnachweis, vollständiger Geometrie-/Kommentar-/Archiv-Erhalt und reale Mehrclient-/Renderer-Abnahme bleiben in Plan035.

Smart Marking erweitert den Distribution-Adapter um echte Zwischenziele, Undo, vollständige Vorschau und atomare Statusabsicht mit Zustandsschutz. Alte noch ungespeicherte A/B-Intents benötigen neue Auswahl. Gespeicherte Alt-Replays bleiben gültig. Gemeinsames zukünftiges Collection-Verhalten ist geplant, der Abholservice und Collection-Domain wurden nicht erweitert.

## Nächster kleinster Schritt

Die Kandidaten-CI ist grün. Als Nächstes einen sanitisierten bestehenden fehlgeschlagenen Job mitsamt Runtime-SHA/Fehlerzeit bereitstellen oder lesen, sofern ein autorisierter Zugang vorliegt. Dann eine kleine klar benannte Staging-Area mit begrenztem Budget, sichtbare Punkte/Area/Straßen/Häuser, Reload, Zweitclient, Offline-Reconnect und Delete nachweisen. Keine 5k/10k/20k-Livequelle zum Diagnostizieren verwenden. Bei fehlendem Gerät/Jobzugang an diesem Evidence-Gate stoppen.

`STREET_ENGINE_LIVE_READY=FALSE` · `D1_ATTRIBUTION_CONFIRMED=FALSE` · `MAP_RENDER_P0=OPEN`.

Kein Merge, Force-Push, Production-Deploy, Remote-D1-Read/Write/Migration, Secretwechsel, Paid-Provider oder Abholservice-Aufbau. Alle berichteten Messwerte sind getrennte lokale Größen, keine Cloudflare-Abrechnung.

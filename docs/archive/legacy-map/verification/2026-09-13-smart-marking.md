# Smart-Marking-Evidence, 2026-09-13

Basis `3ad3fc755bbdcfa03a1b1110312a0f3ab198af31`, Plan-Checkpoint `f85abd45fa534745cd6abb25c002bbc88cf9290b`. Branch `fix/street-engine-smart-marking`, Draft PR92. Dies ist lokale Evidence des anschließend committeten Kandidaten; die exakte CI-Zuordnung steht im [Handoff](../status/STREET_ENGINE_MASTERPLAN_HANDOFF.md).

## Reproduktion und Ergebnis

Drei rote Regressionen vor Codeänderung: Punkt 3 ersetzt A/B, veralteter anderer Intent wird mit HTTP200 geschrieben, widersprüchliche Address-Node-ID wirft keinen Fehler. Danach grün.

Neue/erweiterte Verhaltenstests sichern:

- Sechs Punkte mit bewusstem Zurücklaufen, vier Zwischenmarkern und fünf Legs, Gesamtlänge größer als zweimal die direkte Straße. Undo, Reset, Cancel und ungeklärter Tipp behalten nachvollziehbare Punkte. Keine Statusfreigabe bei ungeklärter Auswahl.
- Zwei Ringrouten: explizite Auswahl des zweiten Wegs, dritter Punkt erst nach Auflösung; der gewählte frühere Weg bleibt beim Erweitern und Undo identisch.
- IndexedDB/React-Neumount restauriert die vollständige optimistische Coverage. Der Intent enthält alle Zwischenziele und Pfade.
- API rechnet alle fünf Legs nach; JSON-Roundtrip verändert die Absicht nicht. Manipulierter Zwischenpunkt und Feedfehler hinterlassen keine Teiländerung. Erfolg erhöht die Revision genau einmal, Replay schreibt nicht erneut.
- Veralteter Straßenstand eines zweiten Clients liefert 409 ohne Datenänderung. Ein neuer Zustandshash ist keine automatische Erlaubnis zum Rebasen: Die Auswahlbasis bleibt während der Bedienung eingefroren.
- Legacy-Intents ohne Zustandsschutz sind nur noch als bereits gespeicherter Replay zulässig. Neue alte Queueeinträge werden sichtbar blockiert; keine automatische Löschung.
- Maximal 32 Punkte, 500 ausgewählte Arcs und 32.000 Requestbytes. Fehlerhafte Pfadanzahl und Zustandsbelege werden abgewiesen.
- Exaktes 0–10/20–40 + 8–25-Prozent-Beispiel, Rückwärtsrichtung, Wiederöffnen und Zusammenführen. Teilmarkierung bleibt Gesamtstatus offen.
- Adresslose Gebäude einschließlich Garagen/Schuppen/Nebengebäude erzeugen keine Hausaufgabe. Widersprüchliche wiederholte Address-Node-IDs brechen die Adressphase ab; identische Kachel-Duplikate bleiben dedupliziert.

Die bestehende D1-/DO-10k-Budgetregression verwendet jetzt denselben Zustandsschutz. Der Vergleich braucht keine zusätzliche D1-Abfrage; er verarbeitet die bereits geladene Area. D1-Billingwerte wurden nicht gemessen.

## Lokale Prüfungen

Fokussierter Street/House/Recovery-Lauf: 32/32 vor zwei zusätzlichen Vertrag-/Ringtests. Vollsuite danach: 894 Tests, zunächst 892 grün; ein veralteter UI-Chrome-Stringtest und die bekannte Sandbox-Socketgrenze. Der Header behält nun den festen Street-Mode-Kicker, der Punktezähler steht daneben; gezielter UI-Nachlauf 8/8 grün. Abschließende Vollsuite: 894 Tests, 893 bestanden, ausschließlich der bekannte Unix-Socket-EPERM im Zweitab-Leader-Test bleibt lokal blockiert. Exakte CI im Handoff prüfen.

Build erfolgreich. Dependency Audit erfolgreich mit der bestehenden MapLibre-5.7.1-Ausnahme GHSA-jrc7-96c5-q579, nicht advisory-frei. Nativer TypeScript7-Prozess scheitert lokal an `readlink /proc/self/exe`; TypeScript5.9.3 `--noEmit` ist grün. Exakte GitHub-CI für `4c2d01e2a0a873c9c233e525e50f20148c648bda`: Run34761931839, Job103736181142, 894/894 Tests sowie Typecheck7, Audit und Build erfolgreich. Dies beseitigt die lokale Sandbox-Evidence-Lücke für die Projekt-Gates; es ersetzt keine Geräteabnahme.

## Praktische Grenzen

Keine Staging-/Geräte-/WebGL-Sichtbarkeitsbehauptung. Die vorhandenen MapLibre-Layer mit weißem Rand erhalten jetzt alle Punkte; tatsächlich sichtbares Rendering auf iPad/iPhone/Android bleibt P0. Hausfortschritt und Straßenabdeckung sind getrennte Größen gemäß ADR-0027: individuelle Hausausnahmen werden nicht durch Straße-offen/später überschrieben. Die Straßen-Detailansicht zeigt den längengewichteten Anteil und die gespeicherten Prozentintervalle; der Area-Hauszähler verwendet nun denselben optimistischen Stand wie die Prozentzahl.

Der Zustandsschutz ist konservativ pro betroffener Straße. Auch ein fremder nicht überlappender Statuswechsel derselben Straße verlangt neue Auswahl. Clients sehen wartende Änderungen als vorgemerkt; bis zur Serverprüfung ist dies keine bestätigte gemeinsame Arbeit. Die Queue stoppt an einem Konflikt. Collection-Adapter, Live-Abnahme, echter Browser-Reload und unabhängige Geräte bleiben offen. Keine Collection-Objekte oder -Statusfelder geändert.

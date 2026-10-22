---
status: Entwurf zur Entscheidung des Eigentümers
supersedes_parts_of: 059-flyermap-rs.md (M4 "Rest", M7)
---

# Plan 060: flyermap-rs neu gedacht, nicht nur portiert

Auftrag des Eigentümers: Rust soll es **besser** machen (Verarbeitung, Architektur), nicht nur dasselbe wie TypeScript. Dieser Plan sagt ehrlich, was bisher neu gedacht ist, was bewusst 1:1 blieb, und was als Nächstes wirklich anders werden soll.

## 1. Bilanz

**Neu gedacht (gebaut):**
- Sync als Zustandsmaschine ohne I/O (`flyermap-sync`): Ereignisse rein, Aktionen raus; 300-Seed-Konvergenztest. Der Server, die Geräte und die Tests benutzen dieselbe Logik.
- Diagnose als Baustein von Anfang an (`flyermap-diag`), Rechte als reine Funktionen (`flyermap-rights`), ein Worker, der nicht an Cloudflare hängt (`Db`-Trait: SQLite nativ, D1 im Worker).
- Schichtung der Crates, Dateigrenzen, Golden-Vektoren statt Handprüfung.
- Verbundenes Zeichnen von Gebieten (`flyermap-area`): gab es vorher gar nicht.

**Bewusst 1:1 (Sicherheitsnetz, nicht Endziel):** `/api/v5` im Worker, Engine, Store. Grund: Daten und Geräte im Feld bleiben kompatibel, und die Weiche kann Stück für Stück umschalten. Das ist die Basis, auf der neu gebaut wird, nicht das Ziel.

**Zu Unrecht 1:1 geplant:** die Basis- und Außenschicht des Workers (alles außerhalb von `/api/v5`). Befund aus dem Code: mindestens fünf getrennte Sitzungsarten (`campaign_sessions`, `campaign_admin_sessions`, `collection_collector_sessions`, `field_sessions`, `organization_account_sessions`), dazu Geräte-Vertrauen, Einladungen, Delegation, und vier Pflaster-Dateien (`organizationLegacyGuard`, `organizationApiFallback`, `organizationRememberBridge`, `campaignAdminRememberBridge`). Das nach Rust zu übersetzen hieße, die Altlast mitzunehmen. `CampaignSyncDurableObject` ist ein Rumpf (kein Live-Sync). Die Agenten dafür wurden gestoppt.

## 2. Was wirklich anders werden soll (nach Nutzen sortiert)

### A. Eine Identität, ein Rechtemodell (Vorrang)
- Heute: fünf Sitzungsarten, Rechte verteilt auf SQL-Klauseln, Guards und Wrapper. Eigentümer-Wunsch seit Plan 057: bessere Berechtigung und Verwaltung.
- Neu: `Principal` (Person oder Gast) + `Membership` (Rolle in Aktion/Organisation, optional auf Gebiete begrenzt) + `Session` (eine Art, mit Gerät) + `Grant` (Link/QR/Kurzcode, ablaufend, widerrufbar). Eine Funktion `decide(caller, aktion, ressource)` in `flyermap-rights`; der SQL-Filter für „welche Gebiete darf ich lesen" wird **aus derselben Regel erzeugt**, und ein Eigenschaftstest beweist, dass beide übereinstimmen (heute stehen die Regeln doppelt: `writes_allowed` und `readable_areas`).
- Dazu: Audit-Log für jede Rechteänderung, Passkeys (WebAuthn) zusätzlich zu Passwort, kurze Beitrittscodes.
- Altdaten: Adapter liest die alten Tabellen und Cookies weiter (bestehende Passwort-Hashes bleiben gültig). Neue Tabellen nur auf Unstable-D1; Produktion nur mit Freigabe.

### B. Kartendaten einmal ableiten, nicht auf jedem Gerät
- Heute: Gerät lädt rohes OSM (gzip-JSON), leitet Straßen/Häuser selbst ab (51k Häuser ≈ 0,5 s), prüft per ETag erneut.
- Neu: die Ableitung läuft **einmal** auf dem Server (dieselbe Engine als Wasm), Ergebnis binär (bincode, bereits in der Engine) und **nach Inhalt adressiert** (Hash in der URL, unveränderlich, ewig cachebar). Geräte laden nur noch das Fertige; Updates als Unterschied zur Vorversion. Weniger Rechenzeit und Akku im Feld, keine Revalidierung.
- **Stand (2026-10-22), gebaut in `flyermap-pack::derived`:** `derive_pack` (Kopf mit Prüfsumme + gzip(bincode(Network))), Name `d/<Hash der Nutzlast>`, `verify` (beschädigt, abgeschnitten, fremde Engine, neueres Format werden abgelehnt), `load_into` (Gerätepfad in eine Engine-Sitzung), `diff`/`apply` (Delta `x/<alt>/<neu>`, beide Enden per Hash geprüft, bei mehr als 60 % des neuen Pakets wird stattdessen das Paket gesendet), `manifest` (`m/<Hash>`, die Teile eines großen Gebiets). Tests (`tests/derived_*.rs`) halten ein geladenes Paket gegen eine Sitzung, die selbst abgeleitet hat (Kacheln, Suche, Route, Lasso, Snap), und flippen jedes Bit von Paketen und Deltas. Die ABI der Engine liegt jetzt in `flyermap-engine/src/abi.rs`, die Wasm-Datei ist neu gebaut.
- **Messung** (`cargo run --release -p flyermap-pack --example derived_bench`; synthetische Stadt von `tests/support/city.rs`, derselbe Erzeuger wie in den Tests; nativ, nicht im Browser): auf 51 206 Häusern braucht das Gerät vom Rohpaket bis zur Sitzung 1,1 s, vom abgeleiteten Paket 0,56 s (2,0 mal schneller; 7 206 Häuser: 2,2 mal). Der Server braucht einmalig 1,4 s. **Dafür ist das Paket größer:** 4,1 MB gegen 1,2 MB als Rohpaket (3,3 mal; entpackt 37 MB gegen 16 MB). Bei 10 Mbit/s sind das rechnerisch 2,3 s mehr Übertragung als die 0,5 s Rechenzeit, die es spart. Der Gewinn liegt deshalb im zweiten Start (unveränderlicher Name: kein Download, keine Revalidierung) und im Delta, nicht im ersten Laden. Delta nach OSM-Änderungen: 512 Häuser und 1 Straße geändert: 54 kB (1,3 % des neuen Pakets, 4 % des neuen Rohpakets); 5 120 Häuser und 5 Straßen: 359 kB (8,7 % / 28 %); Gerät wendet es in 0,2 bis 0,3 s an. Manifest eines 9 km x 9 km großen Gebiets (24 Teile): 3 kB. gzip-Stufe 9 ist nur 0,05 % kleiner als Stufe 6, braucht aber das Dreifache an Zeit: Stufe 6.
- **Wo die Bytes liegen:** 72 % der entpackten Nutzlast sind Straßenstücke (Zeichenketten `id`, `group`, `from`, `to` je Stück), 25 % sind Koordinaten als f64. Das ist der nächste Hebel für die Größe (Koordinaten als relative Ganzzahlen, Zeichenketten in eine Tabelle); er ändert das Blob-Format der Engine und ist deshalb eine eigene Entscheidung.
- **Offen:** Messung im Browser auf einem echten Telefon (Wasm, `DecompressionStream`); echte Städte statt des Rasters (Zahl und Länge der Straßenstücke weichen ab); Worker-Anbindung (Ableiten beim Speichern eines Rohpakets, Ablage unter `d/`, `m/`, `x/`, Weiche im Client). Noch nichts davon ist im Worker oder in der Oberfläche angeschlossen, es gibt keine Änderung am Verhalten von Unstable oder Produktion.

### C. Live statt Abfragen
- Heute: Geräte fragen regelmäßig nach. Der Durable Object ist leer.
- Neu: ein Durable Object je Aktion hält WebSockets; ein Schreibvorgang wird an alle verbundenen Geräte geschoben (nur die Änderung). Abfragen bleiben als Rückfall. Die Sync-Zustandsmaschine kennt schon „kick" und Timer, braucht also nur ein weiteres Ereignis.

### D. Worker-Innenleben
- Heute u. a.: `meta` löst pro Gebiet einzeln Gebiet und Schreibrecht auf (viele Abfragen).
- Neu: feste, typisierte Abfragen pro Resource (ein Join statt N Abfragen), ein Anfrage-Kontext mit einmal aufgelöstem Aufrufer, durchgehend maschinenlesbare Fehler. Messbar über `server-timing`.

### E. API v6, nicht Anbauten an v5
- Neue Wege unter `/api/v6/...` mit Seiten (Pagination), stabilen Fehlercodes und den Typen aus `flyermap-wire` für Client und Server. `/api/v5` bleibt über die Weiche, bis die Rust-Oberfläche vollständig ist.

## 3. Wie wir es beweisen, wenn es kein TypeScript-Vorbild mehr gibt
- Eigenschaftstests (Regel und SQL-Filter stimmen überein; Sync-Fuzz; Wiederholbarkeit der Ableitung).
- Last- und Zeitmessung auf der 51k-Häuser-Aktion mit Zahlen vorher/nachher (Ableitung, Ladezeit, Anfragen pro Start).
- Angriffsfälle der alten Tests werden als Anforderungen übernommen (Rechte dürfen nicht lockerer werden), nicht als Wortlaut.

## 4. Reihenfolge
1. A (Identität/Rechte) als Entwurf mit dem Eigentümer, dann bauen: Rust-Crate `flyermap-identity` + Adapter.
2. B (Karten-Ableitung auf dem Server).
3. C (Live-Sync).
4. D und E laufend.

## 5. Offene Entscheidungen des Eigentümers
- Darf das Rechtemodell bei A so umgebaut werden, dass Links/QR der Gruppen neu ausgegeben werden müssen (sauberer), oder müssen alle bestehenden Links weiter gelten (Adapter, aufwendiger)?
- Passkeys: gewünscht oder nur Passwort (+ TOTP wie heute)?

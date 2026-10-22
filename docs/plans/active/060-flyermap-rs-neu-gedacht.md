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

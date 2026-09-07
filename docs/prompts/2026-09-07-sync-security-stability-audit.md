# EXTREME SYNC SECURITY + STABILITY AUDIT PROMPT

Repository: `madebycli/flyer-map`

Du übernimmst einen adversarialen Security-, Correctness- und Stability-Audit der aktuellen RxDB/D1/Worker/Durable-Object-Synchronisierung.

## Ziel

Beweise nicht nur, dass Happy-Path-Sync funktioniert. Versuche systematisch, die Sync-Invarianten zu brechen: Offline, mehrere Clients, Reorder, Duplicate, Lost Events, stale state, manipulierte Clientdaten, Tombstones, Resync, Konflikte, WebSocket-Reconnect, Teilfehler, ungültige IDs und der Street-/House-Publish-Vertrag.

Der wichtigste Grundsatz lautet:

**D1/Worker ist Autorität. Der Client ist vollständig untrusted. RxDB ist lokaler operativer Zustand, kein Berechtigungs- oder Ownership-Beweis. Durable Object ist Invalidation/Fanout, nicht kanonischer State.**

## Pflicht-Context

Lies zuerst:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/architecture/DATA.md`
5. `docs/architecture/SECURITY.md`
6. `docs/quality/QUALITY.md`
7. relevante RxDB-/sync ADRs aus dem Graphen
8. PR-#74-Handoff/aktive Sync-Pläne
9. `docs/reports/2026-09-07-current-development-audit.md`
10. `docs/context-replan-2026-09-07.yaml`
11. für Street/House den verbindlichen `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md` auf dem Street-Engine-Branch.

Dann verifiziere Remote:

- `mission-rxdb-sync` Head;
- PR #74 open/Draft/unmerged;
- exact-head CI;
- relevante Sync-Migrationen;
- Worker-/RxDB-Dateien;
- aktuelle Staging-Linie.

Snapshot nur zur Orientierung: am 2026-09-07 war `mission-rxdb-sync` auf `33ab9c0d757da44e0b20b278982a548eafe732aa`. Remote gewinnt.

## Scope

Auditiere mindestens:

- D1 canonical model;
- `campaign_sync_changes` / Change Feed;
- Pull API;
- Push API;
- Revisionen/Write Tokens/Conflict semantics;
- cursor/order semantics;
- tombstones;
- bootstrap/fresh client;
- Safety Resync;
- RxDB/Dexie collections;
- offline queueing/reconnect;
- multi-client convergence;
- Durable Object/WebSocket invalidation;
- campaign/team/area/task/house-task scope;
- Field Group relevante Scopes soweit Sync berührt;
- Street/House automatische server-prepared Tasks nach Integrationsvertrag.

# A – Invarianten explizit machen

Leite vor Tests die invarianten Eigenschaften aus Code/Docs ab. Mindestens:

1. D1 ist kanonisch.
2. Client kann keine Serverberechtigung durch lokale Role/ID erzeugen.
3. Push validiert Campaign/Entity Scope serverseitig.
4. Revision/Write Token sind keine blind vertrauenswürdigen Clientwerte.
5. Erfolgreiche Mutation und zugehöriger Change-Feed-Eintrag sind atomar konsistent.
6. Cursor-Reihenfolge ist deterministisch und monotonic gemäß Vertrag.
7. Tombstone verhindert Resurrection gelöschter Serverobjekte.
8. Duplicate Pull/Push ist idempotent oder kontrolliert konfliktbehandelt.
9. Reordered invalidations dürfen keine falsche kanonische Reihenfolge erzeugen.
10. verlorene DO/WebSocket Invalidation wird durch Pull/Resync geheilt.
11. Fresh client kann vollständig bootstrapen.
12. langer Offline-Client überschreibt keine neuere kanonische Wahrheit unbemerkt.
13. Multi-client konvergiert.
14. Manual/user-owned Felder werden durch server-prepared Street-Reconcile nicht zerstört.
15. obsolete offene automatische Streets dürfen kontrolliert tombstoned werden; worked autos blockieren destruktive Reprepare gemäß Policy A.
16. Street und House besitzen unabhängige Phasen; `street ready + house failed` ist zulässig.

Jede dieser Invarianten bekommt Tests/Evidenz.

# B – Client ist Angreifer

Manipuliere Push/Pull Requests gezielt:

- fremde `campaignId`;
- fremde `teamId`;
- fremde `areaId`;
- fremde `taskId`;
- erfundene IDs;
- Typverwechslungen;
- unerwartete zusätzliche Felder;
- server-owned Felder;
- manipulated `updatedAt`;
- manipulated revision;
- manipulated write token;
- negative/huge cursor;
- stale cursor;
- malformed tombstone;
- manuelle Auto-Street-ID;
- falsche OSM provenance/generation;
- `completedAt`/status Kombinationen außerhalb Schema;
- Campaign mismatch zwischen URL und Body.

Erwartung: serverseitige Schema-/Scope-/AuthZ-Auflösung fail-closed. Kein Client darf durch Kenntnis einer gültigen ID fremde Daten schreiben oder lesen.

# C – Push Correctness

Teste:

- ein Objekt normal;
- Batch mehrere Objects;
- zwei Collections in enger Folge;
- duplicate exact push;
- same revision/different payload;
- stale revision;
- future/forged revision;
- invalid write token;
- lost client acknowledgement und retry;
- timeout nach möglichem Commit;
- transaction partial failure;
- one invalid entity in batch;
- same entity twice in batch;
- conflicting entities parallel;
- delete/update parallel;
- create/create same ID parallel.

Definiere und beweise: Welche Semantik hat ein Retry, wenn der Client nicht weiß, ob der Server committed hat?

# D – Pull Correctness

Teste:

- empty database;
- fresh client;
- first cursor;
- pagination boundary;
- exact page-size boundary;
- many changes same timestamp;
- deterministic ordering unabhängig von wall clock;
- duplicate pull;
- stale cursor;
- invalid cursor;
- cursor beyond current head;
- tombstone-only page;
- entity updated mehrfach zwischen pulls;
- delete nach update;
- recreate policy, falls IDs wiederverwendbar sind;
- multiple collections interleaved.

Keine Abhängigkeit von unsicheren Client-Zeitstempeln für kanonische Reihenfolge.

# E – Tombstones / Resurrection

Konstruiere besonders aggressive Fälle:

1. Client A offline mit Objekt X.
2. Server/Client B löscht X -> Tombstone.
3. A editiert alte lokale Version und kommt zurück.

Erwartung nach Vertrag: kein stilles Resurrection, sofern das Produkt nicht explizit eine Recreate-Semantik definiert.

Varianten:

- task delete/update;
- team delete + stale task;
- area delete + stale street;
- automatic Street tombstone;
- multiple tombstones;
- tombstone compaction/retention, falls vorhanden;
- fresh client nach lange zurückliegendem Delete.

# F – Offline / Reconnect

Echte zwei-Client-Matrix:

- A online, B offline.
- beide ändern unterschiedliche Entities.
- beide ändern dieselbe Entity.
- B reconnect.
- WebSocket reconnect vor/ nach Pull.
- Browser refresh während pending local write.
- Netz flapped mehrfach.
- request timeout.
- tab hidden/resumed.
- app process kill/reopen soweit testbar.

Prüfe lokale Queue-/pending-state Persistenz und dass kein Backup-/Auto-Push-Loop entsteht.

# G – Multi-client / Concurrency

Mindestens:

- 2 Clients gleiche Campaign;
- 3+ Clients stress case;
- simultaneous Team edit;
- simultaneous Task status;
- Campaign rename parallel;
- delete vs update;
- offline stale vs online current;
- Room/Field Group relevante Änderungen, soweit dieselbe Sync-Grenze berührt wird.

Ergebnis muss entweder deterministisch konvergieren oder einen expliziten Konfliktzustand erzeugen. Keine unbemerkte Divergenz.

# H – Durable Object / WebSocket Invalidation

Prüfe die Architekturannahme „DO ist nur Invalidation“.

Tests:

- connect ohne Auth;
- foreign campaign subscribe;
- stale session connect/reconnect;
- duplicate connections;
- reconnect storm;
- hibernation resume;
- message lost;
- duplicate invalidation;
- reordered invalidation;
- invalidation vor Pull commit sichtbar?
- invalidation nach commit lost?
- client disconnected während mutation;
- many clients fan-out.

Das System muss korrekt bleiben, selbst wenn **jede Invalidation verloren geht** und der Client später regulär pullt/resynct. DO darf nie die einzige Kopie kanonischer Daten sein.

# I – Safety Resync

Beweise:

- Wann Resync ausgelöst wird.
- Welche lokale Daten verworfen/erhalten werden.
- Pending unsynced user writes.
- tombstones.
- corrupt/unknown cursor.
- server schema change.
- fresh bootstrap after resync.
- keine Cross-Campaign Vermischung.
- keine Autoritätsentscheidung aus lokalem Cache.

Teste absichtlich beschädigte lokale Metadaten in isolierter Browser-Testumgebung.

# J – Campaign-/Team-Scope Security

Für jede Sync Collection:

- URL Campaign A + Body Campaign B.
- Team aus B unter Campaign A.
- Area/Task Parent mismatch.
- House Task Parent mismatch.
- bekannte ID eines fremden Tenants.
- legacy/imported Campaign Access.
- removed membership mit stale local state.
- downgrade role während offline.

Server muss aktuelle Session/Membership/Grant/Capability verwenden, nicht lokale RxDB-Felder.

# K – Schema / Validation / Resource Limits

Teste:

- oversized batches;
- huge strings;
- huge geometries;
- deeply nested malformed GeoJSON;
- invalid coordinates;
- NaN/Infinity sofern JSON/Pipeline ermöglicht;
- duplicate keys;
- unknown entity type;
- unknown schema version;
- enormous task lists;
- maliciously repetitive payloads.

Ziel: kontrollierte 4xx/413/429 statt Worker-OOM/Timeout/500-Leak.

# L – D1 Atomicity / Rollback

Verifiziere White-Box und Tests:

- canonical row update + sync feed row in derselben atomaren Grenze;
- failed feed insert rollt canonical change zurück oder der Vertrag besitzt eine sichere Recovery – keine stille Lücke;
- FK failure;
- unique failure;
- middle-of-batch failure;
- campaign revision update failure;
- write-token guard failure;
- tombstone + delete atomicity.

Simuliere Fehler in Test-Harness, nicht durch Production-Manipulation.

# M – Storage Corruption / Quota / Browser lifecycle

Prüfe lokale Stabilität bei:

- IndexedDB quota exceeded;
- transaction abort;
- partial browser storage clear;
- RxDB metadata vorhanden, collection data fehlt;
- multiple tabs;
- schema migration interrupted;
- private browsing/storage restrictions soweit testbar;
- app reload während write.

Keine Security-Grenze darf von korrektem LocalStorage abhängen.

# N – Street/House Integrationsvertrag

Nach Integration von PR #75 / `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md` muss exakt gelten:

- nur eine kanonische automatische Street-ID-Semantik;
- SHA-256 `task_auto_...` nach dokumentiertem identity JSON;
- gleiche ID bewahrt `label`, `status`, `completedAt`, `createdAt`;
- server-owned Änderungen aktualisieren Geometrie/Provenance/Generation/`updatedAt`;
- unchanged erzeugt keinen Feed-Churn;
- obsolete open auto -> zulässiger Tombstone;
- obsolete worked auto -> `area_preparation_work_started`, kein Delete;
- manual tasks untouched;
- street publish und feed atomic;
- house publish eigene Phase;
- `street ready + house failed` pull/replay korrekt;
- house-only retry verändert Street nicht;
- street-only retry verändert fertige Houses nicht;
- stale generation darf nicht publishen;
- zweiter Client startet nicht unnötig neue Preparation.

Entferne/markiere jede doppelte Reconcile-Implementierung oder Hashabweichung als Blocker.

# O – Chaos-/Property-Testplan

Baue, soweit sinnvoll, deterministische Tests mit randomisierten Event-Sequenzen:

Events beispielsweise:

- create/update/delete entity;
- client offline/online;
- pull page;
- push retry;
- drop invalidation;
- duplicate invalidation;
- reorder invalidation;
- stale update;
- resync;
- street reprepare;
- tombstone.

Property am Ende:

- autorisierte Clients konvergieren auf kanonischen Serverzustand;
- keine foreign-tenant entity sichtbar;
- gelöschte Entity resurrected nicht unerlaubt;
- user-owned Street-Felder bleiben erhalten;
- server-owned Generation ist korrekt;
- pending conflict ist explizit, nicht stille Divergenz.

Random Seed bei Failure loggen, damit der Fall reproduzierbar wird.

# P – Performance/Stability

Keine Mikrobenchmark-Show, sondern reale Grenzfälle:

- große Campaign mit vielen Teams/Areas/Tasks/Houses;
- große Pull pages;
- Reconnect vieler Clients;
- Burst von Updates;
- automatic Street publish mit vielen Deltas;
- no-churn reprepare;
- pagination unter Last.

Messen:

- API latency;
- Worker CPU/limits;
- D1 query count;
- payload bytes;
- client apply duration;
- memory soweit verfügbar.

Regression Budgets dokumentieren, nicht ohne Evidenz willkürliche harte Zahlen als bestehende Anforderungen ausgeben.

# Q – Security Review des Sync Codes

Zusätzlich prüfen:

- SQL injection/parameterization;
- authz per endpoint;
- CSRF/origin für mutations;
- WebSocket auth;
- sensitive logs;
- error leakage;
- rate limiting für abuse-prone endpoints;
- supply chain/dependency audit;
- server-side validation.

# R – Findings Format

Für jedes Finding:

- ID
- Severity
- Category: Security / Data Loss / Convergence / Availability / Performance
- invariant violated
- exact repro
- seed/event sequence falls Chaos-Test
- expected
- actual
- root cause
- affected files
- fix
- regression test
- commit
- exact-head CI
- staging retest
- residual risk.

# S – Acceptance Matrix

Der Audit ist erst abgeschlossen, wenn eine Matrix existiert für:

- Team create/edit
- Campaign rename
- manual Street create/status
- automatic Street publish/reprepare
- House status
- pull/push
- offline/reconnect
- Field Group Scopes soweit relevant
- DO WebSocket
- Safety Resync
- tombstones
- fresh client
- two-browser sync
- multi-client concurrency
- malformed/malicious client payload
- Street ready + House failed
- stale generation
- worked Street reprepare block.

# T – Harte Grenzen

- PR #74 Draft/unmerged lassen.
- PR #75 nicht mergen.
- kein Production Deploy.
- keine Production D1 Migration/Änderung.
- rollback branch nicht anfassen.
- keine grünen Tests abschwächen.
- keine Sync-Sicherheit in den Client verlagern.
- kein Ersatz von Fehlern durch „last write wins“, wenn Vertrag das nicht erlaubt.
- keine Street-Engine-Geometrie blind redesignen; erst Integrationsvertrag respektieren.

# U – Abschluss

Am Ende liefere:

- exact heads;
- architecture invariant table;
- findings nach Severity;
- alle implementierten Fixes + SHAs;
- exact-head CI;
- staging run;
- two-browser result;
- offline/reconnect result;
- chaos/property result;
- tombstone/resync result;
- Street/House integration result;
- Production touched: no;
- offene externe Gates.

Nicht bei der ersten roten Testmatrix aufhören. Logs/Seeds/DB State lesen, Root Cause beheben und weiterlaufen lassen, bis alle innerhalb der Umgebung lösbaren Critical/High/Data-Loss/Convergence-Blocker geschlossen sind.

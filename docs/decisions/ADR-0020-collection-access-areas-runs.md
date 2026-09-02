---
id: adr-collection-access-areas-runs
type: adr
status: accepted
date: 2026-08-30
decision: First-Class Collection Access, Areas und Runs als additive Collection-Domain
related: [plan-collection-pickup-persistence, data, offline-sync, map, security, quality]
---

# ADR-0020: First-Class Collection Access, Areas und Runs

## Status

Accepted.

## Context

FC5 benötigt einen echten Collection-Arbeitsbereich für freiwillige Helfer ohne normalen Account. Collection-Gebiete, Fahrten, Mitglieder und Area-Claims haben einen anderen Lifecycle als Distribution Areas und Street Tasks. Ein wiederverwendeter Distribution-Status würde fachliche Isolation, getrennte Berechtigungen und mehrere Geräte in einer Fahrt nicht zuverlässig abbilden.

Der normale Produktweg muss mit dem bestehenden Worker, D1, MapLibre und der M5-Mutationswarteschlange funktionieren. Migration 0010 wird vorbereitet, aber nicht remote angewendet.

## Optionen

### Ansatz A: First-Class Collection-Domain

Collection erhält eigene App-IDs, eigene normalisierte Tabellen für Access, Collector, Main Area, Areas, Runs, Mitglieder und Claim-Historie. Der Browser führt die Collection-Projektion zusätzlich im \`CampaignSnapshot\` und leitet daraus explizite \`collection.*\`-Mutationen für die bestehende M5-Queue ab.

Vorteile:

- Distribution und Collection bleiben fachlich unabhängig;
- Runs können mehrere Areas und mehrere Geräte abbilden;
- Worker kann Collection-only Credentials separat autorisieren;
- Claim-, Release- und Revoke-Vorgänge bleiben nachvollziehbar und idempotent;
- spätere Pickup- und Road-Section-Slices können dieselbe Collection-Domain erweitern.

Nachteil:

- zusätzliche Tabellen und eine additive Snapshot-Projektion.

### Ansatz B: Collection-State auf Distribution Tasks

Collection würde vorhandene Distribution Areas und Street/House Tasks mit zusätzlichen Flags und Statusfeldern verwenden.

Dieser Ansatz ist kleiner im ersten Commit, kann aber keine unabhängig geschnittenen Collection Areas, getrennten Runs, temporären Collector-Identitäten oder getrennten Lifecycles sauber darstellen. Er wird verworfen.

## Entscheidung

Ansatz A wird umgesetzt.

- \`CampaignSnapshot.collection\` ist eine additive Projektion und enthält Main Area, Collection Areas und Runs.
- D1 erhält eigene Collection-Tabellen. Distribution-Tabellen werden nicht um Collection-Status erweitert.
- App-IDs sind authoritative Identity. OSM-IDs bleiben ausschließlich Provenance und sind für diesen Slice nicht erforderlich.
- Collection Access verwendet einen Campaign-spezifischen high-entropy QR-Eintrittspunkt. Redeem erzeugt pro Gerät eine eigene revocable Collector-Identität. Collector-Sessions liegen als Hash vor.
- Collection Collector darf ausschließlich Collection-Mutationen senden. Der Worker prüft Campaign-Scope und Collector-Actor. Admin kann Collection verwalten und Areas force-releasen.
- Start, Claim, Join, Leave, Start Area, Complete, Release, Close und Cancel werden als \`collection.*\`-Mutationen über M5 verarbeitet. Duplicate Submit und Revision-Konflikte bleiben im bestehenden Mutation Ledger.
- MapLibre bleibt die einzige Kartenengine. Collection Main Area und Child Areas werden über feste GeoJSON-Quellen und Layer dargestellt.
- Es gibt kein automatisches Timeout, keine GPS-Historie, keine zweite Queue und keine neue generische Permission-Runtime.
- Migration 0010 bleibt bis zu einer ausdrücklich freigegebenen Rollout-Entscheidung vorbereitet.

## Konsequenzen

Die Collection-UI kann Main Area und Child Areas im bestehenden Sheet-/Map-Flow konfigurieren. Collector-Geräte sehen dieselbe Collection-Projektion, können offene Areas auswählen, gemeinsam Runs bilden und Statuswechsel synchronisieren. Distribution kann parallel bestehen und wird durch Collection-Änderungen nicht verändert.

Die normalisierte Persistenz macht Collector-Revocation, Run-Mitglieder, Area-Claims und spätere Audit-/Attribution-Slices erweiterbar. Die Snapshot-Projektion hält Offline, Retry und Optimistic UI im bestehenden M5-Modell.

## Sicherheitsgrenzen

- QR-Token und Session-Secret werden nicht als Klartext in D1 gespeichert.
- Collector-IDs sind Selektoren und keine Credentials.
- Collection-only Access erhält weder Distribution- noch Admin-Rechte.
- Worker bleibt authoritative Authorization Boundary.
- Collection-Snapshot-PUT ist gesperrt. Collection-Daten gehen nur über den Collection-Mutationspfad.
- MapLibre Properties enthalten keine Tokens oder Secrets.
- Der Cloud-Browser ohne WebGL und fehlende reale Geräte ersetzen nicht die offenen FC4-Hardware-Gates.

## Rollout

Code, Tests und Migration 0010 werden vorbereitet und auf dem Draft-PR geprüft. Es erfolgt kein Remote-Migrationslauf und kein manueller Deploy. Ein späterer Rollout muss Schema-Verfügbarkeit, Worker-Routen, QR-Revocation und Offline-/Retry-Verhalten separat verifizieren.

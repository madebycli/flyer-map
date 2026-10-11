---
id: operations-unstable-testing
type: operations
status: active
last_updated: 2026-10-10
related: [operations-deployment, plan-051-full-rewrite]
---

# Testen auf Unstable (sauberer Start)

**Adresse:** https://flyer-map-unstable.cloudflare-eleven035.workers.dev

Unstable ist vom echten Betrieb getrennt: eigener Worker (`flyer-map-unstable` → `flyer-map-unstable-backend`) und **eigene Datenbank** `flyer-map-unstable-db`. Produktion (`flyer-map`, `flyer-map-db`) wird dabei nicht berührt.

## Wie ein Stand auf Unstable kommt

Ein Push auf den Branch `unstable` startet den Workflow `.github/workflows/release-channels.yml` (Job `unstable`): Tests, Typprüfung, Abhängigkeits-Audit, Build, **Migrationen nur auf die Unstable-Datenbank**, Deploy, Rauchtest (`/`, `/login`, `/start`, `/api/organization/me` = 401, `/api/runtime` meldet `unstable` und den Commit).

Stand 2026-10-10: `unstable` wurde auf den Integrationsstand des Rewrites vorgespult. Die Unstable-Datenbank war vorher leer (keine Aktionen, keine Organisation, keine Konten) — es gibt keinen Altbestand.

## Erster Start (einmalig)

1. **`/start`** öffnen → „Organisation & ersten Organizer anlegen“: Name der Organisation, Benutzername, Passwort und den **Setup-Schlüssel**. Das geht nur einmal; danach ist die Seite wirkungslos. Weitere Organizer legt der erste über **Einladungen** an — einen Setup-Schlüssel braucht dafür niemand.
   - **Eigener Schlüssel (empfohlen):** GitHub → Repository → Settings → Secrets and variables → Actions → *New repository secret* mit dem Namen `UNSTABLE_SETUP_KEY` und einem Wert, den nur du kennst (z. B. im Passwortmanager). Der nächste Push auf `unstable` übernimmt ihn; im Worker landet nur sein SHA-256. Ohne dieses Secret gilt der einmalige Start-Schlüssel, dessen SHA-256 als `BOOTSTRAP_SHA256` im Workflow steht.
2. Zweiten Faktor (Authenticator-App) einrichten, falls die Seite danach fragt.
3. **Neue Aktion** anlegen (Name, Kartenfokus) → **Feldkarte öffnen**.

## Was man in der Feldkarte testet

- **Gruppen:** Menü → Gruppen: Gruppen anlegen (Name, Farbe), umbenennen, umfärben; unten **„Gebiete zuweisen“**: jedes Gebiet mit seiner Gruppe, dort umstellbar. Auch am einzelnen Gebiet (antippen) stehen die Gruppen mit Namen.
- **Gebiete:** Menü → Gebiete → neues Gebiet zeichnen; beim Zeichnen die Gruppe wählen; danach „Kartendaten laden“ (Straßen und Häuser kommen aus OpenStreetMap).
- **Zugänge:** Menü → Zugänge: Links für eine Gruppe (Bearbeiten nur ihre Gebiete) oder zum Ansehen; Abhol-Links für Helfer. Link auf einem zweiten Gerät öffnen.
- **Markieren:** Haus/Straße antippen, Status setzen; Strecke/Wischen/Lasso über den runden Knopf; offline markieren, wieder online → gleicht ab.
- **Notizen**, **Übersicht**, **Team**, **Suche**.
- **Diagnose:** Menü → Diagnose oder `?diag=1` an die Adresse; „Bericht kopieren“ liefert einen Bericht ohne Positionen, Namen oder Texte (für Fehlermeldungen an die Entwicklung).

## Was hier nicht geprüft ist

Echte Handys (vor allem iOS Safari mit MapLibre 6), echte OpenStreetMap-Daten über Overpass, die Live-Grundkarte. Genau das ist der Zweck dieses Testlaufs.

## Zurücksetzen

Die Unstable-Datenbank enthält nur Testdaten. Ein kompletter Neustart heißt: alle Tabellen der Unstable-D1 leeren (Migrationstabelle `d1_migrations` behalten) und den Setup-Schlüssel wieder verwenden (`UNSTABLE_SETUP_KEY`) — die Einrichtung ist nach dem Leeren wieder offen. D1 bietet außerdem eine Zeitreise-Wiederherstellung (Cloudflare-Dashboard → D1 → Time Travel).

---
id: operations-staging-v5-readiness
type: operations
status: active
last_updated: 2026-10-09
related: [ADR-0035, ADR-0036, plan-051-full-rewrite, operations-organizer-admin-staging]
---

# Staging-Bereitschaft für den Full Rewrite (v5)

**Nur Vorbereitung. Nichts hiervon wurde ausgeführt.** Jeder Schritt mit `[GO]` braucht die ausdrückliche Freigabe des Eigentümers. Produktion (`wrangler.jsonc`, Worker `flyer-map`, D1 `flyer-map-db`) bleibt unberührt; `STREET_ENGINE_LIVE_READY=FALSE`.

## Ziel

Der Integrationsstand (`claude/rewrite-phase5-delete-legacy`) läuft auf dem Staging-Worker `flyer-map-staging` (`deploy/staging/wrangler.staging.example.jsonc`, D1 `flyer-map-staging-db`). Beobachtet: Staging-Login liefert 500, weil Migrationen fehlen.

## Prüfung der Konfiguration gegen den aktuellen Worker (Stand 2026-10-09)

| Punkt | Befund |
|---|---|
| Entry Point | `worker/indexOrganizer.ts`, wie Produktion. Kette: Organizer → `indexFc52` (Sonder-Marker) → `index` → `worker/v5`. |
| Durable Objects | `CampaignSyncDurableObject` ist nur ein Stub (Klasse bleibt, weil die Migrationshistorie sie nennt). `deleted_classes` **nicht** anwenden: das löscht gespeicherte DO-Daten. Beide `migrations`-Tags der Staging-Datei bleiben unverändert. |
| Assets | `dist/client` enthält `index.html` (Router: Organisation, Login, Weiterleitung) und `v5.html` (Feldkarte). `run_worker_first: ["/api/*", "/"]`, SPA-Fallback; `/v5` wird als `v5.html` ausgeliefert, `/` läuft zuerst durch den Worker (`indexFc52`, liefert `index.html` aus); der Router in `src/main.tsx` leitet alte `/?campaign=…`-Adressen clientseitig auf `/v5` weiter. |
| Rate-Limits | Vier Namespaces `9271400x` in der Staging-Datei; Namen entsprechen dem Code (`FIELD_GROUP_JOIN_*` heißen historisch so, werden von Links genutzt). |
| Vars | `RUNTIME_ENVIRONMENT=staging`. Basemap-Stil kommt aus der Deploy-Konfiguration (nie im Client hartkodiert); ohne ihn läuft die Karte auf Hintergrundfläche. |
| Secrets | Nur als Worker-Secrets setzen, nie ins Repo (z. B. `ORGANIZATION_TOTP_KEY`, siehe `ORGANIZER_ADMIN_STAGING.md`). |

## Migrationen (Staging-D1)

Reihenfolge, alle additiv; keine löscht Tabellen:

1. `0023_street_base_chunks.sql` (Sync-Heads, Straßen-Basisspeicher; wird vom Alt-Import des Fortschritts gelesen)
2. `0024_rxdb_sync_retention.sql`
3. `0024_unstable_optional_mfa.sql`
4. `0025_trusted_devices.sql`
5. `0026_v5_field_state.sql` (Statusschicht, Zähler, Gebiets-Packs)
6. `0027_v5_notes.sql` (Notizen)

Das D1-Binding der Staging-Datei trägt `"migrations_dir": "../../migrations"`: Wrangler löst den Standardpfad relativ zur Konfigurationsdatei auf und fände unter `deploy/staging/` sonst keine Migrationen (lokal geprüft, B-F-005). Vorher prüfen, was angewendet ist: `npx wrangler d1 migrations list DB -c deploy/staging/wrangler.staging.example.jsonc --remote` (nur lesend; `--local` zeigt dieselbe Liste ohne Netz).

## Ablauf `[GO]`

Jeder Befehl trägt `-c deploy/staging/wrangler.staging.example.jsonc`. Ohne `-c` wählt Wrangler `wrangler.jsonc`, also die Produktion.

0. **Vorher festhalten** (nur lesend): Quell-Commit (`git rev-parse HEAD`) und die aktuelle Staging-Version (`npx wrangler deployments list -c deploy/staging/wrangler.staging.example.jsonc`, `npx wrangler versions list -c …`). Version-ID und Commit in die Übergabe schreiben; sie sind das Rollback-Ziel.
1. **Sicherung** nur der Staging-D1: `npx wrangler d1 export flyer-map-staging-db --remote --output <lokal>.sql -c deploy/staging/wrangler.staging.example.jsonc`. Datei nicht committen. Der Datenbankname `flyer-map-staging-db` ist das einzige Ziel; `flyer-map-db` (Produktion) kommt nirgends vor.
2. Migrationen 1–6 mit `npx wrangler d1 migrations apply DB --remote -c deploy/staging/wrangler.staging.example.jsonc`.
3. `npm run build` (Wasm-Digest wird geprüft), dann `npx wrangler deploy -c deploy/staging/wrangler.staging.example.jsonc`. **Nie ohne `-c`.**
4. Rauchtest: Login (kein 500), `/v5` lädt, alter Link `/?campaign=<id>#access=…` landet auf `/v5` und löst ein, Gebiet laden, ein Haus markieren, Neuladen, Offline markieren und wieder online, Abholaktion mit Abhol-Link.
5. Rollback: `npx wrangler rollback <STAGING-VERSION-ID> -c deploy/staging/wrangler.staging.example.jsonc`, wobei die Version-ID aus Schritt 0 stammt und im Ausgabekopf `flyer-map-staging` steht (nicht `flyer-map`). Migrationen sind additiv und bleiben; bei Datenproblemen die Sicherung nur in `flyer-map-staging-db` einspielen.

## Nicht verifiziert

Echte Geräte (iPad, Android), echtes Overpass, die echte D1, die Live-Basemap und die Organizer-Seiten gegen die echte API sind **nicht** geprüft. Es existieren nur synthetische Entsprechungen (Fixture-Server mit In-Memory-D1, Testdaten, gemockte Antworten). Die Login-500-Ursache (fehlende Migrationen) ist eine Beobachtung, nicht live reproduziert.

## Offene Gates

`npm audit` auf der Basis ist rot (bestehende High-Advisories in Cloudflare-Dev-Tooling). Das ist kein neuer Befund dieses Rewrites, bleibt aber ein offenes Gate vor einem Merge nach `beta`/`main`.

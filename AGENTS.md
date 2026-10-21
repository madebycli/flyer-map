# AGENTS.md

Verteil-Flyer: mobile Web-App (PWA) zum Verteilen von Flyern auf einer Karte. Code und Tests sind die Wahrheit.

Kontext (Regeln, Entscheidungen, Stand): privates Repo `madebycli/master-context`, Einstieg über `.ai/CONTEXT.md` → `projects/flyer-map/INDEX.md` und `NOW.md`. Dort steht auch, was hier fehlt, bitte zuerst lesen.

Harte Regeln, auch ohne Zugriff auf den Kontext (Details dort):
- Produktion nie anfassen: Worker `flyer-map`, D1 `flyer-map-db`; kein Deploy, keine Migration, keine Datenänderung ohne ausdrückliche Freigabe des Eigentümers. Kein Merge in `main`.
- Pushen nur auf `claude/rewrite-phase5-delete-legacy` und `unstable` (Unstable hat eine eigene D1).
- Keine Geheimnisse ins Repo; keine Standorte, Namen, Tokens oder Texte in Logs oder Berichte.
- Rechte entscheidet der Worker, nie nur die Oberfläche.

Prüfen: `npm test`, `npx tsc --noEmit`, `npm run build`; Browser-Flows `node scripts/v5-e2e/run-all.mjs` (vorher `npm run build`).
Entscheidungen, die schwer rückgängig zu machen sind, als ADR in `docs/decisions/` (bestehende ersetzen, nicht löschen). Offene Pläne: `docs/plans/active/`.

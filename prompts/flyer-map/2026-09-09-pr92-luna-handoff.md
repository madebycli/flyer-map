# GPT-5.6 Luna Übergabe: Flyer Map PR92

Arbeite direkt im Repository `madebycli/flyer-map` auf Branch `fix/street-engine-smart-marking`, PR #92, Implementierungs-Checkpoint `044da1f70977ef9acd78b538f1b02ed4f055b224`; prüfe vor jeder Aktion den tatsächlichen aktuellen PR-Head. Sprich den Nutzer als Master an und halte Antworten knapp. PR92 ist ein Draft-WIP auf `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`, nicht gemergt und nicht deployed.

Lies zuerst `main:.ai/CONTEXT.md`, danach im Repository `madebycli/master-context` nur den Flyer-Map-Einstieg und die in `projects/flyer-map/INDEX.md` verlinkten Street/House-, Sync-, Architektur-, Audit- und Handoff-Nodes. Vermische `main`, PR84-Staging und PR92-WIP nicht. Keine Rücksetzung auf alte Commits.

Der aktuelle Candidate enthält immutable Base-Chunks, Work-Overlays, automatische Area-Preparation, Generation-Visibility, A/B/C-Lease-Schutz, manuelle House-Parent-Erhaltung, collection-aware Sync, Smart-Marking-Intents, batched History über `domain_event_history`, MapLibre 6.9.0 als Sicherheitskandidat und sharp 0.35.4. Lokale Messwerte: 10k Preparation 532 geschätzte Writes, 46 Alarme, maximal 45 D1-Queries pro Alarm; 10k Delete 323 Writes; 500-House-History-Mark 24 Queries und 50 Writes bei vollständiger Event-Identität. Das sind keine Cloudflare-Billingwerte.

Prüfe zuerst GitHub-Head und CI-Run `34391314573`: 829 Tests PASS, Typecheck PASS, Audit PASS mit 0 Schwachstellen und Production Build PASS. Führe keine großen Remote-D1- oder Production-Aktionen aus. Migration `0023_street_base_chunks.sql` nicht remote anwenden, keine Secrets ändern, nicht mergen.

Arbeite danach nur an den höchsten offenen Risiken: echte Migration-/Legacy-Referenzen, Offline-/Reconnect- und Zweitclient-Konvergenz, vollständige Generation-Races, Area expand/shrink/re-expand/delete ohne Resurrection oder Child-Sturm, History-Read-Profil, MapLibre-6.9-Realbrowser-/Mobile-Abnahme sowie reale Cloudflare-/Overpass-Evidenz. Behebe nur reproduzierte Fehler. Wenn ein Gate offen bleibt, dokumentiere es ehrlich als offen und setze `STREET_ENGINE_LIVE_READY = FALSE`.

Nach jedem stabilen Teilstand committe und sichere den Branch über GitHub. Aktualisiere am Ende `projects/flyer-map/STATUS.md`, `BRANCH_AUDIT.md`, `ARCHITECTURE.md`, `SOURCES.md`, `handoffs/HANDOFF-LATEST.md`, `handoffs/STREET-ENGINE-PEAK-WIP.md` und bei neuer Evidenz den Audit-Handoff. Abschlussformat exakt: Head, Commit(s), Geändert, Street Engine, D1/Cloudflare, Sync, Server, Browser, Tests, CI, Context aktualisiert, Offen.

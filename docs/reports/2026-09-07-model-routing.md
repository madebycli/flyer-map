# Modell- und Reasoning-Routing für Flyer Map – 2026-09-07

## Zweck

Dieses Dokument verteilt die nächsten Flyer-Map-Workstreams auf Modelle/Reasoning-Stufen so, dass ein großzügiges Drei-Wochen-Budget **an den Stellen mit echter Unsicherheit** verbraucht wird und nicht in wiederholten Patch-Schleifen.

## Offiziell verifizierte OpenAI-Produktlage

Zum Audit-Zeitpunkt wurden aktuelle offizielle OpenAI-Quellen geprüft:

- OpenAI Help Center, `GPT-5.6 and GPT-6 Pro in ChatGPT`: `https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt`
- OpenAI, `Improving GPT-5.6 Sol in ChatGPT`: `https://openai.com/index/improving-gpt-5-6-sol-in-chatgpt/`
- OpenAI, `Previewing GPT-5.6 Sol`: `https://openai.com/index/previewing-gpt-5-6-sol/`

Die aktuelle offizielle Beschreibung sagt:

- GPT-5.6 Sol ist für komplexe Coding-, Knowledge-Work-, Research-, Cybersecurity-, Science- und Computer-Use-Aufgaben ausgelegt.
- GPT-5.6 Sol bietet je nach Plan Instant, Medium, High und Extra High.
- GPT-5.6 Sol Pro ist die Pro-Variante für schwierige/langlaufende Workflows.
- GPT-6 Astra wird auf berechtigten Plänen als **GPT-6 Pro** ausgerollt.
- GPT-5.6 Luna ist die schnelle/default Linie für Free/Go; schwierige Fragen können dort über Think mehr Reasoning erhalten.

Falls deine UI Begriffe wie „Luna Max“ verwendet, behandle das als UI-/Plan-spezifische Bezeichnung. In den geprüften offiziellen Quellen ist die Modellfamilie als GPT-5.6 Luna beziehungsweise Think beschrieben, nicht als eigenständige offiziell dokumentierte `Luna Max`-Modellfamilie.

## Kernentscheidung

### GPT-6 Pro / Astra

**Ja: auf Street/House Engine und den kritischsten Security-/Sync-Proofs ansetzen.**

Nicht als „mach alles“-Agent, sondern für die Aufgaben, bei denen eine Woche Sol-Patching keine belastbare Lösung gebracht hat:

1. Street/House Failure-Corpus Root Cause.
2. Geometrie-/Overpass-/Publish-/Sync-Kettenanalyse.
3. Admin Security adversarial architecture review.
4. kritische Race-/AuthZ-/Tenant-Isolation-Findings.
5. Sync Convergence/Chaos/Invariants, wenn Sol bei einem reproduzierbaren Fall festhängt.

Empfohlene Stufe: **Pro / höchste verfügbare Reasoning-Stufe**.

Warum: Hier ist die Schwierigkeit nicht hauptsächlich Tipparbeit, sondern das korrekte Verfolgen langer Kausalitätsketten und das Widerlegen eigener Hypothesen.

### GPT-5.6 Sol Extra High

Beste Wahl für:

- Security White-/Black-Box Deep Review.
- Street/House Root-Cause-Nacharbeit nach vorhandenem Failure Corpus.
- AuthZ-/Tenant-/Race-Fixes.
- Sync-Atomicity, Tombstone, stale-generation, conflict semantics.
- schwierige Architekturentscheidungen/ADR.
- kritisches Review eines von einem anderen Agenten implementierten Fixes.

**Nicht** für jeden CSS-Bug verwenden; das verbrennt Budget ohne großen Mehrwert.

### GPT-5.6 Sol High

Standard für ernsthafte Engineering-Arbeit:

- Root Cause eines reproduzierten UI-/State-/Session-Bugs.
- Worker/API-Implementierung.
- D1 Query/Transaction-Fixes.
- Playwright/E2E Journeys.
- Street/House Stage-Fix, nachdem die Fehlerklasse bekannt ist.
- Sync Integration nach klar definiertem Vertrag.
- kritisches Code Review.

High sollte deine **Default-Stufe für schreibende Backend-/State-Workstreams** sein.

### GPT-5.6 Sol Medium

Gut für:

- klar abgegrenzte Implementierung mit bereits bewiesener Root Cause.
- normale TypeScript-/React-Änderungen.
- Tests ergänzen, wenn das erwartete Verhalten klar ist.
- CI-/Workflow-Fixes mit eindeutigen Logs.
- Dokumentation aktualisieren.
- kleine Refactors ohne Architekturänderung.

Medium nicht für „warum scheitern große Areas seit einer Woche?“ einsetzen – dafür ist das Problem zu offen.

### GPT-5.6 Sol Instant/Low

Nur für mechanische Arbeit:

- Datei-/Symbolsuche.
- Status zusammenfassen.
- kleine Typo-/Text-/Format-Fixes.
- bereits exakt spezifizierte Ein-Zeilen-Änderungen.

Nicht für Security-Entscheidungen, Street-Geometrie, Sync-Invarianten oder komplexe UI-State-Loops.

### GPT-5.6 Luna / Think

Luna ist sinnvoll als **schneller Hilfs-/Worker-Agent**, nicht als alleiniger Owner der schwierigsten P0s.

Gute Aufgaben:

- große Dateimengen katalogisieren.
- UI-Bug-Intake normalisieren.
- Repro-Matrizen ausfüllen.
- Tests scaffolding nach klarer Spezifikation.
- bestehende Docs/Graph-Kanten lesen und Zusammenfassungen erstellen.
- repetitive Browser-/CI-Evidenz sammeln.
- einfache CSS-/Layout-Bugs mit eindeutigem Repro.
- Log-Sichtung und Klassifikation.

Wenn „Think“ verfügbar ist, für mittelschwere Root-Cause-Fragen einsetzen, aber Security Criticals und Street-/Sync-Kernentscheidungen danach von Sol High/XHigh oder GPT-6 Pro gegenprüfen lassen.

## Konkrete Agent-Zuordnung

| Workstream | Primärmodell | Effort | Zweitreview |
| --- | --- | --- | --- |
| Street/House forensic recovery | GPT-6 Pro/Astra | Pro/max | Sol Extra High |
| Street/House einzelne bewiesene Fixes | Sol High | High | GPT-6 Pro bei schwieriger Geometrie |
| Admin Security Master Audit | Sol Extra High oder GPT-6 Pro | Extra High/Pro | jeweils das andere starke Modell |
| Security Critical/High Fix | Sol High/Extra High | High+ | GPT-6 Pro Review |
| Sync adversarial/chaos audit | Sol Extra High | Extra High | GPT-6 Pro bei ungelösten Invarianten |
| Sync klarer Implementierungsfix | Sol High | High | Sol Extra High Review |
| UI aktuelle Bugs | Sol Medium/High | Medium bei klar, High bei State/Access | Luna für Repro/Testarbeit |
| UI Screenshots/Repro-Katalog | Luna | normal/Think | Sol nur bei Root Cause |
| CI/Staging Harness | Sol Medium | Medium | Luna für Logs |
| Planner/Context Graph | Sol High | High | Luna für Inventory |
| Dokumentationspflege | Luna oder Sol Medium | niedrig/mittel | kein Pro nötig |

## Speziell zur Street Engine nach einer Woche ohne Erfolg

Die Modellstrategie muss sich ändern, nicht nur die Modellstärke.

Was **nicht** noch einmal passieren soll:

`großes Gebiet scheitert -> Vermutung -> Patch -> kleiner Test grün -> nächstes großes Gebiet scheitert -> neue Vermutung`.

Neue Strategie:

`Failure Corpus -> strukturierte Stage-Telemetrie -> erster failing stage -> minimale Fixture -> Fehlerklasse -> Root Cause -> Regression -> Corpus rerun -> Integration -> live acceptance`.

GPT-6 Pro/Astra bekommt den **forensischen Orchestrator-Job**. Sol High kann danach konkrete, sauber bewiesene Fixes umsetzen. Luna sammelt Logs/Metriken und pflegt die Corpus-Matrix.

Damit wird teures Reasoning auf Unsicherheit konzentriert und nicht auf Tipparbeit.

## Speziell für Security

Empfohlene Zwei-Modell-Strategie:

### Pass 1 – Sol Extra High

- komplette Route/AuthZ Matrix.
- Threat Model.
- White-box Code Review.
- Black-box Testplan und automatisierbare negative Tests.
- konkrete Findings mit Evidenz.

### Pass 2 – GPT-6 Pro/Astra

Gib ihm **nicht** einfach denselben Prompt mit der Bitte „prüfe nochmal“. Gib ihm:

- Pass-1 Findings;
- Route-Matrix;
- relevante Codepfade;
- Tests;
- Bitte, die Annahmen des ersten Audits zu widerlegen und übersehene Attack Chains/Races zu finden.

Danach Critical/High Fixes seriell implementieren und jeden Fix erneut adversarial prüfen.

## Drei-Wochen-Budget – empfohlene Verteilung

Nicht als harte Prozentvorgabe, sondern als praktische Priorität:

### Woche 1

- 35–45 %: Street/House forensic recovery mit stärkstem Modell.
- 20–25 %: Admin Security initial deep audit.
- 15–20 %: UI Fresh Bug Campaign.
- Rest: Staging/CI/Planner und Sync initial audit.

### Woche 2

- Street/House Root-Cause-Fixes + corpus reruns.
- Security Critical/High fixes.
- UI combined regression journeys.
- Street ↔ Sync Integration beginnen, sobald Engine stabil genug ist.

### Woche 3

- Sync chaos/convergence closure.
- Combined isolated staging.
- zweites Security Review.
- real-device/manual acceptance.
- Release-readiness, nicht automatisch Production Release.

Wenn Street in Woche 1 weiterhin ohne eindeutigen ersten Failure Stage bleibt, **nicht noch mehr blindes Modellbudget verbrennen**: Observability verbessern, bis die Failure-Kette messbar ist.

## Parallelisierung

### Darf parallel laufen

- Security read-only audit.
- UI Repro/bug inventory.
- Street failure corpus/diagnostics review.
- Planner feature inventory.

### Nicht parallel auf denselben Dateien

- zwei Agents, die `worker/indexOrganizer.ts` gleichzeitig ändern.
- zwei Street Agents, die denselben Reconcile-/Preparation-Code ändern.
- Sync- und Street-Agent, die gleichzeitig denselben Adapter integrieren.

Regel: **Parallel lesen, seriell schreiben.** Jeder schreibende Workstream bekommt eigene Branch-Linie und klaren File Scope.

## Eskalationsregel

Wechsle von Luna/Medium -> Sol High -> Sol Extra High -> GPT-6 Pro nicht nach Gefühl, sondern wenn:

- Root Cause nach einem sauberen Repro unklar bleibt;
- mehrere Subsysteme interagieren;
- Security/Tenant/Data-Loss betroffen ist;
- zwei plausible Hypothesen durch Logs schwer trennbar sind;
- der Fix eine Architekturentscheidung verändert;
- derselbe Fehler nach zwei evidence-backed Fixversuchen noch besteht.

Nicht eskalieren, wenn nur ein Selector/CSS-Property/typo oder eindeutiger CI-Shell-Bug fehlt.

## Meine konkrete Empfehlung

- **Street/House jetzt auf GPT-6 Pro/Astra Pro/max**, aber mit dem neuen Forensic-Recovery-Prompt, nicht mit dem alten Patchauftrag.
- **Admin Security auf Sol Extra High**, anschließend GPT-6 Pro als adversariales Zweitreview.
- **Sync Security/Stability auf Sol Extra High**, GPT-6 Pro nur für harte Convergence-/Race-Fälle.
- **UI auf Sol Medium/High**, Luna als schneller Repro-/Test-/Inventory-Worker.
- **Planner auf Sol High**.
- **Luna nicht als alleinigen Entscheider für AuthZ, Crypto, SQL/D1-Races oder Street-Geometrie verwenden.**

So nutzt du das große Drei-Wochen-Limit dort, wo zusätzliche Reasoning-Tiefe tatsächlich den größten Hebel hat.

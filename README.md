# Verteil-Flyer

Mobile-first Website zur koordinierten Verteilung von Flyern über eine gemeinsame interaktive Karte.

## Status

Die Feldkarte ist komplett neu gebaut (`/v5`, siehe `docs/plans/active/051-full-rewrite.md`): Straßen und Häuser werden auf dem Gerät aus OSM-Daten abgeleitet (Rust/WebAssembly),
gespeichert und synchronisiert wird nur der Status. Ein Designsystem (`src/ui`) trägt Feldkarte und Organizer-Seiten. Aktueller Stand: `docs/status/CURRENT.md`.

Die technische und produktseitige Source of Truth liegt im Repository unter `docs/`.

## Projektprinzipien

- mobile first
- map first
- Website only, keine native App und keine installierbare PWA
- lightweight und datenarm
- zuverlässig bei schwankender Mobilfunkverbindung
- keine unnötige Standort- oder Bewegungsverfolgung
- einfache Bedienung im Außeneinsatz
- möglichst ohne laufende Infrastrukturkosten
- kleine, verständliche und langfristig wartbare Architektur

## Stack

- TypeScript, React, Vite
- Rust/WebAssembly (`engine-rs`): Ableitung, Vektorkacheln, Routing, Lasso, Suche
- MapLibre GL JS; die Basemap kommt aus der Deployment-Konfiguration (`V5_BASEMAP_DARK`/`V5_BASEMAP_LIGHT`), nichts ist im Client festverdrahtet
- Cloudflare Workers + Static Assets, Cloudflare D1 (Worker bleibt TypeScript, siehe ADR-0035)

## Für Coding-Agents

Vor jeder Arbeit am Projekt zuerst lesen:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`

Danach nur den für die Aufgabe relevanten Kontext laden.

## Entwicklung

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
npm run dev
```

Qualitätscheck:

```bash
npm run check          # Tests, Typecheck, Dependency-Audit, Build
node scripts/v5-e2e/run-all.mjs   # Browser-Flows gegen die echten Worker-Handler (braucht Playwright + Chromium, siehe Skript)
```

Deployment zu Cloudflare:

```bash
npm run deploy
```

Produktions-/Test-Deployment siehe `docs/operations/PRODUCTION.md`.

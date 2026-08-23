# Verteil-Flyer

Mobile-first Website zur koordinierten Verteilung von Flyern über eine gemeinsame interaktive Karte.

## Status

Die Foundation ist vorbereitet und die erste Cloudflare-Testversion läuft. Die technische und produktseitige Source of Truth liegt im Repository unter `docs/`.

## Projektprinzipien

- mobile first
- Website only, keine native App und keine installierbare PWA
- lightweight und datenarm
- zuverlässig bei schwankender Mobilfunkverbindung
- keine unnötige Standort- oder Bewegungsverfolgung
- einfache Bedienung im Außeneinsatz
- möglichst ohne laufende Infrastrukturkosten
- kleine, verständliche und langfristig wartbare Architektur

## Stack

- TypeScript
- React + Vite
- MapLibre GL JS
- OpenStreetMap-basierte Vektordaten über VersaTiles
- Cloudflare Workers + Static Assets
- Cloudflare D1 ab Datenbank-Milestone

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
npm run check
```

Deployment zu Cloudflare:

```bash
npm run deploy
```

Produktions-/Test-Deployment siehe `docs/operations/PRODUCTION.md`.

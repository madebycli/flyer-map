# Verteil-Flyer

Mobile-first Progressive Web App zur koordinierten Verteilung von Flyern über eine gemeinsame interaktive Karte.

## Status

Das Projekt befindet sich im initialen Aufbau. Die technische und produktseitige Source of Truth liegt im Repository unter `docs/`.

## Projektprinzipien

- mobile first
- lightweight und datenarm
- zuverlässig bei schwankender Mobilfunkverbindung
- keine unnötige Standort- oder Bewegungsverfolgung
- einfache Bedienung im Außeneinsatz
- möglichst ohne laufende Infrastrukturkosten
- kleine, verständliche und langfristig wartbare Architektur

## Geplanter Stack

- TypeScript
- React + Vite
- MapLibre GL JS
- OpenStreetMap-Daten / OpenFreeMap als initialer Kartenanbieter
- Cloudflare Workers + Static Assets
- Cloudflare D1
- Progressive Web App mit Offline-Unterstützung

## Für Coding-Agents

Vor jeder Arbeit am Projekt zuerst lesen:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`

Danach nur den für die Aufgabe relevanten Kontext laden.

## Lokale Entwicklung

Nach dem Foundation-Setup:

```bash
npm install
npm run dev
```

Produktions-Build:

```bash
npm run build
```

Deployment zu Cloudflare:

```bash
npm run deploy
```

Die Cloudflare-Ressourcen werden bewusst erst nach dem ersten erfolgreichen Build verbunden. Siehe `docs/operations/DEPLOYMENT.md`.

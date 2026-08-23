# Verteil-Flyer

Mobile-first Progressive Web App zur koordinierten Verteilung von Flyern über eine gemeinsame interaktive Karte.

## Status

Die Foundation ist vorbereitet. Die technische und produktseitige Source of Truth liegt im Repository unter `docs/`.

## Projektprinzipien

- mobile first
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
- OpenStreetMap-Daten / OpenFreeMap als initialer Kartenanbieter
- Cloudflare Workers + Static Assets
- Cloudflare D1 (ab Datenbank-Milestone)
- Progressive Web App

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

Die Cloudflare-Ressourcen werden bewusst erst nach einem erfolgreichen Foundation-Build verbunden. Siehe `docs/operations/DEPLOYMENT.md`.

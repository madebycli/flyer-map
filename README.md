# Verteil-Flyer

Mobile-first Website zur koordinierten Verteilung von Flyern über eine gemeinsame interaktive Karte.

## Status

Die Foundation ist produktiv deployed. M1 ergänzt die erste echte Produktfunktion: Verteilaktion, farbcodierte Teams sowie zeichn-, auswähl- und bearbeitbare Teamgebiete auf der Karte mit lokaler Reload-Persistenz.

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

- TypeScript
- React + Vite
- MapLibre GL JS
- OpenFreeMap Bright Vektor-Basemap mit OpenStreetMap-abgeleiteten Kartendaten
- Verteil-Flyer GeoJSON-Layer für Teamgebiete und spätere Aufgaben
- Cloudflare Workers + Static Assets
- Cloudflare D1 ab Shared-Persistence-Milestone

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

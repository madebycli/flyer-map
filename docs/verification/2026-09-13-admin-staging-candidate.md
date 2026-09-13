# Admin-Staging-Kandidat · 2026-09-13

Dieser Commit aktiviert den kontrollierten Admin-Staging-Test des unabhängigen StreetEngine-Fix-Kandidaten.

- Kandidat: `b4251707ef52c8393e392a9d0f9d4ffa19e71c5a`
- Ausgangspunkt: `3e1dfb409cb63381b9a7154cd3a941252da95263` (exakt verifizierter Live-Stand)
- Fixes: dauerhafte Offline-FIFO-Sequenz, begrenzte 20k-Adressverknüpfung, indizierte Edge-Lesewege
- CI: Run `34768488683` erfolgreich (Tests, Typecheck, Dependency-Audit, Build)
- unabhängiger Scale-Run: `34768488720` erfolgreich (0/399/1k/5k/10k/20k)
- Ziel: https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev
- Keine Production-Auslieferung, keine Production-D1-Änderung und keine Secret-Rotation.

---
id: ADR-0028
type: decision
status: accepted-for-main-candidate
date: 2026-09-08
related: [ADR-0026, architecture-security, architecture-data, operations-deployment, plan-033-main-runtime-parity-and-domain-aliases]
---

# ADR-0028: Vollständige Main Runtime und Domain-Aliase

## Entscheidung

`worker/indexOrganizer.ts` ist der kanonische vollständige Main Worker. Er ergänzt die bestehende Field-, Collection-, Pickup- und RxDB-Runtime um Organization Auth, Security und Admin APIs. Die React-Oberfläche und ihre same-origin APIs werden damit aus demselben Release-Artefakt ausgeliefert.

Genehmigte Main-Domains sind Aliase desselben Runtime- und Data-Planes. Organization-, Account-, Membership-, Campaign-, Team-, Area-, Task-, House-, Feed- und Event-Identitäten werden niemals aus `Host` oder `Origin` gebildet. Alle Aliase binden dieselbe D1 und dieselben erforderlichen Durable Objects.

Browser-Sitzungen bleiben durch `__Host-`-Cookies je Origin getrennt. Jeder Origin meldet sich separat an. Schreibzugriffe verlangen weiterhin den exakt passenden Origin. Es gibt weder credentialed Wildcard-CORS noch einen Cross-Domain Session-Cookie.

## Alternativen

Ein zusätzlicher Gateway mit separatem Organization-API-Worker wurde verworfen. Er würde Deployments, CORS, Cookie-Grenzen, Bindings und Betriebskosten erhöhen und löst kein Problem, das der vorhandene vollständige Wrapper nicht bereits löst.

Eine Datenbank oder Campaign-Kopie pro Domain wurde verworfen. Sie würde Identitäten und Change Feeds auseinanderziehen und einen fehleranfälligen Domain-zu-Domain-Sync benötigen.

## Security, Skalierung und Kosten

Serverseitige Organization- und Campaign-Autorisierung bleibt die einzige Berechtigungsquelle. Domainnamen sind Transportkontext. Die Architektur nutzt einen Worker, eine D1 und die vorhandenen Durable Objects, wodurch kein zusätzlicher Dienst oder Datenabgleich entsteht.

Production-Aktivierung setzt Migrationen 0017 bis 0020, KDF- und Campaign-Sync Durable Objects, Rate-Limiter sowie die dokumentierten Secrets voraus. Fehlende Schemas oder Secrets führen fail-closed zu 503 oder Auth-Fehlern.

## Rollback

Vor Aktivierung wird der bisherige Main Entry SHA dokumentiert. Ein Code-Rollback kann den Entry wieder auf `indexFc52.ts` setzen. Additive Migrationen bleiben bestehen und werden nicht zurückgerollt oder gelöscht. Custom Domains bleiben nur dann Shared-Data-Aliase, wenn sie weiter denselben Worker und dieselbe D1 binden.

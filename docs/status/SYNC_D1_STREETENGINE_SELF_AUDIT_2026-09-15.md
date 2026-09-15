# Sync / D1 / StreetEngine self-audit before Unstable release

Stand: 2026-09-15

## Ziel

Dieser Bericht bewertet die eigene Implementierungsarbeit absichtlich adversarial. Ein grüner Testlauf allein gilt nicht als Freigabe. Geprüft wurden insbesondere Sync-Ordering, Retention/Rebootstrap, Trusted-Device-Auth, Multi-Request-/Multi-Tab-Races, StreetEngine-D1-Budget, Realtime/WebSockets und der Release-Kanal selbst.

Baseline des Audits war `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`. `main` wurde während der Implementierung nicht verändert.

## Im Selbst-Audit gefundene eigene Fehler

### 1. Optionales MFA und Remember Device widersprachen sich

**Fehler:** Unstable erlaubt optionales 2FA. Der Login konnte trotzdem ein Remember-Device anfordern, der spätere Refresh akzeptierte Organization Trusted Devices jedoch nur bei `mfa_required = 1`.

**Folge:** Ein legitimer Unstable-Account ohne aktiviertes TOTP konnte nach Ablauf der 12h-Session nicht über sein gemerktes Gerät erneuern.

**Fix:** Trusted Devices tragen die tatsächliche Assurance (`password` oder `mfa`). Der Refresh validiert gegen den aktuellen Accountzustand. MFA-Deaktivierung und andere Credential-Änderungen widerrufen bestehende Familien.

### 2. Parallele 401s konnten denselben One-Time-Token gegeneinander rotieren

**Fehler:** Normale Organization-/Campaign-API-Aufrufe konnten bei gleichzeitig abgelaufener Session parallel den gleichen Remember-Token verwenden.

**Fix:** Clientseitiges Singleflight für Organization, Campaign Admin und RxDB. Eine Tab-Instanz führt pro Identitätsweg nur eine Rotation gleichzeitig aus.

### 3. Multi-Tab-Race konnte eine frisch rotierte Familie selbst zerstören

**Fehler:** Ein unmittelbar nach Rotation eintreffender zweiter Request mit dem alten Token sah bereits `replaced_by_id` und konnte als Replay die gesamte neue Familie widerrufen.

**Fix:** Ein eng begrenztes Rotations-Race-Fenster gibt dem alten Token keine neue Session, verhindert aber die Selbstzerstörung der gerade legitim rotierten Familie. Ein später echter Replay bleibt family-revoking.

### 4. RxDB-Remember-Refresh war nur für Campaign Admin vollständig

**Fehler:** Ein 12h offener Organizer-Tab konnte über RxDB weiterarbeiten, ohne eine normale Organization-API aufzurufen. Bei Ablauf der Organization-Session antwortete die Campaign-Runtime `401 access_required`; der RxDB-Transport probierte ursprünglich nur den Campaign-Admin-Refresh.

**Fix:** RxDB erneuert zuerst die zentrale Organization-Session und verwendet Campaign-Admin-Remember als getrennten Fallback.

### 5. Mischidentität Organization + Campaign Admin hatte einen Fallback-Fehler

**Fehler:** Ein erfolgreicher Organization-Refresh bedeutet nicht automatisch, dass diese Organization für die konkrete Campaign berechtigt ist. Bei gleichzeitig vorhandenem Campaign-Admin-Remember-Cookie konnte der Request danach erneut `401` bleiben.

**Fix:** Nach erfolgreicher Organization-Erneuerung wird der Originalrequest erneut geprüft. Bleibt `access_required`, darf genau einmal der Campaign-Admin-Refresh folgen.

### 6. Realtime-WebSockets konnten an zwei Proxy-/Wrapper-Schichten verloren gehen

**Fehler A:** `worker/indexOrganizer.ts` erzeugte beim Security-Header-Hardening eine neue `Response` aus Body/Status/Headers und übernahm `response.webSocket` nicht.

**Fehler B:** Der öffentliche Unstable-Alias tat dasselbe.

**Folge:** Ein korrekter 101-Handshake des Campaign Durable Objects konnte vor dem Browser in eine normale Response ohne WebSocket-Objekt verwandelt werden.

**Fix:** Beide Schichten erhalten das Cloudflare-WebSocket-Objekt bei 101-Responses. Der Alias bleibt nur Transport-/Header-Schicht.

### 7. Retention-Pull verbrauchte einen unnötigen D1-Query

**Fehler:** Jeder inkrementelle Pull fragte zuerst per `PRAGMA table_info` nach der Retention-Tabelle und danach erst den Floor ab.

**Fix:** Direkter indizierter Floor-Read; nur bei einem tatsächlich alten Schema wird kompatibel auf "Retention noch nicht aktiv" zurückgefallen.

### 8. Release-Kanal war organisatorisch richtig, aber nicht hart genug codiert

**Fehler:** `main` und `unstable` hatten getrennte/abweichende Release-Workflow-Stände. Zusätzlich hätte ein zweiter Unstable-Workflow zu doppelten Deploypfaden führen können.

**Fix:** Ein einziger `.github/workflows/release-channels.yml` definiert beide Kanäle mit harten `github.ref`-Guards und zusätzlichen Runtime-Assertions. Der alte Unstable-only-Workflow wurde entfernt.

Maschinenlesbarer Vertrag: `.release-channels.json`.

Unveränderliche Zuordnung:

- `main` -> Stable `flyer-map` -> `flyer-map-db`
- `unstable` -> Unstable `flyer-map-unstable-backend` / Alias `flyer-map-unstable` -> `flyer-map-unstable-db`
- Feature-/Audit-Branches -> kein öffentlicher Release-Kanal

### 9. Laufende Worker-Version war nicht eindeutig auf einen Git-Commit zurückführbar

**Fehler:** `/api/runtime.version` ist Cloudflare-Version-Metadatum, kein Git-SHA.

**Fix:** Der Release-Workflow stempelt `SOURCE_COMMIT_SHA=$GITHUB_SHA`; `/api/runtime` liefert `sourceCommit`. Nach jedem Release wird zusätzlich `release-channel-state.json` als Actions-Artefakt erzeugt.

## Was der Audit ausdrücklich nicht als bewiesen verkauft

### D1 Free Tier

`D1_FREE_TIER_FEASIBILITY = UNKNOWN_REMOTE_METRICS_REQUIRED`.

Die lokalen 20k-/Budgettests beweisen Query-Budget-Regressionen und Statement-Grenzen, aber keine Cloudflare-Abrechnung. Ein endgültiges Kostenurteil benötigt reale `meta.rows_read` / `meta.rows_written` aus dem isolierten Unstable-D1.

### Physischer Change-Feed-GC

`PHYSICAL_CHANGE_FEED_GC = SAFELY_DISABLED_PENDING_MULTITAB_PROTOCOL`.

Retention-Floor/Epoch und `rxdb_checkpoint_expired` sind vorhanden. Produktiver physischer `DELETE FROM campaign_sync_changes` bleibt durch Test-Gate verboten, bis ein destruktiver Rebootstrap mit zweitem bereits offenem Tab separat bewiesen ist.

### Wartbarkeit des Sync-Coordinators

Der öffentliche Coordinator `rxdbMissionSync.ts` greift über einen bewusst begrenzten internen Cast auf State des ausgelagerten Core zu. Das ist aktuell getestet und korrektheitsseitig akzeptabel, bleibt aber technische Schuld. Bei einer späteren RxDB-/Coordinator-Überarbeitung sollte dafür eine explizite Core-Schnittstelle entstehen.

## Freigabekriterien für Unstable

Ein Merge nach `unstable` ist nur zulässig, wenn auf demselben finalen Head:

1. CI vollständig grün ist, inklusive Tests, Typecheck, Dependency Audit und Production Build.
2. Independent StreetEngine Scale Audit grün ist.
3. PR #96 auf exakt diesem Head mergebar ist und `unstable` keinen Base-Drift hat.
4. Der Release-Channel-Contract grün ist.

Nach dem Merge gilt die Freigabe erst als abgeschlossen, wenn der durch den `unstable`-Push automatisch gestartete `Release Stable and Unstable Channels`-Workflow:

- ausschließlich den `unstable`-Job ausführt;
- die dedizierte Unstable-D1 verwendet;
- Migrationen dort erfolgreich anwendet und Schema verifiziert;
- Backend und Alias erfolgreich deployt;
- `/`, `/login`, `/start`, `/api/organization/me` und `/api/runtime` erfolgreich smoken kann;
- `/api/runtime.environment == "unstable"` und `/api/runtime.sourceCommit == GITHUB_SHA` bestätigt;
- das Release-State-Artefakt erzeugt.

## Urteil vor Merge

Die ursprüngliche Implementierung war **nicht** in allen Punkten zufriedenstellend. Der Selbst-Audit hat mehrere reale Auth-/Realtime-/Release-Race-Probleme gefunden, die durch die ursprünglichen grünen Gates nicht vollständig erfasst waren. Diese Punkte wurden vor dem Release mit eigenen Regressionen und Release-Contracts geschlossen.

Restunsicherheiten sind nun explizit begrenzt: Remote-D1-Billing und destruktiver Multi-Tab-Feed-GC werden nicht als gelöst behauptet und blockieren deshalb keine sichere Beta-Erprobung auf dem isolierten Unstable-Kanal, solange physischer Feed-GC deaktiviert bleibt.

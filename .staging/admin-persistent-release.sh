#!/usr/bin/env bash
set -euo pipefail

ADMIN_DB_NAME='flyer-map-admin-staging-db'
ADMIN_WORKER_NAME='flyer-map-admin-staging'
PROD_D1_ID='0113e775-1e43-4d96-8b97-51fdeec7355b'
RXDB_STAGING_D1_ID='bcec3432-18ec-42a2-970a-64d52c8263d5'
OUT='/tmp/admin-persistent'
PRIVATE='/tmp/admin-persistent-private'
mkdir -p "$OUT" "$PRIVATE"

fail() {
  echo "$*" >&2
  exit 1
}

node <<'NODE'
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
if (c.main !== './worker/indexFc52.ts') throw new Error(`Production main changed: ${c.main}`);
if ((c.d1_databases || []).find((x) => x.binding === 'DB')?.database_id !== '0113e775-1e43-4d96-8b97-51fdeec7355b') {
  throw new Error('Production D1 changed');
}
if ((c.ratelimits || []).some((x) => ['91714001', '91714002', '91714003'].includes(String(x.namespace_id)))) {
  throw new Error('Production rate limit contract changed');
}
if ((c.compatibility_flags || []).includes('nodejs_compat')) throw new Error('Production compatibility flag changed');
NODE

[[ "${PERSISTENT_BOOTSTRAP_SECRET_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || fail 'Persistent bootstrap digest missing or invalid.'

ACCOUNTS_JSON="$(curl --fail-with-body --silent --show-error 'https://api.cloudflare.com/client/v4/accounts?per_page=50' -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H 'Content-Type: application/json')"
[[ "$(jq -r '.success' <<<"$ACCOUNTS_JSON")" == 'true' ]]
if [[ -n "${CONFIGURED_CLOUDFLARE_ACCOUNT_ID:-}" ]] && jq -e --arg id "$CONFIGURED_CLOUDFLARE_ACCOUNT_ID" '.result[]|select(.id==$id)' <<<"$ACCOUNTS_JSON" >/dev/null; then
  export CLOUDFLARE_ACCOUNT_ID="$CONFIGURED_CLOUDFLARE_ACCOUNT_ID"
elif [[ "$(jq '.result|length' <<<"$ACCOUNTS_JSON")" == '1' ]]; then
  export CLOUDFLARE_ACCOUNT_ID="$(jq -r '.result[0].id' <<<"$ACCOUNTS_JSON")"
else
  fail 'Cloudflare account is ambiguous.'
fi

LIST_JSON="$(npx wrangler d1 list --json)"
ADMIN_D1_ID="$(jq -r --arg name "$ADMIN_DB_NAME" '[.[]|select(.name==$name)]|if length==1 then .[0].uuid else empty end' <<<"$LIST_JSON")"
[[ -n "$ADMIN_D1_ID" ]] || fail 'Persistent Admin D1 missing or ambiguous.'
[[ "$ADMIN_D1_ID" != "$PROD_D1_ID" && "$ADMIN_D1_ID" != "$RXDB_STAGING_D1_ID" ]] || fail 'Protected D1 collision.'
export ADMIN_D1_ID ADMIN_DB_NAME ADMIN_WORKER_NAME PROD_D1_ID RXDB_STAGING_D1_ID

npx wrangler d1 migrations apply "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-before.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-before.json" >/dev/null

STATE_SQL="SELECT
(SELECT COUNT(*) FROM organization_bootstrap_state) AS bootstrap_count,
(SELECT COUNT(*) FROM organizations) AS organization_count,
(SELECT COUNT(*) FROM organization_accounts) AS account_count,
(SELECT COUNT(*) FROM campaigns WHERE organization_id IS NOT NULL) AS owned_campaign_count,
(SELECT COUNT(*) FROM field_groups) AS field_group_count,
(SELECT COUNT(*) FROM field_group_join_credentials) AS join_credential_count,
(SELECT COUNT(*) FROM field_group_recoverable_credentials) AS recovery_count,
(SELECT COUNT(*) FROM field_group_memberships) AS membership_count,
(SELECT COUNT(*) FROM comments) AS comment_count,
(SELECT COUNT(*) FROM domain_events) AS domain_event_count;"
STATE_BEFORE="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "$STATE_SQL")"
printf '%s' "$STATE_BEFORE" > "$OUT/state-before.json"
jq -c '.[0].results[0]' "$OUT/state-before.json" > "$PRIVATE/state-before-normalized.json"

SECRET_STATUS="$(curl -sS -o "$PRIVATE/worker-secrets.json" -w '%{http_code}'   "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${ADMIN_WORKER_NAME}/secrets"   -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H 'Content-Type: application/json' || true)"
if [[ "$SECRET_STATUS" == '200' ]]; then
  jq -e '.success == true' "$PRIVATE/worker-secrets.json" >/dev/null
elif [[ "$SECRET_STATUS" != '404' ]]; then
  fail "Could not inspect persistent Worker secrets, HTTP $SECRET_STATUS."
else
  printf '{"result":[],"success":true}\n' > "$PRIVATE/worker-secrets.json"
fi
SECRET_NAMES="$(jq -r '.result[]?.name' "$PRIVATE/worker-secrets.json")"
has_secret() {
  grep -Fqx "$1" <<<"$SECRET_NAMES"
}

ORG_COUNT="$(jq -r '.[0].results[0].organization_count' "$OUT/state-before.json")"
ACCOUNT_COUNT="$(jq -r '.[0].results[0].account_count' "$OUT/state-before.json")"
RECOVERY_COUNT="$(jq -r '.[0].results[0].recovery_count' "$OUT/state-before.json")"

if ! has_secret ORGANIZATION_TOTP_KEY; then
  if (( ORG_COUNT > 0 || ACCOUNT_COUNT > 0 )); then
    fail 'ORGANIZATION_TOTP_KEY is missing while persistent data exists, refusing to rotate.'
  fi
  TOTP_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
  [[ "$TOTP_KEY" =~ ^[A-Za-z0-9_-]{43}$ ]] || fail 'Generated TOTP key has an invalid format.'
  echo "::add-mask::$TOTP_KEY"
  printf '%s' "$TOTP_KEY" | npx wrangler secret put ORGANIZATION_TOTP_KEY --name "$ADMIN_WORKER_NAME" >/dev/null
fi

if ! has_secret FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY; then
  if (( RECOVERY_COUNT > 0 )); then
    fail 'FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY is missing while recoverable credentials exist, refusing to rotate.'
  fi
  FIELD_GROUP_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
  [[ "$FIELD_GROUP_KEY" =~ ^[A-Za-z0-9_-]{43}$ ]] || fail 'Generated field-group key has an invalid format.'
  echo "::add-mask::$FIELD_GROUP_KEY"
  printf '%s' "$FIELD_GROUP_KEY" | npx wrangler secret put FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY --name "$ADMIN_WORKER_NAME" >/dev/null
fi

node <<'NODE'
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
c.main = './worker/indexOrganizer.ts';
c.compatibility_flags = [...new Set([...(c.compatibility_flags || []), 'nodejs_compat'])];
c.env = c.env || {};
c.env.admin_staging = {
  name: process.env.ADMIN_WORKER_NAME,
  workers_dev: true,
  vars: {
    ORGANIZATION_BOOTSTRAP_SECRET_SHA256: process.env.PERSISTENT_BOOTSTRAP_SECRET_SHA256,
    ORGANIZATION_PASSWORD_KDF_ITERATIONS: '600000'
  },
  d1_databases: [{
    binding: 'DB',
    database_name: process.env.ADMIN_DB_NAME,
    database_id: process.env.ADMIN_D1_ID,
    migrations_dir: 'migrations'
  }],
  durable_objects: { bindings: [
    { name: 'CAMPAIGN_SYNC', class_name: 'CampaignSyncDurableObject' },
    { name: 'ORGANIZATION_PASSWORD_KDF', class_name: 'OrganizationPasswordKdfDurableObject' }
  ]},
  ratelimits: [
    { name: 'FIELD_GROUP_JOIN_ACTOR_LIMITER', namespace_id: '91914001', simple: { limit: 30, period: 60 },
    },
    { name: 'FIELD_GROUP_JOIN_CREDENTIAL_LIMITER', namespace_id: '91914002', simple: { limit: 8, period: 60 },
    },
    { name: 'PICKUP_SEARCH_LIMITER', namespace_id: '91914003', simple: { limit: 20, period: 10 },
    },
    { name: 'ORGANIZATION_LOGIN_LIMITER', namespace_id: '91914004', simple: { limit: 12, period: 60 },
    }
  ]
};
c.migrations = c.migrations || [];
if (!c.migrations.some((x) => x.tag === 'v2-organization-password-kdf')) {
  c.migrations.push({ tag: 'v2-organization-password-kdf', new_sqlite_classes: ['OrganizationPasswordKdfDurableObject'] });
}
const protectedIds = new Set(['91714001', '91714002', '91714003', '91814001', '91814002', '91814003']);
for (const limiter of c.env.admin_staging.ratelimits) {
  if (protectedIds.has(String(limiter.namespace_id))) throw new Error(`Rate collision ${limiter.namespace_id}`);
}
fs.writeFileSync('wrangler.jsonc', JSON.stringify(c, null, 2) + '\\n');
NODE

export CLOUDFLARE_ENV=admin_staging
rm -rf dist .wrangler
npm run build >/dev/null
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const redirect = JSON.parse(fs.readFileSync('.wrangler/deploy/config.json', 'utf8'));
const generated = JSON.parse(fs.readFileSync(path.resolve('.wrangler/deploy', redirect.configPath), 'utf8'));
if (generated.name !== process.env.ADMIN_WORKER_NAME) throw new Error('Wrong persistent Worker');
if ((generated.d1_databases || []).find((x) => x.binding === 'DB')?.database_id !== process.env.ADMIN_D1_ID) throw new Error('Wrong persistent D1');
if (!(generated.durable_objects?.bindings || []).some((x) => x.name === 'ORGANIZATION_PASSWORD_KDF' && x.class_name === 'OrganizationPasswordKdfDurableObject')) {
  throw new Error('KDF binding missing');
}
if (generated.vars?.ORGANIZATION_PASSWORD_KDF_ITERATIONS !== '600000') throw new Error('600k KDF policy missing');
if (!(generated.compatibility_flags || []).includes('nodejs_compat')) throw new Error('nodejs_compat missing');
const serialized = JSON.stringify(generated);
if (serialized.includes(process.env.PROD_D1_ID) || serialized.includes(process.env.RXDB_STAGING_D1_ID)) throw new Error('Protected D1 leaked into persistent candidate');
if (serialized.includes('ORGANIZATION_KDF_DIAGNOSTICS')) throw new Error('Diagnostics leaked into persistent candidate');
NODE

npx wrangler deploy --dry-run --outdir .wrangler-admin-persistent-dry-run >/dev/null
npx wrangler deploy 2>&1 | tee "$OUT/deploy.log"
TEST_URL="$(grep -Eo 'https://[^[:space:]]+\\.workers\\.dev' "$OUT/deploy.log" | tail -n1 || true)"
[[ -n "$TEST_URL" ]] || fail 'No workers.dev URL found.'
export TEST_URL

for attempt in $(seq 1 18); do
  START_STATUS="$(curl -sSLo "$PRIVATE/start.html" -w '%{http_code}' "$TEST_URL/start" || printf 000)"
  if [[ "$START_STATUS" -ge 200 && "$START_STATUS" -lt 400 ]]; then break; fi
  [[ "$attempt" == '18' ]] || sleep 4
done
[[ "$START_STATUS" -ge 200 && "$START_STATUS" -lt 400 ]] || fail 'Persistent Worker did not become reachable.'

ME_STATUS="$(curl -sS -o "$PRIVATE/me.json" -w '%{http_code}' "$TEST_URL/api/organization/me" || printf 000)"
HEAD_STATUS="$(curl -sS -I -D "$OUT/head-api-headers.txt" -o /dev/null -w '%{http_code}' "$TEST_URL/api/organization/me" || printf 000)"
ORIGIN_STATUS="$(curl -sS -o "$PRIVATE/origin.json" -w '%{http_code}' -X POST "$TEST_URL/api/organization/login/password" -H 'Origin: https://invalid.example' -H 'Content-Type: application/json' --data '{}' || printf 000)"
[[ "$ME_STATUS" == '401' ]] || fail "Unexpected unauthenticated /me status: $ME_STATUS"
[[ "$HEAD_STATUS" == '405' ]] || fail "Unexpected HEAD status: $HEAD_STATUS"
[[ "$ORIGIN_STATUS" == '403' ]] || fail "Unexpected cross-origin status: $ORIGIN_STATUS"
grep -Eqi '^x-frame-options: DENY' "$OUT/head-api-headers.txt"
grep -Eqi '^x-content-type-options: nosniff' "$OUT/head-api-headers.txt"

STATE_AFTER="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "$STATE_SQL")"
printf '%s' "$STATE_AFTER" > "$OUT/state-after.json"
jq -c '.[0].results[0]' "$OUT/state-after.json" > "$PRIVATE/state-after-normalized.json"
diff -u "$PRIVATE/state-before-normalized.json" "$PRIVATE/state-after-normalized.json" > "$OUT/state-preservation.diff" || {
  cat "$OUT/state-preservation.diff" >&2
  fail 'Persistent data counts changed during deploy.'
}
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-after.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-after.json" >/dev/null

printf '%s\\n' "$TEST_URL" > "$OUT/test-url.txt"
jq -n   --arg url "$TEST_URL"   --arg product "${PRODUCT_SHA:-unknown}"   --arg me "$ME_STATUS"   --arg head "$HEAD_STATUS"   --arg origin "$ORIGIN_STATUS"   --arg start "$START_STATUS"   '{ok:true,persistent:true,data_preserved:true,url:$url,product_head:$product,start:$start,unauthenticated_me:$me,head_api:$head,cross_origin:$origin,production_untouched:true,no_cleanup:true,secrets_rotated_only_when_empty:true}'   > "$OUT/final-safety.json"
